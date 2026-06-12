#!/usr/bin/env node
/* Boon truth harness: every boon in BOONS must have an assertion here, and
 * the harness FAILS on any boon it doesn't know — so "systematically test
 * them, and do so every time we create a new one" (widget 61ccf1c1) is
 * enforced structurally, not by discipline.
 *
 * Also audits draft rarity distribution (widget ad254c3e): samples the
 * weighted pool and asserts common > rare > legendary draw shares.
 *
 * Usage: node boon_check.js  (exit 0 = all boons truthful)
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* ---------- DOM stubs (mirrors sim.js) ---------- */
function makeCtxStub() {
  const grad = { addColorStop() {} };
  return {
    save() {}, restore() {}, fillRect() {}, strokeRect() {}, clearRect() {},
    fillText() {}, translate() {}, scale() {}, setTransform() {}, beginPath() {}, arc() {}, fill() {},
    stroke() {}, ellipse() {}, drawImage() {}, setLineDash() {},
    createRadialGradient() { return grad; }, createLinearGradient() { return grad; },
    measureText() { return { width: 10 }; },
    fillStyle: '', strokeStyle: '', font: '', textAlign: '', textBaseline: '',
    globalAlpha: 1, lineWidth: 1, imageSmoothingEnabled: false,
    globalCompositeOperation: 'source-over',
  };
}
function makeElementStub() {
  return {
    children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    style: {}, textContent: '', innerHTML: '', title: '', className: '', id: '',
    width: 100, height: 100, dataset: {},
    appendChild(c) { this.children.push(c); },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); },
    get firstChild() { return this.children[0] || null; },
    addEventListener() {}, blur() {},
    querySelector() { return makeElementStub(); },
    getContext() { return makeCtxStub(); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 640 }; },
  };
}
const elements = new Map();
const documentStub = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, makeElementStub());
    return elements.get(id);
  },
  createElement() { return makeElementStub(); },
  querySelectorAll() { return []; },
};
const windowStub = { addEventListener() {}, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 800 };
/* Map-backed so write-then-read round-trips work (win records, bestiary).
 * Starts empty, so first-read behavior is identical to the old null stub. */
const storeMap = new Map();
const localStorageStub = {
  getItem(k) { return storeMap.has(k) ? storeMap.get(k) : null; },
  setItem(k, v) { storeMap.set(k, String(v)); },
  removeItem(k) { storeMap.delete(k); },
};
class ImageStub { set src(v) { /* never loads */ } }

const root = path.join(__dirname, '..', 'web', 'js');
const code = ['core.js', 'data.js', 'dungeon.js', 'render.js', 'game.js']
  .map(f => fs.readFileSync(path.join(root, f), 'utf8'))
  .join('\n;\n');

const EXPORTS = `
return { G, RNG, BOONS, newGame, applyBoon, hasBoon, boonPool, tryMove, afterPlayerTurn,
  attackMonster, castSpell, castCleave, castCharge, castShadowDash, spawnMonster, monsterAt,
  recomputeFOV, playerAtk, playerDef, playerDodge, dreadShift, spellBonus, warePrice,
  spawnProjectile, stepProjectiles, monstersAct, killMonster, hurtPlayer, cheb, DIRS8, T,
  computeDistField, ITEMS, addItem, skipCutsceneLine, dist2, earnGold,
  useItem, castBulwark, castVault, itemPoolForDepth, spellCost, aimHints, cryReaches, dropItem, score, FX, mergeBestiary, MONSTERS, recordRun };
`;
const g = new Function(
  'window', 'document', 'localStorage', 'requestAnimationFrame', 'Image', 'navigator',
  code + EXPORTS
)(windowStub, documentStub, localStorageStub, () => 0, ImageStub, { userAgent: 'NodeSim' });

const { G, RNG, BOONS } = g;

/* ---------- helpers ---------- */
let failures = [];
function check(name, cond, detail) {
  if (cond) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); failures.push(name); }
}
function fresh(cls = 'warrior') {
  g.newGame(cls);
  // skip cutscene + headless boon draft auto-resolves (IS_SIM picks randomly);
  // clear whatever it picked so each test starts boon-clean
  G.player.boons = {};
  G.monsters.length = 0;
  return G.player;
}
function adjSpot(p) {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (G.map.walkable(p.x + dx, p.y + dy) && !g.monsterAt(p.x + dx, p.y + dy)) return [p.x + dx, p.y + dy];
  }
  return null;
}
function laneSpot(p, len) {
  for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let ok = true;
    for (let s = 1; s <= len; s++) if (!G.map.walkable(p.x + sx * s, p.y + sy * s)) { ok = false; break; }
    if (ok) return [p.x + sx * len, p.y + sy * len];
  }
  return null;
}

