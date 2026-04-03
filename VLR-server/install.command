#!/usr/bin/env bash
# Double-clic sur macOS pour ouvrir le menu d'installation dans un Terminal
cd "$(dirname "$0")"
open -a Terminal "$(pwd)/install.sh"
