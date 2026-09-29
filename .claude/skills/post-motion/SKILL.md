---
name: post-motion
description: >-
  Make short looping demo clips and animated hex-logo heroes for Tanmay's
  blog (tenmeh.github.io), R package posts, and pkgdown sites. A demo clip
  is an MP4 recreated in a browser, not screen-recorded, that shows what an
  R/Shiny package does: skeletons loading, undo steps, a widget reacting. A
  hero is the package's own hex logo animated as a small self-contained SVG.
  Use this skill whenever the user wants a video, GIF, clip, preview,
  animation, demo, or "something playful/moving" for a post, a package, a
  README, or a docs site, even if they don't say "skill" or "video". Also
  use it when a new post about a package needs its preview.mp4 or hero.svg,
  or when an existing clip or hero needs changing.
---

# Post motion: demo clips and hex heroes

Two kinds of motion, made the same careful way. Both have to be *true to the package*: they explain real behaviour, so a viewer who then installs the package sees what the clip promised.

| | Demo clip | Hex hero |
|---|---|---|
| What | A 7–10 s MP4 loop of a recreated app doing the thing the post explains | The package's hex logo come alive, with playful doodles around it |
| File | `posts/<slug>/preview.mp4` + `preview.jpg` | `posts/<slug>/hero.svg` |
| Made by | An HTML scene with a clock, recorded frame by frame | Hand-written SVG with CSS keyframes |
| Shown | Inside the article, where a `::: {.demo-video}` div sits | At the top of the post, and inside the date stamp when the post list is hovered |

Why the clips are recreated rather than screen-recorded: there is often no R in the environment, and a recording made live is jittery and differs on every run. A scene with a clock gives the same frames every time, and you can keep improving it.

## Before you start

1. **Read the package, not your memory of it.** Clone it if it isn't there, for example `/home/user/tenmeh/<pkg>` or `/home/user/<pkg>`. Read its README, its `R/` code for the markup the UI functions write, and its `inst/www/*.css` / `*.js`. A clip must use the package's real class names, CSS and behaviour. For example, bones' actual `bones.css` is vendored into its scene, and rewind's buttons copy what `rewind_buttons()` writes. When the package has CSS, vendor it with a header comment saying where it came from and its licence.
2. **Decide what the one idea of the clip is.** It usually matches the post's main point, such as "one drag is one undo step" or "the skeleton has the shape of the output". Plan 3–5 beats that show it, each with a caption.
3. **Look at the existing ones.** `_previews/bones.html`, `_previews/rewind.html` and `posts/*/hero.svg` in the blog repo are the reference quality. Reuse their structure.

## Making a demo clip

### 1. Write the scene

Copy `assets/scene-template.html`, `assets/scene.css` and `assets/scene.js` from this skill into the repo's scene folder, `_previews/` in the blog. Underscore folders are ignored by Quarto. Then build the app inside `#stage`.

- **Stage.** It is 640x360 CSS pixels, and the recorder captures it at 2x, so design at that size. Use 12px body text, which reads well in a 1280x720 video.
- **App look.** Make it look like a real Shiny app: white page, Bootstrap-like controls (`fluidPage()` is Bootstrap 3, `page_sidebar()` / bslib is 5), and realistic labels and data, such as "Region: North", "Revenue by month" or customer names. Keep the app itself in neutral Shiny colours, and put the blog's colours only on the overlays: the caption pill, keycaps and ripple.
- **Font.** Use Recursive from the blog's `assets/fonts/`, through the `@font-face` block in the template. Scenes must not depend on network fonts.
- **Clock.** `window.renderAt(ms)` must set everything from `ms` alone, and it must work in any order: the recorder may call 0, 33, 66… but `renderAt(5000)` straight after load must also be right. Use the helpers in `scene.js`: `track()` for eased keyframes, `stepAt()` for discrete state, `pulse()` for fade in and out, `setCaption()`, `setCursor()` for pointer paths and click ripples, `setVeil()` for the loop fade, and `freezeAnimations(ms)` to drive any CSS animation the package ships, such as bones' wave.
- **No CSS transitions.** `scene.css` turns them off, because they run in wall-clock time, not scene time.
- **Timing.**
  - Start and end on the same state, with `setVeil()` fading from and to white, so the loop has no jump.
  - Give each beat at least 1.2 s of hold after it happens, so a viewer can read the caption.
  - The whole loop is 7–10 s.
  - Set `window.POSTER_MS` to the frame that explains the most on its own. It becomes the poster.
- **Captions.** Short, plain, one per beat. They say what the viewer should notice: "Recalculating: the old content stays, dimmed", not "Step 3".
- **Pointer and keys.** Use `#cursor` for mouse actions and `#keys` for shortcuts. Keycaps show the real keys (`Ctrl` + `Z`), with `.down` while pressed. Honour the package's real rules. For example, rewind only records a step after its quiet period, so the Undo button enables about 400 ms after the last change.

### 2. Record it

```bash
node .claude/skills/post-motion/scripts/record.mjs _previews/<name>.html posts/<slug>/
```

