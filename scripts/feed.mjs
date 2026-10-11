// Makes the RSS feed safe to republish in full on other sites.
//
//   node scripts/feed.mjs
//
// Quarto runs this after each render (project: post-render in _quarto.yml),
// once the feed is in _site. R-bloggers takes the full HTML of each post
// from the feed and puts it on its own site, where three things in the page
// version of a post break:
//
// - A relative link points at R-bloggers, not at this blog. Each relative
//   href and src is made absolute, from the link of its post.
// - The hero is an animated SVG, and R-bloggers drops SVG images. The feed
//   uses the PNG still that scripts/covers.mjs draws next to it.
// - The demo video is a <video> with a script, and R-bloggers drops both.
//   The feed shows the poster instead, as a link to the post.
//
// The pages of the site are not changed. Only the feed is.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = join(root, "_site");

// Each change leaves a fixed feed as it is, so a second run does no harm.
const feeds = readdirSync(site).filter(
  (f) => f.endsWith(".xml") && readFileSync(join(site, f), "utf8").includes("<rss"),
);

const absolute = (url, base) => {
  if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(url)) return url;
  return new URL(url, base).href;
};

// The local file behind an absolute URL on this site, to check that it exists.
const localFile = (url, siteUrl) =>
  url.startsWith(siteUrl) ? join(site, decodeURIComponent(url.slice(siteUrl.length))) : null;

function fixItem(html, link, siteUrl) {
  // 1. Relative links and images.
  html = html.replace(/\b(href|src|poster)="([^"]*)"/g, (_, name, url) => `${name}="${absolute(url, link)}"`);

  // 2. The hero: the PNG still, when the render drew one.
  html = html.replace(/(<figure class="post-hero[^"]*">\s*<img [^>]*src=")([^"]+)\.svg"/g, (whole, head, stem) => {
    const file = localFile(`${stem}.png`, siteUrl);
    return file && existsSync(file) ? `${head}${stem}.png"` : whole;
  });

  // 3. The demo video, and the script after it: the poster, linked to the post.
  html = html.replace(
    /<figure class="post-preview[^"]*">\s*<video [^>]*?poster="([^"]+)"[^>]*?aria-label="([^"]*)"[^>]*><\/video>\s*<figcaption>([\s\S]*?)<\/figcaption>\s*<\/figure>\s*(<script>[\s\S]*?<\/script>)?/g,
    (_, poster, alt, caption) =>
      `<figure class="post-preview">` +
      `<a href="${link}"><img src="${poster}" alt="${alt}" width="640" height="360"></a>` +
      `<figcaption>${caption} <a href="${link}">Watch the video in the post.</a></figcaption>` +
      `</figure>`,
  );

  return html;
}

for (const name of feeds) {
  const path = join(site, name);
  const xml = readFileSync(path, "utf8");
  const siteUrl = (xml.match(/<channel>\s*<title>[\s\S]*?<link>([^<]+)<\/link>/) ?? [])[1] ?? "";

  let items = 0;
  const out = xml.replace(/<item>([\s\S]*?)<\/item>/g, (whole, body) => {
    const link = (body.match(/<link>([^<]+)<\/link>/) ?? [])[1];
    if (!link) return whole;
    items++;
    return whole.replace(
      /(<description><!\[CDATA\[)([\s\S]*?)(\]\]><\/description>)/,
      (_, open, html, close) => open + fixItem(html, link, siteUrl) + close,
    );
  });

  writeFileSync(path, out);
  console.log(`${name}: ${items} posts`);
}
