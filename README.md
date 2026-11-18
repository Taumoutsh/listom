# Listom

Listes de cadeaux partagées, sans doublon et sans gâcher la surprise.

- **Mode Lutin**, à l'adresse de la liste (`https://votre-site.fr/TJKUOd-ThhM`) : les proches voient l'accueil de la liste puis les cadeaux, et réservent celui qu'ils offrent, à leur nom. Chaque changement (réservation, modification, libération) est gardé dans un historique, avec le nom et la date.
- **Mode Vœux**, à la même adresse suivie de `/edit` : la personne gâtée compose sa liste (titre, description, lien, prix, image), protégée par son mot de passe. Elle ne voit jamais qui offre quoi.

Chaque liste a son propre mot de passe, généré à la création.

## Créer une liste

1. Dans `/admin`, l'administrateur clique sur **Créer un lien** (le nom de la liste peut être pré-rempli). Il obtient un **lien de création**, du type `https://votre-site.fr/creer/<jeton>`, et l'envoie à la personne qui veut sa liste.
2. Cette personne ouvre le lien et remplit le formulaire : nom de la liste, titre d'accueil, sous-titre et image.
3. Elle obtient le **lien de diffusion** de sa liste, à envoyer à ses proches, son **lien d'édition** (`…/edit`) et son **mot de passe**, affiché une seule fois.

Un lien de création ne sert qu'une fois et expire au bout de `INVITE_DAYS` jours (30 par défaut). L'administrateur voit les liens en attente et peut les révoquer.

## Les pages

| Adresse | Rôle |
| --- | --- |
| `/` | Page d'accueil, simple présentation. On n'y crée pas de liste. |
| `/creer/<jeton>` | Formulaire de création d'une liste, ouvert par un lien de création valide. |
| `/<identifiant>` | Lien de diffusion : l'accueil de la liste puis les cadeaux à réserver (mode Lutin, sans mot de passe). |
| `/<identifiant>/edit` | Lien d'édition : le mode Vœux, protégé par le mot de passe de la liste. |
| `/admin` | Administration : liens de création, et toutes les listes avec un nouveau mot de passe ou la suppression pour chacune. Protégée par `ADMIN_PASSWORD`. |

En mode Vœux, le bouton **Aperçu** montre la page telle que la voient les proches (en-tête, guirlande, cadeaux), sans aucune réservation : la surprise est préservée.

La roue crantée ouvre les paramètres de la liste :
- nom de la liste, titre et sous-titre d'accueil (des mots entourés d'astérisques, comme `Ma liste au *Père Noël*`, s'affichent en couleur) ;
- image d'accueil ;
- lien de diffusion et lien d'édition ;
- génération d'un nouveau mot de passe (les autres appareils devront le saisir).

Quand un cadeau a un lien mais pas d'image, le serveur va chercher l'image de la page (balises `og:image`, `twitter:image`, données produit…). S'il n'en trouve pas, un emoji choisi d'après le titre la remplace.

## Déployer avec Docker

Prérequis : Docker avec Docker Compose, et [Nginx Proxy Manager](https://nginxproxymanager.com/) (NPM) installé avec Docker sur la même machine.

Listom rejoint le réseau Docker de NPM : NPM le joint par son nom de conteneur, sans ouvrir de port sur Internet.

```bash
git clone https://github.com/taumoutsh/listom.git
cd listom
cp .env.example .env
docker network ls        # repérez le réseau de NPM (souvent npm_default)
nano .env                # ADMIN_PASSWORD et NPM_NETWORK
docker compose up -d --build
```

Sans `ADMIN_PASSWORD`, aucune liste ne peut être créée.

Dans NPM, ajoutez un **Proxy Host** :

| Champ | Valeur |
| --- | --- |
| Domain Names | `listes.votre-domaine.fr` |
| Scheme | `http` |
| Forward Hostname / IP | `listom` |
| Forward Port | `6104` |
| SSL | certificat Let's Encrypt, *Force SSL* |
| Advanced | `proxy_buffering off;` (mises à jour en direct sans retard) |

Le port 6104 est aussi ouvert sur la machine elle-même (`127.0.0.1` uniquement), pour vérifier : `curl http://127.0.0.1:6104/api/health`.

Si NPM tourne en mode réseau `host`, ou sans NPM : retirez les blocs `networks` de `docker-compose.yml` et remplacez `127.0.0.1:` par rien dans `ports` pour publier le port.

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

### Cloudflare

Listom fonctionne derrière Cloudflare (en plus de NPM). La page n'est jamais mise en cache, et ses scripts sont appelés avec un numéro de version (`/app.js?v=…`) : après une mise à jour, Cloudflare sert forcément les nouveaux fichiers. Gardez la mise en cache par défaut de Cloudflare (la chaîne de requête fait partie de la clé de cache).

### Autre proxy HTTPS

Avec un autre proxy, gardez `TRUST_PROXY=true` dans `.env`. Exemple avec Caddy installé sur la machine (`Caddyfile`) :

```
listes.votre-site.fr {
    reverse_proxy 127.0.0.1:6104
}
```

Si le proxy met les réponses en mémoire tampon (Nginx), désactivez-la (`proxy_buffering off;`), sinon les mises à jour en direct arrivent en retard.

### Sur l'écran d'accueil d'un téléphone

Listom peut s'installer comme une application : sur iPhone, ouvrez la page dans Safari, touchez **Partager** puis **Sur l'écran d'accueil** ; sur Android, menu de Chrome puis **Ajouter à l'écran d'accueil**. L'icône vient de `public/apple-touch-icon.png` (iPhone) et de `public/manifest.webmanifest` (Android), et l'application s'ouvre en plein écran sur la page ajoutée (une liste, ou son lien d'édition).

## Configuration (`.env`)

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `ADMIN_PASSWORD` | *(vide)* | Mot de passe de `/admin`, où se créent les liens de création. Vide : administration désactivée. |
| `NPM_NETWORK` | `npm_default` | Réseau Docker de Nginx Proxy Manager, que Listom rejoint. |
| `LISTOM_PORT` | `6104` | Port ouvert sur la machine elle-même (`127.0.0.1`), pour les vérifications. |
| `INVITE_DAYS` | `30` | Durée de validité d'un lien de création, en jours. |
| `TRUST_PROXY` | `true` | `true` derrière un proxy (NPM) : lit `X-Forwarded-Proto` et `X-Forwarded-For`. |
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
