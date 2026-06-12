#!/usr/bin/env node
/* Headless simulation harness for Arcane Depths II.
 * Loads the real game code under DOM stubs and plays full runs with a bot policy.
 *
 * Usage: node sim.js <warrior|rogue|mage> <runs> [--json] [--policy=smart|reckless|coward]
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* ---------- DOM / browser stubs ---------- */
function makeCtxStub() {
  const grad = { addColorStop() {} };
  return {
    save() {}, restore() {}, fillRect() {}, strokeRect() {}, clearRect() {},
    fillText() {}, translate() {}, scale() {}, setTransform() {}, beginPath() {}, arc() {}, fill() {},
    stroke() {}, ellipse() {},
    createRadialGradient() { return grad; }, createLinearGradient() { return grad; },
    measureText() { return { width: 10 }; },
    fillStyle: '', strokeStyle: '', font: '', textAlign: '', textBaseline: '',
    globalAlpha: 1, lineWidth: 1,
  };
}
function makeElementStub() {
  const el = {
    children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    style: {},
    textContent: '', innerHTML: '', title: '', className: '', id: '',
    width: 100, height: 100, clientWidth: 100, clientHeight: 100,
    scrollTop: 0, scrollHeight: 0,
    dataset: {},
    appendChild(c) { this.children.push(c); },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); },
    get firstChild() { return this.children[0] || null; },
    addEventListener() {},
    blur() {},
    querySelector() { return makeElementStub(); },
    getContext() { return makeCtxStub(); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 640 }; },
  };
  return el;
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
const windowStub = {
  addEventListener() {},
  devicePixelRatio: 1,
  innerWidth: 1280, innerHeight: 800,
};
const localStorageStub = { getItem() { return null; }, setItem() {}, removeItem() {} };
const requestAnimationFrameStub = () => 0;
class ImageStub { set src(v) { /* no load */ } }

/* ---------- load game code ---------- */
const root = path.join(__dirname, '..', 'web', 'js');
const code = ['core.js', 'data.js', 'dungeon.js', 'render.js', 'game.js']
  .map(f => fs.readFileSync(path.join(root, f), 'utf8'))
  .join('\n;\n');

const EXPORTS = `
return { G, RNG, newGame, startLevel, tryMove, afterPlayerTurn, attackMonster, castSpell, diagOpen, castCharge, castShadowDash,
  castExhume, castLastRites, castProstrate,
  castCleave, useItem, descend, computeDistField, DIRS8, cheb, dist2, ITEMS, MONSTERS, CLASSES, T,
  FINAL_DEPTH, tileWalkable, monsterAt, recomputeFOV, spawnMonster, playerAtk, playerDef,
  addItem, generateMap, score, onEnterTile, makeElite, useShrine, openGoldChest, traceBeam, SPELLS, FX,
  setDifficulty, DIFFICULTIES };
`;
const game = new Function(
  'window', 'document', 'localStorage', 'requestAnimationFrame', 'Image', 'navigator',
  code + EXPORTS
)(windowStub, documentStub, localStorageStub, requestAnimationFrameStub, ImageStub, { userAgent: 'NodeSim' });

const { diagOpen, castCharge, castShadowDash } = game;
const { G, newGame, tryMove, afterPlayerTurn, attackMonster, castSpell, useItem, descend,
  computeDistField, DIRS8, cheb, dist2, ITEMS, T, FINAL_DEPTH, tileWalkable } = game;
const FXref = game.FX;

