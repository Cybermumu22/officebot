#!/usr/bin/env node
'use strict';
// officebot CLI — one command to wire Claude Code up to the dashboard and run it.
//   npx officebot setup    wire hooks + start + open the browser
//   npx officebot          start (short for `start`)
//   npx officebot remove   cleanly remove the hooks again
//   npx officebot demo      play a fake session so you can see it work
// Zero dependencies — Node built-ins only.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_PORT = 4317;
// Override for tests / non-standard installs; defaults to the real location.
const SETTINGS_PATH = process.env.AGENT_VIZ_SETTINGS || path.join(os.homedir(), '.claude', 'settings.json');
// Every Claude Code hook we relay to the dashboard. Each simply POSTs the hook
// payload to the local server; the dashboard turns them into the office view.
const HOOK_EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'PostToolUseFailure', 'SubagentStart', 'SubagentStop', 'Stop', 'SessionEnd',
];

// ---- tiny arg parser ----
function parseArgs(argv) {
  // default port from the env var if set, so `AGENT_VIZ_PORT=… ` works too;
  // an explicit --port still wins over it.
  const envPort = parseInt(process.env.AGENT_VIZ_PORT, 10);
  const out = { _: [], port: envPort || DEFAULT_PORT, open: true, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') { out.port = parseInt(argv[++i], 10) || DEFAULT_PORT; }
    else if (a === '--no-open') { out.open = false; }
    else if (a === '--yes' || a === '-y') { out.yes = true; }
    else if (a === '--help' || a === '-h') { out._.push('help'); }
    else out._.push(a);
  }
  return out;
}

const C = { // minimal ANSI, safe to print anywhere
  b: (s) => '\x1b[1m' + s + '\x1b[0m',
  g: (s) => '\x1b[32m' + s + '\x1b[0m',
  y: (s) => '\x1b[33m' + s + '\x1b[0m',
  c: (s) => '\x1b[36m' + s + '\x1b[0m',
  dim: (s) => '\x1b[2m' + s + '\x1b[0m',
};

function hookUrl(port) { return 'http://localhost:' + port + '/event'; }
function ourHookEntry(port) { return { type: 'http', url: hookUrl(port), timeout: 5 }; }
// Recognise OUR hooks (localhost .../event http hooks) so setup is idempotent
// and remove only takes ours — never anything else the user configured.
function isOurHook(h) {
  return h && h.type === 'http' && typeof h.url === 'string'
    && /^https?:\/\/(localhost|127\.0\.0\.1):\d+\/event$/.test(h.url);
}

function readSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) return { obj: {}, existed: false };
  let raw;
  try { raw = fs.readFileSync(SETTINGS_PATH, 'utf8'); }
  catch (e) { throw new Error('Could not read ' + SETTINGS_PATH + ' (' + e.message + ')'); }
  if (!raw.trim()) return { obj: {}, existed: true };
  try { return { obj: JSON.parse(raw), existed: true, raw: raw }; }
  catch (e) {
    throw new Error('Your ' + SETTINGS_PATH + ' is not valid JSON, so I stopped rather than\n'
      + '  risk breaking it. Fix the JSON (or move it aside) and run setup again.');
  }
}

function backupSettings(raw) {
  if (raw == null) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bak = SETTINGS_PATH + '.officebot-backup-' + stamp;
  try { fs.writeFileSync(bak, raw); return bak; } catch (e) { return null; }
}

function writeSettings(obj) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(obj, null, 2) + '\n');
}

// ---- setup: merge our hooks in, non-destructively ----
function installHooks(port) {
  const { obj, existed, raw } = readSettings();
  const bak = existed ? backupSettings(raw) : null;
  if (!obj.hooks || typeof obj.hooks !== 'object') obj.hooks = {};
  let added = 0, updated = 0;
  HOOK_EVENTS.forEach(function (ev) {
    if (!Array.isArray(obj.hooks[ev])) obj.hooks[ev] = [];
    const groups = obj.hooks[ev];
    let found = false;
    groups.forEach(function (g) {
      if (g && Array.isArray(g.hooks)) g.hooks.forEach(function (h) {
        if (isOurHook(h)) { h.url = hookUrl(port); h.timeout = 5; found = true; updated++; }
      });
    });
    if (!found) { groups.push({ matcher: '', hooks: [ourHookEntry(port)] }); added++; }
  });
  writeSettings(obj);
  return { added: added, updated: updated, backup: bak };
}

