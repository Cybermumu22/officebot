# Vendored libraries

Committed dist files so the phone needs no CDN and the repo stays zero-dependency.

| File | Package | Version |
|---|---|---|
| `xterm.js`, `xterm.css` | `@xterm/xterm` | 5.5.0 |
| `addon-fit.js` | `@xterm/addon-fit` | 0.10.0 |

To upgrade: `npm pack @xterm/xterm @xterm/addon-fit`, copy `lib/xterm.js`,
`css/xterm.css`, `lib/addon-fit.js` here, update this table, and retest
deck.html against a real ttyd (versions are pinned deliberately — 6.x was
untested with the deck's hand-rolled ttyd client when this was vendored).
