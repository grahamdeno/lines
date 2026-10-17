// Lines: pure logic, with no DOM, storage or network, so it can be unit tested
// (tests/core.test.mjs). Calendar (ICS) parsing, game and rink details from the
// feed, availability tallies, the lines builder, share text and roster links.

export const VERSION = "0.1.0";

// ---------- Text ----------
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Team names compare without case, spacing, punctuation or the apostrophe in "Hammer'd". */
export function normTeam(s) {
  return String(s || "").toLowerCase().replace(/[\u2018\u2019`´]/g, "'")
    .replace(/([a-z])'d\b/g, "$1ed").replace(/[^a-z0-9]+/g, " ").trim();
}
/** Voter names: same idea, used as the key for one person's vote. */
export const voteKey = s => String(s || "").toLowerCase().replace(/[\u2018\u2019`´']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
export const cleanName = s => String(s || "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);

// ---------- ICS: lines and properties ----------
/** Unfold (RFC 5545 3.1) and split into { name, params, value }. */
export function icsLines(text) {
  const raw = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const out = [];
  for (const line of raw) {
    if (!line.trim()) continue;
    let q = false, colon = -1;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') q = !q;
      else if (c === ":" && !q) { colon = i; break; }
    }
    if (colon < 0) continue;
    const head = line.slice(0, colon), value = line.slice(colon + 1);
    const parts = head.match(/(?:[^;"]|"[^"]*")+/g) || [head];
    const params = {};
    for (const p of parts.slice(1)) {
      const eq = p.indexOf("=");
      if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
    }
    out.push({ name: parts[0].toUpperCase(), params, value });
  }
  return out;
}

export const unescapeText = s => String(s || "").replace(/\\([\\;,nN])/g, (_, c) => (c === "n" || c === "N" ? "\n" : c));

/** Parse a calendar into its name, time zone and raw events (nested blocks like VALARM are skipped). */
export function parseICS(text) {
  const cal = { name: "", tz: "", events: [] };
  let ev = null, depth = 0;
  for (const l of icsLines(text)) {
    if (l.name === "BEGIN") {
      const v = l.value.toUpperCase();
      if (v === "VEVENT" && !ev) { ev = { props: {}, multi: {} }; depth = 0; } else if (ev) depth++;
      continue;
    }
    if (l.name === "END") {
      const v = l.value.toUpperCase();
      if (ev && v === "VEVENT" && depth === 0) { cal.events.push(ev); ev = null; } else if (ev) depth--;
      continue;
    }
    if (!ev) {
      if (l.name === "X-WR-CALNAME") cal.name = unescapeText(l.value);
      if (l.name === "X-WR-TIMEZONE") cal.tz = l.value.trim();
      continue;
    }
    if (depth > 0) continue;
    if (l.name === "EXDATE" || l.name === "RDATE") (ev.multi[l.name] ||= []).push(l);
    else if (!(l.name in ev.props)) ev.props[l.name] = l;
  }
  return cal;
}

// ---------- Time zones ----------
const WINDOWS_TZ = {
  "eastern standard time": "America/New_York", "central standard time": "America/Chicago",
  "mountain standard time": "America/Denver", "pacific standard time": "America/Los_Angeles",
  "us mountain standard time": "America/Phoenix", "alaskan standard time": "America/Anchorage",
  "atlantic standard time": "America/Halifax", "gmt standard time": "Europe/London", "utc": "UTC",
};
export function validTz(tz) {
  if (!tz) return "";
  const t = String(tz).replace(/^\/+/, "").trim();
  const mapped = WINDOWS_TZ[t.toLowerCase()] || t;
  try { new Intl.DateTimeFormat("en-US", { timeZone: mapped }); return mapped; } catch { return ""; }
}
const fmtCache = new Map();
function partsIn(ms, tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    fmtCache.set(tz, f);
  }
  const o = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== "literal") o[p.type] = +p.value;
  return o;
}
/** How far the zone's wall clock is ahead of UTC at that moment, in ms. */
export function tzOffset(ms, tz) {
  const p = partsIn(ms, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}
/** A wall-clock time in a zone, as a UTC instant (handles daylight saving). */
export function zonedToUtc(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  if (!tz || tz === "UTC") return guess;
  const o1 = tzOffset(guess, tz);
  let t = guess - o1;
  const o2 = tzOffset(t, tz);
  if (o2 !== o1) t = guess - o2;
  return t;
}

/**
 * An ICS date or date-time as { ms, allDay, wall } where wall is the wall-clock
 * time as if it were UTC (for repeating in local time). Floating times use the
 * calendar's zone (X-WR-TIMEZONE), as Sports-IT and Dash feeds expect.
 */
export function parseIcsDate(value, params = {}, calTz = "") {
  const v = String(value || "").trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined || params.VALUE === "DATE") {
    const wall = Date.UTC(+y, +mo - 1, +d);
    return { ms: zonedToUtc(+y, +mo, +d, 0, 0, 0, validTz(calTz) || "UTC"), allDay: true, wall, tz: "" };
  }
  const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0));
  if (z) return { ms: wall, allDay: false, wall, tz: "UTC" };
  const tz = validTz(params.TZID) || validTz(calTz) || "";
  return { ms: tz ? zonedToUtc(+y, +mo, +d, +h, +mi, +(s || 0), tz) : wall, allDay: false, wall, tz: tz || "UTC" };
}

export function parseDuration(v) {
  const m = String(v || "").match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const ms = ((+m[2] || 0) * 7 * 86400 + (+m[3] || 0) * 86400 + (+m[4] || 0) * 3600 + (+m[5] || 0) * 60 + (+m[6] || 0)) * 1000;
  return m[1] === "-" ? -ms : ms;
}

// ---------- Repeating events (the RRULE basics) ----------
const DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
export function parseRRule(s) {
  const r = {};
  for (const part of String(s || "").split(";")) {
    const [k, v] = part.split("=");
    if (k && v) r[k.toUpperCase()] = v;
  }
  return r;
}
/** Start instants (UTC ms) of a repeating event, up to `to` and at most 500. */
export function expandRRule(start, rule, to, calTz = "") {
  const r = parseRRule(rule);
  const freq = r.FREQ, interval = Math.max(1, +r.INTERVAL || 1);
  const count = r.COUNT ? +r.COUNT : Infinity;
  const until = r.UNTIL ? parseIcsDate(r.UNTIL, {}, calTz)?.ms ?? Infinity : Infinity;
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return [start.ms];
  const toWall = w => {
    if (start.allDay || start.tz === "UTC") return start.allDay ? zonedToUtc(...wallParts(w), validTz(calTz) || "UTC") : w;
    return zonedToUtc(...wallParts(w), start.tz);
  };
  const out = [];
  const D = 86400000;
  const byday = (r.BYDAY || "").split(",").map(x => DAYS[x.slice(-2)]).filter(x => x !== undefined);
  let n = 0;
  for (let i = 0; i < 2000 && out.length < 500; i++) {
    let walls;
    if (freq === "DAILY") walls = [start.wall + i * interval * D];
    else if (freq === "WEEKLY") {
      const days = byday.length ? byday : [new Date(start.wall).getUTCDay()];
      const weekStart = start.wall - new Date(start.wall).getUTCDay() * D + i * interval * 7 * D;
      walls = days.slice().sort((a, b) => a - b).map(d => weekStart + d * D).filter(w => w >= start.wall);
    } else {
      const s = new Date(start.wall);
      const months = freq === "MONTHLY" ? i * interval : i * interval * 12;
      const y = s.getUTCFullYear(), m = s.getUTCMonth() + months;
      const w = Date.UTC(y, m, s.getUTCDate(), s.getUTCHours(), s.getUTCMinutes(), s.getUTCSeconds());
      walls = new Date(w).getUTCDate() === s.getUTCDate() ? [w] : [];
    }
    for (const w of walls) {
      const ms = toWall(w);
      if (ms > until || n >= count || ms > to) return out;
      out.push(ms); n++;
    }
  }
  return out;
}
function wallParts(w) {
  const d = new Date(w);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()];
}

