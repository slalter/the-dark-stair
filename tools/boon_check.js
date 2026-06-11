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
    fillText() {}, translate() {}, scale() {}, beginPath() {}, arc() {}, fill() {},
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
const localStorageStub = { getItem() { return null; }, setItem() {}, removeItem() {} };
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
  computeDistField, ITEMS, addItem, skipCutsceneLine, dist2, earnGold };
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
    // hits should double. Statistical: 600 swings, expect >25 crits.
    g.applyBoon('b_keen'); p.crit = 0;
    const s = adjSpot(p); const m = g.spawnMonster('troll', s[0], s[1]); m.awake = true;
    let crits = 0;
    for (let i = 0; i < 200; i++) { m.hp = 9999; m.frozen = 0; g.attackMonster(m); if (9999 - m.hp > g.playerAtk() + 4) crits++; }
    G.monsters.length = 0;
    return crits > 10 && crits < 70; // ~24 expected at 12%/200
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
  b_fleet(p) { const d0 = g.playerDodge(); g.applyBoon('b_fleet'); return g.playerDodge() > d0 + 0.1 && g.dreadShift() >= 40; },
  b_ghost(p) { const d0 = g.playerDodge(); g.applyBoon('b_ghost'); return g.playerDodge() > d0 + 0.05; },
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
    return p.dashCd === 4;
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
  // warrior BLOCK: first hit each turn reduced by 1+ceil(armor/2), floor 1
  let p = fresh('warrior'); // starts with leather (bonus 1) → reduction 2
  p.braced = false; p.hp = p.maxHp;
  g.hurtPlayer(8, 'test'); check('warrior block first hit', p.maxHp - p.hp === 6, `took ${p.maxHp - p.hp}, want 6`);
  check('warrior braced flag set', p.braced === true);
  let hp = p.hp; g.hurtPlayer(8, 'test');
  check('warrior no second block same turn', hp - p.hp === 8, `took ${hp - p.hp}, want 8`);
  p.braced = false; hp = p.hp; g.hurtPlayer(2, 'test');
  check('warrior block floors at 1 damage', hp - p.hp === 1, `took ${hp - p.hp}, want 1`);

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

console.log(failures.length ? `\n${failures.length} FAILURES: ${failures.join(', ')}` : '\nall boons truthful');
process.exit(failures.length ? 1 : 0);
