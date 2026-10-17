// Tests for core.js and for the wiring that keeps the app loadable.
// Run with: node --test   (Node 20 or later, no dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as C from "../core.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");
const NY = "America/New_York";
const TEAM = { feedName: "Hammered Heads", display: "Hammer'd Heads" };
const sample = read("sample/sample.ics"), edge = read("tests/fixtures/edge.ics");

// ---------- Wiring ----------
test("version is MAJOR.MINOR.PATCH and matches the service worker cache", () => {
  assert.match(C.VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(read("sw.js").match(/const CACHE = "lines-v([^"]+)"/)[1], C.VERSION);
});
test("every app file and the sample are in the offline shell", () => {
  const shell = read("sw.js");
  for (const f of fs.readdirSync(root).filter(f => f.endsWith(".js") && !["sw.js", "eslint.config.mjs"].includes(f))) assert.ok(shell.includes(`"${f}"`), f);
  for (const f of ["sample/sample.ics", "styles.css", "index.html", "fonts/geist-latin.woff2", "fonts/instrument-serif-latin.woff2"]) assert.ok(shell.includes(`"${f}"`), f);
});
test("no private calendar key is committed anywhere", () => {
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.name === ".git" || e.name === "node_modules" ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of walk(root).filter(f => /\.(js|mjs|html|md|ics|toml|json|sql|yml|webmanifest)$/.test(f))) {
    const t = fs.readFileSync(f, "utf8");
    assert.doesNotMatch(t, /[?&]k=[0-9a-f]{20,}/i, `key-like value in ${path.relative(root, f)}`);
  }
});
test("the CSP allows only the app and the relay", () => {
  const csp = read("index.html").match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /connect-src 'self' https:\/\/\*\.workers\.dev/);
  assert.doesNotMatch(csp, /fonts\.googleapis|unsafe-eval/);
});

// ---------- ICS basics ----------
test("lines unfold, params parse (quoted too), text unescapes", () => {
  const ls = C.icsLines("A;X=1;TZID=\"Area/Some:thing\":v:al\r\n ue\r\nB:x\\, y\\nz\\;\\\\");
  assert.deepEqual(ls[0], { name: "A", params: { X: "1", TZID: "Area/Some:thing" }, value: "v:alue" });
  assert.equal(C.unescapeText(ls[1].value), "x, y\nz;\\");
});
test("calendar name and zone; nested VALARM is ignored", () => {
  const cal = C.parseICS(edge);
  assert.equal(cal.name, "Edge, cases");
  const tzEv = cal.events.find(e => e.props.UID.value === "tz-1");
  assert.equal(tzEv.props.SUMMARY.value, "Hammer'd Heads @ Ice Holes");
});
test("floating times use X-WR-TIMEZONE (the Sports-IT feed shape)", () => {
  const d = C.parseIcsDate("20261018T193000", {}, NY);
  assert.equal(new Date(d.ms).toISOString(), "2026-10-18T23:30:00.000Z");
  const winter = C.parseIcsDate("20261129T193000", {}, NY); // after DST ends
  assert.equal(new Date(winter.ms).toISOString(), "2026-11-30T00:30:00.000Z");
});
test("TZID, UTC, all-day and Windows zone names", () => {
  assert.equal(new Date(C.parseIcsDate("20261107T200000", { TZID: "America/Chicago" }).ms).toISOString(), "2026-11-08T02:00:00.000Z");
  assert.equal(new Date(C.parseIcsDate("20261108T020000Z").ms).toISOString(), "2026-11-08T02:00:00.000Z");
  const ad = C.parseIcsDate("20261128", { VALUE: "DATE" }, NY);
  assert.equal(ad.allDay, true);
  assert.equal(new Date(ad.ms).toISOString(), "2026-11-28T05:00:00.000Z");
  assert.equal(C.validTz("Eastern Standard Time"), NY);
  assert.equal(C.validTz("Not/AZone"), "");
});
test("durations", () => {
  assert.equal(C.parseDuration("PT1H30M"), 90 * 60000);
  assert.equal(C.parseDuration("P1D"), 86400000);
  assert.equal(C.parseDuration("nope"), null);
});
test("weekly RRULE with COUNT, EXDATE and a moved occurrence (RECURRENCE-ID)", () => {
  const evs = C.icsEvents(edge, { from: 0 }).filter(e => e.uid === "rr-1");
  const when = evs.map(e => C.fmtWhen(e, NY));
  assert.deepEqual(when, ["Tue, Oct 20, 6:00 AM", "Tue, Nov 3, 7:00 AM", "Tue, Nov 10, 6:00 AM"]);
  assert.equal(evs[1].summary, "Stick and puck (late)");
});
test("RRULE keeps wall-clock time across daylight saving and honors UNTIL", () => {
  const start = C.parseIcsDate("20261025T210000", {}, NY);
  const occ = C.expandRRule(start, "FREQ=WEEKLY;UNTIL=20261115T000000Z", Infinity, NY);
  assert.deepEqual(occ.map(ms => C.fmtTime(ms, NY)), ["9:00 PM", "9:00 PM", "9:00 PM"]);
  const daily = C.expandRRule(start, "FREQ=DAILY;INTERVAL=2;COUNT=3", Infinity, NY);
  assert.deepEqual(daily.map(ms => C.fmtDay(ms, NY)), ["Sun, Oct 25", "Tue, Oct 27", "Thu, Oct 29"]);
});
test("cancelled events, folded summaries, missing end gets 75 minutes", () => {
  const evs = C.icsEvents(edge, { from: 0 });
  const cx = evs.find(e => e.uid === "cx-1");
  assert.equal(cx.cancelled, true);
  assert.match(cx.summary, /Is Folded Across Lines$/);
  assert.equal(cx.end - cx.start, 75 * 60000);
});

