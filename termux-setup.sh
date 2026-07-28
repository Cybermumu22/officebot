#!/data/data/com.termux/files/usr/bin/bash
# Pocket Deck — one-command Termux setup.
#
#   curl -fsSLO https://raw.githubusercontent.com/Cybermumu22/officebot/main/termux-setup.sh
#   bash termux-setup.sh
#
# Idempotent: safe to run again any time (it updates instead of duplicating).
# It never performs logins for you — those are printed as NEXT STEPS at the end.
set -u

step(){ printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
warn(){ printf '\033[1;31m!! %s\033[0m\n' "$*"; }

if [ -z "${PREFIX:-}" ] || [ ! -d "/data/data/com.termux" ]; then
  echo "This script must run inside Termux (install Termux from F-Droid, not Play Store)."
  exit 1
fi

step "Updating packages (fresh installs often ship half-updated libraries)"
pkg update -y || warn "pkg update failed — check your internet connection"
# Without the full upgrade, openssl/libngtcp2/git/curl can mismatch and git dies
# with: CANNOT LINK EXECUTABLE ... SSL_set_quic_tls_transport_params
pkg upgrade -y || warn "pkg upgrade failed"

step "Installing packages (node, git, gh, ripgrep, ssh, ttyd, tmux, jq)"
pkg install -y nodejs-lts git gh ripgrep openssh ttyd tmux jq curl termux-tools \
  || warn "some packages failed to install — scroll up for which"

step "Installing Claude Code (npm build — the native installer does not run on Android)"
# Test that claude actually RUNS, not merely that a bin exists — npm >= 11.18
# blocks postinstall scripts by default, which leaves a broken half-install.
if ! claude --version >/dev/null 2>&1; then
  npm install -g --allow-scripts=@anthropic-ai/claude-code @anthropic-ai/claude-code \
    || npm install -g @anthropic-ai/claude-code \
    || warn "npm install failed — see ANDROID.md troubleshooting"
fi
# npm sometimes fails to create the launcher on Termux — make our own shim
if ! command -v claude >/dev/null 2>&1 && [ -f "$PREFIX/lib/node_modules/@anthropic-ai/claude-code/cli.js" ]; then
  printf '#!%s/bin/sh\nexec node "%s/lib/node_modules/@anthropic-ai/claude-code/cli.js" "$@"\n' "$PREFIX" "$PREFIX" > "$PREFIX/bin/claude"
  chmod 700 "$PREFIX/bin/claude"
  echo "created claude launcher shim"
fi

step "Environment (~/.profile)"
if ! grep -q '# >>> pocket-deck >>>' ~/.profile 2>/dev/null; then
cat >> ~/.profile <<'EOF'
# >>> pocket-deck >>>
export PATH="$HOME/bin:$PATH"
export USE_BUILTIN_RIPGREP=0      # claude-code's bundled ripgrep is glibc; use Termux's
export DISABLE_AUTOUPDATER=1      # update with: npm install -g @anthropic-ai/claude-code
# <<< pocket-deck <<<
EOF
echo "added pocket-deck block to ~/.profile"
fi
export PATH="$HOME/bin:$PATH"
export USE_BUILTIN_RIPGREP=0
export DISABLE_AUTOUPDATER=1

# Office-opener wrapper. Launching `claude` pings officebot to run the arrival
# ceremony right away (the phone's real SessionStart hook is unreliable); the
# real session then adopts that already-open office, so there's never a
# duplicate. It reads your configured model so the boss wears the right face
# from the first second, not a generic one. REFRESHED every run (not
# skip-if-present) so wrapper improvements actually reach existing installs.
# Strip any prior block (matches both the old >>> and new <<< close markers)
if grep -q '>>> pocket-deck-claude-fn' ~/.profile 2>/dev/null; then
  awk '/>>> pocket-deck-claude-fn/{s=1} !s{print} /<<< pocket-deck-claude-fn/{s=0}' ~/.profile > ~/.profile.tmp && mv ~/.profile.tmp ~/.profile
fi
cat >> ~/.profile <<'EOF'
# >>> pocket-deck-claude-fn >>>
claude() {
  # Pin a session id we generate, so officebot can tag THIS exact session with
  # its deck tab — reliable even with several tabs in the same folder (folder
  # matching can't tell those apart). The office opener uses the same id, so
  # the ceremony starts at launch and Claude's own events merge into it.
  _sid=""; [ -r /proc/sys/kernel/random/uuid ] && _sid=$(cat /proc/sys/kernel/random/uuid)
  # Poke the usage poller: launching claude is exactly when you look at the
  # office, so ask for a fresh /usage pass NOW instead of up to 3 min away.
  { mkdir -p "$HOME/.deck" && touch "$HOME/.deck/usage-poke"; } 2>/dev/null
  # Restore the previous session's permission mode: Claude boots every new
  # session in manual, even if you ran the last one on auto-accept. officebot
  # remembers the last mode it saw in the hooks (/api/lastmode); ONLY the
  # auto-accept flavours are restored ("auto"/"acceptEdits" — names vary by
  # Claude version), never plan or bypassPermissions, and never when you
  # passed your own mode flag or run non-interactively (-p).
  _pmflag=""
  case " $* " in
    *" --permission-mode"*|*" --dangerously-skip-permissions"*|*" -p "*|*" --print "*) : ;;
    *)
      _pm=$(curl -s -m 1 http://127.0.0.1:4317/api/lastmode 2>/dev/null | jq -r '.mode // empty' 2>/dev/null)
      case "$_pm" in auto|acceptEdits) _pmflag="--permission-mode $_pm" ;; esac
      ;;
  esac
  # Continuing/resuming with our pinned --session-id needs --fork-session too
  # (claude rejects the combo otherwise — confirmed on-device: `claude -c`
  # errored and never started). The old conversation carries on, forked under
  # the pinned id, so the office still tags this tab. Exact-arg matching so a
  # prompt that merely MENTIONS --resume can't trigger it; skipped if you
  # passed --fork-session yourself.
  _forkflag="" _hasfork=""
  for _a in "$@"; do
    case "$_a" in
      --fork-session) _hasfork=1 ;;
      -c|--continue|-r|--resume|--resume=*) _forkflag="--fork-session" ;;
    esac
  done
  [ -n "$_hasfork" ] && _forkflag=""
  if command -v curl >/dev/null 2>&1 && [ -n "$_sid" ]; then
    _m=$(jq -r '.model // "fable"' ~/.claude/settings.json 2>/dev/null || echo fable)
    _tab=$(tmux display-message -p '#S' 2>/dev/null || echo '')   # deck-1, deck-2… = the tab
    ( curl -s -m 2 -o /dev/null -X POST -H 'Content-Type: application/json' \
        -d "{\"hook_event_name\":\"SessionStart\",\"source\":\"startup\",\"_opener\":true,\"model\":\"$_m\",\"deckTab\":\"$_tab\",\"session_id\":\"$_sid\",\"cwd\":\"$PWD\"}" \
        http://127.0.0.1:4317/event >/dev/null 2>&1 & ) >/dev/null 2>&1
    command claude --session-id "$_sid" $_pmflag $_forkflag "$@"
  else
    command claude $_pmflag "$@"
  fi
}
# <<< pocket-deck-claude-fn <<<
EOF
echo "installed/refreshed claude office-opener wrapper in ~/.profile"

