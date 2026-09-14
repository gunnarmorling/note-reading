#!/bin/sh
# One image per note, per clef: a single whole note on a treble or a bass
# staff, across the whole two-ledger range — 17 notes a clef, 34 files.
#
#   _tools/note-images.sh --output-dir=DIR [--type=svg|png|ALL] [--size=PX]
#
#   --output-dir  where the files go; created if missing
#   --type        svg (default), png, or ALL for both
#   --size        width of the PNGs in pixels (default 900); height follows
#
# The drawing matches the drill's single-clef staff in staff.js, at three
# quarters of its width with the note centred: the same Bravura outlines,
# line and ledger thicknesses, and vertical geometry from notes.js. Those are
# copied in below, so a change to the staff there wants making here too.
# Every file of a clef gets the same box, the one that fits the clef's whole
# range, so the staff doesn't move when flipping between them.
#
# Files are named clef-number-note, numbered from the lowest note up, with
# the app's note names: treble-01-A3.svg ... treble-17-C6.svg, bass-03-E2.png.
#
# SVGs are written with sh and awk alone. PNGs are rendered from them by
# rsvg-convert (librsvg; `brew install librsvg`) if it is installed, or else
# ImageMagick, on a white background.

set -eu

usage() {
  echo "usage: $0 --output-dir=DIR [--type=svg|png|ALL] [--size=PX]" >&2
  exit 2
}

fail() {
  echo "$1" >&2
  echo >&2
  usage
}

output_dir=
type=svg
size=900

while [ $# -gt 0 ]; do
  case $1 in
    --output-dir=*) output_dir=${1#*=} ;;
    --type=*) type=${1#*=} ;;
    --size=*) size=${1#*=} ;;
    --output-dir | --type | --size)
      [ $# -ge 2 ] || fail "$1 needs a value"
      case $1 in
        --output-dir) output_dir=$2 ;;
        --type) type=$2 ;;
        --size) size=$2 ;;
      esac
      shift
      ;;
    -h | --help) usage ;;
    *) fail "unknown argument: $1" ;;
  esac
  shift
done

[ -n "$output_dir" ] || fail "--output-dir is required"
type=$(printf '%s' "$type" | tr '[:upper:]' '[:lower:]')
case $type in
  svg | png | all) ;;
  *) fail "--type must be svg, png or ALL, not $type" ;;
esac
case $size in
  '' | *[!0-9]* | 0*) fail "--size must be a positive whole number, not $size" ;;
esac

render=
if [ "$type" != svg ]; then
  if command -v rsvg-convert >/dev/null 2>&1; then
    render=rsvg
  elif command -v magick >/dev/null 2>&1; then
    render=magick
  elif command -v convert >/dev/null 2>&1; then
    render=convert
  else
    echo "PNGs need rsvg-convert (librsvg) or ImageMagick, and neither is installed" >&2
    exit 1
  fi
fi

mkdir -p "$output_dir"

# SVGs go to a scratch directory when only PNGs are wanted.
if [ "$type" = png ]; then
  svg_dir=$(mktemp -d)
  trap 'rm -rf "$svg_dir"' EXIT
else
  svg_dir=$output_dir
fi

