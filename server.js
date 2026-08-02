'use strict';
// Agent Viz — zero-dependency local dashboard for Claude Code hook events.
// Receives hook POSTs at /event, fans them out live to browser clients via SSE at /events.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { spawn, execFileSync } = require('child_process');
// ttyd (the terminal backend) listens here on loopback; officebot proxies the
// terminal WebSocket to it (see the server 'upgrade' handler). Overridable for
// testing.
const TTYD_PORT = Number(process.env.TTYD_PORT) || 7681;

const PORT = process.env.AGENT_VIZ_PORT || 4317;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.apk': 'application/vnd.android.package-archive',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

let sseClients = [];

function broadcast(event) {
  const payload = 'data: ' + JSON.stringify(event) + '\n\n';
  sseClients.forEach(function (res) { res.write(payload); });
}

// The server used to be pure passthrough — it only ever relayed events to
// whoever happened to already be connected. A browser that loads (or
// reloads) the page shows nothing until the NEXT event fires, even if a
// session has been sitting there online the whole time. Fix: remember the
// last event for each known session/subagent, and replay that snapshot to
// any newly-connecting client before live events resume. The client's own
// handleEvent() is already fully driven by "whatever the last event set,"
// so replaying just the last known event per entity is enough to
// reconstruct current state — no separate snapshot format needed.
const sessionCache = new Map(); // session_id -> { lastEvent, subagents: Map(agent_id -> lastEvent) }
const CACHE_GRACE_MS = 8500; // slightly longer than the client's own 8s SessionEnd/6s SubagentStop removal delay

// The last transcript text actually broadcast, per session. This is the
// dedup gate: the transcript's newest text block stays "the newest" across
// many later tool events, and re-attaching it to each of them made the
// dashboard repeat the same quote over and over (bubble re-asserted after
// banter, duplicate lines in the dialogue feed — caught via user
// screenshot). Text is attached to an event ONCE, the first time it's seen.
const speechSent = new Map(); // session_id -> last text broadcast

// Last model broadcast per session. /model at the terminal fires NO hook and
// writes nothing to the transcript — the first evidence of a switch is the
// new model's first assistant entry (often thinking/tool-only, no text). The
// speech ticker below watches for that and broadcasts a synthetic ModelTick
// so the persona handover plays within ~2s, instead of waiting for the next
// hook event that happens to carry a model (worst case: end of a text-only
// turn).
const modelSent = new Map(); // session_id -> last model broadcast
// session_id -> deck tab (deck-1…), stamped onto every event so per-tab views
// survive reloads. Deliberately NOT cleared by forgetSession: the mapping is
// written ONLY by the launch wrapper's opener (fires once per `claude` launch),
// so if the 15-min stale sweep prunes an idle session AND its mapping, the next
// prompt's hooks revive the session with no way to ever re-learn its tab — the
// per-tab office then sits on STANDBY forever while the terminal works
// (confirmed on the Pocket Deck, 2026-07). Bounded as an insertion-ordered Map
// (oldest evicted past the cap) so the original memory-leak concern — unauth
// /event pumping unique session ids — stays solved.
const sessionDeckTab = new Map();
const DECK_TAB_MAX = 500;
// …and persisted to disk (PERM_MODE_FILE pattern): the openers for already-
// running sessions fired long ago, so an in-memory-only map would orphan every
// live session's tab on a server restart — the same STANDBY symptom the
// no-delete rule above fixes for the stale sweep.
const DECK_TAB_FILE = path.join(__dirname, 'deck-tabs.json');
try {
  const saved = JSON.parse(fs.readFileSync(DECK_TAB_FILE, 'utf8'));
  if (saved && typeof saved === 'object') Object.keys(saved).forEach(function (k) { sessionDeckTab.set(k, saved[k]); });
} catch (e) { /* first run — none recorded yet */ }
let _deckTabSaveT = null;
function saveDeckTabs() {
  if (_deckTabSaveT) return;   // debounce: tab launches can burst
  _deckTabSaveT = setTimeout(function () {
    _deckTabSaveT = null;
    const o = {}; sessionDeckTab.forEach(function (v, k) { o[k] = v; });
    try { fs.writeFileSync(DECK_TAB_FILE, JSON.stringify(o)); } catch (e) { }
  }, 500);
}

// ---- orphaned-tab recovery ------------------------------------------------
// The mapping above is written ONLY by the `claude` wrapper's opener, which
// fires once per launch and pins the session id it passes as --session-id. But
// a tab can mint a NEW session id WITHOUT relaunching — /clear, /compact, or a
// forked resume all do — and that id reaches us through Claude's own hooks,
// which carry no deckTab. The tab then owns a session nobody can find: its
// office sits on STANDBY while the terminal works, and its CONVO pane reads
// "No Claude session on this tab yet" (chatSessionForTab matches on deckTab
// too, which is why one cause produces both symptoms). Worse, the untagged
// session is adoptable by ANY other tab's view (_sessionShown rule 5), so the
// work shows up in the wrong tab, and closing that tab doesn't hand it back —
// the real tab is pinned to STANDBY by rule 4 for as long as the server says
// it owns nothing. Confirmed on the Pocket Deck after a day idle, 2026-07-30.
//
// Recover the tab from the transcript itself. Every assistant entry carries
// BOTH ids: `sessionId` (the CURRENT session — what the hooks report) and
// `session_id` (the session the PROCESS was launched under). A freshly
// launched session stamps the two identically; when they DIFFER the second one
// is the launch id — precisely the one the opener mapped. So one tail scan
// yields the ancestor, and the ancestor yields the tab. (Verified on a tab left
// a day and then /clear'd: it was running under an id the opener never saw,
// while every entry in that session's transcript was stamped with the id the
// tab HAD been launched under — against a freshly launched control tab in the
// same project where the two ids agreed.)
const deckTabHealed = new Map(); // sid -> { tab, at } — tab null = scanned, no link yet
const HEAL_RETRY_MS = 15000;     // a session that hasn't answered yet has no assistant entry to read; retry, don't give up
const HEAL_TAIL_BYTES = 1048576; // same tail budget as resolveTranscriptInfo — tool results can be huge

// Ask the OS which deck tab each RUNNING claude was launched in, keyed by the
// session id it was launched under. Two facts about a live claude process make
// this exact rather than a guess: the wrapper passes `--session-id <uuid>` on
// the command line, and because the process was started inside a tmux pane its
// environment carries TMUX_PANE. Pane -> tmux session name is the deck tab.
//
// This is what makes the recovery below independent of our own bookkeeping: it
// keeps working when deck-tabs.json never learned the session (officebot was
// down or restarted at launch time) or has since evicted it. Throttled and
// cached — it only runs when an untagged session actually needs a home.
//
// The same scan also yields `byCwd` — the tab of each live claude keyed by the
// working directory it is running in, and ONLY for directories where exactly
// one tab has a claude in them. That is the instant half of the recovery below:
// see step 1.5 of healDeckTab for why an unambiguous cwd names the tab outright.
const LAUNCH_SCAN_TTL_MS = 10000;
let _launchScan = { at: 0, byLaunchSid: new Map(), byCwd: new Map() };
function tabsByLaunchSid() {
  if (Date.now() - _launchScan.at < LAUNCH_SCAN_TTL_MS) return _launchScan;
  const map = new Map();
  const byCwd = new Map();
  const cwdTabs = new Map();   // cwd -> Set of tabs running a claude there
  try {
    // pane id (%63) -> tmux session name (deck-52)
    const panes = new Map();
    execFileSync('tmux', ['list-panes', '-a', '-F', '#{pane_id} #{session_name}'],
      { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').forEach(function (l) {
        const sp = l.indexOf(' ');
        if (sp > 0) panes.set(l.slice(0, sp), l.slice(sp + 1).trim());
      });
    fs.readdirSync('/proc').forEach(function (pid) {
      if (!/^\d+$/.test(pid)) return;
      let argv;
      try { argv = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8'); } catch (e) { return; }
      if (argv.indexOf('--session-id') === -1) return;
      const parts = argv.split('\0');
      const i = parts.indexOf('--session-id');
      const launchSid = i !== -1 ? parts[i + 1] : null;
      if (!launchSid) return;
      let env;
      try { env = fs.readFileSync('/proc/' + pid + '/environ', 'utf8'); } catch (e) { return; }
      const m = env.match(/(?:^|\0)TMUX_PANE=([^\0]+)/);
      const tab = m && panes.get(m[1]);
      if (!tab) return;
      map.set(launchSid, tab);
      // …and where it is running. Two panes of the SAME tab count once: the
      // answer we want is the tab, so a tab with two claudes side by side in
      // one directory is still an unambiguous answer, not a collision.
      let cwd = null;
      try { cwd = fs.readlinkSync('/proc/' + pid + '/cwd'); } catch (e) { /* exited mid-scan */ }
      if (cwd) {
        if (!cwdTabs.has(cwd)) cwdTabs.set(cwd, new Set());
        cwdTabs.get(cwd).add(tab);
      }
    });
    cwdTabs.forEach(function (tabs, cwd) {
      if (tabs.size === 1) byCwd.set(cwd, tabs.values().next().value);
    });
  } catch (e) { /* no tmux, or /proc unreadable — recovery just falls through */ }
  _launchScan = { at: Date.now(), byLaunchSid: map, byCwd: byCwd };
  return _launchScan;
}

// A transcript being written right now belongs to a session that is alive right
// now. Step 1.5 below leans on that: it reasons from the set of RUNNING claude
// processes, so it must not be handed the id of a session that has since died
// (a late or replayed SessionEnd), whose directory some other tab may have
// taken over in the meantime. Minutes of slack — a session mid-turn writes
// constantly, and one merely sitting idle falls back to the transcript scan,
// which by then has assistant entries to read anyway.
const HEAL_CWD_FRESH_MS = 120000;
function transcriptIsLive(tpath) {
  try { return Date.now() - fs.statSync(tpath).mtimeMs < HEAL_CWD_FRESH_MS; } catch (e) { return false; }
}

// The session id the PROCESS was launched under, read out of the transcript of
// a session that was born later inside it. Returns null for a normally launched
// session (both ids agree) — the healthy case, and not something to recover.
function ancestorSid(sid, tpath) {
  // A session's transcript is always named after the session — including the
  // one a /clear mints, which is exactly why the file and the launch id inside
  // it disagree. Requiring the match keeps us reading only this session's own
  // history, and means /event (unauthenticated by design, loopback-bound)
  // can't be pointed at an unrelated transcript with a made-up session id.
  if (path.basename(String(tpath)) !== sid + '.jsonl') return null;
  try {
    const stat = fs.statSync(tpath);
    const readSize = Math.min(stat.size, HEAL_TAIL_BYTES);
    const fd = fs.openSync(tpath, 'r');
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      let o;
      try { o = JSON.parse(line); } catch (e) { continue; } // tail read can start mid-line
      const anc = o && o.session_id;
      if (anc && anc !== sid) return anc;
    }
  } catch (e) { /* transcript not readable yet */ }
  return null;
}

function healDeckTab(sid, tpath, cwd) {
  const prev = deckTabHealed.get(sid);
  // a found tab is permanent; a miss is only cached long enough to keep the
  // rescan off the hot path of every event
  if (prev && (prev.tab || Date.now() - prev.at < HEAL_RETRY_MS)) return prev.tab;
  const launched = tabsByLaunchSid();
  // 1. This id IS a running claude's launch id — its opener never reached us
  //    (officebot down or restarting at launch). Ask the OS instead.
  let tab = launched.byLaunchSid.get(sid) || null;
  // 1.5. The id was minted inside a running tab (/clear, /compact, a forked
  //    resume) and exactly ONE tab is running a claude in the directory this
  //    event came from. Then that tab is the answer with no inference: an id
  //    minted inside a live session was minted inside one of the claudes we
  //    can see, and only one of them is standing in that directory.
  //
  //    This exists because step 2 is unavoidably LATE. `session_id` — the only
  //    field tying a new id back to its launch id — is written on `assistant`
  //    entries and nowhere else; the `mode`, `user` and `system` entries a
  //    fresh /clear writes first carry `sessionId` alone (verified against a
  //    just-/clear'd transcript on the Pocket Deck, 2026-08-02). So between the
  //    /clear and Claude's first reply there is nothing in the transcript to
  //    read, ancestorSid returns null, and the miss is cached for HEAL_RETRY_MS
  //    on top. For a turn that answers in prose and calls no tools there are
  //    barely any hooks in between to retry on, so the tab stayed orphaned for
  //    a whole reply: its office on STANDBY, its CLAUDE pane reading "No Claude
  //    session on this tab yet", and — because an untagged session is claimable
  //    by any empty tab's view (_sessionShown rule 5) — the work showing up in
  //    a different tab entirely. This step closes that window on the FIRST hook
  //    after the /clear, which is SessionStart.
  //
  //    Guarded twice, because a wrong tab is worse than a late one: an
  //    ambiguous directory (two tabs, same cwd) is not in byCwd at all, and a
  //    transcript that isn't currently being written doesn't qualify. Either
  //    way it falls through to step 2, which by then can answer.
  if (!tab && cwd && transcriptIsLive(tpath)) tab = launched.byCwd.get(cwd) || null;
  // 2. Otherwise find the launch id in its transcript and place THAT — live
  //    process first, our own mapping second. Never invent a tab: staying
  //    untagged is the safe failure.
  if (!tab) {
    const anc = ancestorSid(sid, tpath);
    if (anc) tab = launched.byLaunchSid.get(anc) || sessionDeckTab.get(anc) || null;
  }
  deckTabHealed.delete(sid);
  deckTabHealed.set(sid, { tab: tab, at: Date.now() });
  if (deckTabHealed.size > DECK_TAB_MAX) deckTabHealed.delete(deckTabHealed.keys().next().value);
  return tab;
}

