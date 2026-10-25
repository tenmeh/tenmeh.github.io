// Draws the cover image of each post, and one for the whole site.
//
//   node scripts/covers.mjs
//
// Quarto runs this before each render (project: pre-render in _quarto.yml).
// It writes posts/<slug>/cover.png and ./cover.png at 1200x630, and a PNG
// still of each hero for the feed. Those are build outputs and are not
// committed. Each cover is made from the front
// matter of the post, so a new post gets one with no extra work.
//
// The cover follows the site: a pale ground with a glow of Very Peri at the
// top left and Mocha Mousse at the top right, Geist type, and the category
// tags in their own colours. The small differences between covers (the
// place of the glows, the tilt of the logo, the motif) come from a hash of
// the title. Each post thus has its own card, and the same post has the
// same card on every build.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import opentype from "opentype.js";
import YAML from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const W = 1200;
const H = 630;
const M = 72; // the margin on each side

// The light palette of the site (theme-light.scss).
const C = {
  paper: "#f9fbfd",
  paperEnd: "#e2e9f4",
  surface: "#ffffff",
  ink: "#121b31",
  muted: "#566176",
  rule: "#d5dce7",
  accent: "#5758a8", // Very Peri, deepened for text
  soft: "#ebebfa",
  peri: "#6667ab", // Very Peri, Pantone 17-3938
  mocha: "#a47864", // Mocha Mousse, Pantone 17-1230
};

// The category tags, in the colours they have on the site.
const TAGS = {
  r: { fg: "#4d4f9d", bg: "#ebebfa" },
  shiny: { fg: "#1d6467", bg: "#e5f5f5" },
  packages: { fg: "#7e5644", bg: "#f4e8e1" },
};
const OTHER_TAG = { fg: C.muted, bg: "#eaeff6" };

// --- Fonts ----------------------------------------------------------------
// Geist, the face of the site. One static file per weight. They share the
// family "Geist" and differ in font-weight, so the SVG asks for a weight.

const fontDir = join(root, "assets", "fonts");
const fontFiles = {
  regular: join(fontDir, "Geist-Regular.ttf"),
  semibold: join(fontDir, "Geist-SemiBold.ttf"),
  bold: join(fontDir, "Geist-Bold.ttf"),
  extrabold: join(fontDir, "Geist-ExtraBold.ttf"),
};
const weights = { regular: 400, semibold: 600, bold: 700, extrabold: 800 };
const fonts = {};
for (const [key, file] of Object.entries(fontFiles)) {
  const font = opentype.loadSync(file);
  // Google's static files keep "Geist" in the typographic family when the
  // weight is in the plain family name, and in the plain name otherwise.
  const family = font.names.preferredFamily?.en ?? font.names.fontFamily.en;
  fonts[key] = { font, family, weight: weights[key] };
}

const measure = (text, key, size) =>
  fonts[key].font.getAdvanceWidth(text, size, { kerning: true });

// --- Small helpers -----------------------------------------------------------

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const fmt = (n) => Math.round(n * 100) / 100;

// FNV-1a for the hash, mulberry32 for a stream of numbers from it.
function rngFrom(text) {
  let h = 0x811c9dc5;
  for (const ch of text) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let a = h;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const range = (rand, lo, hi) => lo + rand() * (hi - lo);

function readFrontMatter(file) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(file, "utf8"));
  return match ? YAML.parse(match[1]) ?? {} : {};
}

// The date of a post as [day, "Sep", "2026"]. YAML gives a Date for an
// unquoted date, and the site's own dates are UTC, so read it as UTC.
function dateParts(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return [String(d.getUTCDate()), month, String(d.getUTCFullYear())];
}

// Break the text into lines no wider than maxWidth, using the real advance
// widths of the font. Returns null if a single word is wider than a line.
function wrap(text, key, size, maxWidth) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const trial = line ? `${line} ${word}` : word;
    if (measure(trial, key, size) <= maxWidth) {
      line = trial;
    } else if (line) {
      lines.push(line);
      line = word;
    } else {
      return null;
    }
    if (measure(line, key, size) > maxWidth) return null;
  }
  if (line) lines.push(line);
  return lines;
}

