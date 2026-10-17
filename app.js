// Lines: the screens and the router. Home (schedule), a game (who's in and the
// lines), the team, Settings, and the two pages players open from WhatsApp:
// the vote page (#/v/token) and a shared roster (#/r/data).
import * as C from "./core.js";
import { $, copyText, icon, sheet, toast } from "./ui.js";
import { backup, load, onSaveError, restore, save } from "./store.js";
import { relay } from "./api.js";
import { shareCard } from "./card.js";

let data = load();
let sampleText = "";
let sched = { games: [], other: [], tz: "" };
let sel = null;            // the player picked in the lines builder
let pollBusy = false;
let navs = 0;              // in-app moves, so Back goes back only within Lines
const app = $("app");
const base = () => location.origin + location.pathname;
const api = () => relay(data.team.relay || C.DEFAULT_RELAY);
const tz = () => sched.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
const commit = () => save(data);
onSaveError(() => toast("Couldn't save: this phone's storage is full."));

// ---------- Schedule ----------
function rebuild() {
  const text = data.feed.text || sampleText;
  const now = Date.now();
  const s = C.buildSchedule(text, data.team, { from: now - 150 * 86400000 });
  if (!data.feed.text) {
    // The sample stays current: its first unplayed game moves to the coming week.
    const first = s.games.find(g => !g.result);
    if (first) { s.games = C.rebaseWeeks(s.games, first.start, now); s.other = C.rebaseWeeks(s.other, first.start, now); }
  }
  sched = s;
}
const gameById = id => sched.games.find(g => g.id === id);
function gd(id) {
  data.games[id] ||= { votes: {}, remote: [], lines: C.emptyLines(), pool: "in" };
  return data.games[id];
}
const votesFor = id => C.mergeVotes(gd(id).remote, gd(id).votes);
const tallyFor = id => C.tally(data.players, votesFor(id));
const cfg = () => C.lineConfig(data.team);
const spotsNeeded = () => { const c = cfg(); return c.lines * 3 + c.pairs * 2 + 1; };

// The sample answers for the first demo game, so the screens have something in them.
function seedDemo() {
  if (data.seeded || data.feed.text) return;
  const g = C.nextGame(sched.games, Date.now());
  if (!g) return;
  const at = Date.now() - 3600e3;
  const plan = { s7: "maybe", s12: "out", s13: "maybe", s16: "out", s8: null };
  for (const p of data.players) {
    const v = p.id in plan ? plan[p.id] : "in";
    if (v) gd(g.id).votes[C.voteKey(p.name)] = { name: p.name, v, at, src: "manual" };
  }
  data.seeded = true; commit();
}

// ---------- Pieces ----------
const logo = (size = 40) => `<img class="logo" src="icons/logo-256.png" width="${size}" height="${size}" alt="">`;
const iconBtn = (act, name, label, extra = "") => `<button type="button" class="iconbtn" data-act="${act}" aria-label="${label}" ${extra}>${icon(name)}</button>`;
const vs = g => `${g.away ? "at" : "vs"} ${C.esc(g.opponent || "TBD")}`;
const num = p => p.number !== "" && p.number != null ? `<span class="num">${C.esc(p.number)}</span>` : "";
function mast(left, right = "") { return `<header class="mast">${left}<div class="mast-r">${right}</div></header>`; }
function backMast(label) { return mast(`<div class="row">${iconBtn("back", "back", "Back")}<span class="label">${C.esc(label)}</span></div>`); }

