#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
#  VLR-server — script d'installation et de gestion
# ═══════════════════════════════════════════════════════════════════════
set -e
SCRIPTDIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPTDIR"
ENV_FILE="$SCRIPTDIR/.env"
SERVICE_NAME="vlr-server"
LOGFILE="$SCRIPTDIR/server.log"
PIDFILE="$SCRIPTDIR/server.pid"

show_menu() {
  echo ""
  echo "╔══════════════════════════════════════════════════╗"
  echo "║    VLR-server (port 1666)                        ║"
  echo "╚══════════════════════════════════════════════════╝"
  echo ""
  echo "  1) Installer et configurer (première fois)"
  echo "  2) Changer le mot de passe admin"
  echo "  3) Démarrer le serveur"
  echo "  4) Arrêter le serveur"
  echo "  5) Afficher les logs (Ctrl+C pour quitter)"
  echo "  0) Quitter"
  echo ""
  read -rp "Choix (0-5) : " CHOICE
  echo ""
}

# ── Vérifie Node.js ───────────────────────────────────────────────────
require_node() {
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js non trouvé — tentative d'installation (Debian/Ubuntu)..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  fi
  echo "✓ Node.js $(node --version),  npm $(npm --version)"
}

# ── Changer/créer mot de passe ────────────────────────────────────────
setup_password() {
  require_node
  npm install --omit=dev --silent 2>/dev/null || npm install --production --silent
  node setup_password.js
}

# ── Met à jour une clé dans .env (compatible macOS + Linux) ──────────────
env_set() {
  local key="$1" val="$2"
  if [ -f "$ENV_FILE" ] && grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    local tmp; tmp="$(mktemp)"
    sed "s|^${key}=.*|${key}=${val}|" "$ENV_FILE" > "$tmp" && mv "$tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}

# ═══════════════════════════════════════════════════════════════════════
while true; do
  show_menu
  case "$CHOICE" in

# ── 1) Installation ────────────────────────────────────────────────────
1)
  require_node
  echo "Installation des dépendances npm..."
  npm install --omit=dev 2>/dev/null || npm install --production
  echo "✓ Dépendances installées."
  echo ""

  echo "╔══════════════════════════════════════════════════╗"
  echo "║  Configuration (Entrée = valeur par défaut)      ║"
  echo "╚══════════════════════════════════════════════════╝"
  echo ""

  read -rp "  Domaine public      [hub.studios-voa.com] : " DOMAIN
  DOMAIN="${DOMAIN:-hub.studios-voa.com}"

  read -rp "  Port d'écoute       [1666] : " PORT
  PORT="${PORT:-1666}"

  read -rp "  Dossier de stockage [$SCRIPTDIR/storage] : " STORAGE
  STORAGE="${STORAGE:-$SCRIPTDIR/storage}"

  read -rp "  Origines CORS       [https://tanais-arts.github.io] : " ORIGINS
  ORIGINS="${ORIGINS:-https://tanais-arts.github.io}"

  echo ""

  # Créer/peupler .env
  [ ! -f "$ENV_FILE" ] && cp "$SCRIPTDIR/.env.example" "$ENV_FILE" 2>/dev/null || touch "$ENV_FILE"
  env_set "PORT"             "$PORT"
  env_set "DOMAIN"           "$DOMAIN"
  env_set "STORAGE_ROOT"     "$STORAGE"
  env_set "ALLOWED_ORIGINS"  "$ORIGINS"
  mkdir -p "$STORAGE"
  echo "✓ Configuration écrite dans .env"
  echo ""

  # Mot de passe admin
  echo "──────────────────────────────────────────────────"
  echo "  Création du mot de passe administrateur"
  echo "──────────────────────────────────────────────────"
  node setup_password.js
  echo ""

  # HTTPS / Let's Encrypt
  read -rp "Configurer HTTPS avec Let's Encrypt ? (o/n) : " DO_LE
  if [[ "$DO_LE" =~ ^[oO]$ ]]; then
    if ! command -v certbot >/dev/null 2>&1; then
      echo "Installation de certbot..."
      apt-get install -y certbot
    fi
    echo "Obtention du certificat pour $DOMAIN (port 80 doit être libre)..."
    certbot certonly --standalone -d "$DOMAIN" \
      --non-interactive --agree-tos \
      --email "admin@$DOMAIN" || { echo "⚠  certbot échoué — vérifiez que le port 80 est ouvert et repointez vers $DOMAIN"; }
    env_set "SSL_CERT" "/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
    env_set "SSL_KEY"  "/etc/letsencrypt/live/$DOMAIN/privkey.pem"
    echo "✓ Certificats configurés."
  fi
  echo ""

  # Service systemd
  if command -v systemctl >/dev/null 2>&1; then
    read -rp "Installer un service systemd (démarrage auto au boot) ? (o/n) : " DO_SD
    if [[ "$DO_SD" =~ ^[oO]$ ]]; then
      NODEBIN="$(which node)"
      cat > "/etc/systemd/system/${SERVICE_NAME}.service" << EOF