// ---------- Games ----------
test("summaries: upcoming, with a result, our team second, @ for away", () => {
  const names = ["Hammered Heads", "Hammer'd Heads"];
  assert.deepEqual(C.parseSummary("Hammered Heads vs Wild Puckers", names), { game: true, us: "Hammered Heads", opponent: "Wild Puckers", away: null, result: null });
  const w = C.parseSummary("Hammered Heads W 8-0 vs Seal Team Sticks (Muckers)", names);
  assert.equal(w.opponent, "Seal Team Sticks (Muckers)");
  assert.deepEqual(w.result, { code: "W", us: 8, them: 0, outcome: "W" });
  const l = C.parseSummary("Puck Hogs vs Hammered Heads L 2-5", names);
  assert.equal(l.opponent, "Puck Hogs");
  assert.deepEqual([l.result.outcome, l.result.us, l.result.them], ["L", 2, 5]);
  const theirs = C.parseSummary("Puck Hogs W 5-2 vs Hammered Heads", names);
  assert.deepEqual([theirs.result.outcome, theirs.result.us, theirs.result.them], ["L", 2, 5]);
  assert.equal(C.parseSummary("Hammer’d Heads @ Ice Holes", names).away, true);
  assert.equal(C.parseSummary("HAMMERED HEADS T 3-3 vs X", names).result.outcome, "T");
});
test("non-games: pickup skates and other teams' games", () => {
  const names = ["Hammered Heads"];
  assert.equal(C.parseSummary("Adult Pickup - Skaters", names).game, false);
  assert.equal(C.parseSummary("Blue Liners vs Top Shelf", names).game, false);
  assert.equal(C.parseSummary("Stick and puck", names).game, false);
});
test("team names match without case or the apostrophe", () => {
  assert.equal(C.normTeam("Hammer'd Heads"), C.normTeam("hammered heads"));
  assert.equal(C.normTeam("Hammer’d  Heads!"), "hammered heads");
});
test("rink locations split into venue, sheet and address", () => {
  assert.deepEqual(C.parseLocation("Polar Ice Wilmington on Wilmington Rink 7201 Ogden Business Ln  Wilmington NC 28411"),
    { venue: "Polar Ice Wilmington", sheet: "Wilmington Rink", address: "7201 Ogden Business Ln Wilmington NC 28411" });
  assert.equal(C.parseLocation("Polar Ice Wilmington on Wilmington Rink - W1 7201 Ogden Business Ln Wilmington NC 28411").sheet, "Wilmington Rink W1");
  assert.deepEqual(C.parseLocation("Big Rink, Sheet 2"), { venue: "Big Rink, Sheet 2", sheet: "", address: "" });
  assert.equal(C.parseLocation("").venue, "");
});
test("the sample feed: 9 games (2 with results), 2 other events, in New York time", () => {
  const s = C.buildSchedule(sample, TEAM, { from: 0 });
  assert.equal(s.tz, NY);
  assert.equal(s.games.length, 9);
  assert.equal(s.other.length, 2);
  assert.equal(s.games.filter(g => g.result).length, 2);
  const g = s.games.find(x => !x.result);
  assert.equal(`${C.fmtWhen(g, s.tz)} vs ${g.opponent} · ${C.placeLine(g)}`, "Sun, Oct 18, 7:30 PM vs Wild Pucks · Sample Rink");
});
test("the sample moves forward by whole weeks and keeps its weekday", () => {
  const s = C.buildSchedule(sample, TEAM, { from: 0 });
  const first = s.games.find(x => !x.result);
  const later = Date.UTC(2027, 0, 13);
  const moved = C.rebaseWeeks(s.games, first.start, later);
  const nx = C.nextGame(moved, later);
  assert.ok(nx.start > later && nx.start - later < 7 * 86400000);
  assert.equal(C.fmtDay(nx.start, NY).slice(0, 3), "Sun");
  assert.equal(C.rebaseWeeks(s.games, first.start, first.start - 1), s.games);
});
test("relative days in the calendar's zone", () => {
  const now = Date.parse("2026-10-17T14:00:00Z");
  assert.equal(C.relDay(Date.parse("2026-10-18T23:30:00Z"), now, NY), "Tomorrow");
  assert.equal(C.relDay(Date.parse("2026-10-18T03:30:00Z"), now, NY), "Today"); // 11:30 PM Oct 17 in NY
  assert.equal(C.relDay(Date.parse("2026-10-25T23:30:00Z"), now, NY), "In 8 days");
});

