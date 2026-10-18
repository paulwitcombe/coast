#!/bin/bash
# Saves the ADMIRALTY UK Tidal API key for the Coast plugin without echoing it.
set -e
umask 077
folder="${XDG_CONFIG_HOME:-$HOME/.config}/omarchy/coast"
mkdir -p "$folder"
read -rs -p "Paste your ADMIRALTY primary key, then press Enter: " key
echo
key="${key//[[:space:]]/}"
if [[ -z $key ]]; then echo "Nothing pasted; nothing saved."; exit 1; fi
printf '%s' "$key" > "$folder/admiralty-key"
# umask only applies to new files; tighten one that already existed.
chmod 600 "$folder/admiralty-key"
echo "saved (${#key} characters)"