G_CLEF='M15.04 -16.6C14.96 -17.08 15.04 -17.12 15.28 -17.36C15.92 -17.96 16.76 -18.8 17.52 -19.64C20.88 -23.32 22.88 -28.08 22.88 -32.6C22.88 -36.08 21.92 -39.52 20.28 -41.92C19.68 -42.8 18.64 -43.92 18.2 -43.92C17.64 -43.92 16.4 -42.88 15.6 -42C12.64 -38.72 11.68 -33.72 11.68 -29.56C11.68 -27.24 11.96 -24.64 12.24 -23C12.32 -22.52 12.36 -22.44 11.88 -22.04C9.32 -19.92 6.56 -17.48 4.48 -14.92C1.72 -11.48 0 -7.76 0 -3.48C0 3.48 4.76 10.08 14.56 10.08C15.48 10.08 16.52 10 17.32 9.84C17.76 9.76 17.84 9.72 17.92 10.2C18.4 12.88 19 16.36 19 18.24C19 24.16 15 24.88 12.64 24.88C10.48 24.88 9.44 24.24 9.44 23.72C9.44 23.44 9.8 23.32 10.72 23.04C11.96 22.68 13.4 21.6 13.4 19.28C13.4 17.08 12 15.2 9.56 15.2C6.88 15.2 5.28 17.32 5.28 19.8C5.28 22.4 6.84 26.32 12.88 26.32C15.56 26.32 20.76 25.12 20.76 18.32C20.76 16.04 20.04 12.24 19.6 9.76C19.52 9.28 19.56 9.32 20.12 9.08C24.16 7.48 26.84 4.08 26.84 -0.44C26.84 -5.56 23.08 -10.08 17.2 -10.08C16.16 -10.08 16.16 -10.08 16.04 -10.8ZM18.8 -37.72C20.12 -37.72 21.2 -36.64 21.2 -34.44C21.2 -31.68 19.88 -29.12 16.76 -26C16.12 -25.36 15.16 -24.44 14.24 -23.64C13.96 -23.4 13.8 -23.44 13.72 -23.96C13.56 -25 13.48 -26.36 13.48 -27.64C13.48 -33.88 16.36 -37.72 18.8 -37.72ZM14.44 -10.48C14.56 -9.72 14.56 -9.76 13.84 -9.52C10.32 -8.32 8.04 -5.16 8.04 -1.76C8.04 1.84 9.92 4.4 12.64 5.32C12.96 5.44 13.44 5.56 13.72 5.56C14.04 5.56 14.2 5.36 14.2 5.12C14.2 4.84 13.88 4.72 13.6 4.6C11.92 3.88 10.72 2.16 10.72 0.32C10.72 -1.96 12.28 -3.68 14.72 -4.36C15.36 -4.52 15.44 -4.48 15.52 -4.04L17.52 7.88C17.6 8.32 17.56 8.32 16.96 8.44C16.32 8.56 15.52 8.64 14.72 8.64C7.72 8.64 3.2 4.76 3.2 -0.8C3.2 -3.16 3.6 -6.32 6.92 -10.08C9.32 -12.76 11.16 -14.24 13.04 -15.76C13.44 -16.08 13.52 -16.04 13.6 -15.6ZM17.2 -4.12C17.12 -4.6 17.16 -4.72 17.64 -4.68C20.88 -4.4 23.56 -1.68 23.56 1.84C23.56 4.36 22.04 6.4 19.8 7.52C19.32 7.76 19.24 7.76 19.16 7.28Z'
F_CLEF='M10.08 -10.48C3.12 -10.48 0 -5.4 0 -1.56C0 1.64 1.68 4.4 4.92 4.4C7.44 4.4 9.16 2.64 9.16 0.16C9.16 -2.4 7.28 -4 5.32 -4C4.24 -4 3.84 -3.72 3.32 -3.72C2.8 -3.72 2.68 -4.04 2.68 -4.44C2.68 -6.04 5.08 -8.96 9.16 -8.96C13.4 -8.96 15.24 -4.8 15.24 1.48C15.24 5.6 14.36 10.4 11.88 14.24C9.48 17.96 5.36 21.36 0.4 24.2C0.04 24.4 -0.2 24.6 -0.2 24.92C-0.2 25.16 -0.04 25.4 0.32 25.4C0.52 25.4 0.76 25.32 1 25.2C6.32 22.6 11.44 19.56 15.68 15C19.16 11.24 21.24 6.36 21.24 1.12C21.24 -5.84 17 -10.48 10.08 -10.48ZM25.16 -7.2C23.92 -7.2 22.96 -6.24 22.96 -5C22.96 -3.76 23.92 -2.8 25.16 -2.8C26.4 -2.8 27.36 -3.76 27.36 -5C27.36 -6.24 26.4 -7.2 25.16 -7.2ZM25.2 2.84C23.96 2.84 23.04 3.76 23.04 5C23.04 6.24 23.96 7.16 25.2 7.16C26.44 7.16 27.36 6.24 27.36 5C27.36 3.76 26.44 2.84 25.2 2.84Z'
WHOLE_NOTE='M8.64 -5C3.32 -5 0 -2.8 0 -0.08C0 2.6 2.28 5 8.24 5C14.8 5 16.88 2.72 16.88 -0.08C16.88 -2.92 12.36 -5 8.64 -5ZM4.44 -2.52C4.88 -3.92 6.36 -4.12 7.6 -4.12C10.36 -4.12 12.56 -1.16 12.56 1.24C12.56 1.52 12.52 1.76 12.48 2C12.28 3 11.72 3.68 10.72 3.92C10.32 4.04 9.88 4.08 9.48 4.08C9.12 4.08 8.8 4.04 8.44 3.92C7.76 3.72 7.12 3.36 6.56 2.88C6.24 2.6 5.96 2.32 5.72 2C4.92 1.08 4.32 -0.28 4.32 -1.56C4.32 -1.88 4.36 -2.2 4.44 -2.52Z'