// Persisted session metadata so a server restart can rehydrate the live-session
// snapshot instead of blanking every office until the next hook fires. Keyed by
// session id: { deckTab, tpath, cwd, model, at }. Same disk convention as
// deck-tabs.json — a debounced writeFileSync in try/catch. Bounded to the 200
// newest by `at`. sessionCache itself stays memory-only; THIS is what survives.
const SESSION_META_FILE = path.join(__dirname, 'sessions-meta.json');
const sessionMeta = new Map();
try {
  const saved = JSON.parse(fs.readFileSync(SESSION_META_FILE, 'utf8'));
  if (saved && typeof saved === 'object') Object.keys(saved).forEach(function (k) { sessionMeta.set(k, saved[k]); });
} catch (e) { /* first run — none recorded yet */ }
let _sessionMetaSaveT = null;
function saveSessionMeta() {
  if (_sessionMetaSaveT) return;   // debounce: event bursts
  _sessionMetaSaveT = setTimeout(function () {
    _sessionMetaSaveT = null;
    // keep only the 200 newest by `at` so this can't grow without bound
    if (sessionMeta.size > 200) {
      const keep = Array.from(sessionMeta.entries()).sort(function (a, b) { return (b[1].at || 0) - (a[1].at || 0); }).slice(0, 200);
      sessionMeta.clear();
      keep.forEach(function (e) { sessionMeta.set(e[0], e[1]); });
    }
    const o = {}; sessionMeta.forEach(function (v, k) { o[k] = v; });
    try { fs.writeFileSync(SESSION_META_FILE, JSON.stringify(o)); } catch (e) { }
  }, 500);
}
// Record/refresh a main session's metadata from a real hook event. Skips
// subagent events (no session-level identity of their own) and SessionEnd (the
// session is about to be forgotten — forgetSession drops its record). Only
// records something anchored to a real transcript, taking each field from the
// event or the last thing we knew for this session.
function recordSessionMeta(evt) {
  if (!evt || evt.agent_id || !evt.session_id) return;
  if (evt.hook_event_name === 'SessionEnd') return;
  const sid = evt.session_id;
  const prev = sessionMeta.get(sid) || {};
  const tpath = evt.transcript_path || prev.tpath || null;
  if (!tpath) return;   // nothing worth persisting without a transcript to reopen
  sessionMeta.set(sid, {
    deckTab: evt.deckTab || prev.deckTab || sessionDeckTab.get(sid) || null,
    tpath: tpath,
    cwd: evt.cwd || prev.cwd || null,
    model: evt.model || prev.model || null,
    at: Date.now()
  });
  saveSessionMeta();
}

// ---- REAL usage from /usage (pushed by the deck-usage-poll poller) ----
// officebot normally ESTIMATES usage from local token counts; the poller drives
// a hidden claude session to run /usage every few minutes and POSTs the screen,
// giving us the account's TRUE 5-hour / weekly / model percentages. Parsed here
// and, while fresh, overrides the estimate in usageSummary().
let _realUsage = null;
const REAL_USAGE_TTL_MS = 12 * 60 * 1000;   // fresh window; poller runs every ~3 min (+ instantly per claude launch)
// Survive restarts: _realUsage was memory-only, so every deck-restart blanked
// the monitors for a couple of minutes (poller boot + first capture + the
// page's 60s poll) — on the phone that read as "usage never updates". Persist
// the last good parse and reload it at boot while still inside the TTL.
const REAL_USAGE_FILE = path.join(__dirname, 'usage-realusage.json');
try {
  const r = JSON.parse(fs.readFileSync(REAL_USAGE_FILE, 'utf8'));
  if (r && r.at && Date.now() - r.at < REAL_USAGE_TTL_MS) _realUsage = r;
} catch (e) { /* first run / stale / unreadable — start empty */ }
function parseUsageText(raw) {
  if (!raw) return null;
  const txt = String(raw).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
  function pctAfter(label) {
    const i = txt.indexOf(label); if (i < 0) return null;
    const m = txt.slice(i, i + 220).match(/(\d+)\s*%\s*used/i);
    return m ? Math.min(100, parseInt(m[1], 10)) : null;
  }
  function resetAfter(label) {
    const i = txt.indexOf(label); if (i < 0) return null;
    const m = txt.slice(i, i + 220).match(/Resets\s+([^\n\r]+)/i);
    return m ? m[1].trim() : null;
  }
  const sess = pctAfter('Current session');
  const week = pctAfter('Current week (all models)');
  let modelPct = null, modelReset = null, m2; const re = /Current week \(([^)]+)\)/g;
  while ((m2 = re.exec(txt))) {
    if (/all models/i.test(m2[1])) continue;
    const seg = txt.slice(m2.index, m2.index + 220), pm = seg.match(/(\d+)\s*%\s*used/i);
    if (pm) { modelPct = Math.min(100, parseInt(pm[1], 10)); const rm = seg.match(/Resets\s+([^\n\r]+)/i); modelReset = rm ? rm[1].trim() : null; break; }
  }
  if (sess == null && week == null && modelPct == null) return null; // not a /usage screen
  return {
    sessionPct: sess, weekPct: week, fablePct: modelPct,
    sessionReset: resetAfter('Current session'), weekReset: resetAfter('Current week (all models)'), fableReset: modelReset,
    at: Date.now(),
  };
}
// "9:30pm (UTC)" -> ms until that reset (roll forward by the 5h window if past)
function sessionResetMs(str) {
  if (!str) return null;
  const m = str.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10) % 12; if (/pm/i.test(m[3])) h += 12;
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const d = new Date(); d.setUTCHours(h, min, 0, 0);
  let t = d.getTime();
  while (t <= Date.now()) t += 5 * 3600000;
  return t - Date.now();
}
// Weekly-reset label → ms until that reset. Claude's /usage "Current week" line
// reports its reset either as a relative "in N days"/"in N hours" or as an
// absolute date ("Nov 5" / "Nov 5, 2026"). Tolerant on purpose (the exact
// label format isn't observable on PC — verify against a live phone capture)
// and returns null when unparseable so the caller falls back to the rough day
// estimate. Mirrors sessionResetMs's roll-forward: a slightly-past date rolls
// forward one week rather than reporting a negative countdown.
function weekResetMs(str) {
  if (!str) return null;
  const s = String(str).trim();
  let m = s.match(/(\d+)\s*day/i);
  if (m) return parseInt(m[1], 10) * 86400000;
  m = s.match(/(\d+)\s*(?:hour|hr)/i);
  if (m) return parseInt(m[1], 10) * 3600000;
  // date-style label — Date.parse; if it lacks a year, retry with this year
  let t = Date.parse(s);
  if (isNaN(t)) t = Date.parse(s + ', ' + new Date().getFullYear());
  if (isNaN(t)) return null;
  const now = Date.now();
  while (t <= now) t += 7 * 86400000; // already past → next week's reset
  return t - now;
}
function realUsageFresh() { return _realUsage && (Date.now() - _realUsage.at < REAL_USAGE_TTL_MS) ? _realUsage : null; }

// Last permission mode seen on a real main-session hook ("auto"/"acceptEdits"/
// "manual"/"plan"…, names vary by Claude Code version). The deck's claude
// wrapper asks for it at launch (GET /api/lastmode) and restores auto-accept,
// since Claude itself starts every session back in manual. Persisted so a
// deck-restart doesn't forget it.
let _lastPermMode = null;
const PERM_MODE_FILE = path.join(__dirname, 'last-permission-mode.json');
try {
  const p = JSON.parse(fs.readFileSync(PERM_MODE_FILE, 'utf8'));
  if (p && p.mode) _lastPermMode = p.mode;
} catch (e) { /* first run — none recorded yet */ }

function cacheEvent(evt) {
  const sid = evt.session_id || 'unknown-session';
  // SECURITY: /event is unauthenticated, and the deck's claude-launch wrapper
  // restores this mode — so a forged event setting permission_mode:"acceptEdits"
  // could silently flip your NEXT session into auto-accept. Only trust the mode
  // from an event backed by a real, on-disk transcript (its path is a random
  // session UUID under ~/.claude/projects that a blind forger can't guess), and
  // never persist an escalating mode (auto/acceptEdits/bypass) from this path —
  // those must come from you toggling it in a real session, which still writes
  // a real transcript. A forged event simply can't satisfy both.
  if (evt.permission_mode && !evt.agent_id && evt.permission_mode !== _lastPermMode) {
    let realTranscript = false;
    try { realTranscript = !!evt.transcript_path && fs.statSync(evt.transcript_path).isFile(); } catch (e) { realTranscript = false; }
    if (realTranscript) {
      _lastPermMode = evt.permission_mode;
      try { fs.writeFileSync(PERM_MODE_FILE, JSON.stringify({ mode: _lastPermMode, at: Date.now() })); } catch (e) { }
    }
  }
  let entry = sessionCache.get(sid);
  if (!entry) {
    entry = { lastEvent: null, subagents: new Map(), expireTimer: null, agentTypes: new Map(), pendingTypes: [] };
    sessionCache.set(sid, entry);
  }
  if (!entry.agentTypes) entry.agentTypes = new Map();
  if (!entry.pendingTypes) entry.pendingTypes = [];

  // Many hook payloads omit cwd, and the snapshot replay only keeps the LAST
  // event per session — so a fresh page load showed "— unknown" as the
  // project name whenever the newest event happened to lack cwd. Carry the
  // last known cwd forward so the snapshot always names the project.
  if (!evt.cwd && entry.lastEvent && entry.lastEvent.cwd) evt.cwd = entry.lastEvent.cwd;

  if (evt.agent_id) {
    const aid = evt.agent_id;
    // Subagent hooks don't carry agent_type — but the boss's Task/Agent tool
    // call (remembered below) said what was being sent. Stamp it SERVER-side
    // so it's baked into the cached event: a page refresh or SSE reconnect
    // (phone waking up!) replays the snapshot with the type intact, instead
    // of the client falling back to a pool codename ("Echo") for an agent
    // that's mid-flight.
    if (!evt.agent_type) {
      if (entry.agentTypes.has(aid)) evt.agent_type = entry.agentTypes.get(aid);
      else {
        const nowT = Date.now();
        while (entry.pendingTypes.length) {
          const p = entry.pendingTypes.shift();
          if (nowT - p.at < 20000) { evt.agent_type = p.type; break; }
        }
      }
    }
    if (evt.agent_type) entry.agentTypes.set(aid, evt.agent_type);
    entry.subagents.set(aid, evt);
    if (evt.hook_event_name === 'SubagentStop') {
      setTimeout(function () { entry.subagents.delete(aid); entry.agentTypes.delete(aid); }, CACHE_GRACE_MS);
    }
  } else {
    // remember delegated types for the stamping above (FIFO, bounded)
    if (evt.hook_event_name === 'PreToolUse' && (evt.tool_name === 'Task' || evt.tool_name === 'Agent')
      && evt.tool_input && evt.tool_input.subagent_type) {
      entry.pendingTypes.push({ type: evt.tool_input.subagent_type, at: Date.now() });
      if (entry.pendingTypes.length > 8) entry.pendingTypes.shift();
    }
    entry.lastEvent = evt;
    recordSessionMeta(evt);   // persist sid→{deckTab,tpath,cwd,model} so a restart can rehydrate this session
    if (entry.expireTimer) clearTimeout(entry.expireTimer);
    if (evt.hook_event_name === 'SessionEnd') {
      // Drop the ended session's subagents from the snapshot now, so a page
      // loaded during the grace window doesn't replay their last (active)
      // events AFTER the SessionEnd and resurrect them as "working." The
      // office replays as closing (lastEvent = SessionEnd) until it's evicted.
      entry.subagents.clear();
      entry.expireTimer = setTimeout(function () { forgetSession(sid, entry); }, CACHE_GRACE_MS);
    }
  }
}

// Drop every per-session map entry together — previously transcriptCache was
// missing from cleanup and grew forever (an unbounded memory leak, worse
// because /event is unauthenticated so anyone could pump unique session ids /
// transcript paths into it). One helper keeps the two eviction paths
// (SessionEnd grace, stale sweep) in lockstep. sessionDeckTab is the one map
// that must SURVIVE eviction (see its declaration) — it's bounded by size
// instead.
function forgetSession(sid, entry) {
  sessionCache.delete(sid); speechSent.delete(sid); modelSent.delete(sid);
  sessionTokens.delete(sid); sessionSeenMsg.delete(sid);
  chatEffort.delete(sid); chatPermMode.delete(sid);
  if (sessionMeta.delete(sid)) saveSessionMeta();   // drop the persisted record too (covers SessionEnd grace + the 1h sweep)
  // sessionDeckTab is intentionally NOT deleted here — see its declaration.
  // Dropping it with the session meant an idle-pruned session came back (next
  // prompt's hooks) without its tab, invisible to every per-tab office view.
  const tp = entry && entry.lastEvent && entry.lastEvent.transcript_path;
  if (tp) transcriptCache.delete(tp);
  // The crew's per-agent bookkeeping goes the same way, for the same reason the
  // transcript cache does: /event is unauthenticated, so every map keyed by a
  // session id has to die with the session or it grows without bound.
  const pfx = sid + '|';
  speechSent.forEach(function (v, k) { if (String(k).indexOf(pfx) === 0) speechSent.delete(k); });
  if (tp) {
    const tpfx = tp + '|';
    subagentFile.forEach(function (v, k) {
      if (String(k).indexOf(tpfx) !== 0) return;
      if (v && v.path) subagentCache.delete(v.path);
      subagentFile.delete(k);
    });
    subTokenFiles.forEach(function (v, k) { if (String(k).indexOf(tpfx) === 0) subTokenFiles.delete(k); });
    subTokenScan.delete(tp);
  }
}

function replaySnapshot(res) {
  // _replay marks these as SNAPSHOT playback, not live work. The client uses
  // it to tell "page reloaded over a live office" (staff instantly, no
  // theatre) apart from "real work landed on an EMPTY office" (play the
  // arrival ceremony) — the event's age alone can't distinguish them when
  // the reload happens within seconds of the last real event.
  sessionCache.forEach(function (entry) {
    if (entry.lastEvent) res.write('data: ' + JSON.stringify(Object.assign({}, entry.lastEvent, { _replay: 1 })) + '\n\n');
    entry.subagents.forEach(function (subEvt) { res.write('data: ' + JSON.stringify(Object.assign({}, subEvt, { _replay: 1 })) + '\n\n'); });
  });
}

