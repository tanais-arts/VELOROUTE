# VELOROUTE — Copilot Project Context

## Architecture

- **GitHub Pages** : site public `https://tanais-arts.github.io/VELOROUTE/` sert le dossier `docs/`
- **VLR-server** : Node.js/Express sur `hub.studios-voa.com:1666`, Let's Encrypt SSL
  - Sert les fichiers médias (photos, thumbs, vidéos) via `/files/`
  - Reçoit les uploads depuis admin.html via `/upload`
- **CDN** : `https://hub.studios-voa.com:1666/files/{Photos,Thumbs,Sources}/{sous-dossier}/{fichier}`

## Fichiers clés

### Frontend (`docs/`)
- `index.html` — Page principale avec carte Leaflet, carousel photos, timeline slider, lightbox
- `app.js` — Logique principale (~1200 lignes) : carte, timeline, carousel, navigation photo
- `admin.html` — Page admin tout-en-un : upload photos/vidéos, gestion escales, commit JSON via GitHub API
- `styles.css` — Styles de la page principale
- `oauth_callback.html` — Callback OAuth GitHub pour l'admin

### Données JSON (`docs/`)
- `travel.json` — Points GPX de la trace vélo (lat, lon, day, month, year, hour, minute, frame)
- `photos.json` — Tableau de photos : `{ src, thumb, webp, src_orig, caption (YYYY-MM-DD), entryIdx, lat, lon, city, type, hidden }`
- `escales.json` — Étapes/villes visitées : `{ city, start (YYYY-MM-DD), lat, lon, entryIdx }`
- `cities.json` — Villes à afficher sur la carte
- `visited.json` — Villes visitées (labels sur la carte)
- `gap_routes.json` — Itinéraires interpolés entre les gaps GPX

### Serveur (`VLR-server/`)
- `server.js` — Express, gère uploads, sert fichiers statiques, HTTPS Let's Encrypt
- `install.sh` — Script d'installation avec menu (install, update, certs, etc.)
- `setup_password.js` — Configuration du mot de passe admin

## Système Timeline (photo-based)

Le slider timeline est **basé sur les photos** (pas sur le GPX) :
- `tlInput.min = 0`, `tlInput.max = photos.length - 1`, `step = 1`
- Chaque photo = un cran du slider, espacement égal (non-linéaire temporellement)
- Couvre TOUTES les photos, même celles sans trace GPX

### Fonctions clés dans app.js
- `photoIdxToPct(pi)` — Convertit index photo → pourcentage [0,1] pour positionnement CSS
- `updateTimelineThumbByPhoto(pi)` — Met à jour le thumb flottant (date) au-dessus du slider
- `photoIdxForEntryIdx(eidx)` — Trouve l'index photo le plus proche d'un entryIdx GPX
- `photoIdxForDate(dateStr)` — Trouve l'index photo le plus proche d'une date YYYY-MM-DD
- `selectPhotoEntry(photo, skipCarousel)` — Sélectionne une photo, montre sur carte, met à jour slider
- `selectEntry(idx, skipCarousel, skipSlider)` — Sélectionne par entryIdx GPX (legacy, toujours utilisé par les clicks route)
- `nearestPhotoIdx(entryIdx)` — Index photo la plus proche d'un entryIdx (recherche linéaire)
- `normUrl(u)` — Migre URLs pCloud → hub, http → https
- `buildTimelineCities()` — Positionne les escales sur la timeline par photo-index
- `renderTimelineDateBars()` — Barres verticales aux changements de mois (depuis captions photos)
- `renderTimelineEscales(escales)` — Barres dorées des escales sur la timeline

### Navigation
- `navPrev/navNext` — Photo par photo (index ±1)
- Slider `input` — Scroll carousel + affiche position sur carte
- Slider `change` — `selectPhotoEntry` de la photo à cet index

## Données stats
- ~268 photos, ~162 avec entryIdx (match GPX), ~260 avec GPS EXIF
- Photos couvrent 2025-05-01 → 2026-02-08
- GPX couvre seulement 8 jours en mai-juin 2025
- Photos triées par caption (date YYYY-MM-DD) dans photos.json

## Admin (admin.html)
- `CDN_BASE` : `https://hub.studios-voa.com:1666/files` (verrouillé readonly)
- Upload : photos et vidéos avec thumbs automatiques, EXIF extraction (lat/lon)
- `nearestEntryIdx` avec seuil 2h (`MATCH_MAX_MS`) pour associer photo ↔ point GPX
- 3 sources géocodage pour escales : EXIF GPS → GPX track → Nominatim
- Formulaire manuel d'ajout d'escale avec géocodage Nominatim
- Bouton stop upload avec flag `uploadAborted`
- Commit JSON via GitHub API (token OAuth)

## Conventions
- Toutes les URLs médias passent par `normUrl()` pour migration pCloud et mixed-content
- Les captions photos sont au format `YYYY-MM-DD` (date de prise de vue)
- `entryIdx` = index dans `travel.json` ; peut être `null` si la photo n'a pas de match GPX
- L'admin est autonome : tout se gère depuis le navigateur, pas besoin de toucher au code
- Le serveur VLR écoute sur le port 1666, certificats Let's Encrypt dans `/etc/letsencrypt/`

## Build & Deploy
- Aucun build : les fichiers `docs/` sont servis directement par GitHub Pages
- Pour le serveur : `cd VLR-server && ./install.sh` (ou `install.command` sur macOS)
- Le serveur tourne via `pm2` sous le nom `vlr-server`