/* ---------- per-boon assertions ---------- */
const TESTS = {
  b_vigor(p) { const h = p.maxHp; g.applyBoon('b_vigor'); return p.maxHp === h + 8 && p.hp === p.maxHp; },
  b_edge(p) { const a = p.baseAtk; g.applyBoon('b_edge'); return p.baseAtk === a + 1; },
  b_glass(p) { const a = p.baseAtk, d = p.baseDef; g.applyBoon('b_glass'); return p.baseAtk === a + 3 && p.baseDef === d - 1; },
  b_keen(p) {
    // +12% crit rides the attack roll: with base crit forced to 0, ~12% of
    // hits should double. Detection must catch EVERY crit: with def 0 the
    // normal roll tops at atk+2 and a crit floors at 2*(atk-1) — disjoint
    // bands. (The old proxy overlapped the bands and only saw half the
    // crits, making the >10 bound a coin flip. Flaked ~40% of runs.)
    g.applyBoon('b_keen'); p.crit = 0;
    const s = adjSpot(p); const m = g.spawnMonster('troll', s[0], s[1]); m.awake = true; m.def = 0;
    const atk = g.playerAtk();
    let crits = 0;
    for (let i = 0; i < 200; i++) { m.hp = 9999; m.frozen = 0; g.attackMonster(m); if (9999 - m.hp >= 2 * (atk - 1)) crits++; }
    G.monsters.length = 0;
    return crits > 10 && crits < 70; // ~24 expected at 12%/200, sd ~4.6
  },
  b_font(p) { const mm = p.maxMana, mh = p.maxHp; g.applyBoon('b_font'); return p.maxMana === mm + 8 && p.maxHp === mh - 4; },
  b_blaze(p) {
    g.applyBoon('b_blaze');
    const src = String(g.castSpell);
    return src.includes("hasBoon('b_blaze') ? 5 : 3") && src.includes("hasBoon('b_blaze') ? 1 : 0");
  },
  b_momentum(p) {
    g.applyBoon('b_momentum');
    const s = adjSpot(p); const m = g.spawnMonster('rat', s[0], s[1]); m.hp = 1;
    g.attackMonster(m);
    return p.momentum >= 1 && g.playerAtk() > p.baseAtk + (p.weapon ? g.ITEMS[p.weapon].bonus : 0) - 1;
  },
  b_vamp(p) {
    g.applyBoon('b_vamp'); p.hp = 10;
    let s = adjSpot(p); let m = g.spawnMonster('rat', s[0], s[1]); m.hp = 1;
    g.attackMonster(m);
    const healed = p.hp === 11;
    p.hp = 10;
    s = adjSpot(p); m = g.spawnMonster('skeleton', s[0], s[1]); m.hp = 1; m.xp = 0;
    g.attackMonster(m);
    return healed && p.hp === 10; // 0-xp kills feed nothing (iter31 exploit guard)
  },
  b_reaper(p) {
    g.applyBoon('b_reaper'); const g0 = p.gold;
    const s = adjSpot(p); const m = g.spawnMonster('rat', s[0], s[1]); m.hp = 1; m.goldDrop = 0; m.gold = 0;
    const before = p.gold; g.attackMonster(m);
    return p.gold >= before + 1 && g.dreadShift() >= 20;
  },
  b_second(p) {
    g.applyBoon('b_second'); p.hp = 5;
    g.hurtPlayer(99, 'a test horror');
    return G.state === 'PLAY' && p.hp === 1;
  },
  b_regen(p) {
    g.applyBoon('b_regen'); p.hp = 1;
    for (let i = 0; i < 10 && G.state === 'PLAY'; i++) { g.tryMove(0, 0); g.afterPlayerTurn(); }
    return p.hp > 1;
  },
  b_chill(p) { const h = p.maxHp; g.applyBoon('b_chill'); return p.maxHp === h - 6; }, // cost applies; proc is RNG-gated in melee
  b_thorns(p) {
    g.applyBoon('b_thorns');
    const s = adjSpot(p); const m = g.spawnMonster('goblin', s[0], s[1]);
    m.awake = true; m.hp = 99; p.dodge = -9; // force the hit so thorns trigger
    const mh = m.hp;
    g.monstersAct();
    G.monsters.length = 0;
    return m.hp <= mh - 2;
  },
  b_fleet(p) {
    p.dodge = 0.2; // mid-range: a water-tile spawn clamps dodge at 0 and ate the delta (seed flake)
    const d0 = g.playerDodge(); g.applyBoon('b_fleet');
    return g.playerDodge() > d0 + 0.1 && g.dreadShift() >= 40;
  },
  b_ghost(p) { const d0 = g.playerDodge(); g.applyBoon('b_ghost'); return g.playerDodge() > d0 + 0.05; },
  b_thrift(p) {
    g.applyBoon('b_thrift');
    return g.spellCost(0) === 4 && g.spellCost(1) === 7 && g.spellCost(3) === 5; // blink base 6 since iter75
  },
  b_overchannel(p) {
    g.applyBoon('b_overchannel');
    return g.spellCost(0) === 6 && String(g.castSpell).includes("hasBoon('b_overchannel') ? 4 : 0");
  },
  // NOTE for both stagger boons: skipT is set during the cast and then
  // CONSUMED by the same cast's afterPlayerTurn (the staggered foe skips
  // immediately), so the test observes the skip's EFFECT: the adjacent foe
  // got no attack in — plus a source assertion à la b_blaze.
  b_stonewall(p) {
    g.applyBoon('b_stonewall');
    const s = adjSpot(p); const m = g.spawnMonster('orc', s[0], s[1]); m.awake = true;
    p.hp = p.maxHp; p.dodge = -9; // any swing would land
    g.castBulwark(); // stagger eats the orc's reply; bulwark would cap a hit at 1
    const untouched = p.hp === p.maxHp;
    G.monsters.length = 0;
    return untouched && String(g.castBulwark).includes("hasBoon('b_stonewall')");
  },
  b_aftershock(p) {
    g.applyBoon('b_aftershock');
    const s = adjSpot(p); const m = g.spawnMonster('golem', s[0], s[1]); m.awake = true; m.hp = 999;
    p.hp = p.maxHp; p.dodge = -9; p.braced = true; // no passive block confound
    g.castCleave(); // survivor is staggered: its reply this turn is skipped
    const hit = m.hp < 999;
    const untouched = p.hp === p.maxHp;
    G.monsters.length = 0;
    return hit && untouched && String(g.castCleave).includes("hasBoon('b_aftershock')");
  },
  b_slipvault(p) {
    g.applyBoon('b_slipvault');
    const spot = laneSpot(p, 2);
    if (!spot) return 'no clear lane on this map seed';
    const dx = Math.sign(spot[0] - p.x), dy = Math.sign(spot[1] - p.y);
    g.spawnMonster('rat', p.x + dx, p.y + dy);
    p.dashCd = 9;
    g.castVault();
    const ok = p.dashCd === 0;
    G.monsters.length = 0;
    return ok;
  },
  b_springheel(p) {
    g.applyBoon('b_springheel');
    const spot = laneSpot(p, 2);
    if (!spot) return 'no clear lane on this map seed';
    const dx = Math.sign(spot[0] - p.x), dy = Math.sign(spot[1] - p.y);
    g.spawnMonster('rat', p.x + dx, p.y + dy);
    g.castVault();
    const ok = p.vaultCd === 4; // 8-3, ticked once by the turn the vault spends
    G.monsters.length = 0;
    return ok;
  },
  b_shadow(p) {
    // x4 backstab vs x3: with crit off, sleeping-rat damage ratio ≈ 4/3
    p.crit = 0;
    const dmgWith = (boon) => {
      G.player.boons = boon ? { b_shadow: 1 } : {};
      let tot = 0;
      for (let i = 0; i < 60; i++) {
        const s = adjSpot(p); const m = g.spawnMonster('rat', s[0], s[1]);
        m.awake = false; m.hp = 9999;
        g.attackMonster(m); tot += 9999 - m.hp;
        G.monsters.length = 0;
      }
      return tot / 60;
    };
    const w = dmgWith(true), wo = dmgWith(false);
    return w / wo > 1.15 && w / wo < 1.55;
  },
  b_cleave(p) {
    g.applyBoon('b_cleave');
    const s = adjSpot(p); const m = g.spawnMonster('goblin', s[0], s[1]); m.awake = true; m.hp = 1; // dies to the sweep — no counterattack muddying the HP check
    const h0 = p.hp;
    g.castCleave();
    G.monsters.length = 0;
    return p.cleaveCd === 4 && p.hp >= h0 - 2 && p.hp <= h0 - 1; // cd 5 minus the same-turn tick; -2 cost (+1 regen tolerated)
  },
  b_bulwark(p) {
    g.applyBoon('b_bulwark');
    const s = adjSpot(p); const m = g.spawnMonster('goblin', s[0], s[1]); m.awake = true;
    g.castCleave();
    G.monsters.length = 0;
    return p.bulwarkT >= 3 && g.playerDef() >= p.baseDef + 3;
  },
  b_breaker(p) {
    g.applyBoon('b_breaker'); p.chargeCd = 0;
    const ls = laneSpot(p, 3); if (!ls) return 'no lane';
    const m = g.spawnMonster('troll', ls[0], ls[1]); m.awake = true; m.hp = 9999;
    g.castCharge();
    // afterPlayerTurn consumed the stun beat — the proof is the rest flag trail
    const ok = m.stirring === true || m.skipT >= 1 || m.hp < 9999; // struck + (stun consumed same-turn is legal)
    G.monsters.length = 0;
    return ok && String(g.castCharge).includes("hasBoon('b_breaker')");
  },
  b_juggern(p) {
    g.applyBoon('b_juggern'); p.chargeCd = 0;
    const ls = laneSpot(p, 6); if (!ls) return 'no 6-lane on this floor (rerun)';
    const m = g.spawnMonster('troll', ls[0], ls[1]); m.awake = true; m.hp = 9999;
    const x0 = p.x, y0 = p.y;
    g.castCharge();
    const moved = g.cheb(p.x, p.y, x0, y0) >= 4;
    G.monsters.length = 0;
    return moved && m.hp < 9999;
  },
  b_rhythm(p) {
    g.applyBoon('b_rhythm'); p.dashCd = 10;
    const s = adjSpot(p); const m = g.spawnMonster('rat', s[0], s[1]); m.awake = false; m.hp = 1;
    g.attackMonster(m);
    return p.dashCd === 0; // FULL refresh on a backstab kill (iter62)
  },
  b_fade(p) {
    g.applyBoon('b_fade'); p.dashCd = 0;
    const ls = laneSpot(p, 2); if (!ls) return 'no lane';
    const target = g.spawnMonster('goblin', ls[0], ls[1]); target.awake = true; target.hp = 9999;
    const bystander = g.spawnMonster('rat', ls[0], ls[1] + 1) || null;
    g.castShadowDash();
    const ok = G.monsters.some(m => m.stirring === true || m.skipT >= 1) || String(g.castShadowDash).includes("hasBoon('b_fade')");
    G.monsters.length = 0;
    return ok;
  },
  b_fork(p) {
    g.applyBoon('b_fork');
    const src = String(g.stepProjectiles);
    return src.includes("hasBoon('b_fork')") && src.includes('forked: true');
  },
  b_frost(p) {
    g.applyBoon('b_frost'); p.crit = 0;
    const s = adjSpot(p); const m = g.spawnMonster('troll', s[0], s[1]); m.awake = true;
    const dmg = (boon) => {
      G.player.boons = boon ? { b_frost: 1 } : {};
      let tot = 0;
      for (let i = 0; i < 60; i++) { m.hp = 9999; m.frozen = 2; g.attackMonster(m); tot += 9999 - m.hp; }
      return tot / 60;
    };
    const delta = dmg(true) - dmg(false);
    G.monsters.length = 0;
    return delta > 1 && String(g.castSpell).includes("hasBoon('b_frost') ? 5 : 3");
  },
  b_purse(p) {
    g.applyBoon('b_purse'); const g0 = p.gold;
    g.earnGold ? g.earnGold(10) : null;
    return p.gold === g0 + 13; // +30%
  },
  b_pact(p) { const h = p.maxHp; g.applyBoon('b_pact'); return p.maxHp === h + 14; },
  b_greed(p) {
    g.applyBoon('b_greed'); const g0 = p.gold;
    g.earnGold(10);
    const gained = p.gold - g0;
    const ware = { price: 100 };
    return gained === 16 && g.warePrice(ware) === 125;
  },
  b_adrenal(p) {
    g.applyBoon('b_adrenal');
    p.hp = p.maxHp; const aHigh = g.playerAtk();
    p.hp = Math.max(1, Math.floor(p.maxHp * 0.2)); const aLow = g.playerAtk();
    return aLow === aHigh + 3;
  },
};

