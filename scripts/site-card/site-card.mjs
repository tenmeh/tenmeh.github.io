// Draws the share card (the link preview) of a pkgdown site, 1200x630, as a
// still (card.png) and as a GIF (card.gif) that loops once per loop of the hero.
//
//   node scripts/site-card/site-card.mjs            # both packages
//   node scripts/site-card/site-card.mjs bones      # one package
//   node scripts/site-card/site-card.mjs --no-gif   # the still only, quickly
//   node scripts/site-card/site-card.mjs --t 2.2    # freeze the hero at 2.2s
//   node scripts/site-card/site-card.mjs --stills DIR
//                                                   # contact sheets of the
//                                                   # frames, to choose a time
//   node scripts/site-card/site-card.mjs --repos DIR
//                                                   # where the package repos
//                                                   # are (default: the folder
//                                                   # next to this repo)
//
// It writes <repos>/<pkg>/pkgdown/assets/card.png and card.gif. pkgdown copies
// them to the root of the site, and _pkgdown.yml names the GIF as the og:image.
// The card is the cover style of the blog (bone paper, pills, a big name with
// a wavy line, dashed rules) with the animated hero of the package on the
// right. The hero scenes are in scenes/. They are the hero.svg of the posts,
// with the doodles laid out again for the card, so if a hero changes, change
// its scene also.
//
// The still is the hero frozen on a frame where the motion reads (t in the
// config). The GIF is the card frame by frame: each frame pauses every CSS
// animation of the scene and sets its time, so nothing is recorded live. It
// covers exactly one loop of the hero (5.6s, in which every animation of the
// hero repeats a whole number of times), so it loops with no jump. The loop
// starts at t, so the first frame of the GIF is the still. Platforms that do
// not animate a preview show only that first frame. The text does not move.
//
// Playwright is not a dependency of the blog. It is found in the project, or
// else among the global packages (npm root -g), and it needs a Chromium. The
// GIF needs ffmpeg (set FFMPEG to its path if it is not on the PATH), and
// uses gifsicle to make it smaller if that is on the PATH (or set GIFSICLE;
// "npm i gifsicle" has it). The size to keep to is about 600 KB, which is what
// WhatsApp takes for a preview. If a card is larger, lower `colors` or raise
// `lossy` below, or drop `fps`.

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { execSync, execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const blog = join(here, "..", "..");

// --- The config of each package ------------------------------------------------
// name      the big word. The tagline is read from `home: title:` of the
//           _pkgdown.yml of the package, unless one is given here.
// pill      the second pill, after "R package". One value, to change later:
//           bones says "on GitHub" until it is on CRAN, then "on CRAN".
// accent    the dark accent of the site, for the text of the pills
// light     the light accent, for the wavy line (the amber and the teal of
//           the logos)
// scene     the file in scenes/
// t         the second of the 5.6s loop where the hero is frozen
const packages = {
  rewind: {
    name: "rewind",
    url: "tenmeh.github.io/rewind",
    pill: "on CRAN",
    accent: "#87560B",
    light: "#F0A830",
    scene: "rewind",
    t: 2.2,
  },
  bones: {
    name: "bones",
    url: "tenmeh.github.io/bones",
    pill: "on GitHub",
    accent: "#1B6A70",
    light: "#237A80",
    scene: "bones",
    t: 4.0,
  },
};
const AUTHOR = "Tanmay Chanda";

// The GIF. The loop of the hero is 5.6s. At 12.5 fps one frame lasts 8
// hundredths of a second, which is exact for a GIF, and the loop has 70 frames.
const LOOP = 5.6;
const GIF = {
  fps: 12.5,
  colors: 48, // the card is flat colour, so a small palette is enough
  dither: "none", // "none", or "bayer:bayer_scale=5"
  lossy: 30, // gifsicle --lossy; 0 turns it off
};
const PAPER = "#f4efe4";

// --- Arguments --------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  return argv.splice(i, 2)[1];
};
const tOverride = flag("--t");
const stillsDir = flag("--stills");
const noGif = argv.includes("--no-gif") && argv.splice(argv.indexOf("--no-gif"), 1).length > 0;
const reposDir = resolve(flag("--repos") ?? join(blog, ".."));
const chosen = argv.length ? argv : Object.keys(packages);

// --- Small helpers ----------------------------------------------------------------

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
// The accent at 12% over the paper: the tint of the pills of the site.
const tint = (hex, alpha = 0.12) => {
  const a = rgb(hex);
  const p = rgb(PAPER);
  return `rgb(${a.map((v, i) => Math.round(v * alpha + p[i] * (1 - alpha))).join(",")})`;
};

const fontFile = (weight) => pathToFileURL(join(blog, "assets", "fonts", `RecursiveSansLnrSt-${weight}.ttf`)).href;
const fontFaces = [
  ["Regular", 400],
  ["SemiBold", 600],
  ["ExtraBold", 800],
]
  .map(
    ([file, weight]) =>
      `@font-face { font-family: "Recursive Card"; font-weight: ${weight}; font-style: normal; src: url("${fontFile(file)}") format("truetype"); }`,
  )
  .join("\n");

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    const root = execSync("npm root -g", { encoding: "utf8" }).trim();
    return await import(pathToFileURL(join(root, "playwright", "index.mjs")).href);
  }
}

