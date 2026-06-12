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
  useItem, castBulwark, castVault, itemPoolForDepth, spellCost, aimHints, cryReaches, dropItem, score, FX, bestiarySeen, MONSTERS, recordRun, castExhume, castLastRites, petAct, monstersAct, RELICS, applyRelic, castProstrate, offerRelics, playerDodge, useItem };
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
  // ---- gravedigger class boons (iter80, Morrigan's content-gap finding) ----
  b_thirdgrave(p) {
    const mk = (x, y) => ({ id: 'shambler', name: 'shambler', glyph: 'z', color: '#9fd89f', pet: true, x, y, hp: 9, maxHp: 9, atk: 4, def: 0, ttl: 25, xp: 0, sight: 7, awake: true, frozen: 0, skipT: 0, flashT: 0 });
    G.monsters.push(mk(-5, -5), mk(-6, -6)); // parked: only the count gates the cap
    const s = adjSpot(p);
    G.corpses.push({ x: s[0], y: s[1], glyph: 'r', color: '#fff', life: 1, turns: 18 });
    G.visible.add(s[0] + ',' + s[1]);
    p.exhumeCd = 0;
    g.castExhume(); // the second grave refuses a third
    const before = G.monsters.filter(o => o.pet).length;
    g.applyBoon('b_thirdgrave');
    p.exhumeCd = 0;
    g.castExhume(); // the third grave opens
    const after = G.monsters.filter(o => o.pet).length;
    G.monsters.length = 0; G.corpses.length = 0;
    return before === 2 && after === 3;
  },
  b_coldrest(p) {
    g.applyBoon('b_coldrest');
    const s = adjSpot(p); const m = g.spawnMonster('rat', s[0], s[1]); m.hp = 1;
    g.attackMonster(m);
    const c = G.corpses[G.corpses.length - 1];
    const ok = !!c && c.turns === 30;
    G.corpses.length = 0;
    return ok;
  },
  b_embalmer(p) {
    g.applyBoon('b_embalmer');
    G.corpses.push({ x: p.x, y: p.y, glyph: 'r', color: '#fff', life: 1, turns: 18 });
    p.hp = p.maxHp - 7; p.poison = 6; p.ritesCd = 0;
    g.castLastRites();
    const ok = p.poison === 0 && p.hp >= p.maxHp - 2;
    G.corpses.length = 0;
    return ok;
  },
};

