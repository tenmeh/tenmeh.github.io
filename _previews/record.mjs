// Records the preview videos of the posts, and their poster images.
//
//   node _previews/record.mjs            every scene
//   node _previews/record.mjs bones      one scene
//
// Needs Node, Playwright with a Chromium (npm i -g playwright), and ffmpeg
// with libx264 (set FFMPEG to its path if it is not on the PATH).
// Writes posts/<slug>/preview.mp4 and posts/<slug>/preview.jpg, which are
// committed: the site build does not run this script. A scene can name more
// than one post; the files are then copied to each, so they never differ.
//
// A scene in `gifs` is recorded as an animated GIF instead, for a picture in
// the text of a post: posts/<slug>/<name>.gif, and <name>-still.png, a
// still at POSTER_MS for a reader who asks for reduced motion. A GIF has 15 frames a
// second, at 960x540, with one palette made from all of its frames.
//
// The scenes are recreated in the browser, because the apps are R. They
// are not filmed in real time. Each scene has window.renderAt(ms), which
// puts the page in the state of that time, so every frame is the same on
// every run. This script steps the clock 30 times a second, takes a picture
// of each frame at 1280x720 (a 640x360 page at a device scale of 2), and
// pipes the pictures to ffmpeg.

import { spawn, execSync } from "node:child_process";
import { copyFileSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const FPS = 30;
const ffmpeg = process.env.FFMPEG || "ffmpeg";

const scenes = {
  bones: ["posts/2026-09-28-how-bones-began", "posts/2026-10-26-bones-on-cran"],
  rewind: ["posts/2026-08-27-undo-for-shiny", "posts/2026-10-13-recording-shiny-demos"],
  "rewind-diff": ["posts/2026-10-02-rewind-0-3-0"],
  whence: ["posts/2026-10-25-whence-on-cran"],
};

const gifs = {
  "rewind-hover": ["posts/2026-11-14-rewind-0-4-0", "hover"],
  "rewind-unrecorded": ["posts/2026-11-14-rewind-0-4-0", "unrecorded"],
  "bones-learned": ["posts/2026-11-13-bones-0-2-0", "learned"],
  "bones-failed": ["posts/2026-11-13-bones-0-2-0", "failed"],
};
const GIF_FPS = 15;

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    // A global install is not on the module path of a script.
    // Through the shell, so that npm.cmd is found on Windows too.
    const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
    return import(pathToFileURL(join(globalRoot, "playwright", "index.mjs")).href);
  }
}

const { chromium } = await loadPlaywright();
const all = [...Object.keys(scenes), ...Object.keys(gifs)];
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : all;
const browser = await chromium.launch();

// The page of a scene, with its fonts loaded.
async function openScene(name) {
  const page = await browser.newPage({
    viewport: { width: 640, height: 360 },
    deviceScaleFactor: 2,
    reducedMotion: "no-preference",
  });
  await page.goto(pathToFileURL(join(here, `${name}.html`)).href);
  await page.evaluate(async () => {
    await Promise.all(["400", "600", "700", "800"].map((w) => document.fonts.load(`${w} 12px "Geist Preview"`)));
    await document.fonts.ready;
  });
  return page;
}

// Pipes the frames of a scene, from 0 to DURATION, to an ffmpeg process.
async function pipeFrames(page, fps, args) {
  const encoder = spawn(ffmpeg, args, { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((resolve, reject) => {
    encoder.on("error", reject);
    encoder.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
  });
  const duration = await page.evaluate(() => window.DURATION);
  const frames = Math.round((duration / 1000) * fps);
  for (let i = 0; i < frames; i++) {
    await page.evaluate((ms) => window.renderAt(ms), (i * 1000) / fps);
    const png = await page.screenshot({ type: "png" });
    if (!encoder.stdin.write(png)) await new Promise((r) => encoder.stdin.once("drain", r));
  }
  encoder.stdin.end();
  await done;
  return frames;
}

const kb = (f) => `${Math.round(statSync(f).size / 1024)} KB`;

for (const name of wanted) {
  if (!scenes[name] && !gifs[name]) throw new Error(`Unknown scene "${name}". Use: ${all.join(", ")}`);

  if (gifs[name]) {
    const [post, file] = gifs[name];
    const gif = join(root, post, `${file}.gif`);
    const page = await openScene(name);
    // palettegen makes one palette from every frame. stats_mode=diff weighs
    // the parts that move, such as the pointer and the rail. paletteuse with
    // diff_mode=rectangle redraws only the part of a frame that changed,
    // which keeps the file small.
    const frames = await pipeFrames(page, GIF_FPS, [
      "-y", "-loglevel", "error",
      "-f", "image2pipe", "-framerate", String(GIF_FPS), "-i", "-",
      "-vf",
      "scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];" +
        "[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
      "-loop", "0",
      gif,
    ]);
    const poster = await page.evaluate(() => window.POSTER_MS);
    await page.evaluate((ms) => window.renderAt(ms), poster);
    const still = join(root, post, `${file}-still.png`);
    await page.screenshot({ type: "png", path: still, scale: "device" });
    await page.close();
    // The still is taken at a device scale of 2. ffmpeg scales it to the
    // size of the GIF, so the two have the same size on the page.
    execSync(`"${ffmpeg}" -y -loglevel error -i "${still}" -vf scale=960:-1:flags=lanczos "${still}.tmp.png"`);
    copyFileSync(`${still}.tmp.png`, still);
    rmSync(`${still}.tmp.png`);
    console.log(`${name}: ${frames} frames, ${file}.gif ${kb(gif)}, ${file}-still.png ${kb(still)}`);
    continue;
  }

  const [first, ...others] = scenes[name];
  const outDir = join(root, first);
  const mp4 = join(outDir, "preview.mp4");

  const page = await openScene(name);
  const poster = await page.evaluate(() => window.POSTER_MS);
  const frames = await pipeFrames(page, FPS, [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
    "-c:v", "libx264", "-preset", "slow", "-crf", "21", "-tune", "animation",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
    mp4,
  ]);

  await page.evaluate((ms) => window.renderAt(ms), poster);
  await page.screenshot({ type: "jpeg", quality: 84, path: join(outDir, "preview.jpg") });
  await page.close();

  for (const other of others) {
    for (const file of ["preview.mp4", "preview.jpg"]) copyFileSync(join(outDir, file), join(root, other, file));
  }
  console.log(`${name}: ${frames} frames, preview.mp4 ${kb(mp4)}, preview.jpg ${kb(join(outDir, "preview.jpg"))}` +
    (others.length ? `, copied to ${others.length} more post${others.length > 1 ? "s" : ""}` : ""));
}

await browser.close();
