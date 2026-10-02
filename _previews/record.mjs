// Records the preview videos of the posts, and their poster images.
//
//   node _previews/record.mjs            both scenes
//   node _previews/record.mjs bones      one scene
//
// Needs Node, Playwright with a Chromium (npm i -g playwright), and ffmpeg
// with libx264 (set FFMPEG to its path if it is not on the PATH).
// Writes posts/<slug>/preview.mp4 and posts/<slug>/preview.jpg, which are
// committed: the site build does not run this script.
//
// The scenes are recreated in the browser, because the apps are R. They
// are not filmed in real time. Each scene has window.renderAt(ms), which
// puts the page in the state of that time, so every frame is the same on
// every run. This script steps the clock 30 times a second, takes a picture
// of each frame at 1280x720 (a 640x360 page at a device scale of 2), and
// pipes the pictures to ffmpeg.

import { spawn, execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const FPS = 30;
const ffmpeg = process.env.FFMPEG || "ffmpeg";

const scenes = {
  bones: "posts/2026-09-28-how-bones-began",
  rewind: "posts/2026-08-27-undo-for-shiny",
  "rewind-diff": "posts/2026-10-02-rewind-0-3-0",
};

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    // A global install is not on the module path of a script.
    const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
    return import(pathToFileURL(join(globalRoot, "playwright", "index.mjs")).href);
  }
}

const { chromium } = await loadPlaywright();
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenes);
const browser = await chromium.launch();

for (const name of wanted) {
  if (!scenes[name]) throw new Error(`Unknown scene "${name}". Use: ${Object.keys(scenes).join(", ")}`);
  const outDir = join(root, scenes[name]);
  const mp4 = join(outDir, "preview.mp4");

  const page = await browser.newPage({
    viewport: { width: 640, height: 360 },
    deviceScaleFactor: 2,
    reducedMotion: "no-preference",
  });
  await page.goto(pathToFileURL(join(here, `${name}.html`)).href);
  await page.evaluate(async () => {
    await Promise.all(["400", "600", "800"].map((w) => document.fonts.load(`${w} 12px "Recursive Preview"`)));
    await document.fonts.ready;
  });
  const { duration, poster } = await page.evaluate(() => ({ duration: window.DURATION, poster: window.POSTER_MS }));

  const encoder = spawn(
    ffmpeg,
    [
      "-y", "-loglevel", "error",
      "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
      "-c:v", "libx264", "-preset", "slow", "-crf", "21", "-tune", "animation",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
      mp4,
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  const done = new Promise((resolve, reject) => {
    encoder.on("error", reject);
    encoder.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
  });

  const frames = Math.round((duration / 1000) * FPS);
  for (let i = 0; i < frames; i++) {
    await page.evaluate((ms) => window.renderAt(ms), (i * 1000) / FPS);
    const png = await page.screenshot({ type: "png" });
    if (!encoder.stdin.write(png)) await new Promise((r) => encoder.stdin.once("drain", r));
  }
  encoder.stdin.end();
  await done;

  await page.evaluate((ms) => window.renderAt(ms), poster);
  await page.screenshot({ type: "jpeg", quality: 84, path: join(outDir, "preview.jpg") });
  await page.close();

  const kb = (f) => `${Math.round(statSync(f).size / 1024)} KB`;
  console.log(`${name}: ${frames} frames, preview.mp4 ${kb(mp4)}, preview.jpg ${kb(join(outDir, "preview.jpg"))}`);
}

await browser.close();