// Safety net: a session that never sends SessionEnd (crashed, or was test/demo
// traffic that just stopped) would otherwise sit in the snapshot forever,
// cluttering every future page load. If NOTHING has happened for this long,
// treat it as dead even without a formal SessionEnd.
//
// Raised 15min → 1h (user decision: standby only after 1h idle) and kept in
// lockstep with the CLIENT_STALE_MS ghost-buster (public/index.html). It MUST
// be >= the client threshold: a quiet-but-live session pruned here before the
// client's 1h would vanish from replaySnapshot, so an iframe reload (Pocket
// Deck resume) would show the STANDBY "staff vanished" placeholder over a
// session that's actually still alive.
//
// Accepted tradeoff: a genuinely crashed session (no SessionEnd) can now
// linger in snapshots up to 1h. Mitigated by the deck's tab-close /deck/kill,
// per-tab office filtering, and SessionEnd's own CACHE_GRACE_MS eviction — and
// a false positive only costs a walk-out, since the next prompt's hooks bring
// the session straight back.
const STALE_SESSION_MS = 60 * 60 * 1000;
// Far shorter than a session's: a live subagent fires tool hooks constantly,
// so a quarter of an hour of silence means it died rather than that it is
// thinking hard.
const STALE_AGENT_MS = 15 * 60 * 1000;
const TRANSCRIPT_CACHE_MAX_AGE = 30 * 60 * 1000;
setInterval(function () {
  const now = Date.now();
  sessionCache.forEach(function (entry, sid) {
    // Expire silent subagents independently of their session. An agent killed
    // by an API error never sends SubagentStop, and its parent session usually
    // carries on working — so the session check below never reaches it, and
    // the snapshot keeps replaying it to every new page as a live worker.
    // Has to happen here as well as in the browser: clearing it client-side
    // alone means the next reload resurrects it straight out of this cache.
    entry.subagents.forEach(function (evt, aid) {
      if (now - (evt._receivedAt || 0) > STALE_AGENT_MS) {
        entry.subagents.delete(aid);
        entry.agentTypes.delete(aid);
      }
    });
    const lastTs = entry.lastEvent ? entry.lastEvent._receivedAt : 0;
    if (now - lastTs > STALE_SESSION_MS) forgetSession(sid, entry);
  });
  // prune transcriptCache entries not touched recently (paths from ended
  // sessions, or forged ones that never had a session) so it can't grow
  // without bound
  transcriptCache.forEach(function (v, k) {
    if (!v || now - (v.checkedAt || 0) > TRANSCRIPT_CACHE_MAX_AGE) transcriptCache.delete(k);
  });
  // the crew's diary cache ages out the same way — an agent's entry survives its
  // session only if that session was never formally forgotten
  subagentCache.forEach(function (v, k) {
    if (!v || now - (v.checkedAt || 0) > TRANSCRIPT_CACHE_MAX_AGE) subagentCache.delete(k);
  });
}, 5 * 60 * 1000);

// Boot restore: rehydrate the session snapshot from sessions-meta.json so a
// server restart doesn't blank every office until the next hook fires. Each
// record whose transcript still exists on disk AND is recent enough becomes a
// synthetic SessionStart cache entry — 'SessionStart' reads as idle
// (chatStatusFromEvent), a fresh _receivedAt keeps the 1h stale sweep above
// from insta-pruning it, and replaySnapshot's _replay:1 stamp keeps the office
// ceremony-free (no arrival theatre on a reload).
(function restoreSessionsFromMeta() {
  const now = Date.now();
  sessionMeta.forEach(function (rec, sid) {
    if (!rec || !rec.tpath) return;
    if (!rec.at || now - rec.at > STALE_SESSION_MS) return;
    try { if (!fs.statSync(rec.tpath).isFile()) return; } catch (e) { return; }
    if (sessionCache.has(sid)) return;
    const le = { session_id: sid, hook_event_name: 'SessionStart', transcript_path: rec.tpath, _receivedAt: Date.now(), _restored: 1 };
    // A record written before this session's tab was ever known (an orphan from
    // /clear or a forked resume) has deckTab null, and a restart would replay it
    // to the office still untagged — STANDBY again until the tab's next hook.
    // Heal it here so a restart brings the office straight back.
    const tab = rec.deckTab || sessionDeckTab.get(sid) || healDeckTab(sid, rec.tpath, rec.cwd);
    if (tab) le.deckTab = tab;
    if (rec.cwd) le.cwd = rec.cwd;
    if (rec.model) le.model = rec.model;
    sessionCache.set(sid, { lastEvent: le, subagents: new Map(), expireTimer: null, agentTypes: new Map(), pendingTypes: [] });
    // ensure the sid→deckTab pair exists (deck-tabs.json usually has it already)
    // — and persist a freshly healed one, so the mapping is on disk from here
    // on instead of being re-derived at every boot.
    if (tab && !sessionDeckTab.has(sid)) { sessionDeckTab.set(sid, tab); saveDeckTabs(); }
  });
})();

// Real Claude Code hook payloads only ever carry a "model" field on
// SessionStart, and even there it's optional (omitted after /clear, resume,
// etc — confirmed against the official hooks docs). But every hook payload
// carries transcript_path, and that JSONL transcript logs the full assistant
// message — model AND the actual text content — on every non-sidechain
// turn, reliably, hundreds of times per session. So instead of trusting
// evt.model (or having no text at all), resolve BOTH from the transcript
// tail on every main-thread event. Subagent (sidechain) events are skipped:
// their turns aren't recorded inline in the main transcript the way
// main-thread turns are, so there's no reliable source for them here — they
// keep their roster avatar name and generic status bubbles client-side.
const transcriptCache = new Map(); // transcript_path -> { model, text, checkedAt }
const TRANSCRIPT_CACHE_TTL_MS = 1000; // was 3000 — tightened so speech tracks the terminal closely
const TRANSCRIPT_TAIL_BYTES = 1048576; // 1MB — a "thinking" or tool_use-only turn carries no text block at
                                        // all, so the most recent ASSISTANT entry often isn't the most
                                        // recent one that actually said something; need enough scrollback
                                        // to find the last real text turn, not just the last turn.

function resolveTranscriptInfo(transcriptPath) {
  const cached = transcriptCache.get(transcriptPath);
  const now = Date.now();
  if (cached && (now - cached.checkedAt) < TRANSCRIPT_CACHE_TTL_MS) return cached;

  let foundModel = null;
  let foundText = null;
  try {
    const stat = fs.statSync(transcriptPath);
    const readSize = Math.min(stat.size, TRANSCRIPT_TAIL_BYTES);
    const fd = fs.openSync(transcriptPath, 'r');
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n');
    // Keep walking backward until BOTH are found (or we run out of buffer) —
    // don't stop at the first assistant entry, since that one is frequently
    // thinking-only or tool_use-only and would leave "text" stuck on
    // whatever was cached, possibly from a much earlier, unrelated turn.
    for (let i = lines.length - 1; i >= 0 && (foundModel === null || foundText === null); i--) {
      const line = lines[i].trim();
      if (!line) continue;
      let obj;
      try { obj = JSON.parse(line); } catch (e) { continue; } // tail read can start mid-line
      if (obj.type === 'assistant' && !obj.isSidechain && obj.message) {
        if (foundModel === null && obj.message.model) foundModel = obj.message.model;
        if (foundText === null && Array.isArray(obj.message.content)) {
          const textBlocks = obj.message.content
            .filter(function (b) { return b && b.type === 'text' && b.text; })
            .map(function (b) { return b.text; });
          if (textBlocks.length) foundText = textBlocks.join(' ');
        }
      } else if (obj.type === 'user' && !obj.isSidechain && foundModel === null && obj.message
        && typeof obj.message.content === 'string'
        && (obj.message.content.indexOf('<command-name>/model</command-name>') !== -1
          || (obj.message.content.indexOf('<local-command-stdout>') !== -1
            && obj.message.content.indexOf('Set model to') !== -1))) {
        // A "/model" run at the terminal is logged to the transcript the
        // moment it happens, as its OWN string entry — long before the new
        // model's first response. Parse it so the persona handover plays AT
        // the command, not at the next reply. Two on-disk shapes exist
        // (both confirmed against a real transcript):
        //   1. the command wrapper, carrying <command-args>opus</command-args>
        //      — the args token ("opus"/"fable"/…) maps to the same persona
        //      via nicknameForModel as a full "claude-opus-4-8" id would;
        //   2. an older stdout line, "<local-command-stdout>Set model to
        //      \x1b[1mFable 5\x1b[22m and saved..." (ANSI bold around the
        //      name) — kept as a fallback.
        // The backward walk keeps precedence honest: whichever declaration is
        // NEWEST (this line or a later assistant entry's real model id) is
        // found first. Plain-string content only — tool_result user turns are
        // arrays and the assistant's own messages are type 'assistant', so
        // neither can false-positive on a quoted copy of these markers.
        var argM = obj.message.content.match(/<command-args>\s*([a-z0-9. _-]+?)\s*<\/command-args>/i);
        if (argM && argM[1].trim()) {
          foundModel = argM[1].trim(); // e.g. "opus" — nicknameForModel matches /opus/i
        } else {
          var clean = obj.message.content.replace(/\x1b?\[[0-9;]*m/g, ''); // strip ANSI bold codes (ESC byte optional)
          var stdoutM = clean.match(/Set model to\s+([^<\n]+)/);
          if (stdoutM) foundModel = stdoutM[1].replace(/\s*and saved.*$/, '').trim();
        }
      }
    }
  } catch (e) { /* transcript not readable yet */ }

  // Model barely ever changes mid-session, so a stale cached value is still
  // accurate — fine to fall back to it. Text is the opposite: a stale quote
  // from way earlier in the conversation would be actively misleading, so if
  // this scan found nothing fresh, report no speech rather than an old one.
  const model = foundModel !== null ? foundModel : (cached ? cached.model : null);
  const result = { model: model, text: foundText, checkedAt: now };
  transcriptCache.set(transcriptPath, result);
  return result;
}

/* ---- the crew's own diaries: subagent transcripts (2026-07-30) ------------
   Everything above reads the MAIN transcript, which is why the crew were mute:
   a subagent's turns are NOT written into it (verified — zero isSidechain
   entries in a 12MB session log), so every bubble over a working teammate was
   a canned line from the client's own list. Claude Code writes each subagent
   its own file instead:

     <project>/<session-uuid>/subagents/agent-<agent_id>.jsonl

   and it carries exactly what the SubagentStart hook leaves out: the words the
   agent actually wrote, its model, its effort, and `attributionAgent` — the
   agent TYPE, stated by the harness. That last one supersedes the FIFO guess
   in cacheEvent (pair a Task call with the next agent to appear), which
   mis-names the crew whenever the boss fans several agents out in one message.
*/
const SUBAGENT_TAIL_BYTES = 262144;   // 256KB — an agent's whole log is usually smaller than this
const SUBAGENT_CACHE_TTL_MS = 1000;   // same beat as transcriptCache, so crew speech tracks the terminal
const SUBAGENT_FILE_RETRY_MS = 5000;  // the file lands a moment after SubagentStart, so a miss is retried, never cached as final
const subagentCache = new Map();      // file -> { text, model, effort, agentType, checkedAt, mtimeMs, size }
const subagentFile = new Map();       // tpath|aid -> { path, at } (path null = looked, not there yet)

// speechSent holds main-thread quotes under the bare session id; a subagent's
// words are deduped per AGENT, or one talkative teammate would gag the rest.
function speechKey(sid, aid) { return aid ? sid + '|' + aid : sid; }

// Where does this agent's diary live? Derived from the PARENT session's
// transcript path (…/<sid>.jsonl -> …/<sid>/subagents/), so it inherits the
// /event path sandbox above and opens no new trust boundary. agent_id arrives
// on an unauthenticated hook and lands in a filename, so it's whitelisted to
// the id charset first — a forged "../../.." can't climb out of the directory.
function subagentTranscriptPath(mainTpath, aid) {
  if (!mainTpath || !aid || !/^[A-Za-z0-9_-]{1,64}$/.test(String(aid))) return null;
  // A subagent's own hooks may point transcript_path straight at its diary
  // instead of the parent session's log — take that as given rather than
  // deriving a subagents/ path underneath one.
  if (/[\\/]subagents[\\/]/.test(String(mainTpath))) return String(mainTpath);
  const key = mainTpath + '|' + aid;
  const prev = subagentFile.get(key);
  if (prev && (prev.path || Date.now() - prev.at < SUBAGENT_FILE_RETRY_MS)) return prev.path;
  const dir = path.join(String(mainTpath).replace(/\.jsonl$/, ''), 'subagents');
  let found = null;
  // agent-<id>.jsonl is what Claude Code writes today; the bare id, and then a
  // scan for "filename contains the id", ride out a rename upstream.
  const cands = [path.join(dir, 'agent-' + aid + '.jsonl'), path.join(dir, aid + '.jsonl')];
  for (let i = 0; i < cands.length && !found; i++) {
    try { if (fs.statSync(cands[i]).isFile()) found = cands[i]; } catch (e) { /* not this one */ }
  }
  if (!found) {
    try {
      const hit = fs.readdirSync(dir).filter(function (f) {
        return f.endsWith('.jsonl') && f.indexOf(aid) !== -1;
      })[0];
      if (hit) found = path.join(dir, hit);
    } catch (e) { /* no subagents dir — this session has never delegated */ }
  }
  subagentFile.delete(key); subagentFile.set(key, { path: found, at: Date.now() });
  if (subagentFile.size > 500) subagentFile.delete(subagentFile.keys().next().value);
  return found;
}

// Newest words + identity for one live subagent. Same shape as
// resolveTranscriptInfo, same "keep walking back until every field is
// answered" rule: the newest entry is often thinking- or tool_use-only and
// carries no words at all.
function resolveSubagentInfo(mainTpath, aid) {
  const file = subagentTranscriptPath(mainTpath, aid);
  if (!file) return null;
  const now = Date.now();
  const cached = subagentCache.get(file);
  if (cached && (now - cached.checkedAt) < SUBAGENT_CACHE_TTL_MS) return cached;
  let stat;
  try { stat = fs.statSync(file); } catch (e) { return cached || null; }
  // Nothing appended since the last look: reuse it rather than re-reading a
  // quarter-megabyte per agent per tick. This runs for every live agent on
  // every 2s pass and a fan-out is a dozen of them — on a phone that adds up.
  if (cached && stat.mtimeMs === cached.mtimeMs && stat.size === cached.size) {
    cached.checkedAt = now;
    return cached;
  }
  let text = null, model = null, effort = null, agentType = null, partial = '';
  // Read only what has been APPENDED since the last look — first sight takes the
  // last 256KB. A working agent's diary grows every few seconds, and re-reading
  // a quarter-megabyte per agent per tick (a fan-out is a dozen agents) is real
  // battery on a phone. Anything the new bytes don't mention keeps its cached
  // value below, which is the same answer a full re-read would have given.
  const resume = cached && cached.offset != null && stat.size >= cached.offset;
  const from = resume ? cached.offset : Math.max(0, stat.size - SUBAGENT_TAIL_BYTES);
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(stat.size - from);
    fs.readSync(fd, buf, 0, buf.length, from);
    fs.closeSync(fd);
    // A resumed read starts exactly at a line boundary carried over as
    // `leftover`; a first read starts mid-line, and that fragment simply fails
    // to parse below.
    const lines = ((resume ? (cached.leftover || '') : '') + buf.toString('utf8')).split('\n');
    partial = lines.pop() || '';   // the final line may still be mid-write
    for (let i = lines.length - 1; i >= 0 && (text === null || model === null || agentType === null); i--) {
      const line = lines[i].trim();
      if (!line) continue;
      let o;
      try { o = JSON.parse(line); } catch (e) { continue; } // tail read can start mid-line
      if (o.type !== 'assistant' || !o.message) continue;
      if (agentType === null && o.attributionAgent) agentType = o.attributionAgent;
      if (model === null && o.message.model) model = o.message.model;
      if (effort === null && o.effort) effort = o.effort;
      if (text === null && Array.isArray(o.message.content)) {
        const t = o.message.content
          .filter(function (b) { return b && b.type === 'text' && b.text; })
          .map(function (b) { return b.text; });
        if (t.length) text = t.join(' ');
      }
    }
  } catch (e) { /* diary not readable yet */ }
  // Type and model are stable for an agent's whole life, so a cached value is
  // still true when this pass's bytes happened not to mention them. Text is the
  // opposite: null means "nothing NEW said", which is exactly what the callers
  // want — they only ever broadcast words they haven't broadcast before.
  const result = {
    text: text,
    model: model !== null ? model : (cached ? cached.model : null),
    effort: effort !== null ? effort : (cached ? cached.effort : null),
    agentType: agentType !== null ? agentType : (cached ? cached.agentType : null),
    offset: stat.size, leftover: partial,
    checkedAt: now, mtimeMs: stat.mtimeMs, size: stat.size
  };
  subagentCache.set(file, result);
  return result;
}