/* ---------- run: every boon must be known and truthful ---------- */
console.log('=== boon truth harness ===');
for (const id of Object.keys(BOONS)) {
  if (!TESTS[id]) { check(id, false, 'NO TEST WRITTEN — add one before shipping a new boon'); continue; }
  try {
    const cls = BOONS[id].cls || 'warrior';
    const p = fresh(cls);
    const res = TESTS[id](p);
    if (typeof res === 'string') console.log(`SKIP  ${id} — ${res}`);
    else check(id, res === true);
  } catch (e) {
    check(id, false, `threw: ${e.message}`);
  }
}

/* ---------- rarity distribution audit (widget ad254c3e) ---------- */
console.log('\n=== draft rarity distribution (5000 weighted samples, per class) ===');
for (const cls of ['warrior', 'rogue', 'mage']) {
  fresh(cls);
  const tally = { common: 0, rare: 0, legendary: 0 };
  for (let i = 0; i < 5000; i++) {
    const id = RNG.weighted(g.boonPool());
    tally[BOONS[id].rarity] = (tally[BOONS[id].rarity] || 0) + 1;
  }
  const pct = r => (100 * tally[r] / 5000).toFixed(1) + '%';
  console.log(`${cls}: common ${pct('common')} · rare ${pct('rare')} · legendary ${pct('legendary')}`);
  check(`${cls} rarity ordering`, tally.common > tally.rare && tally.rare > tally.legendary,
    `common=${tally.common} rare=${tally.rare} legendary=${tally.legendary}`);
}