step "Cloning repos (into Termux home — NOT /sdcard, git breaks there)"
mkdir -p ~/work
if [ -d ~/officebot/.git ]; then
  git -C ~/officebot pull --ff-only || warn "officebot pull failed"
else
  git clone https://github.com/Cybermumu22/officebot ~/officebot || warn "officebot clone failed"
fi

# Optional: clone YOUR OWN GitHub project to work on. Set OFFICEBOT_REPO to
# "owner/name" (after `gh auth login`) and re-run — e.g.
#   OFFICEBOT_REPO=yourname/yourproject bash termux-setup.sh
# It lands in ~/work/<name>. Left unset, nothing project-specific is cloned:
# the deck still works and new tabs open in the ready-made ~/command-deck
# workspace, where Claude can create files and you can make a repo later.
NEED_GH=0
if gh auth status >/dev/null 2>&1; then
  if [ -n "$OFFICEBOT_REPO" ]; then
    _repo_dest="$HOME/work/$(basename "$OFFICEBOT_REPO")"
    if [ -d "$_repo_dest/.git" ]; then
      git -C "$_repo_dest" pull --ff-only || warn "$OFFICEBOT_REPO pull failed (uncommitted changes on the phone?)"
    else
      { gh repo clone "$OFFICEBOT_REPO" "$_repo_dest" && gh auth setup-git; } \
        || warn "could not clone $OFFICEBOT_REPO — check the name spelling and that you have access"
    fi
  fi
