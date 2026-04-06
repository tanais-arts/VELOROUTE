#!/usr/bin/env node
'use strict';
/**
 * setup_password.js — Génère le hash bcrypt du mot de passe super-admin
 * et l'écrit dans le fichier .env (clé SUPER_ADMIN_HASH).
 *
 * Usage : node setup_password.js
 */
const bcrypt = require('bcrypt');
const fs     = require('fs');
const path   = require('path');
const readline = require('readline');

const ENV_FILE = path.join(__dirname, '.env');

function envSet(key, value) {
  let content = '';
  if (fs.existsSync(ENV_FILE)) content = fs.readFileSync(ENV_FILE, 'utf8');
  if (content.match(new RegExp(`^${key}=`, 'm'))) {
    content = content.replace(new RegExp(`^${key}=.*`, 'm'), `${key}=${value}`);
  } else {
    content += `\n${key}=${value}\n`;
  }
  fs.writeFileSync(ENV_FILE, content, { mode: 0o600 });
}

async function run() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const question = (q) => new Promise(resolve => rl.question(q, resolve));

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Création du mot de passe super-admin');
  console.log('═══════════════════════════════════════════════\n');

  const pw1 = await question('  Nouveau mot de passe : ');
  const pw2 = await question('  Confirmer le mot de passe : ');
  rl.close();

  if (!pw1 || pw1 !== pw2) {
    console.error('\n⚠  Les mots de passe ne correspondent pas ou sont vides.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(pw1, 12);
  envSet('SUPER_ADMIN_HASH', hash);
  console.log('\n✓ Mot de passe défini. Hash écrit dans .env\n');
}

run().catch(err => { console.error(err.message); process.exit(1); });