/**
 * Calendar events as plain objects, repeats expanded, overrides (RECURRENCE-ID)
 * and EXDATEs applied, sorted by start. Each: { id, uid, start, end, allDay,
 * summary, location, description, status, cancelled, tz }.
 */
export function icsEvents(text, { from = -Infinity, to = Date.now() + 400 * 86400000 } = {}) {
  const cal = parseICS(text);
  const tz = validTz(cal.tz);
  const overrides = new Map();
  const list = [];
  for (const ev of cal.events) {
    const P = k => ev.props[k];
    const start = P("DTSTART") && parseIcsDate(P("DTSTART").value, P("DTSTART").params, tz);
    if (!start) continue;
    const uid = P("UID") ? P("UID").value.trim() : `${start.ms}-${list.length}`;
    let dur;
    const endP = P("DTEND") && parseIcsDate(P("DTEND").value, P("DTEND").params, tz);
    if (endP) dur = endP.ms - start.ms;
    else if (P("DURATION")) dur = parseDuration(P("DURATION").value);
    if (dur == null || dur < 0) dur = start.allDay ? 86400000 : 75 * 60000;
    const base = {
      uid, allDay: start.allDay, tz: tz || (start.tz !== "UTC" ? start.tz : ""),
      summary: unescapeText(P("SUMMARY")?.value || "").trim(),
      location: unescapeText(P("LOCATION")?.value || "").replace(/\s+/g, " ").trim(),
      description: unescapeText(P("DESCRIPTION")?.value || "").trim(),
      status: (P("STATUS")?.value || "").trim().toUpperCase(),
    };
    base.cancelled = base.status === "CANCELLED" || /^cancel+ed\b|\bcancel+ed\)?$/i.test(base.summary);
    if (P("RECURRENCE-ID")) {
      const rid = parseIcsDate(P("RECURRENCE-ID").value, P("RECURRENCE-ID").params, tz);
      if (rid) { overrides.set(`${uid}@${rid.ms}`, { ...base, start: start.ms, end: start.ms + dur, id: `${uid}@${rid.ms}` }); continue; }
    }
    if (P("RRULE")) {
      const ex = new Set();
      for (const l of ev.multi.EXDATE || []) for (const v of l.value.split(",")) { const d = parseIcsDate(v, l.params, tz); if (d) ex.add(d.ms); }
      for (const ms of expandRRule(start, P("RRULE").value, to, tz)) {
        if (ex.has(ms)) continue;
        list.push({ ...base, id: `${uid}@${ms}`, start: ms, end: ms + dur, repeats: true });
      }
    } else list.push({ ...base, id: uid, start: start.ms, end: start.ms + dur });
  }
  const out = list.map(e => overrides.get(e.id) || e);
  for (const [k, o] of overrides) if (!out.some(e => e.id === k)) out.push(o);
  return out.filter(e => e.end >= from && e.start <= to).sort((a, b) => a.start - b.start || a.summary.localeCompare(b.summary));
}

