"use strict";

// Finds the picture of a product page (og:image, twitter:image, JSON-LD…)
// and downloads it, so gift cards show an image that does not depend on the
// shop's servers staying reachable.
//
// Only public http(s) addresses are fetched: hosts resolving to loopback,
// private, link-local or otherwise internal addresses are refused, at every
// redirect, so the feature cannot be used to probe the server's network.

const dns = require("node:dns").promises;
const net = require("node:net");

const USER_AGENT = "Mozilla/5.0 (compatible; Listom/1.0; +https://github.com/) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 4;

class LinkImageError extends Error {}

function ipv4ToInt(ip) {
  return ip.split(".").reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
}

function inRange4(ip, cidr) {
  const [base, bits] = cidr.split("/");
  const mask = bits === "0" ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

const BLOCKED_V4 = [
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16",
  "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.168.0.0/16", "198.18.0.0/15",
  "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4"
];

function isBlockedAddress(ip) {
  if (net.isIPv4(ip)) return BLOCKED_V4.some((r) => inRange4(ip, r));
  const v6 = ip.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedAddress(mapped[1]);
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v6) || v6.startsWith("64:ff9b:") || v6.startsWith("2001:db8:");
}

async function assertPublicUrl(raw) {
  let url;
  try { url = new URL(raw); } catch (e) { throw new LinkImageError("Adresse invalide."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new LinkImageError("Seules les adresses http(s) sont acceptées.");
  if (url.username || url.password) throw new LinkImageError("Adresse refusée.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses;
  if (net.isIP(host)) addresses = [host];
  else {
    try { addresses = (await dns.lookup(host, { all: true, verbatim: true })).map((a) => a.address); }
    catch (e) { throw new LinkImageError("Ce site est introuvable."); }
  }
  if (!addresses.length || addresses.some(isBlockedAddress)) throw new LinkImageError("Adresse refusée.");
  return url;
}

async function readLimited(res, maxBytes, truncate) {
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      if (!truncate) throw new LinkImageError("Fichier trop lourd.");
      chunks.push(value.subarray(0, value.length - (size - maxBytes)));
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** fetch() that re-checks every redirect target and caps the body size. */
async function safeFetch(raw, { accept, maxBytes, truncate }) {
  let current = raw;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const url = await assertPublicUrl(current);
    let res;
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "user-agent": USER_AGENT, accept, "accept-language": "fr-FR,fr;q=0.9,en;q=0.8" }
      });
    } catch (e) {
      throw new LinkImageError("Le site ne répond pas.");
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location"), url).href;
      continue;
    }
    if (!res.ok || !res.body) throw new LinkImageError("Le site a refusé la demande (" + res.status + ").");
    const body = await readLimited(res, maxBytes, truncate);
    return { url: url.href, contentType: (res.headers.get("content-type") || "").toLowerCase(), body };
  }
  throw new LinkImageError("Trop de redirections.");
}

// ---- HTML parsing (no dependency: a few targeted regular expressions) -----

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function attributes(tag) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? "");
  return out;
}

function jsonLdImages(html) {
  const found = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const img = node.image;
    if (typeof img === "string") found.push(img);
    else if (Array.isArray(img)) img.forEach((x) => typeof x === "string" ? found.push(x) : x && x.url && found.push(x.url));
    else if (img && typeof img === "object" && img.url) found.push(img.url);
    for (const k of Object.keys(node)) if (k !== "image" && typeof node[k] === "object") visit(node[k]);
  };
  while ((m = re.exec(html))) { try { visit(JSON.parse(m[1].trim())); } catch (e) { /* malformed JSON-LD */ } }
  return found;
}

/** Candidate image URLs of a page, best first. */
function findImageCandidates(html, baseUrl) {
  const metas = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const a = attributes(tag);
    const key = (a.property || a.name || a.itemprop || "").toLowerCase();
    if (key && a.content && !metas[key]) metas[key] = a.content;
  }
  const list = [
    metas["og:image:secure_url"], metas["og:image"], metas["og:image:url"],
    metas["twitter:image"], metas["twitter:image:src"], metas["image"]
  ];
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const a = attributes(tag);
    if ((a.rel || "").toLowerCase().split(/\s+/).includes("image_src") && a.href) list.push(a.href);
  }
  list.push(...jsonLdImages(html));
  // Amazon product pages keep the main picture in data attributes.
  const hires = html.match(/data-old-hires=["'](https:[^"']+)["']/i) || html.match(/"hiRes":"(https:[^"]+)"/);
  if (hires) list.push(hires[1]);

  const seen = new Set();
  const out = [];
  for (const c of list) {
    if (!c || typeof c !== "string") continue;
    let abs;
    try { abs = new URL(c.trim(), baseUrl).href; } catch (e) { continue; }
    if (!/^https?:/.test(abs) || seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }
  return out;
}

// ---- Image validation ------------------------------------------------------

/** Recognise the image format from its first bytes (never trust headers). */
function sniffImage(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString("latin1"))) return "gif";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  return null;
}

async function downloadImage(url) {
  const res = await safeFetch(url, { accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8", maxBytes: MAX_IMAGE_BYTES, truncate: false });
  const ext = sniffImage(res.body);
  if (!ext) throw new LinkImageError("Format d'image non pris en charge.");
  return { ext, body: res.body };
}

/**
 * Resolve a gift link to an image: returns { ext, body } or throws
 * LinkImageError with a French message.
 */
async function fetchLinkImage(link) {
  const page = await safeFetch(link, { accept: "text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.5", maxBytes: MAX_HTML_BYTES, truncate: true });
  const direct = sniffImage(page.body);
  if (direct) return { ext: direct, body: page.body };       // the link is itself an image
  const candidates = findImageCandidates(page.body.toString("utf8"), page.url);
  for (const candidate of candidates.slice(0, 4)) {
    try { return await downloadImage(candidate); } catch (e) { /* try the next one */ }
  }
  throw new LinkImageError("Aucune image trouvée sur ce lien.");
}

module.exports = { fetchLinkImage, findImageCandidates, sniffImage, isBlockedAddress, LinkImageError, MAX_IMAGE_BYTES };
