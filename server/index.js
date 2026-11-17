"use strict";

// Listom server: serves the page, stores the lists, and protects each list's
// Mode Vœux with its own generated password. The admin view is protected by
// ADMIN_PASSWORD. No dependency beyond Node.js ≥ 20.

const http = require("node:http");
const fs = require("node:fs");
const fsp = fs.promises;
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { Store } = require("./store");
const { fetchLinkImage, sniffImage, LinkImageError, MAX_IMAGE_BYTES } = require("./link-image");

const scrypt = promisify(crypto.scrypt);
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const UPLOAD_NAME = /^[A-Za-z0-9_-]{16,40}\.(jpg|png|gif|webp)$/;
const LIST_ID = "([A-Za-z0-9_-]{6,40})";
const ITEM_ID = "([A-Za-z0-9_-]{6,40})";
const ADMIN_COOKIE = "listom_admin";
const listCookie = (id) => "listom_v_" + id;

const DEFAULT_WELCOME_TITLE = "Il y a aussi *les boules*…";
const DEFAULT_WELCOME_SUBTITLE = "Une liste de vœux partagée : chacun réserve ce qu'il offre, et la personne gâtée garde la surprise.";

function readConfig(env) {
  return {
    port: Number(env.PORT) || 3000,
    host: env.HOST || "0.0.0.0",
    adminPassword: env.ADMIN_PASSWORD || "",
    creationCode: env.CREATION_CODE || "",
    sessionSecret: env.SESSION_SECRET || "",
    sessionDays: Math.max(1, Number(env.SESSION_DAYS) || 30),
    cookieSecure: (env.COOKIE_SECURE || "auto").toLowerCase(),   // auto | true | false
    trustProxy: /^(1|true|yes)$/i.test(env.TRUST_PROXY || ""),
    dataDir: path.resolve(env.DATA_DIR || path.join(__dirname, "..", "data")),
    autoLinkImage: !/^(0|false|no)$/i.test(env.AUTO_LINK_IMAGE || "true")
  };
}

// ---- Small HTTP helpers ------------------------------------------------------

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".ico": "image/x-icon", ".json": "application/json", ".txt": "text/plain; charset=utf-8"
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: blob: https: http:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'"
  ].join("; ")
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function sendJson(res, status, data, headers = {}) {
  send(res, status, data === undefined ? "" : JSON.stringify(data), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "Envoi trop volumineux.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// JSON bodies only: a cross-site form cannot send application/json without a
// CORS preflight, which this server never grants. That, plus SameSite cookies,
// keeps other sites from acting on someone's behalf.
async function readJson(req) {
  if (!/^application\/json\b/i.test(req.headers["content-type"] || "")) throw new HttpError(415, "Format de requête non pris en charge.");
  const raw = await readBody(req, 64 * 1024);
  try {
    const value = JSON.parse(raw.toString("utf8") || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value;
  } catch (e) {
    throw new HttpError(400, "Requête illisible.");
  }
}

function parseCookies(header) {
  const out = {};
  for (const part of (header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch (e) { /* ignore */ }
    }
  }
  return out;
}

function clientIp(req, trustProxy) {
  if (trustProxy) {
    const fwd = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress || "unknown";
}

// ---- Validation --------------------------------------------------------------

function cleanString(value, max, label) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new HttpError(400, label + " invalide.");
  const s = value.trim();
  if (s.length > max) throw new HttpError(400, label + " trop long (" + max + " caractères maximum).");
  return s;
}

function cleanUrl(value, label) {
  const s = cleanString(value, 2000, label);
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol === "http:" || u.protocol === "https:") return u.href;
  } catch (e) { /* fall through */ }
  throw new HttpError(400, label + " : l'adresse doit commencer par https:// ou http://.");
}

// ---- Passwords ---------------------------------------------------------------

// Generated list passwords: 3 groups of 4 characters, without look-alike
// characters (no 0/o, 1/l/i): about 60 bits, easy to read out and type.
const PW_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
function generatePassword() {
  const group = () => Array.from({ length: 4 }, () => PW_ALPHABET[crypto.randomInt(PW_ALPHABET.length)]).join("");
  return group() + "-" + group() + "-" + group();
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 32);
  return { passwordSalt: salt.toString("base64"), passwordHash: hash.toString("base64") };
}