// ---------- Games from the feed ----------
const SEP = /\s+(vs\.?|v\.?|versus|@|at)\s+/i;
const RESULT = /^(.*?)\s+(W|L|T|OTW|OTL|SOW|SOL)\s+(\d+)\s*[-\u2013:]\s*(\d+)\s*$/i;

/**
 * Read a SUMMARY like "Hammered Heads vs Wild Puckers" or
 * "Hammered Heads W 8-0 vs Seal Team Sticks (Muckers)". `names` are the
 * spellings of our team (the feed's and the display name). A game is an event
 * with "vs" (or "@", "at") where one side is our team.
 * Returns { game, us, opponent, away, result: { code, us, them, outcome } | null }.
 */
export function parseSummary(summary, names = []) {
  const s = String(summary || "").replace(/\s+/g, " ").trim();
  const m = s.match(SEP);
  if (!m) return { game: false };
  let left = s.slice(0, m.index).trim(), right = s.slice(m.index + m[0].length).trim();
  const sep = m[1].toLowerCase();
  // A result ("W 8-0") sits after the team it belongs to.
  let result = null, resultLeft = true;
  const pick = (side, isLeft) => {
    const r = side.match(RESULT);
    if (!r) return side;
    const code = r[2].toUpperCase();
    result = { code, us: +r[3], them: +r[4], outcome: code.endsWith("W") ? "W" : code.endsWith("L") ? "L" : "T" };
    resultLeft = isLeft;
    return r[1].trim();
  };
  left = pick(left, true);
  right = pick(right, false);
  const wanted = names.map(normTeam).filter(Boolean);
  const isUs = side => wanted.some(n => normTeam(side) === n || normTeam(side).startsWith(n + " "));
  let usLeft = true;
  if (wanted.length) {
    if (isUs(left)) usLeft = true;
    else if (isUs(right)) usLeft = false;
    else return { game: false, vs: true };
  }
  const opponent = usLeft ? right : left;
  if (result && resultLeft !== usLeft) result = { ...result, outcome: result.outcome === "W" ? "L" : result.outcome === "L" ? "W" : "T", us: result.them, them: result.us };
  const away = sep === "@" || sep === "at" ? usLeft : null;
  return { game: true, us: usLeft ? left : right, opponent, away, result };
}

