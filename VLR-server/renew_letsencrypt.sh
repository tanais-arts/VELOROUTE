#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
#  Renouvellement du certificat Let's Encrypt
#  Relié au menu VLR-server (install.sh → option 6)
#
#  Auto-détecte l'authenticator utilisé par le compte certbot existant :
#   - dns-ovh  → renouvellement 100% automatique (`certbot renew`), aucune
#                interaction requise (nécessite d'avoir activé le plugin
#                certbot-dns-ovh via install.sh → option 1).
#   - manual   → challenge DNS interactif : certbot affiche l'enregistrement
#                TXT à créer, puis attend "Press Enter to Continue". Il
#                suffit d'ajouter le TXT chez son fournisseur DNS, d'attendre
#                la propagation, puis de valider dans le terminal.
#  Dans les deux cas, on vérifie que la date d'expiration a réellement
#  changé avant de copier les certs / redémarrer le serveur : `certbot
#  renew` peut retourner un code de sortie 0 même quand le renouvellement
#  a échoué ("All renewals failed" avec exit 0 selon les versions).
# ═══════════════════════════════════════════════════════════════════════
set -e
SCRIPTDIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPTDIR/.env"

DOMAIN="hub.studios-voa.com"
if [ -f "$ENV_FILE" ]; then
  ENV_DOMAIN="$(grep '^DOMAIN=' "$ENV_FILE" | cut -d= -f2)"
  [ -n "$ENV_DOMAIN" ] && DOMAIN="$ENV_DOMAIN"
fi

LOCAL_LE_DIR="$SCRIPTDIR/.letsencrypt"
WORK_DIR="$SCRIPTDIR/.letsencrypt-work"
LOGS_DIR="$SCRIPTDIR/.letsencrypt-logs"
mkdir -p "$LOCAL_LE_DIR" "$WORK_DIR" "$LOGS_DIR"

SRC_LIVE="$LOCAL_LE_DIR/live/$DOMAIN"
RENEWAL_CONF="$LOCAL_LE_DIR/renewal/$DOMAIN.conf"

AUTHENTICATOR="manual"
if [ -f "$RENEWAL_CONF" ]; then
  CONF_AUTH="$(grep '^authenticator' "$RENEWAL_CONF" | cut -d= -f2 | tr -d ' ')"
  [ -n "$CONF_AUTH" ] && AUTHENTICATOR="$CONF_AUTH"
fi

# Date d'expiration AVANT renouvellement, pour détecter un faux-succès.
BEFORE_ENDDATE=""
[ -f "$SRC_LIVE/fullchain.pem" ] && BEFORE_ENDDATE="$(openssl x509 -enddate -noout -in "$SRC_LIVE/fullchain.pem" 2>/dev/null)"

if [ "$AUTHENTICATOR" = "dns-ovh" ]; then
  echo "→ Renouvellement automatique via certbot-dns-ovh (aucune action requise)…"
  RENEW_EXIT=0
  certbot renew --config-dir "$LOCAL_LE_DIR" --work-dir "$WORK_DIR" --logs-dir "$LOGS_DIR" || RENEW_EXIT=$?
else
  echo "╔══════════════════════════════════════════════════╗"
  echo "║  Renouvellement Let's Encrypt — $DOMAIN"
  echo "╚══════════════════════════════════════════════════╝"
  echo ""
  echo "→ Certbot va afficher un enregistrement DNS TXT à créer."
  echo "  Ajoutez-le chez votre fournisseur DNS (ex: OVH → Zone DNS → Ajouter → TXT),"
  echo "  attendez ~1-2 min de propagation, puis appuyez sur Entrée dans certbot"
  echo "  pour continuer et valider la demande."
  echo ""
  echo "  ℹ  Astuce : pour un renouvellement 100% automatique sans intervention,"
  echo "     relancez install.sh → option 1 et activez le plugin certbot-dns-ovh."
  echo ""

  RENEW_EXIT=0
  certbot certonly --manual --preferred-challenges dns \
    -d "$DOMAIN" \
    --agree-tos --email "admin@$DOMAIN" \
    --config-dir "$LOCAL_LE_DIR" \
    --work-dir "$WORK_DIR" \
    --logs-dir "$LOGS_DIR" || RENEW_EXIT=$?
fi

AFTER_ENDDATE=""
[ -f "$SRC_LIVE/fullchain.pem" ] && AFTER_ENDDATE="$(openssl x509 -enddate -noout -in "$SRC_LIVE/fullchain.pem" 2>/dev/null)"

if [ "$RENEW_EXIT" -ne 0 ] || [ -z "$AFTER_ENDDATE" ] || { [ -n "$BEFORE_ENDDATE" ] && [ "$BEFORE_ENDDATE" = "$AFTER_ENDDATE" ]; }; then
  echo "✗ Certificat NON renouvelé (date d'expiration inchangée) — ancien certificat conservé, pas de redémarrage." >&2
  exit 1
fi

if [ -f "$SRC_LIVE/fullchain.pem" ] && [ -f "$SRC_LIVE/privkey.pem" ]; then
  mkdir -p "$SCRIPTDIR/certs"
  cp "$SRC_LIVE/fullchain.pem" "$SCRIPTDIR/certs/server.crt"
  cp "$SRC_LIVE/privkey.pem" "$SCRIPTDIR/certs/server.key"
  chmod 600 "$SCRIPTDIR/certs/server.key" || true
  echo ""
  echo "✓ Certificats copiés dans $SCRIPTDIR/certs"

  # Redémarrer le serveur pour charger le nouveau certificat
  if [[ "$(uname)" == "Darwin" ]] && [ -f "$HOME/Library/LaunchAgents/com.vlr-server.plist" ]; then
    launchctl unload "$HOME/Library/LaunchAgents/com.vlr-server.plist" 2>/dev/null || true
    launchctl load "$HOME/Library/LaunchAgents/com.vlr-server.plist"
    echo "✓ Serveur redémarré (launchd)."
  elif command -v systemctl >/dev/null 2>&1 && systemctl is-active vlr-server >/dev/null 2>&1; then
    systemctl restart vlr-server
    echo "✓ Serveur redémarré (systemd)."
  fi

  echo ""
  echo "Nouvelle validité du certificat :"
  openssl x509 -in "$SCRIPTDIR/certs/server.crt" -noout -dates
else
  echo "⚠  Certificats introuvables après certbot — le renouvellement a peut-être échoué."
  exit 1
fi