// The largest size, from the list, at which the text fits in maxLines. If
// none fits, the smallest size with the last line cut short.
function fitTitle(text, key, sizes, maxWidth, maxLines) {
  for (const size of sizes) {
    const lines = wrap(text, key, size, maxWidth * 0.98);
    if (lines && lines.length <= maxLines) return { size, lines };
  }
  const size = sizes[sizes.length - 1];
  const words = text.split(/\s+/);
  let lines = [];
  while (words.length) {
    lines = wrap(words.join(" "), key, size, maxWidth * 0.98) ?? [];
    if (lines.length && lines.length <= maxLines) break;
    words.pop();
  }
  if (lines.length) {
    let last = lines[lines.length - 1];
    while (measure(`${last}…`, key, size) > maxWidth && last.includes(" ")) {
      last = last.slice(0, last.lastIndexOf(" "));
    }
    lines[lines.length - 1] = `${last}…`;
  }
  return { size, lines };
}

// --- Pieces of the cover ---------------------------------------------------

const text = (str, x, y, key, size, fill, extra = "") =>
  `<text x="${fmt(x)}" y="${fmt(y)}" font-family="${fonts[key].family}" font-weight="${fonts[key].weight}" font-size="${size}" fill="${fill}" ${extra}>${esc(str)}</text>`;

const rule = (y) => `<rect x="${M}" y="${y}" width="${W - M * 2}" height="2" fill="${C.rule}"/>`;

// The ground: the pale paper, a shade that deepens downwards, and the two
// glows of the site. Their places move a little with the title.
function ground(rand) {
  const ax = fmt(range(rand, 0.06, 0.2) * W);
  const bx = fmt(range(rand, 0.8, 0.94) * W);
  return [
    `<defs>`,
    `<linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0" stop-color="${C.paper}"/><stop offset="1" stop-color="${C.paperEnd}"/>`,
    `</linearGradient>`,
    `<radialGradient id="glowA" gradientUnits="userSpaceOnUse" cx="${ax}" cy="-60" r="760">`,
    `<stop offset="0" stop-color="${C.peri}" stop-opacity="0.42"/><stop offset="1" stop-color="${C.peri}" stop-opacity="0"/>`,
    `</radialGradient>`,
    `<radialGradient id="glowB" gradientUnits="userSpaceOnUse" cx="${bx}" cy="-60" r="620">`,
    `<stop offset="0" stop-color="${C.mocha}" stop-opacity="0.36"/><stop offset="1" stop-color="${C.mocha}" stop-opacity="0"/>`,
    `</radialGradient>`,
    `</defs>`,
    `<rect width="${W}" height="${H}" fill="url(#shade)"/>`,
    `<rect width="${W}" height="${H}" fill="url(#glowA)"/>`,
    `<rect width="${W}" height="${H}" fill="url(#glowB)"/>`,
  ].join("");
}

// The category tags, each in its own colour, with the fine outline the site
// gives them.
function pills(names, y) {
  let x = M;
  const size = 21;
  const out = [];
  for (const name of names.slice(0, 4)) {
    const tone = TAGS[String(name).toLowerCase()] ?? OTHER_TAG;
    const w = measure(name, "semibold", size) + 36;
    out.push(
      `<rect x="${x}" y="${y}" width="${fmt(w)}" height="42" rx="21" fill="${tone.bg}" stroke="${tone.fg}" stroke-opacity="0.22" stroke-width="1.5"/>`,
      text(name, x + 18, y + 28.5, "semibold", size, tone.fg),
    );
    x += w + 12;
  }
  return out.join("");
}

// A short bar of the accent under the title, in place of an underline.
const accentBar = (x, y) =>
  `<rect x="${fmt(x)}" y="${fmt(y)}" width="88" height="6" rx="3" fill="${C.accent}"/>`;

// The author's photo, as on the posts: the round GitHub avatar in
// assets/avatar.jpg. If the file is missing, a disc with the initials.
function avatar(cx, cy, r) {
  const file = join(root, "assets", "avatar.jpg");
  if (!existsSync(file)) {
    return [
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.soft}" stroke="${C.rule}" stroke-width="2"/>`,
      text("TC", cx, cy + r * 0.36, "semibold", r, C.accent, 'text-anchor="middle"'),
    ].join("");
  }
  const href = `data:image/jpeg;base64,${readFileSync(file).toString("base64")}`;
  return [
    `<defs><clipPath id="face"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath></defs>`,
    `<image x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" href="${href}" clip-path="url(#face)"/>`,
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.rule}" stroke-width="2"/>`,
  ].join("");
}

