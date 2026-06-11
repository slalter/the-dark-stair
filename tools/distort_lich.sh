#!/usr/bin/env bash
# Undead distortion pass for Vyrakhel's lines, v2 — "as undead as possible
# while every word stays legible" (user directive 2026-06-11, judgment call).
# Sources: tools/voice_orig/lich/ (clean Gemini-TTS). Output: web/audio/lich/.
#
# The chain, and why:
#  - main voice: 12% pitch drop with duration preserved (asetrate+atempo) +
#    a slow tremolo (f=4.3, d=0.18) — breath that never steadies
#  - grave voice: the same line pitched ~38% down, lowpassed to a murmur and
#    mixed UNDER the main voice (weights 1 : 0.32) — the tomb answers him
#  - chorus (all 6 param groups or ffmpeg errors): spectral doubling
#  - aecho 90|150ms: a longer, bone-hollow cavern tail
#  - highpass 100 / lowpass 5800: kills mud AND mortal warmth
set -euo pipefail
FF=${FF:-/home/devuser/bin/ffmpeg}
SRC="$(dirname "$0")/voice_orig/lich"
DST="$(dirname "$0")/../web/audio/lich"
for f in "$SRC"/*.mp3; do
  base=$(basename "$f")
  "$FF" -y -v error -i "$f" -filter_complex \
    "[0:a]asetrate=24000*0.88,aresample=24000,atempo=1.1364,tremolo=f=4.3:d=0.18[main];\
     [0:a]asetrate=24000*0.62,aresample=24000,atempo=1.6129,lowpass=f=850,volume=1.0[grave];\
     [main][grave]amix=inputs=2:weights=1 0.32:normalize=0,\
     chorus=0.6:0.85:60|82:0.32|0.27:0.55|0.45:2.4|3.1,\
     aecho=0.8:0.5:90|150:0.24|0.13,highpass=f=100,lowpass=f=5800" \
    -b:a 96k "$DST/$base"
  echo "distorted v2: $base"
done
