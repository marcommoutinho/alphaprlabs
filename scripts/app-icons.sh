#!/usr/bin/env bash
# Regenerates the installed app's icons (public/app-icons/) from the logo with
# ImageMagick. The logo's white mark is lifted off its black square and placed
# on the app background #050505, so no darker square shows on the icon.
# The public site's favicon and apple-touch-icon are separate and untouched.
set -euo pipefail
cd "$(dirname "$0")/.."

src=docs/design/research-app/assets/logo.jpeg
out=public/app-icons
bg='#050505'
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$out"

# White mark whose opacity is the logo's brightness.
convert "$src" -colorspace Gray -alpha off \( +clone -fill white -colorize 100 \) +swap \
  -compose CopyOpacity -composite "$tmp/mark.png"

# icon <size> <mark size as % of the canvas> <file>
icon() {
  convert -size "$1x$1" "xc:$bg" \( "$tmp/mark.png" -resize "$(($1 * $2 / 100))x" \) \
    -gravity center -compose over -composite -strip -depth 8 -define png:color-type=2 "$out/$3"
}

icon 192 100 icon-192.png
icon 512 100 icon-512.png
icon 180 100 apple-touch-icon.png
# Maskable: launchers crop to a shape inside the central 80% circle, so the
# mark keeps to ~70% of the canvas.
icon 512 70 icon-maskable-512.png