async function verifyPassword(list, password) {
  if (!list.passwordSalt || !list.passwordHash) return false;
  const hash = await scrypt(String(password).trim().toLowerCase(), Buffer.from(list.passwordSalt, "base64"), 32);
  const expected = Buffer.from(list.passwordHash, "base64");
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}

// ---- Application -------------------------------------------------------------

function createApp(env = process.env) {
  const config = readConfig(env);
  const store = new Store(config.dataDir);
  store.load();

  // Signing key for session cookies: SESSION_SECRET, or a random key created
  // on first start and kept with the data (sessions survive restarts).
  let secret = config.sessionSecret;
  if (!secret) {
    const keyFile = path.join(config.dataDir, "secret.key");
    if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
    secret = fs.readFileSync(keyFile, "utf8").trim();
  }
  const sign = (payload) => crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  const safeEqual = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

  // List session = expiry.HMAC(list id, password version, expiry): generating a
  // new password bumps the version and signs every other device out.
  const listToken = (list) => {
    const exp = String(Date.now() + config.sessionDays * 86400000);
    return exp + "." + sign("list\0" + list.id + "\0" + (list.passwordVersion || 1) + "\0" + exp);
  };
  const isOwner = (req, list) => {
    const token = parseCookies(req.headers.cookie)[listCookie(list.id)];
    if (typeof token !== "string") return false;
    const [exp, mac] = token.split(".");
    if (!exp || !mac || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
    return safeEqual(mac, sign("list\0" + list.id + "\0" + (list.passwordVersion || 1) + "\0" + exp));
  };

  // Admin session: the key includes ADMIN_PASSWORD, so changing it signs out.
  const adminEnabled = Boolean(config.adminPassword);
  const adminToken = () => {
    const exp = String(Date.now() + 12 * 3600000);
    return exp + "." + sign("admin\0" + config.adminPassword + "\0" + exp);
  };
  const isAdmin = (req) => {
    if (!adminEnabled) return false;
    const token = parseCookies(req.headers.cookie)[ADMIN_COOKIE];
    if (typeof token !== "string") return false;
    const [exp, mac] = token.split(".");
    if (!exp || !mac || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
    return safeEqual(mac, sign("admin\0" + config.adminPassword + "\0" + exp));
  };
  const requireAdmin = (req) => { if (!isAdmin(req)) throw new HttpError(401, "Session d'administration expirée : reconnectez-vous."); };

  const isSecure = (req) => {
    if (config.cookieSecure === "true") return true;
    if (config.cookieSecure === "false") return false;
    if (req.socket.encrypted) return true;
    return config.trustProxy && (req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
  };
  const cookie = (req, name, value, maxAge) =>
    name + "=" + value + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + maxAge + (isSecure(req) ? "; Secure" : "");

  // Rate limits (in memory): failed logins and list creation.
  const hits = new Map();
  const limited = (key, max, windowMs) => {
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    hits.set(key, list);
    return list.length >= max;
  };
  const hit = (key) => { (hits.get(key) || hits.set(key, []).get(key)).push(Date.now()); };
  const hitsSweep = setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 3600000)) hits.delete(k); }, 600000);
  hitsSweep.unref();

  // Live updates (Server-Sent Events), per list.
  const listeners = new Map();   // list id -> Set<res>
  const broadcast = (listId, scope) => {
    const set = listeners.get(listId);
    if (!set) return;
    const msg = "event: change\ndata: " + JSON.stringify({ scope }) + "\n\n";
    for (const res of set) res.write(msg);
  };
  const heartbeat = setInterval(() => { for (const set of listeners.values()) for (const res of set) res.write(": ping\n\n"); }, 25000);
  heartbeat.unref();

  const saveUpload = async (ext, body) => {
    const name = crypto.randomBytes(16).toString("base64url") + "." + ext;
    await fsp.writeFile(store.uploadPath(name), body);
    return name;
  };
  const checkUpload = (value) => {
    if (!value) return null;
    if (typeof value !== "string" || !UPLOAD_NAME.test(value) || !fs.existsSync(store.uploadPath(value))) {
      throw new HttpError(400, "Image introuvable : envoyez-la à nouveau.");
    }
    return value;
  };

  const publicList = (list) => ({
    id: list.id, name: list.name, welcomeTitle: list.welcomeTitle, welcomeSubtitle: list.welcomeSubtitle, heroUpload: list.heroUpload || null
  });

  const listSettings = (body, current) => {
    const pick = (key, max, label, fallback) => body[key] === undefined ? current[key] : (cleanString(body[key], max, label) || fallback);
    const name = pick("name", 80, "Le nom de la liste", "");
    if (!name) throw new HttpError(400, "Donnez un nom à votre liste.");
    return {
      name,
      welcomeTitle: pick("welcomeTitle", 120, "Le titre d'accueil", DEFAULT_WELCOME_TITLE),
      welcomeSubtitle: pick("welcomeSubtitle", 300, "Le sous-titre", DEFAULT_WELCOME_SUBTITLE),
      heroUpload: body.heroUpload === undefined ? (current.heroUpload || null) : checkUpload(body.heroUpload)
    };
  };

  const giftFields = (body) => {
    const title = cleanString(body.title, 120, "Le titre");
    if (!title) throw new HttpError(400, "Donnez un titre à votre vœu.");
    let price = null;
    if (body.price !== undefined && body.price !== null && body.price !== "") {
      price = Number(body.price);
      if (!Number.isFinite(price) || price < 0 || price > 1e7) throw new HttpError(400, "Le prix doit être un nombre positif.");
      price = Math.round(price * 100) / 100;
    }
    const imageUpload = checkUpload(body.imageUpload);
    const emoji = cleanString(body.emoji, 16, "L'emoji");
    return {
      title,
      description: cleanString(body.description, 600, "La description"),
      link: cleanUrl(body.link, "Le lien"),
      price,
      imageUrl: imageUpload ? "" : cleanUrl(body.imageUrl, "L'adresse de l'image"),
      imageUpload,
      emoji: emoji || "🎁"
    };
  };

  // After a save, a gift with a link but no picture gets the page's image in
  // the background; open pages refresh by themselves when it arrives.
  const pendingLookups = new Set();
  const autoImage = (gift) => {
    if (!config.autoLinkImage || !gift.link || gift.imageUpload || gift.imageUrl || pendingLookups.has(gift.id)) return;
    const { id, listId, link } = gift;
    pendingLookups.add(id);
    fetchLinkImage(link)
      .then(async ({ ext, body }) => {
        const current = store.getGift(listId, id);
        if (!current || current.link !== link || current.imageUpload || current.imageUrl) return;
        current.imageUpload = await saveUpload(ext, body);
        await store.save();
        broadcast(listId, "gifts");
      })
      .catch((e) => { if (!(e instanceof LinkImageError)) console.error("[link-image]", e); })
      .finally(() => pendingLookups.delete(id));
  };

  const findList = (id) => {
    const list = store.getList(id);
    if (!list) throw new HttpError(404, "Cette liste n'existe pas ou a été supprimée.");
    return list;
  };
  const requireOwner = (req, list) => {
    if (!isOwner(req, list)) throw new HttpError(401, "Session du mode Vœux expirée : saisissez à nouveau le mot de passe.");
  };

  // ---- Routes ----------------------------------------------------------------

  const routes = [];
  const route = (method, pattern, handler) => routes.push({ method, pattern: new RegExp("^" + pattern + "$"), handler });

  route("GET", "/api/health", (req, res) => sendJson(res, 200, { ok: true }));

  route("GET", "/api/config", (req, res) => sendJson(res, 200, { creationCode: Boolean(config.creationCode) }));

  // Create a list. The generated password is returned once, never stored in
  // clear; the creator's browser is signed in to the new list right away.
  route("POST", "/api/lists", async (req, res) => {
    const ip = clientIp(req, config.trustProxy);
    if (limited("create:" + ip, 10, 3600000)) throw new HttpError(429, "Trop de listes créées d'un coup. Réessayez dans une heure.");
    const body = await readJson(req);
    if (config.creationCode && !safeEqual(String(body.creationCode || ""), config.creationCode)) {
      throw new HttpError(403, "Code de création incorrect.");
    }
    const settings = listSettings(body, { welcomeTitle: DEFAULT_WELCOME_TITLE, welcomeSubtitle: DEFAULT_WELCOME_SUBTITLE, heroUpload: null });
    const password = generatePassword();
    const list = store.addList({ ...settings, ...(await hashPassword(password)), passwordVersion: 1 });
    await store.save();
    hit("create:" + ip);
    sendJson(res, 201, { list: publicList(list), password }, { "Set-Cookie": cookie(req, listCookie(list.id), listToken(list), config.sessionDays * 86400) });
  });

  route("GET", "/api/lists/" + LIST_ID, (req, res, [id]) => {
    const list = findList(id);
    sendJson(res, 200, { list: publicList(list), gifts: store.listGifts(id) });
  });

  route("GET", "/api/lists/" + LIST_ID + "/session", (req, res, [id]) => sendJson(res, 200, { voeux: isOwner(req, findList(id)) }));

  route("POST", "/api/lists/" + LIST_ID + "/login", async (req, res, [id]) => {
    const list = findList(id);
    const key = "login:" + clientIp(req, config.trustProxy) + ":" + id;
    if (limited(key, 8, 600000)) throw new HttpError(429, "Trop de tentatives. Réessayez dans quelques minutes.");
    const body = await readJson(req);
    if (typeof body.password !== "string" || !(await verifyPassword(list, body.password))) {
      hit(key);
      throw new HttpError(401, "Mot de passe incorrect.");
    }
    hits.delete(key);
    sendJson(res, 200, { voeux: true }, { "Set-Cookie": cookie(req, listCookie(id), listToken(list), config.sessionDays * 86400) });
  });

  route("POST", "/api/lists/" + LIST_ID + "/logout", (req, res, [id]) => {
    sendJson(res, 200, { voeux: false }, { "Set-Cookie": cookie(req, listCookie(id), "", 0) });
  });

  route("PUT", "/api/lists/" + LIST_ID + "/settings", async (req, res, [id]) => {
    const list = findList(id);
    requireOwner(req, list);
    const previousHero = list.heroUpload;
    store.updateList(id, listSettings(await readJson(req), list));
    await store.save();
    if (previousHero && previousHero !== list.heroUpload) await store.removeUploadsIfUnused([previousHero]);
    broadcast(id, "settings");
    sendJson(res, 200, { list: publicList(list) });
  });

  route("POST", "/api/lists/" + LIST_ID + "/password", async (req, res, [id]) => {
    const list = findList(id);
    requireOwner(req, list);
    const password = generatePassword();
    store.updateList(id, { ...(await hashPassword(password)), passwordVersion: (list.passwordVersion || 1) + 1 });
    await store.save();
    sendJson(res, 200, { password }, { "Set-Cookie": cookie(req, listCookie(id), listToken(list), config.sessionDays * 86400) });
  });

  route("GET", "/api/lists/" + LIST_ID + "/reservations", (req, res, [id]) => {
    findList(id);
    sendJson(res, 200, { reservations: store.listReservations(id) });
  });

  route("POST", "/api/lists/" + LIST_ID + "/gifts", async (req, res, [id]) => {
    const list = findList(id);
    requireOwner(req, list);
    const gift = store.addGift(id, giftFields(await readJson(req)));
    await store.save();
    broadcast(id, "gifts");
    autoImage(gift);
    sendJson(res, 201, gift);
  });

  route("PUT", "/api/lists/" + LIST_ID + "/gifts/" + ITEM_ID, async (req, res, [id, giftId]) => {
    const list = findList(id);
    requireOwner(req, list);
    const fields = giftFields(await readJson(req));
    const previous = store.getGift(id, giftId);
    if (!previous) throw new HttpError(404, "Ce vœu n'existe plus.");
    const oldImage = previous.imageUpload;
    const gift = store.updateGift(id, giftId, fields);
    await store.save();
    if (oldImage && oldImage !== gift.imageUpload) await store.removeUploadsIfUnused([oldImage]);
    broadcast(id, "gifts");
    autoImage(gift);
    sendJson(res, 200, gift);
  });

  route("DELETE", "/api/lists/" + LIST_ID + "/gifts/" + ITEM_ID, async (req, res, [id, giftId]) => {
    const list = findList(id);
    requireOwner(req, list);
    const gift = store.deleteGift(id, giftId);
    if (!gift) throw new HttpError(404, "Ce vœu n'existe plus.");
    await store.save();
    await store.removeUploadsIfUnused([gift.imageUpload]);
    broadcast(id, "gifts");
    broadcast(id, "reservations");
    send(res, 204, "");
  });

  // Reserving needs no password: that is the whole point of Mode Lutin.
  route("POST", "/api/lists/" + LIST_ID + "/gifts/" + ITEM_ID + "/reservations", async (req, res, [id, giftId]) => {
    findList(id);
    if (!store.getGift(id, giftId)) throw new HttpError(404, "Ce cadeau n'est plus dans la liste.");
    const body = await readJson(req);
    const action = body.action === "release" ? "release" : "reserve";
    const name = cleanString(body.name, 60, "Le nom");
    if (action === "reserve" && !name) throw new HttpError(400, "Indiquez votre nom pour réserver.");
    const entry = store.addReservation(id, { giftId, action, name });
    await store.save();
    broadcast(id, "reservations");
    sendJson(res, 201, entry);
  });

  route("POST", "/api/lists/" + LIST_ID + "/uploads", async (req, res, [id]) => {
    requireOwner(req, findList(id));
    const body = await readBody(req, MAX_IMAGE_BYTES);
    const ext = sniffImage(body);
    if (!ext) throw new HttpError(415, "Format non pris en charge : utilisez une image PNG, JPEG, WebP ou GIF.");
    sendJson(res, 201, { upload: await saveUpload(ext, body) });
  });

  route("POST", "/api/lists/" + LIST_ID + "/link-image", async (req, res, [id]) => {
    requireOwner(req, findList(id));
    const body = await readJson(req);
    const link = cleanUrl(body.url, "Le lien");
    if (!link) throw new HttpError(400, "Ajoutez un lien.");
    try {
      const { ext, body: image } = await fetchLinkImage(link);
      sendJson(res, 201, { upload: await saveUpload(ext, image) });
    } catch (e) {
      if (e instanceof LinkImageError) throw new HttpError(422, e.message);
      throw e;
    }
  });

  route("GET", "/api/lists/" + LIST_ID + "/events", (req, res, [id]) => {
    findList(id);
    res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write("retry: 3000\n\n");
    if (!listeners.has(id)) listeners.set(id, new Set());
    listeners.get(id).add(res);
    req.on("close", () => {
      const set = listeners.get(id);
      if (set) { set.delete(res); if (!set.size) listeners.delete(id); }
    });
  });

  // ---- Admin -----------------------------------------------------------------

  route("GET", "/api/admin/session", (req, res) => sendJson(res, 200, { enabled: adminEnabled, admin: isAdmin(req) }));

  route("POST", "/api/admin/login", async (req, res) => {
    if (!adminEnabled) throw new HttpError(404, "L'administration est désactivée : définissez ADMIN_PASSWORD dans le fichier .env.");
    const key = "admin:" + clientIp(req, config.trustProxy);
    if (limited(key, 8, 600000)) throw new HttpError(429, "Trop de tentatives. Réessayez dans quelques minutes.");
    const body = await readJson(req);
    const given = crypto.createHash("sha256").update(String(body.password || "")).digest();
    const expected = crypto.createHash("sha256").update(config.adminPassword).digest();
    if (!crypto.timingSafeEqual(given, expected)) { hit(key); throw new HttpError(401, "Mot de passe incorrect."); }
    hits.delete(key);
    sendJson(res, 200, { admin: true }, { "Set-Cookie": cookie(req, ADMIN_COOKIE, adminToken(), 12 * 3600) });
  });

  route("POST", "/api/admin/logout", (req, res) => sendJson(res, 200, { admin: false }, { "Set-Cookie": cookie(req, ADMIN_COOKIE, "", 0) }));

  route("GET", "/api/admin/lists", (req, res) => {
    requireAdmin(req);
    const lists = store.data.lists
      .map((l) => ({ id: l.id, name: l.name, createdAt: l.createdAt, ...store.listStats(l.id) }))
      .sort((a, b) => String(b.lastActivity).localeCompare(String(a.lastActivity)));
    sendJson(res, 200, { lists });
  });

  route("POST", "/api/admin/lists/" + LIST_ID + "/password", async (req, res, [id]) => {
    requireAdmin(req);
    const list = findList(id);
    const password = generatePassword();
    store.updateList(id, { ...(await hashPassword(password)), passwordVersion: (list.passwordVersion || 1) + 1 });
    await store.save();
    sendJson(res, 200, { password });
  });

  route("DELETE", "/api/admin/lists/" + LIST_ID, async (req, res, [id]) => {
    requireAdmin(req);
    findList(id);
    const uploads = store.deleteList(id);
    await store.save();
    await store.removeUploadsIfUnused(uploads);
    broadcast(id, "deleted");
    send(res, 204, "");
  });

  // ---- Files -----------------------------------------------------------------

  route("GET", "/uploads/([^/]+)", async (req, res, [name]) => {
    if (!UPLOAD_NAME.test(name)) throw new HttpError(404, "Image introuvable.");
    let data;
    try { data = await fsp.readFile(store.uploadPath(name)); } catch (e) { throw new HttpError(404, "Image introuvable."); }
    send(res, 200, data, { "Content-Type": MIME[path.extname(name)], "Cache-Control": "public, max-age=31536000, immutable" });
  });

  const serveStatic = async (req, res, pathname) => {
    let rel;
    try { rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, ""); }
    catch (e) { throw new HttpError(404, "Page introuvable."); }
    const file = path.join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(404, "Page introuvable.");
    let data;
    try { data = await fsp.readFile(file); }
    catch (e) {
      if (path.extname(rel)) throw new HttpError(404, "Fichier introuvable.");
      // /admin, /<list id>…: the page routes itself.
      data = await fsp.readFile(path.join(PUBLIC_DIR, "index.html"));
      return send(res, 200, req.method === "HEAD" ? "" : data, { "Content-Type": MIME[".html"], "Cache-Control": "no-cache" });
    }
    const ext = path.extname(file).toLowerCase();
    const cache = ext === ".html" ? "no-cache" : "public, max-age=300";
    send(res, 200, req.method === "HEAD" ? "" : data, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": cache });
  };

  const handler = async (req, res) => {
    let pathname;
    try { pathname = new URL(req.url, "http://localhost").pathname; } catch (e) { return sendJson(res, 400, { error: "Adresse invalide." }); }
    try {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = pathname.match(r.pattern);
        if (m) return await r.handler(req, res, m.slice(1));
      }
      if (pathname.startsWith("/api/")) throw new HttpError(404, "Action inconnue.");
      if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Méthode non autorisée.");
      await serveStatic(req, res, pathname);
    } catch (err) {
      if (res.headersSent) { res.end(); return; }
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      console.error("[server]", req.method, pathname, err);
      sendJson(res, 500, { error: "Erreur du serveur. Réessayez dans un instant." });
    }
  };

  const server = http.createServer(handler);
  server.headersTimeout = 20000;
  server.requestTimeout = 60000;

  // Remove uploaded pictures nothing uses (cancelled edits), every 6 hours.
  const cleanup = () => store.cleanupUploads(24 * 3600 * 1000).catch((e) => console.error("[cleanup]", e));
  const cleanupTimer = setInterval(cleanup, 6 * 3600 * 1000);
  cleanupTimer.unref();

  server.on("close", () => {
    clearInterval(heartbeat);
    clearInterval(cleanupTimer);
    clearInterval(hitsSweep);
  });
  const closeStreams = () => { for (const set of listeners.values()) for (const res of set) res.end(); listeners.clear(); };

  return { server, store, config, cleanup, closeStreams };
}

if (require.main === module) {
  let app;
  try { app = createApp(); }
  catch (e) { console.error("Listom ne peut pas démarrer : " + e.message); process.exit(1); }
  const { server, store, config, cleanup, closeStreams } = app;
  if (!config.adminPassword) console.warn("ADMIN_PASSWORD n'est pas défini : la page /admin est désactivée.");
  cleanup();
  server.listen(config.port, config.host, () => {
    console.log("Listom écoute sur http://" + config.host + ":" + config.port + " (données : " + config.dataDir + ")");
  });
  const stop = (signal) => {
    console.log("Arrêt (" + signal + ")…");
    closeStreams();
    server.close(() => store.queue.finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}

module.exports = { createApp, readConfig, generatePassword };
