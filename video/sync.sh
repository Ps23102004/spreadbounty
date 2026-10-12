#!/bin/sh
# Copies the shared design system (CSS, helpers, fonts, real UI captures) into each HyperFrames project
# and synthesizes each project's SFX. HyperFrames refuses asset paths above a project root, so each project carries its own copy.
set -eu
cd "$(dirname "$0")"
for p in launch demo stills/hero stills/social; do
  [ -d "$p" ] || continue
  mkdir -p "$p/assets/fonts"
  cp shared/spreadbounty.css shared/hf.js shared/grain.png "$p/assets/"
  cp shared/fonts/*.woff2 "$p/assets/fonts/"
  grep -q 'assets/ui/' "$p/index.html" && mkdir -p "$p/assets/ui" && cp shared/ui/*.png "$p/assets/ui/"  # only projects that show app screens
  [ -f "$p/sfx-cues.json" ] && python3 shared/sfx.py "$p/sfx-cues.json" "$p/assets/sfx.wav" "$(python3 -c "import re;print(re.search(r'data-duration=\"([0-9.]+)\"', open('$p/index.html').read()).group(1))")"
  true
done
