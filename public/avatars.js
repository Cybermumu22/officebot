// Pixel-art character roster, ported from Cyber Hub (index.html AVATARS — the hero
// roster, not the virus/boss enemies). Every session and subagent draws from this set.
const AVATARS = [
  {id:1, name:'Ghost.exe', role:'Dark Net Hacker', svg:`<svg viewBox="0 0 32 32" shape-rendering="crispEdges"><rect x="6" y="0" width="20" height="16" fill="#1e1b4b"/><rect x="6" y="0" width="20" height="3" fill="#312e81"/><rect x="4" y="4" width="2" height="12" fill="#1e1b4b"/><rect x="26" y="4" width="2" height="12" fill="#1e1b4b"/><rect x="9" y="5" width="14" height="9" fill="#0c0e1c"/><rect x="11" y="8" width="4" height="3" fill="#10b981"/><rect x="17" y="8" width="4" height="3" fill="#10b981"/><rect x="12" y="9" width="2" height="1" fill="#6ee7b7"/><rect x="18" y="9" width="2" height="1" fill="#6ee7b7"/><rect x="11" y="12" width="10" height="1" fill="#10b981"/><rect x="7" y="16" width="18" height="12" fill="#1e1b4b"/><rect x="7" y="16" width="18" height="2" fill="#312e81"/><rect x="10" y="20" width="12" height="1" fill="#10b981"/><rect x="10" y="22" width="8" height="1" fill="#10b981"/><rect x="10" y="24" width="10" height="1" fill="#10b981"/></svg>`},
  {id:2, name:'CyberKnight', role:'Network Defender', svg:`<svg viewBox="0 0 32 32" shape-rendering="crispEdges"><rect x="9" y="2" width="14" height="10" fill="#1e293b"/><rect x="9" y="2" width="14" height="2" fill="#334155"/><rect x="11" y="6" width="10" height="4" fill="#0c0e1c"/><rect x="12" y="7" width="8" height="2" fill="#06b6d4"/><rect x="13" y="7" width="6" height="2" fill="#a5f3fc"/><rect x="5" y="12" width="6" height="8" fill="#334155"/><rect x="21" y="12" width="6" height="8" fill="#334155"/><rect x="5" y="12" width="6" height="2" fill="#475569"/><rect x="21" y="12" width="6" height="2" fill="#475569"/><rect x="9" y="12" width="14" height="14" fill="#1e293b"/><rect x="9" y="12" width="14" height="3" fill="#334155"/><rect x="13" y="16" width="6" height="6" fill="#06b6d4"/><rect x="14" y="17" width="4" height="4" fill="#0891b2"/><rect x="15" y="18" width="2" height="2" fill="#a5f3fc"/><rect x="10" y="26" width="5" height="4" fill="#1e293b"/><rect x="17" y="26" width="5" height="4" fill="#1e293b"/><rect x="10" y="29" width="5" height="2" fill="#334155"/><rect x="17" y="29" width="5" height="2" fill="#334155"/></svg>`},
  {id:3, name:'RedAgent', role:'Penetration Tester', svg:`<svg viewBox="0 0 32 32" shape-rendering="crispEdges"><rect x="7" y="1" width="18" height="5" fill="#7f1d1d"/><rect x="9" y="0" width="14" height="2" fill="#991b1b"/><rect x="9" y="6" width="14" height="10" fill="#1c1917"/><rect x="9" y="6" width="14" height="2" fill="#292524"/><rect x="10" y="8" width="12" height="4" fill="#0c0e1c"/><rect x="11" y="9" width="10" height="2" fill="#e63946"/><rect x="12" y="9" width="8" height="2" fill="#fca5a5"/><rect x="8" y="16" width="16" height="12" fill="#1c1917"/><rect x="8" y="16" width="16" height="3" fill="#292524"/><rect x="10" y="20" width="4" height="3" fill="#292524"/><rect x="18" y="20" width="4" height="3" fill="#292524"/><rect x="4" y="16" width="4" height="10" fill="#1c1917"/><rect x="24" y="16" width="4" height="10" fill="#1c1917"/><rect x="24" y="22" width="6" height="2" fill="#78716c"/></svg>`},
  {id:4, name:'AI.Oracle', role:'Threat Intelligence', svg:`<svg viewBox="0 0 32 32" shape-rendering="crispEdges"><rect x="4" y="15" width="24" height="2" fill="#7c3aed"/><rect x="15" y="4" width="2" height="24" fill="#7c3aed"/><rect x="8" y="8" width="16" height="16" fill="#1e1b4b"/><rect x="8" y="8" width="16" height="3" fill="#312e81"/><rect x="8" y="21" width="16" height="3" fill="#0c0a29"/><rect x="12" y="13" width="8" height="6" fill="#7c3aed"/><rect x="13" y="14" width="6" height="4" fill="#a78bfa"/><rect x="14" y="15" width="4" height="2" fill="#ede9fe"/><rect x="8" y="8" width="2" height="2" fill="#7c3aed"/><rect x="22" y="8" width="2" height="2" fill="#7c3aed"/><rect x="8" y="22" width="2" height="2" fill="#7c3aed"/><rect x="22" y="22" width="2" height="2" fill="#7c3aed"/><rect x="12" y="26" width="8" height="2" fill="#312e81"/><rect x="14" y="28" width="4" height="2" fill="#1e1b4b"/></svg>`},
  {id:5, name:'Zer0Day', role:'Exploit Researcher', svg:`<svg viewBox="0 0 32 32" shape-rendering="crispEdges"><rect x="9" y="3" width="14" height="12" fill="#0c0e1c"/><rect x="9" y="3" width="14" height="2" fill="#1c1f2e"/><rect x="10" y="5" width="12" height="8" fill="#1a1a2e"/><rect x="11" y="7" width="4" height="4" fill="#f59e0b"/><rect x="12" y="8" width="2" height="2" fill="#0c0e1c"/><rect x="17" y="7" width="4" height="4" fill="#f59e0b"/><rect x="18" y="8" width="2" height="2" fill="#0c0e1c"/><rect x="11" y="12" width="10" height="2" fill="#f59e0b"/><rect x="11" y="12" width="2" height="2" fill="#0c0e1c"/><rect x="15" y="12" width="2" height="2" fill="#0c0e1c"/><rect x="19" y="12" width="2" height="2" fill="#0c0e1c"/><rect x="7" y="15" width="18" height="13" fill="#1a1a2e"/><rect x="7" y="15" width="18" height="2" fill="#252540"/><rect x="12" y="20" width="8" height="1" fill="#f59e0b"/><rect x="12" y="22" width="8" height="1" fill="#f59e0b"/></svg>`},
  {id:6, name:'F1rewall', role:'Perimeter Guardian', svg:`<svg viewBox="0 0 32 32" shape-rendering="crispEdges"><rect x="8" y="3" width="16" height="12" fill="#292524"/><rect x="8" y="3" width="16" height="2" fill="#44403c"/><rect x="15" y="0" width="2" height="3" fill="#f97316"/><rect x="14" y="1" width="4" height="1" fill="#fdba74"/><rect x="10" y="7" width="12" height="5" fill="#0c0e1c"/><rect x="11" y="8" width="10" height="3" fill="#7c2d12"/><rect x="12" y="8" width="8" height="3" fill="#f97316"/><rect x="13" y="9" width="6" height="1" fill="#fdba74"/><rect x="7" y="15" width="18" height="13" fill="#292524"/><rect x="7" y="15" width="18" height="2" fill="#44403c"/><rect x="9" y="19" width="4" height="4" fill="#7c2d12"/><rect x="14" y="19" width="4" height="4" fill="#9a3412"/><rect x="19" y="19" width="4" height="4" fill="#7c2d12"/><rect x="9" y="19" width="4" height="1" fill="#f97316"/><rect x="14" y="19" width="4" height="1" fill="#f97316"/><rect x="19" y="19" width="4" height="1" fill="#f97316"/><rect x="9" y="28" width="5" height="4" fill="#292524"/><rect x="18" y="28" width="5" height="4" fill="#292524"/></svg>`},
  {id:7, name:'CryptWitch', role:'Encryption Specialist', svg:`<svg viewBox="0 0 32 32" shape-rendering="crispEdges"><rect x="14" y="0" width="4" height="4" fill="#4c1d95"/><rect x="12" y="4" width="8" height="3" fill="#5b21b6"/><rect x="9" y="7" width="14" height="2" fill="#6d28d9"/><rect x="10" y="9" width="12" height="8" fill="#1e1b4b"/><rect x="10" y="9" width="12" height="2" fill="#2e2b5e"/><rect x="12" y="12" width="3" height="3" fill="#a78bfa"/><rect x="17" y="12" width="3" height="3" fill="#a78bfa"/><rect x="13" y="13" width="1" height="1" fill="#ede9fe"/><rect x="18" y="13" width="1" height="1" fill="#ede9fe"/><rect x="8" y="17" width="16" height="13" fill="#2e1065"/><rect x="8" y="17" width="16" height="2" fill="#4c1d95"/><rect x="24" y="10" width="2" height="18" fill="#6d28d9"/><rect x="23" y="12" width="2" height="1" fill="#a78bfa"/><rect x="25" y="14" width="2" height="1" fill="#a78bfa"/><rect x="23" y="16" width="2" height="1" fill="#a78bfa"/><rect x="23" y="8" width="4" height="4" fill="#7c3aed"/><rect x="24" y="9" width="2" height="2" fill="#c4b5fd"/></svg>`},
  {id:8, name:'PacketSniper', role:'Network Analyst', svg:`<svg viewBox="0 0 32 32" shape-rendering="crispEdges"><rect x="10" y="3" width="12" height="10" fill="#1c1917"/><rect x="10" y="3" width="12" height="2" fill="#292524"/><rect x="11" y="7" width="10" height="4" fill="#0c0e1c"/><rect x="15" y="6" width="2" height="6" fill="#10b981"/><rect x="12" y="8" width="8" height="2" fill="#10b981"/><rect x="15" y="8" width="2" height="2" fill="#6ee7b7"/><rect x="7" y="13" width="18" height="17" fill="#1c1917"/><rect x="7" y="13" width="18" height="2" fill="#292524"/><rect x="13" y="13" width="6" height="8" fill="#0c0e1c"/><rect x="14" y="13" width="4" height="8" fill="#1c1917"/><rect x="7" y="13" width="4" height="6" fill="#292524"/><rect x="21" y="13" width="4" height="6" fill="#292524"/><rect x="22" y="18" width="10" height="2" fill="#44403c"/><rect x="28" y="16" width="2" height="2" fill="#78716c"/><rect x="22" y="19" width="4" height="1" fill="#78716c"/></svg>`},
  {id:9, name:'NullPtr', role:'Bug Hunter', svg:`<svg viewBox="0 0 32 32" shape-rendering="crispEdges"><rect x="8" y="3" width="16" height="12" fill="#1e293b"/><rect x="8" y="3" width="16" height="2" fill="#334155"/><rect x="6" y="6" width="8" height="3" fill="#e63946"/><rect x="18" y="7" width="8" height="3" fill="#e63946"/><rect x="10" y="8" width="4" height="3" fill="#0c0e1c"/><rect x="11" y="9" width="2" height="1" fill="#e63946"/><rect x="18" y="8" width="4" height="3" fill="#0c0e1c"/><rect x="19" y="8" width="3" height="1" fill="#94a3b8"/><rect x="11" y="12" width="10" height="2" fill="#e63946"/><rect x="13" y="12" width="2" height="2" fill="#0c0e1c"/><rect x="17" y="12" width="2" height="2" fill="#0c0e1c"/><rect x="8" y="15" width="16" height="13" fill="#1e293b"/><rect x="8" y="15" width="16" height="2" fill="#334155"/><rect x="6" y="18" width="6" height="2" fill="#e63946"/><rect x="22" y="21" width="6" height="2" fill="#e63946"/><rect x="13" y="20" width="6" height="4" fill="#334155"/><rect x="14" y="21" width="4" height="2" fill="#e63946"/><rect x="13" y="21" width="2" height="1" fill="#0c0e1c"/><rect x="17" y="22" width="2" height="1" fill="#0c0e1c"/></svg>`},
  {id:10, name:'NeuralNet', role:'AI Security Analyst', svg:`<svg viewBox="0 0 32 32" shape-rendering="crispEdges"><rect x="8" y="8" width="16" height="18" fill="#0c1a2e"/><rect x="8" y="8" width="16" height="3" fill="#0e7490"/><rect x="8" y="23" width="16" height="3" fill="#0c4a6e"/><rect x="6" y="10" width="2" height="16" fill="#0c1a2e"/><rect x="24" y="10" width="2" height="16" fill="#0c1a2e"/><rect x="7" y="6" width="18" height="3" fill="#0e7490"/><rect x="11" y="12" width="10" height="8" fill="#7c3aed"/><rect x="10" y="14" width="12" height="4" fill="#7c3aed"/><rect x="11" y="12" width="10" height="2" fill="#a78bfa"/><rect x="12" y="14" width="2" height="4" fill="#6d28d9"/><rect x="15" y="13" width="2" height="5" fill="#6d28d9"/><rect x="18" y="14" width="2" height="4" fill="#6d28d9"/><rect x="12" y="15" width="2" height="2" fill="#22d3ee"/><rect x="18" y="15" width="2" height="2" fill="#22d3ee"/><rect x="4" y="14" width="4" height="1" fill="#06b6d4"/><rect x="4" y="18" width="4" height="1" fill="#06b6d4"/><rect x="24" y="14" width="4" height="1" fill="#06b6d4"/><rect x="24" y="18" width="4" height="1" fill="#06b6d4"/><rect x="10" y="28" width="12" height="3" fill="#0e7490"/></svg>`},
  {id:11, name:'Pr0xyGhost', role:'Identity Specialist', svg:`<svg viewBox="0 0 32 32" shape-rendering="crispEdges"><rect x="7" y="5" width="18" height="20" fill="#1e1b4b"/><rect x="5" y="9" width="2" height="14" fill="#1e1b4b"/><rect x="25" y="9" width="2" height="14" fill="#1e1b4b"/><rect x="7" y="5" width="18" height="3" fill="#312e81"/><rect x="7" y="8" width="9" height="10" fill="#0c0a29"/><rect x="16" y="8" width="9" height="10" fill="#1a0a0a"/><rect x="9" y="12" width="4" height="3" fill="#06b6d4"/><rect x="10" y="13" width="2" height="1" fill="#a5f3fc"/><rect x="19" y="12" width="4" height="3" fill="#e63946"/><rect x="20" y="13" width="2" height="1" fill="#fca5a5"/><rect x="15" y="8" width="2" height="10" fill="#7c3aed"/><rect x="7" y="25" width="4" height="4" fill="#1e1b4b"/><rect x="15" y="25" width="4" height="4" fill="#1e1b4b"/><rect x="23" y="25" width="2" height="3" fill="#1e1b4b"/></svg>`},
  {id:12, name:'S3ntinel', role:'Cyber Ops Commander', svg:`<svg viewBox="0 0 32 32" shape-rendering="crispEdges"><rect x="8" y="2" width="16" height="12" fill="#374151"/><rect x="8" y="2" width="16" height="3" fill="#4b5563"/><rect x="8" y="2" width="16" height="1" fill="#f59e0b"/><rect x="10" y="7" width="12" height="5" fill="#0c0e1c"/><rect x="11" y="8" width="10" height="3" fill="#1d4ed8"/><rect x="12" y="8" width="8" height="3" fill="#3b82f6"/><rect x="13" y="9" width="6" height="1" fill="#93c5fd"/><rect x="7" y="14" width="18" height="14" fill="#374151"/><rect x="7" y="14" width="18" height="3" fill="#4b5563"/><rect x="4" y="14" width="5" height="7" fill="#4b5563"/><rect x="23" y="14" width="5" height="7" fill="#4b5563"/><rect x="4" y="14" width="5" height="2" fill="#f59e0b"/><rect x="23" y="14" width="5" height="2" fill="#f59e0b"/><rect x="13" y="18" width="6" height="5" fill="#1d4ed8"/><rect x="14" y="19" width="4" height="3" fill="#3b82f6"/><rect x="15" y="20" width="2" height="1" fill="#f59e0b"/><rect x="9" y="28" width="5" height="4" fill="#374151"/><rect x="18" y="28" width="5" height="4" fill="#374151"/></svg>`}
];

