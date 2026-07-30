# officebot

A pixel-art "office" dashboard for Claude Code sessions. Claude Code hooks POST
every event to a local server, which broadcasts them over SSE to a browser view
where each session is an office and each subagent is a character. Zero runtime
dependencies, no build step, no bundler — the files that ship are the files that
run.

**Read `ARCHITECTURE.md` before changing behaviour.** It is long because the
behaviour is hard-won: most of what looks arbitrary in this codebase is a fix for
something that was confirmed broken on a real device, and the reasoning lives
there and in the comments. Changing something that reads as odd without finding
out why it is odd is the main way to regress this project.

## Layout

| file | what it is |
| --- | --- |
| `server.js` | the whole backend — hook intake (`POST /event`), SSE broadcast, session/subagent state, the chat + usage APIs, the tmux/ttyd bridge |
| `public/index.html` | the office itself: floor plan, characters, movement, ceremonies. Self-contained. |
| `public/deck.html` | the Pocket Deck — the phone shell that frames the office, terminal and chat panes |
| `cli.js` | `start` / `setup` / `demo`, and the hook installer that writes `~/.claude/settings.json` |
| `termux-setup.sh` | one-shot Android installer; owns the auto-managed block in the user's `~/.claude/CLAUDE.md` |
| `termux/CLAUDE-android.md` | the template for that block — **not** instructions for working on officebot (this file is) |

## Verifying a change

There is no test suite. Verify against the running server:

```sh
curl -s "http://127.0.0.1:4317/api/chat?tab=deck-<N>&lite=1"   # what a tab resolves to
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4317/ # alive?
tail -30 ~/.deck/officebot.log                                  # errors
```

`node --check server.js` catches syntax before a restart costs you the dashboard.
For logic worth trusting, copy the function into a scratch file and run it
against the real transcripts in `~/.claude/projects/` — that is how the
session-to-tab recovery was proven, including its must-not-fire cases.

## On the phone (Termux)

- **Never `tmux kill-server`.** Other deck tabs are live Claude sessions in it.
- To restart only the server: find it by cwd, kill it, start it in a *separate*
  call. `pgrep -f`/`pkill -f` on a server path **matches your own shell**, whose
  command line contains that same text — it kills the tool call, not the server:

  ```sh
  for p in $(pgrep -x node); do case "$(readlink /proc/$p/cwd)" in *officebot*) echo $p;; esac; done
  # then, in a later call:
  cd ~/officebot && AGENT_VIZ_HOST=127.0.0.1 setsid node server.js >> ~/.deck/officebot.log 2>&1 < /dev/null &
  ```
- `deck-start` is idempotent (it skips what is already running) but ends by
  opening the deck URL in the browser; starting `node server.js` directly avoids
  that popup and leaves ttyd untouched.
- A server restart is safe: `deck-tabs.json` and `sessions-meta.json` are
  reloaded from disk and the office rehydrates without replaying its ceremonies.
- **Do not tell anyone to `npm install -g @anthropic-ai/claude-code` on Android.**
  `claude` here is a launcher script that fetches the official linux-arm64 binary,
  verifies its checksum, patchelfs it for glibc-runner, smoke-tests it and
  blocklists versions that crash under Android's seccomp filter. Installing over
  it replaces all of that. It self-updates daily; running `claude` is the update.

## Releasing

`package.json` has a `files` whitelist, so new assets must be added there or they
silently do not ship. Before publishing, build the tarball and grep it — not the
repo:

```sh
npm pack && mkdir -p /tmp/tb && tar xzf cybermu22-officebot-*.tgz -C /tmp/tb
grep -rIl -e _authToken -e gho_ -e npm_ /tmp/tb    # plus the machine owner's email
```

Scan for your own leaks too, not just the repo's: a comment citing the real
session uuids from the machine a bug was diagnosed on shipped once and was caught
only at this step. Describe the shape of evidence in comments, never live values.
Afterwards, compare the published tarball's sha1 against
`npm view @cybermu22/officebot dist.shasum` to prove the bytes you scanned are
the bytes that shipped.

Version bumps use `npm version <patch|minor>` — it makes the commit and the `v`
tag the history already uses. Commit subjects are lowercase and narrative
("fix: the boss actually walks to his office, rather than staying put"), and the
body explains what was broken and why the fix takes the shape it does.
