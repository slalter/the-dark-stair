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


## Spot-check — 2026-06-11 PM (post mage-siphon nerf, iters 39-41 in)

| config | result | vs 06-12 battery |
|---|---|---|
| mage standard | 0W · 11/20 boss reach · F6-heavy | reach 7→11, still 0W at the bound — healthiest mage curve yet |
| mage story | 3W · 17/20 boss reach · F6-heavy | 8W→3W: the siphon nerf softened story wins without any F3 regression |

Verdict: kill-siphon 2→1 landed as intended; no compensation needed.
(Raw: mage-postnerf-2026-06-11.jsonl)

## Class defenses battery — 2026-06-11 PM (iter53: block/ward/dodge identities)

| config | result | note |
|---|---|---|
| warrior standard | 4W/20 (20%) · F6-gated (11/16) | block @ 1+ceil(armor/2): first cut 2+armor sim'd 40% std / **25% nightmare** — rejected, halved |
| warrior nightmare | 2W/20 (10%) · deaths F4-F5 heavy | the dark still wins; block matters least vs packs by design |
| mage standard | 2W/20 (10%) · F6-gated | ward (1 mana per 2 dmg, max half) — first standard mage wins ever |
| mage nightmare | 0W/20 · unchanged shape | ward doesn't break the top end |
| rogue standard | 0W/20 (control) | untouched — dodge identity already existed |

Verdict: every class now has a defensive identity (warrior BLOCK first-hit-per-turn,
mage WARD mana-as-armor, rogue DODGE) with assertions in boon_check.js (9 checks,
untested = fail). Warrior std 10%→20% is the intended magnitude of the buff.

## Itemization battery — 2026-06-11 PM (iter55: trait weapons, rings, Sanctum tree, ACTIVES)

