#!/usr/bin/env python3
"""Build the single-file shareable Arcane Depths bundle.

Inlines style.css, the five game scripts, the three Blender stills, and a
BUNDLED_ASSETS map (sprites + Lich voice mp3s as data URIs) into one HTML file
the user can send to anyone. spriteFor()/LichVoice.play() consult
BUNDLED_ASSETS before fetching by path, so the same source runs served or bundled.

Usage: python3 tools/build_bundle.py [--version 4.0]
Output: TheDarkStair-v<version>.html at the repo root
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(REPO_ROOT, "web")

SCRIPTS = ["core.js", "data.js", "dungeon.js", "render.js", "game.js"]
STILLS = ["title-bg.jpg", "cut-lich.jpg", "cut-victory.jpg"]
MIME = {".png": "image/png", ".jpg": "image/jpeg", ".mp3": "audio/mpeg"}


def read(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


def data_uri(path: str) -> str:
    ext = os.path.splitext(path)[1]
    with open(path, "rb") as f:
        return f"data:{MIME[ext]};base64," + base64.b64encode(f.read()).decode()


def collect_assets() -> dict[str, str]:
    assets: dict[str, str] = {}
    for sub in ("sprites", os.path.join("audio", "lich")):
        d = os.path.join(WEB, sub)
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            rel = f"{sub}/{name}".replace(os.sep, "/")
            assets[rel] = data_uri(os.path.join(d, name))
    return assets


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", default="4.0")
    args = ap.parse_args()

    html = read(os.path.join(WEB, "index.html"))

    css = read(os.path.join(WEB, "style.css"))
    link = '<link rel="stylesheet" href="style.css">'
    assert link in html, "stylesheet link not found"
    html = html.replace(link, f"<style>\n{css}\n</style>", 1)

    js = "\n;\n".join(read(os.path.join(WEB, "js", s)) for s in SCRIPTS)
    # the three Blender stills are referenced as literal paths inside game code/CSS strings
    for still in STILLS:
        uri = data_uri(os.path.join(WEB, still))
        js = js.replace(f"'{still}'", f"'{uri}'").replace(f"url({still})", f"url({uri})")

    assets = collect_assets()
    # static <img src="sprites/..."> tags (class cards) can't consult
    # BUNDLED_ASSETS — inline their srcs directly
    for rel, uri in assets.items():
        html = html.replace(f'src="{rel}"', f'src="{uri}"')
    payload = (
        f"const BUNDLED_ASSETS = {json.dumps(assets)};\n{js}"
    ).replace("</", "<\\/")  # never let inlined content terminate the script tag

    tags = "".join(f'<script src="js/{s}"></script>\n' for s in SCRIPTS)
    assert tags in html, "script tag block not found"
    html = html.replace(tags, f"<script>\n{payload}\n</script>\n", 1)

    out = os.path.join(REPO_ROOT, f"TheDarkStair-v{args.version}.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"{out}: {os.path.getsize(out) / 1e6:.1f} MB, {len(assets)} bundled assets")
    return 0


if __name__ == "__main__":
    sys.exit(main())
