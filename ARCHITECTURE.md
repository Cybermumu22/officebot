# Agent Viz

A local live dashboard for Claude Code, mobile-friendly. Global hooks (in
`~/.claude/settings.json`) POST session/tool/subagent events to this server
as they happen; the dashboard renders each active Claude Code session as its
own office floor plan — Planning, Research, Terminal, Archives, Lounge, Exit,
each with a custom line-art room icon — with an unframed sprite avatar
(pixel art borrowed from Cyber Hub's hero roster, `public/avatars.js`, glowing
by its own silhouette via `drop-shadow` rather than a bordered badge) per
session/subagent that physically walks between rooms (little animated feet
and hands, pumping cross-phased like a real gait while walking) depending on
what it's doing: `Read`/`Edit`/`Write` → Archives,
`Grep`/`Glob`/`WebFetch`/`WebSearch` → Research, `Bash` → Terminal, a new
prompt → Planning, idle → Lounge. A speech bubble over its head says what
it's about to do. The avatar/room picked per session or agent type is
deterministic (same one every time), but the movement and dialogue are driven
entirely by real hook events — nothing here is scripted. When nothing is
connected, the floor still shows the (dimmed, empty) office rather than a
blank box, so there's always a "room" on screen.

**Names:** the main session's display name is a nickname derived from the
Claude model running it (`claude-sonnet-5` → "Sonny", `claude-opus-4-8` →
"Oppy", `claude-haiku-4-5` → "Kiku", `claude-fable-5` → "Fabby"), falling
back to its roster avatar name otherwise. **Subagents wear fun codenames
instead of their raw agent type** — `Explore` → "Scout", `general-purpose` →
"Jack", `Plan` → "Blueprint", etc (`AGENT_CODENAMES` in `avatars.js`);
unknown/custom agent types get a deterministic pick from a codename pool
("Pixel", "Gizmo", ...) so they still get a personality with zero mapping
work. Codenames are deterministic per TYPE, not per instance — that's what
keeps the boss's "Sending Scout to: ..." handoff line, the lounge standby
crew, and the arriving subagent all agreeing on who "Scout" is. If two
subagents of the same type run at once, the second gets a numeral suffix
("Scout II") so they stay tellable apart. Getting this right took a real fix: hook
payloads only carry a `model` field on `SessionStart`, and even there it's
optional (the official docs say it can be omitted after `/clear`, resume,
etc). So `server.js` doesn't trust `evt.model` — every hook payload also
carries `transcript_path`, and that JSONL transcript reliably logs
`message.model` on every assistant turn, so the server reads the tail of that
file and fills in `model` itself whenever the hook didn't provide it.

**Speech bubbles show what Claude is actually saying, not a status light.**
Same transcript-reading trick, taken further: `server.js` also pulls the
`text` content block out of the most recent assistant turn and attaches it
as `evt._speech`. The client prefers this — cleaned of markdown, truncated —
over the mechanical "Running: npm test"-style description whenever it's
available, so the bubble reads like an actual thought rather than a log
line. The tricky part: the *most recent* assistant turn is very often
tool-only or thinking-only (no text block at all) when several tool calls
happen back to back — so the server keeps scanning backward (up to 1MB of
transcript) for the last turn that actually had something to say, rather
than stopping at the first assistant entry and going blank. Model barely
changes mid-session so a stale cached value is fine there; a stale *quote*
from way earlier would be actively misleading, so speech only ever reports
freshly-found text or nothing (never a stale fallback) — nothing means the
bubble just falls back to the mechanical description for that event.

**Each quote is broadcast exactly once, pushed live, and fades when idle.**
Three related fixes (all caught via a user screenshot of the same line
repeating forever):
- *Once:* the transcript's newest text stays "the newest" across many later
  tool events, and re-attaching it to each of them made the dashboard repeat
  the same quote over and over. `speechSent` (per-session, server-side)
  gates it: text is attached to exactly ONE event — whichever sees it first
  — and every later event falls back to its mechanical description. The
  client shows an attached quote wherever it lands (Pre/Post/Stop/tick), so
  a line can't be silently consumed. A quote consumed by `SessionStart` is
  deliberate: that text predates the session (resume, /clear) and shouldn't
  resurface as if just said.
- *Live:* hooks only fire around tool calls, so text written BETWEEN tool
  calls used to wait for the next hook. A server-side ticker polls every
  active session's transcript (2s interval, 1s transcript cache — was 3s)
  and pushes fresh text immediately as a synthetic `SpeechTick` event that
  updates the bubble + dialogue feed without touching zone/status (and is
  excluded from the event counter/log). Net: the bubble tracks the terminal
  within ~2-3s; movement/tool events were already near-instant.