else
  NEED_GH=1
fi

# Only set a git identity if the user has none yet — and use a NEUTRAL
# placeholder, never a real personal address. (This script ships in the npm
# tarball; a hardcoded email would leak it publicly AND make new users commit
# under someone else's name.) Tell them to set their own.
if ! git config --global user.email >/dev/null 2>&1; then
  git config --global user.name  "Pocket Deck User"
  git config --global user.email "pocket-deck@users.noreply.github.com"
  warn "git identity not set — using a placeholder. Set yours:"
  warn "  git config --global user.name  \"Your Name\""
  warn "  git config --global user.email \"you@example.com\""
fi

step "officebot hooks (your phone's Claude sessions appear in the office)"
if [ -f ~/officebot/cli.js ]; then
  node -e 'var r=require(process.argv[1]+"/cli.js").installHooks(4317);console.log("hooks: added "+r.added+", updated "+r.updated)' "$HOME/officebot" \
    || warn "hook install failed"
fi

step "PC parity (model, status line, theme — only fills what is missing)"
node - <<'EOF'
const fs = require('fs');
const dir = process.env.HOME + '/.claude';
const p = dir + '/settings.json';
fs.mkdirSync(dir, { recursive: true });
let s = {}; try { s = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {}
const want = {
  model: 'fable',
  effortLevel: 'xhigh',
  theme: 'dark',
  statusLine: { type: 'command', command: 'sh ~/.claude/statusline-command.sh' }
};
let changed = false;
for (const k in want) { if (!(k in s)) { s[k] = want[k]; changed = true; } }
if (changed) fs.writeFileSync(p, JSON.stringify(s, null, 2) + '\n');
console.log('settings.json: ' + (changed ? 'filled in PC defaults' : 'already set'));
EOF
if [ ! -f ~/.claude/statusline-command.sh ] && [ -f ~/officebot/termux/statusline-command.sh ]; then
  cp ~/officebot/termux/statusline-command.sh ~/.claude/statusline-command.sh
  echo "installed status line script"
fi

step "Phone context for Claude (global CLAUDE.md — every session knows the stack)"
CM=~/.claude/CLAUDE.md
SRC=~/officebot/termux/CLAUDE-android.md
if [ -f "$SRC" ]; then
  mkdir -p ~/.claude
  if [ -f "$CM" ] && grep -q '<!-- pocket-deck:begin -->' "$CM"; then
    # refresh only our managed block; the user's own notes survive
    awk '/<!-- pocket-deck:begin -->/{skip=1} !skip{print} /<!-- pocket-deck:end -->/{skip=0}' "$CM" > "$CM.tmp" \
      && cat "$SRC" >> "$CM.tmp" && mv "$CM.tmp" "$CM"
  else
    cat "$SRC" >> "$CM"
  fi
  echo "installed/refreshed pocket-deck section in ~/.claude/CLAUDE.md"
fi

step "tmux config (sessions that survive the screen turning off)"
if ! grep -q '# >>> pocket-deck >>>' ~/.tmux.conf 2>/dev/null; then
cat >> ~/.tmux.conf <<'EOF'
# >>> pocket-deck >>>
set -sg escape-time 10          # Esc must be instant (it is Claude Code's interrupt key)
set -g mouse on                 # touch scrolling in the deck terminal
set -g history-limit 10000
set -g status off               # the deck page has its own tab bar
set -g default-terminal "tmux-256color"
set -ga terminal-overrides ',xterm-256color:RGB'
# <<< pocket-deck <<<
EOF
echo "added pocket-deck block to ~/.tmux.conf"
fi
# separate from the marker block so existing installs pick it up too
grep -q 'focus-events' ~/.tmux.conf 2>/dev/null || echo 'set -g focus-events on  # claude code asks for this' >> ~/.tmux.conf
tmux source-file ~/.tmux.conf 2>/dev/null || true

step "Termux extra keys (Esc/Tab/Ctrl/arrows row inside the Termux app itself)"
mkdir -p ~/.termux
if ! grep -q 'pocket-deck' ~/.termux/termux.properties 2>/dev/null; then
  if [ -f ~/.termux/termux.properties ]; then
    cp ~/.termux/termux.properties ~/.termux/termux.properties.bak-pocket-deck
  fi
cat >> ~/.termux/termux.properties <<'EOF'
# pocket-deck extra keys
extra-keys = [ \
 ['ESC','/','!','UP','DOWN','ENTER','PGUP'], \
 ['TAB','CTRL','ALT','LEFT','RIGHT','BKSP','PGDN'] \
]
EOF
echo "configured extra keys (backup: termux.properties.bak-pocket-deck)"
fi
termux-reload-settings 2>/dev/null || true

step "Launcher scripts"
mkdir -p ~/bin ~/.shortcuts ~/.termux/boot ~/.deck

cat > ~/bin/deck-start <<'EOF'
#!/data/data/com.termux/files/usr/bin/sh
# Start the Pocket Deck stack: officebot (office viewer + deck page) and
# ttyd->tmux (the terminal). Safe to run twice — running parts are left alone.
. ~/.profile 2>/dev/null
mkdir -p ~/.deck
# Deck tabs open in ~/command-deck (same idea as the PC deck's workspace).
# Claude NEVER remembers folder trust for $HOME itself (hasTrustDialogAccepted
# stays false there by design — confirmed in ~/.claude.json), so tabs that
# start in home re-ask "do you trust this folder" on EVERY new session. A real
# project folder is asked once, then remembered. We create the folder, so we
# can also pre-answer the trust question for it (jq, backup kept) — new tabs
# go straight to the prompt.
mkdir -p ~/command-deck
if [ -s "$HOME/.claude.json" ] && command -v jq >/dev/null 2>&1; then
  if ! jq -e '.projects["'"$HOME"'/command-deck"].hasTrustDialogAccepted == true' "$HOME/.claude.json" >/dev/null 2>&1; then
    cp "$HOME/.claude.json" "$HOME/.claude.json.deck-backup" 2>/dev/null
    jq '.projects["'"$HOME"'/command-deck"].hasTrustDialogAccepted = true' "$HOME/.claude.json" > "$HOME/.claude.json.tmp" \
      && mv "$HOME/.claude.json.tmp" "$HOME/.claude.json" || rm -f "$HOME/.claude.json.tmp"
  fi
fi
termux-wake-lock 2>/dev/null
if ! pgrep -f 'officebot/server.js' >/dev/null 2>&1; then
  AGENT_VIZ_HOST=127.0.0.1 nohup node ~/officebot/server.js >> ~/.deck/officebot.log 2>&1 &
fi
if ! pgrep -f 'ttyd.*-p 7681' >/dev/null 2>&1; then
  # -i 127.0.0.1 keeps the terminal OFF the Wi-Fi network. tmux holds the real
  # session, so a dropped connection never kills what is running inside it.
  # SECURITY (CSWSH fix #1-v2): 127.0.0.1 does NOT protect a WebSocket — any
  # web page on the device could otherwise connect to ws://127.0.0.1:7681 and
  # type into the terminal. Two layers close this:
  #  1. ttyd runs with -c "deck:<secret>", so a DIRECT browser connection to
  #     :7681 is rejected (it can't send the Basic-Auth header).
  #  2. The deck connects instead to officebot's same-origin /tty, which is
  #     origin-checked and proxies to ttyd, injecting that Basic-Auth header.
  # So only the same-origin deck gets through; hostile pages are blocked at
  # both doors. (Earlier -c alone failed because the deck talked to ttyd
  # directly and couldn't send the header — the proxy is what makes -c usable.)
  if [ ! -s ~/.deck/ttyd-secret ]; then
    head -c 18 /dev/urandom | base64 | tr -d '/+=' > ~/.deck/ttyd-secret
    chmod 600 ~/.deck/ttyd-secret
  fi
  SEC=$(cat ~/.deck/ttyd-secret)
  # tmux -c: NEW deck tabs start in ~/command-deck (trusted above; a tab that
  # already exists keeps its own cwd — -A attach ignores -c). Must stay LAST
  # so ttyd's ?arg= (the tab's session name) lands right after -s.
  nohup ttyd -p 7681 -i 127.0.0.1 -W -a -c "deck:$SEC" -t disableLeaveAlert=true \
    tmux new -A -c "$HOME/command-deck" -s >> ~/.deck/ttyd.log 2>&1 &
fi
# The usage poller drives a hidden claude session to scrape /usage. That is
# automated, non-human access to the Service on a subscription (not an API
# key), which Anthropic's Consumer Terms restrict — so it is OFF by default
# and must be explicitly enabled. Without it, officebot shows honest local
# token ESTIMATES instead of the exact account %. Enable with:
#   touch ~/.deck/enable-usage-poll   (then deck-restart)
if [ -f ~/.deck/enable-usage-poll ] && ! pgrep -f 'deck-usage-poll' >/dev/null 2>&1; then
  nohup ~/bin/deck-usage-poll >> ~/.deck/usage-poll.log 2>&1 &   # real /usage -> monitors
fi
sleep 2
if curl -sf -o /dev/null http://127.0.0.1:4317/; then echo "office:   OK"; else echo "office:   FAILED (see ~/.deck/officebot.log)"; fi
# ttyd now runs with -c (a credential), so an UNauthenticated GET to /token
# correctly returns 401 — drop -f (which treats 401 as failure and printed a
# false "terminal: FAILED"). Any HTTP response means ttyd is alive; only a
# refused connection (curl exit 7) is a real failure.
if curl -s -o /dev/null http://127.0.0.1:7681/token; then echo "terminal: OK"; else echo "terminal: FAILED (see ~/.deck/ttyd.log and ANDROID.md)"; fi
echo "Pocket Deck: http://localhost:4317/deck.html"
termux-open-url http://localhost:4317/deck.html 2>/dev/null
EOF
chmod 700 ~/bin/deck-start

# Usage poller: drives a hidden claude session to run /usage every 3 min
# (instantly on each claude launch — the wrapper pokes it) and
# pushes the REAL numbers to officebot's monitors (free — /usage costs no
# tokens). The session lives in ~/.deck/usagepoll so officebot hides it from
# the office.
cat > ~/bin/deck-usage-poll <<'EOF'
#!/data/data/com.termux/files/usr/bin/sh
. ~/.profile 2>/dev/null
SESS=usagepoll
DIR="$HOME/.deck/usagepoll"
mkdir -p "$DIR"
start_claude(){
  tmux new-session -d -s "$SESS" -c "$DIR" 2>/dev/null
  tmux send-keys -t "$SESS" 'claude' Enter 2>/dev/null
  sleep 14   # boot + auth + prompt ready
  # First run in this folder shows the "Do you trust the files…" dialog and
  # blocks /usage until answered — Enter accepts the highlighted default.
  # Harmless when there's no dialog (Enter on an empty prompt is a no-op).
  tmux send-keys -t "$SESS" Enter 2>/dev/null
  sleep 2
}
tmux has-session -t "$SESS" 2>/dev/null || start_claude
MISS=0
POKE="$HOME/.deck/usage-poke"
while true; do
  rm -f "$POKE" 2>/dev/null   # the pass we're about to run satisfies any pending poke
  tmux has-session -t "$SESS" 2>/dev/null || start_claude
  tmux send-keys -t "$SESS" '/usage' Enter 2>/dev/null
  # The Usage tab loads its numbers async and a slow phone can take well over
  # 4s — poll the pane up to ~18s instead of gambling on one capture.
  GOT=
  for _try in 1 2 3 4 5 6; do
    sleep 3
    RAW=$(tmux capture-pane -t "$SESS" -p -S -120 2>/dev/null)
    case "$RAW" in *"% used"*) GOT=1; break ;; esac
  done
  tmux send-keys -t "$SESS" Escape 2>/dev/null
  if [ -n "$GOT" ]; then
    MISS=0
    printf '%s' "$RAW" | curl -s -m 6 -X POST -H 'Content-Type: text/plain' --data-binary @- http://127.0.0.1:4317/api/realusage >/dev/null 2>&1
  else
    # tmux-session-exists is NOT claude-is-alive: if claude exited (crash,
    # update, logout) the session is a bare shell that eats '/usage' silently,
    # and the old loop never noticed — the office ran on estimates forever.
    # Three straight misses → rebuild the hidden session from scratch.
    MISS=$((MISS+1))
    echo "usage capture miss $MISS/3 $(date)"
    if [ "$MISS" -ge 3 ]; then
      tmux kill-session -t "$SESS" 2>/dev/null
      MISS=0
    fi
  fi
  # Poke-aware 3-minute wait: the claude wrapper touches usage-poke at every
  # launch, which breaks out early — so the office shows fresh numbers within
  # seconds of starting claude instead of whenever the next pulse lands.
  _w=0
  while [ "$_w" -lt 60 ]; do   # 60 x 3s = the same 3 min ceiling
    [ -f "$POKE" ] && break
    sleep 3
    _w=$((_w+1))
  done
