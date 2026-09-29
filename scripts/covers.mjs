// Draws the cover image of each post, and one for the whole site.
//
//   node scripts/covers.mjs
//
// Quarto runs this before each render (project: pre-render in _quarto.yml).
// It writes posts/<slug>/cover.png and ./cover.png at 1200x630. Those are
// build outputs and are not committed. Each cover is made from the front
// matter of the post, so a new post gets one with no extra work.
//
// The small differences between covers (the phase of the wave, the tilt of
// the logo, the motif) come from a hash of the title. Each post thus has
// its own card, and the same post has the same card on every build.

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
  paper: "#f4efe4",
  surface: "#fbf8f1",
  ink: "#17202a",
  muted: "#555b66",
  rule: "#cfc5b1",
  accent: "#9e2a2b",
  soft: "#f0ddd4",
};

// --- Fonts ----------------------------------------------------------------
// One static file per weight. They share the family "Recursive Sans Linear
// Static" and differ in font-weight, so the SVG asks for 400, 600 or 800.

const fontDir = join(root, "assets", "fonts");
const fontFiles = {
  regular: join(fontDir, "RecursiveSansLnrSt-Regular.ttf"),
  semibold: join(fontDir, "RecursiveSansLnrSt-SemiBold.ttf"),
  extrabold: join(fontDir, "RecursiveSansLnrSt-ExtraBold.ttf"),
};
const weights = { regular: 400, semibold: 600, extrabold: 800 };
const fonts = {};
for (const [key, file] of Object.entries(fontFiles)) {
  const font = opentype.loadSync(file);
  fonts[key] = { font, family: font.names.preferredFamily.en, weight: weights[key] };
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

const dashedRule = (y) =>
  `<line x1="${M}" y1="${y}" x2="${W - M}" y2="${y}" stroke="${C.rule}" stroke-width="3" stroke-dasharray="10 9" stroke-linecap="round"/>`;

function pills(names, y) {
  let x = M;
  const size = 21;
  const out = [];
  for (const name of names.slice(0, 4)) {
    const w = measure(name, "semibold", size) + 36;
    out.push(
      `<rect x="${x}" y="${y}" width="${fmt(w)}" height="42" rx="21" fill="${C.soft}"/>`,
      text(name, x + 18, y + 28.5, "semibold", size, C.accent),
    );
    x += w + 12;
  }
  return out.join("");
}

// The wavy underline of the links on the site, drawn as a sine wave.
function wave(x0, x1, y, rand) {
  const amp = range(rand, 3.6, 5.2);
  const length = range(rand, 22, 30);
  const phase = range(rand, 0, Math.PI * 2);
  const points = [];
  for (let x = x0; x <= x1; x += 2) {
    const yy = y + amp * Math.sin(((x - x0) / length) * Math.PI * 2 + phase);
    points.push(`${fmt(x)} ${fmt(yy)}`);
  }
  return `<path d="M${points.join(" L")}" fill="none" stroke="${C.accent}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// The date stamp of the post list: the day in red, the month and year
// under it, in a rounded box.
function stamp(parts, x, y) {
  const [day, month, year] = parts;
  const w = 116;
  const h = 92;
  return [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="${C.surface}" stroke="${C.rule}" stroke-width="2"/>`,
    text(day, x + w / 2, y + 47, "extrabold", 42, C.accent, 'text-anchor="middle"'),
    text(`${month} ${year}`, x + w / 2, y + 76, "regular", 19, C.muted, 'text-anchor="middle"'),
  ].join("");
}

// A hex logo, turned a little, with the flat shadow of the package shelf
// on the site: a copy of the logo in the rule colour, moved down.
let filterCount = 0;
function logo(name, cx, cy, width, angle) {
  const file = join(root, "assets", "logos", `${name}.png`);
  const href = `data:image/png;base64,${readFileSync(file).toString("base64")}`;
  const height = width * (557 / 480);
  const id = `shadow${filterCount++}`;
  const drop = width * 0.04;
  return [
    `<defs><filter id="${id}" x="-10%" y="-10%" width="120%" height="130%">`,
    `<feFlood flood-color="${C.rule}" result="flat"/>`,
    `<feComposite in="flat" in2="SourceAlpha" operator="in" result="tint"/>`,
    `<feOffset in="tint" dx="0" dy="${fmt(drop)}" result="shadow"/>`,
    `<feMerge><feMergeNode in="shadow"/><feMergeNode in="SourceGraphic"/></feMerge>`,
    `</filter></defs>`,
    `<g transform="rotate(${fmt(angle)} ${fmt(cx)} ${fmt(cy)})">`,
    `<image x="${fmt(cx - width / 2)}" y="${fmt(cy - height / 2)}" width="${fmt(width)}" height="${fmt(height)}" href="${href}" filter="url(#${id})"/>`,
    `</g>`,
  ].join("");
}

