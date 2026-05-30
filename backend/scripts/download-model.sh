#!/usr/bin/env bash
# DSOS built-in LLM model downloader (macOS / Linux / Git Bash).
#
# Pulls MythoMax-L2-13B Q4_K_M (~7.4 GB) from Hugging Face into backend/models/.
# That file is gitignored — every fresh clone needs to run this once before
# the built-in Shadows backend will work.
#
# Run from anywhere:
#   bash backend/scripts/download-model.sh

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
models_dir="$(cd "$script_dir/.." && pwd)/models"
mkdir -p "$models_dir"

file_name="mythomax-l2-13b.Q4_K_M.gguf"
dest="$models_dir/$file_name"
url="https://huggingface.co/TheBloke/MythoMax-L2-13B-GGUF/resolve/main/$file_name"

if [ -f "$dest" ]; then
  size_mb=$(( $(stat -c%s "$dest" 2>/dev/null || stat -f%z "$dest") / 1024 / 1024 ))
  echo "[skip] $file_name already exists (${size_mb} MB)"
  echo "       delete it first if you want to re-download."
  exit 0
fi

echo "[dsos] Downloading MythoMax-L2-13B Q4_K_M (~7.4 GB) from Hugging Face..."
echo "       source: $url"
echo "       dest:   $dest"
echo

if command -v curl >/dev/null 2>&1; then
  curl -L --fail --progress-bar --output "$dest" "$url"
elif command -v wget >/dev/null 2>&1; then
  wget --show-progress -O "$dest" "$url"
else
  echo "[error] neither curl nor wget found. Install one and re-run." >&2
  exit 1
fi

size_gb=$(awk -v b="$(stat -c%s "$dest" 2>/dev/null || stat -f%z "$dest")" 'BEGIN{printf "%.2f", b/1024/1024/1024}')
echo
echo "[done] $file_name downloaded (${size_gb} GB)"
echo "       Built-in Shadows backend should now work after npm run dev."