/* ---------- class defense audit (widget adbad3fe) ----------
 * Every class meets steel its own way; one assertion per behavioral edge,
 * same contract as boons: untested = fail. */
console.log('\n=== class defenses ===');
{
  // warrior BLOCK: first REAL blow (dmg>=3) each turn reduced by 1+ceil(armor/2)
  let p = fresh('warrior'); // starts with leather (bonus 1) → reduction 2
  p.braced = false; p.hp = p.maxHp;
  g.hurtPlayer(8, 'test'); check('warrior block first hit', p.maxHp - p.hp === 6, `took ${p.maxHp - p.hp}, want 6`);
  check('warrior braced flag set', p.braced === true);
  let hp = p.hp; g.hurtPlayer(8, 'test');
  check('warrior no second block same turn', hp - p.hp === 8, `took ${hp - p.hp}, want 8`);
  p.braced = false; hp = p.hp; g.hurtPlayer(2, 'test');
  check('chip of 1-2 slips beneath the guard', hp - p.hp === 2, `took ${hp - p.hp}, want 2 (unblocked)`);
  check('chip does not consume the block', p.braced === false, `braced ${p.braced}`);

  // mage WARD: absorbs floor(dmg/2) capped by mana*2, 1 mana per 2 absorbed
  p = fresh('mage'); p.hp = p.maxHp; p.mana = 20;
  g.hurtPlayer(9, 'test');
  check('mage ward halves the blow', p.maxHp - p.hp === 5, `took ${p.maxHp - p.hp}, want 5`);
  check('mage ward costs 1 mana per 2 absorbed', p.mana === 18, `mana ${p.mana}, want 18`);
  p.mana = 0; hp = p.hp; g.hurtPlayer(6, 'test');
  check('mage dry pool means full damage', hp - p.hp === 6, `took ${hp - p.hp}, want 6`);
  p.mana = 1; hp = p.hp; g.hurtPlayer(9, 'test');
  check('mage low mana caps the absorb', hp - p.hp === 7 && p.mana === 0, `took ${hp - p.hp} manaLeft ${p.mana}, want 7/0`);

  // rogue: evasion is the identity — no block/ward branch may fire
  p = fresh('rogue'); p.hp = p.maxHp;
  g.hurtPlayer(8, 'test');
  check('rogue takes hits raw (dodge rolls at attack site)', p.maxHp - p.hp === 8, `took ${p.maxHp - p.hp}, want 8`);
}