/**
 * "Polar Ice Wilmington on Wilmington Rink - W1 7201 Ogden Business Ln Wilmington NC 28411"
 * → { venue, sheet, address }. Anything else comes back as { venue: whole }.
 */
export function parseLocation(loc) {
  const s = String(loc || "").replace(/\s+/g, " ").trim();
  if (!s) return { venue: "", sheet: "", address: "" };
  const m = s.match(/^(.+?)\s+on\s+(.+?)\s+(\d+\s+\S.*)$/i);
  if (m) return { venue: m[1], sheet: m[2].replace(/\s+-\s+/, " "), address: m[3] };
  const a = s.match(/^(.+?)[,\s]+(\d+\s+\S.*)$/);
  if (a) return { venue: a[1].replace(/,$/, ""), sheet: "", address: a[2] };
  return { venue: s, sheet: "", address: "" };
}

/** The place in one short line: "Wilmington Rink W1" or the venue. */
export const placeLine = g => g.sheet || g.venue || "";

/**
 * Split the feed into our games and other events (pickup skates and the like).
 * team: { feedName, display }. Returns { games, other, calName, tz }.
 */
export function buildSchedule(text, team = {}, opts = {}) {
  const cal = parseICS(text);
  const names = [team.feedName, team.display].filter(Boolean);
  const games = [], other = [];
  for (const e of icsEvents(text, opts)) {
    const p = parseSummary(e.summary, names);
    const place = parseLocation(e.location);
    const item = { ...e, ...place };
    if (p.game) games.push({ ...item, opponent: p.opponent, away: p.away, result: p.result });
    else other.push(item);
  }
  return { games, other, calName: cal.name, tz: validTz(cal.tz) };
}

/** Move a sample calendar forward by whole weeks so its next game is still ahead of `now`. */
export function rebaseWeeks(events, firstUpcomingStart, now) {
  if (!(firstUpcomingStart < now)) return events;
  const W = 7 * 86400000;
  const k = Math.ceil((now - firstUpcomingStart) / W);
  return events.map(e => ({ ...e, start: e.start + k * W, end: e.end + k * W }));
}

/** The next game that hasn't ended yet. */
export const nextGame = (games, now) => games.find(g => g.end > now && !g.cancelled) || null;