// A hex logo, turned a little, with a soft shadow below it.
let filterCount = 0;
function logo(name, cx, cy, width, angle) {
  const file = join(root, "assets", "logos", `${name}.png`);
  const href = `data:image/png;base64,${readFileSync(file).toString("base64")}`;
  const height = width * (557 / 480);
  const id = `shadow${filterCount++}`;
  return [
    `<defs><filter id="${id}" x="-20%" y="-20%" width="140%" height="150%">`,
    `<feGaussianBlur in="SourceAlpha" stdDeviation="${fmt(width * 0.035)}"/>`,
    `<feOffset dx="0" dy="${fmt(width * 0.05)}" result="blur"/>`,
    `<feFlood flood-color="${C.ink}" flood-opacity="0.18"/>`,
    `<feComposite in2="blur" operator="in" result="shadow"/>`,
    `<feMerge><feMergeNode in="shadow"/><feMergeNode in="SourceGraphic"/></feMerge>`,
    `</filter></defs>`,
    `<g transform="rotate(${fmt(angle)} ${fmt(cx)} ${fmt(cy)})">`,
    `<image x="${fmt(cx - width / 2)}" y="${fmt(cy - height / 2)}" width="${fmt(width)}" height="${fmt(height)}" href="${href}" filter="url(#${id})"/>`,
    `</g>`,
  ].join("");
}