// The USER's stand-in on the floor: a courier who walks in through the EXIT
// door carrying the new request, hands it to the boss, and leaves the way
// they came (see dispatchCourier in index.html). Not part of the roster —
// Dispatch is nobody's session avatar, they just deliver.
const COURIER_AVATAR = { id: 100, name: 'Dispatch', role: 'User Courier', svg: `<svg viewBox="0 0 32 32" shape-rendering="crispEdges"><rect x="8" y="3" width="16" height="4" fill="#d97706"/><rect x="8" y="3" width="16" height="1" fill="#f59e0b"/><rect x="6" y="7" width="20" height="2" fill="#b45309"/><rect x="10" y="9" width="12" height="7" fill="#e8b98a"/><rect x="12" y="11" width="2" height="2" fill="#1c1917"/><rect x="18" y="11" width="2" height="2" fill="#1c1917"/><rect x="14" y="14" width="4" height="1" fill="#b4835b"/><rect x="8" y="16" width="16" height="10" fill="#1d4ed8"/><rect x="8" y="16" width="16" height="2" fill="#3b82f6"/><rect x="15" y="18" width="2" height="8" fill="#16308a"/><rect x="20" y="16" width="4" height="10" fill="#b45309"/><rect x="22" y="22" width="8" height="7" fill="#92400e"/><rect x="22" y="22" width="8" height="2" fill="#b45309"/><rect x="2" y="19" width="8" height="6" fill="#e2e8f0"/><rect x="2" y="19" width="8" height="1" fill="#94a3b8"/><rect x="4" y="20" width="4" height="1" fill="#cbd5e1"/><rect x="8" y="23" width="1" height="1" fill="#e63946"/><rect x="10" y="26" width="4" height="4" fill="#1e293b"/><rect x="18" y="26" width="4" height="4" fill="#1e293b"/><rect x="10" y="29" width="4" height="1" fill="#0c0e1c"/><rect x="18" y="29" width="4" height="1" fill="#0c0e1c"/></svg>` };

