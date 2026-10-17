// Lines building blocks shared by every screen: icons, the toast (with Undo),
// sheets (real dialogs), copying text. Depends only on core.js.
import { esc } from "./core.js";

export const $ = id => document.getElementById(id);

// ---------- Icons: SVG at one stroke weight (as in Edition) ----------
const P = {
  back: '<path d="m14.5 5-7 7 7 7"/>',
  chev: '<path d="m9 5 7 7-7 7"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  team: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c.6-3.3 3-5 6-5s5.4 1.7 6 5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2c2.6-.2 4.5 1.3 5 4.3"/>',
  x: '<path d="M7 7l10 10M17 7 7 17"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  share: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 13v6h14v-6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  chat: '<path d="M4.5 19.5 6 15.6A7.5 7.5 0 1 1 9 18.6z"/>',
  image: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m5 18 5-5 3 3 2.5-2.5L20 17"/>',
  wand: '<path d="M4 20 14.5 9.5"/><path d="m13 8 3 3"/><path d="M17 3.5v3M15.5 5h3M20 9v2M19 10h2"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.6L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.6L20 16"/><path d="M20 20v-4h-4"/>',
  pin: '<path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.3"/>',
  poll: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  trash: '<path d="M4 7h16M10 7V4.5h4V7M6 7l1 13h10l1-13"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4 14v5h16v-5"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4 14v5h16v-5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
};
export const icon = (name, cls = "") => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ""}</svg>`;

// ---------- Toast (Tabs pattern): one line, optional action such as Undo ----------
export function toast(msg, action) {
  const t = $("toast");
  clearTimeout(toast.timer);
  t.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = action.label;
    b.onclick = () => { clearTimeout(toast.timer); t.classList.remove("show"); action.fn(); };
    t.append(b);
  }
  t.classList.add("show");
  toast.timer = setTimeout(() => t.classList.remove("show"), action ? 6000 : 2400);
}

// ---------- Sheets: real dialogs, closed by Escape, the backdrop, or Close ----------
export function sheet(title, body, { onClose, wide } = {}) {
  const d = document.createElement("dialog");
  d.className = "sheet" + (wide ? " wide" : "");
  d.setAttribute("aria-label", title);
  d.innerHTML = `<div class="sheet-in"><header class="sheet-h"><h2>${esc(title)}</h2><button type="button" class="iconbtn" data-close aria-label="Close">${icon("x")}</button></header><div class="sheet-b">${body}</div></div>`;
  const opener = document.activeElement;
  const close = () => d.close();
  d.addEventListener("click", e => { if (e.target === d || e.target.closest("[data-close]")) close(); });
  d.addEventListener("close", () => { d.remove(); onClose?.(); if (opener && opener.focus && document.contains(opener)) opener.focus(); });
  document.body.append(d);
  d.showModal();
  return { el: d, close };
}

/** Copy text; falls back to a selectable box when the clipboard isn't allowed. */
export async function copyText(text, done = "Copied.") {
  try { await navigator.clipboard.writeText(text); toast(done); return true; }
  catch {
    sheet("Copy this", `<textarea class="field mono" rows="6" readonly>${esc(text)}</textarea><p class="note">Press and hold, then Copy.</p>`);
    document.querySelector("dialog.sheet textarea")?.select();
    return false;
  }
}

export const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
