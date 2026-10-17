// Talking to the relay (worker/lines-relay.js): the calendar feed and the
// shared polls. With no relay set, polls run in demo mode on this phone only.
import { cleanRelay, feedHttps } from "./core.js";

async function call(base, path, opts = {}) {
  let res;
  try {
    res = await fetch(base + path, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}) } });
  } catch { throw new Error("Couldn't reach the relay. Check the address and your connection."); }
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new Error(j?.error?.message || `The relay answered ${res.status}.`);
  }
  return res;
}

export function relay(addr) {
  const base = cleanRelay(addr);
  if (!base) return demo();
  return {
    live: true, base,
    /** The team calendar: the relay's FEED_URL secret when url is empty. */
    async feed(url) { return (await call(base, url ? `/ics?url=${encodeURIComponent(feedHttps(url))}` : "/feed", { headers: { accept: "text/calendar" } })).text(); },
    async getPoll(token) { return (await call(base, `/polls/${token}`)).json(); },
    async putPoll(token, admin, game, players) { return (await call(base, `/polls/${token}`, { method: "PUT", body: JSON.stringify({ admin, game, players }) })).json(); },
    async vote(token, name, v) { return (await call(base, `/polls/${token}/vote`, { method: "POST", body: JSON.stringify({ name, v }) })).json(); },
    async setVotes(token, admin, votes) { return (await call(base, `/polls/${token}/votes`, { method: "POST", body: JSON.stringify({ admin, votes }) })).json(); },
  };
}

// ---------- Demo: the same calls, kept in this browser ----------
const DKEY = "lines-demo-polls";
const read = () => { try { return JSON.parse(localStorage.getItem(DKEY) || "{}"); } catch { return {}; } };
const write = d => localStorage.setItem(DKEY, JSON.stringify(d));
const key = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function demo() {
  return {
    live: false,
    async feed() { throw new Error("Set up the relay to load your calendar (see Settings)."); },
    async getPoll(token) { const p = read()[token]; if (!p) throw new Error("No poll here yet."); return p; },
    async putPoll(token, _admin, game, players) { const d = read(); d[token] = { ...(d[token] || { votes: [] }), game, players }; write(d); return { ok: true }; },
    async vote(token, name, v) {
      const d = read(); const p = d[token]; if (!p) throw new Error("No poll here yet.");
      p.votes = p.votes.filter(x => key(x.name) !== key(name)).concat({ name, v, at: Date.now() }); write(d); return { ok: true, votes: p.votes };
    },
    async setVotes(token, _admin, votes) {
      const d = read(); const p = d[token]; if (!p) return { ok: true, votes: [] };
      for (const x of votes) { p.votes = p.votes.filter(y => key(y.name) !== key(x.name)); if (x.v) p.votes.push({ name: x.name, v: x.v, at: x.at || Date.now() }); }
      write(d); return { ok: true, votes: p.votes };
    },
  };
}
