"use strict";

// Persistent storage: every list, gift and reservation lives in one JSON file
// (family gift lists are a few hundred records at most). Writes go through a
// queue and are atomic (temp file + rename), so a crash never leaves a
// half-written file behind.

const fs = require("node:fs");
const fsp = fs.promises;
const path = require("node:path");
const crypto = require("node:crypto");

const EMPTY = () => ({ version: 2, lists: [], gifts: [], reservations: [], invites: [] });

class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, "db.json");
    this.uploadsDir = path.join(dataDir, "uploads");
    this.data = EMPTY();
    this.queue = Promise.resolve();
  }

  load() {
    fs.mkdirSync(this.uploadsDir, { recursive: true });
    if (!fs.existsSync(this.file)) return;
    const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
    this.data = {
      version: 2,
      lists: Array.isArray(raw.lists) ? raw.lists : [],
      gifts: Array.isArray(raw.gifts) ? raw.gifts : [],
      reservations: Array.isArray(raw.reservations) ? raw.reservations : [],
      invites: Array.isArray(raw.invites) ? raw.invites : []
    };
  }

  /** Persist the current state. Resolves once it is safely on disk. */
  save() {
    const snapshot = JSON.stringify(this.data, null, 2);
    const run = async () => {
      const tmp = this.file + "." + process.pid + ".tmp";
      await fsp.writeFile(tmp, snapshot, { mode: 0o600 });
      await fsp.rename(tmp, this.file);
    };
    const next = this.queue.then(run);
    this.queue = next.catch((err) => console.error("[store] écriture impossible :", err));
    return next;
  }

  /** Short random id, safe in URLs (also used as the list's link). */
  static newId(bytes = 9) {
    return crypto.randomBytes(bytes).toString("base64url");
  }

  // ---- Lists ---------------------------------------------------------------

  getList(id) {
    return this.data.lists.find((l) => l.id === id) || null;
  }

  addList(fields) {
    let id;
    do { id = Store.newId(8); } while (this.getList(id) || /^(admin|api|uploads)$/i.test(id));
    const now = new Date().toISOString();
    const list = { id, ...fields, createdAt: now, updatedAt: now };
    this.data.lists.push(list);
    return list;
  }

  updateList(id, fields) {
    const list = this.getList(id);
    if (!list) return null;
    Object.assign(list, fields, { updatedAt: new Date().toISOString() });
    return list;
  }

  /** Delete a list with its gifts and history; returns the uploads it used. */
  deleteList(id) {
    const list = this.getList(id);
    if (!list) return null;
    const uploads = [list.heroUpload, ...this.data.gifts.filter((g) => g.listId === id).map((g) => g.imageUpload)].filter(Boolean);
    this.data.lists = this.data.lists.filter((l) => l.id !== id);
    this.data.gifts = this.data.gifts.filter((g) => g.listId !== id);
    this.data.reservations = this.data.reservations.filter((r) => r.listId !== id);
    return uploads;
  }

  touchList(id) {
    const list = this.getList(id);
    if (list) list.updatedAt = new Date().toISOString();
  }

  /** Figures for the admin view. */
  listStats(id) {
    const gifts = this.data.gifts.filter((g) => g.listId === id);
    const reserved = gifts.filter((g) => this.currentReservation(id, g.id)).length;
    const list = this.getList(id);
    let last = list ? list.updatedAt : "";
    for (const r of this.data.reservations) if (r.listId === id && r.at > last) last = r.at;
    return { gifts: gifts.length, reserved, lastActivity: last };
  }

  // ---- Creation links (invites) ----------------------------------------------
  // The admin hands out a one-time link; opening it lets one person create one
  // list. Used, revoked and expired links simply disappear.

  pendingInvites() {
    const now = new Date().toISOString();
    this.data.invites = this.data.invites.filter((i) => i.expiresAt > now);
    return [...this.data.invites].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  getInvite(token) {
    const invite = this.data.invites.find((i) => i.token === token);
    return invite && invite.expiresAt > new Date().toISOString() ? invite : null;
  }

  addInvite(name, days, theme) {
    const now = Date.now();
    const invite = {
      token: crypto.randomBytes(18).toString("base64url"),
      name,
      theme,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + days * 86400000).toISOString()
    };
    this.data.invites.push(invite);
    return invite;
  }

  /** Remove an invite; returns it if it existed and was still valid. */
  takeInvite(token) {
    const invite = this.getInvite(token);
    this.data.invites = this.data.invites.filter((i) => i.token !== token);
    return invite;
  }

  // ---- Gifts ---------------------------------------------------------------

  listGifts(listId) {
    return this.data.gifts
      .filter((g) => g.listId === listId)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  getGift(listId, id) {
    return this.data.gifts.find((g) => g.id === id && g.listId === listId) || null;
  }

  addGift(listId, fields) {
    const now = new Date().toISOString();
    const gift = { id: Store.newId(), listId, ...fields, createdAt: now, updatedAt: now };
    this.data.gifts.push(gift);
    this.touchList(listId);
    return gift;
  }

  updateGift(listId, id, fields) {
    const gift = this.getGift(listId, id);
    if (!gift) return null;
    Object.assign(gift, fields, { updatedAt: new Date().toISOString() });
    this.touchList(listId);
    return gift;
  }

  deleteGift(listId, id) {
    const gift = this.getGift(listId, id);
    if (!gift) return null;
    this.data.gifts = this.data.gifts.filter((g) => g !== gift);
    this.data.reservations = this.data.reservations.filter((r) => !(r.listId === listId && r.giftId === id));
    this.touchList(listId);
    return gift;
  }

  // ---- Reservations (append-only history) ------------------------------------

  listReservations(listId) {
    return this.data.reservations
      .filter((r) => r.listId === listId)
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }

  currentReservation(listId, giftId) {
    let last = null;
    for (const r of this.data.reservations) {
      if (r.listId === listId && r.giftId === giftId && (!last || r.at >= last.at)) last = r;
    }
    return last && last.action !== "release" ? last : null;
  }

  addReservation(listId, { giftId, action, name }) {
    const entry = { id: Store.newId(), listId, giftId, action, name, at: new Date().toISOString() };
    this.data.reservations.push(entry);
    return entry;
  }

  // ---- Uploads ---------------------------------------------------------------

  uploadPath(name) {
    return path.join(this.uploadsDir, name);
  }

  isUploadUsed(name) {
    return this.data.gifts.some((g) => g.imageUpload === name) || this.data.lists.some((l) => l.heroUpload === name);
  }

  async removeUploadsIfUnused(names) {
    for (const name of names) {
      if (name && !this.isUploadUsed(name)) await fsp.unlink(this.uploadPath(name)).catch(() => {});
    }
  }

  /** Delete uploaded images nothing points to, once older than `minAgeMs`. */
  async cleanupUploads(minAgeMs) {
    let removed = 0;
    const now = Date.now();
    for (const name of await fsp.readdir(this.uploadsDir)) {
      if (this.isUploadUsed(name)) continue;
      try {
        const st = await fsp.stat(this.uploadPath(name));
        if (now - st.mtimeMs >= minAgeMs) { await fsp.unlink(this.uploadPath(name)); removed++; }
      } catch (e) { /* already gone */ }
    }
    return removed;
  }
}

module.exports = { Store };
