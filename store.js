// Where Lines keeps the manager's data: one JSON record in localStorage on this
// phone (the team, settings, the cached calendar, and each game's answers and
// lines). Small enough that localStorage is plenty; backups are plain JSON.
import { DEFAULT_TEAM, SAMPLE_PLAYERS, newPlayer } from "./core.js";

const KEY = "lines-v1";
export const fresh = () => ({ v: 1, team: { ...DEFAULT_TEAM }, players: SAMPLE_PLAYERS.map(p => ({ ...p })), feed: { text: "", fetchedAt: 0, error: "", sample: true }, games: {}, seeded: false });

export function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!d || d.v !== 1) return fresh();
    const base = fresh();
    return { ...base, ...d, team: { ...base.team, ...d.team }, feed: { ...base.feed, ...d.feed }, players: (d.players || []).map(newPlayer), games: d.games || {} };
  } catch { return fresh(); }
}

let onError = null;
export const onSaveError = fn => { onError = fn; };
export function save(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); }
  catch { onError?.(); }
}

/** A backup leaves out the feed address (it holds a private key) unless asked. */
export function backup(data, withFeed = false) {
  const copy = JSON.parse(JSON.stringify(data));
  if (!withFeed) copy.team.feedUrl = "";
  copy.backupAt = new Date().toISOString();
  return JSON.stringify(copy, null, 2);
}
export function restore(text) {
  const d = JSON.parse(text);
  if (!d || d.v !== 1 || !Array.isArray(d.players)) throw new Error("That isn't a Lines backup.");
  localStorage.setItem(KEY, JSON.stringify(d));
  return load();
}
