# officebot

### Watch Claude Code work — as a living pixel-art office. 🏢

Every Claude Code session becomes a floor of a neon office. The boss (your
model) reads the brief, delegates to a crew of pixel workers, and the whole
place hums — every move driven by **real** Claude Code events, nothing faked.
It's the most fun way to actually *see* what your agents are doing.

⚡ **Zero dependencies** · 🔒 **100% local — nothing ever leaves your machine** · 📱 **runs on your Android phone, too**

![officebot — a live office of Claude Code agents at work](docs/office-desktop.png)

> *Two live sessions side by side: **Fabby** (Fable) directs `aurora-api` while
> **Sonny** (Sonnet) runs `mobile-app`. Scout's grepping, Jack's running the
> tests, Blueprint's reading the architecture doc — real tool calls, real
> speech bubbles, and the crew bantering between jobs.*

---

## ✨ What you get

- **🎬 A live agent view** — every session as an animated office floor: who's working, what they're running, what just finished, what broke. Glanceable — not a wall of logs.
- **👔 A full cast with real personalities** — your model is the boss; your agent types are named crew with faces, professions, home rooms, and their own banter.
- **📊 Honest usage meters** — a live clock, your 5-hour window and weekly burn on the wall, minded by Tally the accountant.
- **🔒 Totally local & private** — it reads your own Claude Code logs and serves one page on `localhost`. No account, no telemetry, no cloud.
- **📱 Pocket Deck** — run the *actual* Claude Code CLI on your Android phone: a real terminal **and** the office in one installable app.

One command and any Claude Code session shows up: **`npx @cybermu22/officebot setup`**.

---

## 🎬 The live agent view

<img src="docs/office-mobile.png" alt="officebot on a phone — the same live office" width="290" align="right">

This is the heart of it. Point it at Claude Code and the boring stream of tool
calls turns into a floor you can *read at a glance*:

- **Rooms with purpose.** Research, Terminal, Archives, Planning, a Lounge — each
  crew member has a home room, and when the boss hands them a job they get up,
  walk to it, and *work it*, then head back when it's done.
- **Speech bubbles that mean something.** Real actions surface as bubbles —
  *"Searching for `rateLimit`"*, *"Running: npm test"*, *"Reading login.js"* —
  colour-coded by how much they matter, with the full line mirrored into the
  **Dialogue** feed below.
