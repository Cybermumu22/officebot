// Demo: plays a fake but realistic Claude Code session through the dashboard
// so you can watch it live without needing a real session running.
// Usage: node demo.js   (make sure server.js is already running and
//                        http://localhost:4317 is open in your browser)
const http = require('http');

const PORT = process.env.AGENT_VIZ_PORT || 4317;
const SEP = String.fromCharCode(92); // backslash, built at runtime so it can't be mis-typed in a string literal

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
  const cwd = winPath(['C:', 'Users', 'demo', 'projects', 'my-app']);

  await post({ hook_event_name: 'SessionStart', session_id: main1, cwd, source: 'startup' });
  console.log('-> session powered on');
  await wait(1200);

  await post({ hook_event_name: 'UserPromptSubmit', session_id: main1, user_input: 'fix the sidebar title clipping' });
  console.log('-> thinking...');
  await wait(1500);

  await post({ hook_event_name: 'PreToolUse', session_id: main1, tool_name: 'Grep', tool_input: { pattern: 'rail-brand' } });
  console.log('-> Grep');
  await wait(1300);
  await post({ hook_event_name: 'PostToolUse', session_id: main1, tool_name: 'Grep' });
  await wait(700);

  await post({ hook_event_name: 'PreToolUse', session_id: main1, tool_name: 'Read', tool_input: { file_path: 'index.html' } });
  console.log('-> Read');
  await wait(1300);
  await post({ hook_event_name: 'PostToolUse', session_id: main1, tool_name: 'Read' });
  await wait(700);

  // spawn two subagents doing research in parallel
  const sub1 = 'demo-sub1-' + Date.now();
  await post({ hook_event_name: 'SubagentStart', session_id: main1, agent_id: sub1, agent_type: 'Explore' });
  console.log('-> subagent spawned: Explore');
  await wait(900);

  const sub2 = 'demo-sub2-' + Date.now();
  await post({ hook_event_name: 'SubagentStart', session_id: main1, agent_id: sub2, agent_type: 'general-purpose' });
  console.log('-> subagent spawned: general-purpose');
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

  await post({ hook_event_name: 'PreToolUse', session_id: main1, tool_name: 'Edit', tool_input: { file_path: 'index.html' } });
  console.log('-> main session applying the fix');
  await wait(1400);
  await post({ hook_event_name: 'PostToolUse', session_id: main1, tool_name: 'Edit' });
  await wait(700);

  await post({ hook_event_name: 'Stop', session_id: main1 });
  console.log('-> turn complete, back to standby');

  // a second, quieter session just sitting idle for visual contrast
  const main2 = 'demo-main2-' + Date.now();
  await post({ hook_event_name: 'SessionStart', session_id: main2, cwd: winPath(['C:', 'Users', 'demo', 'other-project']), source: 'startup' });
  await post({ hook_event_name: 'Stop', session_id: main2 });
  console.log('-> a second idle session appears for contrast');

  console.log('\nDone. Terminals stay on screen — subagents clear after ~6s idle,');
  console.log('sessions only disappear on a real SessionEnd (not sent by this demo).');
}

main().catch(err => {
  console.error('Demo failed — is the server running? (node server.js)');
  console.error(err.message);
  process.exit(1);
});