// ---------- Votes ----------
const P = [C.newPlayer({ id: "a", name: "Mike Brennan", number: 9, pos: "C" }), C.newPlayer({ id: "b", name: "Ryan Cole", number: 4, pos: "D" }), C.newPlayer({ id: "c", name: "Joe Novak", number: 30, pos: "G" }), C.newPlayer({ id: "d", name: "Sam Ruiz", pos: "RW" })];
test("votes merge: latest answer per person wins, names match loosely, clearing removes", () => {
  const remote = [{ name: "mike brennan", v: "out", at: 1 }, { name: "Ryan Cole", v: "in", at: 5 }];
  const manual = { x: { name: "Mike  Brennan", v: "in", at: 3 }, y: { name: "Ryan Cole", v: null, at: 4 } };
  const m = C.mergeVotes(remote, manual);
  assert.equal(m["mike brennan"].v, "in");
  assert.equal(m["ryan cole"].v, "in"); // the link answer came after the clear
  assert.equal(C.mergeVotes([{ name: "A", v: "in", at: 1 }], [{ name: "a", v: null, at: 2 }]).a, undefined);
  assert.equal(C.mergeVotes([{ name: "Z", v: "bogus", at: 1 }]).z, undefined);
});
test("tally groups the team and keeps guests", () => {
  const t = C.tally(P, C.mergeVotes([{ name: "Mike Brennan", v: "in" }, { name: "Joe Novak", v: "maybe" }, { name: "Ringer Rick", v: "in" }]));
  assert.deepEqual(t.in.map(p => p.name), ["Mike Brennan", "Ringer Rick"]);
  assert.equal(t.in[1].guest, true);
  assert.deepEqual(t.maybe.map(p => p.id), ["c"]);
  assert.deepEqual(t.none.map(p => p.id), ["b", "d"]);
  assert.equal(C.countLine(t), "2 in · 1 maybe · 0 out");
  assert.equal(t.byId["guest:ringer rick"].pos, "F");
});

