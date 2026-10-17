// Builds the blog from content/blog/*.md into public/blog/ before each deploy.
// Runs automatically: wrangler.jsonc "build.command" calls this on every Cloudflare deploy.
// No npm packages needed (plain Node). Don writes posts in Pages CMS, which saves them to content/blog/.
//
// Each post file:  content/blog/<slug>.md
//   ---
//   title: "Post title"
//   date: 2026-10-20
//   summary: "One or two sentences for the blog index and search results."
//   draft: false
//   ---
//   Body in Markdown (or HTML).

import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "content", "blog");
const OUT = join(ROOT, "public", "blog");
const SITE = "https://ecareercoaching.com";

// ---------- read posts ----------
function parseFrontMatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: raw };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1).replace(/\\"/g, '"');
    if (v === "true") v = true; else if (v === "false") v = false;
    data[kv[1]] = v;
  }
  return { data, body: m[2] };
}

const posts = existsSync(SRC)
  ? readdirSync(SRC).filter(f => f.endsWith(".md")).map(f => {
      const { data, body } = parseFrontMatter(readFileSync(join(SRC, f), "utf8"));
      const slug = basename(f, ".md").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
      return { slug, title: data.title || slug, date: String(data.date || "").slice(0, 10), summary: data.summary || "", draft: data.draft === true, image: data.image || "", body };
    }).filter(p => !p.draft && p.title).sort((a, b) => (a.date < b.date ? 1 : -1))
  : [];

// ---------- tiny Markdown renderer (headings, paragraphs, lists, quotes, bold, italic, links, images) ----------
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function inline(s) {
  return s
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/(^|\W)_([^_\s][^_]*)_(?=\W|$)/g, "$1<em>$2</em>");
}
function markdown(md) {
  if (/^\s*<(p|h[1-6]|ul|ol|div|blockquote|figure)\b/i.test(md)) return md; // already HTML (rich-text editor)
  const lines = md.replace(/\r/g, "").split("\n");
  const out = []; let para = []; let list = null; let quote = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; } };
  const flushQuote = () => { if (quote.length) { out.push(`<blockquote><p>${inline(quote.join(" "))}</p></blockquote>`); quote = []; } };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };
  for (const line of lines) {
    let m;
    if (!line.trim()) { flushAll(); continue; }
    if (/^\s*</.test(line)) { flushAll(); out.push(line); continue; } // raw HTML line
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flushAll(); const n = Math.max(2, m[1].length); out.push(`<h${n}>${inline(m[2])}</h${n}>`); continue; }
    if ((m = line.match(/^>\s?(.*)$/))) { flushPara(); flushList(); quote.push(m[1]); continue; }
    if ((m = line.match(/^\s*(?:[-*]|->)\s+(.*)$/))) { flushPara(); flushQuote(); if (!list || list.tag !== "ul") { flushList(); list = { tag: "ul", items: [] }; } list.items.push(m[1]); continue; }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flushPara(); flushQuote(); if (!list || list.tag !== "ol") { flushList(); list = { tag: "ol", items: [] }; } list.items.push(m[1]); continue; }
    flushList(); flushQuote(); para.push(line.trim());
  }
  flushAll();
  return out.join("\n");
}

// ---------- page shell: reuse the live site's header and footer so the blog always matches ----------
// Once at least one post is published, every page's menu gets a "Blog" link (added at deploy time only).
const BLOG_LINK = '<a href="/blog">Blog</a>';
if (posts.length) {
  for (const f of readdirSync(join(ROOT, "public")).filter(f => f.endsWith(".html"))) {
    const fp = join(ROOT, "public", f);
    const html = readFileSync(fp, "utf8");
    if (html.includes('<nav class="nav-links">') && !html.includes(BLOG_LINK)) {
      writeFileSync(fp, html.replace(/(\n(\s*)<a href="https:\/\/payhip\.com\/b\/KAJEL">)/, `\n$2${BLOG_LINK}$1`));
    }
  }
}
const home = readFileSync(join(ROOT, "public", "index.html"), "utf8");
let header = (home.match(/<header class="wrap nav">[\s\S]*?<\/header>/) || [""])[0];
const footer = (home.match(/<footer class="wrap site-footer">[\s\S]*?<\/footer>/) || [""])[0];
const prettyDate = d => { const t = new Date(d + "T12:00:00Z"); return isNaN(t) ? "" : t.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }); };