// "Tally", the back-office bean counter — sits at his own desk on the usage
// panel and reports token spend. Green accountant's visor, red tie, a little
// calculator panel on the chest. Not part of the roster either.
const TALLY_AVATAR = { id: 101, name: 'Tally', role: 'Usage Accountant', svg: `<svg viewBox="0 0 32 32" shape-rendering="crispEdges"><rect x="9" y="3" width="14" height="11" fill="#1e293b"/><rect x="9" y="3" width="14" height="2" fill="#334155"/><rect x="7" y="6" width="18" height="3" fill="#10b981"/><rect x="7" y="6" width="18" height="1" fill="#6ee7b7"/><rect x="12" y="10" width="3" height="2" fill="#67e8f9"/><rect x="18" y="10" width="3" height="2" fill="#67e8f9"/><rect x="8" y="14" width="16" height="12" fill="#374151"/><rect x="8" y="14" width="16" height="2" fill="#4b5563"/><rect x="15" y="16" width="2" height="7" fill="#e63946"/><rect x="10" y="17" width="4" height="6" fill="#0c0e1c"/><rect x="11" y="18" width="2" height="1" fill="#10b981"/><rect x="11" y="20" width="2" height="1" fill="#f59e0b"/><rect x="11" y="22" width="2" height="1" fill="#06b6d4"/><rect x="19" y="18" width="3" height="4" fill="#e2e8f0"/><rect x="19" y="18" width="3" height="1" fill="#94a3b8"/><rect x="10" y="26" width="4" height="4" fill="#1e293b"/><rect x="18" y="26" width="4" height="4" fill="#1e293b"/></svg>` };

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return Math.abs(h);
}

