<!-- pocket-deck:begin -->
# Pocket Deck — you are on the user's Android phone (auto-managed section)

Every Claude Code session on this phone should already know:

- **Environment:** Termux on Android. Claude Code is the official
  linux-arm64 binary patched to run here (glibc-runner); its wrapper
  self-updates daily. NEVER reinstall via `npm install -g
  @anthropic-ai/claude-code` — the npm route is broken on Android and
  replacing the patched binary bricks `claude`.
- **You are probably inside tmux** (session `deck-1`, `deck-2`, … = the
  tabs of the "Pocket Deck" web app at http://localhost:4317/deck.html,
  attached through ttyd on 127.0.0.1:7681). Never `tmux kill-server` —
  other deck tabs live in it.
- **officebot** — the pixel-art "office" dashboard of your sessions —
  serves the deck and runs at http://localhost:4317. Its repo is
  `~/officebot` (GitHub `Cybermumu22/officebot`); hooks in
  `~/.claude/settings.json` POST every event to it. `deck-start` starts
  officebot + ttyd (safe to re-run); `deck-stop` stops them (tmux and
  your sessions survive). Android docs: `~/officebot/ANDROID.md`.
- **Main project:** `~/work/CyberShield` — the Cyber Hub LMS (has its own
  CLAUDE.md; read it before working there). Work syncs via GitHub; the
  user's Windows PC works on the same repos.
- **Termux specifics:** `pkg` (apt) for packages; no systemd, no sudo;
  bionic libc — foreign glibc binaries need glibc-runner; shared storage
  needs `termux-setup-storage`; keep servers bound to 127.0.0.1.
- The user is a beginner — explain what you're doing in plain language.
<!-- pocket-deck:end -->
