#!/usr/bin/env bash
# Undead distortion pass for Vyrakhel's lines (user feedback 2026-06-11:
# "voice needs some kind of distortion to sound more... undead").
# Sources live in tools/voice_orig/lich/ (clean Gemini-TTS renders);
# output overwrites web/audio/lich/. Chain: ~7% pitch drop with duration
# kept (asetrate+atempo), doubled spectral ghost (chorus, all 6 param
# groups — ffmpeg errors on fewer), bone-hollow echo, low-mud cut.
set -euo pipefail
FF=${FF:-/home/devuser/bin/ffmpeg}
SRC="$(dirname "$0")/voice_orig/lich"
DST="$(dirname "$0")/../web/audio/lich"
for f in "$SRC"/*.mp3; do
  base=$(basename "$f")
  "$FF" -y -v error -i "$f" -af "asetrate=24000*0.93,aresample=24000,atempo=1.0753,chorus=0.7:0.9:55|75:0.35|0.3:0.6|0.5:2.2|2.8,aecho=0.8:0.55:60|110:0.22|0.13,highpass=f=110" -b:a 96k "$DST/$base"
  echo "distorted: $base"
done
