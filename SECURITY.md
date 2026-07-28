# Security

officebot / Pocket Deck runs **entirely on your own device**. It reads your
local Claude Code logs, receives Claude Code's local hooks, and (on the phone)
serves a terminal into your own shell. Understanding the threat model matters,
because the app's headline feature is *a terminal on the machine it runs on*.

## The one rule

**Run it only on your own device. Never host it as a service for other people
to log into.**

There is no login, no accounts, and no separation between users. The terminal
gives a shell on the host machine. If you expose one instance for others to
reach, **every visitor gets a shell on your computer.** That is not a
configuration mistake to avoid — it is what the app fundamentally is. Hosting
it multi-user would be a different, much larger product.

## What it defends against (and how)

Everything binds to **loopback (`127.0.0.1`) by default** — private to the
machine. LAN viewing is strictly opt-in (`officebot --lan`), and even then it
prints a "no authentication" warning.

Against a **malicious web page** you might open in a browser on the same
device, officebot defends the terminal and its controls:

- The terminal is reached only through officebot's own same-origin `/tty`
  proxy, which requires a genuine same-origin WebSocket handshake (present
  `Origin`, matching host **and** port). ttyd itself sits behind a per-install
  credential, so a page connecting straight to it is rejected too.
- A `Host`-header check rejects DNS-rebinding attempts.
- Action endpoints (`/deck/key`, `/deck/kill`, `/deck/attach`) require a custom
  header a cross-origin page cannot add without a blocked CORS preflight.
- No CORS headers are ever sent, so a foreign page can't read any response.
- `transcript_path` in incoming events is confined to `~/.claude/projects`.
- All rendered content is HTML-escaped before display (no XSS into the terminal).

## What it does NOT defend against

- **A malicious native app already installed on the same device.** localhost
  HTTP cannot tell your real browser apart from another local app — a native
  app can forge any header/origin and reach the terminal. This is inherent to
  every localhost tool (Jupyter, dev servers, etc.), not specific to officebot.
  Related: ttyd's per-install credential is passed on its command line, so it's
  visible in the process list (`ps`/`pgrep -af`) to processes that can read it —
  a co-resident app could read it and connect to ttyd directly. This collapses
  into the same "malicious local app" caveat (such an app can already forge
  Origin), so it's not extra exposure — but worth knowing.
  Mitigation for all of the above: don't run officebot on a device with
  untrusted apps installed; keep it stopped when you're not using it
  (`deck-stop`).
- **Anything you deliberately expose.** LAN mode has no authentication; only
  enable it on a network you trust, and never port-forward it to the internet
  (use a private tunnel like Tailscale if you need remote access).
- **The usage poller**, which drives a hidden `claude` session to read
  `/usage`, is **off by default** (Anthropic's terms restrict automated
  access); enable it only if you accept that.

## Reporting

Found something? Open an issue on the GitHub repo. This is a small
community-built tool, maintained best-effort — not affiliated with, endorsed,
or sponsored by Anthropic.