done
EOF
chmod 700 ~/bin/deck-usage-poll

cat > ~/bin/deck-stop <<'EOF'
#!/data/data/com.termux/files/usr/bin/sh
pkill -f 'deck-usage-poll' 2>/dev/null
tmux kill-session -t usagepoll 2>/dev/null   # the poller's hidden claude
pkill -f 'officebot/server.js' 2>/dev/null
pkill -f 'ttyd.*-p 7681' 2>/dev/null
termux-wake-unlock 2>/dev/null
echo "stopped officebot + ttyd + usage poller."
echo "your OWN tmux sessions (deck tabs) are still alive."
echo "to end those too: tmux kill-server"
EOF
chmod 700 ~/bin/deck-stop

cat > ~/bin/deck-restart <<'EOF'
#!/data/data/com.termux/files/usr/bin/sh
# Safe to run from INSIDE a deck tab: this shell lives in tmux, which
# survives deck-stop — the deck just reconnects once deck-start is back.
~/bin/deck-stop
sleep 1
exec ~/bin/deck-start
EOF
chmod 700 ~/bin/deck-restart

cp ~/bin/deck-start ~/.shortcuts/Pocket-Deck && chmod 700 ~/.shortcuts/Pocket-Deck
cp ~/bin/deck-start ~/.termux/boot/deck-start.sh && chmod 700 ~/.termux/boot/deck-start.sh
echo "created: deck-start, deck-stop, home-screen widget (needs Termux:Widget), boot script (needs Termux:Boot)"

