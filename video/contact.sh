#!/bin/sh
# Critique-loop contact sheet: one frame per shot, labelled. Usage: contact.sh <video.mp4> <out.png> <label@seconds>...
set -eu
v="$1"; out="$2"; shift 2
tmp=$(mktemp -d)
i=0
for spec in "$@"; do
  label="${spec%@*}"; t="${spec#*@}"
  /opt/homebrew/bin/ffmpeg -v error -ss "$t" -i "$v" -frames:v 1 -vf scale=960:-1 "$tmp/$(printf %02d $i).png"
  magick "$tmp/$(printf %02d $i).png" -gravity north -background '#222' -fill '#eee' -font /System/Library/Fonts/Menlo.ttc -pointsize 22 -splice 0x34 -annotate +0+5 "$label  @${t}s" "$tmp/$(printf %02d $i).png"
  i=$((i+1))
done
magick montage -font /System/Library/Fonts/Menlo.ttc "$tmp"/*.png -tile 2x -geometry +6+6 -background '#111' "$out"
rm -rf "$tmp"
echo "$out"
