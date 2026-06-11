/* Arcane Depths in-browser playtest bot.
 * Injected into the real game page (page.addScriptTag) — drives actual game
 * functions (tryMove/castSpell/useItem/skipCutsceneLine) with a policy that,
 * unlike the headless sim, dodges projectiles, windups and beams, and picks
 * boons by synergy. Used for Veteran winrate calibration (target 40-55% skilled).
 *
 * Usage in page: await AutoPlay.run('warrior', 8) -> results array
 */
'use strict';
window.AutoPlay = (() => {
  const TICK = 8;
  const S = { floorStart: 0, lastDepth: 0 }; // per-floor turn budget tracking

  /* boon preference by class (higher = better) */
  const BOON_SCORE = {
    warrior: { 'Deep Vigor': 8, 'Whetted Edge': 7, 'Blood Pact': 7, 'Momentum': 6, 'Iron Thorns': 5, 'Shield Rhythm': 6, "Berserker's Arc": 4, 'Second Wind': 9, 'Adrenaline': 5, 'Troll Blood': 4, 'Red Thirst': 4, 'Glass Edge': 3, 'Coin Sense': 2, "Killer's Eye": 3, 'Chill Aura': 4, 'Fleetfoot': 2, 'Midas Hunger': 1, "Reaper's Due": 2 },
    rogue:   { 'Deeper Shadows': 8, 'Ghost Step': 7, 'Deep Vigor': 7, "Killer's Eye": 7, 'Whetted Edge': 6, 'Second Wind': 9, 'Momentum': 5, 'Fleetfoot': 4, 'Blood Pact': 6, 'Adrenaline': 4, 'Red Thirst': 4, 'Glass Edge': 4, 'Iron Thorns': 2, 'Troll Blood': 3, 'Chill Aura': 3, 'Coin Sense': 2, 'Midas Hunger': 1, "Reaper's Due": 2 },
    mage:    { 'Mana Font': 8, 'Closer Flame': 7, 'Deep Vigor': 8, 'Second Wind': 9, 'Whetted Edge': 4, 'Blood Pact': 6, 'Chill Aura': 5, 'Fleetfoot': 4, 'Troll Blood': 4, 'Adrenaline': 3, 'Momentum': 3, 'Glass Edge': 2, 'Iron Thorns': 2, "Killer's Eye": 3, 'Red Thirst': 3, 'Coin Sense': 2, 'Midas Hunger': 1, "Reaper's Due": 2 },
  };

  function key(ch) {
    const ev = new KeyboardEvent('keydown', { key: ch, bubbles: true });
    window.dispatchEvent(ev); document.dispatchEvent(ev);
  }

  /* tiles that will hurt next turn */
  function dangerTiles() {
    const bad = new Set();
    for (const pr of G.projectiles) {
      if (pr.fromPlayer) continue;
      let fx = pr.fx, fy = pr.fy;
      for (let s = 0; s < pr.speed + 1; s++) {
        fx += pr.dx; fy += pr.dy;
        bad.add(Math.round(fx) + ',' + Math.round(fy));
      }
    }
    for (const m of G.monsters) {
      if (m.windup === 1) bad.add(m.windupX + ',' + m.windupY);
      if (m.beam) for (const bt of m.beam) bad.add(bt.x + ',' + bt.y);
    }
    for (const m of G.monsters) {
      if (m.lane) for (const lt of m.lane) bad.add(lt.x + ',' + lt.y);
    }
    for (const sh of (G.shells || [])) {
      bad.add(sh.x + ',' + sh.y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) bad.add((sh.x + dx) + ',' + (sh.y + dy));
    }
    return bad;
  }

  function walkable(x, y) {
    return G.map.inBounds(x, y) && tileWalkable(G.map.tiles[G.map.idx(x, y)])
      && !G.monsters.some(m => m.x === x && m.y === y);
  }

  /* distance-field step toward a target, refusing tiles marked dangerous */
  function stepToSafe(tx, ty, bad) {
    const f = computeDistField(G.map, tx, ty, 999);
    const p = G.player;
    let best = null, bd = f[G.map.idx(p.x, p.y)];
    if (bd === -1) return false;
    for (const [dx, dy] of DIRS8) {
      const nx = p.x + dx, ny = p.y + dy;
      if (!G.map.inBounds(nx, ny) || (bad && bad.has(nx + ',' + ny))) continue;
      if (!diagOpen(G.map, p.x, p.y, dx, dy)) continue;
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

  function healIdx() {
    return G.player.inventory.findIndex(it => it.id === 'potion_heal');
  }

  function pickBoon() {
    const cards = document.querySelectorAll('#boon-row button, #boon-row .boon-card');
    if (!cards.length) return false;
    const table = BOON_SCORE[G.classId] || {};
    let best = cards[0], bestS = -1;
    for (const c of cards) {
      const name = (c.querySelector('b, .boon-name, h3') || c).textContent.trim();
      let s = 0;
      for (const k of Object.keys(table)) if (name.includes(k)) { s = table[k]; break; }
      if (s > bestS) { bestS = s; best = c; }
    }
    best.click();
    return true;
  }

  function act() {
    const p = G.player;
    const bad = dangerTiles();
    const here = p.x + ',' + p.y;
    if (G.depth !== S.lastDepth) { S.lastDepth = G.depth; S.floorStart = G.turn; }
    // the dark hunts lingerers: after a floor budget, stop picking fights and descend
    const rushing = (G.turn - S.floorStart) > 140 && G.depth < FINAL_DEPTH;
    let vis = G.monsters.filter(m => G.visible.has(m.x + ',' + m.y));
    if (rushing) vis = vis.filter(m => m.awake || cheb(m.x, m.y, p.x, p.y) <= 2);

    // 1. flee a marked tile: any safe adjacent walkable spot
    if (bad.has(here)) {
      let bestD = null, bestScore = -1e9;
      for (const [dx, dy] of DIRS8) {
        const nx = p.x + dx, ny = p.y + dy;
        if (!walkable(nx, ny) || bad.has(nx + ',' + ny)) continue;
        let s = 0;
        for (const m of vis) s -= 4 / (1 + cheb(nx, ny, m.x, m.y));
        if (s > bestScore) { bestScore = s; bestD = [dx, dy]; }
      }
      if (bestD) { window.__ap='flee'; tryMove(bestD[0], bestD[1]); return; }
    }

    // 2. free upgrades: equip better gear, drink stat potions immediately
    const inv = p.inventory;
    for (let i = 0; i < inv.length; i++) {
      const def = ITEMS[inv[i].id];
      if (!def) continue;
      if (def.kind === 'weapon' && def.bonus > ((p.weapon && ITEMS[p.weapon].bonus) || 0)) { window.__ap='equip'; useItem(i); return; }
      if (def.kind === 'armor' && def.bonus > ((p.armor && ITEMS[p.armor].bonus) || 0)) { window.__ap='equip'; useItem(i); return; }
      if (def.kind === 'ring' && !p.ring) { window.__ap='equip'; useItem(i); return; }
      if (inv[i].id === 'potion_vigor' || inv[i].id === 'elixir_str') { window.__ap='stat'; useItem(i); return; }
    }
    // cure poison before it eats us
    if (p.poison >= 2 || (p.poison > 0 && p.hp < p.maxHp * 0.5)) {
      const ai = inv.findIndex(it => it.id === 'potion_anti');
      if (ai >= 0) { window.__ap='antidote'; useItem(ai); return; }
    }
    // emergency heal
    if (p.hp < p.maxHp * 0.42 && healIdx() >= 0) { window.__ap='heal'; useItem(healIdx()); return; }
    // mage panic-mend
    if (G.classId === 'mage' && p.hp < p.maxHp * 0.5 && p.mana >= 6) { castSpell(2); return; } // Mend

    // 3. fight
    if (vis.length) {
      vis.sort((a, b) => dist2(a.x, a.y, p.x, p.y) - dist2(b.x, b.y, p.x, p.y));
      let t = vis[0];
      // tempo abilities: close the gap in one action when ready
      {
        const t0 = G.turn;
        if (G.classId === 'warrior' && p.chargeCd === 0 && cheb(t.x, t.y, p.x, p.y) >= 2 && cheb(t.x, t.y, p.x, p.y) <= 4) {
          castCharge();
          if (G.turn > t0 || G.state !== 'PLAY') return;
        }
        if (G.classId === 'rogue' && p.dashCd === 0 && cheb(t.x, t.y, p.x, p.y) >= 2 && cheb(t.x, t.y, p.x, p.y) <= 3) {
          castShadowDash();
          if (G.turn > t0 || G.state !== 'PLAY') return;
        }
      }
      // boss focus: summons are a 0-xp treadmill — kill only what's adjacent
      // (lowest hp first), otherwise drive straight at the boss
      const boss = vis.find(m => m.boss);
      if (boss) {
        const adj = vis.filter(m => cheb(m.x, m.y, p.x, p.y) === 1);
        t = (adj.length && !adj.includes(boss))
          ? adj.sort((a, b) => a.hp - b.hp)[0]
          : boss;
      }
      const d = cheb(t.x, t.y, p.x, p.y);
      // warrior cleave when surrounded
      if (G.classId === 'warrior' && p.cleaveCd <= 0
          && vis.filter(m => cheb(m.x, m.y, p.x, p.y) === 1).length >= 2) { castCleave(); return; }
      // mage: bolt at range, nova when crowded
      if (G.classId === 'mage') {
        const close = vis.filter(m => cheb(m.x, m.y, p.x, p.y) <= 2).length;
        if (close >= 2 && p.mana >= 8) { castSpell(1); return; } // Frost Nova
        if (d >= 2 && d <= 5 && p.mana >= 5) { castSpell(0); return; } // Firebolt
      }
      window.__ap = 'fight:' + t.id + ':' + d;
      // heal to near-full BEFORE engaging a boss — don't slug at half HP
      if ((t.mini || t.boss) && d >= 2 && p.hp < p.maxHp * 0.85 && healIdx() >= 0) {
        window.__ap = 'preboss-heal'; useItem(healIdx()); return;
      }
      // firestorm when a real pack is in range
      if (vis.length >= 3) {
        const fi = p.inventory.findIndex(it => it.id === 'scroll_fire');
        if (fi >= 0 && vis.filter(m => dist2(m.x, m.y, p.x, p.y) <= 36).length >= 3) { useItem(fi); return; }
      }
      if (d === 1) {
        // kite slow heavies (golem/troll act every other turn): hit on their
        // skip-beat, step out of reach when they're about to swing — but only
        // when no other monster is adjacent to punish the retreat
        const othersAdj = vis.some(m => m !== t && cheb(m.x, m.y, p.x, p.y) === 1);
        if (t.slow && !othersAdj && !t.slowTick) {
          let bestK = null, bestS = -1e9;
          for (const [dx2, dy2] of DIRS8) {
            const nx = p.x + dx2, ny = p.y + dy2;
            if (!walkable(nx, ny) || bad.has(nx + ',' + ny)) continue;
            if (cheb(nx, ny, t.x, t.y) < 2) continue;
            let s = 0;
            for (const m of vis) s += cheb(nx, ny, m.x, m.y);
            if (s > bestS) { bestS = s; bestK = [dx2, dy2]; }
          }
          if (bestK) { window.__ap = 'kite:' + t.id; tryMove(bestK[0], bestK[1]); return; }
        }
        tryMove(Math.sign(t.x - p.x), Math.sign(t.y - p.y));
        return;
      }
      // approach via the distance field (walls!), refusing dangerous tiles
      if (stepToSafe(t.x, t.y, bad)) return;
      if (stepToSafe(t.x, t.y, null)) return; // hemmed in by marks — push through
      afterPlayerTurn(); // unreachable (door/water gap): wait, let it come
      return;
    }

    // 4. affordable shop wares, then stairs, then frontier
    const aff = (G.shop || []).filter(s => s.price <= p.gold && p.inventory.length < 10);
    if (aff.length && stepToSafe(aff[0].x, aff[0].y, bad)) { window.__ap='shop'; return; }
    let sx = -1, sy = -1;
    for (let y = 0; y < G.map.h; y++) for (let x = 0; x < G.map.w; x++) {
      const i = G.map.idx(x, y);
      if (G.map.explored[i] && G.map.tiles[i] === T.STAIRS) { sx = x; sy = y; }
    }
    // over budget on this floor: head straight down
    if (rushing && sx >= 0) {
      if (p.x === sx && p.y === sy) { descend(); return; }
      if (stepToSafe(sx, sy, bad)) { window.__ap='rush-stairs'; return; }
    }
    const ft = frontierTarget();
    // explore the floor first, then take the stairs
    if (ft && stepToSafe(ft.x, ft.y, bad)) { window.__ap='frontier'; return; }
    window.__ap='post-frontier ft=' + JSON.stringify(ft);
    if (G.depth < FINAL_DEPTH && sx >= 0) {
      if (p.x === sx && p.y === sy) { descend(); return; }
      if (stepToSafe(sx, sy, bad)) { window.__ap='to-stairs'; return; }
    }
    window.__ap='burn';
    afterPlayerTurn(); // nothing to do — burn the turn
  }

  async function playOne(classId, diff) {
    setDifficulty(diff);
    localStorage.removeItem('arcaneRun');
    newGame(classId);
    const start = Date.now();
    let stale = 0, lastTurn = -1;
    return new Promise(res => {
      const loop = () => {
        try {
          if (G.state === 'CUTSCENE') { skipCutsceneLine(); }
          else if (G.state === 'BOON') { if (!pickBoon()) key('1'); }
          else if (G.state === 'DEAD' || G.state === 'WIN') {
            res({ win: G.state === 'WIN', depth: G.depth, turns: G.turn,
                  kills: G.kills, cause: G.deathCause || null, ms: Date.now() - start });
            return;
          } else if (G.state === 'PLAY') {
            if (G.turn === lastTurn) stale++; else { stale = 0; lastTurn = G.turn; }
            if (stale > 400) { // wedged — capture context then bail
              const p2 = G.player;
              res({ win: false, depth: G.depth, turns: G.turn, kills: G.kills, cause: 'STALLED', ms: Date.now() - start,
                    debug: { ap: window.__ap, x: p2.x, y: p2.y, hp: p2.hp, maxHp: p2.maxHp,
                      inv: p2.inventory.map(it => it.id + 'x' + it.count).join(' '),
                      healProbe: (() => {
                        const idx = p2.inventory.findIndex(it => it.id === 'potion_heal');
                        if (!(p2.hp < p2.maxHp * 0.38 && idx >= 0)) return 'heal-branch-off idx=' + idx;
                        const t0 = G.turn, hp0 = p2.hp;
                        useItem(idx);
                        return 'fired: turn ' + t0 + '->' + G.turn + ' hp ' + hp0 + '->' + p2.hp;
                      })(),
                      tiles: DIRS8.map(([dx,dy]) => G.map.get(p2.x+dx, p2.y+dy)).join(','),
                      vis: G.monsters.filter(m => G.visible.has(m.x+','+m.y)).map(m => m.id+'@'+m.x+','+m.y+(m.frozen?'/frz':'')).join(' '),
                      projectiles: G.projectiles.length,
                      probe: (() => { // manually re-run the fight decision with tracing
                        try {
                          const vis2 = G.monsters.filter(m => G.visible.has(m.x+','+m.y));
                          if (!vis2.length) return 'no-vis';
                          vis2.sort((a,b) => dist2(a.x,a.y,p2.x,p2.y) - dist2(b.x,b.y,p2.x,p2.y));
                          const t = vis2[0], d = cheb(t.x,t.y,p2.x,p2.y);
                          const dx = Math.sign(t.x-p2.x), dy = Math.sign(t.y-p2.y);
                          const found = monsterAt(p2.x+dx, p2.y+dy);
                          const turnBefore = G.turn, hpBefore = t.hp;
                          tryMove(dx, dy);
                          return JSON.stringify({tid: t.id, d, dx, dy, found: found && found.id,
                            turnAdvanced: G.turn > turnBefore, tHp: hpBefore + '->' + t.hp, state: G.state});
                        } catch (e) { return 'THROW: ' + e.message; }
                      })() } });
              return;
            }
            act();
          }
        } catch (e) {
          res({ win: false, depth: G.depth, turns: G.turn, kills: G.kills, cause: 'ERROR: ' + e.message, ms: Date.now() - start });
          return;
        }
        setTimeout(loop, TICK);
      };
      loop();
    });
  }

  /* isolated lich-fight measurement: a reasonably-kitted late-game hero
     descends straight into the real floor-6 arena */
  async function lichTrial(runs, diff = 'standard') {
    Sfx.muted = true;
    const out = [];
    for (let i = 0; i < runs; i++) {
      setDifficulty(diff);
      localStorage.removeItem('arcaneRun');
      newGame('warrior');
      const p = G.player;
      // a plausible floor-5 graduate: gear, stats, supplies
      p.weapon = 'w_axe'; p.armor = 'a_plate';
      p.maxHp += 22; p.hp = p.maxHp;
      p.baseAtk += 2;
      p.inventory = [{ id: 'potion_heal', count: 4 }, { id: 'scroll_fire', count: 1 }];
      G.depth = 5;
      descend(); // generates the real floor 6 arena
      const r = await new Promise(res => {
        const start = Date.now();
        let stale = 0, lastTurn = -1;
        const loop = () => {
          try {
            if (G.state === 'CUTSCENE') skipCutsceneLine();
            else if (G.state === 'BOON') { if (!pickBoon()) key('1'); }
            else if (G.state === 'DEAD' || G.state === 'WIN') {
              res({ win: G.state === 'WIN', turns: G.turn, kills: G.kills,
                    cause: G.deathCause || null, ms: Date.now() - start });
              return;
            } else if (G.state === 'PLAY') {
              if (G.turn === lastTurn) stale++; else { stale = 0; lastTurn = G.turn; }
              if (stale > 400) { res({ win: false, turns: G.turn, cause: 'STALLED', ap: window.__ap }); return; }
              act();
            }
          } catch (e) { res({ win: false, cause: 'ERROR: ' + e.message }); return; }
          setTimeout(loop, TICK);
        };
        loop();
      });
      out.push(r);
    }
    const wins = out.filter(r => r.win).length;
    return { runs, wins, winrate: wins / runs, results: out };
  }

  async function run(classId, runs, diff = 'standard') {
    Sfx.muted = true;
    const out = [];
    for (let i = 0; i < runs; i++) out.push(await playOne(classId, diff));
    const wins = out.filter(r => r.win).length;
    return { classId, diff, runs, wins, winrate: wins / runs, results: out };
  }

  return { run, playOne, lichTrial };
})();
