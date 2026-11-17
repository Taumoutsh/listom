// Home page (/): create a new list, then show its link and its generated
// password once. Also handles unknown addresses.
(function () {
  "use strict";

  const { LS, esc, richTitle, ICONS, LOGO, heroPicture, heroSrc, DEFAULTS, toast, copyText, api, myLists, route } = window.Listom;
  if (route.kind !== "home" && route.kind !== "notfound") return;

  const app = document.getElementById("app");

  if (route.kind === "notfound") {
    document.title = "Page introuvable · Listom";
    app.innerHTML = '<div class="gate"><span class="gate-ico">' + ICONS.gift + "</span>" +
      '<span class="eyebrow">Listom</span><h1>Page introuvable</h1>' +
      "<p>Cette adresse ne correspond à aucune liste. Vérifiez le lien reçu, ou créez votre propre liste.</p>" +
      '<a class="btn primary" href="/">Créer une liste</a></div>';
    return;
  }

  const state = {
    name: "", welcomeTitle: DEFAULTS.welcomeTitle, welcomeSubtitle: DEFAULTS.welcomeSubtitle,
    file: null, previewUrl: "", code: "", needCode: false,
    busy: false, err: "", created: null      // { id, name, password, imageFailed }
  };

  const listUrl = (id) => location.origin + "/" + id;

  function previewHtml() {
    return '<div class="preview-card" aria-hidden="true"><span class="eyebrow">' + esc(state.name || "Les vœux de Camille") + "</span>" +
      '<div class="onboard-hero">' + heroPicture(state.previewUrl || heroSrc(null)) + "<h2>" + richTitle(state.welcomeTitle || DEFAULTS.welcomeTitle) + "</h2></div>" +
      '<p class="lead">' + esc(state.welcomeSubtitle || DEFAULTS.welcomeSubtitle) + "</p></div>";
  }

  function mine() {
    const lists = myLists.all();
    if (!lists.length) return "";
    return '<section class="mine"><h2 class="section-title">Vos listes sur cet appareil</h2><ul>' +
      lists.map((l) => '<li><a href="/' + encodeURIComponent(l.id) + '">' + ICONS.gift + "<span>" + esc(l.name) + "</span></a></li>").join("") +
      "</ul></section>";
  }

  function formView() {
    return '<div class="topbar"><div class="brand">' + LOGO + "Listom</div></div>" +
      '<div class="hero"><span class="eyebrow">Nouvelle liste</span><h1>Créez votre liste de vœux</h1>' +
      '<p class="lead">Vos proches réservent leurs cadeaux en mode Lutin. Vous gardez la surprise en mode Vœux.</p></div>' +
      '<div class="create">' +
        '<form class="create-form" id="create" novalidate>' +
          '<div class="field"><label for="c-name">Nom de la liste</label><input class="field-input" id="c-name" maxlength="80" required placeholder="Les vœux de Camille" value="' + esc(state.name) + '"></div>' +
          '<div class="field"><label for="c-title">Titre d\'accueil</label><input class="field-input" id="c-title" maxlength="120" value="' + esc(state.welcomeTitle) + '">' +
            '<span class="hint">Entourez des mots d\'astérisques pour les colorer : Il y a aussi *les boules*…</span></div>' +
          '<div class="field"><label for="c-sub">Sous-titre</label><textarea class="field-input" id="c-sub" maxlength="300">' + esc(state.welcomeSubtitle) + "</textarea></div>" +
          '<div class="field"><span class="label">Image d\'accueil</span>' +
            '<div class="actions"><label class="btn upload" for="c-file">' + (state.file ? "Changer l'image" : "Choisir une image") + '<input type="file" id="c-file" accept="image/png,image/jpeg,image/webp,image/gif"></label>' +
            (state.file ? '<button type="button" class="btn ghost" data-a="default-hero">Image par défaut</button>' : "") + "</div>" +
            '<span class="hint">' + (state.file ? esc(state.file.name) : "Facultatif : sans image, celle de l'aperçu est utilisée.") + "</span></div>" +
          (state.needCode ? '<div class="field"><label for="c-code">Code de création</label><input class="field-input" id="c-code" autocomplete="off" value="' + esc(state.code) + '"><span class="hint">Demandez-le à la personne qui héberge ce site.</span></div>' : "") +
          (state.err ? '<p class="err" role="alert">' + esc(state.err) + "</p>" : "") +
          '<button class="btn primary big" type="submit"' + (state.busy ? " disabled" : "") + ">" + (state.busy ? "Création…" : "Créer ma liste") + "</button>" +
          '<p class="fine">Un mot de passe vous sera donné pour modifier la liste. Il protège le mode Vœux.</p>' +
        "</form>" +
        '<aside class="create-preview"><span class="label">Aperçu de l\'accueil</span><div id="preview">' + previewHtml() + "</div></aside>" +
      "</div>" + mine();
  }

  function createdView() {
    const c = state.created;
    return '<div class="topbar"><div class="brand">' + LOGO + "Listom</div></div>" +
      '<div class="created">' +
        '<span class="gate-ico">' + ICONS.gift + "</span>" +
        '<span class="eyebrow">Liste créée · ' + esc(c.name) + "</span><h1>Votre liste est prête</h1>" +
        (c.imageFailed ? '<p class="notice">L\'image n\'a pas pu être envoyée. Vous pourrez la changer dans les paramètres du mode Vœux.</p>' : "") +
        '<div class="secret"><span class="secret-label">Lien de la liste</span>' +
          '<div class="secret-row"><code id="r-link">' + esc(listUrl(c.id)) + '</code><button type="button" class="btn" data-a="copy-link">' + ICONS.copy + "Copier</button></div>" +
          '<p class="fine">Envoyez ce lien à vos proches.</p></div>' +
        '<div class="secret important"><span class="secret-label">Mot de passe du mode Vœux</span>' +
          '<div class="secret-row"><code id="r-pw">' + esc(c.password) + '</code><button type="button" class="btn" data-a="copy-pw">' + ICONS.copy + "Copier</button></div>" +
          "<p class=\"fine\"><b>Gardez-le précieusement : il ne sera plus affiché.</b> Il permet de modifier la liste depuis un autre appareil. Vous pourrez en générer un nouveau dans les paramètres du mode Vœux.</p></div>" +
        '<a class="btn primary big" href="/' + encodeURIComponent(c.id) + '" data-a="open">' + ICONS.gift + "Ouvrir ma liste</a>" +
      "</div>";
  }

  function render() {
    app.innerHTML = state.created ? createdView() : formView();
  }

  function setFile(file) {
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.file = file;
    state.previewUrl = file ? URL.createObjectURL(file) : "";
  }

  app.addEventListener("input", (e) => {
    const id = e.target.id;
    if (id === "c-name") state.name = e.target.value;
    else if (id === "c-title") state.welcomeTitle = e.target.value;
    else if (id === "c-sub") state.welcomeSubtitle = e.target.value;
    else if (id === "c-code") state.code = e.target.value;
    else return;
    const p = document.getElementById("preview");
    if (p) p.innerHTML = previewHtml();       // live preview, without touching the form
  });

  app.addEventListener("change", (e) => {
    if (e.target.id !== "c-file" || !e.target.files[0]) return;
    const file = e.target.files[0];
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) { toast("Format non pris en charge : utilisez une image PNG, JPEG, WebP ou GIF."); return; }
    if (file.size > 8 * 1024 * 1024) { toast("Image trop lourde : 8 Mo maximum."); return; }
    setFile(file);
    render();
  });

  app.addEventListener("click", (e) => {
    const el = e.target.closest("[data-a]");
    if (!el) return;
    const a = el.dataset.a;
    if (a === "default-hero") { setFile(null); render(); }
    else if (a === "copy-link") copyText(listUrl(state.created.id), document.getElementById("r-link"));
    else if (a === "copy-pw") copyText(state.created.password, document.getElementById("r-pw"));
    else if (a === "open") LS.set("listom.mode." + state.created.id, "voeux");   // the creator lands in Mode Vœux
  });

  app.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (state.busy) return;
    if (!state.name.trim()) { state.err = "Donnez un nom à votre liste."; render(); document.getElementById("c-name").focus(); return; }
    if (state.needCode && !state.code.trim()) { state.err = "Saisissez le code de création."; render(); document.getElementById("c-code").focus(); return; }
    state.busy = true; state.err = ""; render();
    try {
      const r = await api("POST", "/api/lists", {
        name: state.name.trim(), welcomeTitle: state.welcomeTitle.trim(), welcomeSubtitle: state.welcomeSubtitle.trim(), creationCode: state.code.trim()
      });
      const created = { id: r.list.id, name: r.list.name, password: r.password, imageFailed: false };
      if (state.file) {
        try {
          const up = await api("POST", "/api/lists/" + encodeURIComponent(created.id) + "/uploads", state.file);
          await api("PUT", "/api/lists/" + encodeURIComponent(created.id) + "/settings", { heroUpload: up.upload });
        } catch (err) { created.imageFailed = true; }
      }
      myLists.add({ id: created.id, name: created.name });
      setFile(null);
      state.busy = false; state.created = created;
      render();
      window.scrollTo(0, 0);
    } catch (err) {
      state.busy = false; state.err = err.message; render();
    }
  });

  document.title = "Créer une liste · Listom";
  render();
  api("GET", "/api/config").then((c) => { if (c && c.creationCode) { state.needCode = true; if (!state.created) render(); } }).catch(() => {});
})();
