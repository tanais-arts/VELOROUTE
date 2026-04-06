'use strict';
const express  = require('express');
const multer   = require('multer');
const bcrypt   = require('bcrypt');
const crypto   = require('crypto');
const fs       = require('fs');
const path     = require('path');
const https    = require('https');
const http     = require('http');
const { execFile, execFileSync } = require('child_process');

// Résoudre le chemin absolu de ffmpeg une fois au démarrage
function findFfmpeg() {
  const candidates = ['/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/bin/ffmpeg'];
  for (const c of candidates) { try { fs.accessSync(c, fs.constants.X_OK); return c; } catch {} }
  try { return execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim(); } catch {}
  return 'ffmpeg'; // fallback PATH
}
const FFMPEG = findFfmpeg();
console.log('ffmpeg:', FFMPEG);
require('dotenv').config();

const app  = express();
const PORT = Number(process.env.PORT) || 1666;
const STORAGE_ROOT = path.resolve(process.env.STORAGE_ROOT || path.join(__dirname, 'storage'));
fs.mkdirSync(STORAGE_ROOT, { recursive: true });

// ── CORS ─────────────────────────────────────────────────────────────
const ALLOWED = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  if (ALLOWED.includes('*') || ALLOWED.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json());

// ── Fichier utilisateurs ──────────────────────────────────────────────
// Structure : [{ login, hash, ghToken, storageDir }]
const USERS_FILE = path.join(__dirname, 'users.json');
function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return []; }
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), { mode: 0o600 });
}

// ── Sessions enrichies : token → { expiry, login, storageDir, ghToken, isSuperAdmin }
const sessions  = new Map();
const TOKEN_TTL = 24 * 3600 * 1000;

function getSession(req) {
  const auth  = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const sess  = sessions.get(token);
  if (!sess || sess.expiry < Date.now()) return null;
  return sess;
}

function requireAuth(req, res, next) {
  const sess = getSession(req);
  if (!sess) return res.status(401).json({ error: 'Unauthorized' });
  req.session = sess;
  next();
}

function requireSuperAdmin(req, res, next) {
  const sess = getSession(req);
  if (!sess || !sess.isSuperAdmin) return res.status(403).json({ error: 'Super-admin requis' });
  req.session = sess;
  next();
}