// A white card of rounded skeleton bars, for a post with no logo. It echoes
// the placeholders that bones draws.
function motif(rand, x, y, w, h) {
  const out = [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="24" fill="${C.surface}" stroke="${C.rule}" stroke-width="2"/>`,
  ];
  const pad = 36;
  const ix = x + pad;
  const iw = w - pad * 2;
  const kind = Math.floor(rand() * 3);

  if (kind === 0) {
    // Columns on an axis. One column takes the accent, as a highlight.
    const n = 6;
    const gap = 16;
    const cw = (iw - gap * (n - 1)) / n;
    const base = y + h - pad - 10;
    const top = y + pad;
    const lit = Math.floor(rand() * n);
    for (let i = 0; i < n; i++) {
      const ch = (base - top) * range(rand, 0.34, 1);
      out.push(
        `<path d="M${fmt(ix + i * (cw + gap))} ${fmt(base)} v${fmt(-(ch - 10))} a10 10 0 0 1 10 -10 h${fmt(cw - 20)} a10 10 0 0 1 10 10 v${fmt(ch - 10)} z" fill="${i === lit ? C.peri : C.rule}"/>`,
      );
    }
    out.push(`<rect x="${ix}" y="${base + 6}" width="${iw}" height="5" rx="2.5" fill="${C.rule}"/>`);
  } else if (kind === 1) {
    // Lines of text, the last one short.
    const rows = 7;
    const rh = 20;
    const step = (h - pad * 2 - rh) / (rows - 1);
    for (let i = 0; i < rows; i++) {
      const bw = i === 0 ? iw * 0.55 : i === rows - 1 ? iw * 0.42 : iw * range(rand, 0.78, 1);
      out.push(
        `<rect x="${ix}" y="${fmt(y + pad + i * step)}" width="${fmt(bw)}" height="${rh}" rx="10" fill="${i === 0 ? C.soft : C.rule}"/>`,
      );
    }
  } else {
    // A table: a header row of stronger bars, then rows of three cells.
    const rows = 6;
    const cols = 3;
    const gap = 16;
    const cw = (iw - gap * (cols - 1)) / cols;
    const rh = 20;
    const step = (h - pad * 2 - rh) / (rows - 1);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const bw = cw * (r === 0 ? 1 : range(rand, 0.6, 1));
        out.push(
          `<rect x="${fmt(ix + c * (cw + gap))}" y="${fmt(y + pad + r * step)}" width="${fmt(bw)}" height="${rh}" rx="10" fill="${r === 0 ? C.soft : C.rule}"/>`,
        );
      }
    }
  }
  return out.join("");
}

// --- The cover ---------------------------------------------------------------

function coverSvg({ title, subtitle, categories = [], date, author, packages = [] }) {
  const rand = rngFrom(title);
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    ground(rand),
  ];

  // Frame: the tags, the title block, a rule, then the byline.
  const top = 130;
  const bottom = 500;
  if (categories.length) out.push(pills(categories, 62));
  out.push(rule(bottom));

  // Right side: the logos of the package, or a card of skeleton bars.
  const textW = 690;
  const midY = (top + bottom) / 2;
  const tilt = rand() < 0.5 ? -1 : 1;
  const angle = tilt * range(rand, 3, 7);
  if (packages.length === 1) {
    out.push(logo(packages[0], 985, midY + 2, 262, angle));
  } else if (packages.length === 2) {
    packages.forEach((name, i) => {
      out.push(logo(name, 875 + i * 200, midY + (i ? 28 : -28), 205, i ? -angle : angle));
    });
  } else if (packages.length > 2) {
    // Three hexes in a cluster: two above, one below between them. More
    // than three would not fit, so the cover shows the first three.
    const spots = [[880, midY - 76, angle], [1062, midY - 94, -angle], [975, midY + 72, angle / 2]];
    packages.slice(0, 3).forEach((name, i) => {
      out.push(logo(name, spots[i][0], spots[i][1], 172, spots[i][2]));
    });
  } else {
    out.push(motif(rand, 820, top + 34, 308, bottom - top - 68));
  }

  // The title, as large as it can be in three lines, then the accent bar.
  const sizes = [66, 56, 48, 42];
  const { size, lines } = fitTitle(title, "bold", sizes, textW, 3);
  const lh = Math.round(size * 1.1);
  const sub = subtitle ? wrap(subtitle, "regular", 29, textW) ?? [subtitle] : [];
  const subH = sub.length ? 16 + sub.length * 40 : 0;
  const blockH = lines.length * lh + 34 + subH;
  const y0 = top + (bottom - top - blockH) / 2;
  lines.forEach((line, i) => {
    out.push(text(line, M, y0 + size * 0.86 + i * lh, "bold", size, C.ink));
  });
  const lastBase = y0 + size * 0.86 + (lines.length - 1) * lh;
  out.push(accentBar(M, lastBase + 24));
  sub.forEach((line, i) => {
    out.push(text(line, M, lastBase + 30 + 16 + 30 + i * 40, "regular", 29, C.muted));
  });

  // Byline: the photo, the author and the date, and the address of the site.
  const parts = dateParts(date);
  const midBottom = (bottom + H) / 2 + 4;
  const url = "tenmeh.github.io";
  if (author) {
    out.push(avatar(M + 28, midBottom, 28));
    out.push(text(author, M + 72, midBottom + 10, "semibold", 28, C.ink));
    if (parts) {
      const x = M + 72 + measure(author, "semibold", 28) + 16;
      out.push(text(`· ${parts[0]} ${parts[1]} ${parts[2]}`, x, midBottom + 10, "regular", 26, C.muted));
    }
    out.push(text(url, W - M, midBottom + 9, "semibold", 24, C.accent, 'text-anchor="end"'));
  } else {
    out.push(text(url, M, midBottom + 9, "semibold", 28, C.accent));
  }

  out.push("</svg>");
  return out.join("");
}

function render(svg, width = W) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: {
      fontFiles: Object.values(fontFiles),
      loadSystemFonts: false,
      defaultFontFamily: fonts.regular.family,
    },
  });
  return resvg.render().asPng();
}

// --- Run -----------------------------------------------------------------------

const site = YAML.parse(readFileSync(join(root, "_quarto.yml"), "utf8")).website ?? {};
const logoNames = readdirSync(join(root, "assets", "logos"))
  .filter((f) => f.endsWith(".png"))
  .map((f) => f.replace(/\.png$/, ""))
  .sort();

writeFileSync(
  join(root, "cover.png"),
  render(coverSvg({ title: site.title ?? "tenmeh.github.io", subtitle: site.description, packages: logoNames })),
);
console.log("cover.png");

const postsDir = join(root, "posts");
for (const slug of readdirSync(postsDir).sort()) {
  const qmd = join(postsDir, slug, "index.qmd");
  if (!existsSync(qmd)) continue;
  const fm = readFrontMatter(qmd);
  const pkg = fm.package && existsSync(join(root, "assets", "logos", `${fm.package}.png`)) ? [fm.package] : [];
  const svg = coverSvg({
    title: fm.title ?? slug,
    categories: fm.categories ?? [],
    date: fm.date,
    author: Array.isArray(fm.author) ? fm.author[0]?.name ?? fm.author[0] : fm.author?.name ?? fm.author,
    packages: pkg,
  });
  writeFileSync(join(postsDir, slug, "cover.png"), render(svg));
  console.log(`posts/${slug}/cover.png`);

  // A still of the hero, for the feed. R-bloggers and many readers drop an
  // SVG, so scripts/feed.mjs points the feed at this PNG. The page keeps the
  // animated SVG. resvg draws the first frame, at twice the 800px width.
  if (fm.hero && fm.hero.endsWith(".svg") && existsSync(join(postsDir, slug, fm.hero))) {
    const still = fm.hero.replace(/\.svg$/, ".png");
    writeFileSync(join(postsDir, slug, still), render(readFileSync(join(postsDir, slug, fm.hero), "utf8"), 1600));
    console.log(`posts/${slug}/${still}`);
  }
}
