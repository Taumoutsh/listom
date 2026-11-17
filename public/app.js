// A list page (/<id>): Mode Vœux for its owner, Mode Lutin for givers.
(function () {
  "use strict";

  const { LS, esc, richTitle, plainTitle, ICONS, LOGO, heroPicture, heroSrc, DEFAULTS, toast, copyText, myLists, route, href } = window.Listom;
  if (route.kind !== "list") return;
  const LIST_ID = route.id;
  const API = "/api/lists/" + encodeURIComponent(LIST_ID);

  /* ---------- Small helpers ---------- */
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
  const euro = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
  const fmtPrice = (p) => (typeof p === "number" && isFinite(p)) ? euro.format(p).replace(/,00\s?€/, " €") : "";
  const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const timeFmt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const fmtDate = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : dateFmt.format(d) + " à " + timeFmt.format(d); };
  const fmtShort = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(d); };
  const domainOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };
  const safeUrl = (url) => { try { const u = new URL(url); return (u.protocol === "http:" || u.protocol === "https:") ? u.href : ""; } catch (e) { return ""; } };

  const EMOJI_RULES = [
    [/livre|roman|\bbd\b|manga|bouquin/, "📚"], [/jeu video|console|switch|playstation|xbox|manette/, "🎮"],
    [/lego|puzzle|jeu de societe|jeu|carte/, "🧩"], [/casque|ecouteur|enceinte|musique|vinyle|platine/, "🎧"],
    [/montre/, "⌚"], [/parfum|creme|soin|beaute|maquillage/, "🌸"], [/chaussure|basket|sneaker|botte/, "👟"],
    [/pull|t-shirt|tee|robe|chemise|veste|manteau|vetement|echarpe|bonnet/, "🧣"], [/sac|valise/, "👜"],
    [/bijou|collier|bague|bracelet|boucle/, "💍"], [/cafe|the\b|tasse|mug|theiere/, "☕"],
    [/cuisine|casserole|poele|couteau|robot|four/, "🍳"], [/vin|champagne|whisky|biere/, "🍷"], [/chocolat|bonbon|gateau/, "🍫"],
    [/plante|fleur|jardin/, "🪴"], [/velo|trottinette/, "🚲"], [/voyage|week-end|weekend|sejour|vol\b/, "✈️"],
    [/photo|appareil|camera|objectif/, "📷"], [/telephone|smartphone|iphone/, "📱"], [/ordinateur|laptop|clavier|souris|ecran|tablette/, "💻"],
    [/peluche|doudou|poupee/, "🧸"], [/ballon|sport|yoga|raquette|fitness|running/, "⚽"], [/outil|perceuse|tournevis/, "🔧"],
    [/bougie|deco|lampe/, "🕯️"], [/peinture|dessin|art|crayon|feutre/, "🎨"], [/film|cinema|serie|abonnement/, "🎬"],
    [/concert|billet|place|spectacle|theatre/, "🎟️"], [/massage|spa|bien-etre/, "💆"], [/restaurant|diner|repas/, "🍽️"]
  ];
  const EMOJI_CHOICES = ["🎁", "📚", "🎮", "🧩", "🎧", "⌚", "🌸", "👟", "🧣", "💍", "☕", "🍳", "🍷", "🪴", "✈️", "📷", "💻", "🧸", "🎨", "🎟️"];
  const guessEmoji = (title) => { const t = norm(title); for (const [re, e] of EMOJI_RULES) if (re.test(t)) return e; return "🎁"; };


  /* ---------- State ---------- */
  const state = {
    // The address decides: /<id> is for givers, /<id>/edit for the owner.
    mode: route.edit ? "voeux" : "lutin",
    filter: LS.get("listom.filter", "all"),
    lutinName: LS.get("listom.lutinName", ""),
    unlocked: false,                              // Mode Vœux session (server cookie)
    pwDraft: "", pwErr: "", pwBusy: false,
    loaded: false, fatal: "", notFound: false,
    list: { name: "", welcomeTitle: DEFAULTS.welcomeTitle, welcomeSubtitle: DEFAULTS.welcomeSubtitle, heroUpload: null },
    gifts: [], reservations: [],
    canWrite: true,
    open: null,          // { id, kind: "reserve" | "release" }
    draftName: "",
    histOpen: new Set(),
    preview: false       // Mode Vœux: show the list as givers see it, reservations left out
  };

  /* ---------- Derived data ---------- */
  const sortedGifts = () => [...state.gifts].sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  const historyOf = (gid) => state.reservations.filter((r) => r.giftId === gid).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const currentOf = (gid) => { const h = historyOf(gid); const last = h[h.length - 1]; return last && last.action !== "release" ? last : null; };

  /* ---------- Server API ----------
     Every error the server returns carries a French message, shown as is in
     a toast. A 401 means the Mode Vœux session has expired (or the password
     was regenerated on another device). */
  const api = (method, path, body) => window.Listom.api(method, API + path, body, (url) => {
    if (state.unlocked && !url.endsWith("/login")) { state.unlocked = false; closeEditor(); closeSettings(); render(); }
  });

  async function loadList() {
    let d;
    try { d = await api("GET", ""); }
    catch (e) { if (e.status === 404) { state.notFound = true; return; } throw e; }
    state.list = d.list;
    state.gifts = Array.isArray(d.gifts) ? d.gifts : [];
    document.title = plainTitle(state.list.name) + " · Listom";
  }
  // Reservations are only ever fetched in Mode Lutin, so the list owner's
  // browser never even downloads who gives what.
  async function loadReservations() {
    if (state.mode !== "lutin" || state.notFound) { state.reservations = []; return; }
    const d = await api("GET", "/reservations");
    state.reservations = Array.isArray(d.reservations) ? d.reservations : [];
  }

  let refreshing = null;
  function refresh(scopes) {
    const all = !scopes || !scopes.length;
    const wantList = all || scopes.some((s) => s === "gifts" || s === "settings");
    const wantRes = all || scopes.includes("reservations");
    refreshing = Promise.resolve(refreshing).then(async () => {
      try {
        await Promise.all([wantList ? loadList() : null, wantRes ? loadReservations() : null]);
        state.fatal = "";
      } catch (e) { /* offline for now: the next event or reconnection retries */ }
      render();
    });
    return refreshing;
  }

  // Live updates: the server pushes a short "change" event whenever someone
  // edits the list or reserves a gift; the page then reloads that part.
  let events = null;
  function connectEvents() {
    if (state.notFound) return;
    if (!window.EventSource) { setInterval(() => refresh(), 20000); return; }
    let opened = false;
    events = new EventSource(API + "/events");
    events.addEventListener("change", (e) => {
      let d = {}; try { d = JSON.parse(e.data); } catch (x) {}
      if (d.scope === "deleted") { listGone(); return; }
      refresh(d.scope ? [d.scope] : null);
    });
    // The browser reconnects by itself after a network cut; once back, reload
    // the list quietly to catch up on what changed meanwhile.
    events.addEventListener("open", () => { if (opened) refresh(); opened = true; });
  }

  function listGone() {
    state.notFound = true;
    if (events) events.close();
    myLists.remove(LIST_ID);
    closeEditor(); closeSettings();
    render();
  }

  async function init() {
    try { const s = await api("GET", "/session"); state.unlocked = !!(s && s.voeux); } catch (e) { state.unlocked = false; }
    try { await loadList(); await loadReservations(); }
    catch (e) { state.fatal = e.message || "La liste n'a pas pu être chargée. Rechargez la page."; }
    state.loaded = true;
    if (state.notFound) myLists.remove(LIST_ID);
    else if (state.unlocked) myLists.add({ id: LIST_ID, name: state.list.name });
    render();
    connectEvents();
  }

  const giftPath = (id) => "/gifts/" + encodeURIComponent(id);
  const backend = {
    addGift: (d) => api("POST", "/gifts", d).then(loadList),
    setGift: (id, d) => api("PUT", giftPath(id), d).then(loadList),
    deleteGift: (id) => api("DELETE", giftPath(id)).then(loadList),
    addReservation: (d) => api("POST", giftPath(d.giftId) + "/reservations", { action: d.action, name: d.name }).then(loadReservations),
    saveSettings: (d) => api("PUT", "/settings", d).then((r) => { state.list = r.list; myLists.rename(LIST_ID, r.list.name); document.title = plainTitle(r.list.name) + " · Listom"; }),
    newPassword: () => api("POST", "/password")
  };

  async function run(promiseFn, okMsg) {
    try { await promiseFn(); if (okMsg) toast(okMsg); render(); return true; }
    catch (e) { toast((e && e.message) || "L'opération a échoué. Réessayez."); return false; }
  }

  function gate() {
    return '<div class="gate"><span class="gate-ico">' + ICONS.lock + "</span>" +
      '<span class="eyebrow">Mode Vœux</span><h1>Cette liste est protégée</h1>' +
      "<p>Entrez le mot de passe reçu à la création de la liste. Il sera retenu sur cet appareil.</p>" +
      '<form class="gate-form" data-form="unlock" novalidate>' +
        '<label for="pw" class="sr">Mot de passe</label>' +
        '<input class="field-input" id="pw" type="password" autocomplete="current-password" placeholder="Mot de passe" value="' + esc(state.pwDraft) + '">' +
        '<button class="btn primary" type="submit"' + (state.pwBusy ? " disabled" : "") + ">Déverrouiller</button>" +
      "</form>" +
      (state.pwErr ? '<p class="err" role="alert">' + esc(state.pwErr) + "</p>" : "") +
      '<a class="btn ghost" href="' + href.list(LIST_ID) + '">Je veux plutôt offrir un cadeau</a>' +
      '<p class="fine">Mot de passe perdu ? L\'administrateur du site peut en générer un nouveau.</p></div>';
  }

  /* ---------- Rendering ---------- */
  const app = document.getElementById("app");

  function picBlock(g, extra) {
    const src = g.imageUpload ? "/uploads/" + encodeURIComponent(g.imageUpload) : safeUrl(g.imageUrl || "");
    return '<div class="pic t' + (hash(g.id || g.title || "x") % 6 + 1) + '">' +
      '<span class="pic-emoji" aria-hidden="true">' + esc(g.emoji || guessEmoji(g.title)) + "</span>" +
      (src ? '<img src="' + esc(src) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : "") +
      (extra || "") + "</div>";
  }

  // The list's welcome header, shown above the gifts on the givers' page.
  function listHeader() {
    const l = state.list;
    // The list's name on a gift tag, the same shape as the price tags of the cards.
    return '<header class="hero list-header"><div class="list-tag"><p class="list-name">' + esc(l.name) + "</p></div>" +
      '<div class="onboard-hero">' + heroPicture(heroSrc(l.heroUpload)) + "<h1>" + richTitle(l.welcomeTitle) + "</h1></div>" +
      '<p class="lead">' + esc(l.welcomeSubtitle) + "</p></header>";
  }

  function notFoundPage() {
    return '<div class="gate"><span class="gate-ico">' + ICONS.gift + "</span>" +
      '<span class="eyebrow">Listom</span><h1>Liste introuvable</h1>' +
      "<p>Cette liste n'existe pas ou a été supprimée. Vérifiez le lien que vous avez reçu.</p>" +
      '<a class="btn primary" href="/">Retour à l\'accueil</a></div>';
  }

  function topbar() {
    return '<div class="topbar"><div class="brand">' + LOGO + "Listom</div>" +
      (state.mode === "voeux" ? '<span class="mode-tag">' + ICONS.gift + "Mode Vœux</span>" : "") + "</div>";
  }

  // Preview (Mode Vœux): a reminder above the page, with the way back.
  function previewBar() {
    return '<div class="preview-bar" role="status">' + ICONS.eye +
      "<p><b>Aperçu.</b> Voici la page que voient vos proches. Les réservations restent cachées : la surprise est préservée.</p>" +
      '<button class="btn primary" data-action="preview-exit">Quitter l\'aperçu</button></div>';
  }

  function hero(gifts) {
    if (state.mode === "lutin" || state.preview) {   // givers: the list's header, then the gifts (no counters)
      return listHeader() + (window.ListomGarland ? window.ListomGarland() : "") + '<h2 class="hotte-title">À mettre dans la hotte</h2>';
    }
    const total = gifts.reduce((s, g) => s + (typeof g.price === "number" ? g.price : 0), 0);
    const parts = ["<span><b>" + gifts.length + "</b> " + (gifts.length > 1 ? "vœux" : "vœu") + "</span>"];
    if (total > 0) parts.push("<span>Total <b>" + esc(fmtPrice(total)) + "</b></span>");
    return '<div class="hero"><span class="eyebrow">Mode Vœux · votre liste</span>' +
      '<div class="list-title"><h1>' + esc(state.list.name) + "</h1></div>" + '<div class="summary">' + parts.join("") + "</div></div>";
  }

  function toolbar(gifts) {
    if (state.preview) {   // same chips as givers, inert, every gift shown as available
      return '<div class="toolbar"><div class="chips" aria-hidden="true">' +
        [["Tous", gifts.length, true], ["À offrir", gifts.length, false], ["Réservés", 0, false]]
          .map(([l, n, on]) => '<span class="chip" aria-pressed="' + on + '">' + l + " · " + n + "</span>").join("") + "</div></div>";
    }
    if (state.mode === "voeux") {
      return '<div class="toolbar">' +
        '<button class="btn icon-btn" data-action="settings" aria-label="Paramètres de la liste" title="Paramètres de la liste">' + ICONS.gear + "</button>" +
        // On phones these two shrink to icons, like the gear.
        '<button class="btn ghost icon-on-mobile" data-action="preview" aria-label="Aperçu" title="Aperçu">' + ICONS.eye + '<span class="btn-label">Aperçu</span></button>' +
        '<button class="btn ghost icon-on-mobile" data-action="lock" aria-label="Verrouiller" title="Verrouiller">' + ICONS.lock + '<span class="btn-label">Verrouiller</span></button>' +
        '<button class="btn primary push" data-action="new">' + ICONS.plus + "Ajouter un vœu</button></div>";
    }
    const free = gifts.filter((g) => !currentOf(g.id)).length;
    const chips = [["all", "Tous", gifts.length], ["free", "À offrir", free], ["taken", "Réservés", gifts.length - free]];
    return '<div class="toolbar"><div class="chips" role="group" aria-label="Filtrer">' +
      chips.map(([k, l, n]) => '<button class="chip" data-action="filter" data-filter="' + k + '" aria-pressed="' + (state.filter === k) + '">' + l + " · " + n + "</button>").join("") +
      "</div>" + (state.lutinName ? '<span class="fine">Vous réservez en tant que <b>' + esc(state.lutinName) + "</b></span>" : "") + "</div>";
  }

  function historyBlock(g) {
    const h = historyOf(g.id);
    if (!h.length) return "";
    const items = h.slice().reverse().map((r, i) => {
      const label = r.action === "release"
        ? "Réservation annulée" + (r.name ? " par <b>" + esc(r.name) + "</b>" : "")
        : "Réservé par <b>" + esc(r.name) + "</b>";
      return '<li class="' + (i === 0 && r.action !== "release" ? "now" : "") + '">' + label + '<time datetime="' + esc(r.at) + '">' + esc(fmtDate(r.at)) + "</time></li>";
    }).join("");
    return '<details class="hist" data-hist="' + esc(g.id) + '"' + (state.histOpen.has(g.id) ? " open" : "") + "><summary>Historique · " + h.length + "</summary><ol class=\"timeline\">" + items + "</ol></details>";
  }

  function lutinFoot(g, cur) {
    const open = state.open && state.open.id === g.id ? state.open.kind : null;
    let html = "";
    if (open === "reserve") {
      html += '<form class="inline-form" data-form="reserve" data-id="' + esc(g.id) + '">' +
        '<label for="rn-' + esc(g.id) + '">' + (cur ? "Nouveau nom" : "Votre nom") + "</label>" +
        '<input class="field-input" id="rn-' + esc(g.id) + '" maxlength="60" autocomplete="name" placeholder="Prénom Nom" value="' + esc(state.draftName) + '" required>' +
        '<div class="actions"><button class="btn ghost" type="button" data-action="close-inline">Annuler</button><button class="btn primary" type="submit">Enregistrer</button></div></form>';
    } else if (open === "release") {
      html += '<div class="inline-form"><p class="confirm-text">Libérer ce cadeau ? Il redeviendra disponible pour les autres lutins. L\'historique est conservé.</p>' +
        '<div class="actions"><button class="btn ghost" data-action="close-inline">Non</button><button class="btn primary" data-action="confirm-release" data-id="' + esc(g.id) + '">Oui, libérer</button></div></div>';
    } else if (cur) {
      html += '<div class="row"><span class="pill taken">Réservé</span><span class="who">par <b>' + esc(cur.name) + "</b> · " + esc(fmtShort(cur.at)) + "</span></div>";
      if (state.canWrite) html += '<div class="actions"><button class="btn" data-action="reserve" data-id="' + esc(g.id) + '">Modifier</button><button class="btn ghost" data-action="release" data-id="' + esc(g.id) + '">Libérer</button></div>';
    } else {
      html += '<div class="row"><span class="pill free">Disponible</span>' +
        (state.canWrite ? '<button class="btn primary" data-action="reserve" data-id="' + esc(g.id) + '">' + ICONS.gift + "Je l'offre</button>" : "") + "</div>";
    }
    return html + historyBlock(g);
  }

  // In the preview every gift looks available, and its button does nothing.
  function previewFoot() {
    return '<div class="row"><span class="pill free">Disponible</span><span class="btn primary inert" aria-hidden="true">' + ICONS.gift + "Je l'offre</span></div>";
  }

  // Mode Vœux never shows reservations: the list owner keeps the surprise.
  function voeuxFoot(g) {
    return state.canWrite ? '<div class="actions"><button class="btn" data-action="edit" data-id="' + esc(g.id) + '">' + ICONS.pen + "Modifier</button></div>" : "";
  }

  function card(g) {
    const isL = state.mode === "lutin" || state.preview;
    const cur = state.mode === "lutin" ? currentOf(g.id) : null;   // never in Mode Vœux, preview included
    const price = fmtPrice(g.price);
    const link = safeUrl(g.link || "");
    const extra = (price ? '<span class="tag">' + esc(price) + "</span>" : "") + (cur ? '<span class="ribbon">Réservé</span>' : "");
    const pic = isL && link
      ? '<a class="pic-link" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer" aria-label="Voir « ' + esc(g.title) + ' » sur ' + esc(domainOf(link)) + '">' + picBlock(g, extra) + "</a>"
      : picBlock(g, extra);
    return '<article class="card' + (cur ? " taken" : "") + '">' + pic +
      '<div class="body"><h3>' + esc(g.title) + "</h3>" +
      (g.description ? '<p class="desc">' + esc(g.description) + "</p>" : "") +
      (link ? '<a class="link" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">' + ICONS.ext + "<span>" + esc(domainOf(link)) + "</span></a>" : "") +
      '<div class="foot">' + (state.preview ? previewFoot() : isL ? lutinFoot(g, cur) : voeuxFoot(g)) + "</div></div></article>";
  }

  function emptyState() {
    if (state.mode === "voeux" && !state.preview) {
      return '<div class="empty"><span class="big" aria-hidden="true">🎁</span><h2>Votre liste est vide</h2>' +
        "<p>Ajoutez un premier vœu : un titre suffit. Un lien, un prix et une image aident vos proches à trouver le bon cadeau.</p>" +
        (state.canWrite ? '<button class="btn primary" data-action="new">' + ICONS.plus + "Ajouter un vœu</button>" : "") + "</div>";
    }
    return '<div class="empty"><span class="big" aria-hidden="true">🧝</span><h2>Aucun vœu pour l\'instant</h2>' +
      "<p>La liste n'a pas encore de cadeaux. Revenez un peu plus tard : elle se met à jour toute seule.</p></div>";
  }

  function render() {
    // Keep focus and caret across re-renders triggered by live updates.
    const ae = document.activeElement;
    const focusId = ae && ae.id && app.contains(ae) ? ae.id : null;
    const sel = focusId && "selectionStart" in ae ? [ae.selectionStart, ae.selectionEnd] : null;

    if (!state.loaded) {
      app.innerHTML = '<div class="hero" style="padding-block:20vh"><span class="eyebrow">Listom</span><h1>Ouverture de la liste…</h1></div>';
      return;
    }
    if (state.notFound) { app.innerHTML = notFoundPage(); return; }

    let html = topbar();
    if (state.mode === "voeux" && !state.unlocked) {
      app.innerHTML = html + gate();
      const pw = document.getElementById("pw");
      if (pw && (focusId === "pw" || !focusId)) pw.focus({ preventScroll: true });
      return;
    }
    const gifts = sortedGifts();
    if (state.preview) html += previewBar();
    html += hero(gifts);
    if (state.fatal) html += '<p class="notice">' + esc(state.fatal) + "</p>";
    html += toolbar(gifts);

    let shown = gifts;
    if (state.mode === "lutin" && state.filter === "free") shown = gifts.filter((g) => !currentOf(g.id));
    if (state.mode === "lutin" && state.filter === "taken") shown = gifts.filter((g) => currentOf(g.id));
    if (!gifts.length) html += emptyState();
    else if (!shown.length) html += '<div class="empty"><h2>' + (state.filter === "free" ? "Tout est réservé" : "Rien de réservé pour l'instant") + "</h2><p>" + (state.filter === "free" ? "Tous les cadeaux ont trouvé leur lutin." : "Soyez le premier à choisir un cadeau.") + "</p></div>";
    else html += '<div class="grid">' + shown.map(card).join("") + "</div>";

    app.innerHTML = html;
    app.classList.toggle("form-open", !!(state.open && state.open.kind === "reserve"));
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el) { el.focus({ preventScroll: true }); if (sel && el.setSelectionRange) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) {} }
    }
  }

  // Images that fail to load reveal the emoji underneath.
  document.addEventListener("error", (e) => { const t = e.target; if (t && t.tagName === "IMG" && t.closest(".pic")) t.remove(); }, true);

  /* ---------- Events ---------- */
  app.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el || el.tagName === "INPUT") return;
    const a = el.dataset.action, id = el.dataset.id;
    if (a === "preview") { state.preview = true; render(); window.scrollTo(0, 0); }
    else if (a === "preview-exit") { state.preview = false; render(); window.scrollTo(0, 0); }
    else if (a === "filter") { state.filter = el.dataset.filter; LS.set("listom.filter", state.filter); render(); }
    else if (a === "new") openEditor(null);
    else if (a === "edit") openEditor(state.gifts.find((g) => g.id === id) || null);
    else if (a === "reserve") {
      const cur = currentOf(id);
      state.open = { id, kind: "reserve" }; state.draftName = cur ? cur.name : state.lutinName; render();
      const inp = document.getElementById("rn-" + id);
      if (inp) { inp.focus(); inp.select(); revealField(inp); }
    }
    else if (a === "release") { state.open = { id, kind: "release" }; render(); }
    else if (a === "close-inline") { state.open = null; render(); }
    else if (a === "confirm-release") {
      run(() => backend.addReservation({ giftId: id, action: "release", name: state.lutinName || "", at: new Date().toISOString() }), "Cadeau libéré.")
        .then((ok) => { if (ok) { state.open = null; render(); } });
    }
    else if (a === "settings") openSettings();
    else if (a === "lock") {
      api("POST", "/logout").catch(() => {}).then(() => {
        state.unlocked = false; state.pwDraft = ""; state.pwErr = ""; render(); toast("Mode Vœux verrouillé.");
      });
    }
  });

  // On phones, scroll so the BOTTOM of the name form (input + Save button)
  // sits just above the keyboard. When the browser reports the keyboard
  // (visualViewport shrinks), use its real top edge; inside an embedded frame
  // it often doesn't, so fall back to the usual phone keyboard height (the
  // keyboard and its suggestion bar cover about the lower 45% of the screen).
  // The shell gets extra bottom room while the form is open, so even the last
  // card of the list can scroll up that far.
  const KEYBOARD_SHARE = 0.45, GAP = 12;
  function keyboardTop() {
    const vv = window.visualViewport, h = window.innerHeight;
    if (vv && vv.height < h - 120) return vv.offsetTop + vv.height;      // keyboard measured
    if (window.matchMedia && matchMedia("(pointer: coarse)").matches) return h * (1 - KEYBOARD_SHARE);
    return h;                                                             // desktop: no keyboard
  }
  function revealField(inp) {
    const form = inp.closest(".inline-form") || inp;
    const go = () => {
      if (document.activeElement !== inp) return;
      const r = form.getBoundingClientRect(), limit = keyboardTop() - GAP;
      let delta = 0;
      if (r.bottom > limit) delta = r.bottom - limit;     // hidden by the keyboard: scroll up just enough
      else if (r.top < GAP) delta = r.top - GAP;          // above the screen: scroll down just enough
      if (r.top - delta < GAP) delta = r.top - GAP;       // never push the field off the top
      if (Math.abs(delta) > 2) window.scrollBy(0, delta);
    };
    requestAnimationFrame(go);
    [120, 350, 700].forEach((t) => setTimeout(go, t));
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", go);
      setTimeout(() => vv.removeEventListener("resize", go), 1500);
    }
  }
  app.addEventListener("input", (e) => {
    if (e.target.id && e.target.id.startsWith("rn-")) state.draftName = e.target.value;
    if (e.target.id === "pw") state.pwDraft = e.target.value;
  });
  app.addEventListener("toggle", (e) => {
    const d = e.target; if (d.dataset && d.dataset.hist) { d.open ? state.histOpen.add(d.dataset.hist) : state.histOpen.delete(d.dataset.hist); }
  }, true);
  app.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.dataset.form === "unlock") {
      if (state.pwBusy) return;
      if (!state.pwDraft) { state.pwErr = "Saisissez le mot de passe."; render(); return; }
      state.pwBusy = true; state.pwErr = ""; render();
      api("POST", "/login", { password: state.pwDraft }).then(() => {
        state.pwBusy = false; state.unlocked = true; state.pwDraft = ""; render(); toast("Bienvenue dans votre liste.");
        myLists.add({ id: LIST_ID, name: state.list.name });
      }).catch((err) => {
        state.pwBusy = false; state.pwDraft = "";
        state.pwErr = err.status === 401 ? "Mot de passe incorrect. Vérifiez-le et réessayez." : err.message;
        render();
      });
      return;
    }
    if (f.dataset.form === "reserve") {
      const id = f.dataset.id, name = state.draftName.trim();
      if (!name) { const i = document.getElementById("rn-" + id); if (i) i.focus(); toast("Indiquez votre nom pour réserver."); return; }
      const cur = currentOf(id);
      if (cur && cur.name === name) { state.open = null; render(); return; }
      state.lutinName = name; LS.set("listom.lutinName", name);
      run(() => backend.addReservation({ giftId: id, action: "reserve", name, at: new Date().toISOString() }), cur ? "Réservation modifiée." : "C'est noté, ce cadeau est pour vous !")
        .then((ok) => { if (ok) { state.open = null; render(); } });
    }
  });
  app.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.preview) { state.preview = false; render(); }
    if (e.key === "Escape" && state.open) { state.open = null; render(); }
  });

  /* ---------- Editor modal ---------- */
  const modalRoot = document.getElementById("modal-root");
  let draft = null, lastFocus = null;

  function openEditor(gift) {
    lastFocus = document.activeElement;
    draft = gift
      ? { id: gift.id, title: gift.title || "", description: gift.description || "", link: gift.link || "", price: typeof gift.price === "number" ? String(gift.price).replace(".", ",") : "", imageUrl: gift.imageUrl || "", imageUpload: gift.imageUpload || null, emoji: gift.emoji || "", confirmDelete: false, busy: false, err: "" }
      : { id: null, title: "", description: "", link: "", price: "", imageUrl: "", imageUpload: null, emoji: "", confirmDelete: false, busy: false, err: "" };
    draft.lookup = "";        // "" | "busy" | "found" | "none": fetching the image of the gift's link
    // Freeze the sheet's height at opening: it must not follow the browser
    // bars or the keyboard as they show and hide.
    draft.sheetMax = Math.round(window.innerHeight * 0.92);
    draft.kb = Math.round(window.innerHeight * KEYBOARD_SHARE);   // room left for the keyboard
    draft.typing = false;
    document.documentElement.classList.add("modal-open");
    renderModal(true);
  }

  // Photos uploaded but never saved are removed by the server's daily cleanup.
  function closeEditor() {
    if (!draft) return;
    draft = null; modalRoot.innerHTML = "";
    document.documentElement.classList.remove("modal-open");
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) {}
  }

  function previewHtml() {
    const g = { id: draft.id || draft.title || "new", title: draft.title, emoji: draft.emoji || guessEmoji(draft.title), imageUpload: draft.imageUpload, imageUrl: draft.imageUrl };
    return picBlock(g);
  }

  // Ask the server for the picture of the gift's web page (og:image & co).
  // Runs when the link field is left with no image chosen yet, or on demand.
  async function lookupLinkImage(manual) {
    const d = draft; if (!d) return;
    const link = safeUrl(d.link.trim());
    if (!link) { if (manual) toast("Ajoutez d'abord un lien commençant par https://."); return; }
    d.lookup = "busy"; renderModal(false);
    try {
      const r = await api("POST", "/link-image", { url: link });
      if (draft !== d) return;
      if (safeUrl(d.link.trim()) === link && r && r.upload) { d.imageUpload = r.upload; d.imageUrl = ""; d.lookup = "found"; }
      else d.lookup = "";
    } catch (e) {
      if (draft !== d) return;
      d.lookup = "none";
    }
    renderModal(false);
  }

  function imageHint() {
    if (draft.lookup === "busy") return "Recherche de l'image du lien…";
    if (draft.lookup === "found") return "Image récupérée depuis le lien.";
    if (draft.lookup === "none") return "Aucune image trouvée sur ce lien. Sans image, cet emoji la remplace :";
    return "Sans image, cet emoji la remplace :";
  }

  function renderModal(first) {
    if (!draft) return;
    const auto = guessEmoji(draft.title);
    const chosen = draft.emoji || auto;
    const emojis = [auto, ...EMOJI_CHOICES.filter((x) => x !== auto)].slice(0, 20);
    const prev = document.getElementById("editor");
    const keepScroll = prev ? prev.scrollTop : 0;   // re-rendering must not jump back to the top
    const ae = document.activeElement;                // ...nor lose the field being typed in
    const keepFocus = !first && ae && ae.id && modalRoot.contains(ae) ? ae.id : null;
    const keepSel = keepFocus && "selectionStart" in ae ? [ae.selectionStart, ae.selectionEnd] : null;
    modalRoot.innerHTML =
      '<div class="overlay" data-m="backdrop"><form class="sheet' + (draft.typing ? " typing" : "") + '" role="dialog" aria-modal="true" aria-labelledby="m-title" id="editor" novalidate style="--sheet-max:' + draft.sheetMax + "px;--kb:" + draft.kb + 'px">' +
        '<div class="sheet-head"><h2 id="m-title">' + (draft.id ? "Modifier le vœu" : "Nouveau vœu") + '</h2><button type="button" class="btn ghost" data-m="close" aria-label="Fermer">' + ICONS.close + "</button></div>" +
        '<div class="fields">' +
          '<div class="field full"><label for="f-title">Titre</label><input class="field-input" id="f-title" maxlength="120" required placeholder="Ex. Casque audio sans fil" value="' + esc(draft.title) + '"></div>' +
          '<div class="field full"><label for="f-desc">Description</label><textarea class="field-input" id="f-desc" maxlength="600" placeholder="Couleur, taille, modèle précis…">' + esc(draft.description) + "</textarea></div>" +
          '<div class="field"><label for="f-link">Lien</label><input class="field-input" id="f-link" type="url" inputmode="url" placeholder="https://…" value="' + esc(draft.link) + '"></div>' +
          '<div class="field"><label for="f-price">Prix</label><div class="price-wrap"><input class="field-input" id="f-price" inputmode="decimal" placeholder="49,90" value="' + esc(draft.price) + '"><span>€</span></div></div>' +
          '<div class="field full"><label for="f-img">Image</label>' +
            '<div class="visual"><div id="m-preview">' + previewHtml() + '</div><div class="visual-ctrl">' +
              '<input class="field-input" id="f-img" type="url" inputmode="url" placeholder="Adresse de l\'image (https://…)" value="' + esc(draft.imageUrl) + '"' + (draft.imageUpload ? " disabled" : "") + ">" +
              '<div class="row"><label class="btn upload" for="f-file">' + (draft.imageUpload ? "Changer l'image" : "Téléverser une photo") + '<input type="file" id="f-file" accept="image/png,image/jpeg,image/webp,image/gif"></label>' +
                (draft.imageUpload ? '<button type="button" class="btn ghost" data-m="rm-upload">Retirer</button>'
                  : (safeUrl(draft.link.trim()) ? '<button type="button" class="btn ghost" data-m="lookup"' + (draft.lookup === "busy" ? " disabled" : "") + ">Image du lien</button>" : "")) + "</div>" +
              '<span class="hint" aria-live="polite">' + esc(imageHint()) + "</span>" +
              '<div class="emojis" role="group" aria-label="Emoji">' + emojis.map((x) => '<button type="button" data-m="emoji" data-e="' + esc(x) + '" aria-pressed="' + (x === chosen) + '">' + x + "</button>").join("") + "</div>" +
            "</div></div></div>" +
        "</div>" +
        (draft.err ? '<p class="err">' + esc(draft.err) + "</p>" : "") +
        (draft.confirmDelete
          ? '<div class="inline-form"><p class="confirm-text">Supprimer « ' + esc(draft.title) + " » ? Ses réservations seront aussi effacées.</p><div class=\"actions\"><button type=\"button\" class=\"btn ghost\" data-m=\"no-del\">Garder</button><button type=\"button\" class=\"btn primary\" data-m=\"yes-del\">Supprimer</button></div></div>"
          : '<div class="sheet-actions">' + (draft.id ? '<button type="button" class="btn danger" data-m="del">Supprimer</button>' : "") +
            '<div class="right"><button type="button" class="btn" data-m="close">Annuler</button><button type="submit" class="btn primary"' + (draft.busy ? " disabled" : "") + ">" + (draft.busy ? "Enregistrement…" : "Enregistrer") + "</button></div></div>") +
      "</form></div>";
    const sheet = document.getElementById("editor");
    if (sheet && keepScroll) sheet.scrollTop = keepScroll;
    if (keepFocus) {
      const el = document.getElementById(keepFocus);
      if (el && !el.disabled) { el.focus({ preventScroll: true }); if (keepSel && el.setSelectionRange) try { el.setSelectionRange(keepSel[0], keepSel[1]); } catch (e) {} }
    }
    if (first) { const t = document.getElementById("f-title"); if (t) t.focus({ preventScroll: true }); }
  }

  function refreshPreview() {
    const p = document.getElementById("m-preview"); if (p) p.innerHTML = previewHtml();
    const auto = guessEmoji(draft.title);
    const first = modalRoot.querySelector(".emojis button");
    if (first && !draft.emoji && first.dataset.e !== auto) { // keep the auto-guess first in the picker
      const ae = document.activeElement && document.activeElement.id; const pos = ae ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
      renderModal(false);
      if (ae) { const el = document.getElementById(ae); if (el) { el.focus(); try { el.setSelectionRange(pos[0], pos[1]); } catch (e) {} } }
    }
  }

  modalRoot.addEventListener("input", (e) => {
    if (!draft) return;
    const id = e.target.id;
    if (id === "f-title") { draft.title = e.target.value; refreshPreview(); }
    else if (id === "f-desc") draft.description = e.target.value;
    else if (id === "f-link") draft.link = e.target.value;
    else if (id === "f-price") draft.price = e.target.value;
    else if (id === "f-img") { draft.imageUrl = e.target.value; clearTimeout(draft.t); draft.t = setTimeout(refreshPreview, 400); }
  });

  modalRoot.addEventListener("change", async (e) => {
    if (!draft) return;
    // Leaving the link field with no image yet: fetch the picture of that page.
    if (e.target.id === "f-link") {
      if (!draft.imageUpload && !draft.imageUrl.trim() && safeUrl(draft.link.trim())) lookupLinkImage(false);
      else renderModal(false);   // show or hide the "Image du lien" button
      return;
    }
    if (e.target.id !== "f-file" || !e.target.files[0]) return;
    const file = e.target.files[0];
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) { toast("Format non pris en charge : utilisez une image PNG, JPEG, WebP ou GIF."); return; }
    if (file.size > 8 * 1024 * 1024) { toast("Photo trop lourde : 8 Mo maximum."); return; }
    const d = draft;
    try {
      toast("Envoi de la photo…");
      const res = await api("POST", "/uploads", file);
      if (draft !== d) return;
      d.imageUpload = res.upload; d.imageUrl = ""; d.lookup = ""; renderModal(false); toast("Photo ajoutée.");
    } catch (err) {
      toast(err.message || "La photo n'a pas pu être envoyée. Réessayez.");
    }
  });

  modalRoot.addEventListener("click", (e) => {
    if (!draft) return;
    if (e.target.dataset && e.target.dataset.m === "backdrop") { closeEditor(); return; }
    const el = e.target.closest("[data-m]"); if (!el) return;
    const m = el.dataset.m;
    if (m === "close") closeEditor();
    else if (m === "emoji") { draft.emoji = el.dataset.e === guessEmoji(draft.title) ? "" : el.dataset.e; renderModal(false); }
    else if (m === "rm-upload") { draft.imageUpload = null; draft.lookup = ""; renderModal(false); }
    else if (m === "lookup") lookupLinkImage(true);
    else if (m === "del") { draft.confirmDelete = true; renderModal(false); }
    else if (m === "no-del") { draft.confirmDelete = false; renderModal(false); }
    else if (m === "yes-del") {
      const id = draft.id;
      run(() => backend.deleteGift(id), "Vœu supprimé.").then((ok) => { if (ok) closeEditor(); });
    }
  });

  modalRoot.addEventListener("keydown", (e) => { if (e.key === "Escape" && draft) { e.preventDefault(); closeEditor(); } });

  // Phone keyboard inside a sheet (gift editor or settings): give the sheet
  // room below its content, then scroll the sheet (not the page) so the
  // focused field sits just above the keyboard, using the same keyboard
  // estimate as the Lutin name field.
  const isTouch = () => !!(window.matchMedia && matchMedia("(pointer: coarse)").matches);
  const isTextField = (el) => el && el.matches && el.matches("input:not([type=file]):not([type=checkbox]), textarea");
  modalRoot.addEventListener("focusin", (e) => {
    const sheet = e.target.closest && e.target.closest(".sheet");
    if (!sheet || !isTouch() || !isTextField(e.target)) return;
    sheet.classList.add("typing");
    if (draft) draft.typing = true;
    const input = e.target, field = input.closest(".field") || input, sheetId = sheet.id;
    const fit = () => {
      const s = document.getElementById(sheetId);
      if (!s || document.activeElement !== input) return;
      const r = field.getBoundingClientRect(), top = s.getBoundingClientRect().top + GAP, limit = keyboardTop() - GAP;
      if (r.bottom > limit) s.scrollTop += Math.min(r.bottom - limit, r.top - top);
      else if (r.top < top) s.scrollTop -= top - r.top;
    };
    requestAnimationFrame(fit);
    [150, 400, 700].forEach((t) => setTimeout(fit, t));
  });
  modalRoot.addEventListener("focusout", () => {
    setTimeout(() => {
      const sheet = modalRoot.querySelector(".sheet.typing");
      if (!sheet) return;
      const a = document.activeElement;
      if (sheet.contains(a) && isTextField(a)) return;   // moved to another field: keep the room
      sheet.classList.remove("typing");
      if (draft) draft.typing = false;
    }, 80);
  });

  modalRoot.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!draft || draft.busy) return;
    const title = draft.title.trim();
    if (!title) { draft.err = "Donnez un titre à votre vœu."; renderModal(false); document.getElementById("f-title").focus(); return; }
    const link = draft.link.trim();
    if (link && !safeUrl(link)) { draft.err = "Le lien doit commencer par https:// ou http://."; renderModal(false); document.getElementById("f-link").focus(); return; }
    const img = draft.imageUrl.trim();
    if (img && !draft.imageUpload && !safeUrl(img)) { draft.err = "L'adresse de l'image doit commencer par https://."; renderModal(false); document.getElementById("f-img").focus(); return; }
    let price = null;
    if (draft.price.trim()) {
      price = Number(draft.price.replace(/\s/g, "").replace(",", ".").replace("€", ""));
      if (!isFinite(price) || price < 0) { draft.err = "Le prix doit être un nombre, par exemple 49,90."; renderModal(false); document.getElementById("f-price").focus(); return; }
      price = Math.round(price * 100) / 100;
    }
    const data = {
      title, description: draft.description.trim(), link: link ? safeUrl(link) : "", price,
      imageUrl: draft.imageUpload ? "" : (img ? safeUrl(img) : ""), imageUpload: draft.imageUpload || null,
      emoji: draft.emoji || guessEmoji(title)
    };
    draft.busy = true; draft.err = ""; renderModal(false);
    const isNew = !draft.id;
    const ok = await run(() => isNew ? backend.addGift(data) : backend.setGift(draft.id, data), isNew ? "Vœu ajouté." : "Vœu modifié.");
    if (!draft) return;
    if (ok) closeEditor();
    else { draft.busy = false; renderModal(false); }
  });

  /* ---------- Settings (gear, Mode Vœux) ----------
     Welcome page texts and picture, the list's link, and a new password. */
  let settings = null, settingsFocus = null;

  function openSettings() {
    if (draft) return;
    settingsFocus = document.activeElement;
    const l = state.list;
    settings = {
      name: l.name, welcomeTitle: l.welcomeTitle, welcomeSubtitle: l.welcomeSubtitle, heroUpload: l.heroUpload || null,
      busy: false, err: "", confirmRegen: false, regenBusy: false, newPassword: "",
      sheetMax: Math.round(window.innerHeight * 0.92), kb: Math.round(window.innerHeight * KEYBOARD_SHARE)
    };
    document.documentElement.classList.add("modal-open");
    renderSettings(true);
  }

  function closeSettings() {
    if (!settings) return;
    settings = null; modalRoot.innerHTML = "";
    document.documentElement.classList.remove("modal-open");
    if (settingsFocus && settingsFocus.focus) try { settingsFocus.focus(); } catch (e) {}
  }

  function listUrl() { return window.Listom.listUrl(LIST_ID); }
  function editUrl() { return window.Listom.editUrl(LIST_ID); }

  function renderSettings(first) {
    if (!settings) return;
    const st = settings;
    const prev = document.getElementById("settings");
    const keepScroll = prev ? prev.scrollTop : 0;
    const ae = document.activeElement;
    const keepFocus = !first && ae && ae.id && modalRoot.contains(ae) ? ae.id : null;
    const typing = prev && prev.classList.contains("typing");

    let pwBlock;
    if (st.newPassword) {
      pwBlock = '<div class="secret"><span class="secret-label">Nouveau mot de passe</span>' +
        '<div class="secret-row"><code id="s-pw">' + esc(st.newPassword) + '</code><button type="button" class="btn" data-s="copy-pw">' + ICONS.copy + "Copier</button></div>" +
        '<p class="fine">Notez-le maintenant : il ne sera plus affiché. Les autres appareils devront le saisir.</p></div>';
    } else if (st.confirmRegen) {
      pwBlock = '<div class="inline-form"><p class="confirm-text">Générer un nouveau mot de passe ? L\'ancien ne fonctionnera plus, et les autres appareils connectés en mode Vœux devront saisir le nouveau.</p>' +
        '<div class="actions"><button type="button" class="btn ghost" data-s="regen-cancel">Annuler</button><button type="button" class="btn primary" data-s="regen-go"' + (st.regenBusy ? " disabled" : "") + ">Générer</button></div></div>";
    } else {
      pwBlock = '<button type="button" class="btn" data-s="regen">' + ICONS.key + "Générer un nouveau mot de passe</button>";
    }

    modalRoot.innerHTML =
      '<div class="overlay" data-s="backdrop"><div class="sheet' + (typing ? " typing" : "") + '" role="dialog" aria-modal="true" aria-labelledby="s-head" id="settings" style="--sheet-max:' + st.sheetMax + "px;--kb:" + st.kb + 'px">' +
        '<div class="sheet-head"><h2 id="s-head">Paramètres</h2><button type="button" class="btn ghost" data-s="close" aria-label="Fermer">' + ICONS.close + "</button></div>" +
        '<form class="settings-form" data-s-form novalidate>' +
          '<h3 class="section-title">Page d\'accueil</h3>' +
          '<div class="fields">' +
            '<div class="field full"><label for="s-name">Nom de la liste</label><input class="field-input" id="s-name" maxlength="80" required value="' + esc(st.name) + '"></div>' +
            '<div class="field full"><label for="s-title">Titre d\'accueil</label><input class="field-input" id="s-title" maxlength="120" value="' + esc(st.welcomeTitle) + '">' +
              '<span class="hint">Entourez des mots d\'astérisques pour les colorer : Il y a aussi *les boules*…</span></div>' +
            '<div class="field full"><label for="s-sub">Sous-titre</label><textarea class="field-input" id="s-sub" maxlength="300">' + esc(st.welcomeSubtitle) + "</textarea></div>" +
            '<div class="field full"><span class="label">Image d\'accueil</span><div class="hero-pick">' + heroPicture(heroSrc(st.heroUpload)) +
              '<div class="actions"><label class="btn upload" for="s-file">Changer l\'image<input type="file" id="s-file" accept="image/png,image/jpeg,image/webp,image/gif"></label>' +
              (st.heroUpload ? '<button type="button" class="btn ghost" data-s="default-hero">Image par défaut</button>' : "") + "</div></div></div>" +
          "</div>" +
          (st.err ? '<p class="err">' + esc(st.err) + "</p>" : "") +
          '<div class="sheet-actions"><div class="right"><button type="button" class="btn" data-s="close">Annuler</button><button type="submit" class="btn primary"' + (st.busy ? " disabled" : "") + ">" + (st.busy ? "Enregistrement…" : "Enregistrer") + "</button></div></div>" +
        "</form>" +
        '<div class="settings-section"><h3 class="section-title">Lien à partager</h3>' +
          '<div class="secret-row"><code id="s-link">' + esc(listUrl()) + '</code><button type="button" class="btn" data-s="copy-link">' + ICONS.copy + "Copier</button></div>" +
          '<p class="fine">Envoyez ce lien à vos proches : ils y réservent leurs cadeaux.</p></div>' +
        '<div class="settings-section"><h3 class="section-title">Lien d\'édition</h3>' +
          '<div class="secret-row"><code id="s-edit">' + esc(editUrl()) + '</code><button type="button" class="btn" data-s="copy-edit">' + ICONS.copy + "Copier</button></div>" +
          '<p class="fine">Gardez-le pour vous : il ouvre ce mode Vœux, avec le mot de passe.</p></div>' +
        '<div class="settings-section"><h3 class="section-title">Mot de passe du mode Vœux</h3>' + pwBlock + "</div>" +
      "</div></div>";

    const sheet = document.getElementById("settings");
    if (sheet && keepScroll) sheet.scrollTop = keepScroll;
    if (keepFocus) { const el = document.getElementById(keepFocus); if (el) el.focus({ preventScroll: true }); }
    if (first) { const n = document.getElementById("s-name"); if (n) n.focus({ preventScroll: true }); }
  }

  modalRoot.addEventListener("input", (e) => {
    if (!settings) return;
    const id = e.target.id;
    if (id === "s-name") settings.name = e.target.value;
    else if (id === "s-title") settings.welcomeTitle = e.target.value;
    else if (id === "s-sub") settings.welcomeSubtitle = e.target.value;
  });

  modalRoot.addEventListener("change", async (e) => {
    if (!settings || e.target.id !== "s-file" || !e.target.files[0]) return;
    const file = e.target.files[0];
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) { toast("Format non pris en charge : utilisez une image PNG, JPEG, WebP ou GIF."); return; }
    if (file.size > 8 * 1024 * 1024) { toast("Image trop lourde : 8 Mo maximum."); return; }
    const st = settings;
    try {
      toast("Envoi de l'image…");
      const res = await api("POST", "/uploads", file);
      if (settings !== st) return;
      st.heroUpload = res.upload; renderSettings(false); toast("Image prête : enregistrez pour l'appliquer.");
    } catch (err) { toast(err.message || "L'image n'a pas pu être envoyée. Réessayez."); }
  });

  modalRoot.addEventListener("click", (e) => {
    if (!settings) return;
    if (e.target.dataset && e.target.dataset.s === "backdrop") { closeSettings(); return; }
    const el = e.target.closest("[data-s]"); if (!el || el.dataset.s === "backdrop") return;
    const st = settings, a = el.dataset.s;
    if (a === "close") closeSettings();
    else if (a === "default-hero") { st.heroUpload = null; renderSettings(false); }
    else if (a === "copy-link") copyText(listUrl(), document.getElementById("s-link"));
    else if (a === "copy-edit") copyText(editUrl(), document.getElementById("s-edit"));
    else if (a === "copy-pw") copyText(st.newPassword, document.getElementById("s-pw"));
    else if (a === "regen") { st.confirmRegen = true; renderSettings(false); }
    else if (a === "regen-cancel") { st.confirmRegen = false; renderSettings(false); }
    else if (a === "regen-go") {
      st.regenBusy = true; renderSettings(false);
      backend.newPassword().then((r) => {
        if (settings !== st) return;
        st.regenBusy = false; st.confirmRegen = false; st.newPassword = r.password; renderSettings(false);
      }).catch((err) => { if (settings !== st) return; st.regenBusy = false; renderSettings(false); toast(err.message); });
    }
  });

  modalRoot.addEventListener("submit", (e) => {
    if (!settings || !e.target.hasAttribute("data-s-form")) return;
    e.preventDefault();
    const st = settings;
    if (st.busy) return;
    if (!st.name.trim()) { st.err = "Donnez un nom à votre liste."; renderSettings(false); document.getElementById("s-name").focus(); return; }
    st.busy = true; st.err = ""; renderSettings(false);
    backend.saveSettings({ name: st.name.trim(), welcomeTitle: st.welcomeTitle.trim(), welcomeSubtitle: st.welcomeSubtitle.trim(), heroUpload: st.heroUpload })
      .then(() => { if (settings !== st) return; closeSettings(); render(); toast("Paramètres enregistrés."); })
      .catch((err) => { if (settings !== st) return; st.busy = false; st.err = err.message; renderSettings(false); });
  });

  modalRoot.addEventListener("keydown", (e) => { if (e.key === "Escape" && settings) { e.preventDefault(); closeSettings(); } });

  /* ---------- Start ---------- */
  render();
  init();
})();