// ---------- Dates for people ----------
const tidy = s => s.replace(/[\u202f\u00a0]/g, " ");
export const fmtDay = (ms, tz) => tidy(new Intl.DateTimeFormat("en-US", { timeZone: tz || undefined, weekday: "short", month: "short", day: "numeric" }).format(new Date(ms)));
export const fmtTime = (ms, tz) => tidy(new Intl.DateTimeFormat("en-US", { timeZone: tz || undefined, hour: "numeric", minute: "2-digit" }).format(new Date(ms)));
export const fmtWhen = (g, tz) => g.allDay ? fmtDay(g.start, tz) : `${fmtDay(g.start, tz)}, ${fmtTime(g.start, tz)}`;
function dayNumber(ms, tz) {
  const p = partsIn(ms, tz || "UTC");
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / 86400000);
}
/** "Today", "Tomorrow", "In 3 days", "Yesterday", "5 days ago". */
export function relDay(ms, now, tz) {
  const d = dayNumber(ms, tz) - dayNumber(now, tz);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d === -1) return "Yesterday";
  return d > 0 ? `In ${d} days` : `${-d} days ago`;
}
export const resultLine = r => r ? `${r.outcome} ${r.us}-${r.them}` : "";

// ---------- Availability ----------
export const VOTES = ["in", "maybe", "out"];
export const VOTE_LABEL = { in: "In", maybe: "Maybe", out: "Out" };

/** Combine vote lists ({ name, v, at }); the latest answer per person wins. v: null clears. */
export function mergeVotes(...lists) {
  const out = {};
  for (const list of lists) {
    for (const x of Array.isArray(list) ? list : Object.values(list || {})) {
      const k = voteKey(x?.name);
      if (!k) continue;
      if (!out[k] || (x.at || 0) >= (out[k].at || 0)) out[k] = { name: cleanName(x.name), v: VOTES.includes(x.v) ? x.v : null, at: x.at || 0, src: x.src || "" };
    }
  }
  for (const k of Object.keys(out)) if (!out[k].v) delete out[k];
  return out;
}

/**
 * Group the team by answer. Votes from names not on the team come back as
 * guests (position F) so they can still be put on a line.
 * Returns { in, maybe, out, none, byId } where each entry is a player plus `v`.
 */
export function tally(players, votes) {
  const res = { in: [], maybe: [], out: [], none: [], byId: {} };
  const used = new Set();
  for (const p of players) {
    const k = voteKey(p.name);
    const v = votes[k]?.v || null;
    if (v) used.add(k);
    const e = { ...p, v };
    res[v || "none"].push(e);
    res.byId[p.id] = e;
  }
  for (const [k, x] of Object.entries(votes)) {
    if (used.has(k)) continue;
    const e = { id: "guest:" + k, name: x.name, number: "", pos: "F", guest: true, v: x.v };
    res[x.v].push(e);
    res.byId[e.id] = e;
  }
  return res;
}
export const countLine = t => `${t.in.length} in · ${t.maybe.length} maybe · ${t.out.length} out`;

// ---------- Lines ----------
export const POSITIONS = ["C", "LW", "RW", "F", "D", "G"];
export const POS_LABEL = { C: "Center", LW: "Left wing", RW: "Right wing", F: "Forward", D: "Defense", G: "Goalie" };

export const lineConfig = t => ({
  lines: Math.min(4, Math.max(1, +t?.lines || 3)),
  pairs: Math.min(4, Math.max(1, +t?.pairs || 3)),
  goalies: Math.min(2, Math.max(1, +t?.goalies || 1)),
});