- **A floor that's alive between jobs.** Idle crew wander, and whoever shares a
  room strikes up profession-flavoured chatter (*"If you say semicolons I'm
  leaving."*). It never sits still.
- **Little ceremonies for everything.** A turn that finishes cleanly gets
  🎉 confetti; a failed tool flashes a red **!**; a hand-back gets a ✓ and
  sometimes a spoken review from the boss; a new prompt is hand-delivered to the
  desk by Dispatch the courier.
- **Watch many sessions at once.** Two projects running? You get two offices,
  side by side (or stacked on a phone).
- **Tap anyone for their bio.** Every character has one.

When a real limit is spent, the whole office **clocks out** one by one, mentions
they're taking a break… and drifts back in when the window resets.

---

## 👔 Meet the cast

![The officebot cast at work — Fabby directing, Scout, Nitpick, Jack, Twin, Tinker, Blueprint, Bookworm and Ace on the job, with Tally on the meters](docs/office-cast.png)

> *One office, full crew: **Fabby** hands out the hard one from Planning while
> Scout & Nitpick dig through Research, Jack & Twin & Tinker work the Terminal,
> Blueprint & Bookworm hit the Archives, Ace strolls in from the Lounge — and
> Dispatch drops the new request into the feed.*

### The bosses — *your model runs the floor*

Whichever Claude model is driving your session **is** the boss, with an office
rank to match. Switch models mid-session (`/model`) and it plays out as a
**shift change**: the outgoing boss walks out as the new one walks in, and the
crew has opinions about the new management.

| | Model | Rank | The vibe |
|---|---|---|---|
| **Fabby** | Fable | **Director** | Top of the org chart — runs the floor with unbothered authority. |
| **Oppy** | Opus | **Manager** | The heavyweight in the corner office; takes the deep work and the hard calls. |
| **Sonny** | Sonnet | **Lead** | The dependable team lead — fast, sharp, calls the shots and still gets hands-on. |
| **Kiku** | Haiku | **Senior Staff** | The scrappy, fun-size veteran covering the lead chair. Cheap, quick, endlessly roasted by the crew — and still ships. (They're colleagues, so nobody calls Kiku "boss".) |

### The crew — *your agent types, on the payroll*

Delegate to an agent type and its character leaves their spot and works the job.
Custom agent types get their own generated codenames.

| | Agent type | Profession | Home room |
|---|---|---|---|
| **Scout** | `Explore` | **Recon.** First out the door to map a codebase — greps, globs, reports back. | Research |
| **Bookworm** | `claude-code-guide` | **The librarian.** Knows the docs cold; the one you ask "how does this *actually* work?" | Research |
| **Jack** | `general-purpose` | **The handyman.** Any odd job — run the tests, wire it up, whatever's needed. | Lounge |
| **Ace** | `claude` | **The wildcard.** The all-rounder who fills in wherever; no job too weird. | Lounge |
| **Blueprint** | `Plan` | **The architect.** Won't touch code until there's a plan on the wall. | Archives |
| **Nitpick** | `code-reviewer` | **QA, and proud of it.** Lives to find the comma you missed; redlines everything. | Archives |
| **Twin** | `fork` | **The doppelgänger.** Splits off to run a second thread of the same work in parallel. | Terminal |
| **Tinker** | `statusline-setup` | **The gadget guy.** Configs, status lines, little tooling fixes — always adjusting something. | Terminal |

### The regulars — *they don't take sessions, they run the place*

- **Tally** — the **usage accountant**. Mans the wall meters (live clock, 5-hour
  window, weekly burn) and stays quiet until the tokens start climbing — then
  he's got opinions, and the crew heckles him about the bill.
- **Dispatch** — the **courier**. Every prompt you send is hand-delivered to the
  boss's desk, satchel and all, so a new request always *arrives* instead of
  just appearing.

---

## Quick start

You need [Node.js](https://nodejs.org) (v16+), which you already have if you use
Claude Code. Then, in a terminal:

```bash
npx @cybermu22/officebot setup
```

That's it. This one command:

1. **Wires Claude Code to the dashboard** — it adds a small set of "hooks" to
   your `~/.claude/settings.json` (safely: it backs the file up first and never
   touches anything else you have in there).
2. **Starts the dashboard** and opens it in your browser at
   **http://localhost:4317**.

Now open a Claude Code session anywhere and watch it appear. Leave the
`officebot` window running in the background; press `Ctrl+C` to stop it.

> Already ran `setup` once? You don't need it again — just run
> `npx @cybermu22/officebot` to start the dashboard any time.

---

## Commands

| Command | What it does |
|---|---|
| `npx @cybermu22/officebot setup` | Wire up Claude Code, then start the dashboard |
| `npx @cybermu22/officebot` | Just start the dashboard (same as `start`) |
| `npx @cybermu22/officebot demo` | Start it **and** play a fake session, so you can see it work without a real one |
| `npx @cybermu22/officebot remove` | Cleanly remove the hooks it added (only removes its own) |

**Options:** `--port <n>` (default `4317`), `--no-open` (don't launch a
browser), `-y` (skip prompts). If you pick a custom port at `setup`, use the
same `--port` when you `start`.

---

## 📱 Pocket Deck — Claude Code (and the office) on your Android phone

**No PC required.** Pocket Deck runs the *real* interactive Claude Code CLI
directly on your phone and puts the live office right next to it — one
installable app. Code from the bus.

- **A real terminal, phone-shaped** — tabs, a key bar (Esc · Tab · Ctrl · arrows
  · ⏎ · paste), swipe-friendly, with persistent `tmux` sessions that **keep
  running when you close the app** and snap back mid-output when you return.
- **The office, one flip away** — tap **⇄** to swap between the terminal and the
  live agent view, or split them on screen together.
- **Keeps going with the screen off** — background a session and it keeps
  working; get an Android **notification when Claude needs your approval**, with
  Approve / Deny buttons that answer the terminal directly.
- **Your work rides on GitHub**, and everything stays **local to the phone** —
  both servers bind to localhost, nothing is exposed to Wi-Fi.
- **You don't need to know how to code to set it up** — it's copy-paste.

```sh
curl -fsSLO https://raw.githubusercontent.com/Cybermumu22/officebot/main/termux-setup.sh
bash termux-setup.sh
```

👉 **Full beginner-friendly walkthrough & troubleshooting: [ANDROID.md](ANDROID.md)**

## Viewing from other devices (phone, another computer, anywhere)

<img src="docs/office-mobile.png" alt="officebot on a phone" width="300" align="right">

officebot **must run on the same machine as Claude Code** — it reads Claude
Code's local logs and receives its local hooks, so the server can't live on a
separate box. But the dashboard is a normal web page (and a PWA), so you can
*view* it from anywhere.

> ⚠️ **officebot has no login of any kind.** By default it is now **private to
> the machine it runs on** (bound to `127.0.0.1`). Its pages expose your
> conversations, the bash commands Claude runs, and your file paths — so LAN
> viewing is **opt-in**, and you should only enable it on a network you trust
> (your home Wi-Fi, not a café/hotel/office/shared network).

**On the same Wi-Fi (phone, laptop):**

1. Start it in LAN mode: `npx @cybermu22/officebot start --lan`
   *(or set `AGENT_VIZ_HOST=0.0.0.0`). Without this it stays private.*
2. Find the host computer's local IP (e.g. `192.168.1.42`).
3. On the other device's browser, open `http://<that-ip>:4317`.
4. On a phone, use **"Add to Home Screen"** to keep it one tap away (it's a PWA).

If it won't load, allow port `4317` (or your chosen port) through the host's
firewall.

**From anywhere (outside your network):** ⚠️ officebot has **no login**, so
don't forward the port straight to the public internet — anyone with the URL
could see your dashboard. Use a private tunnel instead:

- **[Tailscale](https://tailscale.com)** (recommended, free) — a private mesh
  VPN. Install it on the host machine and on whatever device you want to watch
  from, then open `http://<host's-tailscale-IP>:4317` (a `100.x.y.z` address).
  Encrypted, no port-forwarding, nothing exposed publicly.
- **[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)**
  (free) — if you want a real `https://…` URL:
  `cloudflared tunnel --url http://localhost:4317`. Treat the URL as a secret,
  or put [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
  in front of it for a login.

**Custom port:** `npx @cybermu22/officebot start --port 8080` (or set
`AGENT_VIZ_PORT`). If you change it, re-run `setup --port 8080` so the hooks
point at the right place.

**Keep it always-on:** the `start` command runs in a terminal window. To have
it run in the background permanently, launch it as a service — Windows Task
Scheduler / Startup, Linux `systemd`, macOS `launchd`, or a small Docker
container.

---

## Privacy & security

- Everything runs locally. The server listens on your own machine (loopback by
  default) and reads Claude Code's own log files under `~/.claude/projects`.
- **No data leaves your computer.** There is no account, no telemetry, no cloud.
- ⚠️ **Run it only on your own device — never host it for others to log into.**
  The terminal is a shell on the host machine, and there is no login. See
  **[SECURITY.md](SECURITY.md)** for the full threat model (what it does and
  doesn't defend against, and why LAN mode is opt-in).
- The usage numbers are honest token counts from your local logs — they're a
  personal gauge, **not** an official Anthropic quota meter (real plan limits
  aren't exposed locally). You can anchor the weekly/5-hour gauges to your real
  account numbers if you want them exact.

---

## How it works

Claude Code can fire **hooks** on session/tool events. `setup` points nine of
them (`SessionStart`, `PreToolUse`, `SubagentStop`, `SessionEnd`, …) at a tiny
local server (`server.js`, plain Node). That server keeps the last event per
session, streams everything to the browser over Server-Sent Events, and reads
the local transcripts to show the active model, live token usage, and what
Claude just "said". The browser page (`public/`) renders it all as the animated
office — just HTML/CSS/SVG + one script, no framework, no build step.

For the full architecture and design notes, see
[ARCHITECTURE.md](ARCHITECTURE.md).

---

## Uninstall

```bash
npx @cybermu22/officebot remove   # takes the hooks back out of settings.json
```

Then stop the server (close its window). `npx` copies are cleaned up
automatically.

---

## Optional: home-screen image widget

For Android *image* widgets (KWGT etc.) that can't run a live web page, there's
a PNG snapshotter (`snapshot.js`). It's **optional** and needs Playwright:

```bash
npm i -g playwright && npx playwright install chromium
```

Most people don't need it — the PWA above is the simpler path.

---

## Development

```bash
git clone <your-repo-url>
cd officebot
node cli.js demo      # run it with a fake session
```

No build step, no dependencies. `server.js` is the backend, `public/index.html`
is the whole frontend, `public/avatars.js` holds the pixel-art roster.

## License

MIT © Mumudrummer

---

*officebot is an independent, community-built tool. It is **not affiliated
with, endorsed, or sponsored by Anthropic**. "Claude" and "Claude Code" are
Anthropic's; officebot only reads your own local Claude Code logs and uses its
documented hooks. The character names (Fabby, Oppy, etc.) are affectionate
nicknames, not official branding.*
