// Demo: plays a fake but realistic Claude Code session through the dashboard
// so you can watch it live without needing a real session running.
// Usage: node demo.js   (make sure server.js is already running and
//                        http://localhost:4317 is open in your browser)
const http = require('http');

const PORT = process.env.AGENT_VIZ_PORT || 4317;
const SEP = String.fromCharCode(92); // backslash, built at runtime so it can't be mis-typed in a string literal

// The boss persona comes from the MODEL on a main-session event — the client
// maps /fable/→Fabby, /opus/→Oppy, /sonnet/→Sonny, /haiku/→Kiku and locks a
// per-model face to match (see nicknameForModel/avatarForModel in avatars.js).
// Without one, displayName() falls all the way through to the raw roster
// avatar name, which is what this demo used to show. Two different models so
// the demo also shows the office rank system (Director vs Lead).
const MODEL_1 = 'claude-fable-5';    // -> Fabby, Director
const MODEL_2 = 'claude-sonnet-5';   // -> Sonny, Lead

function post(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { hostname: 'localhost', port: PORT, path: '/event', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      res => { res.resume(); res.on('end', resolve); }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
function winPath(parts) { return parts.join(SEP); }

async function main() {
  console.log('Sending demo events to http://localhost:' + PORT + ' ...');
  console.log('Watch http://localhost:' + PORT + ' in your browser while this runs.\n');

  const main1 = 'demo-main-' + Date.now();
  const cwd = winPath(['C:', 'Users', 'demo', 'projects', 'aurora-api']);
  // every MAIN-session event carries the model; subagent events deliberately
  // do NOT (a subagent's turns aren't in the main transcript, so a real one
  // never has a model — give it one here and the crew would all be "Fabby")
  const boss = { session_id: main1, model: MODEL_1 };

  await post({ hook_event_name: 'SessionStart', ...boss, cwd, source: 'startup' });
  console.log('-> session powered on (boss: Fabby / Fable, Director)');
  await wait(1200);

  await post({ hook_event_name: 'UserPromptSubmit', ...boss, user_input: 'fix the sidebar title clipping' });
  console.log('-> thinking...');
  await wait(1500);

  await post({ hook_event_name: 'PreToolUse', ...boss, tool_name: 'Grep', tool_input: { pattern: 'rail-brand' } });
  console.log('-> Grep');
  await wait(1300);
  await post({ hook_event_name: 'PostToolUse', ...boss, tool_name: 'Grep' });
  await wait(700);

  await post({ hook_event_name: 'PreToolUse', ...boss, tool_name: 'Read', tool_input: { file_path: 'index.html' } });
  console.log('-> Read');
  await wait(1300);
  await post({ hook_event_name: 'PostToolUse', ...boss, tool_name: 'Read' });
  await wait(700);

  // spawn two subagents doing research in parallel (no model on these — see above)
  const sub1 = 'demo-sub1-' + Date.now();
  await post({ hook_event_name: 'SubagentStart', session_id: main1, agent_id: sub1, agent_type: 'Explore' });
  console.log('-> subagent spawned: Explore (Scout)');
  await wait(900);

  const sub2 = 'demo-sub2-' + Date.now();
  await post({ hook_event_name: 'SubagentStart', session_id: main1, agent_id: sub2, agent_type: 'general-purpose' });
  console.log('-> subagent spawned: general-purpose (Jack)');
  await wait(900);

  await post({ hook_event_name: 'PreToolUse', session_id: main1, agent_id: sub1, agent_type: 'Explore', tool_name: 'Glob', tool_input: { pattern: '**/*.css' } });
  await post({ hook_event_name: 'PreToolUse', session_id: main1, agent_id: sub2, agent_type: 'general-purpose', tool_name: 'Bash', tool_input: { command: 'npm test' } });
  console.log('-> both subagents working');
  await wait(2200);

  await post({ hook_event_name: 'PostToolUseFailure', session_id: main1, agent_id: sub2, agent_type: 'general-purpose', tool_name: 'Bash' });
  console.log('-> a tool failed (watch it glitch red)');
  await wait(1800);

  await post({ hook_event_name: 'PostToolUse', session_id: main1, agent_id: sub1, agent_type: 'Explore' });
  await post({ hook_event_name: 'SubagentStop', session_id: main1, agent_id: sub1, agent_type: 'Explore' });
  console.log('-> Explore finished (green check, fades out after 6s)');
  await wait(1200);

  await post({ hook_event_name: 'SubagentStop', session_id: main1, agent_id: sub2, agent_type: 'general-purpose' });
  console.log('-> general-purpose finished too');
  await wait(1500);

  await post({ hook_event_name: 'PreToolUse', ...boss, tool_name: 'Edit', tool_input: { file_path: 'index.html' } });
  console.log('-> main session applying the fix');
  await wait(1400);
  await post({ hook_event_name: 'PostToolUse', ...boss, tool_name: 'Edit' });
  await wait(700);

  await post({ hook_event_name: 'Stop', ...boss });
  console.log('-> turn complete, back to standby');

  // a second, quieter session just sitting idle for visual contrast — a
  // DIFFERENT model, so the two offices show two ranks side by side
  const main2 = 'demo-main2-' + Date.now();
  const boss2 = { session_id: main2, model: MODEL_2 };
  await post({ hook_event_name: 'SessionStart', ...boss2, cwd: winPath(['C:', 'Users', 'demo', 'projects', 'mobile-app']), source: 'startup' });
  await post({ hook_event_name: 'Stop', ...boss2 });
  console.log('-> a second idle session appears (boss: Sonny / Sonnet, Lead)');

  console.log('\nDone. Terminals stay on screen — subagents clear after ~6s idle,');
  console.log('sessions only disappear on a real SessionEnd (not sent by this demo).');
}

main().catch(err => {
  console.error('Demo failed — is the server running? (node server.js)');
  console.error(err.message);
  process.exit(1);
});