// A hook's "model" field (e.g. "claude-sonnet-5") becomes a playful nickname
// instead of the raw model id — the roster avatar art stays whatever
// avatarForSession/avatarForAgentType picked, this only overrides the NAME.
const MODEL_NICKNAMES = [
  { match: /sonnet/i, name: 'Sonny' },
  { match: /opus/i, name: 'Oppy' },
  { match: /haiku/i, name: 'Kiku' },
  { match: /fable/i, name: 'Fabby' },
];
function nicknameForModel(model) {
  if (!model) return null;
  for (let i = 0; i < MODEL_NICKNAMES.length; i++) {
    if (MODEL_NICKNAMES[i].match.test(model)) return MODEL_NICKNAMES[i].name;
  }
  const m = String(model).replace(/^claude-/i, '').split(/[-_]/)[0];
  return m ? (m.charAt(0).toUpperCase() + m.slice(1)) : null;
}

// Office hierarchy by model tier — Fable directs, Opus manages, Sonnet leads,
// Haiku interns (and gets roasted). `rank` orders them (bigger = more senior);
// `title` is the role the crew addresses them by. An unknown model sits mid
// as a neutral "Boss" so the shift banter still has something to say. This is
// pure office-flavour ranking, not any real capability claim.
const MODEL_TIERS = [
  { match: /fable/i,  rank: 4, title: 'Director' },
  { match: /opus/i,   rank: 3, title: 'Manager' },
  { match: /sonnet/i, rank: 2, title: 'Lead' },
  // Haiku still runs the office and delegates to subagents, so it's a
  // Senior Staffer, not an intern — the lowest MODEL tier, but a real boss
  // role. The roasting stays (fast/cheap/fun-size veteran), the demotion to
  // "intern" doesn't.
  { match: /haiku/i,  rank: 1, title: 'Senior Staff' },
];
function modelRank(model) {
  for (let i = 0; i < MODEL_TIERS.length; i++) {
    if (MODEL_TIERS[i].match.test(model || '')) {
      return { rank: MODEL_TIERS[i].rank, title: MODEL_TIERS[i].title, nick: nicknameForModel(model) };
    }
  }
  return { rank: 2, title: 'Boss', nick: nicknameForModel(model) }; // unknown → neutral mid
}

