// Draws stills of an animated hero SVG, to review its loop without video.
//
//   node hero-stills.mjs <hero.svg> <out.png> [--frames 8]
//
// Row 1-2: the loop at evenly spaced moments, on the light page.
// Row 3:   the reduced-motion still, the centre-square crop used by the
//          date stamp (three moments), and the hero on the dark page.
//
// Each copy of the SVG is inlined and its CSS animations are paused at a
// set time, so the stills are exact. The loop length is read from the
// longest animation in the file.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const fi = args.indexOf("--frames");
const frames = fi === -1 ? 8 : Number(args.splice(fi, 2)[1]);
const [input, output] = args;
if (!input || !output) {
  console.error("Usage: node hero-stills.mjs <hero.svg> <out.png> [--frames 8]");
  process.exit(2);
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
    return import(pathToFileURL(join(globalRoot, "playwright", "index.mjs")).href);
  }
}

const svg = readFileSync(resolve(input), "utf8").replace(/<\?xml[^>]*>/, "");
const cells = [];
for (let i = 0; i < frames; i++) cells.push({ kind: "wide", at: i / frames, bg: "#f4efe4" });
cells.push({ kind: "wide", still: true, bg: "#f4efe4", label: "reduced motion" });
for (const at of [0, 0.35, 0.7]) cells.push({ kind: "square", at, bg: "#f4efe4" });
cells.push({ kind: "wide", at: 0.5, bg: "#1f1d1b", label: "dark page" });

const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:16px;background:#fff;font:12px/1.3 sans-serif;display:grid;
  grid-template-columns:repeat(4,400px);gap:14px}
.cell{padding:8px;border-radius:8px}
.cell svg{display:block;width:100%;height:auto}
.square{width:176px;height:176px;overflow:hidden;border-radius:22px}
.square svg{width:440px;max-width:none;height:176px;margin-left:-132px}
.label{margin-top:4px;color:#555}
</style>${cells.map((c, i) => `<div><div class="cell ${c.kind}" data-i="${i}" style="background:${c.bg}">${svg}</div>
<div class="label">${c.label ?? (c.kind === "square" ? "stamp crop" : "")} ${c.at !== undefined ? `t=${Math.round(c.at * 100)}%` : ""}</div></div>`).join("")}`;

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 900 } });
await page.setContent(html);
const loop = await page.evaluate((cells) => {
  const all = document.getAnimations();
  const loop = Math.max(0, ...all.map((a) => {
    const t = a.effect.getComputedTiming();
    return Number(t.duration) + Number(t.delay > 0 ? t.delay : 0);
  }));
  document.querySelectorAll(".cell").forEach((cell) => {
    const c = cells[Number(cell.dataset.i)];
    for (const a of cell.querySelector("svg").getAnimations({ subtree: true })) {
      if (c.still) {
        a.cancel();
      } else {
        a.pause();
        a.currentTime = c.at * loop;
      }
    }
  });
  return loop;
}, cells);
await page.screenshot({ path: output, fullPage: true });
await browser.close();
console.log(`${output}: ${frames} moments of a ${loop} ms loop, plus still, stamp crops and dark page`);
