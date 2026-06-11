# THE DARK STAIR

A turn-based browser roguelite in pure vanilla JavaScript — no framework, no
build step, no dependencies. Descend six floors, read the floor, kill the Lich.

**Play it:** https://www.gurucloudai.com/dark-stair-demo/

![genre] roguelite · permadeath · 3 classes · daily challenge · plays on phones

## Run it locally

```bash
cd web && python3 -m http.server 8417
# open http://localhost:8417
```

That's it. Five script files, load order matters (`core → data → dungeon →
render → game`).

Or build a single shareable HTML file (assets inlined as data URIs):

```bash
python3 tools/build_bundle.py
```

## Design rules (load-bearing)

1. **The floor never lies.** Every big hit telegraphs a turn early, in one
   consistent visual grammar: orange plus-marks (lobbed shells), hot lanes
   (charger dashes), violet lines (the Lich's beam), red squares (crushing
   blows), z / ? badges (dozing / just-noticed-you), bright-vs-grey bolt
   trajectories (committed vs may-evade). New threats must speak it.
2. **The corner rule.** No diagonal movement between two walls (`diagOpen`).
   It must hold at *every* movement-decision site — player, monsters,
   distance fields, pathfinders, and dungeon-generation connectivity checks
   (`placeBlocker` rejects any feature placement that severs any tile) — or
   navigation oscillates and floors become unwinnable.
3. No leveling. Choices are trade-offs. Positioning beats stat checks.

## Classes

- **Warrior** — Cleave [V], Shield Charge [B]: an aligned 3-tile dash-strike
- **Rogue** — real stealth (dozing foes stir by proximity; backstab ×3 on the
  unaware, stirring, or frozen), Shadow Dash [V]
- **Mage** — firebolt is a real projectile (3 tiles/turn, crits, dodgeable),
  Frost Nova, Mend, Blink; kills siphon mana; ⚔ attack power feeds spells

Boons each floor modify abilities, not just stats (charge that dazes, dash
that re-stealths, bolts that fork on kills, 5-turn freezes...).

## Toolchain

| Tool | What |
|---|---|
| `tools/sim.js` | Headless calibration battery: `node tools/sim.js warrior 20 --diff=standard --json`. The bot can't dodge telegraphs — read death-floor *distributions*, not winrates. Stall dumps carry forensics. |
| `tools/autoplay.js` | Browser playtest bot (inject via Playwright `page.addScriptTag`): dodges telegraphs, drafts boons, uses abilities. `AutoPlay.run(cls, n, diff)`, `AutoPlay.lichTrial(n)`. |
| `tools/build_bundle.py` | Single-file build. |
| `tools/gen_sprites.py` | Sprite generation via Vertex AI Imagen (set `GOOGLE_CLOUD_PROJECT`; magenta chroma-key → transparent PNGs). |
| `tools/gen_lich_tts.py` | Voice lines via Gemini-TTS *directed performances* (persona + per-line director's notes). |
| `tools/distort_lich.sh` | The undead post-pass on the Lich's voice (ffmpeg: pitch drop + spectral chorus + bone echo). |

`calibration/` holds checked-in sim batteries with a trend README — the
balance history is part of the source.

## How this game was built

This game was built almost entirely by **Claude** (Anthropic's Fable 5),
working autonomously — but the model is only half the story. It ran inside
**GuruCloudAI's proprietary agent infrastructure**: a custom harness, MCP
server fleet, persistent knowledge systems, and review pipelines that let an
agent design, ship, deploy, and *verify* continuously for days at a time.
That infrastructure is what turns a capable model into a capable engineer,
and it is not in this repo.

What you can see from here is the methodology it enabled: autonomous playtest
personas (a fresh-eyes newcomer, a stealth specialist, a caster main, a casual
player, an exploit hunter, a phone commuter...) played every live build
through a real browser, filed structured reports, and every finding shipped
the same cycle — alongside feedback from real players. The checked-in
calibration batteries and the telegraph grammar both came out of that loop.

## License

MIT — see [LICENSE](LICENSE). Sprites and voice lines are AI-generated
(Imagen / Gemini-TTS) and ship under the same terms.