- *Fades:* an idle entity's last words are said once, then done —
  `armIdleFade` clears the bubble ~14s after `Stop`/`SessionStart` (or an
  idle-time SpeechTick) unless something new was said, instead of the last
  line of the turn hovering over the avatar's head forever.

This only works for the **main session** — subagent (sidechain) turns aren't
recorded inline in the transcript the same way, so there's currently no
reliable model *or* speech source for a subagent; it keeps its roster avatar
name and a scripted line instead.

**The boss↔subagent handoff is an actual little conversation, not two
unrelated status lines.** When the main session sends a subagent off to do
something (an `Agent`/`Task` tool call), its bubble narrates the handoff by
name — "Sending Explore to: find the bug" — and remembers that line for 15s.
When that subagent's `SubagentStart` fires moments later, instead of a
generic greeting it echoes the specific task back: "Got it — find the bug."
When it finishes, it hands back with "Wrapped up — over to you, boss." (or a
sibling line) before settling to idle at the Lounge.

**The user appears in the office too — as "Dispatch", a mail courier.** The
user isn't an agent, they're the person SENDING the work, so every
`UserPromptSubmit` plays a little delivery: Dispatch (a dedicated pixel
mail-carrier sprite, `COURIER_AVATAR`, amber glow) walks in through the
EXIT door, crosses to Planning, presents the request in a bubble
(`📨 From the user: "..."`) right next to the boss's own "Thinking:" bubble,
then heads back out the door with a sign-off line and despawns (~7s total,
`dispatchCourier()` — pure client-side choreography, no hook events beyond
the prompt itself). Dispatch also owns the prompt's amber line in the
DIALOGUE feed (`📨 New request: ...`), replacing the boss's old separate
"Thinking:" chat line so the prompt isn't logged twice. Timers are cleared
and the courier removed on `SessionEnd` or a newer prompt.

**The usage tracker lives IN the office: a wall monitor above Tally's
desk.** Every office's back wall carries a mounted USAGE screen (a
`.wall-screen` div inside `.floor-camera`, so pinch-zooming the office
zooms the tiny type too), with "Tally" (`TALLY_AVATAR` — green accountant's
visor, red tie, calculator chest panel) standing at his own desk beneath it
as static office staff (a `.staff` div — no hook events drive him).
The monitor is deliberately compact: anchored to the wall band's TOP and
sized to fit entirely inside it on desktop AND phone (the model line hides
below 640px), because the first version hung down over the floor.
Tally isn't mute, though — he's in the banter rotation: his teases live in
`CREW_EXCHANGES` as the 'tally' role (each teaser now a NAMED crew member —
"Free tokens if you smile, Tally." is Ace's line, the CSV request is
Blueprint's), Tally deadpanning back from a SIDEWAYS `.staff-bubble` (a
bubble above his head would cover his own monitor), and the boss breaking
it up like a tired parent ("Children, please.") — boss lines only play
when the main session is actually idling at the Lounge. When the lounge is
empty he occasionally mutters to himself (`TALLY_SOLO`). All of it lands in the DIALOGUE feed as banter.
**He also reads the meter out loud to the manager** (~every couple of
minutes, `TALLY_USAGE_HIGH/MID/LOW` picked from the REAL `usedPct` on his
wall monitor, `{pct}`/`{reset}` filled from `_usageData`): relaxed under
40% ("At this rate we retire rich, boss."), respectful-burn mid-range,
spicy above 75% ("Easy on the big thoughts."). The boss's comeback lines
only play when the boss is genuinely idling; Tally's own line lands either
way — he will absolutely talk at a busy boss.
- **Data source:** `GET /api/usage` on the server, aggregated from EVERY
  Claude Code transcript on the machine (`~/.claude/projects/**/*.jsonl`).
  Each assistant entry carries `message.usage` (input/output/cache tokens),
  `message.model`, and a top-level `effort` — all confirmed against real
  transcripts. Files are scanned INCREMENTALLY (per-file byte offsets, only
  appended bytes after the first pass, 45s refresh throttle, 7-day rolling
  event window, per-`message.id` dedup because multi-block messages repeat
  the same usage on several lines). The client polls every 60s and pushes
  the reading to every office's screen (`applyUsageToScreens`, also called
  when an office/placeholder is built so a fresh screen never says
  "syncing…" for a full minute).