/** The slots for a team's setup, in groups: forward lines, D pairs, goalie. */
export function slotsFor(cfg) {
  const c = lineConfig(cfg), groups = [];
  for (let i = 1; i <= c.lines; i++) groups.push({ id: `L${i}`, label: `Line ${i}`, short: `L${i}`, slots: ["LW", "C", "RW"].map(p => ({ id: `L${i}-${p}`, pos: p, label: p })) });
  for (let i = 1; i <= c.pairs; i++) groups.push({ id: `D${i}`, label: `D pair ${i}`, short: `D${i}`, slots: [{ id: `D${i}-L`, pos: "D", label: "LD" }, { id: `D${i}-R`, pos: "D", label: "RD" }] });
  groups.push({ id: "G", label: c.goalies > 1 ? "Goalies" : "Goalie", short: "G", slots: [{ id: "G1", pos: "G", label: "G" }, ...(c.goalies > 1 ? [{ id: "G2", pos: "G", label: "Backup" }] : [])] });
  return groups;
}
export const allSlots = cfg => slotsFor(cfg).flatMap(g => g.slots.map(s => ({ ...s, group: g.id, groupLabel: g.label })));
export const emptyLines = () => ({ slots: {}, bench: [] });

/** Where a player is: a slot id, "bench", or null. */
export function whereIs(lines, id) {
  for (const [s, p] of Object.entries(lines.slots || {})) if (p === id) return s;
  return (lines.bench || []).includes(id) ? "bench" : null;
}

/**
 * Put a player on a slot, on the bench (spares), or back in the pool (null).
 * A player already in the target slot swaps into the mover's old place.
 */
export function place(lines, id, target) {
  const next = { slots: { ...(lines.slots || {}) }, bench: [...(lines.bench || [])] };
  const from = whereIs(next, id);
  if (from === "bench") next.bench = next.bench.filter(x => x !== id);
  else if (from) delete next.slots[from];
  if (target === "bench") { if (!next.bench.includes(id)) next.bench.push(id); }
  else if (target) {
    const there = next.slots[target];
    next.slots[target] = id;
    if (there && there !== id) {
      if (from === "bench") next.bench.push(there);
      else if (from) next.slots[from] = there;
    }
  }
  return next;
}

/** Drop slots that no longer exist (fewer lines) and players no longer available. */
export function pruneLines(lines, cfg, keep) {
  const ids = new Set(allSlots(cfg).map(s => s.id));
  const ok = id => !keep || keep.has(id);
  const slots = {};
  const bench = (lines.bench || []).filter(ok);
  for (const [s, p] of Object.entries(lines.slots || {})) {
    if (!ok(p)) continue;
    if (ids.has(s)) slots[s] = p; else if (!bench.includes(p)) bench.push(p);
  }
  return { slots, bench };
}

const FALLBACK = { C: ["C", "F", "LW", "RW"], LW: ["LW", "F", "RW", "C"], RW: ["RW", "F", "LW", "C"], D: ["D"], G: ["G"] };
/**
 * Fill the empty slots from `pool` (players in order of preference) by their
 * positions: exact position first, then near ones; D only takes D until every
 * forward slot is full, then anyone left. Leftover skaters go to spares.
 */
export function autoFill(lines, pool, cfg) {
  let next = { slots: { ...lines.slots }, bench: [...(lines.bench || [])] };
  const placed = () => new Set([...Object.values(next.slots), ...next.bench]);
  const slots = allSlots(cfg);
  const order = ["G", "C", "LW", "RW", "D"];
  for (let rank = 0; rank < 4; rank++) {
    for (const pos of order) {
      for (const s of slots.filter(x => x.pos === pos && !next.slots[x.id])) {
        const want = FALLBACK[pos][rank];
        if (!want) continue;
        const used = placed();
        const p = pool.find(x => !used.has(x.id) && (x.pos || "F") === want);
        if (p) next = place(next, p.id, s.id);
      }
    }
  }
  // Anyone left (not goalies) fills what's still open, then the rest are spares.
  for (const s of slots.filter(x => x.pos !== "G" && !next.slots[x.id])) {
    const used = placed();
    const p = pool.find(x => !used.has(x.id) && x.pos !== "G");
    if (p) next = place(next, p.id, s.id);
  }
  const used = placed();
  for (const p of pool) if (!used.has(p.id)) next.bench.push(p.id);
  return next;
}

