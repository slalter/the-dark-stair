#!/usr/bin/env bash
# Orc-ification pass for Gruk (widget 7d44aa28: 'needs to sound more like an
# orc — more growly or grumbly — and his voice is louder' [than the rest]).
# Sources: tools/voice_orig/gruk/. Output: web/audio/gruk/.
# Chain: ~6% pitch drop (size), asubboost (chest rumble), light bitcrush
# (acrusher — gravel in the throat), then loudnorm to the SAME target as the
# Lich pass so no line jumps out louder than another.
set -euo pipefail
FF=${FF:-/home/devuser/bin/ffmpeg}
SRC="$(dirname "$0")/voice_orig/gruk"
DST="$(dirname "$0")/../web/audio/gruk"
for f in "$SRC"/*.mp3; do
  base=$(basename "$f")
  "$FF" -y -v error -i "$f" -af \
    "asetrate=24000*0.94,aresample=24000,atempo=1.0638,asubboost=dry=0.6:wet=0.8:boost=1.6:decay=0.2:feedback=0.6:cutoff=120,acrusher=level_in=1:level_out=1:bits=12:mode=log:mix=0.25,highpass=f=70,lowpass=f=6500,loudnorm=I=-16:TP=-1.5:LRA=11" \
    -b:a 96k "$DST/$base"
  echo "orcified: $base"
done
