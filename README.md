# Listom

Listes de cadeaux partagées, sans doublon et sans gâcher la surprise.

- **Mode Vœux** : la personne gâtée compose sa liste (titre, description, lien, prix, image). Elle ne voit jamais qui offre quoi.
- **Mode Lutin** : les proches parcourent la liste et réservent un cadeau à leur nom. Chaque changement (réservation, modification, libération) est gardé dans un historique, avec le nom et la date.

Chaque liste a sa propre adresse, du type `https://votre-site.fr/TJKUOd-ThhM`, et son propre mot de passe généré à la création.

## Créer une liste

1. Dans `/admin`, l'administrateur clique sur **Créer un lien** (le nom de la liste peut être pré-rempli). Il obtient un **lien de création**, du type `https://votre-site.fr/creer/<jeton>`, et l'envoie à la personne qui veut sa liste.
2. Cette personne ouvre le lien et remplit le formulaire : nom de la liste, titre d'accueil, sous-titre et image.
3. Elle obtient son **mot de passe** (affiché une seule fois) et le **lien de diffusion** de sa liste, à envoyer à ses proches.

Un lien de création ne sert qu'une fois et expire au bout de `INVITE_DAYS` jours (30 par défaut). L'administrateur voit les liens en attente et peut les révoquer.

## Les pages

| Adresse | Rôle |
| --- | --- |
| `/` | Page d'accueil, simple présentation. On n'y crée pas de liste. |
| `/creer/<jeton>` | Formulaire de création d'une liste, ouvert par un lien de création valide. |
| `/<identifiant>` | La liste (lien de diffusion). On choisit le mode Vœux (mot de passe) ou le mode Lutin (aucun mot de passe). Le choix est retenu sur l'appareil. |
| `/admin` | Administration : liens de création, et toutes les listes avec un nouveau mot de passe ou la suppression pour chacune. Protégée par `ADMIN_PASSWORD`. |

En mode Vœux, la roue crantée ouvre les paramètres de la liste :
- nom de la liste, titre et sous-titre d'accueil (des mots entourés d'astérisques, comme `Il y a aussi *les boules*…`, s'affichent en couleur) ;
- image d'accueil ;
- lien à partager ;
- génération d'un nouveau mot de passe (les autres appareils devront le saisir).

Quand un cadeau a un lien mais pas d'image, le serveur va chercher l'image de la page (balises `og:image`, `twitter:image`, données produit…). S'il n'en trouve pas, un emoji choisi d'après le titre la remplace.

## Déployer avec Docker

Prérequis : Docker avec Docker Compose.

```bash
git clone https://github.com/taumoutsh/listom.git
cd listom
cp .env.example .env
# Ouvrez .env et choisissez ADMIN_PASSWORD : sans lui, aucune liste ne peut être créée
docker compose up -d --build
```

Listom répond ensuite sur `http://votre-serveur:6104`. Changez le port avec `LISTOM_PORT` dans `.env`.

### Mettre à jour

```bash
git pull
docker compose up -d --build
```

Les listes sont dans le volume Docker `listom-data` : elles sont conservées.

### Sauvegarder

Tout est dans le volume (`db.json`, les photos et la clé des sessions) :

```bash
docker run --rm -v listom_listom-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/listom-$(date +%F).tar.gz -C /data .
```

Le nom exact du volume s'affiche avec `docker volume ls`.

### HTTPS

Mettez Listom derrière un proxy HTTPS et réglez `TRUST_PROXY=true` dans `.env`. Exemple avec Caddy (`Caddyfile`) :

```
listes.votre-site.fr {
    reverse_proxy 127.0.0.1:6104
}
```

Si le proxy met les réponses en mémoire tampon (Nginx), désactivez-la pour `/api/lists/*/events` (`proxy_buffering off;`), sinon les mises à jour en direct arrivent en retard.

## Configuration (`.env`)

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `ADMIN_PASSWORD` | *(vide)* | Mot de passe de `/admin`, où se créent les liens de création. Vide : administration désactivée. |
| `LISTOM_PORT` | `6104` | Port publié sur la machine hôte. |
| `INVITE_DAYS` | `30` | Durée de validité d'un lien de création, en jours. |
| `TRUST_PROXY` | `false` | `true` derrière un proxy : lit `X-Forwarded-Proto` et `X-Forwarded-For`. |
| `COOKIE_SECURE` | `auto` | Cookies `Secure` : `auto` (selon HTTPS), `true` ou `false`. |
| `SESSION_DAYS` | `30` | Durée de connexion au mode Vœux sur un appareil. |
| `AUTO_LINK_IMAGE` | `true` | Récupère l'image de la page d'un cadeau à partir de son lien. |
| `SESSION_SECRET` | *(vide)* | Clé de signature des sessions. Vide : générée au premier démarrage et gardée dans le volume. |

## Image d'accueil par défaut

Sans image choisie, une liste affiche `public/hero.svg`. Pour changer cette image pour toutes les listes, remplacez ce fichier puis reconstruisez l'image Docker (`docker compose up -d --build`). Chaque liste peut aussi avoir sa propre image, depuis ses paramètres en mode Vœux.

## Sécurité

- Les mots de passe des listes sont générés par le serveur (12 caractères, sans caractères ambigus) et stockés hachés avec scrypt. Ils ne sont jamais enregistrés en clair.
- Les sessions sont des cookies signés `HttpOnly` et `SameSite=Lax`. Un nouveau mot de passe déconnecte les autres appareils.
- Les tentatives de connexion et les créations de listes sont limitées par adresse IP.
- Les images envoyées sont vérifiées d'après leur contenu (PNG, JPEG, WebP, GIF uniquement).
- La récupération d'image depuis un lien refuse les adresses internes (réseau local, `localhost`, métadonnées cloud), y compris après une redirection.
- Le mode Vœux ne télécharge jamais les réservations : la surprise est préservée même en inspectant la page.

## Développer sans Docker

Node.js 20 ou plus récent, aucune dépendance à installer.

```bash
cp .env.example .env
npm run dev      # http://localhost:6104, relance automatique
npm test         # tests de l'API
```

Les données sont alors dans `./data`.

## Structure

```
server/index.js       serveur HTTP, routes de l'API, sessions
server/store.js       stockage (fichier JSON écrit de façon atomique)
server/link-image.js  récupération de l'image d'un lien
public/               page web : shared.js, home.js (accueil et création), app.js (liste), admin.js
test/                 tests de l'API (node --test)
```