// ---------- Lines ----------
test("slots follow the team setup", () => {
  assert.equal(C.allSlots({ lines: 3, pairs: 3, goalies: 1 }).length, 16);
  assert.equal(C.allSlots({ lines: 2, pairs: 2, goalies: 2 }).length, 12);
  assert.deepEqual(C.slotsFor({ lines: 1, pairs: 1 }).map(g => g.id), ["L1", "D1", "G"]);
  assert.deepEqual(C.lineConfig({ lines: 9, pairs: 0 }), { lines: 4, pairs: 3, goalies: 1 });
});
test("place: into a slot, swap with the occupant, to spares, back to the pool", () => {
  let L = C.place(C.emptyLines(), "a", "L1-C");
  L = C.place(L, "d", "L1-RW");
  L = C.place(L, "a", "L1-RW");               // swap
  assert.deepEqual(L.slots, { "L1-RW": "a", "L1-C": "d" });
  L = C.place(L, "b", "bench");
  L = C.place(L, "b", "L1-C");                // from spares onto an occupied slot: occupant goes to spares
  assert.deepEqual(L.slots, { "L1-RW": "a", "L1-C": "b" });
  assert.deepEqual(L.bench, ["d"]);
  L = C.place(L, "a", null);
  assert.equal(C.whereIs(L, "a"), null);
});
test("auto-fill by position, then near positions, leftovers to spares", () => {
  const L = C.autoFill(C.emptyLines(), C.SAMPLE_PLAYERS, { lines: 3, pairs: 2, goalies: 1 });
  const at = id => C.SAMPLE_PLAYERS.find(p => p.id === L.slots[id]);
  assert.equal(at("G1").pos, "G");
  assert.equal(at("L1-C").pos, "C");
  assert.equal(at("L1-LW").pos, "LW");
  assert.ok(["D"].includes(at("D1-L").pos));
  assert.equal(Object.keys(L.slots).length, 14);
  assert.equal(L.bench.length, 2); // the fifth D and the backup goalie
  const kept = C.autoFill(C.place(C.emptyLines(), "s1", "L3-RW"), C.SAMPLE_PLAYERS, {});
  assert.equal(kept.slots["L3-RW"], "s1");
});
test("a short bench fills forward spots with D only when needed, never with a goalie", () => {
  const few = [C.newPlayer({ id: "x", name: "X", pos: "D" }), C.newPlayer({ id: "y", name: "Y", pos: "G" }), C.newPlayer({ id: "z", name: "Z", pos: "D" })];
  const L = C.autoFill(C.emptyLines(), few, { lines: 1, pairs: 1 });
  assert.deepEqual(L.slots, { G1: "y", "D1-L": "x", "D1-R": "z" });
});
test("warnings: open spots, no goalie, and placed players who aren't in", () => {
  const t = C.tally(P, C.mergeVotes([{ name: "Mike Brennan", v: "in" }, { name: "Ryan Cole", v: "out" }]));
  let L = C.place(C.emptyLines(), "a", "L1-C");
  L = C.place(L, "b", "D1-L");
  const w = C.lineWarnings(L, { lines: 1, pairs: 1 }, t);
  assert.deepEqual(w, ["Line 1: LW, RW open.", "D pair 1: RD open.", "No goalie yet.", "Ryan Cole said they're out."]);
  assert.deepEqual(C.lineWarnings(C.emptyLines(), { lines: 1, pairs: 1 }, t).slice(0, 2), ["Line 1 is empty.", "D pair 1 is empty."]);
});
test("prune drops slots beyond the setup (to spares) and players no longer available", () => {
  let L = C.place(C.emptyLines(), "a", "L3-C");
  L = C.place(L, "b", "L1-C");
  const p = C.pruneLines(L, { lines: 2 }, new Set(["a"]));
  assert.deepEqual(p, { slots: {}, bench: ["a"] });
});