/* ---------- bot policies ---------- */
function stepTo(tx, ty) {
  const f = computeDistField(G.map, tx, ty, 999);
  let best = null, bd = f[G.map.idx(G.player.x, G.player.y)];
  if (bd === -1) return false;
  for (const [dx, dy] of DIRS8) {
    const nx = G.player.x + dx, ny = G.player.y + dy;
    if (!G.map.inBounds(nx, ny)) continue;
    if (!diagOpen(G.map, G.player.x, G.player.y, dx, dy)) continue;
    const fd = f[G.map.idx(nx, ny)];
    if (fd !== -1 && fd < bd) { bd = fd; best = [dx, dy]; }
  }
  if (!best) return false;
  const t0 = G.turn;
  tryMove(best[0], best[1]);
  return G.turn > t0;
}
function frontierTarget() {
  const map = G.map, p = G.player;
  const field = new Int16Array(map.w * map.h).fill(-1);
  const qx = [p.x], qy = [p.y];
  field[map.idx(p.x, p.y)] = 0;
  for (let h = 0; h < qx.length; h++) {
    const x = qx[h], y = qy[h];
    for (const [dx, dy] of DIRS8) {
      const nx = x + dx, ny = y + dy;
      if (!map.inBounds(nx, ny)) continue;
      const i = map.idx(nx, ny);
      if (!diagOpen(map, x, y, dx, dy)) continue;
      if (!map.explored[i]) { if (x !== p.x || y !== p.y) return { x, y }; continue; }
      if (!tileWalkable(map.tiles[i]) || field[i] !== -1) continue;
      field[i] = field[map.idx(x, y)] + 1;
      qx.push(nx); qy.push(ny);
    }
  }
  return null;
}

