// Records a scene page to an H.264 MP4 and a JPEG poster, frame by frame.
//
//   node record.mjs <scene.html> <out-dir> [--name preview] [--fps 30] [--crf 21]
//
// The scene page must define:
//   window.DURATION   length of the loop in ms
//   window.POSTER_MS  the moment to use as the poster image
//   window.renderAt(ms)  puts the page in its exact state at that time
//
// The page is 640x360 CSS pixels, captured at a device scale of 2, so the
// video is 1280x720 with sharp text. Nothing is filmed in real time: the
// clock is stepped, so every run gives the same frames.
//
// Needs Playwright with a Chromium (a global install works) and ffmpeg with
// libx264. Set FFMPEG to its path if it is not on the PATH.

import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args.splice(i, 2)[1];
};
const name = flag("name", "preview");
const fps = Number(flag("fps", 30));
const crf = flag("crf", "21");
const [scene, outDir] = args;
if (!scene || !outDir) {
  console.error("Usage: node record.mjs <scene.html> <out-dir> [--name preview] [--fps 30] [--crf 21]");
  process.exit(2);
}
const ffmpeg = process.env.FFMPEG || "ffmpeg";

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
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 640, height: 360 },
  deviceScaleFactor: 2,
  reducedMotion: "no-preference",
});
page.on("pageerror", (e) => console.error("scene error:", e.message));
await page.goto(pathToFileURL(resolve(scene)).href);
await page.evaluate(() => document.fonts.ready);

const { duration, poster } = await page.evaluate(() => ({
  duration: window.DURATION,
  poster: window.POSTER_MS,
}));
if (!duration || (await page.evaluate(() => typeof window.renderAt)) !== "function") {
  throw new Error("The scene must set window.DURATION and window.renderAt(ms).");
}

mkdirSync(outDir, { recursive: true });
const mp4 = join(outDir, `${name}.mp4`);
const jpg = join(outDir, `${name}.jpg`);

const encoder = spawn(
  ffmpeg,
  [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
    "-c:v", "libx264", "-preset", "slow", "-crf", crf, "-tune", "animation",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
    mp4,
  ],
  { stdio: ["pipe", "inherit", "inherit"] },
);
const done = new Promise((ok, fail) => {
  encoder.on("error", fail);
  encoder.on("close", (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg exited with ${code}`))));
});

const frames = Math.round((duration / 1000) * fps);
for (let i = 0; i < frames; i++) {
  await page.evaluate((ms) => window.renderAt(ms), (i * 1000) / fps);
  const png = await page.screenshot({ type: "png" });
  if (!encoder.stdin.write(png)) await new Promise((r) => encoder.stdin.once("drain", r));
}
encoder.stdin.end();
await done;

await page.evaluate((ms) => window.renderAt(ms), poster ?? duration / 2);
await page.screenshot({ type: "jpeg", quality: 84, path: jpg });
await browser.close();

const kb = (f) => `${Math.round(statSync(f).size / 1024)} KB`;
console.log(`${frames} frames at ${fps} fps: ${mp4} (${kb(mp4)}), ${jpg} (${kb(jpg)})`);
