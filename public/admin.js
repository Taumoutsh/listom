// Administration (/admin): every list on the server, with a new password or
// deletion for each. Protected by ADMIN_PASSWORD from the .env file.
(function () {
  "use strict";

  const { esc, ICONS, LOGO, toast, copyText, api, route } = window.Listom;
  if (route.kind !== "admin") return;

  const app = document.getElementById("app");
  const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });
  const fmtDate = (iso) => { const d = new Date(iso); return isNaN(d) ? "—" : dateFmt.format(d); };
  const plural = (n, one, many) => n + " " + (n > 1 ? many : one);

  const state = {
    loaded: false, enabled: true, admin: false,
    pw: "", err: "", busy: false,
    lists: [], filter: "",
    confirm: null,       // { id, kind: "reset" | "delete" }
    revealed: {},        // list id -> new password, shown once
    working: null
  };

  const call = (method, url, body) => api(method, url, body, () => { state.admin = false; render(); });

  async function loadLists() {
    const r = await call("GET", "/api/admin/lists");
    state.lists = r.lists || [];
  }

  function header() {
    return '<div class="topbar"><div class="brand">' + LOGO + "Listom</div>" +
      (state.admin ? '<button class="btn ghost" data-a="logout">' + ICONS.lock + "Se déconnecter</button>" : "") + "</div>";
  }

  function loginView() {
    if (!state.enabled) {
      return '<div class="gate"><span class="gate-ico">' + ICONS.lock + '</span><span class="eyebrow">Administration</span>' +
        "<h1>Administration désactivée</h1><p>Définissez ADMIN_PASSWORD dans le fichier .env du serveur, puis redémarrez Listom.</p></div>";
    }
    return '<div class="gate"><span class="gate-ico">' + ICONS.lock + '</span><span class="eyebrow">Administration</span>' +
      "<h1>Accès réservé</h1><p>Saisissez le mot de passe d'administration défini dans le fichier .env.</p>" +
      '<form class="gate-form" id="login" novalidate><label for="a-pw" class="sr">Mot de passe d\'administration</label>' +
      '<input class="field-input" id="a-pw" type="password" autocomplete="current-password" placeholder="Mot de passe" value="' + esc(state.pw) + '">' +
      '<button class="btn primary" type="submit"' + (state.busy ? " disabled" : "") + ">Se connecter</button></form>" +
      (state.err ? '<p class="err" role="alert">' + esc(state.err) + "</p>" : "") + "</div>";
  }

  function row(l) {
    const c = state.confirm && state.confirm.id === l.id ? state.confirm.kind : null;
    const busy = state.working === l.id;
    let extra = "";
    if (state.revealed[l.id]) {
      extra = '<div class="secret"><span class="secret-label">Nouveau mot de passe</span>' +
        '<div class="secret-row"><code id="pw-' + esc(l.id) + '">' + esc(state.revealed[l.id]) + '</code><button class="btn" data-a="copy" data-id="' + esc(l.id) + '">' + ICONS.copy + "Copier</button></div>" +
        '<p class="fine">Transmettez-le au propriétaire de la liste : il ne sera plus affiché.</p></div>';
    } else if (c === "reset") {
      extra = '<div class="inline-form"><p class="confirm-text">Générer un nouveau mot de passe pour « ' + esc(l.name) + " » ? L'ancien ne fonctionnera plus.</p>" +
        '<div class="actions"><button class="btn ghost" data-a="cancel">Annuler</button><button class="btn primary" data-a="do-reset" data-id="' + esc(l.id) + '"' + (busy ? " disabled" : "") + ">Générer</button></div></div>";
    } else if (c === "delete") {
      extra = '<div class="inline-form danger-zone"><p class="confirm-text">Supprimer définitivement « ' + esc(l.name) + " » avec ses " + plural(l.gifts, "vœu", "vœux") + " et tout l'historique des réservations ? Cette action est irréversible.</p>" +
        '<div class="actions"><button class="btn ghost" data-a="cancel">Garder la liste</button><button class="btn primary" data-a="do-delete" data-id="' + esc(l.id) + '"' + (busy ? " disabled" : "") + ">Supprimer</button></div></div>";
    }
    return '<li class="admin-row">' +
      '<div class="admin-main"><a class="admin-name" href="/' + encodeURIComponent(l.id) + '" target="_blank" rel="noopener">' + esc(l.name) + "</a>" +
        '<span class="admin-id">/' + esc(l.id) + "</span></div>" +
      '<div class="admin-meta"><span>' + plural(l.gifts, "vœu", "vœux") + "</span><span>" + plural(l.reserved, "réservé", "réservés") + "</span>" +
        "<span>Créée le " + esc(fmtDate(l.createdAt)) + "</span><span>Activité le " + esc(fmtDate(l.lastActivity)) + "</span></div>" +
      '<div class="actions"><button class="btn" data-a="reset" data-id="' + esc(l.id) + '">' + ICONS.key + "Nouveau mot de passe</button>" +
        '<button class="btn danger" data-a="delete" data-id="' + esc(l.id) + '">' + ICONS.trash + "Supprimer</button></div>" +
      extra + "</li>";
  }

  function listView() {
    const q = state.filter.trim().toLowerCase();
    const shown = q ? state.lists.filter((l) => l.name.toLowerCase().includes(q) || l.id.toLowerCase().includes(q)) : state.lists;
    const totalGifts = state.lists.reduce((s, l) => s + l.gifts, 0);
    return '<div class="hero"><span class="eyebrow">Administration</span><h1>Listes</h1>' +
      '<div class="summary"><span><b>' + state.lists.length + "</b> " + (state.lists.length > 1 ? "listes" : "liste") + "</span><span><b>" + totalGifts + "</b> " + (totalGifts > 1 ? "vœux" : "vœu") + " au total</span></div></div>" +
      (state.lists.length > 5 ? '<div class="toolbar"><input class="field-input search" id="a-filter" type="search" placeholder="Rechercher une liste" value="' + esc(state.filter) + '" aria-label="Rechercher une liste"></div>' : "") +
      (state.lists.length
        ? (shown.length ? '<ul class="admin-list">' + shown.map(row).join("") + "</ul>" : '<p class="notice">Aucune liste ne correspond à cette recherche.</p>')
        : '<div class="empty"><h2>Aucune liste pour l\'instant</h2><p>Les listes créées depuis la page d\'accueil apparaîtront ici.</p><a class="btn primary" href="/">Créer une liste</a></div>');
  }

  function render() {
    const ae = document.activeElement;
    const focusId = ae && ae.id && app.contains(ae) ? ae.id : null;
    if (!state.loaded) { app.innerHTML = header(); return; }
    app.innerHTML = header() + (state.admin ? listView() : loginView());
    const el = focusId && document.getElementById(focusId);
    if (el) { el.focus(); if (el.id === "a-filter") { const n = el.value.length; try { el.setSelectionRange(n, n); } catch (e) {} } }
    else if (!state.admin && state.enabled) { const pw = document.getElementById("a-pw"); if (pw) pw.focus(); }
  }

  app.addEventListener("input", (e) => {
    if (e.target.id === "a-pw") state.pw = e.target.value;
    if (e.target.id === "a-filter") { state.filter = e.target.value; render(); }
  });

  app.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (state.busy) return;
    if (!state.pw) { state.err = "Saisissez le mot de passe."; render(); return; }
    state.busy = true; state.err = ""; render();
    try {
      await api("POST", "/api/admin/login", { password: state.pw });
      state.admin = true; state.pw = "";
      await loadLists();
    } catch (err) { state.err = err.message; state.pw = ""; }
    state.busy = false; render();
  });

  app.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-a]");
    if (!el) return;
    const a = el.dataset.a, id = el.dataset.id;
    if (a === "logout") { await api("POST", "/api/admin/logout").catch(() => {}); state.admin = false; state.lists = []; state.revealed = {}; render(); }
    else if (a === "reset" || a === "delete") { state.confirm = { id, kind: a }; delete state.revealed[id]; render(); }
    else if (a === "cancel") { state.confirm = null; render(); }
    else if (a === "copy") copyText(state.revealed[id], document.getElementById("pw-" + id));
    else if (a === "do-reset") {
      state.working = id; render();
      try { const r = await call("POST", "/api/admin/lists/" + encodeURIComponent(id) + "/password"); state.revealed[id] = r.password; state.confirm = null; }
      catch (err) { toast(err.message); }
      state.working = null; render();
    } else if (a === "do-delete") {
      state.working = id; render();
      try {
        await call("DELETE", "/api/admin/lists/" + encodeURIComponent(id));
        state.lists = state.lists.filter((l) => l.id !== id); state.confirm = null; toast("Liste supprimée.");
      } catch (err) { toast(err.message); }
      state.working = null; render();
    }
  });

  document.title = "Administration · Listom";
  render();
  (async () => {
    try {
      const s = await api("GET", "/api/admin/session");
      state.enabled = s.enabled; state.admin = s.admin;
      if (state.admin) await loadLists();
    } catch (err) { state.err = err.message; }
    state.loaded = true; render();
  })();
})();
