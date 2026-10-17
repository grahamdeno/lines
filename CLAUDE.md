# Working on Lines

Lines is Graham's beer-league hockey team app (Hammer'd Heads): plain ES
modules, no build step, live on GitHub Pages from `main`, in the format of
Tabs. The README is the map; docs/ARCHITECTURE.md has the stored record and
the relay API.

## Standing rules

- The team calendar address holds a private key (`k=`). Never commit it, log
  it, or put it in a fixture. It lives in Settings on the phone or in the
  relay's `FEED_URL` secret. `tests/core.test.mjs` fails on key-like values.
- The calendar spells the team "Hammered Heads"; the app shows "Hammer'd Heads".
- Design: Edition's system in the logo's navy, gold and ice blue. Tight corners,
  one primary action per screen at the bottom, 44 px targets, AA contrast.
- Versions: a feature is a minor release, a fix a patch. Bump `VERSION` in
  `core.js` and `CACHE` in `sw.js` together. New app `.js` files go in `SHELL`
  in `sw.js` (a test checks).
- Don't deploy the Worker; Graham does that (worker/README.md).
- Writing he sees (UI text, README, commit messages): plain and direct, no em
  dashes.

## Tests

`node --test` (core and relay), `npx eslint .`. CI runs both.