// ---------- Share text and links ----------
const G = { opponent: "Wild Pucks", start: Date.parse("2026-10-18T23:30:00Z"), end: Date.parse("2026-10-19T00:45:00Z"), sheet: "Wilmington Rink", venue: "Polar Ice", away: null };
test("WhatsApp links carry the text", () => {
  assert.equal(C.waUrl("In? a&b"), "https://wa.me/?text=In%3F%20a%26b");
});
test("vote message and poll text", () => {
  assert.equal(C.voteMessage(G, TEAM, "https://x/#/v/abc", NY), "Hammer'd Heads: Sun, Oct 18, 7:30 PM vs Wild Pucks\nWilmington Rink\nIn or out? Tap to answer: https://x/#/v/abc");
  assert.deepEqual(C.pollText({ ...G, away: true }, NY), { question: "Sun, Oct 18, 7:30 PM at Wild Pucks. You in?", options: ["In", "Out", "Maybe"] });
});
test("roster text lists every line, open spots, the goalie and spares", () => {
  let L = C.place(C.emptyLines(), "a", "L1-C");
  L = C.place(L, "c", "G1"); L = C.place(L, "d", "bench");
  const find = id => P.find(p => p.id === id);
  const t = C.rosterText(G, TEAM, L, find, { lines: 1, pairs: 1 }, "https://x/#/r/1", NY);
  assert.equal(t, ["Hammer'd Heads lines", "Sun, Oct 18, 7:30 PM vs Wild Pucks", "Wilmington Rink", "", "L1  open · Mike Brennan 9 · open", "D1  open · open", "G  Joe Novak 30", "Spares  Sam Ruiz", "", "Lines: https://x/#/r/1"].join("\n"));
  assert.match(C.rosterText(G, TEAM, L, find, { lines: 1, pairs: 1, goalies: 2 }, "", NY), /G {2}Joe Novak 30 \(backup open\)/);
});
test("roster links round-trip without a server, and bad ones fail safely", () => {
  const find = id => C.SAMPLE_PLAYERS.find(p => p.id === id);
  const L = C.autoFill(C.emptyLines(), C.SAMPLE_PLAYERS, {});
  const code = C.encodeRoster({ g: G, team: TEAM, lines: L, find, cfg: {}, tz: NY });
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  assert.ok(code.length < 900, `link part is ${code.length} characters`);
  const d = C.decodeRoster(code);
  assert.equal(d.team.display, "Hammer'd Heads");
  assert.equal(d.g.opponent, "Wild Pucks");
  assert.equal(d.g.start, G.start);
  assert.equal(d.tz, NY);
  const name = s => d.players.find(p => p.id === d.lines.slots[s])?.name;
  assert.equal(name("L1-C"), find(L.slots["L1-C"]).name);
  assert.equal(d.lines.bench.length, L.bench.length);
  assert.equal(C.decodeRoster("not-a-roster"), null);
  assert.equal(C.decodeRoster(""), null);
});
test("tokens are long and random; relay and feed addresses are cleaned", () => {
  const a = C.randomToken(), b = C.randomToken();
  assert.match(a, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(a, b);
  assert.equal(C.cleanRelay("https://lines-relay.me.workers.dev/"), "https://lines-relay.me.workers.dev");
  assert.equal(C.cleanRelay("http://evil.example"), "");
  assert.equal(C.cleanRelay("http://localhost:8787"), "http://localhost:8787");
  assert.equal(C.feedHttps("webcal://host/ical/?cid=x"), "https://host/ical/?cid=x");
});
test("players are cleaned", () => {
  const p = C.newPlayer({ name: "  <b>Sam</b>  ", number: "07x", pos: "Z" });
  assert.equal(p.name, "bSam/b");
  assert.equal(p.number, "07");
  assert.equal(p.pos, "F");
  assert.deepEqual([...C.SAMPLE_PLAYERS].sort(C.byRole).slice(-2).map(x => x.pos), ["G", "G"]);
  assert.equal(C.shortName("Mike Brennan"), "M. Brennan");
});
