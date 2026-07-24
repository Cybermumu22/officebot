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

step "Cloning repos (into Termux home — NOT /sdcard, git breaks there)"
mkdir -p ~/work
if [ -d ~/officebot/.git ]; then
  git -C ~/officebot pull --ff-only || warn "officebot pull failed"
else
  git clone https://github.com/Cybermumu22/officebot ~/officebot || warn "officebot clone failed"
fi

NEED_GH=0
if [ -d ~/work/CyberShield/.git ]; then
  git -C ~/work/CyberShield pull --ff-only || warn "CyberShield pull failed (uncommitted changes on the phone?)"
elif gh auth status >/dev/null 2>&1; then
  { gh repo clone Cybermumu22/CyberShield ~/work/CyberShield && gh auth setup-git; } \
    || warn "CyberShield clone failed"
else
  NEED_GH=1
fi

git config --global user.name  >/dev/null 2>&1 || git config --global user.name  "Mumudrummer"
git config --global user.email >/dev/null 2>&1 || git config --global user.email "alahai1234@gmail.com"

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
termux-wake-lock 2>/dev/null
if ! pgrep -f 'officebot/server.js' >/dev/null 2>&1; then
  AGENT_VIZ_HOST=127.0.0.1 nohup node ~/officebot/server.js >> ~/.deck/officebot.log 2>&1 &
fi
if ! pgrep -f 'ttyd.*-p 7681' >/dev/null 2>&1; then
  # -i 127.0.0.1 keeps the terminal OFF the Wi-Fi network. tmux holds the real
  # session, so a dropped connection never kills what is running inside it.
  nohup ttyd -p 7681 -i 127.0.0.1 -W -a -t disableLeaveAlert=true \
    tmux new -A -s >> ~/.deck/ttyd.log 2>&1 &
fi
sleep 2
if curl -sf -o /dev/null http://127.0.0.1:4317/; then echo "office:   OK"; else echo "office:   FAILED (see ~/.deck/officebot.log)"; fi
if curl -sf -o /dev/null http://127.0.0.1:7681/token; then echo "terminal: OK"; else echo "terminal: FAILED (see ~/.deck/ttyd.log and ANDROID.md)"; fi
echo "Pocket Deck: http://localhost:4317/deck.html"
termux-open-url http://localhost:4317/deck.html 2>/dev/null
EOF
chmod 700 ~/bin/deck-start

cat > ~/bin/deck-stop <<'EOF'
#!/data/data/com.termux/files/usr/bin/sh
pkill -f 'officebot/server.js' 2>/dev/null
pkill -f 'ttyd.*-p 7681' 2>/dev/null
termux-wake-unlock 2>/dev/null
echo "stopped officebot + ttyd."
echo "tmux sessions (your shells / Claude) are still alive."
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
1. GitHub login:   gh auth login
     (GitHub.com -> HTTPS -> Login with a web browser)
     Then RUN THIS SCRIPT AGAIN so it clones your CyberShield repo.

2. Claude login:   cd ~/work/CyberShield && claude
     (follow the login link it prints; sign in with your Claude account)

3. Start it:       deck-start
     Chrome opens the deck. Chrome menu (⋮) -> Add to Home screen -> Install
     = "Pocket Deck" becomes an app on your home screen.

4. Android Settings -> Apps -> Termux -> Battery -> Unrestricted
     (stops Android from killing your sessions in the background)
EOF
if [ "$NEED_GH" = "1" ]; then
  warn "CyberShield is NOT cloned yet — do step 1, then re-run: bash termux-setup.sh"
fi
