# officebot

### A tiny pixel office where your AI actually goes to work. 🏢

Claude Code normally talks to you in a wall of scrolling text. officebot turns
that into a neon office floor with a little staff in it. Your model is the boss.
Your agents are employees with faces, desks and opinions. When Claude greps
something, a pixel guy gets up and walks to the Research room to do it.

Nothing here is faked or simulated. Every step, every speech bubble, every
coffee break is a real Claude Code event.

⚡ **Zero dependencies** · 🔒 **Never leaves your machine** · 📱 **Also runs on your phone**

![officebot — a live office of Claude Code agents at work](docs/office-desktop.png)

> *One session, mid-job. **Fabby** (Fable) is running `aurora-api` with the
> whole floor busy: Scout and Bookworm digging through Research, Twin and Jack
> on the terminals, Blueprint and Nitpick in the Archives, Ace killing time in
> the Lounge. Jack's Bash just failed — that's the red one. Everything said out
> loud also lands in the Dialogue feed underneath, so nothing scrolls past you.*

---

## Try it in about ten seconds

You already have Node if you have Claude Code. So:

```bash
npx @cybermu22/officebot setup
```

Your browser opens at **localhost:4317**. Start a Claude Code session anywhere
on the machine and watch someone walk in and get to work.

Want to see it move before wiring anything up? `npx @cybermu22/officebot demo`
plays a fake session — full staff, no setup, nothing touched.

