#!/usr/bin/env node
/**
 * test-thumb.js — test local de génération de vignette vidéo
 * Usage : node test-thumb.js [chemin_video]
 * Produit /tmp/test-thumb.mp4
 */
'use strict';
const { execFile, execFileSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

function findFfmpeg() {
  const candidates = ['/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/bin/ffmpeg'];
  for (const c of candidates) { try { fs.accessSync(c, fs.constants.X_OK); return c; } catch {} }
  try { return execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim(); } catch {}
  return null;
}

const FFMPEG = findFfmpeg();
if (!FFMPEG) { console.error('ffmpeg introuvable — installez-le avec : brew install ffmpeg'); process.exit(1); }
console.log('ffmpeg :', FFMPEG);

const videoFile = process.argv[2] || '/Users/tom/Documents/DEV/IMG_3773.MOV';
if (!fs.existsSync(videoFile)) { console.error('Vidéo introuvable :', videoFile); process.exit(1); }

const outFile = '/tmp/test-thumb.mp4';
console.log(`Entrée  : ${videoFile}`);
console.log(`Sortie  : ${outFile}`);
console.log('Génération en cours…');

const args = [
  '-i', videoFile,
  '-t', '2',
  '-vf', 'scale=240:-2',
  '-c:v', 'libx264',
  '-an',
  '-movflags', '+faststart',
  '-crf', '28',
  '-preset', 'fast',
  '-y',
  outFile
];

execFile(FFMPEG, args, (err, _stdout, stderr) => {
  if (err) {
    console.error('ERREUR ffmpeg :', err.message);
    if (stderr) console.error('stderr :', stderr.slice(0, 600));
    process.exit(1);
  }
  const size = fs.statSync(outFile).size;
  console.log(`✓ Vignette générée — ${(size / 1024).toFixed(1)} Ko`);
  console.log(`  → open ${outFile}`);
});
