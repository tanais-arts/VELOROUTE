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
PLIST_PATH="$HOME/Library/LaunchAgents/com.vlr-server.plist"

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
    echo "Node.js non trouvé — tentative d'installation..."
    if [[ "$(uname)" == "Darwin" ]]; then
      brew install node
    elif command -v apt-get >/dev/null 2>&1; then
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
      apt-get install -y nodejs
    elif command -v dnf >/dev/null 2>&1; then
      dnf install -y nodejs
    else
      echo "⚠  Impossible d'installer Node.js automatiquement. Installez-le depuis https://nodejs.org"
      exit 1
    fi
  fi
  echo "✓ Node.js $(node --version),  npm $(npm --version)"
  # Sur macOS, bcrypt nécessite les Xcode CLI tools (compilation native)
  if [[ "$(uname)" == "Darwin" ]] && ! xcode-select -p >/dev/null 2>&1; then
    echo "→ Installation des Xcode Command Line Tools (requis pour bcrypt)..."
    xcode-select --install
    read -rp "   Appuyez sur Entrée une fois l'installation terminée…"
  fi
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
      if [[ "$(uname)" == "Darwin" ]]; then
        if command -v brew >/dev/null 2>&1; then
          brew install certbot
        else
          echo "⚠  Homebrew non trouvé. Installez certbot manuellement : https://certbot.eff.org"
          read -rp "   Appuyez sur Entrée pour continuer sans HTTPS…"
          DO_LE="n"
        fi
      else
        # Linux (Debian/Ubuntu/CentOS)
        if command -v apt-get >/dev/null 2>&1; then
          apt-get install -y certbot
        elif command -v dnf >/dev/null 2>&1; then
          dnf install -y certbot
        elif command -v yum >/dev/null 2>&1; then
          yum install -y certbot
        else
          echo "⚠  Gestionnaire de paquets non reconnu. Installez certbot manuellement."
          read -rp "   Appuyez sur Entrée pour continuer sans HTTPS…"
          DO_LE="n"
        fi
      fi
    fi
    if [[ "$DO_LE" =~ ^[oO]$ ]]; then
      echo "Obtention du certificat pour $DOMAIN (port 80 doit être libre)..."
      certbot certonly --standalone -d "$DOMAIN" \
        --non-interactive --agree-tos \
        --email "admin@$DOMAIN" || { echo "⚠  certbot échoué — vérifiez que le port 80 est ouvert et repointez vers $DOMAIN"; }
      env_set "SSL_CERT" "/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
      env_set "SSL_KEY"  "/etc/letsencrypt/live/$DOMAIN/privkey.pem"
      echo "✓ Certificats configurés."
    fi
  fi
  echo ""

  # Service de démarrage automatique au boot
  if [[ "$(uname)" == "Darwin" ]]; then
    read -rp "Installer un agent launchd (démarrage auto au boot macOS) ? (o/n) : " DO_LD
    if [[ "$DO_LD" =~ ^[oO]$ ]]; then
      NODEBIN="$(which node)"
      PLIST="$HOME/Library/LaunchAgents/com.vlr-server.plist"
      mkdir -p "$HOME/Library/LaunchAgents"
      cat > "$PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.vlr-server</string>
  <key>ProgramArguments</key><array>
    <string>$NODEBIN</string><string>$SCRIPTDIR/server.js</string>
  </array>
  <key>WorkingDirectory</key><string>$SCRIPTDIR</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$SCRIPTDIR/server.log</string>
  <key>StandardErrorPath</key><string>$SCRIPTDIR/server.log</string>
</dict></plist>
EOF
      launchctl load "$PLIST"
      echo "✓ Agent launchd installé : $PLIST"
    fi
  elif command -v systemctl >/dev/null 2>&1; then
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

  # launchd sur macOS en priorité
  if [[ "$(uname)" == "Darwin" ]] && [ -f "$PLIST_PATH" ]; then
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
    launchctl load "$PLIST_PATH"
    echo "✓ Service launchd démarré / redémarré."
  # systemd sur Linux
  elif command -v systemctl >/dev/null 2>&1 && systemctl is-enabled "$SERVICE_NAME" 2>/dev/null | grep -q "enabled"; then
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
  if [[ "$(uname)" == "Darwin" ]] && [ -f "$PLIST_PATH" ]; then
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
    echo "✓ Service launchd arrêté."
  elif command -v systemctl >/dev/null 2>&1 && systemctl is-enabled "$SERVICE_NAME" 2>/dev/null | grep -q "enabled"; then
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
  if [[ "$(uname)" == "Darwin" ]] && [ -f "$PLIST_PATH" ]; then
    # launchd redirige stdout/stderr vers server.log (voir plist)
    if [ -f "$LOGFILE" ]; then
      tail -100f "$LOGFILE"
    else
      echo "Aucun fichier de log trouvé (le serveur a-t-il été démarré au moins une fois ?)."
      read -rp "   Appuyez sur Entrée pour revenir au menu…"
    fi
  elif command -v systemctl >/dev/null 2>&1 && systemctl is-enabled "$SERVICE_NAME" 2>/dev/null | grep -q "enabled"; then
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
