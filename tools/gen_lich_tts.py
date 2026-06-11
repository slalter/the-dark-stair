#!/usr/bin/env python3
"""Render Vyrakhel the Lich's lines via Gemini-TTS directed performances.

The voice is a DIRECTED PERFORMANCE, not a filtered read: Gemini-TTS takes a
director's note per line (user-selected persona 2026-06-10: "The Delighted" —
predatory amusement, a smile you can hear). Each line layers a situational
tweak on the base persona. No post-processing by default — the user chose the
raw directed read; ``--filter`` re-applies the legacy undead ffmpeg treatment.

Output: arcane_depths/web/audio/lich/<trigger>.mp3

Usage:
    python3 arcane_depths/tools/gen_lich_tts.py [--only trigger] [--filter]

Auth: `gcloud auth print-access-token` (service-account ADC on dev VMs).
Requires Cloud Text-to-Speech API (Gemini-TTS via v1beta1) on the project.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import shutil
import subprocess
import sys
import urllib.request

# Mirrors LICH_LINES in arcane_depths/web/js/game.js — keep in sync.
LINES = {
    "firstKill": "The first death always feels like a promise. It isn't yours to keep.",
    "firstBlood": "Yes. Bleed a little. It suits you.",
    "eliteKill": "That one owed me service. Add its debt to yours.",
    "shrineGift": "Borrowed power. I know the lender personally.",
    "shrineCurse": "The shrine and I have an arrangement. Thank you for contributing.",
    "goldChest": "Gold. How small your dreams are, little thief.",
    "grukDead": "Gruk served me in life. He will again. They all do.",
    "floor4": "Halfway. No one writes songs about halfway.",
    "flawless": "Careful one. Care is only fear, walking slowly.",
    "lastPotion": "The last drop. Savor it. I would.",
    "lowHp": "I can hear your heartbeat from six floors down. It stumbles.",
    "echo": "You've been here before. You'll be here again.",
    "darkStair": "The dark stair? Bold. It eats the slow ones, you know.",
    "enrage": "Enough. No more games, little thing — come and die.",
    "lichDeath": "Ah. A pause, then. I have died before. Finish your lap, little champion.",
}

# Base persona — winner of the 4-round voice A/B (review 0615e7d2).
PERSONA = (
    "You are Vyrakhel, an ancient lich darkly DELIGHTED by the adventurer "
    "intruding on your tomb. Playful cruelty, a smile you can hear, almost "
    "laughing at the end of phrases. Predatory amusement. "
    "Speak at a natural conversational pace — do NOT slow down or drag the words."
)

# Situational layer per line — how the Delighted plays each moment.
DIRECTIONS = {
    "firstKill": "Savoring the irony of their first kill, like a private joke.",
    "firstBlood": "Almost purring with satisfaction at the sight of their blood.",
    "eliteKill": "Mock indignation that melts straight back into amusement.",
    "shrineGift": "Conspiratorial — you are both in on the same crooked deal.",
    "shrineCurse": "Barely containing laughter at their misfortune.",
    "goldChest": "Scornful, toying — wealth is beneath you both.",
    "grukDead": "Briefly fond, almost nostalgic, then darkly certain.",
    "floor4": "Dismissive taunting — halfway is nothing and you both know it.",
    "flawless": "Intrigued, circling them like something new on the menu.",
    "lastPotion": "Mock sympathy, relishing their dwindling options.",
    "lowHp": "Leaning in close, delighted — triumph is near and it tastes good.",
    "echo": "Knowing and final, amused by the wheel turning again.",
    "darkStair": "Delighted surprise — impressed despite himself, like watching prey do something interesting.",
    "enrage": "The smile finally drops — sudden cold fury, the amusement gone in an instant.",
    "lichDeath": "Defeated but utterly unbothered — a knowing smile through dissolution, promising return.",
}

# --- Gruk (render with --gruk): the dumb brutal counterpoint ---
GRUK_PERSONA = (
    "You are Gruk, a hulking orc warlord: dumb, brutal, immensely proud. "
    "Shout in short happy bursts — delighted by violence, confused by cleverness. "
    "Deep, guttural, booming. Speak at a natural pace — do NOT slow down."
)
GRUK_VOICE = {"languageCode": "en-US", "name": "Fenrir", "model_name": "gemini-2.5-pro-tts"}
GRUK_LINES = {
    "notice": "Fresh meat comes down the stair! Gruk was getting bored!",
    "windup": "Hold still! Gruk only needs ONE swing!",
    "axeThrow": "Gruk's axe flies faster than you run!",
    "leash": "Run, little meal! Gruk guards the stairs. Gruk always guards.",
}
GRUK_DIRECTIONS = {
    "notice": "Genuine delight, like a dog hearing the doorbell.",
    "windup": "Roared mid-swing, full of glee.",
    "axeThrow": "Boastful, laughing as he throws.",
    "leash": "Dismissive bellow at fleeing prey, then satisfied.",
}

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_DIR = os.path.join(REPO_ROOT, "arcane_depths", "web", "audio", "lich")
TTS_URL = "https://texttospeech.googleapis.com/v1beta1/text:synthesize"
VOICE = {"languageCode": "en-US", "name": "Charon", "model_name": "gemini-2.5-pro-tts"}

# Legacy undead treatment (pre-Gemini pipeline); opt-in via --filter.
LICH_FILTER = (
    "[0:a]asplit=2[dry][wet];"
    "[wet]asetrate=24000*0.92,atempo=1.0870,volume=0.55[deep];"
    "[dry][deep]amix=inputs=2:duration=first:normalize=0,"
    "aecho=0.8:0.82:48|112:0.28|0.18,"
    "highpass=f=55,alimiter=limit=0.95"
)


def access_token() -> str:
    return subprocess.run(
        ["gcloud", "auth", "print-access-token"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()


def synthesize(trigger: str, token: str) -> bytes:
    """One directed Gemini-TTS call -> LINEAR16 WAV bytes (24 kHz)."""
    body = json.dumps({
        "input": {"prompt": f"{PERSONA} {DIRECTIONS[trigger]}", "text": LINES[trigger]},
        "voice": VOICE,
        "audioConfig": {"audioEncoding": "LINEAR16", "sampleRateHertz": 24000},
    }).encode()
    req = urllib.request.Request(
        TTS_URL, data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        payload = json.load(resp)
    return base64.b64decode(payload["audioContent"])


def find_ffmpeg() -> str | None:
    for cand in (shutil.which("ffmpeg"), os.path.expanduser("~/bin/ffmpeg")):
        if cand and os.path.exists(cand):
            return cand
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="render a single trigger")
    ap.add_argument("--filter", action="store_true",
                    help="apply the legacy undead ffmpeg treatment on top of the directed read")
    ap.add_argument("--gruk", action="store_true", help="render GRUK_LINES instead (audio/gruk/)")
    args = ap.parse_args()

    # character routing: shared pipeline, different persona/voice/output dir
    global PERSONA, DIRECTIONS, LINES, VOICE, OUT_DIR
    if args.gruk:
        PERSONA, DIRECTIONS, LINES, VOICE = GRUK_PERSONA, GRUK_DIRECTIONS, GRUK_LINES, GRUK_VOICE
        OUT_DIR = os.path.join(REPO_ROOT, "arcane_depths", "web", "audio", "gruk")

    os.makedirs(OUT_DIR, exist_ok=True)
    token = access_token()
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        print("ERROR: ffmpeg required for mp3 encode (static build at ~/bin/ffmpeg)")
        return 1

    targets = [args.only] if args.only else list(LINES)
    for trigger in targets:
        wav = synthesize(trigger, token)
        wav_path = os.path.join(OUT_DIR, f"{trigger}.wav")
        with open(wav_path, "wb") as f:
            f.write(wav)
        mp3_path = os.path.join(OUT_DIR, f"{trigger}.mp3")
        cmd = [ffmpeg, "-y", "-loglevel", "error", "-i", wav_path]
        if args.filter:
            cmd += ["-filter_complex", LICH_FILTER]
        cmd += ["-ac", "1", "-b:a", "96k", mp3_path]
        subprocess.run(cmd, check=True)
        os.remove(wav_path)
        print(f"{trigger}: {os.path.getsize(mp3_path)} bytes", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