/* ============ CONVO: chat history API (2026-07) ============
   The Pocket Deck's CONVO pane renders the Claude conversation as chat
   bubbles. Source of truth is the transcript JSONL the hooks point at —
   read incrementally by byte offset (append-only file), parsed into
   ordered user/assistant messages. GET /api/chat below. */

// Which session does a deck tab (tmux session "deck-N") currently show?
// Newest real event wins; a live session beats an ended one.
function chatSessionForTab(tab) {
  let best = null;
  sessionCache.forEach(function (entry, sid) {
    const le = entry.lastEvent;
    if (!le || le.deckTab !== tab) return;
    const ended = le.hook_event_name === 'SessionEnd';
    if (!best) { best = { sid: sid, lastEvent: le, ended: ended }; return; }
    // prefer live over ended; among equals, newest _receivedAt
    if (best.ended !== ended) { if (!ended) best = { sid: sid, lastEvent: le, ended: ended }; return; }
    if ((le._receivedAt || 0) > (best.lastEvent._receivedAt || 0)) best = { sid: sid, lastEvent: le, ended: ended };
  });
  return best;
}

// Parse transcript JSONL lines into ordered chat messages.
// Rules verified against real transcripts (2026-07):
// - whitelist type user/assistant; skip isSidechain and isMeta entries and
//   every other type (attachment, queue-operation, file-history-*, ai-title,
//   last-prompt, mode, permission-mode, system, …)
// - user string content = a real prompt UNLESS it's slash-command noise
//   (<command-name>/<local-command-stdout>/<local-command-caveat>) or an
//   interruption marker; user ARRAY content = image-bearing prompt (join its
//   text blocks) or a tool_result turn (no text blocks -> skipped naturally)
// - assistant entries: join text blocks; a single logical message spans
//   MULTIPLE JSONL lines sharing message.id (observed up to 7) -> merge
function parseChatLines(lines) {
  const out = [];
  let effort = null, permMode = null;
  for (let i = 0; i < lines.length; i++) {
    let obj;
    try { obj = JSON.parse(lines[i]); } catch (e) { continue; } // mid-line tail starts
    // side-channel state the CONVO control pills display: mode changes are
    // logged instantly as their own entries, effort rides every assistant line
    if (obj.type === 'permission-mode' && obj.permissionMode) { permMode = obj.permissionMode; continue; }
    if (obj.type === 'assistant' && obj.effort && !obj.isSidechain) effort = obj.effort;
    if (obj.isSidechain || obj.isMeta || !obj.message) continue;
    const ts = obj.timestamp ? Date.parse(obj.timestamp) : null;
    if (obj.type === 'user') {
      const c = obj.message.content;
      let text = null;
      if (typeof c === 'string') {
        if (c.indexOf('<command-name>') !== -1 || c.indexOf('<local-command-stdout>') !== -1
          || c.indexOf('<local-command-caveat>') !== -1 || c.indexOf('[Request interrupted') === 0) continue;
        text = c;
      } else if (Array.isArray(c)) {
        const t = c.filter(function (b) { return b && b.type === 'text' && b.text; }).map(function (b) { return b.text; });
        if (!t.length) continue; // tool_result turns carry no text blocks
        text = t.join('\n\n');
        if (text.indexOf('[Request interrupted') === 0) continue;
      } else continue;
      if (!text || !text.trim()) continue;
      out.push({ role: 'user', text: text, ts: ts, id: obj.uuid || null });
    } else if (obj.type === 'assistant') {
      const c = obj.message.content;
      if (!Array.isArray(c)) continue;
      const t = c.filter(function (b) { return b && b.type === 'text' && b.text; }).map(function (b) { return b.text; });
      if (!t.length) continue; // thinking / tool_use-only lines
      const text = t.join('\n\n');
      const id = obj.message.id || null;
      const prev = out.length ? out[out.length - 1] : null;
      if (prev && prev.role === 'assistant' && id && prev.id === id) {
        prev.text += '\n\n' + text; // same logical message, split across lines
      } else {
        out.push({ role: 'assistant', text: text, ts: ts, id: id });
      }
    }
  }
  return { messages: out, effort: effort, permMode: permMode };
}
// last seen effort / permission mode per session (fed by /api/chat parses —
// polled every 2s while the CONVO pane is open, so they stay current)
const chatEffort = new Map(), chatPermMode = new Map();

// Working / waiting / idle for the ticker, from the session's newest hook.
function chatStatusFromEvent(evt) {
  if (!evt) return { state: 'none', activity: null, at: null };
  const at = evt._receivedAt || null;
  const name = evt.hook_event_name;
  function base(p) { return String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop(); }
  if (name === 'SessionEnd') return { state: 'ended', activity: null, at: at };
  if (name === 'Notification') {
    // Claude Code fires Notification for TWO different things: a real
    // permission prompt ("… needs your permission …") AND a plain 60-second
    // idle nudge ("Claude is waiting for your input"). Only the first is an
    // approve/deny request. Treating the idle one as 'waiting' spammed the
    // deck with allow/deny notifications (whose Approve button just types "1"
    // into an idle terminal) and painted a phantom "Notification" bubble in
    // the office when nothing was being asked. Downgrade the known idle nudge
    // to plain idle; a genuine permission Notification still raises the prompt.
    var nmsg = String(evt.message || '');
    if (/waiting for your input|waiting for input|has been idle|is idle|still (there|working)/i.test(nmsg)) {
      return { state: 'idle', activity: null, at: at };
    }
    return { state: 'waiting', activity: nmsg || 'Claude is asking something', at: at };
  }
  let working = null;
  if (name === 'UserPromptSubmit') working = 'thinking…';
  else if (name === 'PreToolUse' || name === 'PostToolUse' || name === 'PostToolUseFailure') {
    const tool = evt.tool_name || 'a tool';
    const ti = evt.tool_input || {};
    if (tool === 'Read') working = 'reading ' + (base(ti.file_path) || 'a file');
    else if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit') working = 'editing ' + (base(ti.file_path || ti.notebook_path) || 'a file');
    else if (tool === 'TodoWrite' || /^Task(Create|Update|List|Get)$/.test(tool)) working = 'working the task list…';
    else if (tool === 'Bash' || tool === 'PowerShell') working = ti.description || 'running a command';
    else if (tool === 'Grep' || tool === 'Glob') working = 'searching the code…';
    else if (tool === 'Task' || tool === 'Agent') working = 'delegating to ' + (ti.subagent_type || 'an agent');
    else if (tool === 'WebFetch' || tool === 'WebSearch') working = 'browsing…';
    else working = 'using ' + tool;
  } else if (name === 'SubagentStart' || name === 'SubagentStop') working = 'coordinating agents…';
  // Compaction fires no tool hooks for up to a minute, so without this the
  // ticker reads a flat 'idle' through the whole thing — the same bug the
  // office's own compaction staging fixes, one pane over.
  else if (name === 'PreCompact') working = 'compacting the conversation…';
  else if (name === 'PostCompact') working = 'picking up where it left off…';
  if (working) {
    // a "working" older than 5 min means we missed the Stop — don't spin forever
    if (at && Date.now() - at > 5 * 60 * 1000) return { state: 'idle', activity: null, at: at };
    return { state: 'working', activity: working, at: at };
  }
  return { state: 'idle', activity: null, at: at };
}

const CHAT_FIRST_READ_BYTES = 512 * 1024; // first load: last 512KB of transcript

// Speech ticker: hooks only fire around tool calls, so text Claude writes
// BETWEEN tool calls used to sit invisible until the next hook happened to
// fire. Poll every active session's transcript and push fresh text the
// moment it lands, as a synthetic 'SpeechTick' event — the same speechSent
// gate guarantees a given quote is broadcast exactly once, whichever path
// (real event or tick) sees it first. Net effect: the bubble tracks the
// terminal within ~2-3s instead of "whenever the next tool runs".
const SPEECH_TICK_MS = 2000;

// The crew's half of the ticker, for the same reason: an agent grinding through
// a long job writes what it's finding BETWEEN its own hooks, and every word of
// it used to stay invisible until the agent stopped. Only agents that have
// actually reported in are polled (entry.subagents is populated by real hooks),
// so a tick can never conjure a teammate the office has never met.
function sweepCrewSpeech(entry, sid, last) {
  entry.subagents.forEach(function (subEvt, aid) {
    if (subEvt.hook_event_name === 'SubagentStop') return;  // finished — let them leave quietly
    // Prefer the parent session's log (subagentTranscriptPath derives the
    // diary folder from it), and fall back to whatever the agent's own hook
    // carried — which may already BE its diary.
    const base = (last && last.transcript_path) || subEvt.transcript_path;
    if (!base) return;
    const si = resolveSubagentInfo(base, aid);
    if (!si) return;
    if (si.agentType && !subEvt.agent_type) {
      subEvt.agent_type = si.agentType;                      // snapshot replays name them right too
      entry.agentTypes.set(aid, si.agentType);
    }
    const skey = speechKey(sid, aid);
    if (!si.text || speechSent.get(skey) === si.text) return;
    speechSent.set(skey, si.text);
    subEvt._speech = si.text;   // a page load replays their freshest words as well
    const tick = { hook_event_name: 'SpeechTick', session_id: sid, agent_id: aid, _speech: si.text, _receivedAt: Date.now() };
    // Carry the type: a client whose FIRST sight of this agent is a tick (page
    // loaded mid-job, or a hook that arrived with no transcript to read) names
    // them from it, since ensureSubagent fixes an agent's identity on creation.
    const atype = subEvt.agent_type || entry.agentTypes.get(aid);
    if (atype) tick.agent_type = atype;
    const tab = (last && last.deckTab) || subEvt.deckTab;
    if (tab) tick.deckTab = tab;
    broadcast(tick);
  });
}

setInterval(function () {
  sessionCache.forEach(function (entry, sid) {
    const last = entry.lastEvent;
    if (last && last.hook_event_name === 'SessionEnd') return;
    sweepCrewSpeech(entry, sid, last);
    // The main thread's own words need the session log, which only a main-thread
    // hook can point us at. The crew sweep above deliberately runs first and
    // independently: a session can have delegated before any main-thread event
    // carrying a transcript reached us, and gating the crew on the boss's log
    // meant those agents were never polled at all.
    if (!last || !last.transcript_path) return;
    const info = resolveTranscriptInfo(last.transcript_path);
    // Model changed in the transcript (e.g. /model at the terminal — no hook
    // fires for that): announce it right away so the client plays the persona
    // handover now, not whenever the next model-carrying hook event lands.
    if (info.model && modelSent.get(sid) !== info.model) {
      modelSent.set(sid, info.model);
      last.model = info.model; // snapshot replays show the new persona too
      broadcast({ hook_event_name: 'ModelTick', session_id: sid, model: info.model, _receivedAt: Date.now() });
    }
    if (!info.text || speechSent.get(sid) === info.text) return;
    speechSent.set(sid, info.text);
    last._speech = info.text; // snapshot replays carry the freshest words too
    broadcast({ hook_event_name: 'SpeechTick', session_id: sid, _speech: info.text, _receivedAt: Date.now() });
  });
}, SPEECH_TICK_MS);

// ---- usage tracker (the BACK OFFICE panel's data source) ----
// Every Claude Code transcript on this machine logs message.usage (input/
// output/cache tokens), message.model, and a top-level `effort` on each
// assistant entry. Scan ~/.claude/projects/**/*.jsonl INCREMENTALLY (per-file
// byte offsets — only newly appended bytes are read after the first pass),
// keep a rolling 7-day list of usage events, and serve aggregates at
// GET /api/usage: 5-hour window, 7-day total, per-model breakdown, newest
// model+effort, and any rate-limit warning found in a transcript. NOTE:
// actual plan limits are enforced server-side by Anthropic and are NOT
// exposed locally — these are honest token counts, not a quota meter.
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const USAGE_REFRESH_MS = 45000;
const USAGE_WEEK_MS = 7 * 24 * 3600 * 1000;
const usageFiles = new Map();   // path -> { offset, leftover }
let usageEvents = [];           // { t, model, effort, in, out, cr, cw } — NOT sorted (files interleave)
let usageSeenIds = new Set();   // message ids (multi-block messages repeat usage per line)
let usageWarning = null;        // { t, text } newest limit-ish system message
// A warning describes a moment, not a state: with usage credits a session
// keeps working right through its 5h window, so an old warning must not
// keep the office closed for long. 20 minutes of silence = all clear.
const WARN_TTL_MS = 20 * 60 * 1000;
function liveUsageWarning() {
  return (usageWarning && Date.now() - usageWarning.t < WARN_TTL_MS) ? usageWarning : null;
}
let usageLastRefresh = 0;