// ---------- Home ----------
function home() {
  const now = Date.now(), Z = tz();
  const next = C.nextGame(sched.games, now);
  const upcoming = sched.games.filter(g => g.end > now && g !== next);
  const past = sched.games.filter(g => g.end <= now).reverse();
  const other = sched.other.filter(e => e.end > now).slice(0, 6);
  let lead = `<p class="note">No upcoming games on the calendar.</p>`;
  if (next) {
    const t = tallyFor(next.id), need = spotsNeeded();
    const pct = Math.min(100, Math.round((t.in.length / need) * 100));
    lead = `<a class="lead" href="#/g/${encodeURIComponent(next.id)}">
      <span class="kicker">Next game · ${C.relDay(next.start, now, Z)}</span>
      <h2>${vs(next)}</h2>
      <p class="why">${C.esc(C.fmtWhen(next, Z))} · ${C.esc(C.placeLine(next))}</p>
      <div class="progress" aria-label="${t.in.length} of ${need} spots filled"><div class="bar"><span style="width:${pct}%"></span></div><span class="n">${t.in.length} in · ${t.maybe.length} maybe</span></div>
    </a>`;
  }
  const row = (g, right) => `<a class="rowlink" href="#/g/${encodeURIComponent(g.id)}"><span class="t"><span class="d">${C.esc(C.fmtDay(g.start, Z))}</span> ${vs(g)}</span><span class="m">${right}</span></a>`;
  const banner = !data.feed.text
    ? `<a class="banner" href="#/settings"><span class="dot"></span><span class="t">Sample schedule. Add your team calendar in Settings.</span>${icon("chev")}</a>`
    : data.feed.error ? `<a class="banner warn" href="#/settings"><span class="dot"></span><span class="t">${C.esc(data.feed.error)}</span>${icon("chev")}</a>` : "";
  return `<main class="front">
    ${mast(`<div class="brand">${logo(52)}<div><div class="label accent">Lines</div><div class="teamname">${C.esc(data.team.display)}</div></div></div>`,
      `${iconBtn("go", "team", "Team", 'data-to="#/team"')}${iconBtn("go", "gear", "Settings", 'data-to="#/settings"')}`)}
    ${banner}
    ${lead}
    ${upcoming.length ? `<section class="sec"><h2>Schedule</h2><div class="rows">${upcoming.map(g => row(g, g.cancelled ? "Cancelled" : C.esc(C.fmtTime(g.start, Z)))).join("")}</div></section>` : ""}
    ${past.length ? `<section class="sec"><h2>Results</h2><div class="rows">${past.map(g => row(g, g.result ? `<span class="res ${g.result.outcome}">${C.resultLine(g.result)}</span>` : "Played")).join("")}</div></section>` : ""}
    ${data.team.showOther && other.length ? `<section class="sec"><h2>Also at the rink</h2><div class="rows">${other.map(e => `<div class="rowlink static"><span class="t"><span class="d">${C.esc(C.fmtDay(e.start, Z))}</span> ${C.esc(e.summary)}</span><span class="m">${e.allDay ? "All day" : C.esc(C.fmtTime(e.start, Z))}</span></div>`).join("")}</div></section>` : ""}
  </main>`;
}

// ---------- A game ----------
function game(id, tab) {
  const g = gameById(id);
  if (!g) return `<main class="front">${backMast("Game")}<p class="note">That game isn't on the calendar any more.</p></main>`;
  const Z = tz(), t = tallyFor(id), d = gd(id);
  const lines = tab === "lines";
  const addr = g.address ? ` · <a class="inline" href="https://maps.apple.com/?q=${encodeURIComponent(g.venue + " " + g.address)}" target="_blank" rel="noopener">Directions</a>` : "";
  return `<main class="front has-dock">
    ${backMast(`${C.fmtWhen(g, Z)}`)}
    <div class="masthead"><h1>${vs(g)}</h1><p>${C.esc([C.placeLine(g), g.venue].filter(Boolean).join(" · "))}${addr}${g.result ? ` · <span class="res ${g.result.outcome}">${C.resultLine(g.result)}</span>` : ""}${g.cancelled ? " · Cancelled" : ""}</p></div>
    <div class="chips" role="group" aria-label="View">
      <button type="button" class="chip" data-act="tab" data-tab="who" aria-pressed="${!lines}">Who's in · ${t.in.length}</button>
      <button type="button" class="chip" data-act="tab" data-tab="lines" aria-pressed="${lines}">Lines</button>
    </div>
    ${lines ? linesView(id, t, d) : whoView(id, t, d)}
  </main>
  <div class="dock">${lines
    ? `<button type="button" class="btn primary" data-act="shareLines">${icon("share")}Share lines</button>`
    : `<button type="button" class="btn primary" data-act="ask">${icon("chat")}Ask the team</button>`}</div>`;
}

function whoView(id, t, d) {
  const live = api().live;
  const status = d.token ? (live ? "Answers from the vote link update here." : "Demo poll: answers stay on this phone until the relay is set up.") : "Tap Ask the team to send a vote link, or mark answers yourself.";
  const seg = p => `<div class="seg" role="group" aria-label="${C.esc(p.name)}">${C.VOTES.map(v => `<button type="button" data-act="mark" data-name="${C.esc(p.name)}" data-v="${v}" class="${v}" aria-pressed="${p.v === v}">${C.VOTE_LABEL[v]}</button>`).join("")}</div>`;
  const group = (k, label) => !t[k].length ? "" : `<section class="sec tight"><h3 class="label">${label} · ${t[k].length}</h3><div class="rows">${t[k].slice().sort(C.byRole).map(p => `<div class="prow"><div class="who"><span class="pname">${C.esc(p.name)}</span><span class="meta">${p.number ? "#" + C.esc(p.number) + " · " : ""}${p.guest ? "Guest" : C.esc(p.pos)}</span></div>${seg(p)}</div>`).join("")}</div></section>`;
  return `<p class="note">${status}${d.token ? ` ${iconBtn("refreshPoll", "refresh", "Check for new answers", 'data-small="1"')}` : ""}</p>
    <p class="count">${C.countLine(t)}</p>
    ${group("in", "In")}${group("maybe", "Maybe")}${group("none", "No answer")}${group("out", "Out")}`;
}

