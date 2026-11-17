// Helpers shared by the three pages of the app:
//   /            create a list            (home.js)
//   /<id>        a list: Vœux / Lutin     (app.js)
//   /admin       administration           (admin.js)
(function () {
  "use strict";

  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Words wrapped in *asterisks* are shown in the accent colour:
  // "Il y a aussi *les boules*…".
  const richTitle = (s) => esc(s).replace(/\*([^*]+)\*/g, "<em>$1</em>");
  const plainTitle = (s) => String(s || "").replace(/\*/g, "");

  const ICONS = {
    gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/></svg>',
    elf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14 12 3l8 11"/><path d="M3 14h18"/><path d="M6 14v1a6 6 0 0 0 12 0v-1"/><circle cx="12" cy="3" r="1.2" fill="currentColor"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
    key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 21 2M16 7l3 3M14 9l2 2"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/></svg>'
  };
  const LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="11" width="26" height="18" rx="4" fill="var(--accent)"/><rect x="1.5" y="8" width="29" height="6" rx="2.5" fill="var(--accent)"/><rect x="14" y="8" width="4" height="21" fill="var(--surface)" opacity=".9"/><path d="M16 8c-2-4-7-6-8-3s4 3 8 3zm0 0c2-4 7-6 8-3s-4 3-8 3z" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linejoin="round"/></svg>';

  // Welcome picture in a round frame with two swinging Christmas baubles.
  const heroPicture = (src) => '<span class="robin"><img src="' + esc(src) + '" alt="" width="280" height="280">' +
    '<svg class="baubles" viewBox="0 0 120 120" aria-hidden="true">' +
    '<g class="bauble"><path d="M14 -6v20" stroke="var(--muted)" stroke-width="1.5"/><rect x="10" y="13" width="8" height="5" rx="1" fill="#C9A227"/><circle cx="14" cy="26" r="9" fill="#D6336C"/><path d="M9 23q5-4 10 0" stroke="#fff" stroke-width="1.5" fill="none" opacity=".7"/></g>' +
    '<g class="bauble b2"><path d="M106 -6v26" stroke="var(--muted)" stroke-width="1.5"/><rect x="102" y="19" width="8" height="5" rx="1" fill="#C9A227"/><circle cx="106" cy="32" r="8" fill="#E5B54C"/><path d="M101 29q5-4 10 0" stroke="#fff" stroke-width="1.5" fill="none" opacity=".7"/></g>' +
    "</svg></span>";
  const heroSrc = (upload) => upload ? "/uploads/" + encodeURIComponent(upload) : "/hero.svg";

  const DEFAULTS = {
    welcomeTitle: "Il y a aussi *les boules*…",
    welcomeSubtitle: "Une liste de vœux partagée : chacun réserve ce qu'il offre, et la personne gâtée garde la surprise."
  };

  let toastTimer = null;
  function toast(msg) {
    const root = document.getElementById("toast-root");
    if (!root) return;
    root.innerHTML = '<div class="toast" role="status">' + esc(msg) + "</div>";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { root.innerHTML = ""; }, 3200);
  }

  // Copy to the clipboard; if the browser refuses, select the text instead so
  // the person can copy it by hand.
  async function copyText(text, selectEl) {
    try { await navigator.clipboard.writeText(text); toast("Copié dans le presse-papiers."); return true; }
    catch (e) {
      if (selectEl) { const r = document.createRange(); r.selectNodeContents(selectEl); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
      toast("Copie impossible : le texte est sélectionné, copiez-le à la main.");
      return false;
    }
  }

  /** fetch() wrapper: JSON in and out, French error message in `message`. */
  async function api(method, url, body, onUnauthorized) {
    const init = { method, credentials: "same-origin", headers: {} };
    if (body instanceof Blob) { init.body = body; init.headers["Content-Type"] = body.type || "application/octet-stream"; }
    else if (body !== undefined) { init.body = JSON.stringify(body); init.headers["Content-Type"] = "application/json"; }
    let res;
    try { res = await fetch(url, init); }
    catch (e) { throw { status: 0, message: "Connexion au serveur impossible. Vérifiez votre réseau puis réessayez." }; }
    let data = null;
    if (res.status !== 204) { try { data = await res.json(); } catch (e) { data = null; } }
    if (!res.ok) {
      if (res.status === 401 && onUnauthorized) onUnauthorized(url);
      throw { status: res.status, message: (data && data.error) || "L'opération a échoué. Réessayez dans un instant." };
    }
    return data;
  }

  // Lists created on this device, so the home page can link back to them.
  const myLists = {
    all: () => LS.get("listom.myLists", []),
    add: (list) => { const l = myLists.all().filter((x) => x.id !== list.id); l.unshift({ id: list.id, name: list.name }); LS.set("listom.myLists", l.slice(0, 20)); },
    rename: (id, name) => LS.set("listom.myLists", myLists.all().map((x) => x.id === id ? { id, name } : x)),
    remove: (id) => LS.set("listom.myLists", myLists.all().filter((x) => x.id !== id))
  };

  const path = location.pathname.replace(/\/+$/, "") || "/";
  let route = { kind: "notfound" };
  if (path === "/") route = { kind: "home" };
  else if (path === "/admin") route = { kind: "admin" };
  else { const m = path.match(/^\/([A-Za-z0-9_-]{6,40})$/); if (m) route = { kind: "list", id: m[1] }; }

  window.Listom = { LS, esc, richTitle, plainTitle, ICONS, LOGO, heroPicture, heroSrc, DEFAULTS, toast, copyText, api, myLists, route };
})();
