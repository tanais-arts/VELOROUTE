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
  echo "  6) Renouveler le certificat Let's Encrypt"
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

  # HTTPS / Let's Encrypt (challenge DNS — port 80 non requis)
  echo "──────────────────────────────────────────────────"
  echo "  HTTPS — Let's Encrypt via challenge DNS"
  echo "──────────────────────────────────────────────────"

  # Installer certbot si absent
  if ! command -v certbot >/dev/null 2>&1; then
    echo "Installation de certbot..."
    if [[ "$(uname)" == "Darwin" ]]; then
      if command -v brew >/dev/null 2>&1; then
        brew install certbot
      else
        echo "⚠  Homebrew non trouvé — installez certbot manuellement : https://certbot.eff.org"
      fi
    elif command -v apt-get >/dev/null 2>&1; then
      apt-get install -y certbot
    elif command -v dnf >/dev/null 2>&1; then
      dnf install -y certbot
    elif command -v yum >/dev/null 2>&1; then
      yum install -y certbot
    else
      echo "⚠  Gestionnaire de paquets non reconnu — installez certbot manuellement."
    fi
  fi

  if command -v certbot >/dev/null 2>&1; then
    echo ""
    echo "  ┌─────────────────────────────────────────────────────────────┐"
    echo "  │  Challenge DNS — ajoutez cet enregistrement dans votre DNS  │"
    echo "  │                                                              │"
    echo "  │  Nom   : _acme-challenge.$DOMAIN"
    echo "  │  Type  : TXT                                                 │"
    echo "  │  Valeur: (certbot vous l'affichera ci-dessous)               │"
    echo "  │                                                              │"
    echo "  │  OVH : Espace client → Zone DNS → Ajouter → TXT             │"
    echo "  │  Attendez ~2 min après ajout avant d'appuyer Entrée.        │"
    echo "  └─────────────────────────────────────────────────────────────┘"
    echo ""

    # If not running as root, instruct certbot to use writable local dirs
    CERTBOT_EXTRA_OPTS=""
    LOCAL_LE_DIR="$SCRIPTDIR/.letsencrypt"
    if [ "$(id -u)" -ne 0 ]; then
      mkdir -p "$LOCAL_LE_DIR"
      mkdir -p "$SCRIPTDIR/.letsencrypt-work" "$SCRIPTDIR/.letsencrypt-logs"
      CERTBOT_EXTRA_OPTS="--config-dir $LOCAL_LE_DIR --work-dir $SCRIPTDIR/.letsencrypt-work --logs-dir $SCRIPTDIR/.letsencrypt-logs"
      echo "Note: exécution sans privilèges — certbot utilisera des répertoires locaux: $LOCAL_LE_DIR"
    fi

    # Run certbot (manual DNS). If non-root, certs will be created under local config dir.
    if certbot certonly --manual --preferred-challenges dns -d "$DOMAIN" --agree-tos --email "admin@$DOMAIN" $CERTBOT_EXTRA_OPTS; then
      # Determine source live dir depending on whether certbot wrote system-wide or local
      if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ] && [ "$(id -u)" -eq 0 ]; then
        SRC_LIVE_DIR="/etc/letsencrypt/live/$DOMAIN"
      else
        SRC_LIVE_DIR="$LOCAL_LE_DIR/live/$DOMAIN"
      fi

      if [ -f "$SRC_LIVE_DIR/fullchain.pem" ] && [ -f "$SRC_LIVE_DIR/privkey.pem" ]; then
        mkdir -p "$SCRIPTDIR/certs"
        cp "$SRC_LIVE_DIR/fullchain.pem" "$SCRIPTDIR/certs/server.crt"
        cp "$SRC_LIVE_DIR/privkey.pem" "$SCRIPTDIR/certs/server.key"
        chmod 600 "$SCRIPTDIR/certs/server.key" || true
        env_set "SSL_CERT" "$SCRIPTDIR/certs/server.crt"
        env_set "SSL_KEY"  "$SCRIPTDIR/certs/server.key"
        echo "✓ Certificats Let's Encrypt configurés et copiés dans $SCRIPTDIR/certs."

        # If running as root and system hooks available, install deploy hook to restart service
        if [ "$(id -u)" -eq 0 ] && [ -d "/etc/letsencrypt/renewal-hooks/deploy" ]; then
          RENEW_HOOK="/etc/letsencrypt/renewal-hooks/deploy/vlr-server-restart.sh"
          cat > "$RENEW_HOOK" << 'HOOK'
#!/usr/bin/env bash
if command -v systemctl >/dev/null 2>&1 && systemctl is-active vlr-server >/dev/null 2>&1; then
  systemctl restart vlr-server
fi
HOOK
          chmod +x "$RENEW_HOOK" 2>/dev/null || true
          echo "✓ Hook de renouvellement automatique installé (system-wide)."
        fi

        # If non-root, install a user cron job to run renew and copy certs
        if [ "$(id -u)" -ne 0 ]; then
          RENEW_SCRIPT="$SCRIPTDIR/renew_letsencrypt.sh"
          cat > "$RENEW_SCRIPT" << RS
