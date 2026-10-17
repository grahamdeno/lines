# Lines

The Hammer'd Heads team app: the schedule from the rink's calendar, who's in for each game, and the lines. Send a vote link into the team's WhatsApp chat, players tap In, Maybe or Out, then you put the players who are in onto lines and share the roster back to the chat.

A plain-JavaScript PWA with no build step, on GitHub Pages, in the same format as Tabs. The manager's data stays on the phone. Only game polls go through a small Cloudflare Worker (the relay) that you deploy yourself.

## Live

https://grahamdeno.github.io/lines/

On iPhone, open it in Safari, then Share, then Add to Home Screen. Until you add your calendar it shows a sample schedule, with sample players and answers, so you can try everything.

## Features

- **Schedule.** Reads the team calendar feed (iCal) from the rink's system. Upcoming games, the next one up top with how many are in, results (W 8-0) for past games, and the rink's other events (pickup skates) in their own list, which you can hide.
- **Ask the team.** For any game, Lines makes a vote link and a WhatsApp message with the game, the rink and the link. Send in WhatsApp opens the share screen with the text ready, so you pick the team chat and send.
- **The vote page.** Players open the link, tap their name (or type it), and tap In, Maybe or Out. It remembers their name for next time. They see who else is in.
- **WhatsApp poll instead.** WhatsApp doesn't let any app create a poll in a normal group chat (see Research). Copy poll question puts the question on the clipboard to paste into a new poll in the chat, with In, Out and Maybe as options. Then mark the results by hand under Who's in.
- **Who's in.** Every player with In, Maybe and Out buttons, so you can enter answers from the poll, a text, or the bench. Answers from the vote link and yours combine; the latest answer for each person wins.
- **Lines.** Tap a player, then tap a spot: LW, C, RW on each forward line, LD and RD on each D pair, the goalie, and spares. Tap a placed player to move them (dropping on someone swaps the two) or Take off. Auto-fill places everyone by their usual position. A list says what's still open and who's on a line without saying they're in.
- **Share the lines.** A WhatsApp message with every line, a link to a clean read-only roster page, and a picture of the lines (with the logo) to share or save.
- **Team.** Names, numbers and usual positions (C, LW, RW, F, D, G).
- **Offline.** The app and the last calendar open without signal. Fonts are built in.
- **Settings.** Team name (shown everywhere) and the calendar's spelling of it, the feed address, the relay address, how many forward lines, D pairs and goalies, and backups.

## The design system

Lines uses **Edition's design system**, in the Hammer'd Heads colors.

Also considered: Tabs (gold plate, tolex and amp knobs, right for a guitar app but too themed here), Scales (its own Matte look now, built around one card), Threads, and the Phat Ducky brand system (a brand reference, not an app system). Edition is the most complete and the one Graham named as the model. It suits a team app because it's built for quick reading on a phone: a dark ground, one accent, serif headlines over a clean sans, outlined pill chips, a lead card for the one thing that matters now (the next game), hairline rows for the rest, sheets for everything else, and no tab bar.

Kept from Edition: Instrument Serif for headlines and Geist for text (both bundled, no Google Fonts), the uppercase spaced labels, the outlined chips with a filled selected state, the lead card, hairline rows, the banner, sheets, and 44 px minimum targets. Changed for the team: the ground is the logo's navy (#070A1F), the accent is the logo's gold (#E4B04E), and ice blue (#9CC8EA) marks In and the goalie. Corners are tight (10 to 16 px), following Graham's note on Scales. Each screen has one primary action in thumb reach at the bottom (Ask the team, Share lines, Add player). All text meets WCAG AA on the ground (text 16.3:1, muted 8.3:1, gold 9.9:1, ice 11.1:1).

## Research

### The calendar feed (Dash by DaySmart, served by Sports-IT)

Polar Ice Wilmington runs on DaySmart's Dash platform. In the customer portal, **My Activities, then Sync Your Calendar, then iCal** gives a personal feed. It is served by Sports-IT (DaySmart's older platform name):

```
https://sportsix.sports-it.com/ical/?cid=<facility code>&id=<customer id>&k=<private key>
```