function linesView(id, t, d) {
  const c = cfg(), L = C.pruneLines(d.lines, c);
  const pool = d.pool || "in";
  const avail = [...t.in, ...(pool !== "in" ? t.maybe : []), ...(pool === "all" ? [...t.none, ...t.out] : [])];
  const placed = new Set([...Object.values(L.slots), ...L.bench]);
  const left = avail.filter(p => !placed.has(p.id));
  const find = pid => t.byId[pid];
  const selPlaced = sel && placed.has(sel);
  const chip = p => `<button type="button" class="pchip ${p.v || "none"}" data-act="pick" data-id="${C.esc(p.id)}" aria-pressed="${sel === p.id}">${p.number ? `<b>${C.esc(p.number)}</b>` : ""}${C.esc(C.shortName(p.name))}<i>${C.esc(p.pos)}</i></button>`;
  const tile = (s, pid) => {
    const p = find(pid);
    return `<button type="button" class="slot ${p ? "full" : ""} ${p && p.v !== "in" ? "warn" : ""}" data-act="slot" data-slot="${s.id}" aria-pressed="${!!p && sel === pid}" aria-label="${C.esc(s.groupLabel || "")} ${s.label}: ${p ? C.esc(p.name) : "open"}"><span class="pos">${s.label}</span><span class="nm">${p ? C.esc(C.shortName(p.name)) : "Open"}</span></button>`;
  };
  const warn = C.lineWarnings(L, c, t);
  return `<section class="pool" aria-label="Available players">
      <div class="pool-h"><span class="label">${selPlaced ? "Tap a spot to move, or" : left.length ? "Tap a player, then a spot" : "Everyone's placed"}</span>
        ${selPlaced ? `<button type="button" class="chip small" data-act="unplace">Take off</button>` : `<div class="mini-seg" role="group" aria-label="Who to show">${[["in", "In"], ["maybe", "+Maybe"], ["all", "All"]].map(([k, l]) => `<button type="button" data-act="pool" data-pool="${k}" aria-pressed="${pool === k}">${l}</button>`).join("")}</div>`}</div>
      <div class="pchips">${left.map(chip).join("") || `<span class="note">${avail.length ? "All available players are on a line." : "No one has said they're in yet."}</span>`}</div>
    </section>
    ${C.slotsFor(c).map(grp => `<div class="lrow"><span class="lab">${grp.short}</span><div class="slots n${grp.slots.length}">${grp.slots.map(s => tile({ ...s, groupLabel: grp.label }, L.slots[s.id])).join("")}</div></div>`).join("")}
    <div class="lrow"><span class="lab">SP</span><div class="slots bench">${L.bench.map(pid => { const p = find(pid); return p ? `<button type="button" class="slot full" data-act="benchpick" data-id="${C.esc(pid)}" aria-pressed="${sel === pid}" aria-label="Spare: ${C.esc(p.name)}"><span class="pos">Spare</span><span class="nm">${C.esc(C.shortName(p.name))}</span></button>` : ""; }).join("")}<button type="button" class="slot add" data-act="bench" aria-label="Add as spare">${icon("plus")}<span class="nm">Spare</span></button></div></div>
    ${warn.length ? `<div class="warnbox" role="status"><span class="label">To check</span><ul>${warn.map(w => `<li>${C.esc(w)}</li>`).join("")}</ul></div>` : `<div class="okbox" role="status">Every spot is filled.</div>`}
    <div class="tools"><button type="button" class="chip" data-act="autofill">${icon("wand")}Auto-fill</button><button type="button" class="chip" data-act="clearLines">Clear</button></div>`;
}

// ---------- Team ----------
function team() {
  const ps = data.players.slice().sort(C.byRole);
  return `<main class="front has-dock">
    ${backMast("Team")}
    <div class="masthead"><h1>${C.esc(data.team.display)}</h1><p>${ps.length} players. Positions set who goes where when you auto-fill the lines.</p></div>
    <div class="rows">${ps.map(p => `<button type="button" class="rowlink" data-act="editPlayer" data-id="${C.esc(p.id)}"><span class="t">${num(p)}${C.esc(p.name)}</span><span class="m">${C.esc(C.POS_LABEL[p.pos])}</span></button>`).join("")}</div>
  </main>
  <div class="dock"><button type="button" class="btn primary" data-act="editPlayer">${icon("plus")}Add player</button></div>`;
}