function ingestUsageLine(line) {
  let o;
  try { o = JSON.parse(line); } catch (e) { return; }
  const t = o.timestamp ? Date.parse(o.timestamp) : NaN;
  if (isNaN(t)) return;
  if (o.type === 'assistant' && o.message && o.message.usage) {
    const id = o.message.id || o.requestId;
    if (id) {
      if (usageSeenIds.has(id)) return;
      usageSeenIds.add(id);
      if (usageSeenIds.size > 80000) usageSeenIds = new Set(); // bound memory; offsets prevent re-reads anyway
    }
    const u = o.message.usage;
    usageEvents.push({
      t: t,
      model: o.message.model || 'unknown',
      effort: o.effort || null,
      in: u.input_tokens || 0,
      out: u.output_tokens || 0,
      cr: u.cache_read_input_tokens || 0,
      cw: u.cache_creation_input_tokens || 0,
    });
  } else {
    // Real rate-limit warnings (if Claude Code ever writes one into the
    // transcript). The old test — "limit" + one of reach/hit/near/… — was FAR
    // too loose: ANY system entry mentioning a limit tripped it, so a
    // conversation ABOUT limits (e.g. building this very feature: "the boss
    // leaves on holiday when limits hit") registered as a live rate limit and
    // clocked the office out. Require an actual rate-limit SIGNATURE — the
    // fixed phrasings Anthropic/Claude Code use — not the bare word "limit".
    const txt = typeof o.content === 'string' ? o.content
      : (o.message && typeof o.message.content === 'string' ? o.message.content : '');
    // NOTE: no bare "usage limit" here — the Fable 5 promo banner ("50% of
    // your weekly usage limit... if you hit your limit, you can continue with
    // usage credits") is a system entry and used to trip this, clocking the
    // office out at login. Require a "limit was actually hit" phrasing.
    const RATELIMIT_SIG = /(rate[\s-]?limit|too many requests|\b429\b|limit (?:reached|exceeded)|reached your .{0,20}limit|approaching your .{0,20}limit)/i;
    if (o.type === 'system' && txt && RATELIMIT_SIG.test(txt)) {
      if (!usageWarning || t > usageWarning.t) usageWarning = { t: t, text: txt.slice(0, 220) };
    }
  }
}

// One transcript's newly-appended bytes, folded into the usage tally. Split out
// of refreshUsage so the crew's diaries — a directory deeper — go through the
// identical offset bookkeeping instead of a second copy of it.
function ingestUsageFile(p, now) {
  let st;
  try { st = fs.statSync(p); } catch (e) { return; }
  if (st.mtimeMs < now - USAGE_WEEK_MS) { usageFiles.delete(p); return; }
  let state = usageFiles.get(p);
  if (!state) { state = { offset: 0, leftover: '' }; usageFiles.set(p, state); }
  if (st.size < state.offset) { state.offset = 0; state.leftover = ''; } // file replaced/truncated
  if (st.size === state.offset) return;
  try {
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(st.size - state.offset);
    fs.readSync(fd, buf, 0, buf.length, state.offset);
    fs.closeSync(fd);
    state.offset = st.size;
    const chunk = state.leftover + buf.toString('utf8');
    const lines = chunk.split('\n');
    state.leftover = lines.pop(); // last piece may be a partial line still being written
    lines.forEach(ingestUsageLine);
  } catch (e) { /* transient read error — retry next refresh */ }
}

function refreshUsage() {
  const now = Date.now();
  if (now - usageLastRefresh < USAGE_REFRESH_MS) return;
  usageLastRefresh = now;
  let dirs;
  try { dirs = fs.readdirSync(PROJECTS_DIR); } catch (e) { return; }
  dirs.forEach(function (d) {
    const dir = path.join(PROJECTS_DIR, d);
    let names;
    try { names = fs.readdirSync(dir); } catch (e) { return; }
    names.forEach(function (f) {
      if (f.endsWith('.jsonl')) { ingestUsageFile(path.join(dir, f), now); return; }
      // Everything else here is a <session-uuid>/ folder, and a session that
      // delegated keeps one diary per agent inside its subagents/ folder. Those
      // tokens are billed exactly like the main thread's, and this sweep — so
      // every meter downstream of it — never opened them: measured at ~24% of
      // all recorded spend on this phone (2026-07-30). The readdir doubles as
      // the "is this a directory that has any" test, so a stray file or a
      // session that never delegated costs one failed call and nothing else.
      const subDir = path.join(dir, f, 'subagents');
      let subs;
      try { subs = fs.readdirSync(subDir); } catch (e) { return; }
      subs.forEach(function (sf) {
        if (sf.endsWith('.jsonl')) ingestUsageFile(path.join(subDir, sf), now);
      });
    });
  });
  // prune the rolling window (filter, not shift — events arrive per-file and
  // are NOT globally time-sorted)
  const cutoff = now - USAGE_WEEK_MS;
  usageEvents = usageEvents.filter(function (e) { return e.t >= cutoff; });
  if (usageWarning && usageWarning.t < cutoff) usageWarning = null;
}

// Claude's rate limiting works in 5-hour blocks: the first request starts a
// block (Anthropic floors the start to the hour), the block expires 5h
// later, and the next request after expiry starts a fresh one. Reconstruct
// that timeline from the usage events — the CURRENT block's end time is the
// real "resets in ..." countdown. For "how much of my limit is left", the
// actual plan quota is not exposed locally, so the bar auto-calibrates:
// 100% = the heaviest COMPLETED block of the trailing week (or the current
// block itself if it's already the heaviest). Honest approximation, clearly
// labelled client-side.
function computeBlocks() {
  const sorted = usageEvents.slice().sort(function (a, b) { return a.t - b.t; });
  const blocks = [];
  let cur = null;
  sorted.forEach(function (e) {
    if (!cur || e.t >= cur.end) {
      const start = Math.floor(e.t / 3600000) * 3600000;
      cur = { start: start, end: start + 5 * 3600000, total: 0 };
      blocks.push(cur);
    }
    cur.total += e.in + e.out + e.cw;
  });
  return blocks;
}

// ---- weekly usage history (persisted) ----
// usageEvents only span 7 days, but weekly baselines need memory beyond
// that — usage-history.json keeps per-day totals (overall + fable-model)
// for 56 days. Days covered by live events are recomputed and overwritten
// each refresh; older days persist untouched across restarts.
const USAGE_HISTORY_FILE = path.join(__dirname, 'usage-history.json');
let usageHistory = { days: {} }; // 'YYYY-MM-DD' -> { total, fable }
try {
  usageHistory = JSON.parse(fs.readFileSync(USAGE_HISTORY_FILE, 'utf8'));
  if (!usageHistory || typeof usageHistory.days !== 'object') usageHistory = { days: {} };
} catch (e) { /* first run */ }

function dayKey(t) {
  const d = new Date(t);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ---- manual calibration anchor (optional) ----
// The auto "vs your busiest week" baseline is only a personal gauge. If the
// user reads their REAL usage % off their Claude account and tells us, we
// anchor the actual ceiling: limit = tokensAtAnchor / (reportedPct/100),
// then usedPct = currentTokens / limit. Stored transparently (the measured
// tokens + reported %) so it's re-anchorable anytime it drifts. Rough by
// nature — our token metric isn't identical to Anthropic's, and our rolling
// 7-day window isn't their fixed weekly reset — so it's most accurate right
// after anchoring; re-tell us a fresh % whenever it looks off.
const CALIB_FILE = path.join(__dirname, 'usage-calibration.json');
function loadCalibration() {
  try {
    const c = JSON.parse(fs.readFileSync(CALIB_FILE, 'utf8'));
    if (!c || typeof c !== 'object') return null;
    const hasWeekly = c.weeklyPct > 0 && c.weeklyTokens > 0;
    const hasFive = c.fiveHour && c.fiveHour.pct > 0 && c.fiveHour.tokensAt > 0;
    return (hasWeekly || hasFive) ? c : null;
  } catch (e) { return null; }
}

function updateUsageHistory() {
  const now = Date.now();
  const buckets = {};
  usageEvents.forEach(function (e) {
    const k = dayKey(e.t);
    const b = buckets[k] = buckets[k] || { total: 0, fable: 0 };
    const amt = e.in + e.out + e.cw;
    b.total += amt;
    if (/fable/i.test(e.model || '')) b.fable += amt;
  });
  let changed = false;
  Object.keys(buckets).forEach(function (k) {
    const prev = usageHistory.days[k];
    if (!prev || prev.total !== buckets[k].total || prev.fable !== buckets[k].fable) {
      usageHistory.days[k] = buckets[k];
      changed = true;
    }
  });
  if (typeof usageHistory.lifetime !== 'number') usageHistory.lifetime = 0;
  Object.keys(usageHistory.days).forEach(function (k) {
    if (Date.parse(k) < now - 56 * 24 * 3600 * 1000) {
      // fold days aging out of the 56-day window into a monotonic lifetime
      // total, so the all-time figure survives even as detail is pruned
      usageHistory.lifetime += usageHistory.days[k].total;
      delete usageHistory.days[k]; changed = true;
    }
  });
  if (changed) {
    try { fs.writeFileSync(USAGE_HISTORY_FILE, JSON.stringify(usageHistory)); } catch (e) { }
  }
}

// All-time total tokens (in+out+cache-write): pruned lifetime + everything
// still in the 56-day history.
function allTimeTotal() {
  let t = (usageHistory.lifetime || 0);
  Object.keys(usageHistory.days).forEach(function (k) { t += usageHistory.days[k].total; });
  return t;
}

// ---- per-session running token counter (for the live "working" readout) ----
// Accumulate each session's cumulative in+out+cw as new assistant messages
// land in its transcript. We read the same 1MB tail per event and add any
// message id we haven't counted yet — since events fire many times per turn
// and messages append, we catch each one while it's still in the tail.
const sessionTokens = new Map();  // session_id -> cumulative tokens
const sessionSeenMsg = new Map(); // session_id -> Set(message id)

// Delegated work is charged like everything else, but the crew's tokens are
// written to their own diaries (see resolveSubagentInfo) — which this counter
// never opened. So a fan-out, the single most expensive thing a session does,
// barely moved the live readout. These files are append-only, so they're read
// incrementally by byte offset: only bytes that are new since the last pass are
// ever parsed, which is much cheaper than the main thread's tail re-read.
const subTokenFiles = new Map();  // "<main transcript>|<diary path>" -> { offset, leftover }
const subTokenScan = new Map();   // main transcript -> when its subagents/ dir was last listed
const SUB_TOKEN_SCAN_MS = 3000;   // events burst many times a second; the crew's spend can lag 3s
function addSubagentTokens(transcriptPath, seen) {
  const lastScan = subTokenScan.get(transcriptPath) || 0;
  if (Date.now() - lastScan < SUB_TOKEN_SCAN_MS) return 0;
  subTokenScan.set(transcriptPath, Date.now());
  const dir = path.join(String(transcriptPath).replace(/\.jsonl$/, ''), 'subagents');
  let names;
  try { names = fs.readdirSync(dir); } catch (e) { return 0; } // this session has never delegated
  let extra = 0;
  names.forEach(function (f) {
    if (!f.endsWith('.jsonl')) return;
    const p = path.join(dir, f);
    let st;
    try { st = fs.statSync(p); } catch (e) { return; }
    const key = transcriptPath + '|' + p;   // prefix keyed by transcript so forgetSession can sweep it
    let state = subTokenFiles.get(key);
    if (!state) { state = { offset: 0, leftover: '' }; subTokenFiles.set(key, state); }
    if (st.size < state.offset) { state.offset = 0; state.leftover = ''; } // file replaced/truncated
    if (st.size === state.offset) return;                                  // nothing appended
    try {
      const fd = fs.openSync(p, 'r');
      const buf = Buffer.alloc(st.size - state.offset);
      fs.readSync(fd, buf, 0, buf.length, state.offset);
      fs.closeSync(fd);
      state.offset = st.size;
      const chunk = state.leftover + buf.toString('utf8');
      const lines = chunk.split('\n');
      state.leftover = lines.pop();  // the last piece may still be mid-write
      lines.forEach(function (line) {
        if (!line.trim()) return;
        let o;
        try { o = JSON.parse(line); } catch (e) { return; }
        if (o.type !== 'assistant' || !o.message || !o.message.usage) return;
        // Shares the session's seen-ids set with the main thread. Diary message
        // ids are distinct from it, so nothing is double-counted either way.
        const id = o.message.id || o.requestId;
        if (id) { if (seen.has(id)) return; seen.add(id); }
        const u = o.message.usage;
        extra += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
      });
    } catch (e) { /* transient read error — the next pass picks it up */ }
  });
  return extra;
}

function updateSessionTokens(transcriptPath, sessionId) {
  if (!sessionId || !transcriptPath) return sessionTokens.get(sessionId) || 0;
  try {
    const stat = fs.statSync(transcriptPath);
    const readSize = Math.min(stat.size, TRANSCRIPT_TAIL_BYTES);
    const fd = fs.openSync(transcriptPath, 'r');
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n');
    let seen = sessionSeenMsg.get(sessionId);
    if (!seen) { seen = new Set(); sessionSeenMsg.set(sessionId, seen); }
    let total = sessionTokens.get(sessionId) || 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      let o;
      try { o = JSON.parse(line); } catch (e) { continue; }
      if (o.type === 'assistant' && !o.isSidechain && o.message && o.message.usage && o.message.id) {
        if (seen.has(o.message.id)) continue;
        seen.add(o.message.id);
        const u = o.message.usage;
        total += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
      }
    }
    total += addSubagentTokens(transcriptPath, seen); // the crew's spend counts too
    sessionTokens.set(sessionId, total);
    return total;
  } catch (e) { return sessionTokens.get(sessionId) || 0; }
}

