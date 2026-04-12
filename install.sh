#!/bin/bash
set -e

if [ -z "$1" ]; then
  echo "Usage: ./install.sh /path/to/obsidian/vault"
  echo "Example: ./install.sh ~/Documents/MyVault"
  exit 1
fi

VAULT="$1"
PLUGIN="$VAULT/.obsidian/plugins/ai-briefing"

if [ ! -d "$VAULT/.obsidian" ]; then
  echo "Error: '$VAULT' does not look like an Obsidian vault (no .obsidian folder)"
  exit 1
fi

echo "Building plugin..."
npm install --silent
npm run build

echo "Installing to $PLUGIN"
mkdir -p "$PLUGIN"
cp main.js manifest.json styles.css "$PLUGIN/"

echo "Done! Restart Obsidian and enable 'AI Briefing' in Community plugins."