// Subagent types get a fun, human-ish codename instead of the raw type string
// ("Explore" → "Scout", "general-purpose" → "Jack"). Deterministic per TYPE —
// not per agent instance — so the boss's "Sending Scout to: ..." handoff line,
// the lounge crew, and the arriving subagent all agree on who "Scout" is.
// Unknown/custom agent types fall back to a hashed pick from the name pool,
// so they still get a personality without any mapping work.
const AGENT_CODENAMES = {
  'Explore': 'Scout',
  'general-purpose': 'Jack',
  'Plan': 'Blueprint',
  'claude': 'Ace',
  'claude-code-guide': 'Bookworm',
  'statusline-setup': 'Tinker',
  'fork': 'Twin',
  'code-reviewer': 'Nitpick',
};
const CODENAME_POOL = [
  'Pixel', 'Gizmo', 'Byte', 'Echo', 'Bolt', 'Nova', 'Chip', 'Sparks',
  'Glitch', 'Turbo', 'Widget', 'Zippy', 'Mochi', 'Patch', 'Dash', 'Rune',
];
function codenameForAgentType(agentType) {
  if (agentType && AGENT_CODENAMES[agentType]) return AGENT_CODENAMES[agentType];
  const key = 'codename:' + (agentType || 'agent');
  return CODENAME_POOL[hashStr(key) % CODENAME_POOL.length];
}

