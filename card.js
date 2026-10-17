// The lines as a picture (1080 x 1350) for sharing in WhatsApp: drawn on a
// canvas in the app's colors with the team logo, then shared through the
// phone's share sheet (Web Share with files) or saved.
import { fmtWhen, placeLine, slotsFor } from "./core.js";

const C = { bg: "#070A1F", panel: "#10142E", line: "#262B48", text: "#ECEAE4", muted: "#A3A8BA", gold: "#E4B04E", ice: "#9CC8EA" };
let logo = null;
function loadLogo() {
  if (logo) return logo;
  logo = new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = "icons/logo-512.png"; });
  return logo;
}
function fit(ctx, text, max) {
  let t = text;
  while (t.length > 1 && ctx.measureText(t).width > max) t = t.slice(0, -2) + "…";
  return t;
}

export async function drawCard({ team, g, tz, cfg, lines, find }) {
  await Promise.all([document.fonts?.load?.('400 80px "Instrument Serif"'), document.fonts?.load?.('500 30px "Geist"')].filter(Boolean)).catch(() => {});
  const W = 1080, H = 1350, cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const x = cv.getContext("2d");
  x.fillStyle = C.bg; x.fillRect(0, 0, W, H);
  const img = await loadLogo();
  if (img) x.drawImage(img, 72, 64, 170, 170);
  x.fillStyle = C.gold; x.font = '500 26px "Geist", system-ui, sans-serif';
  x.fillText("LINES", 270, 112);
  x.fillStyle = C.text; x.font = '400 76px "Instrument Serif", Georgia, serif';
  x.fillText(fit(x, `${g.away ? "at" : "vs"} ${g.opponent || "TBD"}`, W - 340), 270, 186);
  x.fillStyle = C.muted; x.font = '400 30px "Geist", system-ui, sans-serif';
  x.fillText(fit(x, [team.display, fmtWhen(g, tz), placeLine(g)].filter(Boolean).join("  ·  "), W - 340), 270, 232);

  let y = 300;
  const groups = slotsFor(cfg);
  const rowH = Math.min(118, (H - y - 150) / (groups.length + 0.6));
  for (const grp of groups) {
    x.fillStyle = C.panel; x.strokeStyle = C.line; x.lineWidth = 2;
    x.beginPath(); x.roundRect(72, y, W - 144, rowH - 18, 14); x.fill(); x.stroke();
    x.fillStyle = grp.id === "G" ? C.ice : C.gold; x.font = '600 28px "Geist", system-ui, sans-serif';
    x.fillText(grp.short, 100, y + (rowH - 18) / 2 + 10);
    const cellW = (W - 144 - 120) / grp.slots.length;
    grp.slots.forEach((s, i) => {
      const p = find(lines.slots?.[s.id]);
      const cx = 192 + i * cellW;
      x.fillStyle = C.muted; x.font = '500 20px "Geist", system-ui, sans-serif';
      x.fillText(s.label, cx, y + 38);
      x.fillStyle = p ? C.text : C.muted; x.font = '500 32px "Geist", system-ui, sans-serif';
      x.fillText(fit(x, p ? `${p.name}${p.number ? " " + p.number : ""}` : "open", cellW - 24), cx, y + 80);
    });
    y += rowH;
  }
  const spares = (lines.bench || []).map(find).filter(Boolean);
  if (spares.length) {
    x.fillStyle = C.muted; x.font = '400 28px "Geist", system-ui, sans-serif';
    x.fillText(fit(x, "Spares: " + spares.map(p => p.name).join(", "), W - 144), 72, y + 30);
  }
  return new Promise(ok => cv.toBlob(ok, "image/png"));
}

/** Share the picture, or save it when the phone can't share files. */
export async function shareCard(opts) {
  const blob = await drawCard(opts);
  const file = new File([blob], "lines.png", { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: `${opts.team.display} lines` }); return "shared"; }
    catch (e) { if (e?.name === "AbortError") return "cancelled"; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "lines.png";
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return "saved";
}