function editPlayer(id) {
  const p = data.players.find(x => x.id === id) || C.newPlayer({ name: "", pos: "F" });
  const isNew = !data.players.includes(p);
  const s = sheet(isNew ? "New player" : "Player", `<form class="form" data-form="player">
    <label class="fl">Name<input class="field" name="name" value="${C.esc(isNew ? "" : p.name)}" autocomplete="off" required maxlength="40"></label>
    <label class="fl">Number<input class="field" name="number" value="${C.esc(p.number)}" inputmode="numeric" maxlength="2"></label>
    <fieldset class="fl"><legend>Position</legend><div class="chips wrap">${C.POSITIONS.map(k => `<label class="chip radio"><input type="radio" name="pos" value="${k}" ${p.pos === k ? "checked" : ""}><span>${C.POS_LABEL[k]}</span></label>`).join("")}</div></fieldset>
    <div class="sheet-actions">${isNew ? "" : `<button type="button" class="btn ghost danger" data-del>${icon("trash")}Remove</button>`}<button class="btn primary">Save</button></div>
  </form>`);
  const f = s.el.querySelector("form");
  f.addEventListener("submit", e => {
    e.preventDefault();
    const fd = new FormData(f);
    const np = C.newPlayer({ id: p.id, name: fd.get("name"), number: fd.get("number"), pos: fd.get("pos") });
    if (isNew) data.players.push(np); else Object.assign(p, np);
    commit(); s.close(); render();
  });
  f.querySelector("[data-del]")?.addEventListener("click", () => {
    const i = data.players.indexOf(p);
    data.players.splice(i, 1); commit(); s.close(); render();
    toast(`Removed ${p.name}.`, { label: "Undo", fn: () => { data.players.splice(i, 0, p); commit(); render(); } });
  });
}

