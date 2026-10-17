// Tests for the relay (worker/lines-relay.js) with an in-memory store and a
// fake upstream fetch. Run with: node --test
import test from "node:test";
import assert from "node:assert/strict";
import { handle, memoryStore, feedAllowed, cleanGame } from "../worker/lines-relay.js";

const ORIGIN = "https://grahamdeno.github.io";
const req = (method, path, body, origin = ORIGIN) => new Request("https://relay.test" + path, { method, headers: { origin, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
const TOKEN = "abcdefghijklmnopqrstuv", ADMIN = "manager-secret-1234567890";

test("only the app's origin is served", async () => {
  const r = await handle(req("GET", "/polls/" + TOKEN, null, "https://evil.example"), {}, memoryStore());
  assert.equal(r.status, 403);
  const pre = await handle(new Request("https://relay.test/polls/x", { method: "OPTIONS", headers: { origin: ORIGIN } }), {}, memoryStore());
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), ORIGIN);
  const local = await handle(req("GET", "/nope", null, "http://localhost:8765"), {}, memoryStore());
  assert.equal(local.status, 404);
});

test("a poll: create, vote, change a vote, read back", async () => {
  const s = memoryStore();
  const g = { team: "Hammer'd Heads", opponent: "Wild Pucks", start: Date.now() + 86400000, place: "Rink" };
  assert.equal((await handle(req("GET", "/polls/" + TOKEN), {}, s)).status, 404);
  assert.equal((await handle(req("PUT", "/polls/" + TOKEN, { admin: ADMIN, game: g, players: ["Mike Brennan", "Ryan Cole"] }), {}, s)).status, 200);
  assert.equal((await handle(req("POST", `/polls/${TOKEN}/vote`, { name: "Mike Brennan", v: "in" }), {}, s)).status, 200);
  const r = await handle(req("POST", `/polls/${TOKEN}/vote`, { name: "mike  BRENNAN", v: "out" }), {}, s);
  const body = await r.json();
  assert.equal(body.votes.length, 1);
  assert.equal(body.votes[0].v, "out");
  const got = await (await handle(req("GET", "/polls/" + TOKEN), {}, s)).json();
  assert.equal(got.game.opponent, "Wild Pucks");
  assert.deepEqual(got.players, ["Mike Brennan", "Ryan Cole"]);
  assert.equal(r.headers.get("cache-control"), "no-store");
});

test("bad input is refused", async () => {
  const s = memoryStore();
  await handle(req("PUT", "/polls/" + TOKEN, { admin: ADMIN, game: {}, players: [] }), {}, s);
  assert.equal((await handle(req("POST", `/polls/${TOKEN}/vote`, { name: "", v: "in" }), {}, s)).status, 400);
  assert.equal((await handle(req("POST", `/polls/${TOKEN}/vote`, { name: "A", v: "yes" }), {}, s)).status, 400);
  assert.equal((await handle(req("GET", "/polls/short"), {}, s)).status, 400);
  assert.equal((await handle(req("PUT", "/polls/" + TOKEN, { admin: "short" }), {}, s)).status, 400);
  assert.equal((await handle(req("POST", `/polls/zzzzzzzzzzzzzzzzzzzzzz/vote`, { name: "A", v: "in" }), {}, s)).status, 404);
});

test("only the manager's secret can change the poll or enter answers", async () => {
  const s = memoryStore();
  await handle(req("PUT", "/polls/" + TOKEN, { admin: ADMIN, game: { opponent: "A" }, players: [] }), {}, s);
  assert.equal((await handle(req("PUT", "/polls/" + TOKEN, { admin: "someone-else-1234567890", game: { opponent: "B" } }), {}, s)).status, 403);
  assert.equal((await handle(req("POST", `/polls/${TOKEN}/votes`, { admin: "wrong-wrong-wrong-wrong", votes: [{ name: "A", v: "in" }] }), {}, s)).status, 403);
  const ok = await (await handle(req("POST", `/polls/${TOKEN}/votes`, { admin: ADMIN, votes: [{ name: "Joe", v: "in" }, { name: "Sam", v: "maybe" }] }), {}, s)).json();
  assert.equal(ok.votes.length, 2);
  const cleared = await (await handle(req("POST", `/polls/${TOKEN}/votes`, { admin: ADMIN, votes: [{ name: "joe", v: null }] }), {}, s)).json();
  assert.deepEqual(cleared.votes.map(v => v.name), ["Sam"]);
  const stored = [...s.polls.values()][0];
  assert.notEqual(stored.admin_hash, ADMIN);
  assert.match(stored.admin_hash, /^[0-9a-f]{64}$/);
});

test("a poll caps the number of voters", async () => {
  const s = memoryStore();
  await handle(req("PUT", "/polls/" + TOKEN, { admin: ADMIN, game: {}, players: [] }), {}, s);
  for (let i = 0; i < 80; i++) await s.putVote(TOKEN, "p" + i, "P" + i, "in", i);
  assert.equal((await handle(req("POST", `/polls/${TOKEN}/vote`, { name: "One More", v: "in" }), {}, s)).status, 429);
  assert.equal((await handle(req("POST", `/polls/${TOKEN}/vote`, { name: "P1", v: "out" }), {}, s)).status, 200);
});

test("old polls end and are swept", async () => {
  const s = memoryStore();
  await s.putPoll({ token: TOKEN, admin_hash: "x", game: "{}", players: "[]", expires: Date.now() - 1 });
  assert.equal((await handle(req("GET", "/polls/" + TOKEN), {}, s)).status, 404);
  await s.sweep(Date.now());
  assert.equal(s.polls.size, 0);
});

test("feeds: only allowed calendar hosts, https, no private addresses", () => {
  assert.ok(feedAllowed("https://sportsix.sports-it.com/ical/?cid=demo&id=1&k=x"));
  assert.ok(feedAllowed("webcal://sportsix.sports-it.com/ical/?cid=demo"));
  assert.equal(feedAllowed("https://evil.example/ical"), null);
  assert.equal(feedAllowed("http://sportsix.sports-it.com/ical"), null);
  assert.equal(feedAllowed("https://localhost/ical", "localhost"), null);
  assert.equal(feedAllowed("https://sports-it.com.evil.example/"), null);
});

test("GET /feed relays the FEED_URL secret's calendar; /ics checks its host", async t => {
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });
  let asked = "";
  globalThis.fetch = async u => { asked = String(u); return new Response("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", { status: 200, headers: { "content-type": "text/calendar" } }); };
  const env = { FEED_URL: "https://sportsix.sports-it.com/ical/?cid=demo&id=1&k=secret" };
  const r = await handle(req("GET", "/feed"), env, memoryStore());
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), ORIGIN);
  assert.match(await r.text(), /BEGIN:VCALENDAR/);
  assert.equal(asked, env.FEED_URL);
  assert.equal((await handle(req("GET", "/feed"), {}, memoryStore())).status, 404);
  assert.equal((await handle(req("GET", "/ics?url=" + encodeURIComponent("https://evil.example/x.ics")), {}, memoryStore())).status, 400);
  globalThis.fetch = async () => new Response("<html>login</html>", { status: 200 });
  assert.equal((await handle(req("GET", "/ics?url=" + encodeURIComponent("https://sportsix.sports-it.com/ical/?cid=x")), {}, memoryStore())).status, 502);
});

test("game details are trimmed to plain fields", () => {
  const g = cleanGame({ team: "T".repeat(200), opponent: "A\nB", start: "5", extra: "drop me", away: "yes" });
  assert.equal(g.team.length, 60);
  assert.equal(g.opponent, "A B");
  assert.equal(g.start, 5);
  assert.equal(g.away, null);
  assert.equal("extra" in g, false);
});
