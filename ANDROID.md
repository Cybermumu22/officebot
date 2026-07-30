# Pocket Deck — Claude Code + the office, on your Android phone

Pocket Deck turns your phone into a full Claude Code machine — **no PC
involved**. A real terminal (the same interactive Claude Code CLI as on
desktop) and the officebot viewer live together in one installable app, and
your work rides on GitHub.

```
┌─────────────────────────────┐
│  CLAUDE │ SHELL │ +   ⇄  ⚙ │   tabs · flip · settings
├─────────────────────────────┤
│                             │
│   real terminal (tmux)      │   Claude Code, git, anything
│                             │
├─────────────────────────────┤
│ Esc Tab ⇧Tab ^C ↑ ↓ ← → ⏎ 📋│   key bar
└─────────────────────────────┘
```

Everything runs inside [Termux](https://termux.dev) (a Linux terminal for
Android). The deck page is served by your own officebot at
`http://localhost:4317/deck.html` — nothing leaves the phone, and both
servers are bound to localhost so nothing is exposed to Wi-Fi.

---

## Install (one time, ~10 minutes)

**You don't need to know how to code.** Every step below is copy-paste — tap the
copy button on each grey box, paste it into Termux, and press Enter. You'll need
an Android phone, a free [GitHub account](https://github.com/signup), and a
Claude account. Take the steps in order.

1. **Install Termux from F-Droid** — <https://f-droid.org/packages/com.termux/>
   (the Play Store version is abandoned — it must be F-Droid).
   Optional but recommended, same source: **Termux:Widget** (home-screen
   start button) and **Termux:Boot** (auto-start after reboot).

2. **Open Termux and paste:**

   ```sh
   curl -fsSLO https://raw.githubusercontent.com/Cybermumu22/officebot/main/termux-setup.sh
   bash termux-setup.sh
   ```

   Watch for red `!!` lines — anything without one worked. The script is
   safe to re-run whenever (it updates rather than duplicates).

3. **Log in to GitHub** (this is where your work gets saved). Type:

   ```sh
   gh auth login
   ```

   Pick **GitHub.com → HTTPS → Login with a web browser** and follow the code
   it shows. No GitHub account yet? Make a free one at
   <https://github.com/signup> first, then run the command.

4. **Log in to Claude.** Type:

   ```sh
   cd ~/command-deck && claude
   ```

   Follow the login link it prints and sign in with your Claude account. When
   you reach Claude's prompt, type `exit` to leave — the deck opens its own
   tabs for you. (`~/command-deck` is a ready-made folder the deck works in;
   you don't have to create anything.)

   > **Want to work on your own project?** If you already have code on GitHub,
   > clone it after step 3 with `gh repo clone your-name/your-repo`, then open
   > that folder in a deck tab. No project yet? Just work in `~/command-deck` —
   > Claude can create files there and you can turn it into a repo any time.

5. **Start the deck:** `deck-start`
   Chrome opens the deck page. Chrome menu (⋮) → **Add to Home screen** →
   Install. "Pocket Deck" is now an app icon.

6. **Android Settings → Apps → Termux → Battery → Unrestricted**, and keep
   Termux's notification alive. This is what lets Claude keep working with
   the screen off. (If your phone brand is aggressive about killing apps,
   see <https://dontkillmyapp.com>.)

## Daily use

- Tap the **Pocket Deck** icon (start Termux first if it isn't running —
  the Termux:Widget "Pocket-Deck" button does both).
- **CLAUDE tab** → type `claude` and work as on the PC.
- **SHELL tab** → git status / commit / push, or anything else.
- **⇄** flips between terminal and office. **⚙** opens settings: layout
  (Flip / Split / Collapsible), font size, key bar, keep-screen-awake.
- Leaving the app or the screen turning off only **detaches** — tmux keeps
  your session running; reopen and it snaps back mid-output. Closing a TAB
  (tap ✕, then "end?") **ends that session for real** — the office shows it
  signing off. `exit` inside a session ends it too.
- `deck-stop` stops the servers (sessions stay alive).

### CLAUDE — chat with Claude

The bottom bar has a third tab: **🗨 CLAUDE** (formerly CONVO) — the conversation as a proper
chat. Your prompts are amber glass bubbles on the right, Claude's replies
cyan glass on the left (markdown rendered: code blocks, bold, lists), with a
buttery pop-in as each lands. It's two-way with the terminal: type in either
place and both show it, because the CLAUDE pane reads the session's own transcript and
sends over the same wire the terminal uses.

- While Claude works, a ticker under the log shows a rotating play-word with
  elapsed time and a live token counter ("✳ Percolating… · reading server.js
  · 14s · ⚡ 12k tokens"); it clears when the reply lands. Polling speeds up
  to ~0.8s while Claude is working, so replies land near-instantly.
- **Interactive dialogs are answerable from the chat**: when Claude shows a
  numbered menu in the terminal (permission prompt, question, plan approval),
  the CLAUDE pane detects it on the live screen and shows a floating glass card with
  the FULL dialog context (the command/diff preview, not just "proceed?"),
  tappable option buttons, and ↑ ↓ ⏎ Esc fallback keys for
  highlight-then-confirm dialogs (like the folder-trust prompt). The card
  floats over the log and scrolls internally, so nothing gets crowded out.
- **Away? Prompts become notifications.** With "Notify when Claude asks" on
  (default; Android will ask for notification permission on your first send),
  an approval prompt raised while the app is hidden shows an Android
  notification with **Approve / Deny buttons that answer the terminal
  directly** — the server types the key into tmux, so it works even without
  reopening the deck. Tapping the notification body opens the deck instead.
  Android throttles background timers, so the notification can lag up to a
  minute behind the prompt.
- Long messages clamp with a "▾ show all" toggle. The Chat text size setting
  scales the CLAUDE pane too.
- **The composer is an app-style card**: text area on top, controls in the
  card's bottom row. **Enter makes a new line — only the ➤ arrow sends.**
  - The **⚡ pill** (shows the live "Fable 5 · xhigh · Auto" state, read from
    the transcript every 2s) opens one sheet with all three controls: model
    (Fable 5 / Opus / Sonnet / Haiku via `/model`), reasoning effort
    (low → xhigh via `/effort`), and mode (Manual / Auto / Plan — sends the
    right number of shift+tab cycles from wherever the session currently is).
  - The **📎 button** attaches screenshots/images: the file is saved on the
    phone (`~/.deck/attach/`) and its path rides ahead of your text, so
    Claude opens it exactly like a file dragged onto the terminal. Thumbnails
    appear as removable chips until you send.
  - Controls grey out when the terminal is disconnected.
- A SHELL tab shows "No Claude session on this tab yet" — expected when the tab
  has no `claude` running in it; the composer still types into the shell. (If the
  tab *is* running Claude and you see this, see Troubleshooting.)
- In the ttyd engine mode the CLAUDE pane is read-only (no send, no dialog buttons).
- Re-run `termux-setup.sh` once after updating — it wires the new
  `Notification` hook so the ticker can say "⏳ Claude is waiting for you".

### Typing & predictive text (Samsung keyboard)

Type in the **typing bar** above the key strip (on by default) — it's a real
text field, so predictions, autocorrect and swipe-typing all behave exactly
like any other app, and ⏎ (shown as **Send** on Samsung) fires the finished
line into the terminal in one clean burst. This is the supported way to keep
predictive text ON.

Typing *directly* into the terminal canvas is still available (settings →
"Smooth typing bar" off), but understand the trade: Android keyboards
"compose" words as you type, and a browser terminal (xterm.js) receives that
composition through a hidden textarea it can't render properly — doubled
letters and rewritten words are an upstream limitation of every web
terminal, not a deck bug. Direct mode is only clean with predictions off.

The key strip (Esc / Tab / ^C / arrows / ⏎ / 📋) always sends straight to
the terminal, whichever mode you're in — use it for menus, slash-command
navigation and interrupts.

## Usage monitors (real % is opt-in)

The office's WEEKLY / 5-HOUR gauges show **honest local token estimates** by
default. To make them show your **exact account %**, officebot can run a hidden
`claude` session that reads `/usage` every few minutes — but that's automated
access to the Service on a subscription, which Anthropic's terms restrict, so
it's **off by default**. Turn it on only if you're comfortable with that:

```
touch ~/.deck/enable-usage-poll
deck-restart
```

## What carries over from the PC — and what doesn't

| | |
|---|---|
| ✅ Claude account | same login, models, and subscription |
| ✅ Your project | Whatever you clone from GitHub — its CLAUDE.md / notes travel with it |
| ✅ Settings | model, effort, theme, status line — pre-filled by setup |
| ✅ The office | officebot runs on the phone, showing the *phone's* sessions |
| ❌ Running a database-backed app | MongoDB and the like don't run on Android — the phone is for editing, committing, and pushing; run the app itself on the PC |
| ❌ PC memory/history | Claude Code's per-project memory is path-keyed to the PC — fresh on the phone |
| ❌ Windows Command Deck | unrelated; still works for remote-controlling the PC |

## Troubleshooting

**`terminal: FAILED` from deck-start** — Termux's ttyd package has had a
startup bug (`evlib_uv`, termux-packages issue #27563). Try
`pkg upgrade ttyd`, then `deck-start` again. Until it's fixed you still
have a full CLI: use the Termux app directly — `tmux new -A -s deck-1`
gives you the exact same persistent session the deck would attach to.

**`claude` not found after install** — run `bash termux-setup.sh` again
(it creates a launcher shim when npm forgets to), then close and reopen
Termux.

**Claude can't search files** — make sure you opened a fresh Termux session
after setup (`USE_BUILTIN_RIPGREP=0` must be loaded), and that
`rg --version` works.

**Deck page says reconnecting forever** — is Termux itself running?
Run `deck-start` in Termux. The page auto-reconnects the moment the
terminal server is back; tap the pill to retry immediately.

**Sessions die when the screen is off** — battery settings (step 6). The
Termux notification must stay visible; `deck-start` also takes a wake lock.

**The office says `STANDBY - waiting for a session` while the terminal is clearly
working** (and the CLAUDE pane says "No Claude session on this tab yet") — the tab
is running a session officebot has not tied to it yet. Since 1.1.2 it re-learns
the tab by itself, within a couple of hook events: type anything in that tab and
it should come back. Two known ways in, both handled: a session id minted inside a
tab that never relaunched (`/clear`, `/compact`, a forked `--resume`), and a
`claude` that started while officebot was down. If it persists past a few events,
restart the server (`deck-stop && deck-start`) — your tmux sessions survive — and
if it still sticks, that is a bug worth reporting with `~/.deck/officebot.log`.

**Update Pocket Deck** — `git -C ~/officebot pull` (or re-run the setup
script), then pull-to-refresh the deck page.

**Update Claude Code — nothing to do; just run `claude`.** The launcher that
`termux-setup.sh` installs checks for a new version once a day, downloads the
official `linux-arm64` build, verifies its checksum, patches it to run under
Termux's glibc, and smoke-tests it before switching over — keeping the previous
version for rollback and blocklisting any release that crashes under Android's
seccomp filter. **Do not** run `npm install -g @anthropic-ai/claude-code` on
Android: it overwrites that launcher with an unpatched binary and leaves you with
a `claude` that will not start.

## How it fits together

```
Chrome PWA (deck.html)
  ├── xterm.js ── WebSocket ──> ttyd (127.0.0.1:7681) ──> tmux ──> claude / bash
  └── iframe ──────────────────> officebot (127.0.0.1:4317) <── Claude Code hooks
```

- ttyd never runs your shell directly — it always attaches a **tmux**
  session (`deck-1`, `deck-2`, … = the deck's tabs). Disconnects are
  harmless by construction.
- Both servers bind `127.0.0.1` — reachable only from the phone itself.
- The deck page speaks ttyd's own WebSocket protocol (pinned to ttyd
  1.7.x; see the comment block in `public/deck.html`). If it ever breaks,
  Settings → Terminal engine → "ttyd page" embeds ttyd's stock UI instead.