// A card of rounded skeleton bars in the rule colour, for a post with no
// logo. It echoes the placeholders that bones draws.
function motif(rand, x, y, w, h) {
  const out = [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="28" fill="${C.surface}" stroke="${C.rule}" stroke-width="2"/>`,
  ];
  const pad = 36;
  const ix = x + pad;
  const iw = w - pad * 2;
  const kind = Math.floor(rand() * 3);

  if (kind === 0) {
    // Columns on an axis. One column takes the soft red, as a highlight.
    const n = 6;
    const gap = 16;
    const cw = (iw - gap * (n - 1)) / n;
    const base = y + h - pad - 10;
    const top = y + pad;
    const lit = Math.floor(rand() * n);
    for (let i = 0; i < n; i++) {
      const ch = (base - top) * range(rand, 0.34, 1);
      out.push(
        `<path d="M${fmt(ix + i * (cw + gap))} ${fmt(base)} v${fmt(-(ch - 10))} a10 10 0 0 1 10 -10 h${fmt(cw - 20)} a10 10 0 0 1 10 10 v${fmt(ch - 10)} z" fill="${i === lit ? C.soft : C.rule}"/>`,
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
    `<rect width="${W}" height="${H}" fill="${C.paper}"/>`,
  ];

  // Frame: pills, a dashed rule, the title, a dashed rule, the byline.
  const top = 130;
  const bottom = 500;
  if (categories.length) out.push(pills(categories, 62));
  out.push(dashedRule(top), dashedRule(bottom));

  // Right side: the logos of the package, or a card of skeleton bars.
  const textW = 690;
  const midY = (top + bottom) / 2;
  const tilt = rand() < 0.5 ? -1 : 1;
  const angle = tilt * range(rand, 3, 7);
  if (packages.length === 1) {
    out.push(logo(packages[0], 985, midY + 2, 262, angle));
  } else if (packages.length > 1) {
    packages.slice(0, 2).forEach((name, i) => {
      out.push(logo(name, 875 + i * 200, midY + (i ? 28 : -28), 205, i ? -angle : angle));
    });
  } else {
    out.push(motif(rand, 820, top + 34, 308, bottom - top - 68));
  }

  // The title, as large as it can be in three lines.
  const sizes = [68, 56, 48, 42];
  const { size, lines } = fitTitle(title, "extrabold", sizes, textW, 3);
  const lh = Math.round(size * 1.14);
  const sub = subtitle ? wrap(subtitle, "regular", 30, textW) ?? [subtitle] : [];
  const subH = sub.length ? 18 + sub.length * 42 : 0;
  const blockH = lines.length * lh + 26 + subH;
  const y0 = top + (bottom - top - blockH) / 2;
  lines.forEach((line, i) => {
    out.push(text(line, M, y0 + size * 0.86 + i * lh, "extrabold", size, C.ink));
  });
  const lastBase = y0 + size * 0.86 + (lines.length - 1) * lh;
  const lastW = measure(lines[lines.length - 1], "extrabold", size);
  out.push(wave(M, M + Math.min(lastW, textW), lastBase + 20, rand));
  sub.forEach((line, i) => {
    out.push(text(line, M, lastBase + 20 + 18 + 30 + i * 42, "regular", 30, C.muted));
  });

  // Byline: the date stamp, the author, and the address of the site.
  const parts = dateParts(date);
  const midBottom = (bottom + H) / 2;
  let x = M;
  if (parts) {
    out.push(stamp(parts, M, midBottom - 46));
    x += 116 + 26;
  }
  if (author) out.push(text(author, x, midBottom + 10, "semibold", 30, C.ink));
  const url = "tenmeh.github.io";
  if (author || parts) {
    out.push(text(url, W - M, midBottom + 9, "regular", 25, C.muted, 'text-anchor="end"'));
  } else {
    out.push(text(url, M, midBottom + 9, "semibold", 28, C.muted));
  }

  out.push("</svg>");
  return out.join("");
}

function render(svg) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: W },
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
}