[Unit]
Description=VLR-server
After=network.target

[Service]
WorkingDirectory=$SCRIPTDIR
ExecStart=$NODEBIN server.js
EnvironmentFile=$ENV_FILE
Restart=always
RestartSec=5
User=$(whoami)
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
      systemctl daemon-reload
      systemctl enable "$SERVICE_NAME"
      echo "✓ Service systemd '${SERVICE_NAME}' installé et activé au démarrage."
    fi
  fi

  echo ""
  echo "✅ Installation terminée !"
  echo "   Choisissez '3' pour démarrer le serveur."
  read -rp "   Appuyez sur Entrée pour revenir au menu…"
  ;;

# ── 2) Changer mot de passe ────────────────────────────────────────────
2)
  [ ! -f "$ENV_FILE" ] && echo "⚠  .env introuvable — lancez d'abord l'installation (option 1)." && read -rp "Entrée…" && continue
  setup_password
  echo ""
  echo "Redémarrage du serveur pour prendre en compte le nouveau mot de passe..."
  bash "$0" <<< "4" 2>/dev/null || true
  sleep 1
  bash "$0" <<< "3" 2>/dev/null || true
  read -rp "   Appuyez sur Entrée pour revenir au menu…"
  ;;

# ── 3) Démarrer ─────────────────────────────────────────────────────────
3)
  [ ! -f "$ENV_FILE" ] && echo "⚠  .env introuvable — lancez d'abord l'installation (option 1)." && read -rp "Entrée…" && continue

  # systemd en priorité
  if command -v systemctl >/dev/null 2>&1 && systemctl is-enabled "$SERVICE_NAME" 2>/dev/null | grep -q "enabled"; then
    systemctl restart "$SERVICE_NAME"
    echo "✓ Service systemd démarré / redémarré."
  # PM2 si disponible
  elif command -v pm2 >/dev/null 2>&1; then
    pm2 delete "$SERVICE_NAME" 2>/dev/null || true
    pm2 start server.js --name "$SERVICE_NAME"
    echo "✓ Serveur démarré avec PM2."
  # Fallback : background pid
  else
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      kill "$(cat "$PIDFILE")" && sleep 1
    fi
    nohup node server.js >> "$LOGFILE" 2>&1 &
    echo $! > "$PIDFILE"
    sleep 1
    if kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "✓ Serveur démarré en arrière-plan (PID $(cat "$PIDFILE"))."
      echo "  Logs : $LOGFILE"
    else
      echo "⚠  Le serveur ne semble pas s'être lancé. Vérifiez : $LOGFILE"
    fi
  fi
  read -rp "   Appuyez sur Entrée pour revenir au menu…"
  ;;

# ── 4) Arrêter ──────────────────────────────────────────────────────────
4)
  if command -v systemctl >/dev/null 2>&1 && systemctl is-enabled "$SERVICE_NAME" 2>/dev/null | grep -q "enabled"; then
    systemctl stop "$SERVICE_NAME"
    echo "✓ Service systemd arrêté."
  elif command -v pm2 >/dev/null 2>&1 && pm2 list | grep -q "$SERVICE_NAME"; then
    pm2 stop "$SERVICE_NAME"
    echo "✓ PM2 : serveur arrêté."
  elif [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    kill "$(cat "$PIDFILE")" && rm -f "$PIDFILE"
    echo "✓ Serveur arrêté (PID supprimé)."
  else
    echo "Aucun serveur en cours d'exécution trouvé."
  fi
  read -rp "   Appuyez sur Entrée pour revenir au menu…"
  ;;

# ── 5) Logs ─────────────────────────────────────────────────────────────
5)
  if command -v systemctl >/dev/null 2>&1 && systemctl is-enabled "$SERVICE_NAME" 2>/dev/null | grep -q "enabled"; then
    journalctl -u "$SERVICE_NAME" -f --no-pager -n 100
  elif command -v pm2 >/dev/null 2>&1 && pm2 list | grep -q "$SERVICE_NAME"; then
    pm2 logs "$SERVICE_NAME" --lines 100
  elif [ -f "$LOGFILE" ]; then
    tail -100f "$LOGFILE"
  else
    echo "Aucun fichier de log trouvé."
    read -rp "   Appuyez sur Entrée pour revenir au menu…"
  fi
  ;;

0)
  echo "Au revoir."
  exit 0
  ;;

*)
  echo "Choix invalide."
  read -rp "   Appuyez sur Entrée pour revenir au menu…"
  ;;
esac
done