// Résoudre la racine de stockage d'un utilisateur (crée le dossier si besoin)
function userStorageRoot(storageDir) {
  const dir = storageDir ? path.join(STORAGE_ROOT, storageDir) : STORAGE_ROOT;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Auth login ────────────────────────────────────────────────────────
app.post('/auth/login', async (req, res) => {
  const { login, password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Mot de passe requis' });

  // 1. Vérifier super-admin (SUPER_ADMIN_HASH ou legacy ADMIN_HASH)
  const superHash  = process.env.SUPER_ADMIN_HASH || process.env.ADMIN_HASH || '';
  const superLogin = (process.env.SUPER_ADMIN_LOGIN || 'admin').toLowerCase();
  if (superHash && (!login || login.toLowerCase() === superLogin)) {
    try {
      const ok = await bcrypt.compare(String(password), superHash);
      if (ok) {
        const token = crypto.randomBytes(32).toString('hex');
        sessions.set(token, { expiry: Date.now() + TOKEN_TTL, login: superLogin, storageDir: '', ghToken: '', isSuperAdmin: true });
        return res.json({ token, login: superLogin, isSuperAdmin: true });
      }
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // 2. Vérifier utilisateurs normaux
  if (!login) return res.status(400).json({ error: 'Login requis' });
  const users = loadUsers();
  const user  = users.find(u => u.login.toLowerCase() === login.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Login ou mot de passe incorrect' });
  try {
    const ok = await bcrypt.compare(String(password), user.hash);
    if (!ok) return res.status(401).json({ error: 'Login ou mot de passe incorrect' });
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { expiry: Date.now() + TOKEN_TTL, login: user.login, storageDir: user.storageDir, ghToken: user.ghToken || '', isSuperAdmin: false });
    return res.json({ token, login: user.login, ghToken: user.ghToken || '', storageDir: user.storageDir, isSuperAdmin: false });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

app.post('/auth/logout', requireAuth, (req, res) => {
  const token = (req.headers['authorization'] || '').slice(7);
  sessions.delete(token);
  res.json({ ok: true });
});

// ── Gestion utilisateurs (super-admin) ───────────────────────────────
app.get('/users', requireSuperAdmin, (_req, res) => {
  const users = loadUsers().map(({ login, storageDir }) => ({ login, storageDir }));
  res.json({ users });
});

app.post('/users', requireSuperAdmin, async (req, res) => {
  const { login, password, ghToken } = req.body || {};
  if (!login || !password) return res.status(400).json({ error: 'login et password requis' });
  const slug = login.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) return res.status(400).json({ error: 'Login invalide' });
  const users = loadUsers();
  if (users.find(u => u.login.toLowerCase() === slug)) return res.status(409).json({ error: 'Login déjà utilisé' });
  try {
    const hash = await bcrypt.hash(String(password), 12);
    const storageDir = slug;
    users.push({ login: slug, hash, ghToken: (ghToken || '').trim(), storageDir });
    saveUsers(users);
    fs.mkdirSync(path.join(STORAGE_ROOT, storageDir), { recursive: true });
    res.json({ ok: true, login: slug, storageDir });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/users/:login', requireSuperAdmin, (req, res) => {
  const target = req.params.login.toLowerCase();
  const users  = loadUsers();
  const idx    = users.findIndex(u => u.login.toLowerCase() === target);
  if (idx === -1) return res.status(404).json({ error: 'Utilisateur introuvable' });
  users.splice(idx, 1);
  saveUsers(users);
  res.json({ ok: true });
});

// Mise à jour du token GitHub par l'utilisateur lui-même
app.post('/users/me/ghtoken', requireAuth, (req, res) => {
  if (req.session.isSuperAdmin) return res.status(400).json({ error: 'Super-admin ne stocke pas de token GitHub' });
  const { ghToken } = req.body || {};
  const users = loadUsers();
  const user  = users.find(u => u.login.toLowerCase() === req.session.login.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  user.ghToken = (ghToken || '').trim();
  saveUsers(users);
  req.session.ghToken = user.ghToken;
  res.json({ ok: true });
});

// ── Upload ───────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 } // 500 MB
});

app.post('/upload', requireAuth, upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier fourni' });
    const userRoot = userStorageRoot(req.session.storageDir);
    const rel = (req.body.path || req.file.originalname).replace(/^\/+/, '');
    const abs = path.join(userRoot, rel);
    // Path traversal guard
    if (!abs.startsWith(userRoot + path.sep) && abs !== userRoot) {
      return res.status(400).json({ error: 'Chemin invalide' });
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, req.file.buffer);
    const proto = serverProto;
    const host  = serverProto === 'https' ? `${process.env.DOMAIN}:${PORT}` : req.get('host');
    const urlPath = req.session.storageDir ? `${req.session.storageDir}/${rel}` : rel;
    res.json({ ok: true, url: `${proto}://${host}/files/${urlPath}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Delete ───────────────────────────────────────────────────────────
app.delete('/files', requireAuth, (req, res) => {
  try {
    const userRoot = userStorageRoot(req.session.storageDir);
    const rel = ((req.query.path || req.body?.path) || '').replace(/^\/+/, '');
    if (!rel) return res.status(400).json({ error: 'path requis' });
    const abs = path.join(userRoot, rel);
    if (!abs.startsWith(userRoot + path.sep)) return res.status(400).json({ error: 'Chemin invalide' });
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── List folder (optional helper for admin) ──────────────────────────
app.get('/list', requireAuth, (req, res) => {
  try {
    const userRoot = userStorageRoot(req.session.storageDir);
    const rel = (req.query.path || '').replace(/^\/+/, '');
    const abs = path.join(userRoot, rel);
    if (!abs.startsWith(userRoot)) return res.status(400).json({ error: 'Chemin invalide' });
    if (!fs.existsSync(abs)) return res.json({ files: [] });
    const entries = fs.readdirSync(abs, { withFileTypes: true }).map(d => ({
      name: d.name, type: d.isDirectory() ? 'dir' : 'file'
    }));
    res.json({ files: entries });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Video thumbnail via FFmpeg ─────────────────────────────────────
app.post('/video-thumb', requireAuth, (req, res) => {
  const { videoPath, thumbPath } = req.body || {};
  if (!videoPath || !thumbPath)
    return res.status(400).json({ error: 'videoPath et thumbPath requis' });

  const userRoot = userStorageRoot(req.session.storageDir);
  const videoAbs = path.join(userRoot, videoPath.replace(/^\/+/, ''));
  const thumbAbs = path.join(userRoot, thumbPath.replace(/^\/+/, ''));

  // Path traversal guard
  const root = userRoot + path.sep;
  if (!videoAbs.startsWith(root) || !thumbAbs.startsWith(root))
    return res.status(400).json({ error: 'Chemin invalide' });
  if (!fs.existsSync(videoAbs))
    return res.status(404).json({ error: 'Vidéo introuvable sur le serveur' });

  fs.mkdirSync(path.dirname(thumbAbs), { recursive: true });

  execFile(FFMPEG, [
    '-i', videoAbs,
    '-t', '2',             // 2 premières secondes
    '-vf', 'scale=240:-2', // 240px de large, hauteur proportionnelle
    '-c:v', 'libx264',     // forcer H.264 (compatibilité MOV HEVC/ProRes)
    '-an',                 // pas d'audio
    '-movflags', '+faststart',
    '-crf', '28',
    '-preset', 'fast',
    '-y',
    thumbAbs
  ], (err, _stdout, stderr) => {
    if (err) return res.status(500).json({ error: err.message, stderr: stderr?.slice(0, 400) });
    res.json({ ok: true });
  });
});

// ── Serve stored files (public, no auth) ─────────────────────────────
app.use('/files', express.static(STORAGE_ROOT));

// ── Health check ─────────────────────────────────────────────────────
app.get('/ping', (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const sess = token ? sessions.get(token) : null;
  if (sess && sess.expiry > Date.now()) {
    return res.json({ ok: true, time: new Date().toISOString(), isSuperAdmin: sess.isSuperAdmin, ghToken: sess.ghToken || '' });
  }
  res.json({ ok: true, time: new Date().toISOString() });
});

// ── Start (HTTPS if certs available, else HTTP) ──────────────────────
const domain   = process.env.DOMAIN || '';
const certFile = process.env.SSL_CERT || (domain ? `/etc/letsencrypt/live/${domain}/fullchain.pem` : '');
const keyFile  = process.env.SSL_KEY  || (domain ? `/etc/letsencrypt/live/${domain}/privkey.pem`  : '');

// Track actual protocol so upload URLs are always correct
let serverProto = 'http';

if (certFile && keyFile && fs.existsSync(certFile) && fs.existsSync(keyFile)) {
  serverProto = 'https';
  const creds = { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) };
  https.createServer(creds, app).listen(PORT, () =>
    console.log(`[VLR-server] HTTPS :${PORT}  storage=${STORAGE_ROOT}`));
} else {
  if (certFile) console.warn(`⚠  Certificats introuvables (${certFile}) — démarrage en HTTP.`);
  else console.warn('⚠  Aucun certificat SSL configuré — démarrage en HTTP.');
  http.createServer(app).listen(PORT, () =>
    console.log(`[VLR-server] HTTP  :${PORT}  storage=${STORAGE_ROOT}`));
}