/** What still needs attention, as short plain sentences. */
export function lineWarnings(lines, cfg, t) {
  const out = [];
  for (const g of slotsFor(cfg)) {
    const open = g.slots.filter(s => !lines.slots?.[s.id]);
    if (!open.length) continue;
    if (g.id === "G") { if (!lines.slots?.G1) out.push("No goalie yet."); continue; }
    out.push(open.length === g.slots.length ? `${g.label} is empty.` : `${g.label}: ${open.map(s => s.label).join(", ")} open.`);
  }
  const ids = [...Object.values(lines.slots || {}), ...(lines.bench || [])];
  for (const id of ids) {
    const p = t?.byId?.[id];
    if (!p) continue;
    if (p.v === "out") out.push(`${p.name} said they're out.`);
    else if (p.v === "maybe") out.push(`${p.name} is a maybe.`);
    else if (!p.v) out.push(`${p.name} hasn't answered.`);
  }
  return out;
}

// ---------- Sharing ----------
export const waUrl = text => `https://wa.me/?text=${encodeURIComponent(text)}`;
const who = p => p ? `${p.name}${p.number !== "" && p.number != null ? " " + p.number : ""}` : "open";
const vsLine = g => `${g.away ? "at" : "vs"} ${g.opponent || "TBD"}`;

/** The message that goes into the team chat with the vote link. */
export function voteMessage(g, team, link, tz) {
  const where = placeLine(g);
  return [`${team.display || "Game"}: ${fmtWhen(g, tz)} ${vsLine(g)}`, where && `${where}`, `In or out? Tap to answer: ${link}`].filter(Boolean).join("\n");
}

/** A WhatsApp poll can't be made from a link, so this is what to paste into one. */
export function pollText(g, tz) {
  return { question: `${fmtWhen(g, tz)} ${vsLine(g)}. You in?`, options: ["In", "Out", "Maybe"] };
}

/** The lines as WhatsApp text. find(id) returns the player. */
export function rosterText(g, team, lines, find, cfg, link, tz) {
  const rows = [`${team.display || "Lines"} lines`, `${fmtWhen(g, tz)} ${vsLine(g)}`];
  if (placeLine(g)) rows.push(placeLine(g));
  rows.push("");
  for (const grp of slotsFor(cfg)) {
    const names = grp.slots.map(s => who(find(lines.slots?.[s.id])));
    if (grp.id === "G" && names.length > 1) rows.push(`G  ${names[0]} (backup ${names[1]})`);
    else rows.push(`${grp.short}  ${names.join(" · ")}`);
  }
  const spares = (lines.bench || []).map(id => find(id)).filter(Boolean);
  if (spares.length) rows.push(`Spares  ${spares.map(who).join(", ")}`);
  if (link) rows.push("", `Lines: ${link}`);
  return rows.join("\n");
}

// ---------- Links that carry their own data ----------
function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s) {
  const t = atob(String(s).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(t, c => c.charCodeAt(0));
}
/** Random, unguessable id (16 bytes = 22 characters). */
export function randomToken(n = 16) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return b64url(a);
}

/**
 * Pack a set of lines into a link-safe string, so a shared roster needs no
 * server. Compact: players as "name|number|pos", slots in slotsFor order.
 */
