/*
 * Lines relay: a Cloudflare Worker with two jobs, like Edition's relay.
 *
 *   GET  /feed                    the team calendar from the FEED_URL secret
 *   GET  /ics?url=                a calendar feed from an allowed host (FEED_HOSTS)
 *   PUT  /polls/:token            manager creates or updates a game's poll
 *   GET  /polls/:token            game details, the team's names and the answers
 *   POST /polls/:token/vote       a player answers: { name, v: "in" | "maybe" | "out" }
 *   POST /polls/:token/votes      manager enters answers by hand (from a WhatsApp poll)
 *
 * Calendar feeds don't allow web pages to read them (no CORS), so the app
 * asks here. Polls live in D1. There are no accounts: the poll token in the
 * link is unguessable, and only the manager's secret (stored as a SHA-256
 * hash) can change the game or enter answers for others.
 * Only the app's own address may call it. Deploy: see worker/README.md.
 */

export const ALLOWED_ORIGINS = ["https://grahamdeno.github.io"];
const DEFAULT_FEED_HOSTS = "sports-it.com,daysmartrecreation.com,dashplatform.com";
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
const VOTES = new Set(["in", "maybe", "out"]);
const MAX_VOTERS = 80;
const KEEP_DAYS = 60;

export const allowed = origin => ALLOWED_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": allowed(origin) ? origin : ALLOWED_ORIGINS[0],
    "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}
const json = (status, body, headers) => new Response(JSON.stringify(body), { status, headers: { ...headers, "content-type": "application/json", "cache-control": "no-store" } });
const fail = (status, message, headers) => json(status, { error: { message } }, headers);