#!/usr/bin/env bash
SCRIPTDIR="\$(cd "\$(dirname "\$0")" && pwd)"
DOMAIN="${DOMAIN}"
LOCAL_LE_DIR="\$SCRIPTDIR/.letsencrypt"
certbot renew --config-dir "\$LOCAL_LE_DIR" --work-dir "\$SCRIPTDIR/.letsencrypt-work" --logs-dir "\$SCRIPTDIR/.letsencrypt-logs"
SRC_LIVE="\$LOCAL_LE_DIR/live/${DOMAIN}"
if [ -f "\$SRC_LIVE/fullchain.pem" ]; then
  cp "\$SRC_LIVE/fullchain.pem" "\$SCRIPTDIR/certs/server.crt"
  cp "\$SRC_LIVE/privkey.pem" "\$SCRIPTDIR/certs/server.key"
  chmod 600 "\$SCRIPTDIR/certs/server.key" || true
  # Redémarrer le serveur pour charger le nouveau certificat
  if [[ "\$(uname)" == "Darwin" ]] && [ -f "\$HOME/Library/LaunchAgents/com.vlr-server.plist" ]; then
    launchctl unload "\$HOME/Library/LaunchAgents/com.vlr-server.plist" 2>/dev/null || true
    launchctl load "\$HOME/Library/LaunchAgents/com.vlr-server.plist"
  elif command -v systemctl >/dev/null 2>&1 && systemctl is-active vlr-server >/dev/null 2>&1; then
    systemctl restart vlr-server
  fi
fi
RS
          chmod +x "$RENEW_SCRIPT" || true
          # add to user crontab if not present
          (crontab -l 2>/dev/null | grep -v -F "$RENEW_SCRIPT" || true; echo "0 3 * * * $RENEW_SCRIPT >/dev/null 2>&1") | crontab -
          echo "✓ Cron de renouvellement installé (user crontab)."
        fi
      else
        echo "⚠  Certificats introuvables après certbot — vérifiez l'emplacement." 
      fi
    else
      echo "⚠  certbot échoué — relancez l'option 1 après avoir configuré le DNS."
    fi
  else
    echo "⚠  certbot non disponible — HTTPS non configuré."
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
    <string>$NODEBIN</string><string>$SCRIPTDIR/veloroute.js</string>
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
ExecStart=$NODEBIN veloroute.js
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
    pm2 start veloroute.js --name "$SERVICE_NAME"
    echo "✓ Serveur démarré avec PM2."
  # Fallback : background pid
  else
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      kill "$(cat "$PIDFILE")" && sleep 1
    fi
    nohup node veloroute.js >> "$LOGFILE" 2>&1 &
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

# ── 6) Renouveler le certificat ─────────────────────────────────────────
6)
  [ ! -f "$ENV_FILE" ] && echo "⚠  .env introuvable — lancez d'abord l'installation (option 1)." && read -rp "Entrée…" && continue
  # Déterminer le script de renouvellement
  RENEW_SCRIPT="$SCRIPTDIR/renew_letsencrypt.sh"
  if [ -f "$RENEW_SCRIPT" ]; then
    echo "Lancement du renouvellement…"
    bash "$RENEW_SCRIPT" && echo "✓ Certificat renouvelé et serveur redémarré." || echo "⚠  Renouvellement échoué — vérifiez les logs certbot."
  else
    # Renouvellement direct sans script (installation root / system certbot)
    domain_val="$(grep '^DOMAIN=' "$ENV_FILE" | cut -d= -f2)"
    if command -v certbot >/dev/null 2>&1 && [ -n "$domain_val" ]; then
      LOCAL_LE_DIR="$SCRIPTDIR/.letsencrypt"
      if [ -d "$LOCAL_LE_DIR" ]; then
        certbot renew --config-dir "$LOCAL_LE_DIR" --work-dir "$SCRIPTDIR/.letsencrypt-work" --logs-dir "$SCRIPTDIR/.letsencrypt-logs"
      else
        certbot renew
      fi
      # Copier les certs mis à jour
      SRC_LIVE="/etc/letsencrypt/live/$domain_val"
      [ -d "$LOCAL_LE_DIR/live/$domain_val" ] && SRC_LIVE="$LOCAL_LE_DIR/live/$domain_val"
      if [ -f "$SRC_LIVE/fullchain.pem" ]; then
        mkdir -p "$SCRIPTDIR/certs"
        cp "$SRC_LIVE/fullchain.pem" "$SCRIPTDIR/certs/server.crt"
        cp "$SRC_LIVE/privkey.pem" "$SCRIPTDIR/certs/server.key"
        chmod 600 "$SCRIPTDIR/certs/server.key" || true
        echo "✓ Certificats copiés."
        echo "Redémarrage du serveur…"
        bash "$0" 3 2>/dev/null || true
      fi
    else
      echo "⚠  certbot introuvable ou DOMAIN non configuré."
    fi
  fi
  read -rp "   Appuyez sur Entrée pour revenir au menu…"
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