// ---------- Settings ----------
function settings() {
  const T = data.team, live = api().live, F = data.feed;
  const when = F.fetchedAt ? new Date(F.fetchedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  const stepper = (key, label, opts) => `<div class="fl"><span>${label}</span><div class="mini-seg" role="group" aria-label="${label}">${opts.map(n => `<button type="button" data-act="setnum" data-key="${key}" data-n="${n}" aria-pressed="${C.lineConfig(T)[key] === n}">${n}</button>`).join("")}</div></div>`;
  return `<main class="front">
    ${backMast("Settings")}
    <div class="masthead"><h1>Settings</h1></div>
    <section class="sec"><h2>Team</h2>
      <label class="fl">Team name<input class="field" data-set="display" value="${C.esc(T.display)}" maxlength="60"></label>
      <label class="fl">Name in the calendar<input class="field" data-set="feedName" value="${C.esc(T.feedName)}" maxlength="60"><small>How the rink's calendar spells the team. Games are the events with this name and "vs".</small></label>
    </section>
    <section class="sec"><h2>Calendar</h2>
      <p class="note">${F.text ? `Your calendar${F.calName ? ` (${C.esc(F.calName)})` : ""}: ${sched.games.length} games${when ? `, updated ${C.esc(when)}` : ""}.` : "Showing the sample schedule."}${F.error ? ` <span class="warn-t">${C.esc(F.error)}</span>` : ""}</p>
      <label class="fl">Calendar feed address<input class="field mono" data-set="feedUrl" type="url" value="${C.esc(T.feedUrl)}" placeholder="https://… /ical/?cid=…&id=…&k=…" autocomplete="off" autocapitalize="off" spellcheck="false"><small>From the rink's site: My Activities, then Sync Your Calendar, then iCal. It contains a private key, so it stays on this phone and is left out of backups. Leave it empty if the relay holds it (FEED_URL).</small></label>
      <div class="tools"><button type="button" class="chip" data-act="loadFeed">${icon("refresh")}Load schedule</button><label class="chip file">${icon("upload")}Open .ics file<input type="file" accept=".ics,text/calendar" data-act="icsFile" hidden></label>${F.text ? `<button type="button" class="chip" data-act="useSample">Use sample</button>` : ""}</div>
      <label class="switch"><input type="checkbox" data-set="showOther" ${T.showOther ? "checked" : ""}><span>Show other rink events (pickup and such) on the home page</span></label>
    </section>
    <section class="sec"><h2>Relay</h2>
      <p class="note">${live ? "Vote links and the calendar go through your relay." : "Not set up yet: vote links work only on this phone (demo), and the calendar can't load from its address. The README has the five-minute setup."}</p>
      <label class="fl">Relay address<input class="field mono" data-set="relay" type="url" value="${C.esc(T.relay)}" placeholder="https://lines-relay.you.workers.dev" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
    </section>
    <section class="sec"><h2>Lines</h2>
      ${stepper("lines", "Forward lines", [2, 3, 4])}${stepper("pairs", "D pairs", [2, 3])}${stepper("goalies", "Goalies", [1, 2])}
    </section>
    <section class="sec"><h2>Backup</h2>
      <div class="tools"><button type="button" class="chip" data-act="export">${icon("download")}Save a backup</button><label class="chip file">${icon("upload")}Restore<input type="file" accept="application/json,.json" data-act="import" hidden></label></div>
    </section>
    <p class="note foot">Lines ${C.VERSION} · <a class="inline" href="https://github.com/grahamdeno/lines" target="_blank" rel="noopener">Source</a></p>
  </main>`;
}

// ---------- Vote page (players) ----------
let voteState = null;
function votePage() {
  const s = voteState;
  if (!s) return `<main class="front vote"><p class="note center">Loading the game…</p></main>`;
  if (s.error) return `<main class="front vote"><div class="vhead">${logo(96)}</div><h1 class="center">Can't open this vote</h1><p class="note center">${C.esc(s.error)}</p></main>`;
  const g = s.poll.game, Z = g.tz || undefined;
  const t = { in: [], maybe: [], out: [] };
  for (const v of s.poll.votes) t[v.v]?.push(v.name);
  const names = [...new Set([...(s.poll.players || []), ...s.poll.votes.map(v => v.name)])].sort((a, b) => a.localeCompare(b));
  const mine = s.poll.votes.find(v => C.voteKey(v.name) === C.voteKey(s.me));
  return `<main class="front vote">
    <div class="vhead">${logo(88)}<span class="label accent">${C.esc(g.team || "")}</span></div>
    <h1 class="center">${g.away ? "at" : "vs"} ${C.esc(g.opponent || "TBD")}</h1>
    <p class="center when">${C.esc(C.fmtWhen(g, Z))}<br><span class="muted">${C.esc(g.place || "")}</span></p>
    ${s.demo ? `<p class="note center">Demo vote: answers stay on this phone.</p>` : ""}
    <section class="sec tight"><h2 class="label">Who are you?</h2>
      <div class="chips wrap names">${names.map(n => `<button type="button" class="chip" data-act="me" data-name="${C.esc(n)}" aria-pressed="${C.voteKey(n) === C.voteKey(s.me)}">${C.esc(n)}</button>`).join("")}</div>
      <label class="fl"><span class="sr-only">Your name</span><input class="field" id="meInput" placeholder="Not listed? Type your name" value="${names.some(n => C.voteKey(n) === C.voteKey(s.me)) ? "" : C.esc(s.me)}" maxlength="40" autocomplete="name"></label>
    </section>
    <div class="bigvote" role="group" aria-label="Your answer">${C.VOTES.map(v => `<button type="button" class="vbtn ${v}" data-act="vote" data-v="${v}" aria-pressed="${mine?.v === v}" ${s.busy ? "disabled" : ""}>${C.VOTE_LABEL[v]}</button>`).join("")}</div>
    <p class="center status" role="status">${mine ? `You're ${mine.v === "maybe" ? "a maybe" : mine.v}, ${C.esc(mine.name.split(" ")[0])}.` : "Pick your name, then tap In, Maybe or Out."}</p>
    <section class="sec tight"><h2 class="label">${t.in.length} in · ${t.maybe.length} maybe · ${t.out.length} out</h2>
      ${t.in.length ? `<p class="names-line">${t.in.map(C.esc).join(", ")}</p>` : ""}
    </section>
  </main>`;
}
async function openVote(token, params) {
  voteState = null; render();
  const addr = params.get("r") || C.DEFAULT_RELAY;
  const demo = params.get("demo") === "1";
  const r = relay(demo ? "" : addr);
  if (!demo && !r.live) { voteState = { error: "This link is missing its relay address. Ask the manager for a new link." }; return render(); }
  try {
    const poll = await r.getPoll(token);
    voteState = { token, r, demo, poll, me: localStorage.getItem("lines-me") || "" };
  } catch (e) { voteState = { error: e.message }; }
  render();
}
async function castVote(v) {
  const s = voteState;
  const typed = C.cleanName($("meInput")?.value || "");
  const name = typed || s.me;
  if (!C.voteKey(name)) { toast("Pick or type your name first."); $("meInput")?.focus(); return; }
  s.me = name; localStorage.setItem("lines-me", name);
  s.busy = true; render();
  try { const res = await s.r.vote(s.token, name, v); s.poll.votes = res.votes; }
  catch (e) { toast(e.message); }
  s.busy = false; render();
}

// ---------- Shared roster page ----------
function rosterPage(code) {
  const d = C.decodeRoster(code);
  if (!d) return `<main class="front vote"><div class="vhead">${logo(88)}</div><h1 class="center">This roster link is broken</h1><p class="note center">Ask for the link again.</p></main>`;
  const find = id => d.players.find(p => p.id === id);
  const groups = C.slotsFor(d.cfg);
  const spares = d.lines.bench.map(find).filter(Boolean);
  return `<main class="front roster">
    <div class="vhead">${logo(88)}<span class="label accent">${C.esc(d.team.display)} · Lines</span></div>
    <h1 class="center">${d.g.away ? "at" : "vs"} ${C.esc(d.g.opponent || "TBD")}</h1>
    <p class="center when">${C.esc(C.fmtWhen(d.g, d.tz || undefined))}${d.g.sheet ? `<br><span class="muted">${C.esc(d.g.sheet)}</span>` : ""}</p>
    <div class="rlist">${groups.map(grp => `<div class="rrow"><span class="lab">${grp.short}</span><div class="slots n${grp.slots.length}">${grp.slots.map(s => { const p = find(d.lines.slots[s.id]); return `<div class="slot ro ${p ? "full" : ""}"><span class="pos">${s.label}</span><span class="nm">${p ? C.esc(p.name) : "Open"}${p?.number ? ` <span class="num">${C.esc(p.number)}</span>` : ""}</span></div>`; }).join("")}</div></div>`).join("")}</div>
    ${spares.length ? `<p class="note center">Spares: ${spares.map(p => C.esc(p.name)).join(", ")}</p>` : ""}
    <div class="tools center"><button type="button" class="chip" data-act="rosterImage">${icon("image")}Save as picture</button></div>
  </main>`;
}

// ---------- Actions ----------
function gamePayload(g) {
  return { team: data.team.display, opponent: g.opponent, start: g.start, end: g.end, allDay: g.allDay, away: g.away, place: [C.placeLine(g), g.venue].filter(Boolean).join(", "), address: g.address || "", tz: tz() };
}
function voteLink(d) {
  const r = api();
  return `${base()}#/v/${d.token}${r.live ? (r.base === C.cleanRelay(C.DEFAULT_RELAY) ? "" : `?r=${encodeURIComponent(r.base)}`) : "?demo=1"}`;
}
async function ensurePoll(g) {
  const d = gd(g.id);
  d.token ||= C.randomToken();
  d.admin ||= C.randomToken(24);
  commit();
  await api().putPoll(d.token, d.admin, gamePayload(g), data.players.map(p => p.name));
  return d;
}
async function ask(g) {
  let d;
  try { d = await ensurePoll(g); } catch (e) { toast(e.message); return; }
  const linkUrl = voteLink(d), Z = tz();
  const msg = C.voteMessage(g, data.team, linkUrl, Z);
  const poll = C.pollText(g, Z);
  const s = sheet("Ask the team", `
    <pre class="preview">${C.esc(msg)}</pre>
    ${api().live ? "" : `<p class="note warn-t">Demo: this link only works on this phone until the relay is set up.</p>`}
    <a class="btn primary" href="${C.waUrl(msg)}" target="_blank" rel="noopener">${icon("chat")}Send in WhatsApp</a>
    <div class="tools"><button type="button" class="chip" data-copy="msg">${icon("copy")}Copy message</button><button type="button" class="chip" data-copy="link">${icon("link")}Copy link</button></div>
    <section class="sec tight"><h3 class="label">Rather use a WhatsApp poll?</h3>
      <p class="note">WhatsApp doesn't let apps make polls in a group chat. In the chat, tap + (or the paperclip), then Poll, and paste this question. Add the options In, Out and Maybe. Then mark the answers under Who's in.</p>
      <pre class="preview">${C.esc(poll.question)}\n\n${poll.options.join("\n")}</pre>
      <div class="tools"><button type="button" class="chip" data-copy="poll">${icon("poll")}Copy poll question</button></div>
    </section>`);
  s.el.addEventListener("click", e => {
    const b = e.target.closest("[data-copy]");
    if (!b) return;
    const k = b.dataset.copy;
    copyText(k === "msg" ? msg : k === "link" ? linkUrl : poll.question, k === "poll" ? "Question copied. Paste it into a new poll." : "Copied.");
  });
}
async function refreshPoll(id, quiet) {
  const d = gd(id);
  if (!d.token || pollBusy) return;
  pollBusy = true;
  try {
    const p = await api().getPoll(d.token);
    d.remote = (p.votes || []).map(v => ({ ...v, src: "link" }));
    commit(); render();
    if (!quiet) toast("Up to date.");
  } catch (e) { if (!quiet) toast(e.message); }
  pollBusy = false;
}
function mark(id, name, v) {
  const d = gd(id), k = C.voteKey(name);
  const cur = votesFor(id)[k]?.v || null;
  const nv = cur === v ? null : v;
  d.votes[k] = { name, v: nv, at: Date.now(), src: "manual" };
  commit(); render();
  if (d.token && d.admin && api().live) api().setVotes(d.token, d.admin, [{ name, v: nv }]).catch(e => toast(e.message));
}
function setLines(id, next) { gd(id).lines = next; commit(); render(); }
function linesShare(g) {
  const t = tallyFor(g.id), d = gd(g.id), c = cfg(), Z = tz();
  const L = C.pruneLines(d.lines, c);
  const find = pid => t.byId[pid];
  const code = C.encodeRoster({ g, team: data.team, lines: L, find, cfg: c, tz: Z });
  const url = `${base()}#/r/${code}`;
  const text = C.rosterText(g, data.team, L, find, c, url, Z);
  const warn = C.lineWarnings(L, c, t);
  const s = sheet("Share the lines", `
    ${warn.length ? `<p class="note warn-t">${warn.length} thing${warn.length > 1 ? "s" : ""} to check: ${C.esc(warn[0])}${warn.length > 1 ? " …" : ""}</p>` : ""}
    <pre class="preview">${C.esc(text.replace(url, "(link to the roster page)"))}</pre>
    <a class="btn primary" href="${C.waUrl(text)}" target="_blank" rel="noopener">${icon("chat")}Send in WhatsApp</a>
    <div class="tools"><button type="button" class="chip" data-x="img">${icon("image")}Share picture</button><button type="button" class="chip" data-x="copy">${icon("copy")}Copy text</button><a class="chip" href="#/r/${code}">${icon("link")}Open roster page</a></div>`);
  s.el.addEventListener("click", async e => {
    const b = e.target.closest("[data-x]");
    if (b?.dataset.x === "copy") copyText(text);
    if (b?.dataset.x === "img") { const r = await shareCard({ team: data.team, g, tz: Z, cfg: c, lines: L, find }); if (r === "saved") toast("Picture saved."); }
    if (e.target.closest('a[href^="#/r/"]')) s.close();
  });
}

async function loadFeed(file) {
  try {
    let text;
    if (file) text = await file.text();
    else {
      const r = api();
      if (!r.live) { toast("Set up the relay first, or open a .ics file."); return; }
      text = await r.feed(data.team.feedUrl);
    }
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("That isn't a calendar file.");
    const cal = C.parseICS(text);
    data.feed = { text, fetchedAt: Date.now(), error: "", sample: false, calName: cal.name, source: file ? "file" : "relay" };
    commit(); rebuild(); render();
    toast(`Loaded ${sched.games.length} games.`);
  } catch (e) { data.feed.error = e.message; commit(); render(); toast(e.message); }
}

// ---------- Router ----------
function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  const [path, q] = h.split("?");
  const parts = path.split("/");
  return { parts, params: new URLSearchParams(q || "") };
}
let lastRoute = "";
function render() {
  const { parts, params } = parseHash();
  const route = parts[0] || "";
  document.body.dataset.route = route || "home";
  let out;
  if (route === "g") out = game(decodeURIComponent(parts[1] || ""), params.get("tab"));
  else if (route === "team") out = team();
  else if (route === "settings") out = settings();
  else if (route === "v") out = votePage();
  else if (route === "r") out = rosterPage(parts[1] || "");
  else out = home();
  const key = location.hash;
  const scroll = key === lastRoute ? app.querySelector(".front")?.scrollTop || 0 : 0;
  app.innerHTML = out;
  if (scroll) app.querySelector(".front").scrollTop = scroll;
  if (key !== lastRoute) { lastRoute = key; app.querySelector("h1, h2")?.setAttribute("tabindex", "-1"); }
}
function routeChanged() {
  sel = null;
  $("toast").classList.remove("show");
  const { parts, params } = parseHash();
  if (parts[0] === "v") return openVote(parts[1] || "", params);
  render();
  if (parts[0] === "g") refreshPoll(decodeURIComponent(parts[1] || ""), true);
}