| config | result | note |
|---|---|---|
| warrior standard | 4W/20 (20%) · 15/16 deaths on F6 vs Lich | cleanest Lich-gated curve yet; Bulwark active in kit |
| rogue standard | 3W/20 (15%) | **first standard rogue wins ever** — Vault (escape) + twin fangs (×4 backstab) |
| mage standard | 0W/19D/**1S**, then 0W/30D/0S on repro | the 1 stall did NOT reproduce (1 in 50 vs historic 0 in 200+) — WATCH ITEM, not a blocker |

Verdict: every class now wins standard at bot level except mage (2W earlier today,
0W here — bound noise). Actives (Bulwark/Vault) + trait weapons shipped with 14
harness assertions; warrior unchanged at 20% confirms the items don't compound
the block buff.

## Vault-backstab spot-check — 2026-06-11 PM (iter58, post veteran playtest)

| config | result | note |
|---|---|---|
| rogue standard | 1W/20 (5%) · 12/19 deaths AT the Lich | bot barely vaults — buff is human-facing; curve is the most Lich-gated rogue has ever been |
| rogue nightmare | 0W/20 | unchanged; the dark still wins |

Verdict: vault-backstab (one true backstab per vault, window = next strike)
ships without bot-level overshoot. Veteran persona identified the rogue's
missing elite damage loop; this is the targeted fix.

## Fleet round + melee-siphon spot-check — 2026-06-11 PM (iter60)

| config | result | note |
|---|---|---|
| mage standard | 1W/20 (5%) · 0 stalls | post caster-melee-siphon (+1 mana per staff/orb bump); buff is skill-facing, bot barely melees |
| mage nightmare | 0W/20 · 0 stalls | unchanged |

Persona fleet verdicts (3 agents on live build): exploit hunter 1 CONFIRMED
(staff-swap mana mint — fixed, capacity-only equip) / 18 DEFENDED; mobile
confirmation 8/11 VERIFIED + vault-backstab VERIFIED (drawer trap + landscape
found and fixed same hour); mage persona WON a Veteran run (first persona win),
FUN 8/10. Watch items: log-echo (unreproduced), warrior+maul Lich cadence,
Blink "dead spell" verdict (design pass pending).

## Two-ring + mechanic-boons spot-check — 2026-06-11 PM (iter61)

| config | result | note |
|---|---|---|
| warrior standard | 3W/20 (15%) | bot now wears 2 rings (sim policy updated); no inflation vs 20% baseline |
| rogue standard | 1W/20 (5%) | consistent with post-vault-backstab bound |

Verdict: the second ring finger is a build-depth add, not a power spike, at
bot level. Six mechanic boons shipped with truth-harness assertions (stagger
boons assert the skip's EFFECT — skipT is consumed by the cast's own turn).

## Dash rework spot-check — 2026-06-11 PM (iter62, live rogue-session whispers)

| config | result | note |
|---|---|---|
| rogue standard | 0W/20 · 0 stalls | dash auto-strike + behind-landing + range 1 don't inflate the bot; band holds (0-15%) |

## Detection rework battery — 2026-06-12 AM (iter63, 'Warden' stealth audit)

Warden's instrumented audit (7 runs, ~2,600 turns, ~30 measured wake events):
chase pathing, corner rule, charger/lobber/ranged telegraphs all PASS clean;
detection was the entire "feels off" — notice was an RNG gate (dominant wake
distance 1.0-1.41 vs the stated sight−2), wake order was act→stir, and
cries/screams ignored walls.

| config | result | note |
|---|---|---|
| warrior standard | 2W/20 (10%) | stir-beats (monsters forfeit the wake turn) don't trivialize |
| rogue standard | 2W/20 (10%) | certain knife-range notice doesn't tank the approach |
| mage standard | 0W/20 | bound unchanged · zero stalls everywhere |

Shipped: certain notice at d≤2 (dice only 2..sight band), notice→stir→act with
a uniform chain-wake beat (m.justWoke), cryReaches() LOS-gating cries AND
screams, true post-whiff rest for all heavies, Gruk leash hysteresis (≤4
return). 6 new harness assertions.

## Round-2 confirmation — 2026-06-12 AM (iter65, Warden's re-audit)

Warden re-verified all five iter63 fixes on live: notice→stir→act VERIFIED
(8+ instrumented notices), uniform chain beat VERIFIED (7 group wakes,
flag-by-flag), stone-muffles VERIFIED (86 wall-blocked pairs false / 1,846
open true, zero counterexamples), heavy whiff rest VERIFIED (6 baits).
TWO caught broken-in-the-common-case and fixed here:
- certainty gate was EUCLIDEAN (diagonal cheb-2 stare-downs survived — 10
  beats nose-to-diagonal with a bat) → gate now CHEBYSHEV.
- Gruk "walks home" never terminated (LOS-blind chase re-pulled him at ≤4;
  period-6 patrol forever, leash bark re-arming) → leashed+unseen+home = HOLDS.
Plus: sleepwalkers that drift into knife range startle awake same phase.
rogue battery 0W/20, 0 stalls — in band.

## Tempo pack battery — 2026-06-12 AM (iter68, speedrunner audit 'Dash')

Dash's measured findings (4 runs): dread spawner STARVED on unexplored floors
(150+ turns past dreadAt, zero spawns — needed an explored tile >8 away);
2-hunter cap made stair-camping consequence-free; ward sales minted +52 score
in 3 sells (double-dip); the speed bonus could never out-pay farming (full-
clear death on F5 scored 1855 vs a theoretical perfect speed WIN ~1330); the
dark stair was 3/3 deaths post-landing ("a coffin lid").

| config | result | note |
|---|---|---|
| warrior standard | 6W/20 (30%) · 13/14 deaths AT the Lich | at accept ceiling — likely n=20 variance (sd ~10%); WATCH next battery |
| rogue standard | 1W/20 (5%) | in band |
| mage standard | 0W/20 · 12/20 at Lich | bound unchanged · ZERO stalls everywhere |

Shipped: sales pay gold not score · win bonus 250+max(0,2500−2·turns) ·
spawner 64→16→frontier fallback + cap gone + elite hunters from #3 ·
dark-stair 15-turn shroud + landing spoil · denied-cue floaters · Shift+Enter
dark routing. 8 new harness assertions.

## Warrior tuning journey + Dash round-2 — 2026-06-12 AM (iter69)

WATCH flag resolved with a knob hunt (all n=40):
| block formula | winrate | verdict |
|---|---|---|
| {2,3,4,5} vs all hits | 38% (15W, 19/25 at Lich) | double the band — two rings + maul + mechanic boons crept the class |
| {1,2,3,4} (round down) | 5% then 10% (mean 7.5%) | one block point = ~30 winrate points; overshoot |
| **{2,3,4,5}, only vs dmg≥3** | **17% (7W, 24/33 at Lich)** | SHIPPED — chip of 1-2 slips beneath the guard; 'one big foe blunts itself on you' is now literally the rule |

DASH ROUND-2: ALL SIX tempo fixes VERIFIED on live — the first all-green
confirmation round (dread unstarvable 2/2 @ ft190 exactly; elite hunter #3
2/2 with 0 xp; sales score-frozen; Shift+Enter both ways + bonus math read
from served source; dark stair 2/2 clean landings, shroud blinds to sight−3
measured, spoil at d=1, survival 303/91 turns vs the prior 3/3 ~120-turn
deaths; denied-cues fire per mash). His round-2 leak — elite hunter HOARDS
minting goldEarned — gated on xp>0, harness-asserted.

## 2026-06-12 — iter80: GRAVEDIGGER (new class, endgame menu #4 pick A)
Target band: 10–25% (warrior-like frontliner), ZERO stalls. History (smart/Veteran):
- v1 hp40/atk6/def1, pets 4+2d hp · 2+⌈d/2⌉ atk · ttl20 · cd8, rites +5cd5: **4%** (n=25) — floor-3 wall
- v2 atk7, pets +1hp/+1atk, cd6: **8%** (n=25) / **3%** (n=40) — reaches endgame, loses it
- v3 + grave-ward (+1 DEF while a shambler walks), rites +6, ttl25: **5%** (n=40)
- v4 + necrotic burst (falling shambler deals 3+depth to adjacent foes, no score): **5%** (n=40)
- v5 sim-policy fix — pre-raise ("walk with your dead"), not mid-fight-only: **7%** (n=40)
- v6 atk 8 (spade = warrior parity; pets/burst are the surplus): **15%** (n=40, 0 stalls) ✓ SHIPPED
Lesson: the wall was kill-speed, not survivability — mechanics (ward/burst) made the class
play right, but atk parity is what moved the band. Pet kills mint no score by design
(ember-poverty tension); sim can't measure that trade, personas judge it.
- v7 confirm (post-persona round: class boons + UI fixes, combat math unchanged): 7% (n=40).
  Pooled v6+v7 = 9/80 = 11% — in band; Morrigan (human-feel persona) judged power
  "right, maybe a hair strong on attrition" → no further tuning. ACCEPTED at ~11-15%.

## 2026-06-12 — iter81: PILGRIM (new class, endgame menu #4 pick B)
Target band: 5–20% (late-bloomer; the weakest start must stay genuinely dangerous). History (smart/Veteran):
- v1 hp30/atk5/def0/dodge8 + 1 relic/floor: **0%** (n=25) — goblins ate him on floor 2
- v2 + walking staff (+1) + Providence (once/run, killing blow → 1 HP): **0%** (n=25) — wall moved to floor 3
- v3 hp33 + outset blessing (2 relics on floor 1) + prayer mends 4: **0%** (n=25)
- v4 atk6 / dodge15: **0%** (n=25) — one run reached the Lich
- v5 every relic also +2 max HP ('every blessing fortifies'): **~0-4%** (n=25)
- v6 Prostrate gains the RECOIL (adjacent foes stagger 2, once/floor — the class's missing combat verb): no measurable jump alone
- v7 TWO relic offers per floor ('matins and vespers', ~12-14 relics/run): **4%** (n=25) → **7% (n=40, 0 stalls)** ✓ SHIPPED
Lesson: a no-mitigation class can't be fixed by stat nudges in this tuning — it needed BOTH a
combat verb (prayer recoil) and an engine heavy enough to compound (2 stones/floor + fortify).
Venom is the signature killer (7/37) — the counters exist (Clear Eye, antidotes, Chalice).
- iter82 widget round (pets hp 7+2d, atk 4+⌈d/2⌉, BFS heel): 7% (n=40). Pooled recent
  n=40 runs ≈10% — at the band floor; accepted, the buff answers the user's
  "shamblers seem too weak" submission and the BFS heel is the real feel fix.
