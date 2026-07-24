'use strict';
// Agent Viz — zero-dependency local dashboard for Claude Code hook events.
// Receives hook POSTs at /event, fans them out live to browser clients via SSE at /events.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

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

function cacheEvent(evt) {
  const sid = evt.session_id || 'unknown-session';
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
    if (entry.expireTimer) clearTimeout(entry.expireTimer);
    if (evt.hook_event_name === 'SessionEnd') {
      // Drop the ended session's subagents from the snapshot now, so a page
      // loaded during the grace window doesn't replay their last (active)
      // events AFTER the SessionEnd and resurrect them as "working." The
      // office replays as closing (lastEvent = SessionEnd) until it's evicted.
      entry.subagents.clear();
      entry.expireTimer = setTimeout(function () { sessionCache.delete(sid); speechSent.delete(sid); modelSent.delete(sid); sessionTokens.delete(sid); sessionSeenMsg.delete(sid); }, CACHE_GRACE_MS);
    }
  }
}

function replaySnapshot(res) {
  sessionCache.forEach(function (entry) {
    if (entry.lastEvent) res.write('data: ' + JSON.stringify(entry.lastEvent) + '\n\n');
    entry.subagents.forEach(function (subEvt) { res.write('data: ' + JSON.stringify(subEvt) + '\n\n'); });
  });
}

// Safety net: a session that never sends SessionEnd (crashed, or was test/demo
// traffic that just stopped) would otherwise sit in the snapshot forever,
// cluttering every future page load. If NOTHING has happened for this long,
// treat it as dead even without a formal SessionEnd. Generous on purpose — a
// real session can go quiet for a while if you just haven't sent a new
// prompt — but a killed/crashed session haunting every page load for most
// of an hour proved worse (Pocket Deck: users open and close tabs freely).
// A false positive only costs a walk-out; the next prompt's hooks bring the
// session straight back.
const STALE_SESSION_MS = 15 * 60 * 1000;
setInterval(function () {
  const now = Date.now();
  sessionCache.forEach(function (entry, sid) {
    const lastTs = entry.lastEvent ? entry.lastEvent._receivedAt : 0;
    if (now - lastTs > STALE_SESSION_MS) { sessionCache.delete(sid); speechSent.delete(sid); modelSent.delete(sid); sessionTokens.delete(sid); sessionSeenMsg.delete(sid); }
  });
}, 5 * 60 * 1000);

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

// Speech ticker: hooks only fire around tool calls, so text Claude writes
// BETWEEN tool calls used to sit invisible until the next hook happened to
// fire. Poll every active session's transcript and push fresh text the
// moment it lands, as a synthetic 'SpeechTick' event — the same speechSent
// gate guarantees a given quote is broadcast exactly once, whichever path
// (real event or tick) sees it first. Net effect: the bubble tracks the
// terminal within ~2-3s instead of "whenever the next tool runs".
const SPEECH_TICK_MS = 2000;
setInterval(function () {
  sessionCache.forEach(function (entry, sid) {
    const last = entry.lastEvent;
    if (!last || last.hook_event_name === 'SessionEnd' || !last.transcript_path) return;
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
      if (!f.endsWith('.jsonl')) return;
      const p = path.join(dir, f);
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
    return (c && typeof c === 'object' && c.weeklyPct > 0 && c.weeklyTokens > 0) ? c : null;
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
  // start from the historical "busiest prior week" gauge…
  let baselineW = baseT, baselineF = baseF, isCal = calibrated, source = 'history';
  let usedPctW = calibrated ? Math.min(100, Math.round(cur.total / baseT * 100)) : null;
  let usedPctF = (calibrated && baseF > 0) ? Math.min(100, Math.round(cur.fable / baseF * 100)) : null;

  // …but if the user anchored a real % from their account, that wins
  const calib = loadCalibration();
  if (calib) {
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

  return {
    five: five,
    week: week,
    block: block,
    weekly: weeklyStats(),
    allTimeTotal: allTimeTotal(),
    latest: latest ? { model: latest.model, effort: latest.effort, at: latest.t } : null,
    warning: liveUsageWarning(),
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
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, function (err, data) {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    // no-cache = always revalidate. Without this, phones held on to a stale
    // index.html through UI updates (confirmed via a user screenshot showing
    // a long-fixed bubble bug) — heuristic caching with no validator at all.
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer(function (req, res) {
  if (req.method === 'POST' && req.url === '/event') {
    let body = '';
    req.on('data', function (chunk) {
      body += chunk;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', function () {
      let evt;
      try { evt = JSON.parse(body || '{}'); } catch (e) { evt = { raw: body }; }
      evt._receivedAt = Date.now();
      // Opener handoff (the shell `claude` wrapper fires a synthetic
      // SessionStart with _opener:true so the office opens the instant you
      // launch claude, not on the first prompt — the phone's real
      // SessionStart hook is unreliable). Two rules keep it from ever
      // showing a duplicate office:
      //   • a real event for a cwd → evict any cached opener for that cwd
      //     (the real session has taken over; the client adopts it live)
      //   • an opener for a cwd that a real session already covers → drop it
      if (evt.cwd && !evt._opener) {
        sessionCache.forEach(function (entry, osid) {
          if (entry.lastEvent && entry.lastEvent._opener && entry.lastEvent.cwd === evt.cwd && osid !== evt.session_id) {
            sessionCache.delete(osid); speechSent.delete(osid); modelSent.delete(osid); sessionTokens.delete(osid);
          }
        });
      } else if (evt.cwd && evt._opener) {
        let covered = false;
        sessionCache.forEach(function (entry) {
          if (entry.lastEvent && !entry.lastEvent._opener && entry.lastEvent.cwd === evt.cwd) covered = true;
        });
        if (covered) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true,"skipped":"covered"}'); return; }
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
      }
      cacheEvent(evt);
      broadcast(evt);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
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
    if (!local || !m) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end('{"ok":false}'); return; }
    spawn('tmux', ['kill-session', '-t', m[1]], { stdio: 'ignore' }).on('error', function () {});
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
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

  if (req.method === 'GET' && req.url === '/api/widget') {
    let summary;
    try { summary = widgetSummary(); } catch (e) { summary = { error: String(e && e.message) }; }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify(summary));
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
// AGENT_VIZ_HOST restricts the bind address. Unset = all interfaces (LAN
// viewing, the historical behavior); the Pocket Deck phone launcher sets
// 127.0.0.1 so a phone on public Wi-Fi never exposes the dashboard.
const HOST = process.env.AGENT_VIZ_HOST || undefined;
server.listen(PORT, HOST, function () {
  console.log('officebot dashboard: http://localhost:' + PORT + (HOST ? ' (bound to ' + HOST + ')' : ''));
  console.log('Hook endpoint:       http://localhost:' + PORT + '/event');
});