function removeHooks() {
  const { obj, existed, raw } = readSettings();
  if (!existed || !obj.hooks) return { removed: 0, backup: null };
  const bak = backupSettings(raw);
  let removed = 0;
  HOOK_EVENTS.forEach(function (ev) {
    const groups = obj.hooks[ev];
    if (!Array.isArray(groups)) return;
    const kept = [];
    groups.forEach(function (g) {
      if (g && Array.isArray(g.hooks)) {
        const before = g.hooks.length;
        g.hooks = g.hooks.filter(function (h) { return !isOurHook(h); });
        removed += before - g.hooks.length;
      }
      // drop a group we emptied out; keep groups that still hold other hooks
      if (!g || !Array.isArray(g.hooks) || g.hooks.length > 0) kept.push(g);
    });
    if (kept.length) obj.hooks[ev] = kept; else delete obj.hooks[ev];
  });
  if (obj.hooks && Object.keys(obj.hooks).length === 0) delete obj.hooks;
  writeSettings(obj);
  return { removed: removed, backup: bak };
}

// ---- run the server (in-process) + open a browser ----
function startServer(port, open) {
  process.env.AGENT_VIZ_PORT = String(port);
  const url = 'http://localhost:' + port;
  require(path.join(__dirname, 'server.js')); // top-level server.listen() starts it
  if (open) setTimeout(function () { openBrowser(url); }, 600);
  console.log('\n  ' + C.b('officebot') + ' is live at ' + C.c(url));
  console.log('  ' + C.dim('On your phone: open that URL over your local network (see the README).'));
  console.log('  ' + C.dim('Leave this window running. Press Ctrl+C to stop.\n'));
}

function openBrowser(url) {
  try {
    const plat = process.platform;
    if (plat === 'win32') spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
    else if (plat === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch (e) { /* no browser is fine — the URL is printed above */ }
}

function runDemo(port) {
  process.env.AGENT_VIZ_PORT = String(port);
  spawn(process.execPath, [path.join(__dirname, 'demo.js')], { stdio: 'inherit' });
}

function help() {
  console.log([
    '',
    '  ' + C.b('officebot') + ' — a live "office" dashboard for your Claude Code sessions',
    '',
    '  ' + C.b('Usage:'),
    '    npx officebot ' + C.c('setup') + '     wire Claude Code to the dashboard, then start it',
    '    npx officebot ' + C.c('start') + '     just start the dashboard (default)',
    '    npx officebot ' + C.c('remove') + '    cleanly remove the hooks it added',
    '    npx officebot ' + C.c('demo') + '      start + play a fake session so you can see it work',
    '',
    '  ' + C.b('Options:'),
    '    --port <n>   port to run on (default ' + DEFAULT_PORT + ')',
    '    --no-open    don\'t open a browser automatically',
    '    -y, --yes    skip confirmation prompts',
    '',
    '  ' + C.dim('Everything stays on your machine — it reads your local Claude Code logs') ,
    '  ' + C.dim('and serves a localhost page. Nothing is sent anywhere.'),
    '',
  ].join('\n'));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || 'start';

  if (cmd === 'help') return help();

  if (cmd === 'setup') {
    console.log('\n  Wiring Claude Code to officebot ' + C.dim('(port ' + args.port + ')') + '…');
    let res;
    try { res = installHooks(args.port); }
    catch (e) { console.error('\n  ' + C.y('Could not update settings:') + '\n  ' + e.message + '\n'); process.exit(1); }
    console.log('  ' + C.g('✓') + ' ' + (res.added + res.updated) + ' hooks wired in '
      + C.dim('(' + res.added + ' added, ' + res.updated + ' already present)'));
    if (res.backup) console.log('  ' + C.dim('backup: ' + res.backup));
    console.log('  ' + C.dim('New Claude Code sessions will now appear on the dashboard.'));
    return startServer(args.port, args.open);
  }

  if (cmd === 'remove' || cmd === 'uninstall') {
    let res;
    try { res = removeHooks(); }
    catch (e) { console.error('\n  ' + C.y(e.message) + '\n'); process.exit(1); }
    console.log('\n  ' + C.g('✓') + ' removed ' + res.removed + ' officebot hook(s) from your settings.');
    if (res.backup) console.log('  ' + C.dim('backup: ' + res.backup));
    console.log('  ' + C.dim('The dashboard server itself is untouched; just close its window.\n'));
    return;
  }

  if (cmd === 'demo') { runDemo(args.port); return startServer(args.port, args.open); }
  if (cmd === 'start') return startServer(args.port, args.open);

  console.log('  Unknown command: ' + cmd);
  help();
  process.exit(1);
}

if (require.main === module) main();
module.exports = { installHooks: installHooks, removeHooks: removeHooks, isOurHook: isOurHook };