function page({ title, description, path, body, type = "website" }) {
  const url = SITE + path;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="stylesheet" href="/styles.css">
<link rel="canonical" href="${url}">
<link rel="alternate" type="application/rss+xml" title="eCareerCoaching.com Blog" href="${SITE}/blog/feed.xml">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="eCareerCoaching.com">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/og-cover.png">
<meta name="twitter:card" content="summary_large_image">
</head>
<body>

${header}

${body}

<section class="wrap section">
  <div class="cta-band">
    <span class="eyebrow">Let's talk</span>
    <h2>Not sure yet? Let's find out if we're a fit.</h2>
    <p>A short, no-pressure call to see whether working together makes sense. Bring your questions. If it is not a fit, I will point you in the right direction.</p>
    <div class="cta-row" style="margin-top:1.75rem;">
      <a class="btn btn-white" href="https://calendly.com/ecareercoaching/are-we-a-fit">Book the call &rarr;</a>
      <span class="url">eCareerCoaching.com</span>
    </div>
  </div>
</section>

${footer}

</body>
</html>
`;
}

// ---------- write output ----------
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const cards = posts.map(p => `
  <article class="post-card">
    <p class="post-date">${prettyDate(p.date)}</p>
    <h2><a href="/blog/${p.slug}">${esc(p.title)}</a></h2>
    ${p.summary ? `<p>${esc(p.summary)}</p>` : ""}
    <a class="post-more" href="/blog/${p.slug}">Read it &rarr;</a>
  </article>`).join("\n");

writeFileSync(join(OUT, "index.html"), page({
  title: "Blog | eCareerCoaching.com",
  description: "Straight talk on landing your next senior role, from executive career coach Don Oehlert.",
  path: "/blog",
  body: `<section class="wrap page-hero">
  <span class="eyebrow">Blog</span>
  <h1>Straight talk for senior job seekers</h1>
  <p class="lead">Short, practical pieces on landing your next senior role. No fluff.</p>
</section>
<section class="wrap section post-list">
${cards || '  <p class="lead">The first posts are on their way.</p>'}
</section>`,
}));

for (const p of posts) {
  mkdirSync(join(OUT, p.slug), { recursive: true });
  writeFileSync(join(OUT, p.slug, "index.html"), page({
    title: `${p.title} | eCareerCoaching.com`,
    description: p.summary || p.title,
    path: `/blog/${p.slug}`,
    type: "article",
    body: `<article class="wrap page-hero post">
  <a class="post-back" href="/blog">&larr; All posts</a>
  <p class="post-date">${prettyDate(p.date)} &middot; Don Oehlert</p>
  <h1>${esc(p.title)}</h1>
  <div class="prose post-body">
${markdown(p.body)}
  </div>
</article>`,
  }));
}

// RSS feed (handy for Substack, LinkedIn tools, and readers)
writeFileSync(join(OUT, "feed.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>eCareerCoaching.com Blog</title><link>${SITE}/blog</link><description>Straight talk on landing your next senior role.</description>
${posts.map(p => `<item><title>${esc(p.title)}</title><link>${SITE}/blog/${p.slug}</link><guid>${SITE}/blog/${p.slug}</guid><pubDate>${new Date(p.date + "T12:00:00Z").toUTCString()}</pubDate><description>${esc(p.summary)}</description></item>`).join("\n")}
</channel></rss>
`);

// Sitemap: replace the blog block between markers
const smPath = join(ROOT, "public", "sitemap.xml");
let sm = readFileSync(smPath, "utf8").replace(/\s*<!-- blog:start -->[\s\S]*?<!-- blog:end -->/, "");
const blogUrls = [`  <url><loc>${SITE}/blog</loc></url>`, ...posts.map(p => `  <url><loc>${SITE}/blog/${p.slug}</loc><lastmod>${p.date}</lastmod></url>`)];
sm = sm.replace("</urlset>", `  <!-- blog:start -->\n${blogUrls.join("\n")}\n  <!-- blog:end -->\n</urlset>`);
writeFileSync(smPath, sm);

console.log(`build-blog: ${posts.length} published post(s) written to public/blog/`);