# Writes the SVGs and prints how many notes there are, then each one's name,
# without extension, as it goes.
awk -v dir="$svg_dir" -v gclef="$G_CLEF" -v fclef="$F_CLEF" -v note="$WHOLE_NOTE" '
function num(v) {
  v = sprintf("%.2f", v)
  sub(/0+$/, "", v)
  sub(/\.$/, "", v)
  return v == "-0" ? "0" : v
}
function rect(x, y, w, h) {
  return "<rect x=\"" num(x) "\" y=\"" num(y) "\" width=\"" num(w) "\" height=\"" num(h) "\"/>"
}
# One clef: its glyph, where its origin sits, its top staff line, the
# diatonic number of its bottom line, and the top of its box.
function clef(name, glyph, glyphY, top, bottomLine, boxTop,    dn, i, y, ly, out, file, octave) {
  for (dn = bottomLine - 4; dn <= bottomLine + 12; dn++) {
    y = top + 40 - (dn - bottomLine) * 5
    out = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"-4 " boxTop " " (WIDTH + 8) " 96\" width=\"" (WIDTH + 8) "\" height=\"96\" fill=\"#241a12\">"
    for (i = 0; i < 5; i++) out = out rect(0, top + i * 10 - LINE / 2, WIDTH, LINE)
    out = out "<g transform=\"translate(10 " glyphY ")\"><path d=\"" glyph "\"/></g>"
    for (ly = top + 50; ly <= y; ly += 10) out = out rect(NOTE_X - LEDGER_EXT, ly - LEDGER / 2, HEAD + 2 * LEDGER_EXT, LEDGER)
    for (ly = top - 10; ly >= y; ly -= 10) out = out rect(NOTE_X - LEDGER_EXT, ly - LEDGER / 2, HEAD + 2 * LEDGER_EXT, LEDGER)
    out = out "<path d=\"" note "\" transform=\"translate(" num(NOTE_X) " " num(y) ")\"/></svg>"
    octave = int(dn / 7)
    file = sprintf("%s-%02d-%s%d", name, dn - bottomLine + 5, substr("CDEFGAH", dn - octave * 7 + 1, 1), octave)
    print out > (dir "/" file ".svg")
    close(dir "/" file ".svg")
    print file
  }
}
BEGIN {
  WIDTH = 225          # three quarters of the drill staff
  HEAD = 16.88         # notehead width
  NOTE_X = WIDTH / 2 - HEAD / 2
  LINE = 1.3
  LEDGER = 1.6
  LEDGER_EXT = 4
  # Diatonic numbers are octave * 7 + letter, C = 0. The range runs from two
  # ledger lines below the staff to two above: bottom line - 4 to + 12.
  print 2 * 17
  clef("treble", gclef, 30, 0, 4 * 7 + 2, -28)   # bottom line E4
  clef("bass", fclef, 90, 80, 2 * 7 + 4, 52)     # bottom line G2
}
' | {
  read -r total
  count=0
  n=0
  while read -r name; do
    if [ -n "$render" ]; then
      svg=$svg_dir/$name.svg
      png=$output_dir/$name.png
      case $render in
        rsvg) rsvg-convert --width="$size" --keep-aspect-ratio --background-color=white "$svg" -o "$png" ;;
        *) $render -background white -density 1200 "$svg" -flatten -resize "${size}x" "$png" ;;
      esac
      count=$((count + 1))
    fi
    [ "$type" = png ] || count=$((count + 1))
    n=$((n + 1))
    echo "Generated $name $n/$total"
  done
  echo "$count files written to $output_dir"
}