app.addEventListener("click", e => {
  const el = e.target.closest("[data-act]");
  if (!el || el.tagName === "INPUT") return;
  const act = el.dataset.act;
  const { parts } = parseHash();
  const gid = parts[0] === "g" ? decodeURIComponent(parts[1] || "") : null;
  const g = gid && gameById(gid);
  switch (act) {
    case "go": location.hash = el.dataset.to; break;
    case "back": if (navs > 0) { navs -= 2; history.back(); } else location.hash = "#/"; break;
    case "tab": location.replace(`#/g/${encodeURIComponent(gid)}${el.dataset.tab === "lines" ? "?tab=lines" : ""}`); break;
    case "ask": if (g) ask(g); break;
    case "refreshPoll": refreshPoll(gid); break;
    case "mark": mark(gid, el.dataset.name, el.dataset.v); break;
    case "pool": gd(gid).pool = el.dataset.pool; commit(); render(); break;
    case "pick": sel = sel === el.dataset.id ? null : el.dataset.id; render(); break;
    case "slot": {
      const d = gd(gid), L = C.pruneLines(d.lines, cfg()), here = L.slots[el.dataset.slot];
      if (sel) { setLines(gid, C.place(L, sel, el.dataset.slot)); sel = null; render(); }
      else if (here) { sel = here; render(); }
      else toast("Pick a player first.");
      break;
    }
    case "benchpick": sel = sel === el.dataset.id ? null : el.dataset.id; render(); break;
    case "bench": if (sel) { setLines(gid, C.place(C.pruneLines(gd(gid).lines, cfg()), sel, "bench")); sel = null; render(); } else toast("Pick a player first."); break;
    case "unplace": if (sel) { setLines(gid, C.place(gd(gid).lines, sel, null)); sel = null; render(); } break;
    case "autofill": {
      const d = gd(gid), t = tallyFor(gid);
      const pool = [...t.in, ...(d.pool !== "in" ? t.maybe : [])];
      const before = d.lines;
      setLines(gid, C.autoFill(C.pruneLines(d.lines, cfg(), new Set(pool.map(p => p.id))), pool, cfg()));
      toast("Filled by position.", { label: "Undo", fn: () => setLines(gid, before) });
      break;
    }
    case "clearLines": { const before = gd(gid).lines; setLines(gid, C.emptyLines()); toast("Lines cleared.", { label: "Undo", fn: () => setLines(gid, before) }); break; }
    case "shareLines": if (g) linesShare(g); break;
    case "editPlayer": editPlayer(el.dataset.id); break;
    case "setnum": data.team[el.dataset.key] = +el.dataset.n; commit(); render(); break;
    case "loadFeed": loadFeed(); break;
    case "useSample": { const keep = data.feed; data.feed = { text: "", fetchedAt: 0, error: "", sample: true }; commit(); rebuild(); render(); toast("Showing the sample.", { label: "Undo", fn: () => { data.feed = keep; commit(); rebuild(); render(); } }); break; }
    case "export": {
      const blob = new Blob([backup(data)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `lines-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(a); a.click(); a.remove(); toast("Backup saved (without the calendar address).");
      break;
    }
    case "me": voteState.me = el.dataset.name; if ($("meInput")) $("meInput").value = ""; render(); break;
    case "vote": castVote(el.dataset.v); break;
    case "rosterImage": {
      const d = C.decodeRoster(parts[1] || "");
      if (d) shareCard({ team: d.team, g: d.g, tz: d.tz, cfg: d.cfg, lines: d.lines, find: id => d.players.find(p => p.id === id) }).then(r => r === "saved" && toast("Picture saved."));
      break;
    }
  }
});
app.addEventListener("change", async e => {
  const el = e.target;
  if (el.dataset.set) {
    const k = el.dataset.set;
    data.team[k] = el.type === "checkbox" ? el.checked : k === "relay" ? (el.value.trim() ? C.cleanRelay(el.value) || el.value.trim() : "") : el.value.trim();
    if (k === "display" && !data.team.display) data.team.display = C.DEFAULT_TEAM.display;
    commit(); rebuild(); render();
    if (k === "relay" && el.value.trim() && !C.cleanRelay(el.value)) toast("The relay address must start with https://");
    else toast("Saved.");
  }
  if (el.dataset.act === "icsFile" && el.files[0]) loadFeed(el.files[0]);
  if (el.dataset.act === "import" && el.files[0]) {
    try { data = restore(await el.files[0].text()); rebuild(); render(); toast("Backup restored."); }
    catch (err) { toast(err.message); }
  }
});
app.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "meInput") { e.preventDefault(); e.target.blur(); } });
addEventListener("hashchange", () => { navs = Math.max(0, navs + 1); routeChanged(); });
addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  const { parts } = parseHash();
  if (parts[0] === "g") refreshPoll(decodeURIComponent(parts[1] || ""), true);
});

// ---------- Start ----------
async function start() {
  try { sampleText = await (await fetch("sample/sample.ics")).text(); } catch { sampleText = ""; }
  rebuild(); seedDemo();
  routeChanged();
  // Keep the calendar fresh: at most every three hours, when a relay is set up.
  const r = api();
  if (r.live && data.feed.text && Date.now() - data.feed.fetchedAt > 3 * 3600e3 && parseHash().parts[0] !== "v") loadFeed().catch(() => {});
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
}
start();
