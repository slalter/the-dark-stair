# Calibration batteries

Periodic full-grid difficulty measurements. Each `battery-<date>.jsonl` holds
raw `sim.js --json` output for the grid: {warrior, rogue, mage} ×
{story, standard, nightmare} × 20 runs (smart policy), plus
warrior-casual-story as the sloppy-play proxy.

**Reading the numbers:** the headless bot canNOT dodge telegraphs — every
windup, beam, shell, and charge connects. Treat sim winrates as a strict
lower bound and read the *death-floor distribution*, not the winrate.
The browser bot (`autoplay.js`, dodges telegraphs) is the skilled-play proxy;
`AutoPlay.lichTrial(n)` isolates the boss fight.

## Baseline — 2026-06-11 (post iter-17 bestiary: +lobber, +charger, +gilded corpse)

| config | wins | boss reached | death floors | top killer |
|---|---|---|---|---|
| warrior story | 9/20 | 17/20 | F6-heavy (8) | Vyrakhel 8 |
| rogue story | 6/20 | 11/20 | spread, F6 5 | Vyrakhel 4 |
| mage story | 2/20 | 12/20 | F6-heavy (10) | Vyrakhel 9 |
| warrior standard | 0/20 | 4/20 | F3-5 spread | charger/Lich/golem 2 ea |
| rogue standard | 0/20 | 1/20 | F3 wall (14) | Gruk 2 |
| mage standard | 0/20 | 3/20 | F3 9, F4 6 | Lich/charger 3 ea |
| warrior nightmare | 0/20 | 1/20 | F3 10 | Gruk 2 |
| rogue nightmare | 0/20 | 0/20 | F3 14 | lobber 3 |
| mage nightmare | 0/20 | 0/20 | F3 15 | charger 4 |
| warrior story casual | 0/20 | 4/20 | F5 9 | Gruk/Lich/troll 4 ea |

Browser-bot `lichTrial(4)`: **3/4 wins** (one 2,371-turn kiting outlier).

**Verdict:** healthy. Story delivers most runs to the endgame and the Lich is
the gatekeeper (deaths cluster at F6 with wins possible). Standard/nightmare
lower bounds are boss-gated (Gruk F3) as intended.

**Watch items**
- Gruk's F3 arena is a hard wall for rogue/mage at the no-dodge lower bound
  (14-15/20 deaths). Browser-bot play handles it; if player feedback says F3
  is a cliff, soften Gruk before touching the trash mix.
- Bone charger dominates nightmare early-floor kills (7/15 of a rogue
  nightmare battery). By design it executes non-dodgers; verify with dodging
  play before any tuning.
- 1 stall / 200 runs traced to a monster stranded in a severed nook behind a
  blocking feature; fixed (placeBlocker now rejects ANY tile severance, the
  sim bot ignores unreachable monsters). Should read 0 in the next battery.


## Battery — 2026-06-12 (post iters 19-27: stealth, spell scaling, tempo abilities, telegraphMult)

| config | wins | boss reached | vs 06-11 baseline |
|---|---|---|---|
| warrior story | 11/20 | 19/20 | 9→11 W, 17→19 reach |
| rogue story | 8/20 | 18/20 | 6→8 W, 11→18 reach |
| mage story | 8/20 | 17/20 | **2→8 W**, 12→17 reach |
| warrior standard | 2/20 | 11/20 | **0→2 W**, 4→11 reach |
| rogue standard | 2/20 | 12/20 | **0→2 W**, F3-wall (1 reach) → Lich-gated 12 |
| mage standard | 0/20 | 7/20 | F3-wall (3 reach) → Lich-gated 7 |
| nightmare (all) | 0/60 | 10/60 | still "the dark usually wins" |
| warrior story casual | 2/20 | 8/20 | **0→2 W** — matches two real newcomer victories in playtests |

Zero stalls in 200 runs. Verdict: the class-identity arc (rogue stealth,
mage spell scaling + kill-siphon, melee tempo abilities) moved every
distribution from mid-floor walls to Lich-gated curves without breaking
nightmare. Standard's no-dodge winrate (~10%) is the intended lower bound
for a skilled-human ~40-55% target. No tuning changes recommended.