function botTurn(policy, stats) {
  // headless: no render loop drains FX arrays — clear to avoid unbounded growth
  if (typeof FXref !== 'undefined') { FXref.particles.length = 0; FXref.floaters.length = 0; }
  const p = G.player;
  const casual = policy === 'casual'; // sloppy play: never dodges telegraphs, heals late, ignores shops/cleave/nova
  // dodge telegraphed heavy blows: step off the marked tile (stay adjacent to punish)
  const winder = !casual && G.monsters.find(m => m.windup === 1 && m.windupX === p.x && m.windupY === p.y && cheb(m.x, m.y, p.x, p.y) <= 1);
  if (winder) {
    let best = null;
    for (const [dx, dy] of DIRS8) {
      const nx = p.x + dx, ny = p.y + dy;
      if (!G.map.walkable(nx, ny) || game.monsterAt(nx, ny)) continue;
      if (!diagOpen(G.map, p.x, p.y, dx, dy)) continue;
      const adj = cheb(nx, ny, winder.x, winder.y) <= 1;
      if (!best || (adj && !best.adj)) best = { dx, dy, adj };
    }
    if (best) { tryMove(best.dx, best.dy); return; }
    // boxed in: no legal dodge — punish the winder instead of freezing
    attackMonster(winder);
    if (G.state === 'PLAY') afterPlayerTurn();
    return;
  }
  // dodge a channeled beam: step off the highlighted line
  const beamer = !casual && G.monsters.find(m => m.beam && m.beam.some(t => t.x === p.x && t.y === p.y));
  if (beamer) {
    for (const [dx, dy] of DIRS8) {
      const nx = p.x + dx, ny = p.y + dy;
      if (!G.map.walkable(nx, ny) || game.monsterAt(nx, ny)) continue;
      if (!beamer.beam.some(t => t.x === nx && t.y === ny)) { tryMove(dx, dy); return; }
    }
  }
  const healAt = policy === 'reckless' ? 0.2 : casual ? 0.3 : policy === 'coward' ? 0.5 : 0.35;
  const COST = game.SPELLS ? game.SPELLS.map(s => s.cost) : [6, 8, 6, 4];
  if (p.hp < p.maxHp * healAt) {
    const i = p.inventory.findIndex(e => e.id === 'potion_heal');
    if (i >= 0) { useItem(i); stats.potions++; return; }
    if (p.maxMana && p.mana >= COST[2] && p.hp < p.maxHp) { castSpell(2); return; }
  }
  // gravedigger: rites are cheaper than potions — spend the dead first
  if (G.classId === 'gravedigger' && p.ritesCd === 0 && p.hp < p.maxHp * 0.75) {
    const t0 = G.turn;
    game.castLastRites();
    if (G.turn > t0 || G.state !== 'PLAY') return;
  }
  if (p.poison > 2) {
    const i = p.inventory.findIndex(e => e.id === 'potion_anti');
    if (i >= 0) { useItem(i); return; }
  }
  const wB = p.weapon ? ITEMS[p.weapon].bonus : 0;
  const wi = p.inventory.findIndex(e => ITEMS[e.id].kind === 'weapon' && ITEMS[e.id].bonus > wB);
  if (wi >= 0) { useItem(wi); return; }
  const aB = p.armor ? ITEMS[p.armor].bonus : 0;
  const ai = p.inventory.findIndex(e => ITEMS[e.id].kind === 'armor' && ITEMS[e.id].bonus > aB);
  if (ai >= 0) { useItem(ai); return; }
  if (!p.ring || !p.ring2) {
    const ri = p.inventory.findIndex(e => ITEMS[e.id].kind === 'ring' && e.id !== p.ring && e.id !== p.ring2);
    if (ri >= 0) { useItem(ri); return; }
  }
  const stackables = p.inventory.findIndex(e => ITEMS[e.id].kind === 'potion' && (e.id === 'potion_vigor' || e.id === 'elixir_str'));
  if (stackables >= 0) { useItem(stackables); return; } // permanent buffs: use immediately
  const vis = G.monsters.filter(m => !m.pet && G.visible.has(m.x + ',' + m.y));
  if (!casual && G.classId === 'pilgrim' && !G.prostrated
      && (!vis.length || (p.hp < p.maxHp * 0.45 && vis.some(m => cheb(m.x, m.y, p.x, p.y) <= 1)))) {
    const t0 = G.turn;
    game.castProstrate(); // quiet floor: bank the 3-gift prayer; cornered and bleeding: the recoil IS the prayer
    if (G.turn > t0 || G.state !== 'PLAY') return;
  }
  const adjAll = vis.filter(m => cheb(m.x, m.y, p.x, p.y) <= 1);
  const adj = adjAll.sort((a, b) => a.hp - b.hp)[0];
  // walk with your dead: a gravedigger raises whenever the grave allows —
  // pre-raised shamblers carry grave-ward into the NEXT fight
  if (!casual && G.classId === 'gravedigger' && p.exhumeCd === 0
      && G.monsters.filter(o => o.pet).length < 2
      && G.corpses.some(c => G.visible.has(c.x + ',' + c.y) && cheb(c.x, c.y, p.x, p.y) <= 4)) {
    const t0 = G.turn;
    game.castExhume();
    if (G.turn > t0 || G.state !== 'PLAY') return;
  }
  if (adj) {
    if (!casual && G.classId === 'warrior' && p.cleaveCd === 0 && adjAll.length >= 2) { game.castCleave(); return; }
    if (!casual && p.maxMana && p.mana >= COST[1] && vis.filter(m => cheb(m.x, m.y, p.x, p.y) <= 2).length >= 2) { castSpell(1); return; }
    // a mage's fists are a last resort — burn the foe instead
    if (G.classId === 'mage' && p.maxMana && p.mana >= COST[0] + 1) { castSpell(0); return; }
    attackMonster(adj);
    if (G.state === 'PLAY') afterPlayerTurn();
    return;
  }
  if (vis.length) {
    // firebolt has range falloff: only cast at near-full power (d <= 4), else close the gap
    const nearest = vis.reduce((a, b) => dist2(a.x, a.y, p.x, p.y) < dist2(b.x, b.y, p.x, p.y) ? a : b);
    if (p.maxMana && p.mana >= COST[0] + 1 && dist2(nearest.x, nearest.y, p.x, p.y) <= 20) { castSpell(0); return; }
    const si = p.inventory.findIndex(e => e.id === 'scroll_fire');
    const inFireRange = vis.filter(m => dist2(m.x, m.y, p.x, p.y) <= 36);
    if (si >= 0 && inFireRange.length >= 3) { useItem(si); return; }
    if (policy === 'coward' && p.hp < p.maxHp * 0.6) {
      // retreat: step away from nearest
      const m = vis[0];
      let best = null, bd = -1;
      for (const [dx, dy] of DIRS8) {
        const nx = p.x + dx, ny = p.y + dy;
        if (!G.map.walkable(nx, ny)) continue;
        if (!diagOpen(G.map, p.x, p.y, dx, dy)) continue;
        const d = dist2(nx, ny, m.x, m.y);
        if (d > bd) { bd = d; best = [dx, dy]; }
      }
      if (best) { tryMove(...best); return; }
    }
    const m = vis.sort((a, b) => dist2(a.x, a.y, p.x, p.y) - dist2(b.x, b.y, p.x, p.y))[0];
    // tempo abilities: close the gap in one action when ready
    if (!casual) {
      const t0 = G.turn;
      if (G.classId === 'warrior' && p.chargeCd === 0 && cheb(m.x, m.y, p.x, p.y) >= 2 && cheb(m.x, m.y, p.x, p.y) <= 4) {
        castCharge();
        if (G.turn > t0 || G.state !== 'PLAY') return;
      }
      if (G.classId === 'rogue' && p.dashCd === 0 && cheb(m.x, m.y, p.x, p.y) >= 2 && cheb(m.x, m.y, p.x, p.y) <= 3) {
        castShadowDash();
        if (G.turn > t0 || G.state !== 'PLAY') return;
      }
    }
    if (stepTo(m.x, m.y)) return;
    // unreachable monster (severed nook) — ignore it and get on with the floor
  }
  let sx = -1, sy = -1;
  for (let y = 0; y < G.map.h; y++) for (let x = 0; x < G.map.w; x++) {
    const i = G.map.idx(x, y);
    if (G.map.explored[i] && G.map.tiles[i] === T.STAIRS) { sx = x; sy = y; }
  }
  // visit affordable shop wares before leaving the floor
  // shop browsing has a time budget — a bot orbiting wares it can't use
  // burned 6,971 turns on one floor (stall diagnostic, 2026-06-10)
  const affordable = (casual || G.floorTurns > 400) ? [] : G.shop.filter(s => s.price <= p.gold && p.inventory.length < 10);
  if (affordable.length) {
    const s = affordable[0];
    if (p.x === s.x && p.y === s.y) { afterPlayerTurn(); }
    else if (stepTo(s.x, s.y)) { stats.shopVisits++; return; }
  }
  if (G.depth < FINAL_DEPTH && sx >= 0) {
    if (G.player.x === sx && G.player.y === sy) { descend(); return; }
    if (stepTo(sx, sy)) return;
  }
  const ft = frontierTarget();
  if (ft && stepTo(ft.x, ft.y)) return;
  afterPlayerTurn();
}

