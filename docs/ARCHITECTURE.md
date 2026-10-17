# Architecture

## Principles

- **The logic is pure.** Everything that reads the calendar, decides what a game is, tallies answers, places players and writes share text is in `core.js`, with no DOM, storage or network, and is covered by `tests/core.test.mjs`.
- **The manager's data stays on the phone.** The team, settings, the cached calendar and each game's answers and lines are one JSON record in localStorage (`lines-v1`). Only polls go to the relay.
- **No accounts.** A poll is reached by an unguessable token in the link; the manager holds a second secret for changes.
- **Works before the relay exists.** A sample calendar, demo polls on the device, .ics file import, and roster links that carry their own data.

## Stored record (`localStorage['lines-v1']`)

```js
{
  v: 1,
  team: {
    display,      // "Hammer'd Heads": shown everywhere
    feedName,     // "Hammered Heads": how the calendar spells it
    feedUrl,      // the private iCal address (left out of backups)
    relay,        // https://lines-relay.<you>.workers.dev
    lines, pairs, goalies, // 1-4, 1-3, 1-2
    showOther,    // list the rink's other events on Home
  },
  players: [{ id, name, number, pos }],   // pos: C | LW | RW | F | D | G
  feed: { text, fetchedAt, error, calName, source }, // text "" = the sample
  games: {
    [eventId]: {
      token, admin,           // the poll's link token and the manager's secret
      votes: { [key]: { name, v, at, src: "manual" } }, // answers entered here; v null clears
      remote: [{ name, v, at }],                         // answers from the vote link
      lines: { slots: { "L1-LW": playerId, ... }, bench: [playerId] },
      pool,                   // in | maybe | all: who the lines builder offers
    },
  },
  seeded,                     // the sample answers were added once
}
```

`eventId` is the event's UID (plus `@start` for repeats). The answers shown are `mergeVotes(remote, votes)`: per person (name without case or punctuation), the latest wins. Names that aren't on the team come through as guests (position F) and can be placed.

The vote page remembers the player's name in `localStorage['lines-me']`. Demo polls (no relay) live in `localStorage['lines-demo-polls']`.

## Calendar to games

`icsEvents` unfolds lines, parses parameters, skips nested blocks (VALARM), reads times (UTC, TZID including common Windows names, floating times in `X-WR-TIMEZONE`, all-day), expands RRULE basics with EXDATE and RECURRENCE-ID, and marks cancelled events. `buildSchedule` sorts each event into games or other events with `parseSummary` (our name on one side of "vs", "@" or "at"; a result such as `W 8-0` after the team it belongs to) and `parseLocation` (`<venue> on <sheet> <address>`). The sample is moved forward by whole weeks so its next game is always ahead.

## Lines

`slotsFor(cfg)` gives the groups: Line 1..n (LW, C, RW), D pair 1..n (LD, RD), and the goalie (plus a backup if set). `place(lines, id, target)` moves a player to a slot, the spares or back to the pool; dropping on someone swaps them into the mover's old place. `autoFill` keeps what's placed and fills the rest: goalies, then centers, wings and D by exact position, then nearby positions (F, the other wing, C), then any skater; goalies never skate and leftovers become spares. `lineWarnings` lists open spots and anyone placed who is out, a maybe, or hasn't answered.

## Sharing

- Vote: `voteMessage` and `waUrl` (`https://wa.me/?text=...`). The link is `#/v/<token>?r=<relay>` (the `r` is left off once `DEFAULT_RELAY` in `core.js` is set), or `?demo=1` without a relay.
- WhatsApp poll: `pollText` gives the question and options to paste.
- Lines: `rosterText` for WhatsApp, `encodeRoster` packs the lines into the link (`#/r/<base64url JSON>`, about 600 characters for a full team) so the roster page needs no server, and `card.js` draws a 1080 x 1350 picture shared with the Web Share API (or saved).
- Link previews: `index.html` has Open Graph tags with the logo (`icons/og.png`). Links use the hash, so every page shares the same preview.

## Relay API (`worker/lines-relay.js`)

| Call | Who | Body | Does |
| --- | --- | --- | --- |
| `GET /feed` | app | | The calendar from the `FEED_URL` secret |
| `GET /ics?url=` | app | | A calendar from an allowed host (`FEED_HOSTS`), https only |
| `PUT /polls/:token` | manager | `{ admin, game, players }` | Creates the poll, or updates it with the same secret |
| `GET /polls/:token` | anyone with the link | | `{ game, players, votes }` |
| `POST /polls/:token/vote` | player | `{ name, v }` | One answer per name (in, maybe, out); 80 people at most |
| `POST /polls/:token/votes` | manager | `{ admin, votes: [{ name, v }] }` | Answers entered by hand; `v: null` removes |

Only `https://grahamdeno.github.io` and localhost get answers (CORS and a 403 otherwise). D1 tables are in `worker/schema.sql`; a daily cron removes polls 60 days after their game. D1 rather than KV because two players answering at once must not overwrite each other, and KV is eventually consistent.

## Offline

`sw.js` caches the shell (all app files, fonts, icons, the sample) per release and is network first, so a deploy shows on the next launch and the last copy opens at the rink without signal. The relay is never cached.

## Not yet

- Short roster links through the relay (the self-contained link is long but needs no server).
- Updating a shared roster after it's sent (send a new one for now).
- Reminders to players who haven't answered.