export const voteKey = s => String(s || "").toLowerCase().replace(/[\u2018\u2019`´']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const cleanName = s => String(s || "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);

async function sha256(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** The game as the manager sent it, kept small and plain. */
export function cleanGame(g = {}) {
  const str = (v, n) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").slice(0, n);
  return {
    team: str(g.team, 60), opponent: str(g.opponent, 80), start: +g.start || 0, end: +g.end || 0,
    allDay: !!g.allDay, away: g.away === true ? true : g.away === false ? false : null,
    place: str(g.place, 120), address: str(g.address, 160), tz: str(g.tz, 40),
  };
}

// ---------- Storage: D1 in production, a Map in tests ----------
export function d1Store(db) {
  return {
    async getPoll(token) { return db.prepare("SELECT token, admin_hash, game, players, expires FROM polls WHERE token = ?").bind(token).first(); },
    async putPoll(p) {
      await db.prepare("INSERT INTO polls (token, admin_hash, game, players, expires, updated) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(token) DO UPDATE SET game = excluded.game, players = excluded.players, expires = excluded.expires, updated = excluded.updated")
        .bind(p.token, p.admin_hash, p.game, p.players, p.expires, Date.now()).run();
    },
    async votes(token) { return (await db.prepare("SELECT name, v, at FROM votes WHERE token = ? ORDER BY at").bind(token).all()).results || []; },
    async countVotes(token) { return (await db.prepare("SELECT COUNT(*) AS n FROM votes WHERE token = ?").bind(token).first())?.n || 0; },
    async putVote(token, key, name, v, at) {
      await db.prepare("INSERT INTO votes (token, key, name, v, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(token, key) DO UPDATE SET name = excluded.name, v = excluded.v, at = excluded.at").bind(token, key, name, v, at).run();
    },
    async deleteVote(token, key) { await db.prepare("DELETE FROM votes WHERE token = ? AND key = ?").bind(token, key).run(); },
    async hasVote(token, key) { return !!(await db.prepare("SELECT 1 AS x FROM votes WHERE token = ? AND key = ?").bind(token, key).first()); },
    async sweep(now) {
      await db.prepare("DELETE FROM votes WHERE token IN (SELECT token FROM polls WHERE expires < ?)").bind(now).run();
      await db.prepare("DELETE FROM polls WHERE expires < ?").bind(now).run();
    },
  };
}
export function memoryStore() {
  const polls = new Map(), votes = new Map();
  const vk = (t, k) => t + "\u0000" + k;
  return {
    polls, votesMap: votes,
    async getPoll(t) { return polls.get(t) || null; },
    async putPoll(p) { polls.set(p.token, { ...p }); },
    async votes(t) { return [...votes.entries()].filter(([k]) => k.startsWith(t + "\u0000")).map(([, v]) => v).sort((a, b) => a.at - b.at); },
    async countVotes(t) { return (await this.votes(t)).length; },
    async putVote(t, k, name, v, at) { votes.set(vk(t, k), { name, v, at }); },
    async deleteVote(t, k) { votes.delete(vk(t, k)); },
    async hasVote(t, k) { return votes.has(vk(t, k)); },
    async sweep(now) { for (const [t, p] of polls) if (p.expires < now) { polls.delete(t); for (const k of [...votes.keys()]) if (k.startsWith(t + "\u0000")) votes.delete(k); } },
  };
}

// ---------- Calendar feeds ----------
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?$|.*\.local$|.*\.internal$)/i;
export function feedAllowed(u, hosts = DEFAULT_FEED_HOSTS) {
  let url;
  try { url = new URL(String(u || "").replace(/^webcals?:\/\//i, "https://")); } catch { return null; }
  if (url.protocol !== "https:" || PRIVATE_HOST.test(url.hostname)) return null;
  const list = String(hosts).split(",").map(h => h.trim().toLowerCase()).filter(Boolean);
  const h = url.hostname.toLowerCase();
  return list.some(x => h === x || h.endsWith("." + x)) ? url : null;
}

async function fetchFeed(url, cors) {
  let res;
  try {
    res = await fetch(url.href, { headers: { "user-agent": "LinesRelay/0.1 (team calendar)", accept: "text/calendar, text/plain, */*" }, cf: { cacheTtl: 900, cacheEverything: true } });
  } catch { return fail(502, "The relay couldn't reach the calendar.", cors); }
  if (!res.ok) return fail(502, `The calendar answered ${res.status}.`, cors);
  const text = (await res.text()).slice(0, 2_000_000);
  if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 2000))) return fail(502, "That address didn't return a calendar.", cors);
  return new Response(text, { status: 200, headers: { ...cors, "content-type": "text/calendar; charset=utf-8", "cache-control": "no-store" } });
}

// ---------- Requests ----------
export async function handle(request, env = {}, store = env.DB ? d1Store(env.DB) : null) {
  const origin = request.headers.get("origin") || "";
  const cors = corsHeaders(origin);
  if (request.method === "OPTIONS") return new Response(null, { status: allowed(origin) ? 204 : 403, headers: cors });
  if (!allowed(origin)) return fail(403, "This relay only serves Lines.", cors);
  const { pathname, searchParams } = new URL(request.url);

  if (request.method === "GET" && pathname === "/feed") {
    if (!env.FEED_URL) return fail(404, "No FEED_URL secret is set on the relay.", cors);
    const url = feedAllowed(env.FEED_URL, env.FEED_HOSTS || DEFAULT_FEED_HOSTS);
    return url ? fetchFeed(url, cors) : fail(400, "FEED_URL isn't on an allowed calendar host.", cors);
  }
  if (request.method === "GET" && pathname === "/ics") {
    const url = feedAllowed(searchParams.get("url"), env.FEED_HOSTS || DEFAULT_FEED_HOSTS);
    return url ? fetchFeed(url, cors) : fail(400, "Only calendar feeds from the rink's system are relayed.", cors);
  }

  const m = pathname.match(/^\/polls\/([^/]+)(\/vote|\/votes)?$/);
  if (!m) return fail(404, "Not found.", cors);
  if (!store) return fail(500, "The relay has no database (DB binding).", cors);
  const token = m[1];
  if (!TOKEN.test(token)) return fail(400, "That isn't a poll link.", cors);
  const body = request.method === "GET" ? null : await request.json().catch(() => null);
  if (request.method !== "GET" && !body) return fail(400, "Send JSON.", cors);
  const now = Date.now();
  const poll = await store.getPoll(token);
  if (poll && poll.expires < now) return fail(404, "This poll has ended.", cors);

  if (!m[2] && request.method === "GET") {
    if (!poll) return fail(404, "No poll here yet.", cors);
    return json(200, { game: JSON.parse(poll.game), players: JSON.parse(poll.players), votes: await store.votes(token) }, cors);
  }

  if (!m[2] && request.method === "PUT") {
    const admin = String(body.admin || "");
    if (admin.length < 16) return fail(400, "A manager secret is required.", cors);
    const hash = await sha256(admin);
    if (poll && poll.admin_hash !== hash) return fail(403, "Only the manager can change this poll.", cors);
    const game = cleanGame(body.game);
    const players = (Array.isArray(body.players) ? body.players : []).map(cleanName).filter(Boolean).slice(0, MAX_VOTERS);
    const expires = Math.max(game.end || game.start || now, now) + KEEP_DAYS * 86400000;
    await store.putPoll({ token, admin_hash: hash, game: JSON.stringify(game), players: JSON.stringify(players), expires });
    return json(200, { ok: true }, cors);
  }

  if (m[2] === "/vote" && request.method === "POST") {
    if (!poll) return fail(404, "No poll here yet.", cors);
    const name = cleanName(body.name), key = voteKey(name);
    if (!key) return fail(400, "Add your name.", cors);
    if (!VOTES.has(body.v)) return fail(400, "Answer in, maybe or out.", cors);
    if (!(await store.hasVote(token, key)) && (await store.countVotes(token)) >= MAX_VOTERS) return fail(429, "This poll is full.", cors);
    await store.putVote(token, key, name, body.v, now);
    return json(200, { ok: true, votes: await store.votes(token) }, cors);
  }

  if (m[2] === "/votes" && request.method === "POST") {
    if (!poll) return fail(404, "No poll here yet.", cors);
    if (!body.admin || (await sha256(String(body.admin))) !== poll.admin_hash) return fail(403, "Only the manager can enter answers.", cors);
    for (const x of (Array.isArray(body.votes) ? body.votes : []).slice(0, MAX_VOTERS)) {
      const name = cleanName(x?.name), key = voteKey(name);
      if (!key) continue;
      if (x.v == null) await store.deleteVote(token, key);
      else if (VOTES.has(x.v)) await store.putVote(token, key, name, x.v, +x.at || now);
    }
    return json(200, { ok: true, votes: await store.votes(token) }, cors);
  }
  return fail(405, "Not allowed.", cors);
}

export default {
  fetch: (request, env) => handle(request, env),
  // Daily (see wrangler.toml): remove polls 60 days after their game.
  async scheduled(_event, env) { if (env.DB) await d1Store(env.DB).sweep(Date.now()); },
};