/* ---------- runner ---------- */
const cls = process.argv[2] || 'warrior';
const runs = parseInt(process.argv[3] || '50', 10);
const policy = (process.argv.find(a => a.startsWith('--policy=')) || '--policy=smart').split('=')[1];
const diff = (process.argv.find(a => a.startsWith('--diff=')) || '--diff=standard').split('=')[1];
const asJson = process.argv.includes('--json');
game.setDifficulty(diff);

const agg = {
  cls, runs, policy, diff,
  wins: 0, deaths: 0, stuck: 0,
  deathFloors: {}, killers: {},
  avgTurns: 0, avgGoldEnd: 0, avgKills: 0,
  potionsUsed: 0, shopPurchases: 0,
  bossReached: 0, bossKilled: 0,
  levelAtFloor3: [], hpRatioAtFloor3: [],
};
for (let r = 0; r < runs; r++) {
  newGame(cls);
  const stats = { potions: 0, shopVisits: 0 };
  let guard = 0;
  let sawFloor3 = false;
  const startInv = () => G.player.inventory.length;
  let purchasesBefore = 0;
  let lastTurnSeen = -1, frozen = 0;
  while (G.state === 'PLAY' && guard++ < 5000) {
    botTurn(policy, stats);
    // a botTurn that consumes no game turn (refused move) must not loop forever
    if (G.turn === lastTurnSeen) { if (++frozen >= 3) { afterPlayerTurn(); frozen = 0; } }
    else { frozen = 0; lastTurnSeen = G.turn; }
    if (!sawFloor3 && G.depth === 3) {
      sawFloor3 = true;
      agg.levelAtFloor3.push(G.player.level);
      agg.hpRatioAtFloor3.push(+(G.player.hp / G.player.maxHp).toFixed(2));
    }
  }
  if (G.depth === FINAL_DEPTH) agg.bossReached++;
  if (G.state === 'WIN') { agg.wins++; agg.bossKilled++; }
  else if (G.state === 'DEAD' || G.state === 'DYING') {
    agg.deaths++;
    agg.deathFloors[G.depth] = (agg.deathFloors[G.depth] || 0) + 1;
    const killer = (G.deathCause.match(/Slain by (?:a |an )?(.+?) on floor/) || [])[1] || G.deathCause;
    agg.killers[killer] = (agg.killers[killer] || 0) + 1;
  } else {
    agg.stuck++;
    if (!agg.stuckInfo) agg.stuckInfo = [];
    if (agg.stuckInfo.length < 3) {
      const vis = G.monsters.filter(m => G.visible.has(m.x + ',' + m.y)).map(m => `${m.name}@${m.x},${m.y}${m.awake ? '!' : ''}`);
      // decision-state forensics: why is the bot not descending?
      let sx2 = -1, sy2 = -1;
      for (let y = 0; y < G.map.h; y++) for (let x = 0; x < G.map.w; x++) {
        const i = G.map.idx(x, y);
        if (G.map.explored[i] && G.map.tiles[i] === T.STAIRS) { sx2 = x; sy2 = y; }
      }
      let stairsDiag = 'unexplored';
      if (sx2 >= 0) {
        const f2 = computeDistField(G.map, sx2, sy2, 999);
        stairsDiag = 'fieldAtPlayer=' + f2[G.map.idx(G.player.x, G.player.y)] + ' stairs@' + sx2 + ',' + sy2;
      }
      const ft2 = frontierTarget();
      let around = '';
      for (let yy = G.player.y - 3; yy <= G.player.y + 3; yy++) {
        for (let xx = G.player.x - 3; xx <= G.player.x + 3; xx++) {
          if (!G.map.inBounds(xx, yy)) { around += '?'; continue; }
          if (xx === G.player.x && yy === G.player.y) { around += '@'; continue; }
          const mm = (typeof monsterAt === 'function') && monsterAt(xx, yy);
          around += mm ? 'M' : G.map.walkable(xx, yy) ? (G.map.tiles[G.map.idx(xx, yy)] === T.TRAP ? '^' : '.') : '#';
        }
        around += '/';
      }
      agg.stuckInfo.push({
        depth: G.depth, pos: G.player.x + ',' + G.player.y, hp: G.player.hp + '/' + G.player.maxHp,
        mana: G.player.mana, gold: G.player.gold, inv: G.player.inventory.map(e => e.id + 'x' + e.count),
        visMonsters: vis, floorTurns: G.floorTurns,
        shopLeft: G.shop.map(s => s.id + '@' + s.x + ',' + s.y + '$' + s.price),
        stairsDiag, ft: ft2, around,
      });
    }
  }
  agg.shopPurchases += G.purchases || 0;
  agg.avgTurns += G.turn / runs;
  agg.avgGoldEnd += G.player.gold / runs;
  agg.avgKills += G.kills / runs;
  agg.potionsUsed += stats.potions;
}
agg.avgTurns = Math.round(agg.avgTurns);
agg.avgGoldEnd = Math.round(agg.avgGoldEnd);
agg.avgKills = +agg.avgKills.toFixed(1);
agg.winRate = +(agg.wins / runs).toFixed(2);

if (asJson) console.log(JSON.stringify(agg, null, 2));
else {
  console.log(`${cls} ×${runs} [${policy}]: ${agg.wins}W/${agg.deaths}D/${agg.stuck}S (${Math.round(agg.winRate * 100)}%)`);
  console.log('  death floors:', JSON.stringify(agg.deathFloors), ' killers:', JSON.stringify(agg.killers));
  console.log(`  avgTurns ${agg.avgTurns} avgGold ${agg.avgGoldEnd} avgKills ${agg.avgKills} potions ${agg.potionsUsed} buys ${agg.shopPurchases}`);
  if (agg.stuckInfo) console.log('  STUCK:', JSON.stringify(agg.stuckInfo));
}
