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

3. **Log in to GitHub:** `gh auth login`
   (GitHub.com → HTTPS → Login with a web browser), then **run the setup
   script again** — this time it clones your `CyberShield` repo into
   `~/work/CyberShield`.

4. **Log in to Claude:** `cd ~/work/CyberShield && claude`
   — follow the login link it prints. Ask it to search for something in the
   repo to confirm everything works.

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

## What carries over from the PC — and what doesn't

| | |
|---|---|
| ✅ Claude account | same login, models, and subscription |
| ✅ Your repo | `CyberShield` via GitHub — CLAUDE.md / SKILLS.md travel with it |
| ✅ Settings | model, effort, theme, status line — pre-filled by setup |
| ✅ The office | officebot runs on the phone, showing the *phone's* sessions |
| ❌ Running Cyber Hub | MongoDB doesn't run on Android — the phone is for editing, committing, and pushing; run the app itself on the PC |
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

**Update Pocket Deck** — `git -C ~/officebot pull` (or re-run the setup
script), then pull-to-refresh the deck page.
**Update Claude Code** — `npm install -g @anthropic-ai/claude-code`.

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
