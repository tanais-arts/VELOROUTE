#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
#  VLR-server — désinstallation complète
# ═══════════════════════════════════════════════════════════════════════
set -e
SCRIPTDIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_PATH="$HOME/Library/LaunchAgents/com.vlr-server.plist"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║    VLR-server — Désinstallation complète         ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "⚠  Cette opération va :"
echo "   • Arrêter et supprimer le service launchd / systemd"
echo "   • Tuer tous les processus veloroute.js / node :1666"
echo "   • Supprimer le cron de renouvellement SSL"
echo "   • Supprimer le dossier complet : $SCRIPTDIR"
echo ""
read -rp "Confirmer la désinstallation ? (oui/non) : " CONFIRM
if [[ "$CONFIRM" != "oui" ]]; then
  echo "Annulé."
  exit 0
fi
echo ""

# ── 1) Arrêt et suppression du service launchd (macOS) ────────────────
if [[ "$(uname)" == "Darwin" ]] && [ -f "$PLIST_PATH" ]; then
  echo "→ Arrêt du service launchd..."
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
  rm -f "$PLIST_PATH"
  echo "  ✓ Service launchd supprimé."
fi

# ── 2) Suppression du service systemd (Linux) ─────────────────────────
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files vlr-server.service >/dev/null 2>&1; then
  echo "→ Arrêt du service systemd..."
  systemctl stop vlr-server 2>/dev/null || true
  systemctl disable vlr-server 2>/dev/null || true
  rm -f /etc/systemd/system/vlr-server.service
  systemctl daemon-reload 2>/dev/null || true
  echo "  ✓ Service systemd supprimé."
fi

# ── 3) Tuer les processus restants ────────────────────────────────────
echo "→ Vérification des processus en cours..."
PIDS=$(pgrep -f "veloroute\.js" 2>/dev/null || true)
if [ -n "$PIDS" ]; then
  echo "  Processus trouvés : $PIDS — arrêt..."
  echo "$PIDS" | xargs kill -9 2>/dev/null || true
  echo "  ✓ Processus tués."
else
  echo "  Aucun processus veloroute.js en cours."
fi

# Tuer aussi un éventuel ancien server.js sur le port 1666
PORT_PID=$(lsof -ti tcp:1666 2>/dev/null || true)
if [ -n "$PORT_PID" ]; then
  echo "  Processus sur port 1666 (PID $PORT_PID) — arrêt..."
  kill -9 "$PORT_PID" 2>/dev/null || true
  echo "  ✓ Port 1666 libéré."
fi

# ── 4) Suppression du cron de renouvellement SSL ─────────────────────
RENEW_SCRIPT="$SCRIPTDIR/renew_letsencrypt.sh"
if crontab -l 2>/dev/null | grep -qF "$RENEW_SCRIPT"; then
  echo "→ Suppression du cron de renouvellement SSL..."
  (crontab -l 2>/dev/null | grep -vF "$RENEW_SCRIPT") | crontab -
  echo "  ✓ Cron supprimé."
fi

# ── 5) Suppression du dossier complet ────────────────────────────────
echo "→ Suppression du dossier $SCRIPTDIR ..."
cd "$HOME" || cd /tmp
rm -rf "$SCRIPTDIR"
echo "  ✓ Dossier supprimé."

echo ""
echo "✅ VLR-server désinstallé proprement."
echo ""