// Subagents (Explore, general-purpose, custom agents...) get an operative,
// deterministically hashed so the same agent_type always looks the same.
// Recognized agent types get a FIXED avatar, chosen to avoid the four MODEL
// faces (ids 2, 5, 7, 12) so a subagent never wears the boss's face — and to
// be distinct from each other. Unknown/custom types fall back to the hash.
const AGENT_AVATARS = {
  'Explore': 3,            // Scout     — RedAgent
  'general-purpose': 9,    // Jack      — NullPtr
  'Plan': 11,              // Blueprint — Pr0xyGhost
  'claude': 10,            // Ace       — NeuralNet
  'claude-code-guide': 8,  // Bookworm  — PacketSniper (was #7 CryptWitch = Opus)
  'code-reviewer': 1,      // Nitpick   — Ghost.exe
  'fork': 4,               // Twin      — AI.Oracle (was #2 CyberKnight = Sonnet)
  'statusline-setup': 6,   // Tinker    — F1rewall
};
function avatarForAgentType(agentType) {
  if (agentType && AGENT_AVATARS[agentType] != null) {
    const id = AGENT_AVATARS[agentType];
    for (let j = 0; j < AVATARS.length; j++) { if (AVATARS[j].id === id) return AVATARS[j]; }
  }
  const key = 'agent:' + (agentType || 'general-purpose');
  return AVATARS[hashStr(key) % AVATARS.length];
}

// Each main session's operative, deterministically hashed off session_id —
// a different salt than agent_type so a session and its own subagents rarely match.
// Used only as the FALLBACK before a model is known (or for an unrecognised model).
function avatarForSession(sessionId) {
  const key = 'session:' + (sessionId || 'session');
  return AVATARS[hashStr(key) % AVATARS.length];
}

// Each MODEL gets a FIXED avatar, so the boss's face reflects who's actually
// in the chair and stays consistent across sessions (the session-hash above
// gave every session a random face and never changed on a /model switch).
// These are the current picks — reassign any `id` to an AVATARS[] id to
// re-skin a model (see the picker preview). An unrecognised model returns
// null, so the caller keeps the session-hashed fallback.
const MODEL_AVATARS = [
  { match: /fable/i,  id: 12 }, // S3ntinel   — Cyber Ops Commander (Director)
  { match: /opus/i,   id: 7 },  // CryptWitch — Encryption Specialist (Manager)
  { match: /sonnet/i, id: 2 },  // CyberKnight — cyan defender       (Lead)
  { match: /haiku/i,  id: 5 },  // Zer0Day    — amber, fast          (Senior Staff)
];
function avatarForModel(model) {
  for (let i = 0; i < MODEL_AVATARS.length; i++) {
    if (MODEL_AVATARS[i].match.test(model || '')) {
      const id = MODEL_AVATARS[i].id;
      for (let j = 0; j < AVATARS.length; j++) { if (AVATARS[j].id === id) return AVATARS[j]; }
    }
  }
  return null;
}
