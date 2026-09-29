-- Puts the preview video of a post at the top of the page, under the title
-- block. The post names the video in its front matter:
--
--   preview: preview.mp4
--   preview-alt: What the video shows.       (optional)
--   preview-caption: A line under the video. (optional)
--
-- The poster is the file with the same name and the extension .jpg. A post
-- with no "preview" is not changed.

local function text(value)
  return value and pandoc.utils.stringify(value) or nil
end

local function attr(value)
  return (value:gsub("&", "&amp;"):gsub('"', "&quot;"):gsub("<", "&lt;"):gsub(">", "&gt;"))
end

-- The RSS feed carries the full post to readers such as R-bloggers, where a
-- relative path would point at their site. So the video and the poster get
-- absolute URLs, from site-url in _quarto.yml, which Quarto does not pass to
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

function Pandoc(doc)
  local file = text(doc.meta["preview"])
  if not file or file == "" then return nil end

  local src = absolute(file)
  local poster = absolute((file:gsub("%.[%w]+$", ".jpg")))
  local alt = text(doc.meta["preview-alt"]) or ""
  local caption = text(doc.meta["preview-caption"])
    or "A short recreation of what this post describes, made in a browser."

  -- The video has controls when the script cannot start it: with no
  -- JavaScript, for a reader who asks for reduced motion, and where the
  -- browser refuses to play a video by itself.
  local html = string.format([[
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
</script>]], attr(src), attr(poster), attr(alt), attr(caption))

  table.insert(doc.blocks, 1, pandoc.RawBlock("html", html))
  return doc
end