- **The wall is a matched set of three boxes (`.wall-box`, equal height,
  %-widths so they scale with the wall, sized a touch under the 13% band):**
  a live **CLOCK** (current date + big cyan time, ticking every second, with
  the weekly-reset countdown `↻ 1d 00:55:21` below), the **WEEKLY** monitor,
  and the **5-HOUR** monitor. All reset displays are precise ticking
  HH:MM:SS countdowns (day-prefixed only when needed) driven by a 1s
  `updateClock` ticker off absolute reset targets (`_weeklyResetAt`/
  `_blockResetAt`, set at each 60s poll) — never a vague "N days left".
  Lines are kept short enough to never truncate (verified: zero clipping,
  equal heights, all within-band on desktop AND a 390px phone). The two
  decorative wall windows were removed to make room; the poster hides on
  phones (`m-hide`).
- **WEEKLY monitor.** A rolling-7-day bar plus a second FABLE-only bar
  (fable-model spend). Each is measured against the heaviest COMPLETED PRIOR
  week in persisted history (`usage-history.json`, 56 days of per-day
  totals, survives restarts). The
  baseline deliberately EXCLUDES the current in-progress week — otherwise a
  busy current week is its own 100% ceiling and always reads "0% left" (the
  real bug that prompted this: on a fresh install the only week on record IS
  this week). Until a genuine prior week exists (~9+ recorded days) there's
  nothing to compare against, so `usedPct` is null and the screen shows the
  raw totals + "building baseline (Nd)" on a calm low bar — never a false
  0%/red. It's a "vs your own busiest week" gauge, NOT an Anthropic quota
  (which isn't exposed locally). On phones the two wall windows hide
  (`m-hide`) to fit both monitors side by side.
- **Token counters live ON the monitors, not the chrome (2026-07).** All the
  token figures sit on the wall panels — no top-bar total, no office-header
  badge (both removed by request). The **5-HOUR monitor** carries the live
  per-session counter and the all-time total on one line: `⚡<stok> · Σ<all>`
  ("⚡72k · Σ24M"). `⚡<stok>` is the current session's cumulative tokens —
  the server accumulates them from the transcript as messages land
  (`updateSessionTokens` reads the 1MB tail each event, adds any message id
  not yet counted; attached as `evt._sessionTokens`), the client animates it
  climbing (`animateCount`) and glows it cyan while the office is actively
  working (`.office.working .ws-stok`). `Σ<all>` is the machine-wide
  all-time total (`allTimeTotal` = monotonic `usageHistory.lifetime` +
  everything still in the 56-day history). The **WEEKLY monitor** dropped
  its ⚓ tag; each line now shows the relevant token total instead —
  "64% left · 23M" and "FABLE 51% · 5.0M". Verified no clipping on a 390px
  phone.
- **Manual calibration anchor + exact weekly reset.** The user can read
  their real usage % off their Claude account and tell the assistant, which
  writes `usage-calibration.json` (`weeklyPct`/`weeklyTokens`/`fablePct`/
  `fableTokens` + `resetDow`/`resetHour`, e.g. Friday 08:00). `weeklyStats`
  then anchors the true ceiling (`limit = tokensAtAnchor / (pct/100)`) — the
  WEEKLY monitor shows a ⚓ and a real "% left · resets 1d 1h" countdown to
  the next reset instant. Rough by nature (our token metric ≠ Anthropic's;
  rolling-7d ≠ their fixed window), so re-anchor when it drifts. Falls back
  to the "building baseline"/busiest-week gauge when no anchor exists.
- **"Office emptied" moments are logged.** Departure events —
  clock-out (5h spent), holiday (weekly/fable spent), model handover,
  session sign-off — are pinned into the EVENT LOG as distinct amber
  `.moment` lines (`logMoment`, deduped, transition-detected in
  `refreshUsagePanel` so a limit logs once when first hit, not every poll),
  so a user whose phone was asleep can scroll back and see exactly when the
  office went quiet.
- **Limit-driven storytelling.** When the 5h block hits 100% the crew clocks
  out for the day (`LIMIT_HOME_EXCHANGES` — "Everyone clock out." / "Music
  to my ears. Going home."); when the WEEKLY or FABLE meter fills (and
  history is calibrated) they declare an office holiday
  (`LIMIT_HOLIDAY_EXCHANGES` — "Beach week, baby." / "Sand, Scout. You grep
  sand.") with the rough weekly-reset estimate (`{resetd}`). And when the
  serving model ACTUALLY changes mid-session — exactly what happens when
  Fable hits its weekly cap and the session falls back — `maybeSetModel`
  detects it and plays a HANDOVER: the old persona (grayscale "spent"
  ghost) announces a holiday or a going-home ("Hit my limit — heading home
  for 1h 53m. Sonny, take the chair.") and walks out the exit door while
  the new model takes the office (plaque + chair). Verified end-to-end
  including the fable→sonnet handover, both dialogue sets, and the
  `{resetd}` substitution.
- **The bar is a % meter, not just counts.** `computeBlocks()` reconstructs
  Claude's real 5-hour rate-limit blocks from the event timeline (first
  request starts a block, floored to the hour; next request after expiry
  starts a new one) — so "resets in 42m" is a genuine countdown to the
  current block's end, and between blocks the screen reads "fresh window ·
  starts on next use". Since Anthropic does NOT expose actual plan quotas
  locally, 100% is auto-calibrated to the heaviest completed block of the
  trailing week (the current block itself if it's the heaviest) — the bar
  shows "% left" against your own proven peak, colour-shifting
  green→amber→red at 60/85% used. Totals exclude cache reads (at ~100:1
  they'd drown the real numbers). Small lines carry `5h used/baseline · 7d
  total` and the newest model + effort. IF a rate-limit warning ever
  appears in a transcript, the screen's LED turns red-blinking and a ⚠ row
  shows the message — the best "weekly limit warning" available without an
  API key.

**The EXIT is just the door.** No sign plate, no doormat — the wall's door
prop (with its built-in glowing green sign) IS the exit; the `exit` zone
anchor sits right below the doorway (y:17) so departing avatars walk up to
the door itself, and `officeSkeletonHtml` skips emitting a sign for it.

**The "usual crew" are PERMANENT lounge residents** — the four agent types
the boss most commonly deploys (Explore/Scout, general-purpose/Jack,
Plan/Blueprint, claude/Ace), purely cosmetic, not driven by hook events.
They used to all vanish the moment any real subagent spawned — which read
as "the lounge emptied and a stranger appeared" (caught via user
screenshot). Now only the crew member whose CODENAME is currently on duty
is hidden: the working subagent IS that crew member (same sprite, same
name, both derived from the agent type), so it reads as them getting up
from the bench, working, and coming back — while the rest keep lounging.
An agent type outside the crew (custom types → pool names like "Rune")
simply appears alongside without displacing anyone. Crew idle SILENTLY —
no resting bubble — but the banter system hands them real lines now and
then, which appear and fade like actual speech. **Idle means ORIGINAL
sprite colours for everyone** (user request, 2026-07): the old
dim+desaturate+glow idle filter is gone — glow effects are now purely a
"working" signal (active/thinking/calm/error/done states unchanged), and
the crew's extra opacity fade went with it; only their missing status LED
marks them as off-the-clock. Likewise the rug is sized in PERCENT of the
floor (`wpct` in PROPS), not px — the one prop big enough that fixed px
overflowed the lounge mat on narrow screens.

**Bubbles show the full thought, and a layout pass keeps them apart.**
Bubbles display whole speech now — up to a 6-line clamp on desktop, 5 on
phones (`-webkit-line-clamp` on an inner `.tb-text` span — NOT on the bubble
itself, whose tail arrow is a `::after` outside the box that
`overflow:hidden` would clip), with anything longer finishing in the
DIALOGUE panel. Since bubble heights now vary wildly, fixed tier offsets
can't guarantee separation on their own — `resolveBubbleLayout()` does:
after every render (and again 1s later, once the .9s walk transitions have
settled) it measures every visible bubble's real bounding box and lifts any
that would overlap an already-placed neighbour via a `--lift` CSS var,
capped so a bubble is never lifted past the floor's top edge where
`overflow:hidden` would eat its opening lines (caught on a phone with two
tall bubbles stacked at the Terminal). Supporting details that came out of
real measurement bugs, kept because each one bit once: `width:max-content`
on the bubble is load-bearing (an abs-positioned box otherwise
shrink-to-fits against its 21px badge parent and collapses to one character
per line — a user screenshot caught this live); the ±2.4% body stagger is
tied to the tier sign so it ADDS to bubble separation instead of eating it;
and same-zone groups are edge-clamped as a UNIT (`startX = clamp(center -
width/2, 14, 86 - width)`) so a floor edge can't squash two neighbours'
bubbles together. Bubbles can still briefly pass over each other while
someone is mid-walk — that's the transition, not the resting layout.

**No stuck bubbles — every bubble fades.** `armBubbleFade` (generalised from
the old idle-only `armIdleFade`) is called at the end of `handleEvent` for
every event: the resulting bubble clears ~12s later unless a newer one
replaces it. Previously only IDLE bubbles faded, so a post-activity line —
a "Done with Bash." after a tool, or an active line when the session then
went quiet — hung over the avatar's head until the next event happened to
speak (user-reported "stuck bubble"). Verified: a PostToolUse bubble is
gone 13s later with no further events.

**Clock-out / holiday empties the WHOLE office, one at a time, boss last.**
When a limit is spent, `stepDeparture` sends exactly one person out per
chat-tick in order: **crew** (Scout→Jack→Blueprint→Ace, per-character
`CREW_BYE`), then **Tally** the accountant (`TALLY_BYE` — his static `.staff`
div is animated to the door and hidden), then the **boss LAST** (`BOSS_BYE`
— "Everyone's gone. My turn. Beach!"), leaving the office truly empty
(`s.crewGone`/`s.tallyGone`/`s.bossGone`/`s.leaving`; render skips the gone,
routes the current leaver to the exit, and drops the boss entity once
`bossGone`). Each says a farewell at the lounge, walks to the exit ~2.2s
later, and vanishes ~4.4s after — slow, only one at a time. `reopenOffice`
brings everyone back (and restores Tally's desk) when the window/week resets
OR real work resumes (a UserPromptSubmit/PreToolUse/SubagentStart event).
A single 🏖/🏠 "whole office …" moment is logged when the boss finally
leaves. Verified end to end: crew → Tally → boss → empty → reopen.

**Model handover has three flavours, incl. a plain shift change.**
`playModelHandover` no longer always claims "hit my limit": it's a HOLIDAY
message only if the leaving model's weekly/fable meter is actually ≥95%, a
LIMIT-HOME message only if the 5h block is ≥95%, and otherwise a neutral
SHIFT CHANGE ("Shift change — Fabby, the desk is yours.") — which is what a
manual `/model` switch at the terminal produces. Logged as 🔄 for a manual
switch. The ghost's walk-out is slowed to 4.8s/8.2s. Verified an
Opus↔Fable manual swap plays the shift-change wording, not a false limit.

**Idle means silent.** A speech bubble only exists while there's something
being said: the standby crew idles with no bubble at all, a subagent that
settles after finishing drops its bubble, and a `Stop` with no fresh
transcript text shows nothing rather than a filler "Standing by." (a
permanent status line over someone who isn't talking read as un-immersive).
Banter lines appear, hang for ~4.5s, and — if the token has no real bubble
to revert to — fade away entirely, like actual speech.

**The DIALOGUE panel is where long speech finishes — genuinely in full.**
Every line anyone says also lands in a chat feed under the floor. Long
lines (> ~220 chars) display clamped to 3 lines with a tap-to-expand
"▾ more" toggle; the full text (up to a 4000-char safety cap — it used to
be chopped at 400, which cut real conclusion messages off) is always in
the DOM, and the expanded view renders the message's own paragraph breaks.
Lines are colour-coded by importance: real
transcript speech cyan, user prompts amber, "Sending Scout to: ..."
delegations purple, arrivals/handbacks green, tool failures red, lounge
banter dim italic. Mechanical "Reading x.js"-style status lines are
deliberately NOT fed into it — the event log next to it already lists every
tool call, and the dialogue feed is for dialogue. Newest at the bottom,
auto-pinned via the same `column-reverse` trick as the event log, capped at
120 lines, consecutive duplicates skipped (snapshot replays re-send the
same last line).

**It's a full office now, not icons on a grid.** The floor went through
three passes (monochrome line-art props → colourful pixel-art props → full
scene overhaul); the current construction, in paint order:
- **Flooring:** the camera background is a carpet-tile checkerboard with
  grout lines over an ambient vignette. Each room then stands on its own
  `.room-mat` — a percent-sized floor panel with a per-room CSS-gradient
  texture (`ROOM_MATS`): carpet weaves for Planning/Research, raised
  server-room tiles for Terminal, shelf-room stripes for Archives, wood
  planks for the Lounge, a doormat at the Exit. An occupied room's mat and
  sign glow in the occupant's status colour (`mat-active`, set alongside
  `zone-active` in `updateZoneOccupancy`).
- **Back wall** (`.office-wall`, top 13% of the floor): panel seams, a
  baseboard, and wall-mounted props — a synthwave poster, two windows with
  a pixel night view (retro sun over the grid in one, a lit city skyline in
  the other), a clock, and the actual EXIT door with a glowing green sign.
- **Furniture:** ~30 pixel-art props per floor, drawn in the avatar
  roster's visual language (`crispEdges` rects, top-lit shading, CSS
  drop-shadows): meeting table with laptop + chairs + whiteboard easel in
  Planning; twin bookcases and a reading desk in Research; a triple-monitor
  command desk flanked by two LED server racks in Terminal; filing
  cabinets, a storage shelf and box stacks in Archives; and a Lounge with
  an area rug, purple couch with throw pillows, coffee table, floor lamp,
  a coffee-bar counter with machine and mugs, and plants — water cooler
  and vending machine in the hallway outside.
- **Zone signs:** the old dashed zone rectangles became compact pill-shaped
  sign plates on each mat's top edge — the MAT is the room, the sign just
  names it. Occupants still gather at the zone anchor (the mat's centre),
  so none of the movement logic changed.
Props are `pointer-events:none` and rendered behind signs/people, so the
avatars stay the brightest thing on the floor.

**A bubble that can't fit above the head flips below it.** An avatar
standing near the top of the floor (Planning, the Exit door) used to get
its bubble's first lines clipped off by the floor's `overflow:hidden`.
`resolveBubbleLayout()` now starts with a flip pass: each visible bubble is
measured at its natural above-the-head spot, and any that pokes past the
floor's top edge gets `.below` — it hangs under the avatar instead (clear
of the legs/shadow/nameplate), with the tail arrow flipped to point up at
the speaker. The collision pass is direction-aware after that: above-bubbles
get pushed up (capped at the floor top), below-bubbles get pushed down
(capped at the floor bottom) — verified with two tall flipped bubbles
crowding the Planning room on both desktop and a 390px viewport. The Lounge itself is a real room now: percent-sized
(76% × 26% of the floor since the crew became permanent residents — six
loungers were spilling into the hallway at the old width; furniture hugs
the left/right edges to keep the middle band clear standing room) instead
of the same 92×58px box as
every other zone, with its icon/label pinned to the top edge so the middle
stays clear for furniture and however many people are idling. The floor
grew to 400px tall (340px mobile) to make space.

**The main session's own office is never removed while the session is
alive** — only a real `SessionEnd` hook (Claude Code actually closing) tears
it down, after an 8s fade. Idle just parks it at the Lounge; it doesn't
disappear. This used to only be true for browsers that were already
connected when it happened, though — a browser (or phone) that loaded the
page fresh saw nothing until the next event happened to fire, because the
server was pure passthrough with no memory of who's currently online. Fixed:
`server.js` now keeps the last event for every known session/subagent and
replays that snapshot to any newly-connecting client before live events
resume, so a fresh page load shows exactly who's online right now — verified
by firing real events with zero browsers connected, then opening a brand
new page and confirming it appeared immediately, with zero new events sent.
Since only the LAST event per session is kept and many hook payloads omit
`cwd`, the cache also carries the last known `cwd` forward onto cwd-less
events — otherwise a fresh page load would title the office "— unknown"
whenever the newest event happened to lack it.

**Every character OWNS their dialogue — personalities from professions.**
The old system dealt generic `PEER_EXCHANGES` lines to whatever two random
loungers were around, which meant the same line could come out of two
different mouths a minute apart (user complaint — the trigger for the
rewrite). Now `CREW_EXCHANGES` (~101 exchanges / ~273 owned lines, 2-4
lines each, ~2.4s apart) names its speaker on EVERY line, in voice — the
pre-ownership classics (context windows, quantization, hallucinated files,
"we get reset every session", rm -rf nerves) were all ported back in with
rightful owners after the first cut dropped them (user request): **Scout** the hyperactive recon
("I read four hundred files today. FOUR hundred."), **Jack** the seen-it-all
handyman ("Leave it. It's a fossil record."), **Blueprint** the pedantic
planner ("Phase two begins Monday." — "It's Tuesday." — "Phase two begins
today."), **Ace** the smooth wildcard ("Asterisk. And proud."), plus 'boss'
and 'tally' roles. `runChatTick()` builds a CAST of who's genuinely idle at
the lounge (Tally always counts; boss only when idling) and only plays
exchanges whose every named speaker is present; a per-office shuffle-bag
(`o.banterHist`, half the pool deep) blocks any exchange from repeating
until the material has cycled. Solo musings are per-character too
(`CHARACTER_SOLO` — Scout: "Every file I haven't read is a personal
insult."; boss: "They think I don't see the couch naps. I see everything.";
plus a small 'visitor' pool for one-off settling agents like Rune/Bolt).
Fourth-wall and office-furniture material remains throughout. Verified with
a 3.5-minute live observation: 48 lines, zero ownership violations, zero
cross-speaker duplicates. This is 100% pre-written flavor text picked
client-side with `Math.random()` — it never calls a model or API, so it has
no token cost, and it plays ambiently for as long as people are idling.

Getting a multi-line exchange right needed one more fix: a 3-line exchange
often has the SAME token speak lines 1 and 3 (with someone else's line 2 in
between). Each spoken line schedules its own revert-to-real-status timer, so
line 1's timer landing shortly after line 3 was said would silently stomp
line 3 back to a stale status — verified this happens and fixed it by giving
each token a `banterSeq` counter bumped on every line (banter or real): a
line's revert now only fires if it's still both the token's latest *real*
state (`gen`) and its latest *spoken* line (`banterSeq`).

**Smaller, less cluttered, and pannable/zoomable.** Avatar badges, room
boxes, and text all shrank (badges went 58/46px main/sub → 42/32px → 32/24px
across two rounds of "still too big", then to 28/21px trading avatar size
for full-speech bubbles); occupants of the same room get evenly
spread, deterministic slots based on
their position in that room's occupant list, not per-token hash jitter —
hash jitter looked fine most of the time, but two FIXED tokens (like the
"usual crew" pair) hash to the exact same offsets on every render, so if
they ever landed close together they'd stay stuck overlapping permanently,
not just unluckily that one time. Each office floor is now its own little
pannable/zoomable camera (`initFloorCamera()`) — drag to pan, pinch or mouse
wheel to zoom (0.7x–2.4x), a reset button in the corner — same model as a
phone map app: at 100% zoom the camera exactly fills the viewport (nothing
to pan to yet), zooming in is what creates room to drag around. Verified
pan, wheel-zoom, edge-clamping, and reset all work correctly; also caught
and fixed a real bug this exposed — `setPointerCapture` can throw in some
pointer-state edge cases, and left uncaught it silently aborted the entire
pointerdown handler before pan/zoom tracking ever got set up, breaking the
whole feature with no visible error.

**A stale test session can clutter every future page load — watch for it.**
The snapshot-on-connect fix above means the server remembers every session
it's ever seen until a real `SessionEnd` (or the 45-minute stale-session
sweep) clears it. Test/demo traffic that never sends `SessionEnd` — like
running `demo.js` or any one-off verification script — piles up in that
cache forever otherwise, and every one of those ghost sessions gets replayed
to every new browser tab right alongside your real session. If you ever see
multiple unfamiliar offices that clearly aren't real Claude Code sessions,
just restart `server.js` — the cache is purely in-memory, so a restart clears
it instantly. (Or send an explicit `SessionEnd` for test session IDs when
you're done, same as the real hooks would.)

## Run it

**It auto-starts at Windows logon** (set up 2026-07): `agent-viz.vbs` in the
user's Startup folder (`shell:startup`) silently runs
`~/.claude/agent-viz/start-agent-viz.cmd`, which starts the server hidden
and writes `server.log` (fresh each boot) beside it. To stop auto-starting,
delete `agent-viz.vbs` from the Startup folder. If the server is ever down
mid-session, start it manually:

```
node ~/.claude/agent-viz/server.js
```

Then open **http://localhost:4317** in a browser and leave it open. Any
Claude Code session you start anywhere on this machine will show up
automatically — no per-project setup needed. Note this watches **Claude
Code on this machine only** (CLI, desktop app, IDE extensions — anything
that runs the global hooks): claude.ai web chats, the mobile app, and
claude.ai/code cloud sessions never execute local hooks, so they can't
appear here.

To use a different port: `AGENT_VIZ_PORT=5000 node server.js`.

Static files are served with `Cache-Control: no-cache`, so a plain refresh
always picks up UI changes — before this, phones held on to a stale
`index.html` for days (no cache header + no validator = heuristic caching).

## On your phone

The dashboard is a **PWA**: `manifest.json` + icons (Ghost.exe sprite) + a
deliberately cache-free service worker (`sw.js` — this project has been
bitten by stale HTML before; the SW only registers on secure origins).
On Android, Chrome menu → **Add to Home screen** gives an app icon that
opens the live office; over plain `http://<tailscale-ip>` it's a shortcut,
and if the server is ever fronted with HTTPS (e.g. `tailscale serve`), the
same flow installs it as a real standalone app.

**A true live-animated home-screen widget isn't possible on Android**
(widgets are periodically-refreshed static views — no web content). Three
approximations, closest-to-live first:
1. **Web live wallpaper** (third-party app category, "web live wallpaper"
   on Play Store): renders the dashboard URL as the actual home-screen
   wallpaper — genuinely animated, behind the icons.
2. **`GET /snapshot.png`** — a recent PNG of the first office, rendered by
   `snapshot.js` (headless Chromium via the Cyber Hub project's Playwright
   install — the require path is hardcoded there; agent-viz itself stays
   zero-dep). Spawned LAZILY by the server on first request and self-exits
   ~25 min after the last one (`.snapshot-keepalive` mtime check), so
   Chromium only runs while a widget is actually pulling. Re-renders every
   40s; temp file must end in `.png` (Playwright infers format from the
   extension — a `.tmp` suffix fails with `unsupported mime type "null"`).
   Point any image/photo widget (KWGT Bitmap, etc.) at it for the real
   office LOOK, refreshed on the widget's schedule.
3. **`GET /api/widget`** — compact feed with PRE-FORMATTED display strings
   for text widgets: `pctUsed`/`pctLeft` (numbers, for a progress bar),
   `resetsIn` ("42m"), `blockTokens`/`baseline`/`weekTokens` ("1.8M"),
   `model`, `effort`, `online` + `sessions[]`, `warning`. Example KWGT
   formula: `$wg("http://<ip>:4317/api/widget", json, .pctLeft)$% left`.

## The Android app (custom-built, `android/`)

**`android/` holds a complete custom Android app** — "Agent Viz"
(`com.agentviz.viewer`), built because the user wanted a live viewer without
third-party apps. Downloadable at **`/agent-viz.apk`** (MIME entry in
server.js). Two components, plain Java + android.* framework only (no
androidx/Kotlin/Gradle), minSdk 26 / target 36, ONE permission (INTERNET),
cleartext allowed (Tailscale IP, no TLS):
- **Screensaver** (`DashboardDreamService`): WebView fullscreen while
  charging — fully live. WebView is built in `onAttachedToWindow` and
  destroyed (after `about:blank`) in `onDetachedFromWindow` or Chromium
  leaks a renderer per activation.
- **Live wallpaper** (`DashboardWallpaperService`, own `:wallpaper` process
  + `WebView.setDataDirectorySuffix` — both non-negotiable): LIVE engine =
  private VirtualDisplay (OWN_CONTENT_ONLY) on the wallpaper surface + a
  Presentation hosting the WebView (hardware-accelerated, truly animated,
  no permissions). SNAPSHOT engine = `/snapshot.png` drawn fit-width every
  40s. Auto-trips live→snapshot on `Presentation.show()` failure or
  `onRenderProcessGone`; also user-selectable in the app's settings.
- **SettingsActivity** (launcher icon): URL (default the Tailscale IP),
  Test connection, wallpaper mode, screensaver dim, plus shortcut buttons
  into the system screensaver/live-wallpaper screens (Samsung buries both),
  and **"Refresh wallpaper now"** (v1.3) — the live wallpaper loads the
  page ONCE and can then run for days, so dashboard redesigns never arrived
  without a reload (user report). The button sends a package-scoped
  broadcast (`ACTION_REFRESH`, dynamic receiver registered with
  `RECEIVER_NOT_EXPORTED` on API 33+) into the `:wallpaper` process; each
  engine reloads its WebView (also picking up a changed URL, and giving a
  previously-failed live mode another chance) or fetches a fresh snapshot.
  Belt-and-braces: engines also auto-reload on becoming visible when the
  loaded page is >6h old or the configured URL changed.

**Build:** `bash android/build.sh` — Gradle-free pipeline (aapt2 → javac →
d8 → aapt add → zipalign → apksigner), auto-bumps versionCode, publishes to
`public/agent-viz.apk`. Toolchain: JDK 17 (`C:\Program Files\Microsoft\
jdk-17*`), SDK at `C:\Android` (cmdline-tools + platform android-36 +
build-tools 36.1.0; cmdline-tools zip was SHA-256-verified on install).
**NEVER delete/regenerate `android/keystore/`** — a new signing key means
the phone refuses updates until the app is uninstalled. Known quirk: pass
`--sdk_root` to sdkmanager.bat from PowerShell, not Git Bash (bash eats the
backslash and the SDK lands in the current directory).

**Install on the phone:** browse to `/agent-viz.apk` → download → open →
allow "Install unknown apps" for the browser (one-time; Play Protect may
warn about an unknown developer — Install anyway) → open Agent Viz → Test
connection → use the two "Set up…" buttons. If the live wallpaper ever
misbehaves on a given device, switch it to Snapshot mode in the app — no
rebuild needed.

## How it's wired

`~/.claude/settings.json` has an `agent-viz` block of `hooks` (SessionStart,
UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, SubagentStart,
SubagentStop, Stop, SessionEnd) — each an `http` hook, `async: true`, posting
to `http://localhost:4317/event`. If the server isn't running, these hooks
just fail silently (connection refused) and Claude Code carries on normally —
nothing about your actual sessions depends on this dashboard being open.

To stop using it: remove the `hooks` entries from `~/.claude/settings.json`
(or the whole file if nothing else lives there), or just leave the server
off — either way it's inert.