step "Checking everything"
echo "node:    $(node -v 2>/dev/null || echo MISSING)"
if command -v claude >/dev/null 2>&1; then
  echo "claude:  $(claude --version 2>/dev/null || echo 'installed (version check failed — try: claude)')"
else
  warn "claude: NOT on PATH — see ANDROID.md troubleshooting"
fi
command -v rg   >/dev/null 2>&1 && echo "ripgrep: OK" || warn "ripgrep missing"
command -v tmux >/dev/null 2>&1 && echo "tmux:    OK" || warn "tmux missing"
command -v gh   >/dev/null 2>&1 && echo "gh:      OK" || warn "gh missing"
if command -v ttyd >/dev/null 2>&1; then
  (ttyd -p 7699 -i 127.0.0.1 -W true >/dev/null 2>&1 &)
  sleep 1
  if curl -sf -o /dev/null http://127.0.0.1:7699/token; then
    echo "ttyd:    OK"
  else
    warn "ttyd installed but will not start — known Termux bug; see ANDROID.md 'terminal: FAILED'"
  fi
  pkill -f 'ttyd -p 7699' 2>/dev/null
else
  warn "ttyd missing"
fi

step "DONE — one-time next steps"
cat <<'EOF'
1. GitHub login (lets you save your work):   gh auth login
     (choose: GitHub.com -> HTTPS -> Login with a web browser)

2. Claude login:   cd ~/command-deck && claude
     (follow the login link it prints and sign in with your Claude account,
      then type  exit  to leave — the deck opens its own tabs for you)

3. Start it:       deck-start
     Chrome opens the deck. Chrome menu (⋮) -> Add to Home screen -> Install
     = "Pocket Deck" becomes an app on your home screen.

4. Android Settings -> Apps -> Termux -> Battery -> Unrestricted
     (stops Android from killing your sessions in the background)

Want to work on your OWN GitHub project?  After step 1, either:
     gh repo clone YOUR-NAME/YOUR-REPO ~/work/YOUR-REPO
   or re-run:  OFFICEBOT_REPO=YOUR-NAME/YOUR-REPO bash termux-setup.sh
   Then open ~/work/YOUR-REPO in a deck tab. No repo yet? Just work in
   ~/command-deck — Claude can make files there and you can create a repo later.
EOF
if [ "$NEED_GH" = "1" ]; then
  warn "Not logged in to GitHub yet — do step 1 (gh auth login) so you can save your work."
fi
