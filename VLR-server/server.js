'use strict';
const express = require('express');
const multer  = require('multer');
const bcrypt  = require('bcrypt');
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const http    = require('http');
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

// ── Auth (in-memory sessions, 24h TTL) ───────────────────────────────
const sessions = new Map(); // token → expiry timestamp
const TOKEN_TTL = 24 * 3600 * 1000;

function requireAuth(req, res, next) {
  const auth  = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const exp   = sessions.get(token);
  if (!token || !exp || exp < Date.now()) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.post('/auth/login', async (req, res) => {
  const { password } = req.body || {};
  const hash = process.env.ADMIN_HASH || '';
  if (!hash) return res.status(500).json({ error: 'Serveur non configuré (ADMIN_HASH manquant)' });
  try {
    const ok = await bcrypt.compare(String(password || ''), hash);
    if (!ok) return res.status(401).json({ error: 'Mot de passe incorrect' });
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + TOKEN_TTL);
    return res.json({ token });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post('/auth/logout', requireAuth, (req, res) => {
  const token = (req.headers['authorization'] || '').slice(7);
  sessions.delete(token);
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
    const rel = (req.body.path || req.file.originalname).replace(/^\/+/, '');
    const abs = path.join(STORAGE_ROOT, rel);
    // Path traversal guard
    if (!abs.startsWith(STORAGE_ROOT + path.sep) && abs !== STORAGE_ROOT) {
      return res.status(400).json({ error: 'Chemin invalide' });
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, req.file.buffer);
    const proto = process.env.DOMAIN ? 'https' : 'http';
    const host  = process.env.DOMAIN ? `${process.env.DOMAIN}:${PORT}` : req.get('host');
    res.json({ ok: true, url: `${proto}://${host}/files/${rel}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Delete ───────────────────────────────────────────────────────────
app.delete('/files', requireAuth, (req, res) => {
  try {
    const rel = ((req.query.path || req.body?.path) || '').replace(/^\/+/, '');
    if (!rel) return res.status(400).json({ error: 'path requis' });
    const abs = path.join(STORAGE_ROOT, rel);
    if (!abs.startsWith(STORAGE_ROOT + path.sep)) return res.status(400).json({ error: 'Chemin invalide' });
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── List folder (optional helper for admin) ──────────────────────────
app.get('/list', requireAuth, (req, res) => {
  try {
    const rel = (req.query.path || '').replace(/^\/+/, '');
    const abs = path.join(STORAGE_ROOT, rel);
    if (!abs.startsWith(STORAGE_ROOT)) return res.status(400).json({ error: 'Chemin invalide' });
    if (!fs.existsSync(abs)) return res.json({ files: [] });
    const entries = fs.readdirSync(abs, { withFileTypes: true }).map(d => ({
      name: d.name, type: d.isDirectory() ? 'dir' : 'file'
    }));
    res.json({ files: entries });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Serve stored files (public, no auth) ─────────────────────────────
app.use('/files', express.static(STORAGE_ROOT));

// ── Health check ─────────────────────────────────────────────────────
app.get('/ping', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ── Start (HTTPS if certs available, else HTTP) ──────────────────────
const domain   = process.env.DOMAIN || '';
const certFile = process.env.SSL_CERT || (domain ? `/etc/letsencrypt/live/${domain}/fullchain.pem` : '');
const keyFile  = process.env.SSL_KEY  || (domain ? `/etc/letsencrypt/live/${domain}/privkey.pem`  : '');

if (certFile && keyFile && fs.existsSync(certFile) && fs.existsSync(keyFile)) {
  const creds = { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) };
  https.createServer(creds, app).listen(PORT, () =>
    console.log(`[VLR-server] HTTPS :${PORT}  storage=${STORAGE_ROOT}`));
} else {
  if (certFile) console.warn(`⚠  Certificats introuvables (${certFile}) — démarrage en HTTP.`);
  else console.warn('⚠  Aucun certificat SSL configuré — démarrage en HTTP.');
  http.createServer(app).listen(PORT, () =>
    console.log(`[VLR-server] HTTP  :${PORT}  storage=${STORAGE_ROOT}`));
}
