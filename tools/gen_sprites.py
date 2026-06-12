#!/usr/bin/env python3
"""Generate entity sprites for Arcane Depths via Vertex AI Imagen 3.

For each entity: generate 1024px pixel-art on a solid magenta background,
chroma-key the background to alpha (edge flood fill + global magenta pass),
crop to content, and save a transparent PNG. Imagen quota is low (429s are
normal) so every call retries with exponential backoff and generation paces
itself between calls.

Output: arcane_depths/web/sprites/<id>.png

Usage:
    python3 arcane_depths/tools/gen_sprites.py [--only lich] [--px 48] [--missing]

Auth: `gcloud auth print-access-token` (service-account ADC). Requires
aiplatform.googleapis.com enabled on the active project.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from typing import cast

from PIL import Image

PROJECT = "gurucloudai-live"
MODEL = "imagen-3.0-generate-002"
ENDPOINT = (
    f"https://us-central1-aiplatform.googleapis.com/v1/projects/{PROJECT}"
    f"/locations/us-central1/publishers/google/models/{MODEL}:predict"
)

STYLE = (
    "16-bit pixel art game sprite of {desc}, single character, full body, "
    "centered, front view, dark fantasy roguelike style, crisp pixels, "
    "solid uniform bright magenta background, no text, no border, no ground shadow"
)

# Keyed by the ids the renderer uses (MONSTERS keys + player_<class>).
ENTITIES = {
    "player_warrior": "a stalwart human warrior in battered steel armor with sword and round shield, gold-yellow cloak",
    "player_rogue": "a hooded human rogue in dark green leathers gripping two daggers",
    "player_mage": "a human mage in flowing blue robes holding a glowing arcane staff",
    "player_gravedigger": "a grim human gravedigger in a tattered brown coat and wide-brimmed hat, gripping a long iron spade, lantern at his belt",
    "player_pilgrim": "a humble human pilgrim in threadbare cream and ochre traveling robes, walking barefoot with a simple wooden staff and a small satchel, serene hooded face",
    "shambler": "a freshly-risen zombie shambler, earth-caked pale green flesh, slack jaw, grasping arms, grave dirt falling from it",
    "rat": "a hunched giant brown rat with bared teeth and a long tail",
    "bat": "a purple cave bat with spread wings and tiny fangs",
    "goblin": "a small wiry green goblin clutching a crude wooden club",
    "slime": "a gelatinous amber-yellow blob slime with a faint inner glow",
    "spider": "a bulbous magenta-purple fang spider with eight spindly legs",
    "skeleton": "an animated skeleton warrior holding a rusted shortsword",
    "shaman": "a teal-furred gnoll shaman, hyena-headed humanoid with a feathered bone staff",
    "cultist": "a blood cultist in crimson hooded robes holding a curved sacrificial dagger",
    "charger": "a skeletal undead boar with lowered yellowed tusks and glowing ember eyes, bone-white",
    "lobber": "a squat soot-black imp artillerist hefting a sputtering orange bomb over its head, ember sparks",
    "golem": "a massive grey stone golem with cracked rocky fists",
    "orc": "a burly green orc warrior in dark iron armor with a battleaxe",
    "wraith": "a translucent pale-blue wraith, tattered ghostly shroud, glowing eyes",
    "troll": "a hulking moss-green cave troll with a heavy stone club, full body fills the frame, no border bars, no frame",
    "demon": "a fiery orange flame demon wreathed in embers with curved horns",
    "warlord": "Gruk the orc warlord: a towering orange-skinned orc in horned war helm with a massive greataxe",
    "lich": "Vyrakhel the lich king: an undead sorcerer in glowing purple robes, skeletal face, dark crown, purple flames in both hands",
}

# Ground items, tiles and props — rendered smaller than entities (prop_<id>.png).
PROPS = {
    "chest": "a small closed wooden treasure chest with iron bands",
    "goldchest": "an ornate locked golden treasure chest glowing faintly",
    "potion": "a simple round-bellied glass flask with a cork stopper, filled with glowing red liquid, classic RPG health potion item icon, NO creature, NO face, NO limbs",
    "scroll": "a rolled beige parchment paper scroll tied with brown twine, both rolled ends visible, classic RPG scroll item icon, NO cup, NO goblet",
    "weapon": "a single steel shortsword item icon, point down, no character, no hands, just the sword",
    "armor": "a steel cuirass breastplate armor piece lying flat as an item icon, empty armor with no person inside, NO head, NO arms, NO legs, NO face",
    "ring": "a golden ring with a glowing gem",
    "gold": "a tidy stack of shiny round GOLD COINS, three coins standing on edge against a small pile, bright metallic yellow-gold with clear circular coin faces, classic videogame money icon, NO fire, NO sparks",
    "gilded": "a fallen adventurer's skeleton slumped against stone in fine gold-trimmed clothes, clutching a glittering jeweled sword, faint gold glint",
    "shrine": "a small gothic stone ALTAR shrine: stepped pedestal base, two tiny candles, a glowing blood-red orb floating above the altar slab, clearly a place of dark worship, NO creature",
    "trap": "an iron spike trap floor plate with short rusted spikes pointing up, top-down view",
    "stairs": "a classic dungeon STAIRCASE icon: five wide stone steps descending left-to-right into black shadow, each step edge highlighted, unmistakable stairway silhouette, NO arch, NO door, NO gem",
    "darkstairs": "a classic dungeon STAIRCASE icon: five wide cracked stone steps descending left-to-right, eerie BLOOD-RED light blazing up from between the lower steps, unmistakable stairway silhouette, NO arch, NO door, NO portal",
}

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_DIR = os.path.join(REPO_ROOT, "arcane_depths", "web", "sprites")

PACE_SECONDS = 14  # stay under Imagen's ~5 req/min default quota
MAX_RETRIES = 6


def access_token() -> str:
    return subprocess.run(
        ["gcloud", "auth", "print-access-token"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()


def generate(desc: str, token: str) -> Image.Image:
    body = json.dumps({
        "instances": [{"prompt": STYLE.format(desc=desc)}],
        "parameters": {"sampleCount": 1, "aspectRatio": "1:1"},
    }).encode()
    req = urllib.request.Request(
        ENDPOINT, data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    delay = 10.0
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                payload = json.load(resp)
            raw = base64.b64decode(payload["predictions"][0]["bytesBase64Encoded"])
            return Image.open(io.BytesIO(raw)).convert("RGBA")
        except urllib.error.HTTPError as exc:
            if exc.code == 429 and attempt < MAX_RETRIES - 1:
                time.sleep(delay)
                delay = min(delay * 1.8, 90)
                continue
            raise
    raise RuntimeError("unreachable")


def is_magenta(px, tol_ratio: float = 0.55) -> bool:
    r, g, b = px[0], px[1], px[2]
    return r > 110 and b > 80 and g < min(r, b) * tol_ratio


def key_background(img: Image.Image) -> Image.Image:
    """Flood-fill magenta from the edges to alpha, then sweep leftover
    magenta-family pixels (the model sometimes paints a darker shadow blob)."""
    w, h = img.size
    px = img.load()
    assert px is not None  # always set for a loaded RGBA image
    seen = bytearray(w * h)
    stack = (
        [(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)]
        + [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)]
    )
    while stack:
        x, y = stack.pop()
        i = y * w + x
        if seen[i]:
            continue
        seen[i] = 1
        p = cast("tuple[int, int, int, int]", px[x, y])
        if p[3] == 0 or is_magenta(p):
            px[x, y] = (0, 0, 0, 0)
            if x > 0: stack.append((x - 1, y))
            if x < w - 1: stack.append((x + 1, y))
            if y > 0: stack.append((x, y - 1))
            if y < h - 1: stack.append((x, y + 1))
    # global sweep with a stricter ratio so purple robes survive
    for y in range(h):
        for x in range(w):
            p = cast("tuple[int, int, int, int]", px[x, y])
            if p[3] and is_magenta(p, 0.35):
                px[x, y] = (0, 0, 0, 0)
    return img


def finalize(img: Image.Image, target_px: int) -> Image.Image:
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
    w, h = img.size
    scale = target_px / max(w, h)
    return img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.Resampling.NEAREST)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only")
    ap.add_argument("--px", type=int, default=48)
    ap.add_argument("--missing", action="store_true", help="only render entities with no PNG yet")
    ap.add_argument("--props", action="store_true", help="render the PROPS set (prop_<id>.png) instead of entities")
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    token = access_token()
    pool = {f"prop_{k}": v for k, v in PROPS.items()} if args.props else dict(ENTITIES)
    targets = {args.only: pool[args.only]} if args.only else pool
    if args.missing:
        targets = {k: v for k, v in targets.items()
                   if not os.path.exists(os.path.join(OUT_DIR, f"{k}.png"))}
    failed = []
    for n, (eid, desc) in enumerate(targets.items()):
        out = os.path.join(OUT_DIR, f"{eid}.png")
        try:
            img = key_background(generate(desc, token))
            big = args.px * (3 if eid in ("lich", "warlord") else 1 if eid.startswith("prop_") else 2)
            finalize(img, big).save(out)
            print(f"{eid}: {os.path.getsize(out)} bytes", flush=True)
        except Exception as exc:  # keep going; rerun failures with --missing
            failed.append(eid)
            print(f"{eid}: FAILED — {exc}", flush=True)
        if n < len(targets) - 1:
            time.sleep(PACE_SECONDS)
    if failed:
        print("FAILED:", ", ".join(failed))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