This writes `preview.mp4` (H.264, 1280x720, 30 fps, faststart, no audio) and `preview.jpg`.
- **Size:** aim for under about 400 KB. Raise `--crf` (for example `--crf 26`) if a clip is heavy.
- **Tools:** it needs Playwright's Chromium and an ffmpeg with libx264. If `ffmpeg` isn't on the PATH, `pip install imageio-ffmpeg` gives one: `FFMPEG=$(python -c "import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())")`.

### 3. Look at it before you show anyone

Playwright's Chromium usually cannot play H.264, so don't judge the clip by playing it there. Make a contact sheet and look at it:

```bash
$FFMPEG -y -i posts/<slug>/preview.mp4 -vf "fps=1,scale=480:-1,tile=3x3" -frames:v 1 /tmp/sheet.png
```

Check:
- **Correctness:** it is true to the package, with no state that the real package would not show.
- **Captions:** each one is readable.
- **Loop:** it is seamless.
- **Details:** nothing is clipped at the stage edge, and icons mean the right thing. An undo arrow must turn anticlockwise; that exact mistake has happened before.

Fix and re-record until the sheet reads as a story.

### 4. Put it in the post

In the post's front matter:

```yaml
preview: preview.mp4
preview-alt: >
  What happens in the clip, in one or two sentences, for screen readers.
```

Then put an empty div where the clip explains the text best. That is usually just before the first detailed section, once the idea has been introduced:

```markdown
::: {.demo-video}
:::
```

The blog's `_filters/post-preview.lua` fills it with an autoplaying, muted, looping video. It uses absolute URLs so the RSS feed, and R-bloggers, show it too. It pauses with controls under reduced motion. It adds the caption "A short recreation of what this post describes, made in a browser." Keep that honesty; override it with `preview-caption:` only if the clip really is a recording.

## Making a hex hero

### 1. Start from the real logo

The vector logo is usually `pkgdown/logo/<pkg>-hex.svg` in the package repo, and the PNG is `man/figures/logo.png`. Copy its paths and colours exactly, so the animation reads as "the logo came alive", not a redraw.

**Leave out the wordmark text.** An SVG loaded through `<img>` cannot load fonts. The user also prefers the heroes as icons only. Re-centre the icon inside the hex once the text is gone.

### 2. Build the SVG

Copy `assets/hero-template.svg` and keep its structure:

- **viewBox `0 0 800 320`.** The hex sits centred in the middle 320x320 square, and doodles fill the sides. The same file is shown wide at the top of the post and cropped to that centre square (`object-fit: cover`) in the date stamp.
- **Self-contained.** Animation lives in an internal `<style>` with CSS `@keyframes`. There are no scripts, fonts or external references, so it animates as `<img src>`.
- **Reduced motion.** Keep `@media (prefers-reduced-motion: reduce) { * { animation: none !important } }`, and make sure frame 0 is a good still.
- **Ground.** A soft cream card (`#fbf8f1`, rounded) keeps it readable on both the light (`#f4efe4`) and dark site themes.
- **Size.** Aim for under about 15 KB.

### 3. Make the motion mean something

The motion should say what the package does, in a playful way. Past examples:
- **bones:** the bone bounces, the two bars get the real teal wave sweep, and side doodles of skeleton bars fill in to ink.
- **rewind:** the ◀◀ arrows nudge backwards, the hex spins back once per loop, and a slider knob retraces its steps, then steps forward again.

Craft rules:
- Loop in 4–6 s, and make the first and last keyframes identical.
- Ease every move (`cubic-bezier`) with no linear jerks, and hold still for part of the loop so it isn't frantic.
- For rotation, use `transform-box: fill-box; transform-origin: center` on the moving group.
- Keep stroke widths consistent: ink outlines about 3–4 px at 800 wide.
- Use the site palette for doodles (ink `#17202a`, accent `#9e2a2b`, accent-soft `#f0ddd4`, rule `#cfc5b1`, muted `#555b66`) plus the package's own colours.
- Check that every icon means the right thing: undo turns anticlockwise, and play points right.

### 4. Review it

```bash
node .claude/skills/post-motion/scripts/hero-stills.mjs posts/<slug>/hero.svg /tmp/hero-stills.png
```

This draws 8 moments of the loop, plus the reduced-motion still, the square crop the date stamp uses, and the hero on the dark background. Look at all of them.

### 5. Put it in the post

```yaml
hero: hero.svg
hero-alt: >
  The <pkg> hex logo, animated: what moves, in one sentence.
```

The Lua filter puts it under the title block, and the post list uses it in the date stamp on hover.

## Finishing

- **Render:** run `quarto render` in the blog. Its pre-render step needs `npm ci` first. Check that `_site/posts/<slug>/` has `preview.mp4`, `preview.jpg` and `hero.svg`, and that `_site/index.xml` uses absolute URLs for them.
- **Local preview:** the video and hero URLs are absolute (`https://tenmeh.github.io/...`), so a local preview shows them only after deploy. That is expected.
- **Commits:** commit the scene HTML with the clip, so the clip can be regenerated. Tanmay is the author *and* committer of every commit (`Tanmay Chanda <81738153+tenmeh@users.noreply.github.com>`). Don't add Co-Authored-By or session trailers, and remove the footer that the GitHub connector appends to pull request descriptions.
- **Show your work:** send the user the contact sheet, the hero stills and the files themselves, before a pull request.