[![npm](https://img.shields.io/npm/v/@cybermu22/officebot?color=cb3837&label=npm&logo=npm)](https://www.npmjs.com/package/@cybermu22/officebot)
[![node](https://img.shields.io/node/v/@cybermu22/officebot?color=5fa04e&logo=node.js&logoColor=white)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/@cybermu22/officebot?color=8b5cf6)](LICENSE)

*(The version badge reads live from npm — it can't go stale the way a
hand-typed number does.)*

---

## What you're actually looking at

The floor has rooms, and the rooms mean something. Research, Terminal, Archives,
Planning, a Lounge with a sofa nobody earned. Everyone has a desk they belong
at. Hand a job to an agent and they stand up, cross the floor to the right room,
and work it — then wander back when they're done.

Speech bubbles carry the real thing they're doing. *Searching for `rateLimit`.*
*Running: npm test.* *Reading login.js.* Colour tells you how much to care, and
every line also drops into the Dialogue feed underneath, so nothing scrolls
past while you blinked.

Between jobs they don't just stand there. Idle staff drift, bump into whoever
shares their room, and start talking rubbish at each other — in character, and
never the same line twice in a row.

Small ceremonies for everything. A clean finish gets confetti. A failed tool
flashes an angry red **!**. Finished work gets handed back with a ✓ and
sometimes a review from the boss. And every prompt you type is physically
carried across the floor to the boss's desk by a courier with a satchel.

Two projects on the go? Two offices, side by side. On a phone they stack.

When you genuinely run out of tokens, the whole place clocks out one at a time,
grumbling on the way past — and drifts back in when your window resets.

---

## The staff

![The officebot cast at work — Scout, Bookworm, Twin, Jack, Blueprint, Nitpick, Ace, Tally and Fabby across the office floor](docs/office-cast.png)

> *Everyone has somewhere they belong. Research glows cyan while Scout and
> Bookworm are in it, the Terminal goes red when Jack's command fails, and the
> Archives sit purple with Blueprint and Nitpick. Tally never leaves his desk
> under the meters. Ace is in the Lounge, as usual.*

### Management is whoever you're paying for

Whichever model is driving your session runs the floor, and the office treats it
accordingly. Switch model mid-session with `/model` and you get a proper shift
change: the old boss walks out, the new one walks in, and the crew has thoughts
about the new management.

| | Model | Rank | |
|---|---|---|---|
| **Fabby** | Fable | Director | Top of the org chart. Runs the place with total unbothered authority. |
| **Oppy** | Opus | Manager | The heavyweight in the corner office. Takes the deep work and the hard calls. |
| **Sonny** | Sonnet | Lead | Dependable, fast, still gets hands dirty. Calls the shots without the swagger. |
| **Kiku** | Haiku | Senior Staff | The scrappy fun-size veteran covering the lead chair. Cheap, quick, relentlessly roasted, still ships. Nobody calls Kiku "boss" — they're colleagues. |

### The crew — one per agent type

Delegate to an agent type and that character gets up and does it. Custom agent
types you've invented get their own generated codename and join the floor.

**Scout** · `Explore` · *Research*
First out the door to map a codebase. Greps, globs, reports back. Reads first,
asks never. If it exists in your repo, Scout already found it.

**Bookworm** · `claude-code-guide` · *Research*
The librarian. Knows the manuals, the RFCs and the footnotes. If there's a
documented way to do it, Bookworm found it — page 12.

**Jack** · `general-purpose` · *Lounge*
The handyman. Any odd job, armed with duct tape, belief, and a working knowledge
of a bit of everything.

**Ace** · `claude` · *Lounge*
The wildcard. Deployable for anything, with style. The asterisk in the roster.

**Blueprint** · `Plan` · *Archives*
The architect. Won't let anyone touch code until there's a plan on the wall.
Everything gets a numbered list, a risk rating and a contingency.

**Nitpick** · `code-reviewer` · *Archives*
QA, and proud of it. Hunts the edge cases, redlines everything, requests changes
— and secretly cares a great deal.

**Twin** · `fork` · *Terminal*
The doppelgänger. Splits off to run two things at once. Two heads, one payroll
number, and the occasional argument with itself.

**Tinker** · `statusline-setup` · *Terminal*
The gadget guy. Configs, status lines, tiny tooling fixes, and milliseconds
nobody asked him to shave. The perfect setup is out there somewhere.

### Send four at once and you get a squad, not four clones

Claude fans agents out in parallel constantly — four Explores at a time is an
ordinary Tuesday. Calling them Scout II, Scout III and Scout IV would look like
a cloning accident, so instead **the office phones in Scout's teammates**:

| Send several… | and they arrive as |
|---|---|
| `Explore` | Scout, **Recon**, **Probe**, **Ranger**, **Tracker** |
| `general-purpose` | Jack, **Mac**, **Rigg**, **Bolt**, **Wrench** |
| `Plan` | Blueprint, **Draft**, **Schema**, **Sketch**, **Grid** |
| `claude` | Ace, **Deuce**, **King**, **Joker**, **Trey** |
| `claude-code-guide` | Bookworm, **Index**, **Scroll**, **Margin**, **Footnote** |
| `code-reviewer` | Nitpick, **Quibble**, **Sniff**, **Redline**, **Comma** |
| `fork` | Twin, **Clone**, **Echo**, **Mirror**, **Fork** |
| `statusline-setup` | Tinker, **Sprocket**, **Cog**, **Fuse**, **Bit** |

They wear the **same sprite** as the crew member they're covering for — same
job, same look — but each in **its own colourway**, so four parallel Explores
are four people you can actually tell apart rather than four identical Scouts.

### Life as a temp

The first one is permanent staff. Everyone after that is **agency**, and the
office treats them accordingly.

They don't materialise at a desk like the regulars do — they come in **through
the front door**, like someone who had to find the building. They announce
themselves on the way in (*"Temp crew, checking in."* · *"On loan for this
one."* · *"Here for the surge."*), and the permanent staff are delighted:

> **Scout:** *"Intern alert — hide the good snacks."*
> **Recon:** *"I’m just here for the tokens."*

> **Nitpick:** *"The couch is load-bearing. Don’t sit on it."*
> **Probe:** *"Contractually, I ignore that."*

The ribbing is rate-limited, so a four-temp surge doesn't turn into a wall of
snark, and only about half of them bother firing back.

When the work's done they don't linger in the Lounge like the regulars —
they clock out and **walk back out the door** (*"Contract fulfilled. Bye."*).
Scout's own spot stays empty until **every last one** of them has gone, so the
floor never shows him in two places at once.

Past five it gives up and falls back to numerals — Scout VI, Scout VII. If
you're running six parallel Explores, you have larger problems than nomenclature.

**Why not just hand the second Explore to Ace or Jack, since they're standing
about?** Because the character *is* the agent type. Ace **is** `claude`, Jack
**is** `general-purpose`. Putting Ace on an Explore job would mean the floor was
telling you something Claude didn't actually do, and then you couldn't trust any
of it. Recon is a real second `Explore` — that's the whole point of him.

### Except for the jobs with no name on them

Some agents turn up with **no type at all** — Claude Code's own internals, like
the conversation summariser, spawned without a `Task` call for the office to
learn from.

Rather than invent a stranger for those, the office gives the job to whichever
crew member fits best and isn't already busy: **Ace** first (unknown jobs are
literally the wildcard's job description), then **Jack** the handyman, then
**Bookworm** — summarising *is* docs work — and on down to the narrow
specialists, who get asked last.

If every single one of them is mid-job, the work goes to a one-off contractor
with a pool name instead: Pixel, Gizmo, Byte, Nova. They do the job and you
never see them again.

### The regulars

They never take a session. They just run the place.

**Tally** — the usage accountant. Sits under the wall meters counting every
token in and out. Incorruptible. Calls out what you've spent as you spend it,
and the crew heckles him about the bill.

**Dispatch** — the courier. Your stand-in on the floor. Walks each new request
in through the door, hands it to the boss, and heads straight back out.

Tap anybody to read their bio.

---

## The meters on the wall

![The wall meters — clock, weekly and 5-hour windows, with Tally commenting on the spend](docs/office-meters.png)

Tally's wall carries a live clock, your 5-hour window, and your weekly burn —
counted honestly from your own local transcripts. He calls out what you spend
as you spend it, and he is not impressed by any of it.

Read the small print though: these are **your own numbers, not an official
quota**. Real plan limits aren't exposed to local tools, so the gauges measure
you against your own heaviest week on record. It's a useful gut-check, not a
billing statement. You can anchor them to your real account figures if you want
them exact.

---

## 📱 Pocket Deck — the whole thing on an Android phone

No PC involved. Pocket Deck runs the **real** Claude Code CLI on your phone and
puts the office right next to it, as one installable app.

<p align="center">
  <img src="docs/deck-terminal.png" alt="Pocket Deck — the office above a real terminal running Claude Code" width="46%">
  <img src="docs/deck-claude.png" alt="Pocket Deck — the Claude chat pane with the message composer" width="46%">
</p>

> *Left: a real Claude Code session on a phone. Oppy has sent an Explore agent
> off to map the repo and backgrounded it, Scout is mid-grep, and Tally has
> already totted up the bill — "9.6k spent. Rounding error. Cute." The key bar
> along the bottom is Esc, Tab, Ctrl and arrows, because a phone keyboard
> hasn't got any.*
>
> *Right: the same session flipped to the chat pane — type to Claude like a
> messaging app, with the model, effort and permission mode on one chip.*

It's a proper terminal, shaped for a phone: tabs, a key bar with Esc, Tab, Ctrl,
arrows and paste, and `tmux` sessions that **keep running when you close the
app** — come back and it's still going, mid-output.

Three ways to arrange it, because everyone's phone is a different shape: **Flip**
swaps between office and terminal, **Split** stacks both at a size you drag, and
**Collapsible** hides whichever you're not using. Text size, colours, alerts and
the usage calibration are all in there too.

Background a session and it keeps working. Android pings you when Claude wants
approval, with Approve and Deny buttons that answer the terminal without you
opening anything.

Both servers bind to localhost. Nothing is exposed to your Wi-Fi.

```sh
curl -fsSLO https://raw.githubusercontent.com/Cybermumu22/officebot/main/termux-setup.sh
bash termux-setup.sh
```

It's copy-paste the whole way, and you don't need to understand any of it.
👉 **Full walkthrough and troubleshooting: [ANDROID.md](ANDROID.md)**

---

## Commands

| Command | What it does |
|---|---|
| `npx @cybermu22/officebot setup` | Wire up Claude Code, then start the dashboard |
| `npx @cybermu22/officebot` | Just start the dashboard |
| `npx @cybermu22/officebot demo` | Start it and play a fake session, no setup needed |
| `npx @cybermu22/officebot remove` | Take the hooks back out — only ever its own |

**Options:** `--port <n>` (default `4317`), `--no-open` to skip the browser, `-y`
to skip prompts. Pick a custom port at setup and use the same `--port` when you
start.

Ran `setup` once already? You never need it again — plain
`npx @cybermu22/officebot` from then on.

---

## ⚠️ Read this before you share it

**officebot has no login. None.** Its pages show your conversations, the bash
commands Claude runs, and your file paths. On the phone, the terminal pane is a
real shell.

So by default it binds to `127.0.0.1` and is private to the machine it's on.
Anything beyond that is deliberately opt-in, and you should only do it on a
network you actually trust. Your home Wi-Fi, not the café.

Full threat model — what it defends against and what it doesn't — is in
**[SECURITY.md](SECURITY.md)**. Worth five minutes before you open it up.

### Watching from your phone or another computer

officebot has to run on the same machine as Claude Code — it reads that
machine's local logs and receives its local hooks, so the server can't live
somewhere else. But the dashboard is an ordinary web page (and a PWA), so
*viewing* it from elsewhere is easy.

Same Wi-Fi:

1. Start it in LAN mode: `npx @cybermu22/officebot start --lan`
   *(or set `AGENT_VIZ_HOST=0.0.0.0` — without this it stays private)*
2. Find the host machine's local IP, e.g. `192.168.1.42`
3. Open `http://192.168.1.42:4317` on the other device
4. On a phone, **Add to Home Screen** — it's a PWA, so it behaves like an app

Won't load? Let port `4317` through the host's firewall.

From outside your network — **don't port-forward this.** No login, remember.
Use a private tunnel instead:

- **[Tailscale](https://tailscale.com)** (free, and the one I'd pick) — a private
  mesh VPN. Install on both machines, open `http://<tailscale-ip>:4317`.
  Encrypted, nothing public, no port forwarding.
- **[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)**
  (free) if you want a real `https://` URL:
  `cloudflared tunnel --url http://localhost:4317`. Treat that URL like a
  password, or put [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
  in front of it.

**Custom port:** `start --port 8080` (or `AGENT_VIZ_PORT`). Change it and re-run
`setup --port 8080` so the hooks know where to aim.

**Always on:** `start` holds a terminal window. For permanent background running,
launch it as a service — Task Scheduler on Windows, `systemd` on Linux,
`launchd` on macOS, or a small container.

---

## Privacy

Everything is local. The server listens on your own machine and reads Claude
Code's own logs under `~/.claude/projects`. There's no account, no telemetry, no
cloud, and no phoning home. The only reason it needs your data is to draw a
cartoon of it.

---

## How it works

Claude Code can fire **hooks** on session and tool events. `setup` points nine
of them (`SessionStart`, `PreToolUse`, `SubagentStop`, `SessionEnd` and friends)
at a small local server — `server.js`, plain Node, no dependencies. That server
remembers the last event per session, streams everything to the browser over
Server-Sent Events, and reads your transcripts for the live model, token counts
and what Claude just said.

The page itself is HTML, CSS, SVG and one script. No framework, no build step,
no bundler. Every character is hand-drawn as inline SVG rectangles.

Full design notes: [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Uninstall

```bash
npx @cybermu22/officebot remove
```

That pulls the hooks back out of `settings.json` — only the ones it added. Then
close the server window. `npx` tidies its own copies up.

---

## Optional: home-screen image widget

Android *image* widgets (KWGT and friends) can't run a live web page, so there's
a PNG snapshotter in `snapshot.js`. It needs Playwright:

```bash
npm i -g playwright && npx playwright install chromium
```

Most people should ignore this. The PWA above is simpler and it moves.

---

## Development

```bash
git clone https://github.com/Cybermumu22/officebot
cd officebot
node cli.js demo
```

No build, no dependencies, nothing to install. `server.js` is the whole backend,
`public/index.html` is the whole frontend, `public/avatars.js` holds the pixel
roster.

## License

MIT © Mumudrummer

---

*officebot is independent and community-built. It is **not affiliated with,
endorsed, or sponsored by Anthropic**. "Claude" and "Claude Code" are theirs;
officebot only reads your own local logs through documented hooks. Fabby, Oppy
and the rest are affectionate nicknames, not official anything.*
