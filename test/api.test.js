"use strict";

// API tests: run with `npm test` (Node's built-in test runner, no dependency).

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server/index");
const { isBlockedAddress, findImageCandidates, sniffImage } = require("../server/link-image");

let app, base, dataDir;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "listom-test-"));
  app = createApp({ DATA_DIR: dataDir, ADMIN_PASSWORD: "admin-secret", AUTO_LINK_IMAGE: "false" });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  base = "http://127.0.0.1:" + app.server.address().port;
});

after(async () => {
  app.closeStreams();
  await new Promise((resolve) => app.server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** Minimal client keeping its own cookies, like one browser. */
function client() {
  const jar = new Map();
  return async (method, url, body) => {
    const headers = {};
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => k + "=" + v).join("; ");
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      const value = pair.slice(i + 1);
      if (value) jar.set(pair.slice(0, i), value); else jar.delete(pair.slice(0, i));
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

async function createList(c, name = "Les vœux de Camille") {
  const r = await c("POST", "/api/lists", { name });
  assert.equal(r.status, 201);
  return r.body;
}

test("creating a list returns its link id and a generated password", async () => {
  const owner = client();
  const { list, password } = await createList(owner);
  assert.match(list.id, /^[A-Za-z0-9_-]{6,40}$/);
  assert.match(password, /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
  assert.equal(list.welcomeTitle, "Il y a aussi *les boules*…");
  const session = await owner("GET", "/api/lists/" + list.id + "/session");
  assert.equal(session.body.voeux, true, "the creator is signed in to Mode Vœux");
  const stored = fs.readFileSync(path.join(dataDir, "db.json"), "utf8");
  assert.ok(!stored.includes(password), "the password is never stored in clear");
});

test("a list name is required", async () => {
  const r = await client()("POST", "/api/lists", { name: "  " });
  assert.equal(r.status, 400);
});

test("only the owner edits gifts; anyone reserves; history is kept", async () => {
  const owner = client();
  const { list, password } = await createList(owner);
  const giver = client();
  const L = "/api/lists/" + list.id;

  assert.equal((await giver("POST", L + "/gifts", { title: "Casque" })).status, 401);
  const gift = (await owner("POST", L + "/gifts", { title: "Casque", price: 149.9, link: "https://example.com/casque" })).body;
  assert.equal(gift.price, 149.9);

  assert.equal((await giver("POST", L + "/gifts/" + gift.id + "/reservations", { name: "" })).status, 400);
  await giver("POST", L + "/gifts/" + gift.id + "/reservations", { name: "Léo" });
  await giver("POST", L + "/gifts/" + gift.id + "/reservations", { name: "Léo et Zoé" });
  await giver("POST", L + "/gifts/" + gift.id + "/reservations", { action: "release", name: "Zoé" });
  const history = (await giver("GET", L + "/reservations")).body.reservations;
  assert.deepEqual(history.map((r) => [r.action, r.name]), [["reserve", "Léo"], ["reserve", "Léo et Zoé"], ["release", "Zoé"]]);
  assert.deepEqual(Object.keys(history[0]).sort(), ["action", "at", "giftId", "id", "listId", "name"]);

  assert.equal((await giver("POST", L + "/login", { password: "wrong" })).status, 401);
  assert.equal((await giver("POST", L + "/login", { password })).status, 200);
  assert.equal((await giver("POST", L + "/gifts", { title: "Livre" })).status, 201);
});

test("lists are isolated from each other", async () => {
  const a = client();
  const b = client();
  const listA = (await createList(a, "Liste A")).list;
  const listB = (await createList(b, "Liste B")).list;
  const gift = (await a("POST", "/api/lists/" + listA.id + "/gifts", { title: "Vélo" })).body;
  assert.equal((await a("POST", "/api/lists/" + listB.id + "/gifts", { title: "Intrus" })).status, 401);
  assert.equal((await b("DELETE", "/api/lists/" + listB.id + "/gifts/" + gift.id)).status, 404);
  assert.equal((await b("GET", "/api/lists/" + listB.id)).body.gifts.length, 0);
});

test("settings and a new password; the old password stops working", async () => {
  const owner = client();
  const { list, password } = await createList(owner);
  const L = "/api/lists/" + list.id;
  const other = client();
  await other("POST", L + "/login", { password });

  const s = await owner("PUT", L + "/settings", { name: "Noël 2026", welcomeTitle: "Joyeux *Noël*", welcomeSubtitle: "Merci !" });
  assert.equal(s.body.list.name, "Noël 2026");
  assert.equal(s.body.list.welcomeTitle, "Joyeux *Noël*");

  const fresh = (await owner("POST", L + "/password")).body.password;
  assert.notEqual(fresh, password);
  assert.equal((await owner("GET", L + "/session")).body.voeux, true, "this device stays signed in");
  assert.equal((await other("GET", L + "/session")).body.voeux, false, "other devices are signed out");
  assert.equal((await other("POST", L + "/login", { password })).status, 401);
  assert.equal((await other("POST", L + "/login", { password: fresh.toUpperCase() })).status, 200);
});

test("admin lists, resets and deletes lists", async () => {
  const owner = client();
  const { list } = await createList(owner, "À supprimer");
  const admin = client();
  assert.equal((await admin("GET", "/api/admin/lists")).status, 401);
  assert.equal((await admin("POST", "/api/admin/login", { password: "nope" })).status, 401);
  assert.equal((await admin("POST", "/api/admin/login", { password: "admin-secret" })).status, 200);

  const row = (await admin("GET", "/api/admin/lists")).body.lists.find((l) => l.id === list.id);
  assert.equal(row.name, "À supprimer");
  assert.equal(row.passwordHash, undefined, "no secret leaves the server");

  const reset = (await admin("POST", "/api/admin/lists/" + list.id + "/password")).body.password;
  assert.equal((await owner("GET", "/api/lists/" + list.id + "/session")).body.voeux, false);
  assert.equal((await client()("POST", "/api/lists/" + list.id + "/login", { password: reset })).status, 200);

  assert.equal((await admin("DELETE", "/api/admin/lists/" + list.id)).status, 204);
  assert.equal((await owner("GET", "/api/lists/" + list.id)).status, 404);
});

test("uploads accept real images only", async () => {
  const owner = client();
  const { list } = await createList(owner);
  const cookie = await (async () => { const r = await fetch(base + "/api/lists", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Photos" }) }); return { id: (await r.json()).list.id, cookie: r.headers.getSetCookie()[0].split(";")[0] }; })();
  const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
  const ok = await fetch(base + "/api/lists/" + cookie.id + "/uploads", { method: "POST", headers: { cookie: cookie.cookie, "content-type": "image/png" }, body: png });
  assert.equal(ok.status, 201);
  const fake = await fetch(base + "/api/lists/" + cookie.id + "/uploads", { method: "POST", headers: { cookie: cookie.cookie, "content-type": "image/png" }, body: "<svg onload=alert(1)>" });
  assert.equal(fake.status, 415);
  const anon = await fetch(base + "/api/lists/" + list.id + "/uploads", { method: "POST", headers: { "content-type": "image/png" }, body: png });
  assert.equal(anon.status, 401);
});

test("static files cannot escape the public folder", async () => {
  for (const p of ["/%2e%2e/server/index.js", "/..%2fserver/index.js", "/%2e%2e%2fdata/db.json"]) {
    const r = await fetch(base + p);
    assert.notEqual(r.status, 200, p);
  }
  const page = await fetch(base + "/abcdefgh");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /script-src 'self'/);
});

test("link images: internal addresses are refused", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.1.10", "172.20.0.5", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1", "0.0.0.0"]) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  for (const ip of ["93.184.216.34", "2606:4700::6810:85e5"]) assert.equal(isBlockedAddress(ip), false, ip);
});

test("link images: picture found in a product page", () => {
  const html = '<html><head><meta property="og:image" content="/img/casque.jpg?x=1&amp;y=2">' +
    '<script type="application/ld+json">{"@type":"Product","image":["https://cdn.example.com/p.png"]}</script></head></html>';
  assert.deepEqual(findImageCandidates(html, "https://shop.example.com/p/1"), [
    "https://shop.example.com/img/casque.jpg?x=1&y=2",
    "https://cdn.example.com/p.png"
  ]);
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "jpg");
  assert.equal(sniffImage(Buffer.from("<html>")), null);
});
