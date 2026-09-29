-- Two things that a post can ask for in its front matter.
--
-- The hero is a small animated illustration at the top of the post, under
-- the title block:
--
--   hero: hero.svg
--   hero-alt: What the picture shows.
--
-- The demo video goes where the author puts it, by an empty div:
--
--   ::: {.demo-video}
--   :::
--
-- and the front matter names the video and the text around it:
--
--   preview: preview.mp4
--   preview-alt: What the video shows.       (optional)
--   preview-caption: A line under the video. (optional)
--
-- The poster is the file with the same name and the extension .jpg. A post
-- with neither is not changed.

local function text(value)
  return value and pandoc.utils.stringify(value) or nil
end

local function attr(value)
  return (value:gsub("&", "&amp;"):gsub('"', "&quot;"):gsub("<", "&lt;"):gsub(">", "&gt;"))
end

-- The RSS feed carries the full post to readers such as R-bloggers, where a
-- relative path would point at their site. So the hero, the video and the poster
-- get absolute URLs, from site-url in _quarto.yml, which Quarto does not pass to
-- filters.
local function absolute(file)
  local root = quarto.project.directory
  local config = root and io.open(root .. "/_quarto.yml")
  if not config then return file end
  local site = config:read("a"):match("site%-url:%s*([^%s#]+)")
  config:close()
  if not site then return file end
  local folder = quarto.doc.input_file:sub(#root + 2):gsub("[^/]*$", "")
  return site:gsub("/$", "") .. "/" .. folder .. file
end

-- The video has controls when the script cannot start it: with no
-- JavaScript, for a reader who asks for reduced motion, and where the
-- browser refuses to play a video by itself.
local function video_html(meta)
  local file = text(meta["preview"])
  if not file or file == "" then return nil end

  local poster = (file:gsub("%.[%w]+$", ".jpg"))
  local alt = text(meta["preview-alt"]) or ""
  local caption = text(meta["preview-caption"])
    or "A short recreation of what this post describes, made in a browser."

  return string.format([[
<figure class="post-preview">
<video src="%s" poster="%s" aria-label="%s" muted loop playsinline preload="metadata" controls></video>
<figcaption>%s</figcaption>
</figure>
<script>
(function () {
  var video = document.currentScript.previousElementSibling.querySelector("video");
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  video.controls = false;
  var started = video.play();
  if (started && started.catch) started.catch(function () { video.controls = true; });
})();
</script>]], attr(absolute(file)), attr(absolute(poster)), attr(alt), attr(caption))
end

function Pandoc(doc)
  local changed = false

  -- The video replaces the empty div, wherever the author put it. A div
  -- with no video to fill it is dropped, so it never leaves a gap.
  local html = video_html(doc.meta)
  local placed = false
  doc = doc:walk({
    Div = function(div)
      if not div.classes:includes("demo-video") then return nil end
      changed = true
      placed = true
      if not html then return {} end
      return pandoc.RawBlock("html", html)
    end,
  })
  if html and not placed then
    quarto.log.warning("preview is set, but the post has no ::: {.demo-video} div to put it in.")
  end

  local hero = text(doc.meta["hero"])
  if hero and hero ~= "" then
    local alt = text(doc.meta["hero-alt"]) or ""
    table.insert(doc.blocks, 1, pandoc.RawBlock("html", string.format(
      '<figure class="post-hero"><img src="%s" alt="%s" width="800" height="320"></figure>',
      attr(absolute(hero)), attr(alt))))
    changed = true
  end

  if changed then return doc end
end