// Rolling-7-day totals vs the heaviest COMPLETED prior week in history.
// The baseline deliberately EXCLUDES the current, in-progress week — else
// a busy current week becomes its own 100% ceiling and always reads "0%
// left" (the exact bug: on a fresh install the only week on record IS this
// week, so current == baseline == 100%). With the current week excluded,
// there is nothing to compare against until a real prior week exists, so
// `usedPct` stays null (client shows "building baseline", not a false 0%)
// until we actually have ~2 weeks of history. Real plan quotas aren't
// exposed locally, so this is a personal "vs your own busiest week" gauge,
// never an Anthropic-quota meter.
function weeklyStats() {
  const now = Date.now();
  const days = usageHistory.days;
  function sumWindow(endTs) {
    let t = 0, f = 0;
    for (let i = 0; i < 7; i++) {
      const d = days[dayKey(endTs - i * 86400000)];
      if (d) { t += d.total; f += d.fable; }
    }
    return { total: t, fable: f };
  }
  const cur = sumWindow(now);
  // heaviest window that ENDED at least 2 days ago (i.e. not the current week)
  let baseT = 0, baseF = 0;
  Object.keys(days).forEach(function (k) {
    const endTs = Date.parse(k) + 12 * 3600 * 1000;
    if (endTs > now - 2 * 86400000) return; // skip the current/near-current window
    const w = sumWindow(endTs);
    if (w.total > baseT) baseT = w.total;
    if (w.fable > baseF) baseF = w.fable;
  });
  const distinctDays = Object.keys(days).length;
  const calibrated = baseT > 0 && distinctDays >= 9; // a real prior week to compare against

  let resetDays = null, resetMs = null;
  if (calibrated && cur.total >= baseT * 0.95) {
    let running = cur.total;
    for (let i = 6; i >= 1; i--) {
      const d = days[dayKey(now - i * 86400000)];
      running -= d ? d.total : 0;
      if (running < baseT * 0.9) { resetDays = 7 - i; break; }
    }
    if (resetDays === null) resetDays = 7;
  }
  // give the auto-history estimate a ms countdown too, so the clock box's
  // weekly ↻ ticker has a target even without an anchor / real /usage
  if (resetDays != null) resetMs = resetDays * 86400000;
  // start from the historical "busiest prior week" gauge…
  let baselineW = baseT, baselineF = baseF, isCal = calibrated, source = 'history';
  let usedPctW = calibrated ? Math.min(100, Math.round(cur.total / baseT * 100)) : null;
  let usedPctF = (calibrated && baseF > 0) ? Math.min(100, Math.round(cur.fable / baseF * 100)) : null;

  // …but if the user anchored a real % from their account, that wins
  const calib = loadCalibration();
  if (calib && calib.weeklyPct > 0 && calib.weeklyTokens > 0) {
    const wl = calib.weeklyTokens / (calib.weeklyPct / 100);
    baselineW = Math.round(wl);
    usedPctW = Math.min(100, Math.round(cur.total / wl * 100));
    isCal = true;
    source = 'anchored';
    if (calib.fablePct > 0 && calib.fableTokens > 0) {
      const fl = calib.fableTokens / (calib.fablePct / 100);
      baselineF = Math.round(fl);
      usedPctF = Math.min(100, Math.round(cur.fable / fl * 100));
    }
    // exact weekly reset schedule (e.g. Friday 08:00) → real ms countdown,
    // preferred over the rough day estimate
    if (calib.resetDow != null) {
      const d = new Date(now);
      const hour = calib.resetHour != null ? calib.resetHour : 0;
      let delta = (calib.resetDow - d.getDay() + 7) % 7;
      const target = new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta, hour, 0, 0, 0);
      if (target.getTime() <= now) target.setDate(target.getDate() + 7); // already past today → next week
      resetMs = target.getTime() - now;
      resetDays = Math.max(1, Math.ceil(resetMs / 86400000));
    } else if (calib.resetDays != null) {
      resetDays = calib.resetDays;
      resetMs = calib.resetDays * 86400000;
    }
  }

  return {
    total: cur.total,
    baseline: baselineW,
    // null until calibrated → client renders "building baseline" instead of 0%
    usedPct: usedPctW,
    fable: {
      total: cur.fable,
      baseline: baselineF,
      usedPct: usedPctF,
    },
    resetDays: resetDays,
    resetMs: resetMs,
    calibrated: isCal,
    source: source,
    anchoredAt: calib ? calib.at : null,
    daysRecorded: distinctDays,
  };
}

function usageSummary() {
  refreshUsage();
  const now = Date.now();
  const h5 = now - 5 * 3600 * 1000;
  function bucket() { return { total: 0, in: 0, out: 0, cacheRead: 0, cacheWrite: 0, models: {} }; }
  const five = bucket(), week = bucket();
  let latest = null;
  usageEvents.forEach(function (e) {
    if (!latest || e.t > latest.t) latest = e;
    [week, e.t >= h5 ? five : null].forEach(function (b) {
      if (!b) return;
      b.in += e.in; b.out += e.out; b.cacheRead += e.cr; b.cacheWrite += e.cw;
      b.total += e.in + e.out + e.cw; // cache READS excluded — they'd dwarf everything
      const m = (b.models[e.model] = b.models[e.model] || { total: 0, out: 0 });
      m.total += e.in + e.out + e.cw;
      m.out += e.out;
    });
  });
  // current 5h block + auto-calibrated baseline (see computeBlocks)
  const blocks = computeBlocks();
  const last = blocks.length ? blocks[blocks.length - 1] : null;
  const active = last && now < last.end ? last : null; // between blocks = fresh window waiting
  let baseline = 0;
  blocks.forEach(function (b) { if (b !== active && b.total > baseline) baseline = b.total; });
  const curTotal = active ? active.total : 0;
  if (curTotal > baseline) baseline = curTotal;
  const block = {
    total: curTotal,
    baseline: baseline,
    usedPct: baseline > 0 ? Math.min(100, Math.round(curTotal / baseline * 100)) : 0,
    resetInMs: active ? active.end - now : null, // null = no active block, fresh window ready
    source: 'auto',
  };

  // 5-HOUR ANCHOR. The block above is reconstructed from LOCAL CLI transcripts
  // only, but the real 5-hour limit is account-wide (CLI + claude.ai web +
  // mobile + API), so the window's true first request can be invisible here —
  // the reconstructed reset/%'s can be way off (observed: 5h shown vs 20m
  // real). If the user anchors it (usage-calibration.json → fiveHour: {pct,
  // resetAt, tokensAt, at}), pin BOTH to that anchored window instead:
  //   - resetInMs counts down to resetAt, rolling +5h each time it passes
  //     (windows are ~back-to-back while you're active; re-anchor if idle long)
  //   - usedPct = live tokens in the anchored window vs the implied quota
  //     (tokensAt was that window's spend at the anchored pct), so it climbs
  //     with use and drops to a fresh low when the window rolls over.
  const calibFH = loadCalibration();
  if (calibFH && calibFH.fiveHour && calibFH.fiveHour.resetAt) {
    const fh = calibFH.fiveHour;
    let resetAt = fh.resetAt;
    while (resetAt <= now) resetAt += 5 * 3600000;
    const winStart = resetAt - 5 * 3600000;
    let winTokens = 0;
    usageEvents.forEach(function (e) { if (e.t >= winStart) winTokens += e.in + e.out + e.cw; });
    const quota = (fh.tokensAt > 0 && fh.pct > 0) ? fh.tokensAt / (fh.pct / 100) : 0;
    block.resetInMs = resetAt - now;
    block.total = winTokens;
    block.baseline = quota > 0 ? Math.round(quota) : block.baseline;
    block.usedPct = quota > 0 ? Math.min(100, Math.round(winTokens / quota * 100)) : fh.pct;
    block.source = 'anchored';
    block.anchoredAt = fh.at;
  }

  updateUsageHistory();

  const weekly = weeklyStats();

  // REAL /usage overrides the estimate while fresh — the true account numbers.
  const ru = realUsageFresh();
  if (ru) {
    if (ru.sessionPct != null) {
      block.usedPct = ru.sessionPct; block.source = 'real';
      const rms = sessionResetMs(ru.sessionReset);
      if (rms != null) block.resetInMs = rms;
      block.resetLabel = ru.sessionReset || null;
    }
    // calibrated must flip too: the client only renders percentages when
    // weekly.calibrated is set, and a fresh install (the phone) has neither
    // 9 days of history nor an anchor — but a REAL account % needs no local
    // baseline at all. Without this the true numbers sat in usedPct while
    // the panel stayed stuck on the "building baseline" token tallies.
    if (ru.weekPct != null) {
      weekly.usedPct = ru.weekPct; weekly.source = 'anchored'; weekly.calibrated = true; weekly.resetLabel = ru.weekReset || null;
      // real account reset label wins over the local day estimate when parseable
      const wrm = weekResetMs(ru.weekReset);
      if (wrm != null) { weekly.resetMs = wrm; weekly.resetDays = Math.max(1, Math.ceil(wrm / 86400000)); }
    }
    if (ru.fablePct != null) {
      if (!weekly.fable) weekly.fable = {};
      weekly.fable.usedPct = ru.fablePct; weekly.fable.resetLabel = ru.fableReset || null;
    }
  }

  return {
    five: five,
    week: week,
    block: block,
    weekly: weekly,
    allTimeTotal: allTimeTotal(),
    latest: latest ? { model: latest.model, effort: latest.effort, at: latest.t } : null,
    warning: liveUsageWarning(),
    real: !!ru,
    realAt: ru ? ru.at : null, // when the real /usage numbers last landed — clients detect fresh data / pulse the wall panels
    refreshedAt: usageLastRefresh,
  };
}

// ---- home-screen widget feed ----
// Compact, PRE-FORMATTED values for Android widget apps (KWGT etc.), which
// are much happier reading ".pctLeft" than doing math: one small JSON with
// display-ready strings for the usage bar, reset countdown, and who's
// online right now.
function fmtTokS(n) {
  n = n || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(n < 1e10 ? 1 : 0) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + 'k';
  return String(n);
}
function widgetSummary() {
  const u = usageSummary();
  const now = Date.now();
  const sessions = [];
  sessionCache.forEach(function (entry) {
    const le = entry.lastEvent;
    if (!le || le.hook_event_name === 'SessionEnd') return;
    sessions.push({
      project: String(le.cwd || 'unknown').replace(/[\\/]+$/, '').split(/[\\/]/).pop(),
      model: String(le.model || '?').replace(/^claude-/, ''),
      working: (now - (le._receivedAt || 0)) < 3 * 60 * 1000,
      agents: entry.subagents.size,
    });
  });
  const resetMin = u.block.resetInMs != null ? Math.max(0, Math.round(u.block.resetInMs / 60000)) : null;
  return {
    pctUsed: u.block.usedPct,
    pctLeft: Math.max(0, 100 - u.block.usedPct),
    weeklyPctLeft: (u.weekly && u.weekly.usedPct != null) ? Math.max(0, 100 - u.weekly.usedPct) : null,
    fablePctLeft: (u.weekly && u.weekly.fable && u.weekly.fable.usedPct != null) ? Math.max(0, 100 - u.weekly.fable.usedPct) : null,
    resetsIn: resetMin != null ? (resetMin >= 60 ? Math.floor(resetMin / 60) + 'h ' + (resetMin % 60) + 'm' : resetMin + 'm') : 'ready',
    blockTokens: fmtTokS(u.block.total),
    baseline: fmtTokS(u.block.baseline),
    weekTokens: fmtTokS(u.week.total),
    model: u.latest ? String(u.latest.model).replace(/^claude-/, '') : null,
    effort: u.latest ? (u.latest.effort || null) : null,
    online: sessions.length,
    sessions: sessions,
    warning: liveUsageWarning() ? liveUsageWarning().text : null,
    at: now,
  };
}

// ---- live snapshot (for home-screen image widgets) ----
// GET /snapshot.png serves a recent PNG of the first office, rendered by
// snapshot.js (headless Chromium). The child is spawned lazily on first
// request and kills itself ~25 min after the last one (keepalive file), so
// nothing heavy runs unless a widget is actually pulling images.
const SNAPSHOT_PNG = path.join(PUBLIC_DIR, 'snapshot.png');
const SNAPSHOT_KEEPALIVE = path.join(PUBLIC_DIR, '.snapshot-keepalive');
let snapshotChild = null;
function ensureSnapshotter() {
  try { fs.writeFileSync(SNAPSHOT_KEEPALIVE, String(Date.now())); } catch (e) { }
  if (snapshotChild) return;
  try {
    snapshotChild = spawn(process.execPath, [path.join(__dirname, 'snapshot.js')], { stdio: 'ignore' });
    snapshotChild.on('exit', function () { snapshotChild = null; });
    snapshotChild.on('error', function () { snapshotChild = null; });
  } catch (e) { snapshotChild = null; }
}

