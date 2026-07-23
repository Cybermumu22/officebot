# officebot

**A live pixel-art "office" for your Claude Code sessions.** Watch your agents
walk in, think, run tools, delegate to subagents, banter in the lounge, and
clock out — with a real usage/limit tracker on the wall. It's a fun, glanceable
window into what Claude Code is doing.

Zero dependencies. Runs entirely on your machine. **Nothing is ever sent
anywhere** — it just reads your local Claude Code logs and serves a page on
`localhost`.

<!-- Add a screenshot or GIF here — e.g. ![officebot](docs/screenshot.png) -->

---

## Quick start

You need [Node.js](https://nodejs.org) (v16+), which you already have if you use
Claude Code. Then, in a terminal:

```bash
npx officebot setup
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
> `npx officebot` to start the dashboard any time.

---

## Commands

| Command | What it does |
|---|---|
| `npx officebot setup` | Wire up Claude Code, then start the dashboard |
| `npx officebot` | Just start the dashboard (same as `start`) |
| `npx officebot demo` | Start it **and** play a fake session, so you can see it work without a real one |
| `npx officebot remove` | Cleanly remove the hooks it added (only removes its own) |

**Options:** `--port <n>` (default `4317`), `--no-open` (don't launch a
browser), `-y` (skip prompts). If you pick a custom port at `setup`, use the
same `--port` when you `start`.

---

## Watch it on your phone

The dashboard is a PWA (installable web app), so no app store needed:

1. Make sure your phone is on the **same Wi-Fi** as the computer running it.
2. Find the computer's local IP (e.g. `192.168.1.42`).
3. On your phone's browser, open `http://<that-ip>:4317`.
4. Use "Add to Home Screen" to keep it one tap away.

If it doesn't load, allow Node through your firewall for that port (it only
listens on your local network).

---

## Privacy

- Everything runs locally. The server listens on your own machine and reads
  Claude Code's own log files under `~/.claude/projects`.
- **No data leaves your computer.** There is no account, no telemetry, no cloud.
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
npx officebot remove   # takes the hooks back out of settings.json
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