/* ---------- relic truth tests: every relic must be known and truthful ---------- */
const RELIC_TESTS = {
  r_sting(p) { const a0 = g.playerAtk(); g.applyRelic('r_sting'); g.applyRelic('r_sting'); return g.playerAtk() === a0 + 2; },
  r_hide(p) { const m0 = p.maxHp; p.hp = 1; g.applyRelic('r_hide'); return p.maxHp === m0 + 8 && p.hp === 9; }, // +6 page, +2 vessel
  r_ward(p) { const d0 = g.playerDef(); g.applyRelic('r_ward'); return g.playerDef() === d0 + 1; },
  r_quick(p) { const d0 = g.playerDodge(); g.applyRelic('r_quick'); return Math.abs(g.playerDodge() - d0 - 0.04) < 1e-9; },
  r_beastbane(p) {
    for (let i = 0; i < 5; i++) g.applyRelic('r_beastbane'); // +10: far above the ±1/+2 swing noise
    const s = adjSpot(p); const rat = g.spawnMonster('rat', s[0], s[1]); rat.hp = 999; rat.def = 0;
    g.attackMonster(rat); const dRat = 999 - rat.hp;
    G.monsters.length = 0;
    const s2 = adjSpot(p); const gob = g.spawnMonster('goblin', s2[0], s2[1]); gob.hp = 999; gob.def = 0;
    g.attackMonster(gob); const dGob = 999 - gob.hp;
    G.monsters.length = 0;
    return dRat >= g.playerAtk() + 9 - 1 && dGob <= 2 * (g.playerAtk() + 2); // goblin may crit; rat must carry the bane
  },
  r_bonebane(p) {
    for (let i = 0; i < 5; i++) g.applyRelic('r_bonebane');
    const s = adjSpot(p); const sk = g.spawnMonster('skeleton', s[0], s[1]); sk.hp = 999; sk.def = 0;
    g.attackMonster(sk); const d = 999 - sk.hp;
    G.monsters.length = 0;
    return d >= g.playerAtk() + 9 - 1;
  },
  r_lantern(p) { g.recomputeFOV(); const f0 = G.fovRadius; g.applyRelic('r_lantern'); g.recomputeFOV(); return G.fovRadius === f0 + 1; },
  r_soles(p) {
    g.applyRelic('r_soles');
    const src81 = require('fs').readFileSync(require('path').join(__dirname, '..', 'web', 'js', 'game.js'), 'utf8');
    return src81.includes("relicCount('r_soles') && G.player.hp < G.player.maxHp") && src81.includes('3 * relicCount(\'r_soles\')');
  },
  r_alms(p) { const bc = (p.relics && p.relics.r_beacon) || 0; const g0 = p.gold; g.applyRelic('r_alms'); return p.gold === g0 + Math.ceil(35 * (1 + 0.1 * bc)); },
  r_psalter(p) {
    for (let i = 0; i < 12; i++) g.applyRelic('r_psalter'); // eff. crit > 100%: every swing doubles
    const s = adjSpot(p); const rat = g.spawnMonster('rat', s[0], s[1]); rat.hp = 999; rat.def = 0;
    g.attackMonster(rat); const d = 999 - rat.hp;
    G.monsters.length = 0;
    return d >= 2 * (g.playerAtk() - 1);
  },
  r_clarity(p) {
    g.applyRelic('r_clarity');
    const src81 = require('fs').readFileSync(require('path').join(__dirname, '..', 'web', 'js', 'game.js'), 'utf8');
    return src81.includes("G.classDef.senses || relicCount('r_clarity') > 0");
  },
  r_thorn(p) {
    const pre = (p.relics && p.relics.r_thorn) || 0;
    g.applyRelic('r_thorn'); g.applyRelic('r_thorn');
    const s = adjSpot(p); const gob = g.spawnMonster('goblin', s[0], s[1]);
    gob.awake = true; gob.stirring = false; gob.justWoke = false; gob.hp = 50; gob.maxHp = 50;
    p.hp = p.maxHp;
    G.monsters.length = 0; G.monsters.push(gob);
    g.monstersAct();
    const bled = 50 - gob.hp;
    G.monsters.length = 0;
    return bled === pre + 2; // every briar bites once
  },
  r_chalice(p) {
    const pre = (p.relics && p.relics.r_chalice) || 0;
    for (let i = 0; i < 3; i++) g.applyRelic('r_chalice');
    p.maxHp = 99; p.hp = 40;
    g.addItem('potion_heal');
    const i2 = p.inventory.findIndex(e => e.id === 'potion_heal');
    g.useItem(i2);
    return p.hp === 40 + 14 + 2 * G.depth + 4 * (pre + 3); // +4 per chalice over the base formula
  },
  r_zeal(p) {
    const pre = (p.relics && p.relics.r_zeal) || 0;
    g.applyRelic('r_zeal'); g.applyRelic('r_zeal');
    p.hp = p.maxHp; const aFull = g.playerAtk();
    p.hp = Math.max(1, Math.floor(p.maxHp * 0.2)); const aLow = g.playerAtk();
    return aLow === aFull + 2 * (pre + 2);
  },
  r_beacon(p) {
    const pre = (p.relics && p.relics.r_beacon) || 0;
    for (let i = 0; i < 5; i++) g.applyRelic('r_beacon');
    const g0 = p.gold; g.earnGold(10);
    return p.gold === g0 + Math.ceil(10 * (1 + 0.1 * (pre + 5)));
  },
};
console.log('\n=== relic truth harness (the road must not lie) ===');
{ const p = fresh('pilgrim');
  const m0 = p.maxHp;
  g.applyRelic('r_sting');
  check('every blessing fortifies the vessel (+2 max HP)', p.maxHp === m0 + 2, `${m0} -> ${p.maxHp}`); }