export function encodeRoster({ g, team, lines, find, cfg, tz }) {
  const people = [], index = new Map();
  const ref = id => {
    if (!id) return -1;
    if (!index.has(id)) { const p = find(id); if (!p) return -1; index.set(id, people.length); people.push([cleanName(p.name).replace(/\|/g, "/"), p.number ?? "", p.pos || ""].join("|")); }
    return index.get(id);
  };
  const c = lineConfig(cfg);
  const a = allSlots(c).map(s => ref(lines.slots?.[s.id]));
  while (a.length && a[a.length - 1] === -1) a.pop();
  const b = (lines.bench || []).map(ref).filter(i => i >= 0);
  const data = { v: 2, t: team.display || "", o: g.opponent || "", s: Math.round((g.start || 0) / 60000), z: tz || "", l: placeLine(g), c: [c.lines, c.pairs, c.goalies], p: people, a, ...(b.length ? { b } : {}), ...(g.away ? { w: 1 } : {}), ...(g.allDay ? { d: 1 } : {}) };
  return b64url(new TextEncoder().encode(JSON.stringify(data)));
}
export function decodeRoster(str) {
  try {
    const d = JSON.parse(new TextDecoder().decode(unb64url(str)));
    if (d.v !== 2 || !Array.isArray(d.p)) return null;
    const players = d.p.slice(0, 60).map((x, i) => {
      const [name, number, pos] = String(x).split("|");
      return { id: "p" + i, name: cleanName(name), number: String(number ?? "").replace(/[^0-9]/g, "").slice(0, 2), pos: POSITIONS.includes(pos) ? pos : "" };
    });
    const cfg = lineConfig({ lines: d.c?.[0], pairs: d.c?.[1], goalies: d.c?.[2] });
    const slots = {};
    allSlots(cfg).forEach((s, i) => { const p = players[d.a?.[i]]; if (p) slots[s.id] = p.id; });
    return {
      team: { display: cleanName(d.t) }, tz: validTz(d.z), cfg, players,
      g: { opponent: cleanName(d.o), away: !!d.w, start: (+d.s || 0) * 60000, allDay: !!d.d, sheet: String(d.l || "").slice(0, 80) },
      lines: { slots, bench: (d.b || []).map(i => players[i]?.id).filter(Boolean) },
    };
  } catch { return null; }
}

// ---------- The team ----------
export function newPlayer(p = {}) {
  return { id: p.id || "p" + randomToken(6), name: cleanName(p.name) || "Player", number: String(p.number ?? "").replace(/[^0-9]/g, "").slice(0, 2), pos: POSITIONS.includes(p.pos) ? p.pos : "F" };
}
/** Sorted for lists: goalies last, then by number. */
export const byRole = (a, b) => (a.pos === "G") - (b.pos === "G") || (+a.number || 999) - (+b.number || 999) || a.name.localeCompare(b.name);

export const SAMPLE_PLAYERS = [
  ["Mike Brennan", 9, "C"], ["Tyler Shaw", 17, "LW"], ["Danny Okafor", 22, "RW"], ["Chris Vance", 11, "C"],
  ["Jake Moreau", 14, "LW"], ["Sam Ruiz", 27, "RW"], ["Pete Lindqvist", 19, "F"], ["Owen Tate", 8, "F"],
  ["Ryan Cole", 4, "D"], ["Marcus Bell", 44, "D"], ["Nate Kowalski", 5, "D"], ["Eli Grant", 2, "D"],
  ["Ben Hollis", 77, "D"], ["Luke Ferraro", 12, "F"], ["Joe Novak", 30, "G"], ["Andy Pham", 35, "G"],
].map(([name, number, pos], i) => newPlayer({ id: "s" + (i + 1), name, number, pos }));

export const DEFAULT_TEAM = { display: "Hammer'd Heads", feedName: "Hammered Heads", feedUrl: "", relay: "", lines: 3, pairs: 3, goalies: 1, showOther: true };

/** A relay address the app will talk to: https only. */
export function cleanRelay(u) {
  try {
    const url = new URL(String(u || "").trim());
    if (url.protocol !== "https:" && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url.origin)) return "";
    return url.origin + url.pathname.replace(/\/+$/, "");
  } catch { return ""; }
}
/** Calendar feeds are often given as webcal://; fetch them as https://. */
export const feedHttps = u => String(u || "").trim().replace(/^webcals?:\/\//i, "https://");

/** The relay the vote links use when a link doesn't name one. Set after deploying worker/ (see README). */
export const DEFAULT_RELAY = "";
/** A short name for tight spaces: "M. Brennan". */
export const shortName = n => { const w = String(n || "").trim().split(/\s+/); return w.length > 1 ? `${w[0][0]}. ${w.slice(1).join(" ")}` : w[0] || ""; };