function tagline(pkg, config) {
  if (config.tagline) return config.tagline;
  const yml = YAML.parse(readFileSync(join(reposDir, pkg, "_pkgdown.yml"), "utf8"));
  const title = yml?.home?.title;
  if (!title) throw new Error(`${pkg}/_pkgdown.yml has no home: title:, and the config has no tagline`);
  return title;
}

function htmlFor(pkg, config) {
  const pills = ["R package", config.pill].map((t) => `<span class="pill">${esc(t)}</span>`).join("");
  const values = {
    FONT_FACES: fontFaces,
    ACCENT: config.accent,
    SOFT: tint(config.accent),
    LIGHT: config.light,
    SCENE: readFileSync(join(here, "scenes", `${config.scene}.svg`), "utf8"),
    PILLS: pills,
    NAME: esc(config.name),
    TAGLINE: esc(tagline(pkg, config)),
    URL: esc(config.url),
    AUTHOR: esc(AUTHOR),
  };
  return readFileSync(join(here, "card.html"), "utf8").replace(/\{\{(\w+)\}\}/g, (_, key) => values[key]);
}

// --- The GIF -----------------------------------------------------------------------

const tool = (envName, fallback) => process.env[envName] || fallback;

function has(cmd) {
  try {
    execFileSync(cmd, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Two passes: the palette is made from the differences between frames (only
// the hero moves, so it is the colours of the hero that count), and then
// every frame is drawn with it. Rectangle differencing keeps the file small,
// since a frame stores only the box that changed.
function encodeGif(frames, out) {
  const ffmpeg = tool("FFMPEG", "ffmpeg");
  const palette = join(frames, "palette.png");
  const input = ["-y", "-loglevel", "error", "-framerate", String(GIF.fps), "-i", join(frames, "f%03d.png")];
  execFileSync(ffmpeg, [...input, "-vf", `palettegen=stats_mode=diff:max_colors=${GIF.colors}`, palette]);
  execFileSync(ffmpeg, [
    ...input,
    "-i",
    palette,
    "-lavfi",
    `paletteuse=dither=${GIF.dither}:diff_mode=rectangle`,
    "-loop",
    "0",
    out,
  ]);
  const gifsicle = tool("GIFSICLE", "gifsicle");
  if (has(gifsicle)) {
    const args = ["-O3", "--no-comments", "--no-names"];
    if (GIF.lossy) args.push(`--lossy=${GIF.lossy}`);
    execFileSync(gifsicle, [...args, out, "-o", out]);
  } else {
    console.log("gifsicle not found: the GIF is not optimised");
  }
}

const report = (file, note = "") =>
  `${file}  ${(statSync(file).size / 1024).toFixed(0)} KB${note ? `  (${note})` : ""}`;

// --- Run ------------------------------------------------------------------------------

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const work = mkdtempSync(join(tmpdir(), "site-card-"));
// The page is a file, so that it may read the fonts from other files.

try {
  for (const pkg of chosen) {
    const config = packages[pkg];
    if (!config) throw new Error(`No config for "${pkg}". Known: ${Object.keys(packages).join(", ")}`);
    const file = join(work, `${pkg}.html`);
    writeFileSync(file, htmlFor(pkg, config));

    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(file).href);
    await page.evaluate(() => document.fonts.ready);

    if (stillsDir) {
      mkdirSync(stillsDir, { recursive: true });
      const frames = [];
      for (let t = 0; t < 5.6 - 1e-6; t += 0.4) {
        await page.evaluate((s) => window.freeze(s), t);
        frames.push({ t: Math.round(t * 10) / 10, png: (await page.screenshot()).toString("base64") });
      }
      const sheet = await browser.newPage({ viewport: { width: 1640, height: 1000 } });
      await sheet.setContent(
        `<body style="margin:0;background:#fff;font:14px sans-serif"><div style="display:grid;grid-template-columns:repeat(4,400px);gap:10px;padding:10px">` +
          frames
            .map(
              (f) =>
                `<div><img src="data:image/png;base64,${f.png}" width="400" style="display:block;border:1px solid #ccc"><div>${pkg} t=${f.t}s</div></div>`,
            )
            .join("") +
          `</div></body>`,
      );
      const out = join(stillsDir, `${pkg}-stills.png`);
      await sheet.screenshot({ path: out, fullPage: true });
      await sheet.close();
      console.log(out);
      await page.close();
      continue;
    }

    const t0 = tOverride !== null ? Number(tOverride) : config.t;
    const outDir = join(reposDir, pkg, "pkgdown", "assets");
    mkdirSync(outDir, { recursive: true });

    await page.evaluate((s) => window.freeze(s), t0);
    const still = await page.screenshot();
    writeFileSync(join(outDir, "card.png"), still);
    console.log(report(join(outDir, "card.png")));

    if (!noGif) {
      const frames = join(work, `${pkg}-frames`);
      mkdirSync(frames);
      const n = Math.round(LOOP * GIF.fps);
      for (let k = 0; k < n; k++) {
        await page.evaluate((s) => window.freeze(s), (t0 + (k * LOOP) / n) % LOOP);
        writeFileSync(join(frames, `f${String(k).padStart(3, "0")}.png`), await page.screenshot());
      }
      const gif = join(outDir, "card.gif");
      encodeGif(frames, gif);
      console.log(report(gif, `${n} frames`));
    }
    await page.close();
  }
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}
