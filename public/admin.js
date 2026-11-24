// Administration (/admin): every list on the server, with a new password or
// deletion for each. Protected by ADMIN_PASSWORD from the .env file.
(function () {
  "use strict";

  const { esc, ICONS, LOGO, THEMES, themeOf, toast, copyText, api, route, href, inviteUrl } = window.Listom;

  // A theme menu (Noël, Anniversaire, Mariage).
  const themeSelect = (id, value, label) =>
    '<span class="select-wrap"><select class="select" id="' + esc(id) + '" aria-label="' + esc(label) + '">' +
    Object.keys(THEMES).map((k) => '<option value="' + k + '"' + (k === themeOf(value) ? " selected" : "") + ">" + THEMES[k].label + "</option>").join("") +
    "</select>" + ICONS.chevron + "</span>";
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
    working: null,
    invites: [], inviteName: "", inviteTheme: "noel", inviteBusy: false,
    freshInvite: null,   // token of the link just created (highlighted)
    revoking: null       // token waiting for confirmation
  };

  const call = (method, url, body) => api(method, url, body, () => { state.admin = false; render(); });

  async function loadLists() {
    const [r, i] = await Promise.all([call("GET", "/api/admin/lists"), call("GET", "/api/admin/invites")]);
    state.lists = r.lists || [];
    state.invites = i.invites || [];
  }

  // Creation links: the only way to create a list. One link, one list.
  function invitesSection() {
    const rows = state.invites.map((inv) => {
      const t = inv.token, fresh = state.freshInvite === t;
      const confirm = state.revoking === t
        ? '<div class="inline-form"><p class="confirm-text">Révoquer ce lien ? Il ne permettra plus de créer de liste.</p>' +
          '<div class="actions"><button class="btn ghost" data-a="revoke-cancel">Garder</button><button class="btn primary" data-a="revoke-go" data-token="' + esc(t) + '">Révoquer</button></div></div>'
        : "";
      return '<li class="invite-row' + (fresh ? " fresh" : "") + '">' +
        '<div class="admin-main"><span class="invite-name">' + (inv.name ? esc(inv.name) : "Liste sans nom") + "</span>" +
          (fresh ? '<span class="pill free">Nouveau</span>' : "") + "</div>" +
        '<div class="admin-meta"><span>Thème ' + esc(THEMES[themeOf(inv.theme)].label) + "</span><span>Créé le " + esc(fmtDate(inv.createdAt)) + "</span><span>Expire le " + esc(fmtDate(inv.expiresAt)) + "</span></div>" +
        '<div class="secret-row"><code id="inv-' + esc(t) + '">' + esc(inviteUrl(t)) + "</code>" +
          '<button class="btn" data-a="copy-invite" data-token="' + esc(t) + '">' + ICONS.copy + "Copier</button>" +
          (state.revoking === t ? "" : '<button class="btn ghost" data-a="revoke" data-token="' + esc(t) + '">Révoquer</button>') + "</div>" +
        confirm + "</li>";
    }).join("");
    return '<section class="invites"><div class="invites-head"><h2 class="section-title">Liens de création</h2>' +
        '<p class="fine">Envoyez un lien à la personne qui veut sa liste : il ne sert qu\'une fois et expire s\'il n\'est pas utilisé.</p></div>' +
      '<form class="invite-form" id="invite" novalidate>' +
        '<label for="a-invite-name" class="sr">Nom de la liste (facultatif)</label>' +
        '<input class="field-input" id="a-invite-name" maxlength="80" placeholder="Nom de la liste (facultatif)" value="' + esc(state.inviteName) + '">' +
        themeSelect("a-invite-theme", state.inviteTheme, "Thème de la liste") +
        '<button class="btn primary" type="submit"' + (state.inviteBusy ? " disabled" : "") + ">" + ICONS.link + "Créer un lien</button></form>" +
      (rows ? '<ul class="invite-list">' + rows + "</ul>" : '<p class="fine">Aucun lien en attente.</p>') +
      "</section>";
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
      "<h1>Accès réservé</h1>" +
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
      '<div class="admin-main"><a class="admin-name" href="' + href.list(l.id) + '" target="_blank" rel="noopener">' + esc(l.name) + "</a>" +
        '<span class="admin-id">/' + esc(l.id) + "</span></div>" +
      '<div class="admin-meta"><span>' + plural(l.gifts, "vœu", "vœux") + "</span><span>" + plural(l.reserved, "réservé", "réservés") + "</span>" +
        "<span>Créée le " + esc(fmtDate(l.createdAt)) + "</span><span>Activité le " + esc(fmtDate(l.lastActivity)) + "</span></div>" +
      '<div class="actions">' + themeSelect("theme-" + l.id, l.theme, "Thème de « " + l.name + " »") +
        '<button class="btn" data-a="reset" data-id="' + esc(l.id) + '">' + ICONS.key + "Nouveau mot de passe</button>" +
        '<button class="btn danger" data-a="delete" data-id="' + esc(l.id) + '">' + ICONS.trash + "Supprimer</button></div>" +
      extra + "</li>";
  }

  function listView() {
    const q = state.filter.trim().toLowerCase();
    const shown = q ? state.lists.filter((l) => l.name.toLowerCase().includes(q) || l.id.toLowerCase().includes(q)) : state.lists;
    const totalGifts = state.lists.reduce((s, l) => s + l.gifts, 0);
    return '<div class="hero"><span class="eyebrow">Administration</span><h1>Listom</h1>' +
      '<div class="summary"><span><b>' + state.lists.length + "</b> " + (state.lists.length > 1 ? "listes" : "liste") + "</span><span><b>" + totalGifts + "</b> " + (totalGifts > 1 ? "vœux" : "vœu") + " au total</span></div></div>" +
      invitesSection() + '<h2 class="section-title">Listes</h2>' +
      (state.lists.length > 5 ? '<div class="toolbar"><input class="field-input search" id="a-filter" type="search" placeholder="Rechercher une liste" value="' + esc(state.filter) + '" aria-label="Rechercher une liste"></div>' : "") +
      (state.lists.length
        ? (shown.length ? '<ul class="admin-list">' + shown.map(row).join("") + "</ul>" : '<p class="notice">Aucune liste ne correspond à cette recherche.</p>')
        : '<div class="empty"><h2>Aucune liste pour l\'instant</h2><p>Les listes créées avec un lien de création apparaîtront ici.</p></div>');
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

  // Theme menus: the one of the next creation link, and each list's own.
  app.addEventListener("change", async (e) => {
    const id = e.target.id || "";
    if (id === "a-invite-theme") { state.inviteTheme = e.target.value; return; }
    if (!id.startsWith("theme-")) return;
    const listId = id.slice(6), theme = e.target.value;
    const list = state.lists.find((l) => l.id === listId);
    try {
      await call("PUT", "/api/admin/lists/" + encodeURIComponent(listId) + "/theme", { theme });
      if (list) list.theme = theme;
      toast("Thème " + THEMES[theme].label + " appliqué à « " + (list ? list.name : "la liste") + " ».");
    } catch (err) { toast(err.message); render(); }
  });

  app.addEventListener("input", (e) => {
    if (e.target.id === "a-pw") state.pw = e.target.value;
    if (e.target.id === "a-filter") { state.filter = e.target.value; render(); }
    if (e.target.id === "a-invite-name") state.inviteName = e.target.value;
  });

  app.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (e.target.id === "invite") {
      if (state.inviteBusy) return;
      state.inviteBusy = true; render();
      try {
        const r = await call("POST", "/api/admin/invites", { name: state.inviteName.trim(), theme: state.inviteTheme });
        state.invites.unshift(r.invite); state.freshInvite = r.invite.token; state.inviteName = "";
        toast("Lien de création prêt : copiez-le et envoyez-le.");
      } catch (err) { toast(err.message); }
      state.inviteBusy = false; render();
      return;
    }
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
    else if (a === "copy-invite") copyText(inviteUrl(el.dataset.token), document.getElementById("inv-" + el.dataset.token));
    else if (a === "revoke") { state.revoking = el.dataset.token; render(); }
    else if (a === "revoke-cancel") { state.revoking = null; render(); }
    else if (a === "revoke-go") {
      const t = el.dataset.token;
      try { await call("DELETE", "/api/admin/invites/" + encodeURIComponent(t)); state.invites = state.invites.filter((i) => i.token !== t); toast("Lien révoqué."); }
      catch (err) { toast(err.message); }
      state.revoking = null; render();
    }
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
