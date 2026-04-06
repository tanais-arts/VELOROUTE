# TODO — GitHub PAT transparent via VLR-server

## Problème actuel
L'utilisateur doit gérer deux authentifications séparées :
1. **Password** → ouvre l'admin (VLR-server)
2. **GitHub PAT** (`ghp_…`) → committe les JSON sur GitHub

Le champ PAT dans les Réglages est peu ergonomique et peu sûr (stocké en `localStorage`).

## Solution proposée

### 1. VLR-server (`server.js`)
- Ajouter `GITHUB_PAT=ghp_…` dans le `.env`
- Ajouter un endpoint protégé :
  ```js
  app.get('/config', requireAuth, (req, res) => {
    res.json({ githubPat: process.env.GITHUB_PAT || '' });
  });
  ```

### 2. Admin (`admin.html`)
- Dans `serverSuccess(token)`, immédiatement après le login, appeler `GET /config` :
  ```js
  const cfg = await fetch(`${serverBase()}/config`, {
    headers: { Authorization: `Bearer ${token}` }
  }).then(r => r.json());
  if (cfg.githubPat) $('gh-token').value = cfg.githubPat;
  ```
- Masquer ou supprimer le champ PAT du panneau Réglages (inutile pour l'utilisateur)
- Ne **plus** stocker le PAT en `localStorage` (il est récupéré à chaque login)

## Résultat
- L'utilisateur entre uniquement URL + mot de passe → tout est transparent
- Le PAT ne transite que sur HTTPS déjà authentifié
- Le PAT n'est jamais persisté côté client

## Fichiers à modifier
- `VLR-server/server.js` — ajouter `GET /config`
- `VLR-server/.env` — ajouter `GITHUB_PAT=ghp_…`
- `docs/admin.html` — `serverSuccess()`, panneau Réglages, `saveSettings()` / `loadSettings()`
