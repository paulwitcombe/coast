#!/bin/bash
# Saves the ADMIRALTY UK Tidal API key for the Coast plugin without echoing it.
set -e
mkdir -p ~/.config/omarchy/coast
read -rs -p "Paste your ADMIRALTY primary key, then press Enter: " key
echo
key="${key//[[:space:]]/}"
if [[ -z $key ]]; then echo "Nothing pasted; nothing saved."; exit 1; fi
umask 077
printf '%s' "$key" > ~/.config/omarchy/coast/admiralty-key
echo "saved (${#key} characters)"