- The `k` is a private key. Anyone with the full address can read the calendar, so it is never committed. It lives only in Settings on the manager's phone (and is left out of backups), or as the relay's `FEED_URL` secret.
- The feed answers `text/calendar` with no `Access-Control-Allow-Origin` header, so a web page can't read it directly. The relay fetches it.
- It's the person's whole calendar, not just the team: it also has events like "Adult Pickup - Skaters". Lines treats an event as a game when its summary has the team's name and "vs" (or "@", "at").
- `X-WR-TIMEZONE:America/New_York` with floating times (`DTSTART:20261018T193000`, no Z or TZID), so times are read in the calendar's zone. `X-PUBLISHED-TTL:PT6H`.
- Summaries: `Hammered Heads vs Wild Puckers` before a game, `Hammered Heads W 8-0 vs Seal Team Sticks (Muckers)` after one. The feed spells the team "Hammered Heads"; the app shows "Hammer'd Heads". Matching ignores case and the apostrophe, and both names are set in Settings.
- Locations: `Polar Ice Wilmington on Wilmington Rink 7201 Ogden Business Ln  Wilmington NC 28411` (venue, then "on" the sheet, then the address; the sheet can be `Rink - W1`).
- No RRULEs in this feed; the parser handles the basics anyway (weekly, daily, monthly, COUNT, UNTIL, BYDAY, EXDATE, RECURRENCE-ID), plus TZID, UTC and all-day events, in case another rink's feed uses them.

`sample/sample.ics` has the same shape with made-up opponents, rink and ids, and no key.

### WhatsApp polls

A native poll can't be created from an app in a normal group chat:

- **Links:** `wa.me/?text=` and the share screen only carry text. There is no link or URL scheme for a poll.
- **WhatsApp Business Cloud API (official):** it can post only to groups the business creates through its Groups API, which needs an Official Business Account (the verified badge) and allows at most 8 participants per group. Supported group message types are text, media and templates; interactive messages are not supported, and polls aren't offered. It can't post into an existing chat of personal accounts.
- **Personal accounts:** no API. Unofficial services (Whapi, WAAPI, Wapito and similar) send polls by driving a linked WhatsApp Web session, which breaks WhatsApp's terms and risks the number being banned. Not used.

So Lines uses its own vote link (fast, no account, results land in the app) and offers Copy poll question for a native poll, with results entered by hand.

## The relay (Cloudflare Worker)

`worker/lines-relay.js` does two jobs: it fetches the calendar feed (from the `FEED_URL` secret, or from an address the app sends, limited to the rink system's hosts), and it keeps game polls in Cloudflare D1. It answers only `https://grahamdeno.github.io` (and localhost while developing). No accounts: the poll token in the link is 16 random bytes, and only the manager's secret (stored as a SHA-256 hash) can change a game or enter answers for others. Polls are deleted 60 days after their game. Deploy steps: [worker/README.md](worker/README.md).

### What works without the relay

| | Without the relay | With it |
| --- | --- | --- |
| Sample schedule, team, lines, auto-fill, warnings | Yes | Yes |
| Your calendar | Open the .ics file in Settings (download it once from the rink's site) | Loads and refreshes from the feed |
| Who's in, entering answers by hand, WhatsApp poll helper | Yes | Yes |
| Vote link for players | Demo only: works on the manager's phone | Works for everyone |
| Share lines: text, roster page link, picture | Yes (the roster link carries the lines itself, no server) | Yes |

## Development

Plain ES modules, no build step, no dependencies.

| Area | File |
| --- | --- |
| Pure logic: ICS, games, rinks, votes, lines, share text, roster links (unit tested) | `core.js` |
| Screens, router, actions | `app.js` |
| Icons, toast with Undo, sheets (real dialogs), copy | `ui.js` |
| Saving on the phone (localStorage), backups | `store.js` |
| Talking to the relay; demo polls when there is none | `api.js` |
| The lines picture (canvas) and sharing it | `card.js` |
| Offline copy; lists every app file | `sw.js` |
| The relay, its database and template | `worker/` |

Data model and flows: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```
python3 -m http.server 8765    # then open http://localhost:8765
node --test                    # unit tests: core and the relay
npx eslint .                   # names used but never defined
```

CI (`.github/workflows/test.yml`) runs the tests and ESLint on every push and pull request.

### Releases

A feature is a minor release (0.2.0), a fix a patch (0.1.1). Bump `VERSION` in `core.js` and `CACHE` in `sw.js` together (a test checks). If app files change on main without a bump, the bump-version workflow bumps the patch and commits `Release x.y.z`. Installed apps pick up a release on their next launch (the service worker is network first).

## License

MIT. Instrument Serif and Geist are under the SIL Open Font License (`fonts/OFL.txt`). The Hammer'd Heads logo belongs to the team.
