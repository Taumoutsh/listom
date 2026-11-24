// Welcome screen (/), and list creation from a one-time link handed out by
// the administrator (/creer/<token>). Also handles unknown addresses.
(function () {
  "use strict";

  const { esc, richTitle, ICONS, LOGO, THEMES, themeOf, heroPicture, heroSrc, DEFAULTS, toast, copyText, api, myLists, route, href, listUrl, editUrl } = window.Listom;
  if (!["home", "create", "notfound"].includes(route.kind)) return;

  const app = document.getElementById("app");
  const brand = '<div class="topbar"><div class="brand">' + LOGO + "Listom</div></div>";

  function mine() {
    const lists = myLists.all();
    if (!lists.length) return "";
    return '<section class="mine"><h2 class="section-title">Vos listes sur cet appareil</h2><ul>' +
      lists.map((l) => '<li><a href="' + href.edit(l.id) + '">' + ICONS.gift + "<span>" + esc(l.name) + "</span></a></li>").join("") +
      "</ul></section>";
  }

  // ---- Unknown address -----------------------------------------------------
  if (route.kind === "notfound") {
    document.title = "Page introuvable · Listom";
    app.innerHTML = '<div class="gate"><span class="gate-ico">' + ICONS.gift + "</span>" +
      '<span class="eyebrow">Listom</span><h1>Page introuvable</h1>' +
      "<p>Cette adresse ne correspond à aucune liste. Vérifiez le lien que vous avez reçu.</p>" +
      '<a class="btn primary" href="/">Retour à l\'accueil</a></div>';
    return;
  }

  // ---- Welcome screen: nothing to do here but open a link ---------------------
  const SPLASH_TITLE = "Des idées très *hotte*";
  if (route.kind === "home") {
    document.title = "Listom";
    app.innerHTML = '<div class="onboard splash">' + brand.replace('<div class="topbar">', '<div class="topbar splash-top">') +
      '<div class="hero"><div class="onboard-hero">' + heroPicture(heroSrc(null)) + "<h1>" + richTitle(SPLASH_TITLE) + "</h1></div>" +
        '<p class="lead">Des listes de vœux partagées : la personne gâtée compose sa liste, ses proches réservent ce qu\'ils offrent, et personne n\'achète deux fois le même cadeau.</p></div>' +
      '<div class="splash-note">' + ICONS.link + "<p><b>Vous avez reçu un lien ?</b> Ouvrez-le directement : il mène à une liste, ou au formulaire pour créer la vôtre.</p></div>" +
      mine() + "</div>";
    return;
  }

  // ---- Create a list from a creation link ---------------------------------------
  const TOKEN = route.token;
  const state = {
    checking: true, gone: "",
    theme: "noel",                           // set by the admin on the creation link
    name: "", welcomeTitle: DEFAULTS.welcomeTitle, welcomeSubtitle: DEFAULTS.welcomeSubtitle,
    file: null, previewUrl: "",
    busy: false, err: "", created: null      // { id, name, password, imageFailed }
  };

  // Live preview of the page the creator's relatives will see: the name on its
  // gift tag, picture and welcome title, subtitle, garland, then the gifts.
  function previewHtml() {
    return '<div class="preview-card" aria-hidden="true">' +
      '<div class="hero list-header"><div class="list-tag"><p class="list-name">' + esc(state.name || "Les vœux de Camille") + "</p></div>" +
        '<div class="onboard-hero">' + heroPicture(state.previewUrl || heroSrc(null), state.theme) + "<h2>" + richTitle(state.welcomeTitle || THEMES[state.theme].welcomeTitle) + "</h2></div>" +
        '<p class="lead">' + esc(state.welcomeSubtitle || DEFAULTS.welcomeSubtitle) + "</p></div>" +
      (window.ListomGarland ? window.ListomGarland(state.theme) : "") +
      '<p class="hotte-title">' + esc(THEMES[state.theme].section) + "</p>" +
      '<p class="preview-gifts">Vos vœux apparaîtront ici.</p></div>';
  }

  function goneView() {
    return brand + '<div class="gate"><span class="gate-ico">' + ICONS.link + "</span>" +
      '<span class="eyebrow">Lien de création</span><h1>Lien plus valable</h1>' +
      "<p>" + esc(state.gone) + "</p>" + mine() + "</div>";
  }

  function formView() {
    return brand +
      '<div class="hero"><span class="eyebrow">Nouvelle liste</span><h1>Créez votre liste de vœux</h1>' +
      '<p class="lead">Vos proches réservent leurs cadeaux en mode Lutin. Vous gardez la surprise en mode Vœux.</p></div>' +
      '<div class="create">' +
        '<form class="create-form" id="create" novalidate>' +
          '<div class="field"><label for="c-name">Nom de la liste</label><input class="field-input" id="c-name" maxlength="80" required placeholder="Les vœux de Camille" value="' + esc(state.name) + '"></div>' +
          '<div class="field"><label for="c-title">Titre d\'accueil</label><input class="field-input" id="c-title" maxlength="120" value="' + esc(state.welcomeTitle) + '">' +
            '<span class="hint">Entourez des mots d\'astérisques pour les colorer : ' + esc(THEMES[state.theme].welcomeTitle) + "</span></div>" +
          '<div class="field"><label for="c-sub">Sous-titre</label><textarea class="field-input" id="c-sub" maxlength="300">' + esc(state.welcomeSubtitle) + "</textarea></div>" +
          '<div class="field"><span class="label">Image d\'accueil</span>' +
            '<div class="actions"><label class="btn upload" for="c-file">' + (state.file ? "Changer l'image" : "Choisir une image") + '<input type="file" id="c-file" accept="image/png,image/jpeg,image/webp,image/gif"></label>' +
            (state.file ? '<button type="button" class="btn ghost" data-a="default-hero">Image par défaut</button>' : "") + "</div>" +
            '<span class="hint">' + (state.file ? esc(state.file.name) : "Facultatif : sans image, celle de l'aperçu est utilisée.") + "</span></div>" +
          (state.err ? '<p class="err" role="alert">' + esc(state.err) + "</p>" : "") +
          '<button class="btn primary big" type="submit"' + (state.busy ? " disabled" : "") + ">" + (state.busy ? "Création…" : "Créer ma liste") + "</button>" +
          '<p class="fine">Ce lien ne sert qu\'une fois. Un mot de passe vous sera donné pour modifier la liste : il protège le mode Vœux.</p>' +
        "</form>" +
        '<aside class="create-preview"><span class="label">Aperçu de la page de vos proches</span><div id="preview">' + previewHtml() + "</div></aside>" +
      "</div>";
  }

  function createdView() {
    const c = state.created;
    return brand +
      '<div class="created">' +
        '<span class="gate-ico">' + ICONS.gift + "</span>" +
        '<span class="eyebrow">Liste créée · ' + esc(c.name) + "</span><h1>Votre liste est prête</h1>" +
        (c.imageFailed ? '<p class="notice">L\'image n\'a pas pu être envoyée. Vous pourrez la changer dans les paramètres du mode Vœux.</p>' : "") +
        '<div class="secret"><span class="secret-label">Lien de diffusion</span>' +
          '<div class="secret-row"><code id="r-link">' + esc(listUrl(c.id)) + '</code><button type="button" class="btn" data-a="copy-link">' + ICONS.copy + "Copier</button></div>" +
          '<p class="fine">Envoyez ce lien à vos proches : ils y réservent leurs cadeaux.</p></div>' +
        '<div class="secret"><span class="secret-label">Lien d\'édition (pour vous)</span>' +
          '<div class="secret-row"><code id="r-edit">' + esc(editUrl(c.id)) + '</code><button type="button" class="btn" data-a="copy-edit">' + ICONS.copy + "Copier</button></div>" +
          '<p class="fine">Gardez-le : c\'est là que vous ajoutez et modifiez vos vœux, avec le mot de passe ci-dessous.</p></div>' +
        '<div class="secret important"><span class="secret-label">Mot de passe du mode Vœux</span>' +
          '<div class="secret-row"><code id="r-pw">' + esc(c.password) + '</code><button type="button" class="btn" data-a="copy-pw">' + ICONS.copy + "Copier</button></div>" +
          "<p class=\"fine\"><b>Gardez-le précieusement : il ne sera plus affiché.</b> Il permet de modifier la liste depuis un autre appareil. Vous pourrez en générer un nouveau dans les paramètres du mode Vœux.</p></div>" +
        '<a class="btn primary big" href="' + href.edit(c.id) + '">' + ICONS.gift + "Ajouter mes vœux</a>" +
      "</div>";
  }

  function render() {
    if (state.checking) { app.innerHTML = brand + '<div class="hero" style="padding-block:15vh"><span class="eyebrow">Lien de création</span><h1>Vérification du lien…</h1></div>'; return; }
    app.innerHTML = state.created ? createdView() : state.gone ? goneView() : formView();
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
    else if (a === "copy-edit") copyText(editUrl(state.created.id), document.getElementById("r-edit"));
    else if (a === "copy-pw") copyText(state.created.password, document.getElementById("r-pw"));
  });

  app.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (state.busy) return;
    if (!state.name.trim()) { state.err = "Donnez un nom à votre liste."; render(); document.getElementById("c-name").focus(); return; }
    state.busy = true; state.err = ""; render();
    try {
      const r = await api("POST", "/api/lists", {
        invite: TOKEN, name: state.name.trim(), welcomeTitle: state.welcomeTitle.trim(), welcomeSubtitle: state.welcomeSubtitle.trim()
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
      state.busy = false;
      if (err.status === 403) state.gone = err.message;   // the link was used or revoked meanwhile
      else state.err = err.message;
      render();
    }
  });

  document.title = "Créer une liste · Listom";
  render();
  api("GET", "/api/invites/" + encodeURIComponent(TOKEN))
    .then((r) => {
      state.name = (r.invite && r.invite.name) || "";
      state.theme = themeOf(r.invite && r.invite.theme);
      state.welcomeTitle = THEMES[state.theme].welcomeTitle;   // the theme's suggested title
    })
    .catch((err) => { state.gone = err.message || "Ce lien de création n'est plus valable."; })
    .then(() => { state.checking = false; render(); });
})();