function serveStatic(req, res) {
  // Strip the query string FIRST, then default to index.html — so a root URL
  // carrying a query (e.g. /?only=command-deck for the deck's office filter)
  // still serves the dashboard instead of 404-ing on the directory.
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, reqPath);
  // trailing separator required — otherwise a sibling dir like "public-x"
  // would also pass startsWith(PUBLIC_DIR)
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, function (err, data) {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    // no-cache = always revalidate. Without this, phones held on to a stale
    // index.html through UI updates (confirmed via a user screenshot showing
    // a long-fixed bubble bug) — heuristic caching with no validator at all.
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' };
    // SECURITY (anti-clickjacking): the deck's pages carry live approval
    // buttons (a tap answers a real Claude prompt / kills a session). Allow
    // ONLY same-origin framing (deck.html embeds the office view, index.html,
    // in its own iframe) and forbid any other site from framing them, so a
    // hostile page can't overlay an invisible deck and trick you into tapping
    // through a UI-redress attack.
    if (ext === '.html') {
      headers['X-Frame-Options'] = 'SAMEORIGIN';
      headers['Content-Security-Policy'] = "frame-ancestors 'self'";
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}

// SECURITY: reject requests whose Host header isn't loopback (DNS-rebinding
// defense — a malicious site that re-points its domain at 127.0.0.1 would
// otherwise pass the remoteAddress loopback checks AND, being same-origin,
// read the responses). In LAN mode the user opted into network exposure, so
// any Host is allowed there. Applied before routing.
function hostAllowed(req) {
  if (LAN) return true;
  const h = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h === '';
}
// SECURITY: side-effect endpoints require a custom header the deck sends but a
// cross-origin page cannot add without triggering a CORS preflight that fails
// (we send no CORS headers) — this is the CSRF defense for /deck/key, kill, attach.
function deckHeaderOk(req) { return String(req.headers['x-deck'] || '') === '1'; }

const server = http.createServer(function (req, res) {
  if (!hostAllowed(req)) { res.writeHead(403); res.end('bad host'); return; }
  if (req.method === 'POST' && req.url === '/event') {
    // SECURITY: /event is the unauthenticated hook receiver, but a real Claude
    // Code hook (and the curl launch wrapper) is a SERVER-side POST with NO
    // Origin header — a browser fetch always sends one. So reject a POST that
    // carries a cross-origin Origin. This closes the forged-event chain: a web
    // page you visit could otherwise POST a fake "Notification" event, which
    // convoLiteProbe turns into a "Claude is asking" notification whose Approve
    // button injects a keystroke into your real terminal (the CSRF header never
    // guarded this — your own trusted service worker supplies it). The deck
    // browser never legitimately POSTs /event, so this breaks nothing.
    const oev = req.headers.origin;
    if (oev && !LAN) {
      let ok = false;
      try {
        const u = new URL(oev), h = u.hostname.toLowerCase();
        ok = (h === 'localhost' || h === '127.0.0.1' || h === '::1')
          && String(u.port || (u.protocol === 'https:' ? '443' : '80')) === String(PORT);
      } catch (e) { ok = false; }
      if (!ok) { res.writeHead(403); res.end('bad origin'); return; }
    }
    let body = '';
    req.on('data', function (chunk) {
      body += chunk;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', function () {
      let evt;
      try { evt = JSON.parse(body || '{}'); } catch (e) { evt = { raw: body }; }
      evt._receivedAt = Date.now();
      // SECURITY: /event is unauthenticated, and transcript_path is later
      // fed to statSync/openSync. Confine it to the real transcript root so a
      // forged event can't turn the server into an arbitrary file reader /
      // existence oracle. Anything outside is dropped (event still processes,
      // just without transcript-derived text). Real hooks always point here.
      if (evt.transcript_path) {
        try {
          const root = path.join(os.homedir(), '.claude', 'projects');
          const p = path.resolve(String(evt.transcript_path));
          if (p !== root && !p.startsWith(root + path.sep)) delete evt.transcript_path;
        } catch (e) { delete evt.transcript_path; }
      }
      // The hidden usage-poller runs its own claude session; drop its events so
      // it never shows up as an office (it exists only to scrape /usage).
      if (evt.cwd && String(evt.cwd).replace(/[\\/]+$/, '').split(/[\\/]/).pop() === 'usagepoll') {
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true,"hidden":true}'); return;
      }
      // The `claude` wrapper's opener SessionStart carries the deck tag and
      // pins the same session id claude runs under, so opener and real events
      // share a session with no folder-matching. Claude's own hooks don't
      // carry deckTab, so remember it per session and stamp it on every later
      // event — the cached lastEvent (what a fresh page load replays) then
      // always has the tag, so per-tab office views survive a reload.
      if (evt.session_id) {
        if (evt.deckTab) {
          // delete-then-set refreshes insertion order, so live sessions never
          // age to the front of the eviction line
          sessionDeckTab.delete(evt.session_id);
          sessionDeckTab.set(evt.session_id, evt.deckTab);
          if (sessionDeckTab.size > DECK_TAB_MAX) sessionDeckTab.delete(sessionDeckTab.keys().next().value);
          saveDeckTabs();
        } else if (sessionDeckTab.has(evt.session_id)) evt.deckTab = sessionDeckTab.get(evt.session_id);
        else if (evt.transcript_path && !evt.agent_id) {
          // Untagged main-thread session: /clear, /compact or a forked resume
          // minted this id inside an already-running tab, so no opener ever
          // claimed it. Re-learn the tab from the transcript (see healDeckTab)
          // and promote it to a real mapping, so every later event — and the
          // cached lastEvent a page load replays — carries the tag. Runs before
          // cacheEvent below, so recordSessionMeta persists the tab too.
          // Subagents are skipped: they ride the parent's session id and inherit
          // the tag from the branch above once the parent heals.
          const healed = healDeckTab(evt.session_id, evt.transcript_path, evt.cwd);
          if (healed) {
            evt.deckTab = healed;
            sessionDeckTab.delete(evt.session_id);
            sessionDeckTab.set(evt.session_id, healed);
            if (sessionDeckTab.size > DECK_TAB_MAX) sessionDeckTab.delete(sessionDeckTab.keys().next().value);
            saveDeckTabs();
          }
        }
      }
      if (!evt.agent_id && evt.transcript_path) {
        const info = resolveTranscriptInfo(evt.transcript_path);
        if (!evt.model && info.model) evt.model = info.model;
        // remember what the clients have seen, so the ModelTick ticker only
        // fires on an actual CHANGE, not on every 2s pass
        if (evt.model) modelSent.set(evt.session_id, evt.model);
        // Attach speech only when it's NEW for this session (see speechSent) —
        // otherwise every later tool event re-carries the same stale quote.
        if (info.text && speechSent.get(evt.session_id) !== info.text) {
          evt._speech = info.text;
          speechSent.set(evt.session_id, info.text);
        }
        // per-session running token total for the live "working" counter
        evt._sessionTokens = updateSessionTokens(evt.transcript_path, evt.session_id);
      } else if (evt.agent_id && evt.transcript_path) {
        // A subagent's hook: read the agent's OWN diary for the words it just
        // wrote and the type the harness assigned it. The type is set even when
        // the event already claims one — cacheEvent's FIFO fallback is a guess
        // that only fills in when this finds nothing, so a fan-out stops
        // handing the wrong codename to the wrong teammate.
        // Model is deliberately NOT stamped: maybeSetModel would swap the
        // crew's profession face for a per-model one, and their profession is
        // who they are on the floor.
        const si = resolveSubagentInfo(evt.transcript_path, evt.agent_id);
        if (si) {
          if (si.agentType) evt.agent_type = si.agentType;
          const skey = speechKey(evt.session_id, evt.agent_id);
          if (si.text && speechSent.get(skey) !== si.text) {
            evt._speech = si.text;
            speechSent.set(skey, si.text);
          }
        }
      }
      cacheEvent(evt);
      broadcast(evt);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // Pocket Deck: CONVO attachments — save an image into ~/.deck/attach and
  // return its absolute path. The composer puts that path in the prompt, the
  // same trick as dragging a file onto the terminal: Claude Reads it as an
  // image. Loopback-only; the deck and claude run on the same device.
  if (req.method === 'POST' && req.url === '/deck/attach') {
    const raA = req.socket.remoteAddress || '';
    if (!(raA === '127.0.0.1' || raA === '::1' || raA === '::ffff:127.0.0.1') || !deckHeaderOk(req)) { res.writeHead(403); res.end('{"ok":false}'); return; }
    const chunks = []; let size = 0;
    req.on('data', function (c) { size += c.length; if (size > 15e6) req.destroy(); else chunks.push(c); });
    req.on('end', function () {
      try {
        const dir = path.join(os.homedir(), '.deck', 'attach');
        fs.mkdirSync(dir, { recursive: true });
        const name = (String(req.headers['x-filename'] || 'image.jpg').replace(/[^\w.\-]/g, '_').slice(-60)) || 'image.jpg';
        const file = path.join(dir, Date.now() + '_' + name);
        fs.writeFileSync(file, Buffer.concat(chunks));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: file, name: name }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e && e.message) }));
      }
    });
    return;
  }

  // Pocket Deck: hand the deck page the terminal (ttyd) credential. Same
  // origin as deck.html, loopback-only, and NO CORS headers — so a hostile
  // cross-origin page cannot read the response and therefore can't learn the
  // secret needed to open the terminal socket (the CSWSH fix). The secret is
  // a per-install random string written by deck-start into ~/.deck/ttyd-secret.
  if (req.method === 'GET' && req.url === '/deck/ttyd-token') {
    const raT = req.socket.remoteAddress || '';
    if (!(raT === '127.0.0.1' || raT === '::1' || raT === '::ffff:127.0.0.1')) { res.writeHead(403); res.end(); return; }
    let tok = '';
    try {
      const sec = fs.readFileSync(path.join(os.homedir(), '.deck', 'ttyd-secret'), 'utf8').trim();
      if (sec) tok = Buffer.from('deck:' + sec).toString('base64');
    } catch (e) { /* no secret yet (e.g. desktop / not set up) — empty token */ }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ token: tok }));
    return;
  }

  // Pocket Deck: answer a TUI prompt from OUTSIDE the page — the CONVO
  // approval notification's action buttons land here (service worker fetch),
  // and the key is typed straight into the tab's tmux session, so approving
  // works even when the deck isn't open. Loopback-only, strict whitelists.
  if ((req.method === 'GET' || req.method === 'POST') && req.url.split('?')[0] === '/deck/key') {
    const raK = req.socket.remoteAddress || '';
    const localK = raK === '127.0.0.1' || raK === '::1' || raK === '::ffff:127.0.0.1';
    const qk = new URL(req.url, 'http://localhost').searchParams;
    const sessK = /^deck-\d{1,4}$/.test(qk.get('session') || '') ? qk.get('session') : null;
    const rawKey = String(qk.get('key') || '').toLowerCase();
    const KEYMAP = { esc: 'Escape', enter: 'Enter', y: 'y', n: 'n', '1': '1', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9' };
    if (!localK || !deckHeaderOk(req) || !sessK || !KEYMAP[rawKey]) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end('{"ok":false}'); return; }
    spawn('tmux', ['send-keys', '-t', sessK, KEYMAP[rawKey]], { stdio: 'ignore' }).on('error', function () {});
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }

  // Pocket Deck: closing a deck tab ENDS its tmux session — a deleted tab
  // must not keep a hidden Claude running (and haunting the office).
  // Loopback-only and strictly deck-N names, so nothing on the network can
  // kill sessions; on machines without tmux this just fails silently.
  if (req.method === 'POST' && req.url.split('?')[0] === '/deck/kill') {
    const ra = req.socket.remoteAddress || '';
    const local = ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1';
    const m = /[?&]session=(deck-\d{1,4})(?:&|$)/.exec(req.url);
    if (!local || !deckHeaderOk(req) || !m) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end('{"ok":false}'); return; }
    spawn('tmux', ['kill-session', '-t', m[1]], { stdio: 'ignore' }).on('error', function () {});
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }

  // Pocket Deck: enumerate the live deck-N tmux sessions so the page can find and
  // clean up STALE ones — sessions orphaned when the app was closed mid-farewell,
  // or created by a divergent container that no tab list references. Loopback +
  // X-Deck, same posture as /deck/kill; read-only. On a machine without tmux (a
  // bare desktop / PC), with no tmux server running, or on any spawn/parse/timeout
  // failure, this degrades to an empty list — NEVER a 500 — so the deck's cleanup
  // UI simply shows "no sessions" instead of erroring.
  if (req.method === 'GET' && req.url.split('?')[0] === '/deck/sessions') {
    const raS = req.socket.remoteAddress || '';
    const localS = raS === '127.0.0.1' || raS === '::1' || raS === '::ffff:127.0.0.1';
    if (!localS || !deckHeaderOk(req)) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end('{"ok":false}'); return; }
    let settled = false;
    let to = null;
    const done = function (sessions) {
      if (settled) return;
      settled = true;
      if (to) clearTimeout(to);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, sessions: sessions || [] }));
    };
    let ls;
    try {
      ls = spawn('tmux', ['list-sessions', '-F', '#{session_name}|#{session_attached}|#{session_activity}|#{session_created}'], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) { done([]); return; }   // spawn threw synchronously (no tmux)
    to = setTimeout(function () { try { ls.kill(); } catch (e) {} done([]); }, 3000);
    ls.on('error', function () { done([]); });   // tmux binary missing (e.g. PC)
    let out = '';
    ls.stdout.on('data', function (chunk) { out += chunk.toString(); });
    ls.on('close', function (code) {
      if (code !== 0) { done([]); return; }   // non-zero (e.g. "no server running")
      let sessions = [];
      try {
        out.split('\n').forEach(function (line) {
          line = line.trim();
          if (!line) return;
          const parts = line.split('|');
          const name = parts[0];
          if (name === 'usagepoll') return;   // exclude the usage poller (belt-and-braces; the regex below already excludes it)
          if (!/^deck-\d{1,4}$/.test(name)) return;
          sessions.push({
            name: name,
            attached: parseInt(parts[1], 10) || 0,
            activity: parseInt(parts[2], 10) || 0,
            created: parseInt(parts[3], 10) || 0
          });
        });
      } catch (e) { done([]); return; }   // parse failure
      done(sessions);
    });
    return;
  }

  // Pocket Deck: nudge the usage poller to capture fresh /usage NOW. The phone
  // already runs a poller that watches ~/.deck/usage-poke — touching that file
  // makes it run `claude usage` and POST the raw screen to /api/realusage
  // within seconds, so the wall monitors refresh on demand instead of on the
  // poller's ~3-min cadence. Loopback + X-Deck, same posture as /deck/attach.
  // On a device with no poller (bare desktop) the file is written but nothing
  // consumes it — a graceful no-op; realAt simply won't advance.
  if (req.method === 'POST' && req.url === '/api/usage-poke') {
    const rp = req.socket.remoteAddress || '';
    if (!(rp === '127.0.0.1' || rp === '::1' || rp === '::ffff:127.0.0.1') || !deckHeaderOk(req)) { res.writeHead(403); res.end('{"ok":false}'); return; }
    let poked = false;
    try {
      const dir = path.join(os.homedir(), '.deck');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'usage-poke'), String(Date.now()));
      poked = true;
    } catch (e) { poked = false; }
    const ru = realUsageFresh();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, poked: poked, realAt: ru ? ru.at : null }));
    return;
  }

  if (req.method === 'GET' && req.url.split('?')[0] === '/snapshot.png') {
    ensureSnapshotter();
    fs.readFile(SNAPSHOT_PNG, function (err, data) {
      if (err) {
        res.writeHead(503, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-cache', 'Retry-After': '10' });
        res.end('warming up — try again in ~10s');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
    return;
  }

  // The deck's claude wrapper reads this at launch to restore the previous
  // session's permission mode (auto-accept doesn't persist across sessions
  // on its own — Claude always boots back into manual).
  if (req.method === 'GET' && req.url === '/api/lastmode') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ mode: _lastPermMode }));
    return;
  }

  if (req.method === 'GET' && req.url === '/api/widget') {
    let summary;
    try { summary = widgetSummary(); } catch (e) { summary = { error: String(e && e.message) }; }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify(summary));
    return;
  }

  // The usage poller POSTs the raw /usage screen here; we parse it and, while
  // fresh, the real numbers override the estimated monitors. Loopback only.
  if (req.method === 'POST' && req.url === '/api/realusage') {
    const ra = req.socket.remoteAddress || '';
    if (!(ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1')) { res.writeHead(403); res.end(); return; }
    // SECURITY: like /event, this is a server-side POST (the usage poller uses
    // curl, which sends NO Origin). A browser fetch always sends one, so a
    // cross-origin Origin means a web page you visited is trying to poison the
    // usage monitors (a "simple" text/plain POST needs no preflight, and the
    // loopback check alone doesn't stop it). Reject any cross-origin Origin.
    const oru = req.headers.origin;
    if (oru && !LAN) {
      let ok = false;
      try {
        const u = new URL(oru), h = u.hostname.toLowerCase();
        ok = (h === 'localhost' || h === '127.0.0.1' || h === '::1')
          && String(u.port || (u.protocol === 'https:' ? '443' : '80')) === String(PORT);
      } catch (e) { ok = false; }
      if (!ok) { res.writeHead(403); res.end('bad origin'); return; }
    }
    let body = '';
    req.on('data', function (c) { body += c; if (body.length > 2e5) req.destroy(); });
    req.on('end', function () {
      let raw = body;
      try { const j = JSON.parse(body); if (j && (j.text || j.raw)) raw = j.text || j.raw; } catch (e) { /* raw text body */ }
      const parsed = parseUsageText(raw);
      if (parsed) {
        _realUsage = parsed;
        try { fs.writeFileSync(REAL_USAGE_FILE, JSON.stringify(parsed)); } catch (e) { /* best-effort */ }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: !!parsed, parsed: parsed || null }));
    });
    return;
  }

  // Pocket Deck: self-serve usage calibration. A fresh install has no prior
  // week to compare against — the auto weekly % needs ~9 days of local history
  // AND a heavier previous week, which the phone won't have for weeks — so the
  // WEEKLY panel is stuck on raw token tallies ("7d 4.9M · 3d") with no
  // percentage. This lets the user read their REAL percentages off Claude's own
  // /usage screen and anchor the panels to them: the server captures the
  // CURRENT token totals and pairs each with the reported %, implying a quota
  // the live tallies then track against (exactly the usage-calibration.json
  // format weeklyStats()/the 5-hour block already read). Merges with any
  // existing anchor so setting the weekly doesn't wipe a 5-hour one. Guarded
  // loopback + Origin like /api/realusage — a "simple" text/plain POST needs no
  // preflight, so the loopback check alone wouldn't stop a cross-origin page.
  if (req.method === 'POST' && req.url === '/api/calibrate') {
    const ra = req.socket.remoteAddress || '';
    if (!(ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1')) { res.writeHead(403); res.end(); return; }
    const oc = req.headers.origin;
    if (oc && !LAN) {
      let ok = false;
      try {
        const u = new URL(oc), h = u.hostname.toLowerCase();
        ok = (h === 'localhost' || h === '127.0.0.1' || h === '::1')
          && String(u.port || (u.protocol === 'https:' ? '443' : '80')) === String(PORT);
      } catch (e) { ok = false; }
      if (!ok) { res.writeHead(403); res.end('bad origin'); return; }
    }
    let body = '';
    req.on('data', function (c) { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', function () {
      let j = {};
      try { j = JSON.parse(body) || {}; } catch (e) { j = {}; }
      // clear: wipe the anchor, back to auto/learning-phase display
      if (j.clear) {
        try { fs.unlinkSync(CALIB_FILE); } catch (e) { /* already gone */ }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true,"cleared":true}');
        return;
      }
      const num = function (v) { const n = parseFloat(v); return isFinite(n) ? n : 0; };
      const u = usageSummary();
      const now = Date.now();
      const wPct = num(j.weeklyPct), fPct = num(j.fablePct), hPct = num(j.fiveHourPct);
      const wTok = (u.weekly && u.weekly.total) || 0;                          // raw 7-day total
      const fTok = (u.weekly && u.weekly.fable && u.weekly.fable.total) || 0;  // raw fable 7-day
      const hTok = (u.five && u.five.total) || 0;                              // raw last-5h total
      let prev = {};
      try { prev = JSON.parse(fs.readFileSync(CALIB_FILE, 'utf8')) || {}; } catch (e) { prev = {}; }
      const calib = Object.assign({}, prev, { at: now });
      if (wPct > 0 && wPct <= 100 && wTok > 0) { calib.weeklyPct = wPct; calib.weeklyTokens = wTok; }
      if (fPct > 0 && fPct <= 100 && fTok > 0) { calib.fablePct = fPct; calib.fableTokens = fTok; }
      if (num(j.weeklyResetDays) > 0) {
        calib.resetDays = Math.round(num(j.weeklyResetDays));
        // an explicit "resets in N days" wins over a precise weekday schedule
        // that a prior real-/usage anchor may have left behind (resetDow wins
        // in weeklyStats otherwise, silently ignoring the number just entered)
        delete calib.resetDow; delete calib.resetHour;
      }
      if (hPct > 0 && hPct <= 100 && hTok > 0) {
        const mins = num(j.fiveHourResetMins);
        calib.fiveHour = { pct: hPct, tokensAt: hTok, resetAt: now + (mins > 0 ? mins : 300) * 60000, at: now };
      }
      if (!(calib.weeklyPct > 0) && !(calib.fiveHour && calib.fiveHour.pct > 0)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end('{"ok":false,"error":"enter a weekly % (or a 5-hour %) — at least one is required"}');
        return;
      }
      let ok = false;
      try { fs.writeFileSync(CALIB_FILE, JSON.stringify(calib, null, 2)); ok = true; } catch (e) { /* best-effort */ }
      res.writeHead(ok ? 200 : 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: ok, calib: calib, captured: { weeklyTokens: wTok, fableTokens: fTok, fiveHourTokens: hTok } }));
    });
    return;
  }

  // CONVO chat history: incremental transcript reads by byte offset.
  // ?tab=deck-N       which deck tab's session
  // ?from=<bytes>     resume offset from the previous poll (omit = fresh tail)
  // ?tpath=<path>     the transcript the offset belongs to — a mismatch
  //                   (new session, /clear, --resume) forces a fresh tail
  if (req.method === 'GET' && req.url.split('?')[0] === '/api/chat') {
    const q = new URL(req.url, 'http://localhost').searchParams;
    const tab = q.get('tab') || '';
    const reply = function (o) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(o));
    };
    const found = chatSessionForTab(tab);
    const status = chatStatusFromEvent(found ? found.lastEvent : null);
    if (found && found.ended) status.state = 'ended';
    const tpath = found && found.lastEvent.transcript_path ? found.lastEvent.transcript_path : null;
    if (!found || !tpath) {
      // no claude session on this tab yet (or only the wrapper's synthetic opener)
      reply({ ok: true, tab: tab, session: found ? found.sid : null, tpath: null, from: 0, reset: true, truncated: false, messages: [], status: status });
      return;
    }
    let stat;
    try { stat = fs.statSync(tpath); } catch (e) {
      reply({ ok: true, tab: tab, session: found.sid, tpath: null, from: 0, reset: true, truncated: false, messages: [], status: status });
      return;
    }
    // lite=1: status only, no transcript read — the page polls this while
    // hidden so away-notifications stay cheap
    if (q.get('lite') === '1') {
      status.model = found.lastEvent.model || null;
      status.permMode = chatPermMode.get(found.sid) || found.lastEvent.permission_mode || null;
      reply({ ok: true, tab: tab, session: found.sid, tpath: tpath, lite: true, messages: [], status: status });
      return;
    }
    const clientPath = q.get('tpath') || '';
    let from = parseInt(q.get('from') || '', 10);
    // fresh tail when: first poll, offset invalid, transcript changed, or file shrank
    const reset = !(from >= 0) || clientPath !== tpath || from > stat.size;
    let start = reset ? Math.max(0, stat.size - CHAT_FIRST_READ_BYTES) : from;
    let truncated = reset && start > 0;
    let messages = [], nextFrom = start;
    if (stat.size > start) {
      let buf = Buffer.alloc(stat.size - start), fd = null, read = 0;
      try {
        fd = fs.openSync(tpath, 'r');
        read = fs.readSync(fd, buf, 0, buf.length, start);
      } catch (e) { read = 0; }
      if (fd !== null) { try { fs.closeSync(fd); } catch (e) { } }
      let text = buf.slice(0, read).toString('utf8');
      let consumed = 0;
      if (reset && start > 0) {
        // started mid-file: drop the partial first line (also heals mid-UTF-8)
        const nl = text.indexOf('\n');
        if (nl === -1) text = ''; else { text = text.slice(nl + 1); }
      }
      // parse only COMPLETE lines — a '\n' byte never occurs inside a
      // multibyte UTF-8 sequence, so byte offsets stay valid boundaries
      const lastNl = text.lastIndexOf('\n');
      if (lastNl === -1) {
        nextFrom = reset ? start : from; // nothing complete yet
        text = '';
      } else {
        consumed = Buffer.byteLength(text.slice(0, lastNl + 1), 'utf8');
        nextFrom = start + (reset && start > 0 ? (read - Buffer.byteLength(text, 'utf8')) : 0) + consumed;
        text = text.slice(0, lastNl);
      }
      if (text) {
        const parsed = parseChatLines(text.split('\n'));
        messages = parsed.messages;
        if (parsed.effort) chatEffort.set(found.sid, parsed.effort);
        if (parsed.permMode) chatPermMode.set(found.sid, parsed.permMode);
      }
      if (messages.length > 200) { messages = messages.slice(-200); truncated = true; }
    }
    // current session state for the CONVO control pills
    status.model = found.lastEvent.model || null;
    status.effort = chatEffort.get(found.sid) || null;
    status.permMode = chatPermMode.get(found.sid) || found.lastEvent.permission_mode || null;
    // live token counter for the "Claude is working" ticker — refresh from the
    // transcript only while actually working (tail read isn't free), cached
    // total otherwise
    status.tokens = status.state === 'working'
      ? updateSessionTokens(tpath, found.sid)
      : (sessionTokens.get(found.sid) || 0);
    reply({ ok: true, tab: tab, session: found.sid, tpath: tpath, from: nextFrom, reset: reset, truncated: truncated, messages: messages, status: status });
    return;
  }

  if (req.method === 'GET' && req.url === '/api/usage') {
    let summary;
    try { summary = usageSummary(); } catch (e) { summary = { error: String(e && e.message) }; }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify(summary));
    return;
  }

  if (req.method === 'GET' && req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('\n');
    replaySnapshot(res);
    sseClients.push(res);
    const heartbeat = setInterval(function () { res.write(': hb\n\n'); }, 25000);
    req.on('close', function () {
      clearInterval(heartbeat);
      sseClients = sseClients.filter(function (c) { return c !== res; });
    });
    return;
  }

  if (req.method === 'GET') {
    serveStatic(req, res);
    return;
  }

  res.writeHead(405);
  res.end();
});

