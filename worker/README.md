# Lines relay

A Cloudflare Worker that does what the web page can't on its own: it reads the rink's calendar feed (the feed doesn't allow web pages to read it) and keeps each game's In / Maybe / Out answers in a small database so every player sees the same poll. It's free on Cloudflare's plan at this size, has no accounts, and only answers the Lines app's address.

Nothing is deployed from this repo automatically. These are the steps for later.

## Deploy with Wrangler (about ten minutes)

Needs Node 20 and a free Cloudflare account.

```
cd worker
npx wrangler login
npx wrangler d1 create lines              # copy the database_id it prints into wrangler.toml
npx wrangler d1 execute lines --remote --file=schema.sql
npx wrangler secret put FEED_URL          # paste the team's iCal address (with its k=)
npx wrangler deploy
```

Wrangler prints the Worker's address, for example `https://lines-relay.yourname.workers.dev`.

Then in Lines, open Settings and paste it into **Relay address**. Leave **Calendar feed address** empty to use the `FEED_URL` secret, and select **Load schedule**.

Optional: set `DEFAULT_RELAY` in `core.js` to the same address and release, so vote links are shorter (no `?r=` part).

## Deploy from the dashboard (no tools)

1. dash.cloudflare.com, **Storage & Databases**, **D1**, **Create** a database named `lines`. Open its **Console**, paste the contents of `schema.sql`, and run it.
2. **Workers & Pages**, **Create**, **Create Worker**, name it `lines-relay`, **Deploy**.
3. **Edit code**, replace everything with `lines-relay.js`, **Deploy**.
4. The Worker's **Settings**: under **Bindings**, add a D1 database binding named `DB` pointing at `lines`. Under **Variables and Secrets**, add a secret `FEED_URL` with the iCal address. Under **Triggers**, add a cron `17 7 * * *` (daily clean-up).
5. Paste the Worker's address into Lines, Settings, Relay address.

## Notes

- **The feed address is private.** Its `k=` is a key. Keep it in the secret or on your phone only, never in this repo (a test fails if a key-like value is committed).
- **Allowed calendar hosts:** `FEED_HOSTS` (default `sports-it.com,daysmartrecreation.com,dashplatform.com`). `/ics?url=` refuses anything else, so the relay can't be used as an open proxy.
- **Allowed app address:** `ALLOWED_ORIGINS` in `lines-relay.js`. If Lines moves (a custom domain), change it, and add the relay's address to `connect-src` in `index.html` if it isn't on `workers.dev`.
- **Updating:** after this file changes, run `npx wrangler deploy` again (or paste it into Edit code). The address stays the same.
- **Data kept:** for each poll, the game details, the team's names, and each person's latest answer with its time. Deleted 60 days after the game.