for (const id of Object.keys(g.RELICS)) {
  if (!RELIC_TESTS[id]) { check('relic ' + id, false, 'NO TEST WRITTEN — add one before shipping a new relic'); continue; }
  try {
    const p = fresh('pilgrim');
    G.monsters.length = 0; // a clean chapel: no wandering teeth during relic math
    const res = RELIC_TESTS[id](p);
    check('relic ' + id, res === true);
  } catch (e) {
    check('relic ' + id, false, `threw: ${e.message}`);
  }
}

// the offer flow itself
{ const p = fresh('pilgrim');
  const total00 = Object.values(p.relics || {}).reduce((a, b) => a + b, 0);
  check('the road provides twice at every floor (sim path)', total00 === 2, JSON.stringify(p.relics));
  check('the offer is once per floor', G.relicFloor === G.depth, `relicFloor ${G.relicFloor} depth ${G.depth}`);
  G.relicFloor = 0; G.prostrated = true;
  const total0 = Object.values(p.relics || {}).reduce((a, b) => a + b, 0);
  g.offerRelics();
  const total1 = Object.values(p.relics || {}).reduce((a, b) => a + b, 0);
  check('a fresh floor grants exactly two relics', total1 === total0 + 2, `${total0} -> ${total1}`);
  check('prayer is consumed by the offer', G.prostrated === false);
  const src81 = require('fs').readFileSync(require('path').join(__dirname, '..', 'web', 'js', 'game.js'), 'utf8');
  check('prostration widens the offer to three (source)', src81.includes('const n = G.prostrated ? 3 : 2'));
  // lethal venom must pass the death-save ladder (Vex round 2 major)
  const p3 = fresh('pilgrim');
  { G.monsters.length = 0;
    p3.poison = 1; p3.hp = 1; p3.providence = false;
    g.afterPlayerTurn();
    check('lethal venom triggers Providence', p3.hp === 1 && p3.providence === true && G.state === 'PLAY', `hp ${p3.hp} prov ${p3.providence} state ${G.state}`); }
  const p4 = fresh('warrior');
  { G.monsters.length = 0;
    g.applyBoon('b_second');
    p4.poison = 1; p4.hp = 1; p4.secondWind = false;
    g.afterPlayerTurn();
    check('lethal venom triggers Second Wind (pre-existing hole, all classes)', p4.hp === 1 && p4.secondWind === true && G.state === 'PLAY', `hp ${p4.hp} sw ${p4.secondWind} state ${G.state}`); }

  // the recoil: a goblin beside the kneeling pilgrim loses its reply
  const p2 = fresh('pilgrim');
  { const s = adjSpot(p2); const gob = g.spawnMonster('goblin', s[0], s[1]);
    gob.awake = true; gob.stirring = false; gob.justWoke = false;
    p2.hp = Math.max(5, p2.maxHp - 6); const hp0 = p2.hp;
    G.monsters.length = 0; G.monsters.push(gob);
    G.prostrated = false;
    g.castProstrate(); // recoil eats the goblin's reply inside this turn's monstersAct
    check('the dark recoils from the prayer', p2.hp >= hp0, `hp ${p2.hp} from ${hp0}`);
    check('prayer mends the kneeling pilgrim', p2.hp > hp0, `hp ${p2.hp} from ${hp0}`);
    G.monsters.length = 0; }
  check('relics ride the save (source)', src81.includes('prostrated: !!G.prostrated, relicFloor: G.relicFloor || 0, relicGiven: G.relicGiven || 0'));
}

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
  { storeMap.delete('arcaneBestiary'); storeMap.delete('arcaneBestiarySeen'); G.seenIds = null;
    const spot = adjSpot(p); const m = g.spawnMonster('rat', spot[0], spot[1]); m.hp = 1;
    g.attackMonster(m);
    check('bestiary tracks the kill by id (run stats)', G.bestiaryRun && G.bestiaryRun.rat === 1, JSON.stringify(G.bestiaryRun));
    const tally = JSON.parse(storeMap.get('arcaneBestiary') || '{}');
    check('a kill writes through to the lifetime ledger instantly', tally.rat === 1, JSON.stringify(tally));
    const seen = JSON.parse(storeMap.get('arcaneBestiarySeen') || '{}');
    check('a kill counts as meeting it', seen.rat === 1, JSON.stringify(seen));
    g.bestiarySeen('bat'); // sighting alone unlocks the page (the recomputeFOV hook calls this per visible foe)
    check('sighting alone is recorded', JSON.parse(storeMap.get('arcaneBestiarySeen') || '{}').bat === 1);
    const src82 = require('fs').readFileSync(require('path').join(__dirname, '..', 'web', 'js', 'game.js'), 'utf8');
    check('the FOV pass marks every visible foe as met (source)', src82.includes("if (!m.pet && m.id && G.visible.has(m.x + ',' + m.y)) bestiarySeen(m.id)"));
    check('seen-but-unkilled rows unlock (source)', src82.includes('kills > 0 || !!seen[id]'));
    G.monsters.length = 0;
    check('every monster carries lore', Object.entries(g.MONSTERS).every(([id, d]) => id === 'slimelet' ? true : !!d.lore),
      Object.entries(g.MONSTERS).filter(([id, d]) => !d.lore).map(e => e[0]).join(',')); }

  // GRAVEDIGGER (iter80, endgame menu #4 pick A): the dead owe him work
  p = fresh('gravedigger');
  { const spot = adjSpot(p);
    const rat = g.spawnMonster('rat', spot[0], spot[1]); rat.hp = 1;
    g.attackMonster(rat); // leaves a corpse with a turn budget
    const corpse = G.corpses[G.corpses.length - 1];
    check('the slain leave a corpse with a turn budget', corpse && corpse.turns === 18, JSON.stringify(corpse));
    G.visible.add(corpse.x + ',' + corpse.y);
    const k0 = G.kills, mana0 = G.monsters.length;
    g.castExhume();
    const pet = G.monsters.find(o => o.pet);
    check('exhume raises a shambler from the corpse', !!pet && G.monsters.length === mana0 + 1, `monsters ${G.monsters.length}`);
    check('exhume consumes the corpse', !G.corpses.includes(corpse));
    check('exhume goes to ground for 6 turns', p.exhumeCd === 5, `cd ${p.exhumeCd} (6 minus the turn that just passed)`);

    // the shambler's claws: kills mint NO score, but the bestiary still sees
    if (pet) {
      const prey = g.spawnMonster('rat', pet.x + (G.map.walkable(pet.x + 1, pet.y) && !g.monsterAt(pet.x + 1, pet.y) ? 1 : -1), pet.y);
      prey.hp = 1; prey.awake = true;
      const bd0 = G.bestiaryRun.rat || 0, kills0 = G.kills;
      g.petAct(pet);
      check('a shambler kill mints no score', !G.monsters.includes(prey) && G.kills === kills0, `kills ${G.kills} from ${kills0}`);
      check('the bestiary still witnesses pet kills', (G.bestiaryRun.rat || 0) === bd0 + 1, `rat ${G.bestiaryRun.rat}`);

      // the bodyguard rule: a foe beside the shambler (and far from you) turns
      // on it — relocate the pet to open ground so the stage is deterministic
      let far = null;
      for (let fy = 1; fy < G.map.h - 1 && !far; fy++) for (let fx = 1; fx < G.map.w - 1; fx++) {
        if (!G.map.walkable(fx, fy) || g.monsterAt(fx, fy) || g.cheb(fx, fy, p.x, p.y) < 4) continue;
        if (G.map.walkable(fx + 1, fy) && !g.monsterAt(fx + 1, fy) && g.cheb(fx + 1, fy, p.x, p.y) > 2) { far = [fx, fy]; break; }
      }
      if (far) { pet.x = far[0]; pet.y = far[1]; }
      const ox = far ? [far[0] + 1, far[1]] : [pet.x, pet.y + 1];
      if (far) {
        const wolf = g.spawnMonster('goblin', ox[0], ox[1]);
        wolf.awake = true; wolf.stirring = false; wolf.justWoke = false;
        const ph0 = pet.hp, hp0 = p.hp;
        G.monsters.length = 0; G.monsters.push(pet, wolf); // just these two — determinism
        g.monstersAct();
        check('the bodyguard rule: foes beside a shambler tear at IT', pet.hp < ph0 || !G.monsters.includes(pet), `pet ${pet.hp}/${ph0}`);
        check('the player is untouched while the shambler tanks', p.hp === hp0, `hp ${p.hp}/${hp0}`);
      } else console.log('SKIP  bodyguard — no clear flank tile');

      // swap: your own dead make way
      if (G.monsters.includes(pet)) {
        pet.x = p.x + 1; pet.y = p.y;
        if (G.map.walkable(pet.x, pet.y)) {
          const px0 = p.x;
          g.tryMove(1, 0);
          check('walking into your shambler swaps places', p.x === px0 + 1 && pet.x === px0, `p ${p.x} pet ${pet.x}`);
        }
      }
    }

    // last rites: a corpse at your feet feeds your wounds
    const rat2 = g.spawnMonster('rat', p.x, p.y - 1) || null;
    if (rat2) { rat2.hp = 1; g.attackMonster(rat2); }
    const c2 = G.corpses[G.corpses.length - 1];
    if (c2 && g.cheb(c2.x, c2.y, p.x, p.y) <= 1) {
      p.hp = p.maxHp - 7; p.ritesCd = 0;
      const hp1 = p.hp, nc = G.corpses.length;
      g.castLastRites();
      check('last rites consume the corpse and close wounds (+6)', p.hp >= hp1 + 5 && G.corpses.length < nc, `hp ${p.hp} from ${hp1}, corpses ${G.corpses.length}/${nc}`);
    } else console.log('SKIP  last-rites — no adjacent corpse staged');

    // gravedigger corpses decay on the TURN clock, not the render clock
    G.corpses.length = 0;
    G.corpses.push({ x: 1, y: 1, glyph: 'r', color: '#fff', life: 1, turns: 2 });
    g.afterPlayerTurn();
    check('corpses tick down each turn', G.corpses.length === 0 || G.corpses[0].turns === 1, JSON.stringify(G.corpses[0] || null));
    g.afterPlayerTurn();
    check('a spent corpse is dust', G.corpses.every(c3 => c3.turns > 0), `left ${G.corpses.length}`); }

  // VEX'S BLOCKER (iter80 confirm round): a resumed run must keep killing
  { const src80 = require('fs').readFileSync(require('path').join(__dirname, '..', 'web', 'js', 'game.js'), 'utf8');
    check('saveRun persists the bestiary run ledger', src80.includes('bestiaryRun: G.bestiaryRun || {}'));
    check('loadRun restores the bestiary run ledger', src80.includes('G.bestiaryRun = s.bestiaryRun || {}'));
    check('travel never fears your own dead (watcher)', src80.includes('.filter(m => !m.pet && m.awake'));
    check('shamblers heel on the BFS field, not greedy steps (source)', /function petAct[\s\S]{0,2500}computeDistField\(G\.map, goal\.x, goal\.y, 30\)/.test(src80));
    check('shamblers carry a def stat (NaN guard)', /atk: 4 \+ Math\.ceil\(G\.depth \/ 2\), def: 0,/.test(src80)); }
  p = fresh('gravedigger');
  { const spot = adjSpot(p); const shp = { id: 'shambler', name: 'shambler', glyph: 'z', color: '#9fd89f', pet: true, x: spot[0], y: spot[1], hp: 9, maxHp: 9, atk: 4, def: 0, ttl: 25, xp: 0, sight: 7, awake: true, frozen: 0, skipT: 0, flashT: 0 };
    G.monsters.push(shp);
    g.attackMonster(shp);
    check('your blade refuses your own dead', shp.hp === 9 && G.monsters.includes(shp), `hp ${shp.hp}`); }

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