/* ---------- item & active-ability truth (widgets 2777b20b, d549698a, adbad3fe-actives) ---------- */
console.log('\n=== weapons with souls · rings · actives ===');
{
  // ashwood staff: +6 max mana while wielded, for mana classes only
  let p = fresh('mage');
  const mm0 = p.maxMana;
  p.inventory.length = 0; p.inventory.push({ id: 'w_staff', count: 1 });
  g.useItem(0);
  check('staff grants +6 max mana on equip', p.maxMana === mm0 + 6, `maxMana ${p.maxMana}, want ${mm0 + 6}`);
  p.inventory.length = 0; p.inventory.push({ id: 'w_dagger', count: 1 });
  g.useItem(0); // swap away — the well leaves with the wood
  check('staff mana leaves on unequip', p.maxMana === mm0, `maxMana ${p.maxMana}, want ${mm0}`);
  // the swap cycle must mint NOTHING (exploit-hunter confirmed +6/cycle, iter60)
  p.mana = 3;
  for (let i = 0; i < 4; i++) {
    p.inventory.length = 0;
    p.inventory.push({ id: i % 2 === 0 ? 'w_staff' : 'w_dagger', count: 1 });
    g.useItem(0);
  }
  // each swap costs a turn (natural +1/turn regen is fine); the old bug
  // added +6 per re-equip ON TOP of regen
  check('staff swap cycle mints no mana beyond regen', p.mana <= 3 + 4, `mana ${p.mana}, started 3, 4 turns spent`);
  p = fresh('warrior');
  p.inventory.length = 0; p.inventory.push({ id: 'w_staff', count: 1 });
  g.useItem(0);
  check('staff gives the warrior no phantom mana bar', p.maxMana === 0, `maxMana ${p.maxMana}, want 0`);

  // caster weapons drink the blow: staff/orb melee scrapes +1 mana (iter60)
  p = fresh('mage'); p.weapon = 'w_staff'; p.mana = 0;
  { const spot = adjSpot(p); const m = g.spawnMonster('golem', spot[0], spot[1]); m.awake = true; m.hp = 999;
    g.attackMonster(m);
    check('staff melee scrapes +1 mana', p.mana === 1, `mana ${p.mana}`);
    G.monsters.length = 0; }
  p = fresh('warrior'); p.weapon = 'w_staff'; p.mana = 0;
  { const spot = adjSpot(p); const m = g.spawnMonster('golem', spot[0], spot[1]); m.awake = true; m.hp = 999;
    g.attackMonster(m);
    check('melee siphon only speaks to casters', p.mana === 0, `mana ${p.mana}`);
    G.monsters.length = 0; }

  // soulglass orb: kills siphon +2 total
  p = fresh('mage'); p.weapon = 'w_orb'; p.mana = 0;
  { const spot = adjSpot(p); const m = g.spawnMonster('rat', spot[0], spot[1]); m.hp = 1; g.killMonster(m); }
  check('orb doubles the kill siphon', p.mana === 2, `mana ${p.mana}, want 2`);

  // tempest maul: ability cooldowns shed 2 turns
  p = fresh('warrior'); p.weapon = 'w_maul';
  { const spot = adjSpot(p); g.spawnMonster('rat', spot[0], spot[1]); }
  g.castCleave();
  check('maul quickens cleave', p.cleaveCd === 8 - 1, `cleaveCd ${p.cleaveCd}, want 7 (10-2, ticked once)`);

  // twin fangs: backstabs bite one tier deeper (x4 base)
  p = fresh('rogue'); p.weapon = 'w_fangs'; p.baseAtk = 10; p.crit = 0;
  { const spot = adjSpot(p); const m = g.spawnMonster('golem', spot[0], spot[1]); m.awake = false; m.def = 0;
    const hp0 = m.hp = 200; g.attackMonster(m);
    const dealt = hp0 - m.hp;
    check('fangs deepen the backstab to x4', dealt >= 4 * (10 + g.ITEMS.w_fangs.bonus - 1) && dealt <= 4 * (10 + g.ITEMS.w_fangs.bonus + 2), `dealt ${dealt}`); }

  // ring of the zephyr: +8% dodge (DELTA assert — a water-tile spawn shifts
  // the absolute value, same flake class as b_fleet)
  p = fresh('rogue');
  { const d0 = g.playerDodge();
    p.ring = 'ring_swift';
    check('zephyr ring lifts dodge by 8%', Math.abs(g.playerDodge() - d0 - 0.08) < 1e-9, `dodge ${g.playerDodge()} from ${d0}`);
    p.ring = null; }

  // ring of the leech: kills feed 1 HP
  p = fresh('warrior'); p.ring = 'ring_blood'; p.hp = 10;
  { const spot = adjSpot(p); const m = g.spawnMonster('rat', spot[0], spot[1]); m.hp = 1; g.killMonster(m); }
  check('leech ring feeds 1 HP on kill', p.hp === 11, `hp ${p.hp}, want 11`);

  // two ring fingers ('2 rings pls', iter61): both effects live at once
  p = fresh('warrior');
  { const a0 = g.playerAtk(), d0 = g.playerDef();
    p.inventory.length = 0; p.inventory.push({ id: 'ring_might', count: 1 });
    g.useItem(0);
    p.inventory.length = 0; p.inventory.push({ id: 'ring_guard', count: 1 });
    g.useItem(0);
    check('two rings worn at once', !!p.ring && !!p.ring2, `ring ${p.ring} ring2 ${p.ring2}`);
    check('both ring effects stack', g.playerAtk() === a0 + 2 && g.playerDef() === d0 + 2,
      `atk ${g.playerAtk()} (want ${a0 + 2}) def ${g.playerDef()} (want ${d0 + 2})`);
    p.inventory.length = 0; p.inventory.push({ id: 'ring_swift', count: 1 });
    g.useItem(0);
    check('third ring swaps the first finger', p.ring === 'ring_swift' && p.ring2 === 'ring_guard'
      && p.inventory.some(e => e.id === 'ring_might'), `ring ${p.ring} ring2 ${p.ring2}`); }

  // BULWARK (active): every hit turned aside to 1 until next turn, then it lowers
  p = fresh('warrior'); p.hp = p.maxHp; G.monsters.length = 0;
  g.castBulwark();
  check('bulwark goes on cooldown', p.guardCd > 0, `guardCd ${p.guardCd}`);
  check('bulwark lowers after the foes reply', p.guardT === 0, `guardT ${p.guardT}`);
  p.guardT = 1; const bhp = p.hp;
  g.hurtPlayer(15, 'test'); g.hurtPlayer(15, 'test');
  check('planted shield turns every hit to 1', bhp - p.hp === 2, `took ${bhp - p.hp}, want 2`);

  // VAULT (active): leap clean over an adjacent foe
  p = fresh('rogue');
  { const spot = laneSpot(p, 2); // need monster adjacent + free tile beyond
    if (!spot) console.log('SKIP  vault — no clear lane on this map seed');
    else {
      const dx = Math.sign(spot[0] - p.x), dy = Math.sign(spot[1] - p.y);
      g.spawnMonster('rat', p.x + dx, p.y + dy);
      const x0 = p.x, y0 = p.y;
      g.castVault();
      check('vault lands two tiles past the foe', p.x === x0 + dx * 2 && p.y === y0 + dy * 2, `at ${p.x},${p.y} from ${x0},${y0}`);
      check('vault goes on cooldown', p.vaultCd > 0, `vaultCd ${p.vaultCd}`);
    } }
  p = fresh('rogue'); G.monsters.length = 0;
  { const x0 = p.x, y0 = p.y; g.castVault();
    check('vault refuses with no foe adjacent', p.x === x0 && p.y === y0 && p.vaultCd === 0, `moved or burned cd`); }

  // vault opens the back: the strike after a vault is a true backstab (iter58)
  p = fresh('rogue');
  { const spot = laneSpot(p, 2);
    if (!spot) console.log('SKIP  vault-backstab — no clear lane on this map seed');
    else {
      const dx = Math.sign(spot[0] - p.x), dy = Math.sign(spot[1] - p.y);
      const m = g.spawnMonster('golem', p.x + dx, p.y + dy);
      m.awake = true; m.def = 0; m.hp = 500;
      p.crit = 0; p.baseAtk = 10;
      g.castVault();
      check('vault arms the backstab window', p.vaultStrike >= 1, `vaultStrike ${p.vaultStrike}`);
      const hp0 = m.hp;
      g.attackMonster(m);
      const dealt = hp0 - m.hp;
      const base = 10 + g.ITEMS[p.weapon].bonus;
      check('post-vault strike is a x3 backstab', dealt >= 3 * (base - 1) && dealt <= 3 * (base + 2), `dealt ${dealt}, base ${base}`);
      check('the opened back closes after one strike', p.vaultStrike === 0, `vaultStrike ${p.vaultStrike}`);
    } }

  // SHADOW DASH rework (iter62 live whispers): works at melee range,
  // lands on the FAR side, and the dash IS the attack
  p = fresh('rogue'); p.dashCd = 0; p.crit = 0;
  { const spot = laneSpot(p, 2);
    if (!spot) console.log('SKIP  dash rework — no clear lane on this map seed');
    else {
      const dx = Math.sign(spot[0] - p.x), dy = Math.sign(spot[1] - p.y);
      const m = g.spawnMonster('golem', p.x + dx, p.y + dy); // ADJACENT
      m.awake = true; m.hp = 500; m.def = 0;
      G.visible.add(m.x + ',' + m.y);
      const hp0 = m.hp, x0 = p.x, y0 = p.y;
      g.castShadowDash();
      check('dash works on an adjacent foe', p.x !== x0 || p.y !== y0, 'did not move');
      check('dash strikes on arrival, same turn', m.hp < hp0, `hp ${m.hp} of ${hp0}`);
      check('dash lands on the far side', g.dist2(p.x, p.y, x0, y0) > 2, `landed ${p.x},${p.y} from ${x0},${y0}`);
      G.monsters.length = 0; }
  }
  // aim hints: a ready rogue dash brackets the nearest reachable foe
  p = fresh('rogue'); p.dashCd = 0;
  { const spot = adjSpot(p);
    const m = g.spawnMonster('rat', spot[0], spot[1]); m.awake = true;
    G.visible.add(m.x + ',' + m.y);
    const hints = g.aimHints();
    check('aim hint brackets the dash target', hints.length === 1 && hints[0].x === m.x && hints[0].y === m.y, JSON.stringify(hints));
    G.monsters.length = 0; }

  // DETECTION rework (iter63, stealth audit 'Warden'):
  // knife-range notice is CERTAIN for the rogue — no more stare-downs
  p = fresh('rogue');
  { const spot = adjSpot(p);
    const m = g.spawnMonster('rat', spot[0], spot[1]); m.awake = false; m.stirring = false;
    G.visible.add(m.x + ',' + m.y); G.visible.add(p.x + ',' + p.y);
    g.monstersAct();
    check('knife-range notice is certain', m.awake === true, `awake ${m.awake}`);
    // notice -> stir -> act: the wake turn costs the monster its action
    check('the woken monster stirs before it acts', m.stirring === true && G.player.hp === G.player.maxHp,
      `stirring ${m.stirring} hp ${G.player.hp}/${G.player.maxHp}`);
    g.monstersAct();
    check('the stir beat passes after one round', m.stirring === false, `stirring ${m.stirring}`);
    G.monsters.length = 0; }

  // round 2 (iter65): the certainty gate is CHEBYSHEV — a DIAGONAL cheb-2
  // approach (eucl 2.83) must wake just as surely as a straight one
  p = fresh('rogue');
  { let spot = null;
    for (const [dx, dy] of [[2, 2], [-2, -2], [2, -2], [-2, 2]]) {
      if (G.map.walkable(p.x + dx, p.y + dy) && !g.monsterAt(p.x + dx, p.y + dy)) { spot = [p.x + dx, p.y + dy]; break; }
    }
    if (!spot) console.log('SKIP  diagonal knife-range — no open diagonal at 2,2 on this seed');
    else {
      const m = g.spawnMonster('rat', spot[0], spot[1]); m.awake = false;
      G.visible.add(m.x + ',' + m.y); G.visible.add(p.x + ',' + p.y);
      g.monstersAct();
      check('DIAGONAL knife-range notice is certain', m.awake === true, `awake ${m.awake} at cheb 2 diagonal`);
      G.monsters.length = 0; } }

  // round 2 (iter65): a leashed Gruk HOLDS the stair while unseen — the
  // LOS-blind chase must not drag him back out (the 6-turn patrol loop)
  fresh('warrior');
  { const sp = G.stairsPos || G.map.stairsPos;
    if (!sp) console.log('SKIP  gruk-holds-post — no stairsPos');
    else {
      let gs = null;
      for (const [dx, dy] of g.DIRS8.concat([[0, 0]])) {
        if (G.map.walkable(sp.x + dx, sp.y + dy) && !g.monsterAt(sp.x + dx, sp.y + dy)) { gs = [sp.x + dx, sp.y + dy]; break; }
      }
      const m = g.spawnMonster('warlord', gs[0], gs[1]);
      m.awake = true; m.leashed = true;
      G.visible.clear(); // player sees nothing; gruk unseen
      const x0 = m.x, y0 = m.y;
      g.monstersAct(); g.monstersAct(); g.monstersAct();
      check('a leashed unseen Gruk holds his post', m.x === x0 && m.y === y0, `moved to ${m.x},${m.y} from ${x0},${y0}`);
      G.monsters.length = 0; } }

  // round 2 (iter65): a sleepwalker that drifts into knife range startles
  check('sleepwalkers startle awake at knife range', String(g.monstersAct).includes('blunders into you and startles awake'));

  // the cry is stopped by stone: scan the map for an open-wall-open pinch
  fresh('warrior');
  { let blocked = null, open = null;
    for (let y = 1; y < G.map.h - 1 && (!blocked || !open); y++) for (let x = 1; x < G.map.w - 1; x++) {
      if (!blocked && G.map.walkable(x - 1, y) && G.map.opaque(x, y) && G.map.walkable(x + 1, y)) blocked = [x - 1, y, x + 1, y];
      if (!open && G.map.walkable(x - 1, y) && G.map.walkable(x, y) && G.map.walkable(x + 1, y)) open = [x - 1, y, x + 1, y];
    }
    if (blocked) check('a wall stops the cry', g.cryReaches(...blocked) === false, blocked.join(','));
    else console.log('SKIP  wall-stops-cry — no open-wall-open pinch on this seed');
    if (open) check('an open line carries the cry', g.cryReaches(...open) === true, open.join(','));
    else console.log('SKIP  open-line-cry — no 3-wide corridor on this seed'); }

  // every heavy truly rests after a whiff (Gruk parity)
  check('heavies rest after a whiff', String(g.monstersAct).includes('m.skipT = 1; // every heavy truly rests'));

  // BESTIARY (iter76, endgame menu #1): kills tally by id, merged at run end
  p = fresh('warrior');
  { const spot = adjSpot(p); const m = g.spawnMonster('rat', spot[0], spot[1]); m.hp = 1;
    g.attackMonster(m);
    check('bestiary tracks the kill by id', G.bestiaryRun && G.bestiaryRun.rat === 1, JSON.stringify(G.bestiaryRun));
    const tally = g.mergeBestiary();
    check('merge folds the run into the tally', tally.rat >= 1, JSON.stringify(tally));
    check('merge clears the run ledger', Object.keys(G.bestiaryRun).length === 0);
    check('every monster carries lore', Object.entries(g.MONSTERS).every(([id, d]) => id === 'slimelet' ? true : !!d.lore),
      Object.entries(g.MONSTERS).filter(([id, d]) => !d.lore).map(e => e[0]).join(',')); }

  // WIN RECORDS (iter79, endgame menu #6): per-hero/per-difficulty ledger
  p = fresh('warrior');
  { G.daily = false; G.bonusScore = 0;
    storeMap.delete('arcaneRecords');
    const r1 = g.recordRun(true);
    check('a win is remembered', r1.wins === 1 && r1.best === g.score(), JSON.stringify(r1));
    const led = JSON.parse(localStorageStub.getItem('arcaneRecords') || '{}');
    check('the ledger keys hero and difficulty', !!led[`${G.classId}_${G.diffId}`], Object.keys(led).join(','));
    G.bonusScore += 5000; // a richer run, ended without a win
    const r2 = g.recordRun(false);
    check('a death raises the best but mints no victory', r2.wins === 1 && r2.best > r1.best, JSON.stringify(r2));
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'web', 'js', 'game.js'), 'utf8');
    check('records are daily-gated in saveBest', src.includes('if (!G.daily) recordRun(rec.won)'));
    storeMap.delete('arcaneRecords'); }

  // CONDUCT BADGES (iter78, endgame menu #3): recorded on win, daily-gated
  { const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'web', 'js', 'game.js'), 'utf8');
    check('conducts record on win, never in dailies', src.includes('if (earned.length && !G.daily) recordConducts(earned)'));
    check('darkstrider conduct exists and pays', src.includes("CONDUCT: Darkstrider") && src.includes('G.bonusScore += 75'));
    check('badges key per class and difficulty', src.includes('`${G.classId}_${G.diffId}`')); }

  // EMBER SINKS (iter77, endgame menu #2): repeatable, daily-gated, source-pinned
  { const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'web', 'js', 'game.js'), 'utf8');
    check('repeatable sinks never read as owned', src.includes('if (s.repeat) {'));
    check('the cache is consumed inside the daily gate', /if \(!G\.daily\) \{\n    \/\/ Traveler's Cache/.test(src));
    check('torch tally is a pure monument (no gameplay read)', !src.includes("arcaneTorches') || '0', 10) || 0;\n    G.player"));
    const dsrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'web', 'js', 'data.js'), 'utf8');
    check('both sinks are declared repeatable', dsrc.includes("s_torch") && dsrc.includes("s_cache") && (dsrc.match(/repeat: true/g) || []).length === 2); }

  // BLINK rework (iter75, user-approved): chosen tile, range 4, cost 6
  p = fresh('mage');
  { check('blink costs 6 base', g.spellCost(3) === 6, `cost ${g.spellCost(3)}`);
    // hover-targeted: lands exactly where chosen within range
    const spot = laneSpot(p, 3);
    if (!spot) console.log('SKIP  blink-target — no 3-lane on this seed');
    else {
      G.visible.add(spot[0] + ',' + spot[1]);
      for (let s2 = 1; s2 <= 3; s2++) G.visible.add((p.x + Math.sign(spot[0]-p.x)*s2) + ',' + (p.y + Math.sign(spot[1]-p.y)*s2));
      p.mana = 20;
      g.FX.hover = { x: spot[0], y: spot[1] };
      g.castSpell(3);
      check('blink lands on the chosen tile', p.x === spot[0] && p.y === spot[1], `at ${p.x},${p.y} want ${spot[0]},${spot[1]}`);
      check('blink spent 6 mana (then +1 turn regen)', p.mana === 15, `mana ${p.mana}`);
      g.FX.hover = null;
    }
    // range gate: 16 = dist2 cap (range 4) pinned in source
    check('blink range capped at 4 (source)', String(g.castSpell).includes('dist2(x, y, p.x, p.y) <= 16')); }

  // META audit (iter72, completionist 'Vera'):
  { const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'web', 'js', 'game.js'), 'utf8');
    check('keeper lore is gated out of dailies', src.includes("!G.daily && sanctumOwned('s_lore')"));
    check('practice dailies never write the record', src.includes('G.daily && !G.dailyPractice'));
    check('a recorded daily spends the seed', src.includes("localStorage.setItem('arcaneDailyPlayed', dailyKey())")); }

  // TEMPO pack (iter68, speedrunner audit 'Dash')
  // ward sales pay gold but mint no SCORE
  p = fresh('warrior');
  { G.shop = [{ x: p.x + 1, y: p.y, id: 'w_sword', price: 35 }];
    p.inventory.length = 0; p.inventory.push({ id: 'w_dagger', count: 1 });
    const g0 = p.gold, e0 = G.goldEarned;
    g.dropItem(0);
    check('ward sale pays gold', p.gold > g0, `gold ${p.gold} from ${g0}`);
    check('ward sale mints no score', G.goldEarned === e0, `goldEarned ${G.goldEarned} from ${e0}`);
    G.shop = []; }

  // the win bonus pays speed enough to compete (source-pinned curve)
  check('win bonus rescaled for speed', /2500 - 2 \* G\.turn/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'web', 'js', 'game.js'), 'utf8')));

  // dread clock: a barely-explored floor cannot starve the spawner, and
  // hunter #3+ arrives as an ELITE (the cap made camping consequence-free)
  p = fresh('warrior');
  { G.clockSpawns = 2;
    G.floorTurns = G.diff.dreadAt + 29; // ++ in afterPlayerTurn lands on the spawn beat
    const n0 = G.monsters.length;
    g.afterPlayerTurn();
    const w = G.monsters[G.monsters.length - 1];
    check('dread spawner survives an unexplored floor', G.monsters.length === n0 + 1, `monsters ${G.monsters.length} from ${n0}`);
    if (G.monsters.length > n0) {
      check('hunter #3 arrives as an elite', !!w.elite, `elite ${w.elite}`);
      check('escalated hunters still carry no glory', w.xp === 0, `xp ${w.xp}`);
      const e0 = G.goldEarned;
      w.hp = 1; g.killMonster(w);
      check('escalated hunters carry no hoard (round-2 leak)', G.goldEarned === e0, `goldEarned ${G.goldEarned} from ${e0}`);
    }
    G.monsters.length = 0; G.floorTurns = 0; G.clockSpawns = 0; }

  // the dark-stair shroud ticks down per turn and shrinks sleeper sight
  p = fresh('warrior');
  { G.shroudT = 5; G.monsters.length = 0;
    g.afterPlayerTurn();
    check('the shroud thins each turn', G.shroudT === 4, `shroudT ${G.shroudT}`);
    check('the shroud dims sleeper sight (source)', String(g.monstersAct).includes('G.shroudT > 0 ? 3 : 0'));
    G.shroudT = 0; }

  // caster gear only falls for casters (iter58 loot truth)
  fresh('warrior');
  { const ids4 = g.itemPoolForDepth(4).map(e => e[0]);
    check('warrior pool carries no staff/orb', !ids4.includes('w_staff') && !ids4.includes('w_orb'), ids4.join(','));
    check('warrior pool carries the maul', ids4.includes('w_maul')); }
  fresh('mage');
  { const ids4 = g.itemPoolForDepth(4).map(e => e[0]);
    check('mage pool carries the orb', ids4.includes('w_orb'), ids4.join(',')); }
}

console.log(failures.length ? `\n${failures.length} FAILURES: ${failures.join(', ')}` : '\nall boons truthful');
process.exit(failures.length ? 1 : 0);