// ---- terminal WebSocket proxy (CSWSH fix #1-v2) ----
// The deck connects its terminal to officebot (SAME origin, port 4317) at
// /tty instead of straight to ttyd. officebot enforces the same Host + Origin
// checks as every other request, then forwards to ttyd on loopback, injecting
// the Basic-Auth header a browser WebSocket cannot send. ttyd runs with that
// credential (-c), so a hostile page connecting DIRECTLY to ttyd:7681 is
// rejected (no auth), and a hostile page connecting to /tty is rejected here
// (cross-origin). Only the same-origin deck gets through.
server.on('upgrade', function (req, socket, head) {
  function drop() { try { socket.destroy(); } catch (e) {} }
  if (req.url.split('?')[0] !== '/tty') return drop();
  if (!hostAllowed(req)) return drop();
  // the ?arg= becomes ttyd's tmux session name — restrict to deck-N so nothing
  // odd reaches `tmux new -A -s <arg>` (defense-in-depth; reaching here already
  // needs same-origin and only grants a shell you already have).
  //
  // SECURITY: ttyd runs with -a (URL args), and `tmux new -A -s <name> <cmd…>`
  // RUNS any tokens after the session name as a command when that session
  // doesn't exist. A single validated arg= is NOT enough: URLSearchParams /
  // the old first-match regex both accept `?arg=deck-1&arg=<injected>` and the
  // proxy used to forward the RAW query, so the SECOND arg reached tmux and
  // executed. Parse every arg=, require EXACTLY ONE, matching deck-N, and
  // forward a query we REBUILD ourselves from that clean value — never the
  // caller's raw string. (Verified: `?arg=deck-1&arg=touch …` now dropped.)
  let cleanSess = null;
  try {
    const qp = new URL(req.url, 'http://localhost').searchParams;
    const all = qp.getAll('arg');
    if (all.length === 1 && /^deck-\d{1,4}$/.test(all[0])) cleanSess = all[0];
  } catch (e) { cleanSess = null; }
  if (!cleanSess) return drop();
  // Require a TRUE same-origin WS handshake (this is the CSWSH defense on our
  // own endpoint). Tightened after review: a browser ALWAYS sends Origin on a
  // WS upgrade, so a MISSING Origin is not a real deck — reject it (previously
  // it was allowed, letting a native app that omits Origin through). Also
  // require the Origin's port to match ours, not just any localhost port, so a
  // page from some other local server can't connect either. LAN mode relaxes.
  // (Caveat, documented in SECURITY: a malicious *native app* on the device can
  // forge any Origin — localhost HTTP can't tell it apart from the browser.
  // Header checks stop hostile web PAGES, not co-resident apps.)
  if (!LAN) {
    const orig = String(req.headers.origin || '');
    if (!orig) return drop();
    let ou = null;
    try { ou = new URL(orig); } catch (e) { return drop(); }
    const oh = ou.hostname.toLowerCase();
    const okHost = oh === 'localhost' || oh === '127.0.0.1' || oh === '::1';
    const op = ou.port || (ou.protocol === 'https:' ? '443' : '80');
    if (!okHost || String(op) !== String(PORT)) return drop();
  }
  let secret = '';
  try { secret = fs.readFileSync(path.join(os.homedir(), '.deck', 'ttyd-secret'), 'utf8').trim(); } catch (e) { /* none = ttyd has no -c */ }
  const up = net.connect(TTYD_PORT, '127.0.0.1');
  up.on('connect', function () {
    // Rebuild the query from the ONE validated session name — never echo the
    // caller's raw query (which could smuggle a second arg= into tmux). See
    // the cleanSess validation above.
    const out = ['GET /ws?arg=' + encodeURIComponent(cleanSess) + ' HTTP/1.1'];
    // forward the client's handshake headers verbatim (so ttyd's computed
    // Sec-WebSocket-Accept matches the client's key), swapping Host and
    // adding the credential the browser couldn't.
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const k = req.rawHeaders[i], v = req.rawHeaders[i + 1];
      const lk = k.toLowerCase();
      if (lk === 'host' || lk === 'authorization') continue;
      out.push(k + ': ' + v);
    }
    out.push('Host: 127.0.0.1:' + TTYD_PORT);
    if (secret) out.push('Authorization: Basic ' + Buffer.from('deck:' + secret).toString('base64'));
    out.push('', '');
    up.write(out.join('\r\n'));
    if (head && head.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  up.on('error', drop);
  socket.on('error', function () { try { up.destroy(); } catch (e) {} });
});

server.on('error', function (err) {
  if (err && err.code === 'EADDRINUSE') {
    console.error('\n  Port ' + PORT + ' is already in use.');
    console.error('  officebot may already be running — try opening http://localhost:' + PORT);
    console.error('  or start on another port:  officebot --port ' + (Number(PORT) + 1) + '\n');
    process.exit(1);
  }
  console.error('agent-viz server error:', err && err.message ? err.message : err);
  process.exit(1);
});
// AGENT_VIZ_HOST restricts the bind address. SECURITY: default to loopback
// (127.0.0.1) — there is NO authentication on the read endpoints, so binding
// to all interfaces would expose your conversations, bash commands and file
// paths to everyone on the same Wi-Fi. LAN viewing is now opt-in: set
// AGENT_VIZ_HOST=0.0.0.0 (or `officebot --host 0.0.0.0`) only on a trusted
// network. '*'/'all' are accepted as friendly aliases for 0.0.0.0.
let HOST = process.env.AGENT_VIZ_HOST || '127.0.0.1';
if (HOST === '*' || HOST === 'all' || HOST === 'lan') HOST = '0.0.0.0';
const LAN = HOST === '0.0.0.0' || HOST === '::';
server.listen(PORT, HOST, function () {
  console.log('officebot dashboard: http://localhost:' + PORT + ' (bound to ' + HOST + ')');
  console.log('Hook endpoint:       http://localhost:' + PORT + '/event');
  if (LAN) console.log('  ⚠ LAN mode: no authentication — only use this on a network you trust.');
});
