'use strict';

const G = {
  state: 'TITLE',
  map: null,
  player: null,
  monsters: [],
  items: [],
  visible: new Set(),
  fovRadius: 8,
  depth: 1,
  turn: 0,
  kills: 0,
  totalXp: 0,
  deathCause: '',
  classId: null,
  classDef: null,
  decals: [],
  shop: [],
  projectiles: [],
  shells: [],
  daily: false,
  killsBy: {},
  diffId: 'standard',
  diff: null,
};

function setDifficulty(id) {
  if (!DIFFICULTIES[id]) id = 'standard';
  G.diffId = id;
  G.diff = DIFFICULTIES[id];
  try { localStorage.setItem('arcaneDiff', id); } catch (e) { /* ignore */ }
  for (const chip of document.querySelectorAll('.diff-chip'))
    chip.classList.toggle('selected', chip.dataset.diff === id);
}

/* ---------- the Lich watches your descent ---------- */
const LICH_LINES = {
  firstKill: '“THE FIRST DEATH ALWAYS FEELS LIKE A PROMISE. IT ISN\'T YOURS TO KEEP.”',
  firstBlood: '“YES. BLEED A LITTLE. IT SUITS YOU.”',
  eliteKill: '“THAT ONE OWED ME SERVICE. ADD ITS DEBT TO YOURS.”',
  shrineGift: '“BORROWED POWER. I KNOW THE LENDER PERSONALLY.”',
  shrineCurse: '“THE SHRINE AND I HAVE AN ARRANGEMENT. THANK YOU FOR CONTRIBUTING.”',
  goldChest: '“GOLD. HOW SMALL YOUR DREAMS ARE, LITTLE THIEF.”',
  grukDead: '“GRUK SERVED ME IN LIFE. HE WILL AGAIN. THEY ALL DO.”',
  floor4: '“FOUR FLOORS DOWN. THE SONGS NEVER MENTION THE ONES WHO TURNED BACK HERE.”',
  flawless: '“…CAREFUL ONE. CARE IS ONLY FEAR, WALKING SLOWLY.”',
  lastPotion: '“THE LAST DROP. SAVOR IT. I WOULD.”',
  lowHp: '“I CAN HEAR YOUR HEARTBEAT FROM SIX FLOORS DOWN. IT STUMBLES.”',
  echo: '“YOU\'VE BEEN HERE BEFORE. YOU\'LL BE HERE AGAIN.”',
  darkStair: '“THE DARK STAIR? BOLD. IT EATS THE SLOW ONES, YOU KNOW.”',
  enrage: '“ENOUGH. NO MORE GAMES, LITTLE THING — COME AND DIE.”',
  lichDeath: '“…AH. SO IT ENDS. AGAIN. I HAVE DIED BEFORE, LITTLE CHAMPION — DEATH NEVER KEEPS ME LONG.”',
};
/* Gruk speaks too — short, loud, and very pleased with himself */
const GRUK_LINES = {
  notice: '"FRESH MEAT COMES DOWN THE STAIR! GRUK WAS GETTING BORED!"',
  windup: '"HOLD STILL! GRUK ONLY NEEDS ONE SWING!"',
  axeThrow: '"GRUK\'S AXE FLIES FASTER THAN YOU RUN!"',
  leash: '"RUN, LITTLE MEAL! GRUK GUARDS THE STAIRS. GRUK ALWAYS GUARDS."',
};
/* one mouth at a time: spoken lines never overlap each other */
const VoiceBus = {
  current: null,
  busy() { return !!(this.current && !this.current.paused && !this.current.ended); },
  claim(a) { this.current = a; },
};

const GrukVoice = {
  cache: {}, last: {}, lastAny: -99,
  say(trigger) {
    if (!GRUK_LINES[trigger]) return;
    if ((this.last[trigger] || -99) > G.turn - 40) return; // no per-line spam
    if (this.lastAny > G.turn - 12) return;                // and let the man breathe between lines
    this.last[trigger] = G.turn;
    this.lastAny = G.turn;
    addMsg(GRUK_LINES[trigger], 'm-bad');
    if (typeof Audio === 'undefined' || Sfx.muted || Sfx.vol <= 0) return;
    try {
      let a = this.cache[trigger];
      if (!a) {
        const ap = 'audio/gruk/' + trigger + '.mp3';
        a = new Audio((typeof BUNDLED_ASSETS !== 'undefined' && BUNDLED_ASSETS[ap]) || ap);
        this.cache[trigger] = a;
      }
      if (VoiceBus.busy()) return; // text still shows; audio yields to the line in flight
      a.volume = Math.min(1, 0.9 * Sfx.vol);
      a.currentTime = 0;
      VoiceBus.claim(a);
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* ignore */ }
  },
};

/* pre-rendered neural TTS for the Lich (audio/lich/<trigger>.mp3) */
const LichVoice = {
  cache: {},
  play(trigger) {
    if (typeof Audio === 'undefined') return; // headless sim has no audio backend
    if (Sfx.muted || Sfx.vol <= 0) return;
    try {
      let a = this.cache[trigger];
      if (!a) {
        const ap = 'audio/lich/' + trigger + '.mp3';
        a = new Audio((typeof BUNDLED_ASSETS !== 'undefined' && BUNDLED_ASSETS[ap]) || ap);
        this.cache[trigger] = a;
      }
      if (VoiceBus.busy()) return; // the Lich does not talk over himself
      a.volume = Math.min(1, 0.9 * Sfx.vol);
      a.currentTime = 0;
      VoiceBus.claim(a);
      const p = a.play();
      if (p && p.catch) p.catch(() => { /* autoplay blocked pre-gesture */ });
    } catch (e) { /* ignore */ }
  },
};
function lichSay(trigger) {
  if (G.state !== 'PLAY' || !LICH_LINES[trigger]) return;
  if (G.lichSaid[trigger] || G.turn - (G.lichLastTurn || -99) < 30) return;
  G.lichSaid[trigger] = true;
  G.lichLastTurn = G.turn;
  addMsg(LICH_LINES[trigger], 'm-lich');
  Sfx.whisper();
  LichVoice.play(trigger);
}

/* ---------- projectiles: bolts are real objects that cross real space ---------- */
function spawnProjectile(fx, fy, tx, ty, opts) {
  const dx = tx - fx, dy = ty - fy;
  const len = Math.max(Math.abs(dx), Math.abs(dy)) || 1;
  G.projectiles.push({
    fx, fy, dx: dx / len, dy: dy / len,
    speed: opts.speed || 2, dmg: opts.dmg, color: opts.color,
    fromPlayer: !!opts.fromPlayer, drain: !!opts.drain, src: opts.src || null,
  });
}
/* impact resolution: damage is instant, but the VISUAL orb finishes its
   flight to the impact tile before bursting (FX.boltGhosts in render.js) —
   no more bolts vanishing mid-air with the explosion appearing ahead */
function boltImpact(pr, tx, ty, n, speed) {
  if (typeof FX !== 'undefined' && FX.boltGhosts && navigator.userAgent !== 'NodeSim') {
    FX.boltGhosts.push({
      x: pr.rx !== undefined ? pr.rx : pr.fx - pr.dx,
      y: pr.ry !== undefined ? pr.ry : pr.fy - pr.dy,
      tx, ty, color: pr.color, n, speed,
    });
  } else {
    spawnBurst(tx, ty, pr.color, n, speed);
  }
}

function stepProjectiles() {
  const p = G.player;
  for (let i = G.projectiles.length - 1; i >= 0; i--) {
    const pr = G.projectiles[i];
    let dead = false;
    const SUB = 2; // half-tile sampling: diagonal bolts can no longer skip tiles
    for (let s = 0; s < pr.speed * SUB && !dead; s++) {
      pr.fx += pr.dx / SUB; pr.fy += pr.dy / SUB;
      const tx = Math.round(pr.fx), ty = Math.round(pr.fy);
      if (!G.map.inBounds(tx, ty) || G.map.opaque(tx, ty)) {
        boltImpact(pr, tx, ty, 5, 40);
        if (pr.fromPlayer) addMsg('Your firebolt shatters against the stone — nothing but sparks.', 'm-dim');
        dead = true; break;
      }
      const m = monsterAt(tx, ty);
      if (m && (pr.fromPlayer || m !== pr.src)) {
        const dmg = pr.dmg;
        m.hp -= dmg; m.flashT = 1; m.awake = true;
        boltImpact(pr, tx, ty, 8, 60);
        spawnFloater(tx, ty, String(dmg), pr.color);
        addMsg(pr.fromPlayer
          ? (pr.crit ? `CRITICAL — your firebolt detonates against ${theM(m)} for ${dmg}!`
                     : `Your firebolt sears ${theM(m)} for ${dmg}!`)
          : `The bolt slams into ${theM(m)}!`, pr.crit && pr.fromPlayer ? 'm-gold' : 'm-magic');
        if (m.hp <= 0) {
          killMonster(m);
          if (pr.fromPlayer && !pr.forked && hasBoon('b_fork') && G.state === 'PLAY') {
            let nf = null, nd = 1e9;
            for (const o of G.monsters) {
              if (!G.visible.has(o.x + ',' + o.y)) continue;
              const d2f = dist2(o.x, o.y, tx, ty);
              if (d2f < nd) { nd = d2f; nf = o; }
            }
            if (nf) {
              spawnProjectile(tx, ty, nf.x, nf.y, {
                dmg: Math.max(2, Math.ceil(pr.dmg / 2)), color: '#ffb36b', fromPlayer: true, forked: true, speed: 3,
              });
              addMsg('The flame forks — it leaps hungrily onward!', 'm-magic');
            }
          }
        }
        dead = true; break;
      }
      if (!pr.fromPlayer && tx === p.x && ty === p.y) {
        if (RNG.chance(playerDodge() / 2)) {
          addMsg('You twist aside — the bolt hisses past your ear!', 'm-good');
        } else {
          const dmg = Math.max(1, pr.dmg + RNG.int(-1, 1) - playerDef());
          boltImpact(pr, tx, ty, 8, 60);
          addMsg(`The bolt strikes you — ${dmg} damage!`, 'm-bad');
          hurtPlayer(dmg, pr.src ? `${pr.src.name}'s bolt` : 'a searing bolt');
          if (pr.drain && pr.src && G.monsters.includes(pr.src)) {
            pr.src.hp = Math.min(pr.src.maxHp, pr.src.hp + dmg);
            spawnFloater(pr.src.x, pr.src.y, '+' + dmg, '#d35d8e');
          }
        }
        dead = true; break;
      }
    }
    if (dead) G.projectiles.splice(i, 1);
    if (G.state !== 'PLAY') return;
  }
}

/* ---------- boons: pick one of three between floors ---------- */
function offerBoons() {
  if (!G.player) return;
  const pool = boonPool();
  if (!pool.length) return;
  const n = (!G.daily && sanctumOwned('s_fourth')) ? 4 : 3;
  const picks = [];
  const seen = new Set();
  let guard = 0;
  // the first draft of a run always shows at least one boon built for your
  // class — a rogue who never sees a stealth boon never learns the fantasy
  if (G.depth === 1) {
    const classPicks = pool.filter(([id]) => BOONS[id].cls === G.classId);
    if (classPicks.length) {
      const id = RNG.weighted(classPicks);
      seen.add(id); picks.push(id);
    }
  }
  while (picks.length < n && guard++ < 40) {
    const id = RNG.weighted(pool);
    if (!seen.has(id)) { seen.add(id); picks.push(id); }
  }
  if (IS_SIM) { applyBoon(RNG.pick(picks)); return; } // headless: take one at random
  G.state = 'BOON';
  cancelTravel();
  const row = $('boon-row');
  row.innerHTML = '';
  picks.forEach((id, i) => {
    const b = BOONS[id];
    const card = document.createElement('button');
    card.className = 'boon-card';
    card.innerHTML = `<div class="b-key">[${i + 1}]</div>` +
      `<div class="b-rarity ${b.rarity}">${b.rarity.toUpperCase()}</div>` +
      `<div class="b-name">${b.name}</div>` +
      `<div class="b-desc">${b.desc}</div>`;
    card.addEventListener('click', ev => { ev.currentTarget.blur(); pickBoon(id); });
    row.appendChild(card);
  });
  G.boonPicks = picks;
  $('boon-screen').classList.remove('hidden');
  Sfx.scroll();
}
function pickBoon(id) {
  if (G.state !== 'BOON') return;
  $('boon-screen').classList.add('hidden');
  G.state = 'PLAY';
  applyBoon(id);
  recomputeFOV();
  updateUI();
  saveRun();
}
function applyBoon(id) {
  const p = G.player;
  const b = BOONS[id];
  p.boons[id] = (p.boons[id] || 0) + 1;
  // every advertised gain AND cost is applied here — a bargain that costs
  // nothing is a lie, and the Lich does not lie about prices
  const drainHp = n => { p.maxHp = Math.max(10, p.maxHp - n); p.hp = Math.min(p.hp, p.maxHp); };
  if (id === 'b_vigor') { p.maxHp += 8; p.hp = p.maxHp; }
  else if (id === 'b_edge') p.baseAtk += 1;
  else if (id === 'b_glass') { p.baseAtk += 3; p.baseDef -= 1; }
  else if (id === 'b_chill') drainHp(6);
  else if (id === 'b_pact') { p.maxHp += 14; p.hp = Math.min(p.maxHp, p.hp + 14); }
  else if (id === 'b_vamp') drainHp(5);
  else if (id === 'b_keen') drainHp(4);
  else if (id === 'b_font') { p.maxMana += 8; p.mana = Math.min(p.maxMana, p.mana + 8); drainHp(4); }
  addMsg(`BOON — ${b.name}: ${b.desc}.`, 'm-gold');
  spawnFloater(p.x, p.y, b.name.toUpperCase(), '#ffd75e', 15);
}

/* ---------- soul embers + the Sanctum ---------- */
function getEmbers() { try { return +(localStorage.getItem('arcaneEmbers') || 0); } catch (e) { return 0; } }
function setEmbers(n) { try { localStorage.setItem('arcaneEmbers', String(Math.max(0, Math.floor(n)))); } catch (e) { /* ignore */ } }
function grantEmbers(won) {
  // embers track SCORE, not depth-rushing — deep skilled play out-earns
  // suicide sprints (agent design audit, finding 6)
  G.lastEmbers = Math.max(1, Math.floor(score() / 35) + (won ? 20 : 0));
  setEmbers(getEmbers() + G.lastEmbers);
  addMsg(`◈ ${G.lastEmbers} soul embers drift free.`, 'm-magic');
}
function sanctumOwned(id) {
  try { return !!(JSON.parse(localStorage.getItem('arcaneSanctum') || '{}'))[id]; } catch (e) { return false; }
}
let sanctumOpen = false;
function toggleSanctum(force) {
  sanctumOpen = force != null ? force : !sanctumOpen;
  const el = $('sanctum-screen');
  el.classList.toggle('hidden', !sanctumOpen);
  if (!sanctumOpen) return;
  $('ember-count').textContent = getEmbers();
  const list = $('sanctum-list');
  list.innerHTML = '';
  for (const [id, s] of Object.entries(SANCTUM)) {
    const owned = sanctumOwned(id);
    // the tree: deeper kindlings stay dark until their root is lit
    const locked = !owned && s.requires && !sanctumOwned(s.requires);
    const item = document.createElement('button');
    item.className = 'sanctum-item' + (owned ? ' owned' : '') + (locked ? ' locked' : '');
    item.innerHTML = `<div><div class="s-name">${locked ? '🔒 ' : ''}${s.name}</div><div class="s-desc">${s.desc}</div></div>` +
      `<div class="s-cost">${owned ? 'KINDLED' : locked ? 'needs ' + SANCTUM[s.requires].name : s.cost + ' ◈'}</div>`;
    if (locked) { item.disabled = true; list.appendChild(item); continue; }
    if (!owned) item.addEventListener('click', ev => {
      ev.currentTarget.blur();
      if (getEmbers() < s.cost) { Sfx.hit(); return; }
      setEmbers(getEmbers() - s.cost);
      try {
        const o = JSON.parse(localStorage.getItem('arcaneSanctum') || '{}');
        o[id] = true;
        localStorage.setItem('arcaneSanctum', JSON.stringify(o));
      } catch (e) { /* ignore */ }
      Sfx.levelup();
      toggleSanctum(true); // rebuild
    });
    list.appendChild(item);
  }
}

/* daily challenge: same dungeon for everyone today (per class) */
function dailySeed(classId) {
  const d = new Date();
  const str = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}-${classId}`;
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const dailyKey = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
let dailyPending = false;

const $ = id => document.getElementById(id);

/* ---------- messages ---------- */
function addMsg(text, cls = '') {
  const log = $('log');
  const div = document.createElement('div');
  if (cls) div.className = cls;
  div.textContent = text;
  log.appendChild(div);
  while (log.children.length > 80) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}

/* ---------- player ---------- */
function newPlayer(cls) {
  const hp = Math.round(cls.hp * G.diff.playerHp);
  return {
    x: 0, y: 0,
    hp, maxHp: hp,
    baseAtk: cls.atk, baseDef: cls.def,
    crit: cls.crit, dodge: cls.dodge || 0,
    mana: cls.mana, maxMana: cls.mana,
    gold: 0, poison: 0,
    keys: 0, cleaveCd: 0, chargeCd: 0, dashCd: 0,
    boons: {}, momentum: 0, secondWind: false, bulwarkT: 0, braced: false,
    guardT: 0, guardCd: 0, vaultCd: 0, vaultStrike: 0,
    inventory: [], weapon: null, armor: null, ring: null,
    flashT: 0,
  };
}
const ringIs = id => G.player.ring === id;
// tempest maul: ability cooldowns shed 2 turns while it's in hand
const tempoEdge = () => (G.player && G.player.weapon && ITEMS[G.player.weapon].trait === 'tempo') ? 2 : 0;
const dreadShift = () => (hasBoon('b_fleet') ? 40 : 0) + (hasBoon('b_reaper') ? 20 : 0);
const hasBoon = id => !!(G.player && G.player.boons && G.player.boons[id]);
const playerAtk = () => G.player.baseAtk + (G.player.weapon ? ITEMS[G.player.weapon].bonus : 0) + (ringIs('ring_might') ? 2 : 0)
  + (hasBoon('b_momentum') ? G.player.momentum : 0)
  + (hasBoon('b_adrenal') && G.player.hp < G.player.maxHp * 0.3 ? 3 : 0);
const playerDef = () => G.player.baseDef + (G.player.armor ? ITEMS[G.player.armor].bonus : 0) + (ringIs('ring_guard') ? 2 : 0)
  + (G.player.bulwarkT > 0 ? 3 : 0);
const playerDodge = () => clamp(G.player.dodge + (hasBoon('b_fleet') ? 0.15 : 0)
  + (hasBoon('b_ghost') ? 0.08 : 0) - (hasBoon('b_shadow') ? 0.08 : 0)
  + (ringIs('ring_swift') ? 0.08 : 0)
  - (G.map && G.map.get(G.player.x, G.player.y) === T.WATER ? 0.15 : 0), 0, 0.75);
// score counts gold EARNED (spending costs nothing) plus a win bonus that decays with dawdling
const score = () => Math.round(G.diff.scoreMult * (
  G.goldEarned + G.kills * 8 + (G.depth - 1) * 60 + G.bonusScore +
  (G.state === 'WIN' ? 250 + Math.max(0, 1000 - G.turn) : 0)
));
function earnGold(n) {
  n = Math.ceil(n * (1 + (hasBoon('b_purse') ? 0.3 : 0) + (hasBoon('b_greed') ? 0.6 : 0)));
  G.player.gold += n; G.goldEarned += n;
}
// Midas Hunger's other edge: merchants smell the greed and charge for it
const warePrice = w => Math.ceil(w.price * (hasBoon('b_greed') ? 1.25 : 1));

/* ---------- game setup ---------- */
function newGame(classId) {
  cancelTravel();
  G.daily = dailyPending;
  G.darkUsed = false; // fresh run, fresh shortcut
  dailyPending = false;
  const _dl = $('daily-line');
  if (_dl) _dl.textContent = `[D] daily challenge \u2014 ${dailyKey()}: one seeded dungeon, same for everyone today`;
  if (G.daily) {
    // dailies are a level playing field: force Veteran without touching the saved preference
    G.diffId = 'standard';
    G.diff = DIFFICULTIES.standard;
    RNG.seed(dailySeed(classId));
    G.dailyBase = dailySeed(classId); // frozen at run start — surviving past midnight keeps today's dungeon
  } else {
    G.dailyBase = null;
  }
  G.classId = classId;
  G.classDef = CLASSES[classId];
  G.fovRadius = G.classDef.fov;
  $('log').innerHTML = '';
  G.state = 'PLAY';
  G.player = newPlayer(G.classDef);
  G.turn = 0; G.kills = 0; G.totalXp = 0; G.killsBy = {};
  G.goldEarned = 0; G.bonusScore = 0; G.potionsDrunk = 0; G.purchases = 0;
  G.lichSaid = {}; G.lichLastTurn = -99;
  clearSave();
  if (window.GuruTelemetry) GuruTelemetry.runStart({ class_id: classId, difficulty: G.diffId, daily: G.daily });
  for (const id of G.classDef.start) {
    const def = ITEMS[id];
    if (def.kind === 'weapon') G.player.weapon = id;
    else if (def.kind === 'armor') G.player.armor = id;
    else addItem(id);
  }
  // sanctum gifts kindle every new run — except dailies, which stay a level field
  if (!G.daily) {
    if (sanctumOwned('s_flask')) addItem('potion_heal');
    if (sanctumOwned('s_flask2')) addItem('potion_vigor');
    if (sanctumOwned('s_map')) addItem('scroll_map');
    if (sanctumOwned('s_purse')) G.player.gold += sanctumOwned('s_purse2') ? 60 : 25;
    if (sanctumOwned('s_stone')) G.player.baseAtk += 1;
    if (sanctumOwned('s_stone2')) G.player.baseDef += 1;
    if (sanctumOwned('s_ring')) addItem(RNG.pick(['ring_regen', 'ring_might', 'ring_guard', 'ring_focus']));
  }
  startLevel(1);
  $('title-screen').classList.add('hidden');
  $('death-screen').classList.add('hidden');
  $('win-screen').classList.add('hidden');
  buildSpellPanel();
  if (!newGame.introShown) { newGame.introShown = true; showCutscene('intro', () => offerBoons()); }
  else offerBoons();
  addMsg(`The ${G.classDef.name.toLowerCase()} sets foot on the Dark Stair. The air is cold and old.`, 'm-magic');
  if (G.daily) addMsg(`DAILY CHALLENGE — ${dailyKey()}. One dungeon, same for all who dare today.`, 'm-gold');
  addMsg('Vyrakhel the Lich waits on floor 6. Find him. End him.', 'm-dim');
  if (typeof MOBILE_UI !== 'undefined' && MOBILE_UI) {
    addMsg('Drag anywhere to walk — tap a foe to strike. ◎ explores for you, ☰ opens your pack.', 'm-dim');
  } else {
    addMsg('Move with WASD/arrows — bump enemies to attack. O explores for you. ? for help.', 'm-dim');
  }
}

function startLevel(depth) {
  cancelTravel();
  G.depth = depth;
  if (window.GuruTelemetry) GuruTelemetry.floor({ depth: depth, turn: G.turn });
  G.floorTurns = 0;
  G.floorDmg = 0;
  G.clockSpawns = 0;
  G.shrineArmed = {};
  // daily floors must not depend on how the player fought — reseed deterministically per floor
  if (G.daily) RNG.seed((G.dailyBase != null ? G.dailyBase : dailySeed(G.classId)) ^ (depth * 0x9E3779B9));
  if (G.player && G.player.keys > 0) {
    G.player.keys = 0;
    addMsg('The old key crumbles to rust as you descend.', 'm-dim');
  }
  let map;
  do { map = generateMap(depth); } while (map.rooms.length < 4);
  G.map = map;
  const theme = map.theme;
  G.stairsPos = map.stairsPos;
  // Keeper's Lore (sanctum tier 2): the way down is known from the first step
  if (sanctumOwned('s_lore') && map.stairsPos) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const sx = map.stairsPos.x + dx, sy = map.stairsPos.y + dy;
      if (map.inBounds(sx, sy)) map.explored[map.idx(sx, sy)] = 1;
    }
  }
  if (theme.msg) addMsg(theme.msg, 'm-magic');
  if (G.map.vault) addMsg(`Old hands built something here: ${G.map.vault}.`, 'm-dim');
  // the dark stair's toll and reward
  const dark = G.darkNext === true;
  G.darkNext = false;
  if (dark) addMsg('You took the dark stair. The dark took notice.', 'm-bad');
  G.monsters = [];
  G.items = [];
  G.decals = [];
  G.shop = [];
  G.player.x = map.startRoom.cx;
  G.player.y = map.startRoom.cy;
  G.player.rx = G.player.x; G.player.ry = G.player.y;

  // monsters (bosses spawn first so the rabble can't stack on their tile)
  if (depth === 3) {
    // Gruk guards the stairs but does not stand on them — a desperate dash past him is possible
    let gx = map.endRoom.cx + 1, gy = map.endRoom.cy;
    if (!map.walkable(gx, gy)) { gx = map.endRoom.cx; gy = map.endRoom.cy + 1; }
    if (!map.walkable(gx, gy)) { gx = map.endRoom.cx - 1; gy = map.endRoom.cy; }
    const gruk = spawnMonster('warlord', gx, gy);
    // half of all runs meet the Skull-Splitter: lighter, and he THROWS axes —
    // kiting him feeds him, sidestepping his throws starves him
    if (RNG.chance(0.5)) {
      gruk.variant = 'skullsplitter';
      gruk.name = 'Gruk the Skull-Splitter';
      gruk.ranged = true;
      gruk.maxHp = gruk.hp = 46;
      gruk.atk = 10;
    }
  }
  if (depth === FINAL_DEPTH) {
    // The Throne Approach: silent halls, then the honor guard around the arena
    spawnMonster('lich', map.endRoom.cx, map.endRoom.cy);
    const guardPool = [['golem', 3], ['wraith', 2], ['skeleton', 3]];
    for (let i = 0; i < 6; i++) {
      const spot = randomFloor(map, s =>
        cheb(s.x, s.y, map.endRoom.cx, map.endRoom.cy) <= 9 &&
        cheb(s.x, s.y, G.player.x, G.player.y) > 7 && !monsterAt(s.x, s.y));
      if (spot) spawnMonster(RNG.weighted(guardPool), spot.x, spot.y);
    }
    // pre-raised bones at the arena corners, worth nothing
    for (const [dx, dy] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
      const nx = map.endRoom.cx + dx, ny = map.endRoom.cy + dy;
      if (map.walkable(nx, ny) && !monsterAt(nx, ny)) spawnMonster('skeleton', nx, ny).xp = 0;
    }
  } else {
    const count = 4 + depth * 2 + (theme.countMod || 0);
    const pool = theme.monoPool ? [[theme.monoPool, 1]] : monsterPoolForDepth(depth);
    for (let i = 0; i < count; i++) {
      const spot = randomFloor(map, s =>
        cheb(s.x, s.y, G.player.x, G.player.y) > 7 && !monsterAt(s.x, s.y));
      if (!spot) continue;
      const id = RNG.weighted(pool);
      const mm = spawnMonster(id, spot.x, spot.y);
      if (depth >= 2 && RNG.chance(G.diff.eliteCh + (dark ? 0.15 : 0))) makeElite(mm, false);
      // packs: some melee monsters hunt in pairs (ranged pairs create unfair crossfire)
      if (RNG.chance(theme.packChance != null ? theme.packChance : 0.3) && !MONSTERS[id].ranged) {
        for (const [dx, dy] of DIRS8) {
          const nx = spot.x + dx, ny = spot.y + dy;
          if (map.walkable(nx, ny) && !monsterAt(nx, ny) && cheb(nx, ny, G.player.x, G.player.y) > 7) {
            spawnMonster(id, nx, ny);
            break;
          }
        }
      }
    }
  }
  // one guaranteed elite per floor (2+) — it carries the key to the golden chest
  if (depth >= 2) {
    const candidates = G.monsters.filter(m => !m.boss && !m.mini && !m.elite);
    if (candidates.length) makeElite(RNG.pick(candidates), !!map.hasGoldChest);
  }

  // ground items + gold
  const itemPool = itemPoolForDepth(depth);
  const nItems = 3 + RNG.int(0, 2) + (theme.lootMod || 0) + (dark ? 2 : 0);
  for (let i = 0; i < nItems; i++) {
    const spot = randomFloor(map, s => cheb(s.x, s.y, G.player.x, G.player.y) > 3);
    if (spot) G.items.push({ x: spot.x, y: spot.y, id: RNG.weighted(itemPool) });
  }
  const nGold = RNG.int(2, 3);
  for (let i = 0; i < nGold; i++) {
    const spot = randomFloor(map, s => cheb(s.x, s.y, G.player.x, G.player.y) > 3);
    if (spot) G.items.push({ x: spot.x, y: spot.y, gold: Math.round((RNG.int(4, 12) + depth * 4) * (theme.goldMult || 1) * (dark ? 1.6 : 1)) });
  }

  // hand-built set pieces bring their own garrison
  for (const vs of (map.vaultSpawns || [])) {
    if (map.walkable(vs.x, vs.y) && !monsterAt(vs.x, vs.y)) spawnMonster(vs.id, vs.x, vs.y);
  }

  // an echo of a fallen hero may haunt the floor where they died
  G.corpses = [];
  G.projectiles = [];
  G.shells = [];
  G.gildedWarned = {};
  G.wareWarn = {};
  G.shopSeen = false;
  G.darkSeen = false;
  G.fetchSkip = {};
  if (typeof CAM !== 'undefined') CAM.snap = true; // new floor: no cross-map pan
  // one dark plunge per run: scrub later floors' dark stairs once it's spent
  if (G.darkUsed) {
    for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === T.DARKSTAIRS) map.tiles[i] = T.FLOOR;
  }
  G.echo = null;
  if (G.player) { G.player.secondWind = false; G.player.bulwarkT = 0; }
  if (typeof Ambient !== 'undefined' && !IS_SIM) Ambient.set(theme.name);
  if (!G.daily) {
    try {
      const echoes = JSON.parse(localStorage.getItem('arcaneEchoes') || '[]');
      const here = echoes.findIndex(e => e.depth === depth);
      if (here >= 0 && RNG.chance(0.6)) {
        const spot = randomFloor(map, s => cheb(s.x, s.y, G.player.x, G.player.y) > 6);
        if (spot) {
          const e = echoes[here];
          G.echo = { x: spot.x, y: spot.y, idx: here, gold: e.gold, cls: e.cls, cause: e.cause };
        }
      }
    } catch (err) { /* ignore */ }
  }

  // arcane commissary on floors 2, 4 and a premium one on 5 (the last gold sink before the Lich)
  if (depth === 2 || depth === 4 || depth === 5) {
    const candidates = map.rooms.filter(r => r !== map.startRoom && r !== map.endRoom);
    if (candidates.length) {
      const room = RNG.pick(candidates);
      const stock = shopStockForDepth(depth);
      for (const id of stock) {
        const spot = randomFloor(map, s =>
          s.x >= room.x && s.x < room.x + room.w && s.y >= room.y && s.y < room.y + room.h &&
          !G.shop.some(o => o.x === s.x && o.y === s.y) && !monsterAt(s.x, s.y) &&
          !G.items.some(it => it.x === s.x && it.y === s.y));
        if (spot) G.shop.push({ x: spot.x, y: spot.y, id, price: ITEMS[id].price(depth) });
      }
      if (G.shop.length) addMsg(`You sense a merchant's wards on this floor… somewhere to the ${compass(G.shop[0].x, G.shop[0].y)}.`, 'm-magic');
    }
  }

  recomputeFOV();
  updateUI();
}

function spawnMonster(id, x, y) {
  const d = MONSTERS[id];
  const deep = 1; // power now comes from choices; the dark stays constant
  const hp = Math.max(1, Math.round(d.hp * G.diff.monHp * deep));
  const atk = Math.max(1, Math.round(d.atk * G.diff.monAtk * deep));
  G.monsters.push({
    id, name: d.name, glyph: d.glyph, color: d.color,
    hp, maxHp: hp, atk, def: d.def, xp: d.xp, sight: d.sight,
    ranged: !!d.ranged, erratic: !!d.erratic, regen: !!d.regen, heavy: !!d.heavy, lobber: !!d.lobber, charger: !!d.charger,
    boss: !!d.boss, mini: !!d.mini, splits: !!d.splits, venom: !!d.venom, healer: !!d.healer,
    drain: !!d.drain, slow: !!d.slow, slowTick: false,
    x, y, rx: x, ry: y, awake: false, cd: 0, flashT: 0, summonC: 0, frozen: 0, enraged: false,
    windup: 0, windupX: 0, windupY: 0, skipT: 0, beam: null,
    elite: null, hasKey: false,
  });
  return G.monsters[G.monsters.length - 1];
}

function makeElite(m, givesKey) {
  const kind = RNG.pick(Object.keys(ELITE_MODS));
  m.elite = kind;
  m.name = ELITE_MODS[kind].name + ' ' + m.name;
  m.xp *= 2;
  m.hasKey = givesKey;
  if (kind === 'frenzied') m.atk = Math.ceil(m.atk * 1.5);
  else if (kind === 'armored') { m.def += 3; m.hp = m.maxHp = Math.ceil(m.maxHp * 1.6); }
  else if (kind === 'venomous') m.venom = true;
}

const monsterAt = (x, y) => G.monsters.find(m => m.x === x && m.y === y);

function recomputeFOV() {
  G.fovRadius = clamp(G.classDef.fov + (G.map.theme.fovMod || 0) + (ringIs('ring_focus') ? 1 : 0), 5, 12);
  G.visible = computeFOV(G.map, G.player.x, G.player.y, G.fovRadius);
  for (const key of G.visible) {
    const [x, y] = key.split(',');
    const i = G.map.idx(+x, +y);
    G.map.explored[i] = 1;
    G.map.fovSeen[i] = 1;
    if (G.classDef && G.classDef.senses && G.map.tiles[i] === T.TRAP && !G.map.trapSeen[i]) {
      G.map.trapSeen[i] = 1;
      addMsg('Your instincts prickle — a trap lies near.', 'm-good');
    }
  }
}

/* ---------- player actions ---------- */
function tryMove(dx, dy) {
  if (G.state !== 'PLAY') return;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return;
  const p = G.player;
  const nx = p.x + dx, ny = p.y + dy;
  if (!diagOpen(G.map, p.x, p.y, dx, dy)) { addMsg('The corner is too tight to squeeze through.', 'm-dim'); return; }
  const m = monsterAt(nx, ny);
  if (m) {
    if (!G.visible.has(nx + ',' + ny)) addMsg('You strike at something in the dark!', 'm-combat');
    attackMonster(m);
    afterPlayerTurn();
    return;
  }
  const tile = G.map.get(nx, ny);
  if (tile === T.CHEST) { openChest(nx, ny); afterPlayerTurn(); return; }
  if (tile === T.GOLDCHEST) { if (openGoldChest(nx, ny)) afterPlayerTurn(); return; }
  if (tile === T.SHRINE) { if (useShrine(nx, ny)) afterPlayerTurn(); return; }
  if (tile === T.GILDED) { if (lootGilded(nx, ny)) afterPlayerTurn(); return; }
  if (!tileWalkable(tile)) {
    // debounced — key-mashing into a wall was flooding the log (widget feedback)
    const now = Date.now();
    if (!G._bumpAt || now - G._bumpAt > 1500) { addMsg('A wall blocks you.', 'm-dim'); G._bumpAt = now; }
    return; // bumping a wall costs no turn
  }
  p.x = nx; p.y = ny;
  if (!onEnterTile(nx, ny)) return;
  afterPlayerTurn();
}

/* everything that happens when the player lands on a tile (walking, blinking, teleporting).
   Returns false if the player died. */
function onEnterTile(nx, ny) {
  const p = G.player;
  const tile = G.map.get(nx, ny);

  if (tile === T.WATER && CRNG.chance(0.5))
    spawnBurst(nx, ny, '#6fa8d8', 4, 30);

  if (tile === T.TRAP) {
    const i = G.map.idx(nx, ny);
    if (!G.map.trapSeen[i]) {
      G.map.trapSeen[i] = 1;
      const dmg = RNG.int(3, 5 + G.depth);
      addMsg(`A hidden spike trap springs! It bites for ${dmg}.`, 'm-bad');
      Sfx.trap();
      hurtPlayer(dmg, 'a spike trap');
      if (G.state !== 'PLAY') return false;
    } else if (RNG.chance(0.35)) {
      const dmg = RNG.int(3, 5 + G.depth);
      addMsg(`You misstep — the spike trap bites for ${dmg}!`, 'm-bad');
      Sfx.trap();
      hurtPlayer(dmg, 'a spike trap');
      if (G.state !== 'PLAY') return false;
    } else {
      addMsg('You step carefully over the spike trap.', 'm-dim');
    }
  }

  // shop purchase — first contact warns; a deliberate second visit buys
  const ware = G.shop.find(s => s.x === nx && s.y === ny);
  if (ware) {
    if (!G.wareWarn) G.wareWarn = {};
    const wk = ware.x + ',' + ware.y;
    if (!G.wareWarn[wk]) {
      G.wareWarn[wk] = 1;
      addMsg(`${ITEMS[ware.id].name} — ${warePrice(ware)} gold. Step here again to buy.`, 'm-dim');
    } else if (p.gold < warePrice(ware)) {
      addMsg(`The ward refuses you — the ${ITEMS[ware.id].name} costs ${warePrice(ware)} gold.`, 'm-dim');
    } else if (!addItem(ware.id)) {
      addMsg('Your pack is too full to carry it.', 'm-dim');
    } else {
      p.gold -= warePrice(ware);
      G.purchases++;
      G.shop.splice(G.shop.indexOf(ware), 1);
      addMsg(`Purchased: ${ITEMS[ware.id].name} for ${warePrice(ware)} gold.`, 'm-gold');
      Sfx.buy();
      spawnBurst(nx, ny, '#c7a4ff', 10, 60);
    }
  }

  // the echo of a fallen self
  if (G.echo && G.echo.x === nx && G.echo.y === ny) {
    addMsg(`Here lies the ${G.echo.cls}, slain by ${G.echo.cause}. The echo bows, and fades.`, 'm-magic');
    if (G.echo.gold > 0) {
      earnGold(G.echo.gold);
      addMsg(`You recover ${G.echo.gold} gold from your former life.`, 'm-gold');
      spawnFloater(nx, ny, `+${G.echo.gold}$`, '#9fe8ff');
    }
    spawnBurst(nx, ny, '#9fe8ff', 16, 70);
    Sfx.scroll();
    lichSay('echo');
    try {
      const echoes = JSON.parse(localStorage.getItem('arcaneEchoes') || '[]');
      echoes.splice(G.echo.idx, 1);
      localStorage.setItem('arcaneEchoes', JSON.stringify(echoes));
    } catch (e) { /* ignore */ }
    G.echo = null;
  }

  // pickups
  for (let i = G.items.length - 1; i >= 0; i--) {
    const it = G.items[i];
    if (it.x !== nx || it.y !== ny) continue;
    if (it.gold) {
      earnGold(it.gold);
      addMsg(`You scoop up ${it.gold} gold.`, 'm-gold');
      Sfx.gold();
      spawnFloater(nx, ny, `+${it.gold}$`, '#ffd75e');
      G.items.splice(i, 1);
    } else if (addItem(it.id)) {
      addMsg(`You pick up the ${ITEMS[it.id].name}.`, 'm-good');
      const nd = ITEMS[it.id];
      if (nd.kind === 'weapon' || nd.kind === 'armor' || nd.kind === 'ring') {
        const cur = p[nd.kind] ? ITEMS[p[nd.kind]].bonus : -1;
        if (nd.bonus > cur) {
          const si = p.inventory.findIndex(e => e.id === it.id);
          if (si >= 0) addMsg(`(better than your ${p[nd.kind] ? ITEMS[p[nd.kind]].name : 'bare ' + (nd.kind === 'weapon' ? 'fists' : nd.kind)} — press ${si === 9 ? 0 : si + 1} to ${nd.kind === 'weapon' ? 'wield' : 'wear'} it)`, 'm-gold');
        }
      }
      Sfx.pickup();
      G.items.splice(i, 1);
    } else {
      addMsg(`Your pack is full — the ${ITEMS[it.id].name} stays on the ground. (Shift+number or right-click drops something.)`, 'm-dim');
    }
  }

  if (tile === T.STAIRS) addMsg(IS_TOUCH ? 'Stairs lead down into darkness. Tap descend (or your own tile) to take them.'
    : 'Stairs lead down into darkness. Press Enter to descend.', 'm-magic');
  if (tile === T.DARKSTAIRS) addMsg('A second stair, breathing cold. Richer spoils below — and worse company. Enter to dare it.', 'm-bad');
  return true;
}

function afterPlayerTurn() {
  if (G.state !== 'PLAY') return;
  G.player.braced = false; // warrior block guards one hit per player action
  stepProjectiles();
  if (G.state !== 'PLAY') return;
  monstersAct();
  if (G.state !== 'PLAY') return;
  G.turn++;
  G.floorTurns++;
  const p = G.player;
  if (p.cleaveCd > 0) p.cleaveCd--;
  if (p.chargeCd > 0) p.chargeCd--;
  if (p.dashCd > 0) p.dashCd--;
  if (p.bulwarkT > 0) p.bulwarkT--;
  if (p.guardCd > 0) p.guardCd--;
  if (p.vaultCd > 0) p.vaultCd--;
  if (p.guardT > 0) p.guardT--; // the planted shield lowers after the foes' reply
  if (p.vaultStrike > 0) p.vaultStrike--; // the opened back closes fast
  // the dread clock: linger too long and the dark sends MELEE hunters (capped, worthless XP)
  const dreadAt = G.diff.dreadAt - dreadShift();
  if (G.floorTurns === dreadAt - 29) addMsg('The shadows lean closer. Best not linger.', 'm-dim');
  if (G.depth !== FINAL_DEPTH && G.clockSpawns < 2 && G.floorTurns > dreadAt && (G.floorTurns - dreadAt) % 30 === 0) {
    let far = null, fd = -1;
    for (let y = 0; y < G.map.h; y++) for (let x = 0; x < G.map.w; x++) {
      const i = G.map.idx(x, y);
      if (!G.map.explored[i] || !tileWalkable(G.map.tiles[i]) || monsterAt(x, y)) continue;
      const d = dist2(x, y, p.x, p.y);
      if (d > fd && d > 64) { fd = d; far = { x, y }; }
    }
    if (far) {
      const w = spawnMonster(G.depth >= 4 ? 'troll' : 'orc', far.x, far.y);
      w.awake = true;
      w.xp = 0; // hunters carry no glory — there is nothing to farm here
      G.clockSpawns++;
      addMsg('Something in the dark has caught your scent.', 'm-bad');
    }
  }
  // poison ticks
  if (p.poison > 0) {
    p.poison--;
    p.hp--;
    G.floorDmg += 1; // venom counts against flawless floors too
    spawnFloater(p.x, p.y, '☠1', '#8fe05e');
    if (p.poison === 0) addMsg('The venom finally burns itself out.', 'm-good');
    if (p.hp <= 0) { p.hp = 0; die('venom'); return; }
  }
  // regeneration (slow — the depths do not forgive idleness)
  if (G.turn % (hasBoon('b_regen') ? 8 : 15) === 0 && p.hp < p.maxHp && p.hp > 0) p.hp++;
  if (ringIs('ring_regen') && G.turn % 5 === 0 && p.hp < p.maxHp) p.hp++;
  // mana flow
  if (p.maxMana > 0 && p.mana < p.maxMana) {
    p.mana = Math.min(p.maxMana, p.mana + (ringIs('ring_focus') ? 2 : 1));
  }
  // first sight of the dark stair teaches the gamble (widget feedback:
  // 'not really clear what it does')
  if (!G.darkSeen && G.depth >= 2 && G.depth <= 4) {
    for (const key of G.visible) {
      const [vx, vy] = key.split(',');
      if (G.map.get(+vx, +vy) === T.DARKSTAIRS) {
        G.darkSeen = true;
        addMsg('A RED stair, breathing cold — the dark stair plunges PAST the next floor. Richer spoils, worse company.', 'm-bad');
        break;
      }
    }
  }

  // first sight of the merchant's carpet teaches the buying flow
  if (!G.shopSeen && G.shop && G.shop.some(s => G.visible.has(s.x + ',' + s.y))) {
    G.shopSeen = true;
    addMsg('A merchant\'s wares glimmer on warded carpet — step onto one to read its price, step again to buy.', 'm-magic');
  }
  recomputeFOV();
  updateUI();
  saveRun();
}

function attackMonster(m, bonus = 0) {
  const p = G.player;
  const backstab = G.classId === 'rogue' && (!m.awake || m.frozen > 0 || m.stirring || p.vaultStrike > 0);
  if (G.classId === 'rogue' && p.vaultStrike > 0) p.vaultStrike = 0; // one strike per vault
  const crit = !backstab && RNG.chance(p.crit + (hasBoon('b_keen') ? 0.12 : 0));
  let dmg = Math.max(1, playerAtk() + bonus + RNG.int(-1, 2) - m.def);
  if (m.frozen > 0 && hasBoon('b_frost')) dmg += 2;
  if (backstab) dmg *= (hasBoon('b_shadow') ? 4 : 3) + (p.weapon && ITEMS[p.weapon].trait === 'shadow' ? 1 : 0);
  else if (crit) dmg *= 2;
  m.hp -= dmg;
  m.flashT = 1;
  m.awake = true;
  lunge(p, m.x, m.y, 0.34);      // swing into the blow
  lunge(m, p.x, p.y, -0.18);     // knock the target back
  if (backstab) {
    spawnFloater(m.x, m.y, dmg + '!', '#a8f0c0', 17);
    addMsg(`Your blade finds the gap — backstab for ${dmg}!`, 'm-gold');
    Sfx.crit(); addShake(3);
    if (m.hp <= 0 && hasBoon('b_rhythm') && p.dashCd > 0) {
      p.dashCd = Math.max(0, p.dashCd - 6);
      addMsg('The rhythm holds — the shadows open for you again soon.', 'm-good');
    }
    if (m.hp > 0) {
      // a botched assassination is loud
      let woke = 0;
      for (const o of G.monsters) {
        if (o === m || o.awake || o.boss) continue;
        if (cheb(o.x, o.y, m.x, m.y) <= 2) { o.awake = true; woke++; }
      }
      addMsg(woke ? `${TheM(m)} shrieks — the dark stirs around you!`
                  : `${TheM(m)} shrieks and rounds on you!`, 'm-bad');
    }
  } else if (crit) {
    spawnFloater(m.x, m.y, dmg + '!', '#ffd75e', 17);
    addMsg(`Critical! You strike ${theM(m)} for ${dmg}.`, 'm-gold');
    Sfx.crit(); addShake(2);
  } else {
    spawnFloater(m.x, m.y, String(dmg), '#ff8c8c');
    addMsg(`You hit ${theM(m)} for ${dmg}.`, 'm-combat');
    Sfx.hit();
  }
  if (m.hp <= 0) killMonster(m);
}

function addDecal(x, y) {
  G.decals.push({ x, y, color: '#6e1822', seed: CRNG.next() });
  if (G.decals.length > 150) G.decals.shift();
}

/* ground drops must never share a tile with a priced ware — a free item
   under a price tag reads as a gold-skipping exploit (vet2 audit, bug 1) */
function dropSpot(x, y) {
  if (!G.shop || !G.shop.some(s => s.x === x && s.y === y)) return { x, y };
  for (const [dx, dy] of DIRS8) {
    const nx = x + dx, ny = y + dy;
    if (G.map.walkable(nx, ny) && !G.shop.some(s => s.x === nx && s.y === ny)) return { x: nx, y: ny };
  }
  return { x, y };
}

function killMonster(m) {
  // the mage drinks the moment of death: kills siphon +1 mana (player feedback:
  // +2 made the mage 'too powerful' — Mana Font's +1 restores the old rate)
  if (G.player && G.player.maxMana > 0 && (m.xp > 0 || m.boss) && G.player.mana < G.player.maxMana) {
    const sip = 1 + (G.player.weapon && ITEMS[G.player.weapon].trait === 'siphon' ? 1 : 0);
    G.player.mana = Math.min(G.player.maxMana, G.player.mana + sip);
    if (G.visible.has(m.x + ',' + m.y)) spawnFloater(m.x, m.y, `+${sip} mana`, '#9ecbff');
  }
  const idx = G.monsters.indexOf(m);
  if (idx < 0) return;
  G.monsters.splice(idx, 1);
  if (m.xp > 0 || m.boss) G.kills++;
  G.killsBy[m.name] = (G.killsBy[m.name] || 0) + 1;
  G.corpses.push({ x: m.x, y: m.y, glyph: m.glyph, color: m.color, id: m.id, faceL: m.faceL, life: 1 });
  if (G.corpses.length > 40) G.corpses.shift();
  if (G.kills === 1) lichSay('firstKill');
  else if (m.elite) lichSay('eliteKill');
  const p = G.player;
  // raised bones, hunters and other 0-xp chaff carry no glory — and feed no
  // boons, or a mage parked beside the Lich farms his summons forever
  if (m.xp > 0 || m.boss) {
    if (hasBoon('b_vamp') && p.hp > 0) p.hp = Math.min(p.maxHp, p.hp + 1);
    if (hasBoon('b_momentum')) p.momentum = Math.min(3, p.momentum + 1);
    if (hasBoon('b_font') && p.maxMana > 0) p.mana = Math.min(p.maxMana, p.mana + 1);
    if (hasBoon('b_reaper')) earnGold(1);
    if (ringIs('ring_blood') && p.hp > 0) p.hp = Math.min(p.maxHp, p.hp + 1);
  }
  addDecal(m.x, m.y);
  spawnBurst(m.x, m.y, m.color, m.boss ? 40 : 12, m.boss ? 130 : 70);
  Sfx.kill();
  if (m.boss) {
    addMsg('Vyrakhel the Lich shrieks as his phylactery shatters!', 'm-gold');
    addMsg(LICH_LINES.lichDeath, 'm-lich');
    LichVoice.play('lichDeath'); // he gets the last word — he always does
    winGame();
    return;
  }
  addMsg(`${TheM(m)} dies.`, 'm-good');
  if (m.id === 'warlord') lichSay('grukDead');
  // power comes from choices now, not corpses
  if (m.hasKey) {
    G.player.keys++;
    addMsg('A heavy golden key falls from its corpse!', 'm-gold');
    addMsg('Keys crumble to rust when you descend — spend it on this floor.', 'm-dim');
    spawnFloater(m.x, m.y, 'KEY', '#ffd75e', 15);
    Sfx.gold();
  }
  if (m.elite) {
    const g = RNG.int(10, 18);
    earnGold(g);
    addMsg(`${TheM(m)}'s hoard: +${g} gold.`, 'm-gold');
  }
  if (m.id === 'warlord') {
    const ds = dropSpot(m.x, m.y);
    G.items.push({ x: ds.x, y: ds.y, id: 'w_axe' });
    G.items.push({ x: ds.x, y: ds.y, gold: 60 });
    addMsg('Gruk\'s battleaxe clatters to the stone beside a heavy purse!', 'm-gold');
  }
  if (m.splits) {
    let spawned = 0;
    for (const [dx, dy] of DIRS8) {
      if (spawned >= 2) break;
      const nx = m.x + dx, ny = m.y + dy;
      if (G.map.walkable(nx, ny) && !monsterAt(nx, ny) && (nx !== G.player.x || ny !== G.player.y)) {
        spawnMonster('slimelet', nx, ny).awake = true;
        spawned++;
      }
    }
    if (spawned) addMsg('The slime bursts apart — and the pieces keep moving!', 'm-bad');
  }
}


function hurtPlayer(dmg, srcName) {
  const p = G.player;
  // class defenses — every class meets steel its own way. Rogue evades
  // (playerDodge, rolled at the attack site); warrior BLOCKS — braces behind
  // armor to dull the first hit each turn; mage WARDS — mana drinks half of
  // any blow at 1 mana per 2 damage. Deterministic so the player can plan
  // around them, unlike dodge.
  // BULWARK (active): the shield is planted — nothing meaningful gets through
  if (p.guardT > 0 && dmg > 1) {
    spawnFloater(p.x, p.y, `bulwark -${dmg - 1}`, '#9ecbff');
    // truthful numbers at the mitigation boundary (veteran playtest: the
    // attack line printed the unreduced hit and taught the wrong lesson)
    addMsg(`Your planted shield drinks it — ${dmg - 1} stopped, 1 gets through.`, 'm-good');
    dmg = 1;
  } else if (G.classId === 'warrior' && !p.braced && dmg > 1) {
    // 1 + half armor: 2+armor sim-tested at 40% standard / 25% NIGHTMARE
    // bot winrate (baseline ~10%/0%) — the wall must bend, not trivialize
    const red = Math.min(dmg - 1, 1 + Math.ceil((p.armor ? ITEMS[p.armor].bonus : 0) / 2));
    if (red > 0) {
      dmg -= red; p.braced = true;
      spawnFloater(p.x, p.y, `block -${red}`, '#ffd75e');
      addMsg(`You brace behind your guard — ${red} damage turned aside.`, 'm-dim');
    }
  } else if (G.classId === 'mage' && p.mana > 0 && dmg > 1) {
    const absorb = Math.min(Math.floor(dmg / 2), p.mana * 2);
    if (absorb > 0) {
      const cost = Math.ceil(absorb / 2);
      p.mana -= cost; dmg -= absorb;
      spawnFloater(p.x, p.y, `ward -${absorb}`, '#9ecbff');
      addMsg(`Your ward flares — ${absorb} damage unmade for ${cost} mana.`, 'm-magic');
    }
  }
  p.hp -= dmg;
  G.floorDmg += dmg;
  p.momentum = 0;
  p.flashT = 1;
  FX.hurtT = 0.7;
  addShake(3);
  Sfx.hurt();
  spawnFloater(p.x, p.y, String(dmg), '#ff5252');
  if (p.hp <= 0 && hasBoon('b_second') && !p.secondWind) {
    p.secondWind = true;
    p.hp = 1;
    addMsg('SECOND WIND — death reaches for you and closes on air.', 'm-gold');
    spawnFloater(p.x, p.y, 'SECOND WIND', '#ffd75e', 17);
    Sfx.levelup();
    return;
  }
  if (p.hp <= 0) { p.hp = 0; die(srcName); return; }
  lichSay('firstBlood');
  if (p.hp < p.maxHp * 0.2) lichSay('lowHp');
}

function die(srcName) {
  cancelTravel();
  clearSave();
  // leave an echo: future runs may find your body, and a third of your gold
  if (!G.daily) {
    try {
      const echoes = JSON.parse(localStorage.getItem('arcaneEchoes') || '[]');
      echoes.push({ depth: G.depth, cls: G.classDef.name.toLowerCase(), cause: srcName, gold: Math.floor(G.player.gold * 0.34) });
      while (echoes.length > 5) echoes.shift();
      localStorage.setItem('arcaneEchoes', JSON.stringify(echoes));
    } catch (e) { /* ignore */ }
  }
  G.state = 'DYING';
  G.deathCause = `Slain by ${srcName} on floor ${G.depth}.`;
  if (window.GuruTelemetry) GuruTelemetry.death({
    depth: G.depth, cause: srcName, turn: G.turn, kills: G.kills,
    gold_earned: G.goldEarned, score: score(), class_id: G.classId,
    difficulty: G.diffId, daily: G.daily,
  });
  spawnBurst(G.player.x, G.player.y, '#e35d6a', 30, 110);
  addShake(8);
  Sfx.die();
  saveBest();
  grantEmbers(false);
  updateUI();
  setTimeout(() => {
    if (G.state !== 'DYING') return;
    G.state = 'DEAD';
    $('death-cause').textContent = G.deathCause;
    $('death-stats').innerHTML = endStatsHtml();
    wireShare('btn-share-death', false);
    const tipEl = $('death-tip');
    if (tipEl) tipEl.textContent = '“' + deathTip(G.deathCause) + '”';
    $('death-screen').classList.remove('hidden');
  }, 950);
}

/* the dark teaches: a coaching line matched to how you died */
const DEATH_TIPS = [
  [/bone charger|charging/i, 'A charger marks its whole lane a turn ahead. One sidestep and it crashes past you, dazed — that opening is yours.'],
  [/shell|lobber/i, 'The orange plus-mark is a promise: the shell lands there next turn. Be elsewhere — or bait it onto something with teeth.'],
  [/spike trap/i, 'The floor keeps its own counsel. Rogues sense hidden traps; everyone else should mind where the tiles look wrong.'],
  [/beam/i, 'Vyrakhel draws his beam in violet light a full turn before it fires. The marked line is death — stand anywhere else.'],
  [/venom|spider/i, 'Venom stacks, and spiders hunt in packs. An antidote potion purges it all — worth its weight on the lower floors.'],
  [/Gruk/i, 'Gruk is leashed to the stair he guards. He cannot chase you far — pull him, slip back, and fight on your ground, not his.'],
  [/Lich|skeleton/i, 'The Lich tears skeletons from the earth to spend like coin. Cut down his bones the moment they rise, and sidestep everything violet.'],
  [/wraith|cultist|bolt/i, 'Bolts trace their remaining path on the floor — count the tiles. Break line of sight and casters have nothing.'],
  [/troll|golem|crushing/i, 'A red-marked tile is a promise of pain. Heavies telegraph every crushing blow — stand anywhere else and punish the miss.'],
];
const GENERAL_TIPS = [
  'Dozing foes (the small z) never see the blade coming. A rogue\'s first strike from the dark lands for triple.',
  'The dark stair plunges PAST the next floor. Richer spoils — but the dark rules where you land.',
  'Shop wares dropped on the merchant\'s floor sell for half. Carry less, spend smarter.',
  'The gilded corpse pays in gear two floors early. His killers will want it back — loot with an exit in mind.',
  'Water drags at your legs — your dodge suffers. Never take a fight standing in a pool.',
  'Frozen foes take backstab damage from a rogue\'s blade — Frost Nova is not only a mage\'s escape.',
];
function deathTip(cause) {
  // the most teachable death: falling with the cure in your pack
  const pi = (G.player.inventory || []).findIndex(e => e.id === 'potion_heal');
  if (pi >= 0) {
    const pots = G.player.inventory[pi];
    const slot = pi === 9 ? 0 : pi + 1;
    return `You fell carrying ${pots.count} healing potion${pots.count > 1 ? 's' : ''} — ${IS_TOUCH ? 'tap it in your pack' : 'press ' + slot} in the thick of it. The dark forgives hesitation less than greed.`;
  }
  for (const [re, tip] of DEATH_TIPS) if (re.test(cause || '')) return tip;
  return GENERAL_TIPS[RNG.int(0, GENERAL_TIPS.length - 1)];
}

function winGame() {
  cancelTravel();
  clearSave();
  G.state = 'WIN';
  if (G.potionsDrunk === 0) { G.bonusScore += 150; addMsg('CONDUCT: Abstinent — not one potion drunk. +150 score.', 'm-gold'); }
  if (G.purchases === 0) { G.bonusScore += 100; addMsg('CONDUCT: No deal with merchants. +100 score.', 'm-gold'); }
  if (window.GuruTelemetry) GuruTelemetry.win({
    depth: G.depth, turn: G.turn, kills: G.kills, gold_earned: G.goldEarned,
    score: score(), class_id: G.classId, difficulty: G.diffId, daily: G.daily,
    potions_drunk: G.potionsDrunk, purchases: G.purchases,
  });
  saveBest();
  grantEmbers(true);
  updateUI();
  showCutscene('victory', () => {
    Sfx.win();
    $('win-stats').innerHTML = endStatsHtml();
  wireShare('btn-share-win', true);
    $('win-screen').classList.remove('hidden');
  });
}

/* one-tap shareable run summary — written for a feed, not a save file */
function shareRunText(win) {
  const p = G.player;
  const head = win
    ? `I destroyed Vyrakhel the Lich in THE DARK STAIR \u2694`
    : `THE DARK STAIR took me \u2014 ${G.deathCause.replace(/^Slain by /, 'slain by ').replace(/\.$/, '')}`;
  return [
    head,
    `${G.classDef ? G.classDef.name : '?'} \u00b7 ${G.diff.name}${G.daily ? ' \u00b7 DAILY' : ''} \u00b7 floor ${G.depth}/${FINAL_DEPTH} \u00b7 ${G.kills} slain \u00b7 score ${score() + (win ? G.bonusScore : 0)}`,
    `Face the dark: https://thedarkstair.com`,
  ].join('\n');
}
function wireShare(btnId, win) {
  const b = $(btnId);
  if (!b) return;
  b.onclick = () => {
    const txt = shareRunText(win);
    const done = () => { b.textContent = 'Copied \u2014 go scare someone'; setTimeout(() => { b.textContent = win ? 'Copy your legend' : 'Copy your epitaph'; }, 2200); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, done);
    else { try { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); } catch (e) { /* ignore */ } }
  };
}

function endStatsHtml() {
  const top = Object.entries(G.killsBy).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([n, c]) => `${n} ×${c}`).join(', ');
  return `<div>Class</div><b>${G.classDef.name} · ${G.diff.name}${G.daily ? ' · DAILY' : ''}</b>` +
    `<div>Floor reached</div><b>${G.depth}</b>` +
    `<div>Monsters slain</div><b>${G.kills}</b>` +
    (top ? `<div>Most slain</div><b>${top}</b>` : '') +
    `<div>Gold gathered</div><b>${G.player.gold}</b>` +
    `<div>Turns taken</div><b>${G.turn}</b>` +
    `<div>Final score</div><b>${score()}</b>` +
    (G.lastEmbers ? `<div>Soul embers</div><b>◈ ${G.lastEmbers}</b>` : '');
}

function saveBest() {
  try {
    const rec = {
      score: score(), depth: G.depth,
      cls: G.classDef.name, diff: G.diff.name, won: G.state === 'WIN',
    };
    const prev = JSON.parse(localStorage.getItem('arcaneDepthsBest') || 'null');
    if (!prev || !(prev.score >= 0) || rec.score > prev.score) {
      localStorage.setItem('arcaneDepthsBest', JSON.stringify(rec));
    }
    if (G.daily) {
      const dprev = JSON.parse(localStorage.getItem('arcaneDaily') || 'null');
      if (!dprev || dprev.date !== dailyKey() || !(dprev.score >= 0) || rec.score > dprev.score) {
        localStorage.setItem('arcaneDaily', JSON.stringify({ ...rec, date: dailyKey() }));
      }
    }
  } catch (e) { /* storage unavailable */ }
}

function descend() {
  if (G.state !== 'PLAY') return;
  const here = G.map.get(G.player.x, G.player.y);
  if (here !== T.STAIRS && here !== T.DARKSTAIRS) {
    addMsg('There are no stairs here.', 'm-dim');
    return;
  }
  const darkPlunge = here === T.DARKSTAIRS;
  if (darkPlunge) G.darkUsed = true; // the dark grants ONE shortcut a run — skip-skip gutted the game
  if (darkPlunge) G.darkNext = true;
  Sfx.stairs();
  if (G.floorDmg === 0 && G.turn > 0) {
    G.bonusScore += 40;
    addMsg('FLAWLESS FLOOR — untouched by the dark. +40 score.', 'm-gold');
    spawnFloater(G.player.x, G.player.y, 'FLAWLESS +40', '#ffd75e', 16);
    lichSay('flawless');
  }
  startLevel(Math.min(FINAL_DEPTH, G.depth + (darkPlunge ? 2 : 1)));
  if (darkPlunge) {
    addMsg('The dark stair swallows a whole floor of your descent — its riches, its shops, its gifts, all passed by in the black.', 'm-bad');
    lichSay('darkStair');
  }
  FX.fadeT = 1;
  FX.fadeText = G.map.theme.name ? `— FLOOR ${G.depth}: ${G.map.theme.name} —` : `— FLOOR ${G.depth} —`;
  addMsg(`You descend to floor ${G.depth}. The air grows colder; no rest down here.`, 'm-magic');
  if (G.depth === 3) addMsg('War drums echo through the halls. Something large rules this floor.', 'm-bad');
  if (G.depth === 4) lichSay('floor4');
  if (G.depth === FINAL_DEPTH) {
    addMsg('The halls are silent. He has gathered his dead to him.', 'm-bad');
    addMsg('A cold presence watches you. The Lich is near.', 'm-bad');
    showCutscene('floor6', () => offerBoons());
    return;
  }
  offerBoons();
}

function openChest(x, y) {
  G.map.set(x, y, T.FLOOR);
  const gold = RNG.int(10, 25) * G.depth;
  earnGold(gold);
  const id = RNG.weighted(itemPoolForDepth(Math.min(G.depth + 1, FINAL_DEPTH)));
  Sfx.chest();
  spawnBurst(x, y, '#ffd75e', 14, 80);
  addMsg(`The chest creaks open: ${gold} gold inside!`, 'm-gold');
  if (addItem(id)) addMsg(`You also find ${anItem(ITEMS[id].name)}.`, 'm-good');
  else { G.items.push({ x, y, id }); addMsg(`A ${ITEMS[id].name} tumbles out, but your pack is full.`, 'm-dim'); }
}

function openGoldChest(x, y) {
  const p = G.player;
  if (p.keys < 1) {
    addMsg('Sealed by old iron. Something on this floor carries the key…', 'm-dim');
    return false; // reading a lock is free
  }
  p.keys--;
  G.map.set(x, y, T.FLOOR);
  const gold = Math.round(35 * G.depth * (G.map.theme.goldMult || 1));
  earnGold(gold);
  Sfx.chest();
  spawnBurst(x, y, '#ffd75e', 24, 100);
  addMsg(`The golden chest swings open: ${gold} gold!`, 'm-gold');
  lichSay('goldChest');
  for (let k = 0; k < 2; k++) {
    const id = RNG.weighted(itemPoolForDepth(Math.min(G.depth + 1, FINAL_DEPTH)));
    if (addItem(id)) addMsg(`Inside: ${anItem(ITEMS[id].name)}.`, 'm-good');
    else { G.items.push({ x, y, id }); addMsg(`A ${ITEMS[id].name} spills out — your pack is full.`, 'm-dim'); }
  }
  return true;
}

/* the gilded corpse: free premium loot — but the dead man's killers answer */
function lootGilded(x, y) {
  const key = x + ',' + y;
  if (!G.gildedWarned) G.gildedWarned = {};
  if (!G.gildedWarned[key]) {
    G.gildedWarned[key] = 1;
    addMsg('A fallen adventurer in fine clothes — something glitters in his fist.', 'm-dim');
    addMsg('Whatever killed him is still listening. Bump again to pry it free.', 'm-bad');
    Sfx.whisper();
    return false; // looking costs nothing
  }
  G.map.set(x, y, T.FLOOR);
  const id = RNG.weighted(itemPoolForDepth(Math.min(G.depth + 2, FINAL_DEPTH)));
  if (addItem(id)) addMsg(`You pry a ${ITEMS[id].name} from his grip.`, 'm-good');
  else { G.items.push({ x, y, id }); addMsg(`A ${ITEMS[id].name} tumbles free — your pack is full.`, 'm-dim'); }
  const gold = Math.round(15 * G.depth * (G.map.theme.goldMult || 1));
  earnGold(gold);
  addMsg(`His purse yields ${gold} gold.`, 'm-gold');
  spawnBurst(x, y, '#ffd75e', 18, 90);
  spawnBanner('THE DEAD MAN\'S ENVY', '#ffd75e');
  Sfx.whisper();
  // 'The Dead Man's Envy is way too easy' (widget, 2026-06-11): three
  // avengers now, spawned close, and the deep ones come back wrong
  const avengerId = G.depth <= 3 ? 'skeleton' : 'wraith';
  let raised = 0;
  for (let k = 0; k < 60 && raised < 3; k++) {
    const ax = x + RNG.int(-3, 3), ay = y + RNG.int(-3, 3);
    if (!G.map.inBounds(ax, ay)) continue;
    if (cheb(ax, ay, x, y) < 2 || !G.map.walkable(ax, ay)) continue;
    if (monsterAt(ax, ay) || (ax === G.player.x && ay === G.player.y)) continue;
    const av = spawnMonster(avengerId, ax, ay);
    av.awake = true;
    if (G.depth >= 4 && RNG.chance(0.5)) { av.elite = 'frenzied'; av.atk += 1; }
    spawnBurst(ax, ay, '#8fd3e8', 10, 70);
    raised++;
  }
  if (raised) addMsg(G.depth <= 3
    ? 'The dead man\'s killers stir — bones claw up from the earth!'
    : 'Cold air coils — his killers return for what is theirs!', 'm-bad');
  return true;
}

function useShrine(x, y) {
  const p = G.player;
  const key = x + ',' + y;
  G.shrineArmed = G.shrineArmed || {};
  if (!G.shrineArmed[key]) {
    G.shrineArmed[key] = true;
    addMsg('The shrine whispers: an offering of blood for a gift of power. (bump again to accept)', 'm-magic');
    return false; // listening is free
  }
  delete G.shrineArmed[key];
  G.map.set(x, y, T.FLOOR);
  const cost = Math.floor(p.hp * 0.35);
  p.hp -= cost;
  G.floorDmg += cost; // shrine blood counts — no flawless bonus for self-harm
  FX.hurtT = 0.5;
  spawnFloater(p.x, p.y, '-' + cost, '#c7a4ff');
  spawnBurst(x, y, '#c7a4ff', 18, 90);
  Sfx.scroll();
  const gift = RNG.weighted([['atk', 3], ['hp', 3], ['mana', p.maxMana ? 2 : 0], ['curse', 2]]);
  if (gift !== 'curse') lichSay('shrineGift'); else lichSay('shrineCurse');
  if (gift === 'atk') {
    p.baseAtk += 2;
    addMsg(`The shrine drinks deep. Your arms surge with power — ATK +2!`, 'm-gold');
  } else if (gift === 'hp') {
    p.maxHp += 10; p.hp += 10;
    addMsg('The shrine drinks deep. Your flesh knits thicker — Max HP +10!', 'm-gold');
  } else if (gift === 'mana') {
    p.maxMana += 5; p.mana = p.maxMana;
    addMsg('The shrine drinks deep. Your mind blazes — Max mana +5, fully restored!', 'm-gold');
  } else {
    addMsg('THE SHRINE LAUGHS. Something is taken that will not return.', 'm-bad');
    spawnFloater(x, y, 'THE SHRINE LAUGHS', '#e35d6a', 16);
    p.maxHp = Math.max(10, p.maxHp - 5);
    p.hp = Math.min(p.hp, p.maxHp);
    let raised = 0;
    for (const [dx, dy] of DIRS8) {
      if (raised >= 2) break;
      const nx = x + dx, ny = y + dy;
      if (G.map.walkable(nx, ny) && !monsterAt(nx, ny) && (nx !== p.x || ny !== p.y)) {
        const s = spawnMonster('skeleton', nx, ny);
        s.awake = true;
        s.xp = 0; // shrine-born bones carry no glory
        raised++;
        spawnBurst(nx, ny, '#c7a4ff', 10, 70);
      }
    }
  }
  return true;
}

/* ---------- spells ---------- */
/* warrior-only: Shield Charge — dash up to 3 tiles along a clear line into a foe, strike at +50% */
function castCharge() {
  if (G.state !== 'PLAY') return;
  cancelTravel();
  const p = G.player;
  if (p.chargeCd > 0) { addMsg(`Shield Charge needs ${p.chargeCd} more turns.`, 'm-dim'); return; }
  // nearest visible foe on an aligned, clear, corner-open line within 4
  let pick = null, pd = 1e9;
  for (const m of G.monsters) {
    if (!G.visible.has(m.x + ',' + m.y)) continue;
    const adx = m.x - p.x, ady = m.y - p.y;
    const c = cheb(m.x, m.y, p.x, p.y);
    if (c < 2 || c > (hasBoon('b_juggern') ? 6 : 4)) continue;
    if (adx !== 0 && ady !== 0 && Math.abs(adx) !== Math.abs(ady)) continue;
    const sx = Math.sign(adx), sy = Math.sign(ady);
    let cx = p.x, cy = p.y, clear = true;
    for (let s = 1; s < c && s <= (hasBoon('b_juggern') ? 6 : 4); s++) {
      if (!diagOpen(G.map, cx, cy, sx, sy)) { clear = false; break; }
      cx += sx; cy += sy;
      if (!G.map.walkable(cx, cy) || monsterAt(cx, cy)) { clear = false; break; }
    }
    if (!clear || !diagOpen(G.map, cx, cy, sx, sy)) continue;
    const d = dist2(m.x, m.y, p.x, p.y);
    if (d < pd) { pd = d; pick = { m, tx: cx, ty: cy }; }
  }
  if (!pick) { addMsg('No foe in charge range — you need a clear, straight line (2-4 tiles).', 'm-dim'); return; }
  p.chargeCd = 10 - tempoEdge();
  spawnBurst(p.x, p.y, '#ffd75e', 8, 60);
  p.x = pick.tx; p.y = pick.ty;
  p.rx = p.x; p.ry = p.y;
  addShake(4);
  Sfx.gallop();
  addMsg(`You slam forward, shield-first, into ${theM(pick.m)}!`, 'm-gold');
  attackMonster(pick.m, Math.ceil(playerAtk() * 0.5));
  if (hasBoon('b_breaker') && G.monsters.includes(pick.m)) {
    pick.m.skipT = Math.max(pick.m.skipT, 1); pick.m.stirring = true;
    if (G.visible.has(pick.m.x + ',' + pick.m.y)) spawnFloater(pick.m.x, pick.m.y, 'reeling', '#ffd75e');
  }
  if (G.state !== 'PLAY') return;
  if (!onEnterTile(p.x, p.y)) return;
  afterPlayerTurn();
}

/* warrior-only ACTIVE: Bulwark — plant the shield and let the dark break on it.
   Until your next turn every hit is turned aside to 1 damage. The cornered
   warrior's answer when there is nothing to charge (user feedback: actives,
   not passives — 'Warrior and Rogue can get caught in a corridor'). */
function castBulwark() {
  if (G.state !== 'PLAY') return;
  const p = G.player;
  if (p.guardCd > 0) { addMsg(`Your shield arm recovers in ${p.guardCd} ${p.guardCd === 1 ? 'turn' : 'turns'}.`, 'm-dim'); return; }
  cancelTravel();
  p.guardT = 1;
  p.guardCd = 12 - tempoEdge();
  addMsg('You plant your shield and set your feet. Let them come.', 'm-gold');
  spawnFloater(p.x, p.y, 'BULWARK', '#9ecbff', 13);
  Sfx.equip();
  afterPlayerTurn();
}

/* rogue-only ACTIVE: Vault — leap clean over an adjacent foe and land behind
   it. The cornered rogue's way out of a corridor wall of flesh. */
function castVault() {
  if (G.state !== 'PLAY') return;
  const p = G.player;
  if (p.vaultCd > 0) { addMsg(`Vault recovers in ${p.vaultCd} ${p.vaultCd === 1 ? 'turn' : 'turns'}.`, 'm-dim'); return; }
  // candidate: adjacent monster with a free tile straight beyond it;
  // prefer the landing spot with the fewest foes breathing on it
  let best = null, bestCrowd = 99, sawFoe = false;
  for (const [dx, dy] of DIRS8) {
    const m = monsterAt(p.x + dx, p.y + dy);
    if (!m) continue;
    sawFoe = true;
    const lx = p.x + dx * 2, ly = p.y + dy * 2;
    if (!G.map.walkable(lx, ly) || monsterAt(lx, ly)) continue;
    let crowd = 0;
    for (const [adx, ady] of DIRS8) if (monsterAt(lx + adx, ly + ady)) crowd++;
    if (crowd < bestCrowd) { bestCrowd = crowd; best = { lx, ly, m }; }
  }
  // truthful refusals (veteran playtest: the wrong message 'gaslit me three times')
  if (!best) { addMsg(sawFoe ? 'No room to land — the far side is blocked.' : 'No foe close enough to vault over.', 'm-dim'); return; }
  cancelTravel();
  spawnBurst(p.x, p.y, '#a8f0c0', 8, 60);
  p.x = best.lx; p.y = best.ly;
  lunge(p, best.m.x, best.m.y, -0.4);
  p.vaultCd = 8 - tempoEdge();
  // 'land soft behind it' now cashes out: your next strike this turn or the
  // next is a true backstab — Vault is the rogue's sanctioned elite answer
  p.vaultStrike = 2;
  addMsg(`You vault clean over the ${best.m.name} and land soft behind it — its back is yours.`, 'm-good');
  Sfx.dash ? Sfx.dash() : Sfx.equip();
  if (G.state !== 'PLAY') return;
  if (!onEnterTile(p.x, p.y)) return;
  afterPlayerTurn();
}

/* rogue-only: Shadow Dash — melt through the dark to a tile beside a foe;
   if they haven't fully clocked you (dozing, stirring, frozen), strike as a backstab on arrival */
function castShadowDash() {
  if (G.state !== 'PLAY') return;
  cancelTravel();
  const p = G.player;
  if (p.dashCd > 0) { addMsg(`Shadow Dash needs ${p.dashCd} more turns.`, 'm-dim'); return; }
  // hover target first, else nearest visible foe within 3
  let target = null;
  const inRange = m => G.visible.has(m.x + ',' + m.y) && cheb(m.x, m.y, p.x, p.y) >= 2 && cheb(m.x, m.y, p.x, p.y) <= 3;
  if (FX.hover) {
    const hm = monsterAt(FX.hover.x, FX.hover.y);
    if (hm && inRange(hm)) target = hm;
  }
  if (!target) {
    let bd = 1e9;
    for (const m of G.monsters) {
      if (!inRange(m)) continue;
      const d = dist2(m.x, m.y, p.x, p.y);
      if (d < bd) { bd = d; target = m; }
    }
  }
  if (!target) { addMsg('No foe within dash reach (2-3 tiles, in sight).', 'm-dim'); return; }
  let spot = null, sd = 1e9;
  for (const [dx, dy] of DIRS8) {
    const nx = target.x + dx, ny = target.y + dy;
    if (!G.map.walkable(nx, ny) || monsterAt(nx, ny) || (nx === p.x && ny === p.y)) continue;
    if (!G.visible.has(nx + ',' + ny)) continue;
    const d = dist2(nx, ny, p.x, p.y);
    if (d < sd) { sd = d; spot = [nx, ny]; }
  }
  if (!spot) { addMsg('No shadow to step from beside that foe.', 'm-dim'); return; }
  p.dashCd = 12 - tempoEdge();
  spawnBurst(p.x, p.y, '#a8f0c0', 10, 70);
  p.x = spot[0]; p.y = spot[1];
  p.rx = p.x; p.ry = p.y;
  spawnBurst(p.x, p.y, '#a8f0c0', 10, 70);
  Sfx.scroll();
  if (!target.awake || target.stirring || target.frozen > 0) {
    addMsg('You pour out of the darkness, blade first.', 'm-gold');
    attackMonster(target); // backstab rules apply: unaware/frozen targets eat the x3
  } else {
    addMsg('You melt through the dark and reappear at its side.', 'm-magic');
  }
  if (hasBoon('b_fade')) {
    let faded = 0;
    for (const o of G.monsters) {
      if (!o.awake || o.boss || cheb(o.x, o.y, p.x, p.y) > 2) continue;
      o.skipT = Math.max(o.skipT, 1); o.stirring = true; faded++;
    }
    if (faded) addMsg('The dark swallows your shape — they grope for where you were.', 'm-magic');
  }
  if (G.state !== 'PLAY') return;
  if (!onEnterTile(p.x, p.y)) return;
  afterPlayerTurn();
}

/* gifts feed sorcery too: half of any attack power above your class base */
function spellBonus() {
  return Math.max(0, Math.floor((playerAtk() - G.classDef.atk) / 2));
}

function castSpell(i) {
  if (G.state !== 'PLAY') return;
  cancelTravel();
  const p = G.player;
  if (!p.maxMana) { addMsg('You fumble at forces you cannot grasp.', 'm-dim'); return; }
  const sp = SPELLS[i];
  if (p.mana < sp.cost) { addMsg(`Not enough mana for ${sp.name} (${sp.cost}).`, 'm-dim'); return; }

  if (i === 0) { // Firebolt — a real projectile: 3 tiles per turn, blockable, dodgeable
    let best = null, bd = 1e9;
    for (const m of G.monsters) {
      if (!G.visible.has(m.x + ',' + m.y)) continue;
      const d = dist2(m.x, m.y, p.x, p.y);
      if (d < bd) { bd = d; best = m; }
    }
    if (!best) { addMsg('No target within sight of your firebolt.', 'm-dim'); return; }
    if (!traceBeam(p.x, p.y, best.x, best.y).some(t => t.x === best.x && t.y === best.y)) {
      addMsg(`No clear shot at ${theM(best)} — move first.`, 'm-dim');
      return;
    }
    const cost = sp.cost + (hasBoon('b_blaze') ? 1 : 0);
    if (p.mana < cost) { addMsg('Not enough mana.', 'm-dim'); return; }
    p.mana -= cost;
    Sfx.firebolt();
    // full power within 3 tiles (5 with Closer Flame), −2 damage per tile beyond
    const fullR = hasBoon('b_blaze') ? 5 : 3;
    let boltDmg = Math.max(5, 11 - Math.max(0, cheb(best.x, best.y, p.x, p.y) - fullR) * 2) + spellBonus();
    const sCrit = RNG.chance(p.crit + (hasBoon('b_keen') ? 0.12 : 0));
    if (sCrit) boltDmg = Math.round(boltDmg * 1.5);
    spawnProjectile(p.x, p.y, best.x, best.y, {
      dmg: boltDmg, color: '#ff8c5e', fromPlayer: true, crit: sCrit,
      speed: hasBoon('b_blaze') ? 5 : 3,
    });
    addMsg(sCrit ? 'You loose a firebolt — it SCREAMS down the corridor!' : 'You loose a firebolt down the corridor.', 'm-magic');  } else if (i === 1) { // Frost Nova
    const targets = G.monsters.filter(m => cheb(m.x, m.y, p.x, p.y) <= 2 && G.visible.has(m.x + ',' + m.y));
    if (!targets.length) { addMsg('The cold finds no one to bite.', 'm-dim'); return; }
    p.mana -= sp.cost;
    Sfx.freeze();
    addShake(3);
    const dmg = 7 + spellBonus();
    addMsg(`Frost erupts outward — ${targets.length} ${targets.length === 1 ? 'foe is' : 'foes are'} frozen solid!`, 'm-magic');
    for (const m of targets) {
      m.hp -= dmg;
      m.frozen = (m.boss || m.mini) ? 1 : (hasBoon('b_frost') ? 5 : 3); // bosses shrug off deep cold
      m.flashT = 1;
      m.awake = true;
      spawnBurst(m.x, m.y, '#9ee8ff', 12, 80);
      spawnFloater(m.x, m.y, String(dmg), '#9ee8ff');
    }
    for (const m of targets) if (m.hp <= 0 && G.monsters.includes(m)) killMonster(m);
  } else if (i === 2) { // Mend
    if (p.hp >= p.maxHp) { addMsg('You are already whole.', 'm-dim'); return; }
    p.mana -= sp.cost;
    const heal = Math.min(p.maxHp - p.hp, 14);
    p.hp += heal;
    Sfx.mend();
    spawnFloater(p.x, p.y, `+${heal}`, '#7ee0a3');
    addMsg(`Soft light knits your wounds. +${heal} HP.`, 'm-good');
  } else { // Blink — step through space to a visible tile within 5
    let spot = null;
    const valid = (x, y) => G.map.inBounds(x, y) && G.visible.has(x + ',' + y) &&
      G.map.walkable(x, y) && !monsterAt(x, y) && (x !== p.x || y !== p.y) &&
      dist2(x, y, p.x, p.y) <= 25;
    const noWare = (x, y) => !G.shop.some(s => s.x === x && s.y === y);
    if (FX.hover && valid(FX.hover.x, FX.hover.y) && noWare(FX.hover.x, FX.hover.y)) spot = { x: FX.hover.x, y: FX.hover.y };
    else {
      // keyboard cast: pick the visible tile that puts the most space between you and danger
      let bestScore = -1;
      for (const key of G.visible) {
        const [x, y] = key.split(',').map(Number);
        if (!valid(x, y) || !noWare(x, y)) continue;
        // a blink that lands inside a telegraphed beam lane is no escape at all
        if (G.monsters.some(mm => mm.beam && mm.beam.some(bt => bt.x === x && bt.y === y))) continue;
        let nearest = 1e9;
        for (const mm of G.monsters) if (mm.awake) nearest = Math.min(nearest, dist2(x, y, mm.x, mm.y));
        if (nearest === 1e9) nearest = dist2(x, y, p.x, p.y); // no threats: just go far
        if (nearest > bestScore) { bestScore = nearest; spot = { x, y }; }
      }
    }
    if (!spot) { addMsg('No clear space to blink to.', 'm-dim'); return; }
    p.mana -= sp.cost;
    spawnBurst(p.x, p.y, '#9ecbff', 12, 80);
    p.x = spot.x; p.y = spot.y;
    p.rx = p.x; p.ry = p.y;
    spawnBurst(p.x, p.y, '#9ecbff', 12, 80);
    Sfx.scroll();
    addMsg('Reality folds.', 'm-magic');
    if (!onEnterTile(p.x, p.y)) return;
  }
  afterPlayerTurn();
}

/* warrior-only: strike every adjacent enemy in one sweep */
function castCleave() {
  if (G.state !== 'PLAY') return;
  cancelTravel();
  const p = G.player;
  if (p.cleaveCd > 0) { addMsg(`Cleave needs ${p.cleaveCd} more turns.`, 'm-dim'); return; }
  const targets = G.monsters.filter(m => cheb(m.x, m.y, p.x, p.y) <= 1);
  if (!targets.length) { addMsg('You sweep your blade through empty air.', 'm-dim'); return; }
  p.cleaveCd = (hasBoon('b_cleave') ? 5 : 10) - tempoEdge();
  if (hasBoon('b_cleave')) { p.hp = Math.max(1, p.hp - 2); spawnFloater(p.x, p.y, '-2', '#e35d6a'); }
  if (hasBoon('b_bulwark')) p.bulwarkT = 4;
  addShake(4);
  Sfx.crit();
  addMsg(`Your blade sweeps a full circle — ${targets.length} ${targets.length === 1 ? 'foe reels' : 'foes reel'}!`, 'm-gold');
  for (const m of targets) if (G.monsters.includes(m)) attackMonster(m, 1);
  afterPlayerTurn();
}

/* ---------- inventory ---------- */
function addItem(id) {
  const def = ITEMS[id];
  const inv = G.player.inventory;
  if (def.stack) {
    const entry = inv.find(e => e.id === id);
    if (entry) { entry.count++; return true; }
  }
  if (inv.length >= 10) return false;
  inv.push({ id, count: 1 });
  return true;
}

function dropItem(index) {
  if (G.state !== 'PLAY') return;
  cancelTravel();
  const inv = G.player.inventory;
  const entry = inv[index];
  if (!entry) return;
  // merchant buy-back: set an item down beside the wares and the ward pays half value
  if (G.shop && G.shop.some(s => cheb(s.x, s.y, G.player.x, G.player.y) <= 1)) {
    const def = ITEMS[entry.id];
    const pay = Math.max(1, Math.floor((def.price ? def.price(1) : 4) / 2));
    entry.count--;
    if (entry.count <= 0) inv.splice(index, 1);
    earnGold(pay);
    G.purchases++; // dealing is dealing — selling breaks the 'No deal with merchants' conduct
    addMsg(`The shop ward hums and swallows the ${def.name} — ${pay} gold appears in your purse.`, 'm-gold');
    Sfx.buy();
    spawnFloater(G.player.x, G.player.y, '+' + pay + '$', '#ffd75e');
    afterPlayerTurn();
    return;
  }
  G.items.push({ x: G.player.x, y: G.player.y, id: entry.id });
  entry.count--;
  if (entry.count <= 0) inv.splice(index, 1);
  addMsg(`You set the ${ITEMS[entry.id].name} down. (step away before it leaps back into your pack)`, 'm-dim');
  Sfx.pickup();
  afterPlayerTurn();
}

function useItem(index) {
  if (G.state !== 'PLAY') return;
  cancelTravel();
  const inv = G.player.inventory;
  const entry = inv[index];
  if (!entry) return;
  const def = ITEMS[entry.id];
  const p = G.player;

  if (def.kind === 'weapon' || def.kind === 'armor' || def.kind === 'ring') {
    const oldStatW = playerAtk(), oldStatA = playerDef();
    // mid-combat misfires: depleting potions renumber slots, and queued digit
    // presses then equip gear instead. Confirm equips while danger is visible.
    if (dangerVisible()) {
      if (G.equipAsk !== entry.id + ':' + G.turn) {
        G.equipAsk = entry.id + ':' + G.turn;
        addMsg(`Equip the ${def.name} mid-fight? Press again to confirm.`, 'm-dim');
        return;
      }
    }
    G.equipAsk = null;
    const slot = def.kind;
    const old = p[slot];
    p[slot] = entry.id;
    inv.splice(index, 1);
    if (old) inv.push({ id: old, count: 1 });
    if (slot === 'weapon' && G.classDef.mana > 0) {
      // the staff's well of mana travels with the wood — and only speaks
      // to those who already hear it (no phantom mana bar for the warrior)
      const manaOf = id => (id && ITEMS[id].trait === 'mana') ? 6 : 0;
      const delta6 = manaOf(entry.id) - manaOf(old);
      if (delta6) {
        p.maxMana = Math.max(0, p.maxMana + delta6);
        p.mana = Math.min(p.maxMana, Math.max(0, p.mana + Math.max(0, delta6)));
      }
    }
    const verb = slot === 'weapon' ? 'wield' : slot === 'armor' ? 'don' : 'slip on';
    const delta = slot === 'weapon' ? `⚔ ${oldStatW} → ${playerAtk()}`
      : slot === 'armor' ? `🛡 ${oldStatA} → ${playerDef()}`
      : (def.desc || '');
    addMsg(`You ${verb} the ${def.name}.${delta ? ' (' + delta + ')' : ''}`, 'm-good');
    Sfx.equip();
  } else if (entry.id === 'potion_heal') {
    // a 1-HP sip wastes a whole potion (mobile playtest drank at 62/63)
    if (p.hp >= p.maxHp - 2) { addMsg('Barely a scratch — best save it.', 'm-dim'); return; }
    G.potionsDrunk++;
    const heal = Math.min(p.maxHp - p.hp, Math.round((14 + 2 * G.depth) * (G.diff.potionMult || 1) * ((hasBoon('b_pact') || hasBoon('b_regen')) ? 0.5 : 1)));
    p.hp += heal;
    addMsg(`You drink the potion and recover ${heal} HP.`, 'm-good');
    Sfx.potion();
    spawnFloater(p.x, p.y, `+${heal}`, '#7ee0a3');
    if (entry.count === 1) lichSay('lastPotion');
  } else if (entry.id === 'potion_anti') {
    const had = p.poison > 0;
    p.poison = 0;
    p.hp = Math.min(p.maxHp, p.hp + 4);
    addMsg(had ? 'The antidote scours the venom from your blood.' : 'Bitter, but invigorating. +4 HP.', 'm-good');
    Sfx.potion();
  } else if (entry.id === 'potion_vigor') {
    p.maxHp += 5; p.hp += 5;
    addMsg('Vigor floods your veins. Max HP +5!', 'm-gold');
    Sfx.potion();
    spawnFloater(p.x, p.y, 'MAX HP +5', '#ff9ecb');
  } else if (entry.id === 'elixir_str') {
    p.baseAtk += 1;
    addMsg('Your muscles harden like iron. Attack +1!', 'm-gold');
    Sfx.potion();
    spawnFloater(p.x, p.y, 'ATK +1', '#ffb55e');
  } else if (entry.id === 'scroll_fire') {
    const targets = G.monsters.filter(m =>
      G.visible.has(m.x + ',' + m.y) && dist2(m.x, m.y, p.x, p.y) <= 36);
    if (!targets.length) { addMsg('The scroll crackles… but finds no targets.', 'm-dim'); return; }
    const dmg = 12 + G.depth * 2;
    Sfx.fireball();
    addShake(5);
    addMsg(`The scroll erupts in a firestorm! ${targets.length} ${targets.length === 1 ? 'enemy is' : 'enemies are'} engulfed.`, 'm-magic');
    for (const m of targets) {
      m.hp -= dmg;
      m.flashT = 1;
      m.awake = true;
      spawnBurst(m.x, m.y, '#ff8c5e', 14, 90);
      spawnFloater(m.x, m.y, String(dmg), '#ff8c5e');
    }
    for (const m of targets) if (m.hp <= 0 && G.monsters.includes(m)) killMonster(m);
  } else if (entry.id === 'scroll_tele') {
    const spot = randomFloor(G.map, s => !monsterAt(s.x, s.y) && (s.x !== p.x || s.y !== p.y)
      && !G.shop.some(w => w.x === s.x && w.y === s.y));
    if (!spot) { addMsg('The scroll fizzles.', 'm-dim'); return; }
    spawnBurst(p.x, p.y, '#9ecbff', 12, 80);
    p.x = spot.x; p.y = spot.y;
    p.rx = p.x; p.ry = p.y;
    spawnBurst(p.x, p.y, '#9ecbff', 12, 80);
    Sfx.scroll();
    addMsg('Reality blinks — you are elsewhere.', 'm-magic');
    entry.count--;
    if (entry.count <= 0) inv.splice(inv.indexOf(entry), 1);
    if (!onEnterTile(p.x, p.y)) return;
    afterPlayerTurn();
    return;
  } else if (entry.id === 'scroll_map') {
    G.map.explored.fill(1);
    G.map.trapSeen.set(G.map.tiles.map(t => t === T.TRAP ? 1 : 0));
    Sfx.scroll();
    addMsg('Arcane sight floods your mind — the floor is revealed.', 'm-magic');
  }

  if (def.kind !== 'weapon' && def.kind !== 'armor' && def.kind !== 'ring') {
    entry.count--;
    if (entry.count <= 0) inv.splice(inv.indexOf(entry), 1);
  }
  afterPlayerTurn();
}

/* the floor's teeth bite everyone: monsters stepping onto traps spring them.
   Returns false if the monster died to the trap. */
function monsterStepHazard(m) {
  const i = G.map.idx(m.x, m.y);
  if (G.map.tiles[i] !== T.TRAP) return true;
  const dmg = RNG.int(3, 5 + G.depth);
  m.hp -= dmg; m.flashT = 1;
  G.map.trapSeen[i] = 1;
  if (G.visible.has(m.x + ',' + m.y)) {
    addMsg(`The spike trap bites ${theM(m)} for ${dmg}!`, 'm-good');
    spawnFloater(m.x, m.y, String(dmg), '#d46a6a');
    Sfx.trap();
  }
  if (m.hp <= 0) { killMonster(m); return false; }
  return true;
}

/* lobbed shells: tick fuses, then burst on the marked tile + orthogonal splash */
function shellZone(sh) {
  const z = [{ x: sh.x, y: sh.y, full: true }];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = sh.x + dx, ny = sh.y + dy;
    if (G.map.inBounds(nx, ny) && !G.map.opaque(nx, ny)) z.push({ x: nx, y: ny, full: false });
  }
  return z;
}
function resolveShells() {
  if (!G.shells) G.shells = [];
  const p = G.player;
  for (let i = G.shells.length - 1; i >= 0; i--) {
    const sh = G.shells[i];
    sh.timer--;
    if (sh.timer === 1) { Sfx.shellFall(); continue; }
    if (sh.timer > 0) continue;
    G.shells.splice(i, 1);
    spawnBurst(sh.x, sh.y, sh.color, 14, 90);
    Sfx.burst();
    for (const z of shellZone(sh)) {
      const dmg = Math.max(1, (z.full ? sh.dmg : Math.ceil(sh.dmg / 2)) + RNG.int(-1, 1));
      if (p.x === z.x && p.y === z.y) {
        const taken = Math.max(1, Math.round(dmg * (G.diff.telegraphMult || 1)) - playerDef());
        addMsg(z.full ? `The shell bursts on top of you — ${taken} damage!`
          : `The shell bursts beside you — ${taken} damage!`, 'm-bad');
        hurtPlayer(taken, 'a sputtering shell');
        if (G.state !== 'PLAY') return;
        continue;
      }
      const m = monsterAt(z.x, z.y);
      if (m) {
        m.hp -= dmg; m.flashT = 1; m.awake = true;
        if (G.visible.has(z.x + ',' + z.y)) {
          spawnFloater(z.x, z.y, String(dmg), sh.color);
          addMsg(`The shell scorches ${theM(m)} for ${dmg}!`, 'm-good');
        }
        if (m.hp <= 0) killMonster(m);
      }
    }
  }
}

/* ---------- monster AI ---------- */
function monstersAct() {
  const p = G.player;
  resolveShells();
  const field = computeDistField(G.map, p.x, p.y);
  for (const m of [...G.monsters]) {
    if (!G.monsters.includes(m)) continue;
    if (m.frozen > 0) { m.frozen--; m.windup = 0; m.beam = null; m.lane = null; continue; }
    if (m.skipT > 0) { m.skipT--; if (m.skipT === 0) m.stirring = false; continue; }
    if (m.slow) { m.slowTick = !m.slowTick; if (!m.slowTick) continue; } // ponderous: acts every other turn
    if (m.regen && m.hp < m.maxHp) m.hp++;
    if (m.cd > 0) m.cd--;
    const seen = G.visible.has(m.x + ',' + m.y);
    const d = Math.sqrt(dist2(m.x, m.y, p.x, p.y));

    // resolve a telegraphed charge: dash along the marked lane
    if (m.lane && m.lane.length) {
      const lane = m.lane;
      m.lane = null; m.laneDir = null;
      Sfx.gallop();
      let hitPlayer = false;
      for (const t of lane) {
        if (t.x === p.x && t.y === p.y) {
          if (RNG.chance(playerDodge())) {
            addMsg(`You leap aside — ${theM(m)} thunders past!`, 'm-good');
            spawnFloater(p.x, p.y, 'dodge', '#a8f0c0');
            continue; // it barrels on past you down the lane
          }
          hitPlayer = true;
          const dmg = Math.max(1, Math.round(m.atk * 1.5 * (G.diff.telegraphMult || 1)) + RNG.int(-1, 1) - playerDef());
          addMsg(`${TheM(m)} slams into you at full gallop — ${dmg} damage!`, 'm-bad');
          Sfx.hit();
          hurtPlayer(dmg, `a charging ${m.name}`);
          if (G.state !== 'PLAY') return;
          break;
        }
        if (!G.map.walkable(t.x, t.y) || monsterAt(t.x, t.y)) break;
        m.x = t.x; m.y = t.y;
      }
      // a missed charge ends in a skidding crash — the opening you earned
      if (!hitPlayer) {
        m.skipT = 1;
        if (G.visible.has(m.x + ',' + m.y)) {
          Sfx.daze();
          addMsg(`${TheM(m)} crashes to a halt, dazed!`, 'm-good');
          spawnFloater(m.x, m.y, 'dazed', '#d8cfc0');
        }
      }
      if (!monsterStepHazard(m)) continue;
      continue;
    }

    // resolve a wound-up heavy blow
    if (m.windup === 1) {
      m.windup = 0;
      const mult = 2;
      m.windupRest = 1; // a swung-and-missed heavy needs a beat — re-telegraph spam made trolls a stalemate
      if (p.x === m.windupX && p.y === m.windupY && cheb(m.x, m.y, p.x, p.y) <= 1 && !RNG.chance(playerDodge())) {
        const dmg = Math.max(1, Math.round(m.atk * mult) + RNG.int(-1, 1) - playerDef());
        addMsg(`The blow lands like a falling gate — ${dmg} damage!`, 'm-bad');
        addShake(5);
        Sfx.crit();
        hurtPlayer(dmg, `${aM(m)}`);
        if (G.state !== 'PLAY') return;
        if (m.elite === 'venomous') {
          p.poison = Math.min(10, p.poison + 4);
          addMsg('Venom burns in your veins!', 'm-bad');
          spawnFloater(p.x, p.y, 'POISONED', '#8fe05e');
        }
      } else {
        addMsg(`${TheM(m)}'s blow shatters stone where you stood.`, 'm-good');
        spawnBurst(m.windupX, m.windupY, '#8a8aa0', 8, 60);
        if (m.mini) { m.skipT = 1; addMsg('The axe is buried in the stone!', 'm-gold'); }
      }
      continue;
    }

    // resolve a channeled soulrend beam
    if (m.beam) {
      const line = m.beam;
      m.beam = null;
      const bolt = Math.max(1, m.atk - 1);
      let drained = 0;
      Sfx.fireball();
      addShake(5);
      for (const t of line) spawnBurst(t.x, t.y, '#c77dff', 4, 50);
      if (line.some(t => t.x === p.x && t.y === p.y)) {
        const hpBefore = p.hp;
        const dmg = Math.max(1, Math.round(bolt * (G.diff.lichBeamMult || 2)) + RNG.int(-1, 1) - playerDef());
        addMsg(`The soulrend beam tears through you — ${dmg} damage!`, 'm-bad');
        hurtPlayer(dmg, `${aM(m)}`);
        drained += Math.min(dmg, hpBefore); // no overheal from overkill
        if (G.state !== 'PLAY') return;
      } else {
        addMsg('The beam scorches empty stone — you slipped its path.', 'm-good');
      }
      for (const other of [...G.monsters]) {
        if (other === m || !G.monsters.includes(other)) continue;
        if (line.some(t => t.x === other.x && t.y === other.y)) {
          const dmg = bolt * 2;
          drained += Math.min(dmg, other.hp);
          other.hp -= dmg;
          other.flashT = 1;
          spawnFloater(other.x, other.y, String(dmg), '#c77dff');
          addMsg(`The beam devours the ${other.name}!`, 'm-magic');
          if (other.hp <= 0) killMonster(other);
        }
      }
      if (drained > 0) {
        m.hp = Math.min(m.maxHp, m.hp + drained);
        spawnFloater(m.x, m.y, '+' + drained, '#c77dff');
      }
      m.cd = m.enraged ? 1 : 2;
      continue;
    }

    if (!m.awake) {
      const sight = Math.max(2, m.sight - (G.classDef.sneak || 0) - (hasBoon('b_ghost') ? 1 : 0));
      // stealth: a sneak-class player can actually close the gap — sleepers
      // only stir by chance, scaling with proximity. Everyone else (and any
      // boss/mini set piece) wakes the moment they'd spot you, as before.
      let wakes = seen && d <= sight;
      if (wakes && (G.classDef.sneak || 0) > 0 && !m.boss && !m.mini) {
        let wakeCh = d <= 1.5 ? 0.3 : d <= 3 ? 0.15 : 0.05;
        if (hasBoon('b_ghost')) wakeCh *= 0.5;
        wakes = RNG.chance(wakeCh);
      }
      if (wakes) {
        m.awake = true;
        if (!m.boss && !m.mini) { m.skipT = Math.max(m.skipT, 1); m.stirring = true; }
        if (m.mini) GrukVoice.say('notice');
        addMsg(m.boss ? '“ANOTHER MORSEL CRAWLS INTO MY TOMB.”'
          : m.mini ? 'Gruk the Warlord roars a challenge!'
          : `${TheM(m)} notices you!`, (m.boss || m.mini) ? 'm-bad' : 'm-dim');
        if (m.boss) { spawnBanner('VYRAKHEL THE LICH', '#c77dff'); m.firstBeamDue = true; }
        else if (m.mini) spawnBanner('GRUK THE WARLORD', '#e8a05e');
        // the cry carries: nearby monsters stir
        let woke = 0;
        for (const o of G.monsters) {
          if (o === m || o.awake || o.boss) continue;
          if (cheb(o.x, o.y, m.x, m.y) <= 2) { o.awake = true; o.skipT = Math.max(o.skipT, 1); o.stirring = true; woke++; }
        }
        if (woke > 0) addMsg('Its cry wakes the dark around you!', 'm-bad');
      } else {
        if (RNG.chance(0.25)) wander(m);
        continue;
      }
    }

    // lich enrage at half health: faster bolts, hungrier summons
    if (m.boss && !m.enraged && m.hp <= m.maxHp / 2) {
      m.enraged = true;
      addMsg('VYRAKHEL\'S BONES BLAZE WITH VIOLET FIRE — HIS BOLTS COME FASTER!', 'm-bad');
      addMsg(LICH_LINES.enrage, 'm-lich');
      LichVoice.play('enrage');
      spawnBanner('THE LICH IS ENRAGED', '#c77dff');
      spawnBurst(m.x, m.y, '#c77dff', 24, 110);
    }

    // boss: summon skeletons periodically
    if (m.boss && seen) {
      m.summonC++;
      const sBase = G.diff.lichSummonInterval || 4;
      const interval = m.enraged ? sBase - 1 : sBase;
      if (m.summonC % interval === 0 && G.monsters.filter(x => x.id === 'skeleton').length < (m.enraged ? 4 : 3)) {
        const spots = DIRS8.map(([dx, dy]) => ({ x: m.x + dx, y: m.y + dy }))
          .filter(s => G.map.walkable(s.x, s.y) && !monsterAt(s.x, s.y) && (s.x !== p.x || s.y !== p.y));
        if (spots.length) {
          const s = RNG.pick(spots);
          const sk = spawnMonster('skeleton', s.x, s.y);
          sk.awake = true;
          sk.xp = 0; // raised bones carry no glory
          spawnBurst(s.x, s.y, '#c77dff', 10, 70);
          addMsg('The Lich tears a skeleton from the earth!', 'm-bad');
          continue;
        }
      }
    }

    if (cheb(m.x, m.y, p.x, p.y) <= 1) {
      // casters back away from blades — but only while their bolt is ready; on cooldown they must brawl
      if (m.ranged && !m.boss && m.cd === 0 && RNG.chance(0.6)) {
        let best = null, bd = dist2(m.x, m.y, p.x, p.y);
        for (const [dx, dy] of DIRS8) {
          const nx = m.x + dx, ny = m.y + dy;
          if (!G.map.walkable(nx, ny) || monsterAt(nx, ny) || (nx === p.x && ny === p.y)) continue;
          if (!diagOpen(G.map, m.x, m.y, dx, dy)) continue;
          const dd = dist2(nx, ny, p.x, p.y);
          if (dd > bd) { bd = dd; best = [nx, ny]; }
        }
        if (best) { m.x = best[0]; m.y = best[1]; if (!monsterStepHazard(m)) continue; continue; }
      }
      // heavy bruisers often telegraph a crushing blow instead of swinging —
      // but never twice in a row after a whiff (punish window stays open)
      if (m.windupRest > 0) m.windupRest--;
      else if (m.heavy && RNG.chance(m.mini ? 0.5 : 0.6)) {
        m.windup = 1;
        m.windupX = p.x; m.windupY = p.y;
        if (m.mini) GrukVoice.say('windup');
        addMsg(m.mini ? 'GRUK RAISES THE AXE. THE AIR ITSELF FLINCHES.' : `${TheM(m)} rears back for a crushing blow!`, 'm-bad');
        continue;
      }
      // Chill Aura: foes beside you falter a quarter of the time
      if (hasBoon('b_chill') && RNG.chance(0.25)) {
        if (G.visible.has(m.x + ',' + m.y)) {
          addMsg(`${TheM(m)} falters in your chill aura.`, 'm-good');
          spawnFloater(m.x, m.y, 'faltered', '#bdf0ff');
        }
        continue;
      }
      const swings = m.elite === 'frenzied' && RNG.chance(0.25) ? 2 : 1;
      for (let s = 0; s < swings; s++) {
        if (RNG.chance(playerDodge())) {
          addMsg(`You twist away from ${theM(m)}'s strike!`, 'm-good');
          spawnFloater(p.x, p.y, 'dodge', '#a8f0c0');
          continue;
        }
        const dmg = Math.max(1, m.atk + RNG.int(-1, 1) - playerDef());
        addMsg(`${TheM(m)} hits you for ${dmg}.` + (s ? ' It strikes again!' : ''), 'm-combat');
        Sfx.hit();
        hurtPlayer(dmg, `${aM(m)}`);
        if (G.state !== 'PLAY') return;
        if (m.elite === 'venomous' || (m.venom && RNG.chance(0.35))) {
          p.poison = Math.min(10, p.poison + 4); // venom stacks — spider packs are a real threat
          addMsg('Venom burns in your veins!', 'm-bad');
          spawnFloater(p.x, p.y, 'POISONED', '#8fe05e');
        }
      }
      // Iron Thorns: melee attackers pay in kind
      if (hasBoon('b_thorns')) {
        m.hp -= 2; m.flashT = 1;
        spawnFloater(m.x, m.y, '2', '#c98a5e');
        if (m.hp <= 0) { killMonster(m); continue; }
      }
      continue;
    }

    // shaman: mend a wounded ally in line of sight instead of advancing
    if (m.healer) {
      const ally = G.monsters.filter(o => o !== m && o.hp < o.maxHp && dist2(o.x, o.y, m.x, m.y) <= 36
          && traceBeam(m.x, m.y, o.x, o.y).some(t => t.x === o.x && t.y === o.y))
        .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];
      if (ally) {
        ally.hp = Math.min(ally.maxHp, ally.hp + 4);
        if (G.visible.has(m.x + ',' + m.y) || G.visible.has(ally.x + ',' + ally.y)) {
          spawnFloater(ally.x, ally.y, '+4', '#5ec4a8');
          addMsg(`The shaman chants — the ${ally.name} knits back together!`, 'm-bad');
        }
        continue;
      }
    }

    // charger: when aligned with a clear lane, telegraph a dash for next turn
    if (m.charger && seen && m.cd === 0 && d >= 2 && d <= 6) {
      const adx = p.x - m.x, ady = p.y - m.y;
      if (adx === 0 || ady === 0 || Math.abs(adx) === Math.abs(ady)) {
        const sx = Math.sign(adx), sy = Math.sign(ady);
        const lane = [];
        let cx = m.x, cy = m.y, clear = true, sawPlayer = false;
        for (let s = 0; s < 7; s++) {
          if (!diagOpen(G.map, cx, cy, sx, sy)) { if (!sawPlayer) clear = false; break; }
          cx += sx; cy += sy;
          if (!G.map.inBounds(cx, cy) || !G.map.walkable(cx, cy)) break;
          if (cx === p.x && cy === p.y) { lane.push({ x: cx, y: cy }); sawPlayer = true; continue; }
          if (monsterAt(cx, cy)) { if (!sawPlayer) clear = false; break; }
          lane.push({ x: cx, y: cy });
        }
        if (clear && sawPlayer && lane.length >= 2) {
          m.lane = lane; m.laneDir = [sx, sy];
          m.cd = 4;
          addMsg(`${TheM(m)} paws the ground and lowers its tusks — it lines up a charge!`, 'm-bad');
          Sfx.gallopWarn();
          continue;
        }
      }
    }

    if (m.lobber && seen && d >= 2 && d <= 7 && m.cd === 0) {
      G.shells.push({ x: p.x, y: p.y, timer: 2, dmg: m.atk, color: m.color });
      m.cd = 3;
      Sfx.lob();
      addMsg(`${TheM(m)} hurls a sputtering shell in a high arc — it will fall where you stand!`, 'm-bad');
      continue;
    }
    // lobbers reposition to medium range while reloading; too close and they scatter
    if (m.lobber && m.cd > 0 && d < 2.5) {
      let best2 = null, bd2 = dist2(m.x, m.y, p.x, p.y);
      for (const [dx, dy] of DIRS8) {
        const nx = m.x + dx, ny = m.y + dy;
        if (!G.map.walkable(nx, ny) || monsterAt(nx, ny) || (nx === p.x && ny === p.y)) continue;
        if (!diagOpen(G.map, m.x, m.y, dx, dy)) continue;
        const dd = dist2(nx, ny, p.x, p.y);
        if (dd > bd2) { bd2 = dd; best2 = [nx, ny]; }
      }
      if (best2) { m.x = best2[0]; m.y = best2[1]; if (!monsterStepHazard(m)) continue; continue; }
    }

    if (m.ranged && seen && d <= (m.boss ? 8.5 : 5.5) && m.cd === 0
        && traceBeam(m.x, m.y, p.x, p.y).some(t => t.x === p.x && t.y === p.y)) {
      // the lich channels a soulrend beam at range — sidestep it or feed him
      if (m.boss && d >= 3 && (m.firstBeamDue || RNG.chance(0.5))) {
        const line = traceBeam(m.x, m.y, p.x, p.y);
        if (line.length) { // a blocked trace falls through to a plain bolt
          m.beam = line;
          m.firstBeamDue = false;
          addMsg('VYRAKHEL DRAWS YOUR DEATH IN VIOLET LIGHT — MOVE!', 'm-bad');
          Sfx.scroll();
          continue;
        }
      }
      spawnProjectile(m.x, m.y, p.x, p.y, {
        dmg: Math.max(1, m.atk - 1), color: m.boss ? '#c77dff' : m.color,
        speed: m.boss ? 3 : 2, drain: m.drain, src: m,
      });
      Sfx.bolt();
      if (m.variant === 'skullsplitter') GrukVoice.say('axeThrow');
      addMsg(m.variant === 'skullsplitter'
        ? 'GRUK HURLS A WHIRLING AXE — IT HOWLS THROUGH THE AIR!'
        : `${TheM(m)} hurls a bolt — it streaks toward you!`, 'm-bad');      m.cd = m.boss && m.enraged ? 1 : 2;
      if (G.state !== 'PLAY') return;
      continue;
    }

    // archers hold their ground while reloading — no suicidal charge into melee
    if (m.ranged && !m.boss && seen && m.cd > 0 && d >= 2.5) {
      if (G.visible.has(m.x + ',' + m.y) && RNG.chance(0.3)) spawnFloater(m.x, m.y, 'reloading', '#9aa0b8');
      continue;
    }

    if (m.erratic && RNG.chance(0.4) && cheb(m.x, m.y, p.x, p.y) > 1) { wander(m); if (!monsterStepHazard(m)) continue; continue; }

    // Gruk is leashed to his post: stray too far and he stomps back, letting
    // runners escape — but while he can SEE you, he commits to the kill
    // (standing 8 tiles out used to bounce him between leash and chase forever)
    if (m.mini && !seen && G.stairsPos && cheb(m.x, m.y, G.stairsPos.x, G.stairsPos.y) > 6) {
      const back = computeDistField(G.map, G.stairsPos.x, G.stairsPos.y, 60);
      let bb = null, bbd = back[G.map.idx(m.x, m.y)];
      if (bbd === -1) bbd = 9999;
      for (const [dx, dy] of DIRS8) {
        const nx = m.x + dx, ny = m.y + dy;
        if (!G.map.walkable(nx, ny) || monsterAt(nx, ny) || (nx === p.x && ny === p.y)) continue;
        if (!diagOpen(G.map, m.x, m.y, dx, dy)) continue;
        const fd = back[G.map.idx(nx, ny)];
        if (fd !== -1 && fd < bbd) { bbd = fd; bb = [nx, ny]; }
      }
      if (bb) {
        if (!m.leashed) { m.leashed = true; GrukVoice.say('leash'); }
        m.x = bb[0]; m.y = bb[1];
        if (!monsterStepHazard(m)) continue;
        continue;
      }
    } else if (m.mini) m.leashed = false;

    // step along the BFS distance field toward the player; among equally
    // advancing tiles prefer the least crowded so packs fan out and flank
    let cur = field[G.map.idx(m.x, m.y)];
    if (cur === -1) cur = 9999;
    let best = null, bestD = cur, bestCrowd = 99;
    for (const [dx, dy] of DIRS8) {
      const nx = m.x + dx, ny = m.y + dy;
      if (!G.map.walkable(nx, ny) || monsterAt(nx, ny) || (nx === p.x && ny === p.y)) continue;
      if (!diagOpen(G.map, m.x, m.y, dx, dy)) continue;
      const fd = field[G.map.idx(nx, ny)];
      if (fd === -1 || fd >= cur) continue;
      const crowd = G.monsters.reduce((n, o) => n + (o !== m && o.hp > 0 && cheb(o.x, o.y, nx, ny) <= 1 ? 1 : 0), 0);
      if (fd < bestD || (fd === bestD && crowd < bestCrowd)) { bestD = fd; bestCrowd = crowd; best = [nx, ny]; }
    }
    if (best) { m.x = best[0]; m.y = best[1]; if (!monsterStepHazard(m)) continue; }
    else wander(m);
  }
}

/* coarse-pointer detection: phones get touch-flavored copy and affordances */
const IS_TOUCH = typeof window !== 'undefined' && window.matchMedia
  && (window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 760);

/* grammar helpers: named foes (bosses, minis) carry no article */
function anItem(name) { return (/^[aeiou]/i.test(name) ? 'an ' : 'a ') + name; }
function TheM(m) { return (m.boss || m.mini) ? m.name : 'The ' + m.name; }
function theM(m) { return (m.boss || m.mini) ? m.name : 'the ' + m.name; }
function aM(m) { return (m.boss || m.mini) ? m.name : anItem(m.name); }

/* trace a line from (x1,y1) through (x2,y2) extended to the first wall (max 12 tiles) */
function traceBeam(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.max(Math.abs(dx), Math.abs(dy)) || 1;
  const sx = dx / len, sy = dy / len;
  const tiles = [];
  const seen = new Set();
  for (let step = 1; step <= 24 && tiles.length < 12; step++) {
    const fx = x1 + sx * step * 0.5, fy = y1 + sy * step * 0.5;
    const tx = Math.round(fx), ty = Math.round(fy);
    const key = tx + ',' + ty;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!G.map.inBounds(tx, ty) || G.map.opaque(tx, ty)) break;
    if (tx === x1 && ty === y1) continue;
    tiles.push({ x: tx, y: ty });
  }
  return tiles;
}

function wander(m) {
  const [dx, dy] = RNG.pick(DIRS8);
  const nx = m.x + dx, ny = m.y + dy;
  if (!diagOpen(G.map, m.x, m.y, dx, dy)) return;
  if (G.map.walkable(nx, ny) && !monsterAt(nx, ny) && (nx !== G.player.x || ny !== G.player.y)) {
    m.x = nx; m.y = ny;
  }
}

/* ---------- travel (click-to-move & auto-explore) ---------- */
let travelPath = null, travelTimer = null;

function cancelTravel() {
  travelPath = null;
  if (travelTimer) { clearInterval(travelTimer); travelTimer = null; }
}

function findPath(sx, sy, tx, ty, avoidTraps, allowWares) {
  const map = G.map;
  const passable = (x, y) => {
    const i = map.idx(x, y);
    if (!map.explored[i] || !tileWalkable(map.tiles[i])) return false;
    if (avoidTraps && map.tiles[i] === T.TRAP && map.trapSeen[i] && !(x === tx && y === ty)) return false;
    // never path through shop wares unless they ARE the destination — walking buys them
    if (!allowWares && G.shop.some(s => s.x === x && s.y === y) && !(x === tx && y === ty)) return false;
    return true;
  };
  if (!passable(tx, ty)) return null;
  const field = new Int16Array(map.w * map.h).fill(-1);
  const qx = [tx], qy = [ty];
  field[map.idx(tx, ty)] = 0;
  for (let h = 0; h < qx.length; h++) {
    const x = qx[h], y = qy[h];
    const dcur = field[map.idx(x, y)];
    for (const [dx, dy] of DIRS8) {
      const nx = x + dx, ny = y + dy;
      if (!map.inBounds(nx, ny) || !passable(nx, ny)) continue;
      if (!diagOpen(map, x, y, dx, dy)) continue;
      const i = map.idx(nx, ny);
      if (field[i] !== -1) continue;
      field[i] = dcur + 1;
      qx.push(nx); qy.push(ny);
    }
  }
  if (field[map.idx(sx, sy)] === -1) return null;
  const path = [];
  let cx = sx, cy = sy;
  let guard = 0;
  while ((cx !== tx || cy !== ty) && guard++ < 500) {
    let bn = null, bd = field[map.idx(cx, cy)];
    for (const [dx, dy] of DIRS8) {
      const nx = cx + dx, ny = cy + dy;
      if (!map.inBounds(nx, ny)) continue;
      if (!diagOpen(map, cx, cy, dx, dy)) continue;
      const fd = field[map.idx(nx, ny)];
      if (fd !== -1 && fd < bd) { bd = fd; bn = [nx, ny]; }
    }
    if (!bn) return null;
    cx = bn[0]; cy = bn[1];
    path.push({ x: cx, y: cy });
  }
  return path;
}

const watcher = () => G.monsters
  .filter(m => m.awake && m.frozen === 0 && G.visible.has(m.x + ',' + m.y)
    && dist2(m.x, m.y, G.player.x, G.player.y) <= 36) // only nearby watchers gate travel — veterans' top time-tax
  .sort((a, b) => dist2(a.x, a.y, G.player.x, G.player.y) - dist2(b.x, b.y, G.player.x, G.player.y))[0];
const dangerVisible = () => !!watcher();
const compass = (x, y) => {
  const dx = x - G.player.x, dy = y - G.player.y;
  const ns = dy < 0 ? 'north' : dy > 0 ? 'south' : '';
  const ew = dx < 0 ? 'west' : dx > 0 ? 'east' : '';
  return (ns + ew) || 'right here';
};

/* a watcher blocks travel — but a second ask (within 8 turns) pushes one
   step toward it, and an adjacent watcher just gets hit. Shared by
   auto-explore, travel, and descend so no verb ever deadlocks (mobile
   playtest: ▼ refused in a loop while ◎ knew how to advance). */
function advanceOnWatcher(w1) {
  const p = G.player;
  if (cheb(w1.x, w1.y, p.x, p.y) <= 1) {
    attackMonster(w1);
    if (G.state === 'PLAY') afterPlayerTurn();
    return true;
  }
  if (G.lastWatchRefusal != null && G.turn - G.lastWatchRefusal <= 8) {
    const f = computeDistField(G.map, w1.x, w1.y, 60);
    let best = null, bd = f[G.map.idx(p.x, p.y)];
    if (bd !== -1) {
      for (const [dx, dy] of DIRS8) {
        const nx = p.x + dx, ny = p.y + dy;
        if (!G.map.inBounds(nx, ny) || monsterAt(nx, ny)) continue;
        if (!diagOpen(G.map, p.x, p.y, dx, dy)) continue;
        const fd = f[G.map.idx(nx, ny)];
        if (fd !== -1 && fd < bd) { bd = fd; best = [dx, dy]; }
      }
    }
    if (best) { addMsg(`You advance on ${theM(w1)}.`, 'm-dim'); tryMove(best[0], best[1]); return true; }
    addMsg(`No clear path to ${theM(w1)} — step around by hand.`, 'm-dim');
    return true;
  }
  G.lastWatchRefusal = G.turn;
  const again = (typeof MOBILE_UI !== 'undefined' && MOBILE_UI) ? 'Tap again' : 'Ask again';
  addMsg(`Not while ${theM(w1)} watches — ${compass(w1.x, w1.y)} of you. ${again} to advance on it.`, 'm-dim');
  return true;
}

function startTravelTo(tx, ty) {
  if (G.state !== 'PLAY') return;
  const w0 = watcher();
  if (w0) { advanceOnWatcher(w0); return; }
  if (!G.map.inBounds(tx, ty)) return;
  // chests, shrines, vaults, the gilded corpse: walk to a tile beside them
  const tt = G.map.get(tx, ty);
  if (tt === T.CHEST || tt === T.GOLDCHEST || tt === T.SHRINE || tt === T.GILDED) {
    let best = null, bd = 1e9;
    for (const [dx, dy] of DIRS8) {
      const ax = tx + dx, ay = ty + dy;
      if (!G.map.inBounds(ax, ay) || !G.map.walkable(ax, ay)) continue;
      if (!G.map.explored[G.map.idx(ax, ay)]) continue;
      const d = dist2(ax, ay, G.player.x, G.player.y);
      if (d < bd) { bd = d; best = [ax, ay]; }
    }
    if (best) {
      if (best[0] === G.player.x && best[1] === G.player.y) { tryMove(tx - best[0], ty - best[1]); return; }
      tx = best[0]; ty = best[1];
    }
  }
  let path = findPath(G.player.x, G.player.y, tx, ty, true) || findPath(G.player.x, G.player.y, tx, ty, false);
  if (!path || !path.length) path = findPath(G.player.x, G.player.y, tx, ty, false, true); // last resort: cross the merchant's carpet
  if (!path || !path.length) { addMsg('No path there — the way is blocked.', 'm-dim'); return; }
  cancelTravel();
  travelPath = path;
  travelTimer = setInterval(stepTravel, 95);
  stepTravel();
}

function stepTravel() {
  if (G.state !== 'PLAY' || !travelPath || !travelPath.length) { cancelTravel(); return; }
  if (dangerVisible()) {
    cancelTravel();
    addMsg('Something stirs — you halt.', 'm-dim');
    return;
  }
  const hp0 = G.player.hp;
  const poisonTick = G.player.poison > 0 ? 1 : 0; // poison's 1/turn drip shouldn't halt travel
  const next = travelPath.shift();
  const wasWare = G.shop.some(s => s.x === next.x && s.y === next.y) && !(travelPath.length === 0);
  tryMove(next.x - G.player.x, next.y - G.player.y);
  if (wasWare && G.player.x === next.x && G.player.y === next.y) {
    cancelTravel(); // you stopped on the merchant's carpet — buying is YOUR call
    return;
  }
  if (G.state !== 'PLAY' || G.player.x !== next.x || G.player.y !== next.y || G.player.hp < hp0 - poisonTick) { cancelTravel(); return; }
  if (travelPath && !travelPath.length) cancelTravel();
}

function autoExplore() {
  if (G.state !== 'PLAY') return;
  const map = G.map, p = G.player;
  // a watcher blocks travel — but asking again pushes one step toward it
  const w1 = watcher();
  if (w1) { advanceOnWatcher(w1); return; }
  G.lastWatchRefusal = null;
  // BFS over explored walkable tiles to the nearest frontier (tile with an unexplored neighbor)
  const field = new Int16Array(map.w * map.h).fill(-1);
  const qx = [p.x], qy = [p.y];
  field[map.idx(p.x, p.y)] = 0;
  let target = null;
  for (let h = 0; h < qx.length && !target; h++) {
    const x = qx[h], y = qy[h];
    for (const [dx, dy] of DIRS8) {
      const nx = x + dx, ny = y + dy;
      if (!map.inBounds(nx, ny)) continue;
      const i = map.idx(nx, ny);
      if (!diagOpen(map, x, y, dx, dy)) continue;
      if (!map.fovSeen[i]) { if (x !== p.x || y !== p.y) target = { x, y }; continue; } // frontier = not seen by EYE; magic reveals still get visited
      if (!tileWalkable(map.tiles[i]) || field[i] !== -1) continue;
      if (map.tiles[i] === T.TRAP && map.trapSeen[i]) continue;
      field[i] = field[map.idx(x, y)] + 1;
      qx.push(nx); qy.push(ny);
    }
  }
  if (!target) {
    // exploration done — fetch seen ground loot first. Unreachable or
    // unpickupable targets are blacklisted after one failure, or the fetcher
    // wedges O for the rest of the floor (vet2 audit, bugs 2-3)
    {
      if (!G.fetchSkip) G.fetchSkip = {};
      const packFull = p.inventory.length >= 10;
      let it2 = null, id2 = 1e9;
      for (const it of G.items) {
        const k2 = it.x + ',' + it.y;
        if (G.fetchSkip[k2]) continue;
        if (packFull && !it.gold) continue; // can't carry it anyway
        const i2 = map.idx(it.x, it.y);
        if (!map.fovSeen[i2] || !tileWalkable(map.tiles[i2])) continue;
        const d2i = dist2(it.x, it.y, p.x, p.y);
        if (d2i < id2) { id2 = d2i; it2 = it; }
      }
      if (it2) {
        const k2 = it2.x + ',' + it2.y;
        const reachable = findPath(p.x, p.y, it2.x, it2.y, true) || findPath(p.x, p.y, it2.x, it2.y, false);
        if (!reachable || !reachable.length) {
          G.fetchSkip[k2] = 1; // sealed pocket — stop trying, let the floor finish
          autoExplore();
          return;
        }
        addMsg(it2.gold ? 'Coin still glints on the floor — you go to claim it.' : 'Something left behind — you go back for it.', 'm-dim');
        startTravelTo(it2.x, it2.y);
        return;
      }
    }
    if (p.keys > 0) {
      for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
        if (map.explored[map.idx(x, y)] && map.tiles[map.idx(x, y)] === T.GOLDCHEST) {
          addMsg('Your key itches — you make for the sealed vault.', 'm-gold');
          startTravelTo(x, y);
          return;
        }
      }
    }
    let chest = null, cd2 = 1e9;
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      const i = map.idx(x, y);
      if (!map.explored[i] || map.tiles[i] !== T.CHEST) continue;
      const d = dist2(x, y, p.x, p.y);
      if (d < cd2) { cd2 = d; chest = { x, y }; }
    }
    if (chest) { addMsg('A sealed chest still waits — you make for it.', 'm-dim'); startTravelTo(chest.x, chest.y); return; }
    if (map.hasGoldChest && Array.from(map.tiles).some(t => t === T.GOLDCHEST))
      addMsg('Only the sealed vault remains — somewhere on this floor, an elite carries its key.', 'm-dim');
    else addMsg('No unexplored paths remain on this floor.', 'm-dim');
    return;
  }
  startTravelTo(target.x, target.y);
}

/* ---------- UI ---------- */
function buildSpellPanel() {
  const panel = $('spell-panel');
  panel.style.display = 'block';
  $('spell-title').textContent = G.classId === 'mage' ? 'SPELLBOOK' : 'ABILITIES';
  const list = $('spell-list');
  list.innerHTML = '';
  const addRow = (hotkey, name, right, title, onClick, id) => {
    const btn = document.createElement('button');
    btn.className = 'spell-row';
    if (id) btn.id = id;
    btn.innerHTML = `<span class="hotkey">${hotkey}</span><span>${name}</span><span class="cost">${right}</span>`;
    btn.title = title;
    btn.addEventListener('click', ev => {
      ev.currentTarget.blur();
      Sfx.ensure(); Music.start();
      if (onClick) onClick();
    });
    list.appendChild(btn);
  };
  if (G.classId === 'mage') {
    SPELLS.forEach((sp, i) =>
      addRow(`[${sp.key}]`, sp.name, `${sp.cost}◆`, sp.desc, () => castSpell(i), 'spell-' + i));
  } else if (G.classId === 'warrior') {
    addRow('[V]', 'Cleave', 'ready', 'strike every adjacent foe in one sweep', () => castCleave(), 'cleave-row');
    addRow('[B]', 'Shield Charge', 'ready', 'dash up to 3 tiles along a clear line into a foe and strike at +50%', () => castCharge(), 'charge-row');
    addRow('[G]', 'Bulwark', 'ready', 'plant your shield: until your next turn every hit is turned aside to 1 damage', () => castBulwark(), 'bulwark-row');
  } else {
    addRow('[V]', 'Shadow Dash', 'ready', 'melt to a tile beside a foe (2-3 tiles); the unaware eat your blade on arrival', () => castShadowDash(), 'dash-row');
    addRow('[B]', 'Vault', 'ready', 'leap clean over an adjacent foe and land behind it — the cornered rogue\'s way out', () => castVault(), 'vault-row');
    addRow('—', 'Backstab', '×3', 'passive: 3× damage against foes that are unaware, stirring or frozen', null);
    addRow('—', 'Shadowstep', '·', 'passive: monsters notice you 2 tiles later; you sense hidden traps', null);
  }
}

function updateUI() {
  const p = G.player;
  if (!p) return;
  $('hero-name').textContent = 'THE ' + G.classDef.name.toUpperCase();
  $('hp-text').textContent = `${p.hp} / ${p.maxHp}`;
  $('hp-fill').style.width = (100 * p.hp / p.maxHp) + '%';
  $('atk-text').textContent = playerAtk();
  $('def-text').textContent = playerDef();
  $('depth-text').textContent = G.depth + ' / ' + FINAL_DEPTH;
  $('gold-text').textContent = p.gold;
  if (p.maxMana > 0) {
    $('mana-row').style.display = 'block';
    $('mana-text').textContent = `${p.mana} / ${p.maxMana}`;
    $('mana-fill').style.width = (100 * p.mana / p.maxMana) + '%';
    SPELLS.forEach((sp, i) => {
      const el = $('spell-' + i);
      if (el) el.classList.toggle('cant', p.mana < sp.cost);
    });
  } else {
    $('mana-row').style.display = 'none';
  }
  const cleaveRow = $('cleave-row');
  if (cleaveRow) {
    cleaveRow.classList.toggle('cant', p.cleaveCd > 0);
    cleaveRow.querySelector('.cost').textContent = p.cleaveCd > 0 ? p.cleaveCd + 't' : 'ready';
  }
  const chargeRow = $('charge-row');
  if (chargeRow) {
    chargeRow.classList.toggle('cant', p.chargeCd > 0);
    chargeRow.querySelector('.cost').textContent = p.chargeCd > 0 ? p.chargeCd + 't' : 'ready';
  }
  const dashRow = $('dash-row');
  if (dashRow) {
    dashRow.classList.toggle('cant', p.dashCd > 0);
    dashRow.querySelector('.cost').textContent = p.dashCd > 0 ? p.dashCd + 't' : 'ready';
  }
  const bulwarkRow = $('bulwark-row');
  if (bulwarkRow) {
    bulwarkRow.classList.toggle('cant', p.guardCd > 0);
    bulwarkRow.querySelector('.cost').textContent = p.guardCd > 0 ? p.guardCd + 't' : 'ready';
  }
  const vaultRow = $('vault-row');
  if (vaultRow) {
    vaultRow.classList.toggle('cant', p.vaultCd > 0);
    vaultRow.querySelector('.cost').textContent = p.vaultCd > 0 ? p.vaultCd + 't' : 'ready';
  }
  const statusBits = [];
  if (p.poison > 0) statusBits.push(`<span class="st-poison">☠ poisoned (${p.poison})</span>`);
  if (p.keys > 0) statusBits.push(`<span style="color:var(--gold)">⚿ key ×${p.keys}</span>`);
  if (G.depth !== FINAL_DEPTH && G.floorTurns > G.diff.dreadAt - dreadShift()) statusBits.push('<span style="color:var(--red)">⌛ the dark hunts you</span>');
  else if (G.depth !== FINAL_DEPTH && G.floorTurns > G.diff.dreadAt - dreadShift() - 30) statusBits.push('<span style="color:#c98a5e">⌛ the dark stirs…</span>');
  if (G.daily) statusBits.push('<span style="color:var(--purple)">◆ daily</span>');
  if (hasBoon('b_momentum') && p.momentum > 0) statusBits.push('<span style="color:var(--gold)">⚔ momentum +' + p.momentum + '</span>');
  if (p.bulwarkT > 0) statusBits.push('<span style="color:var(--blue)">🛡 bulwark (' + p.bulwarkT + ')</span>');
  if (p.guardT > 0) statusBits.push('<span style="color:var(--blue)">🛡 SHIELD PLANTED</span>');
  $('status-line').innerHTML = statusBits.join(' &nbsp; ');
  Music.setTension(G.state === 'PLAY' && dangerVisible());
  $('weapon-text').textContent = p.weapon ? `${ITEMS[p.weapon].name} (+${ITEMS[p.weapon].bonus})` : 'bare fists';
  $('armor-text').textContent = p.armor ? `${ITEMS[p.armor].name} (+${ITEMS[p.armor].bonus})` : 'tattered rags';
  $('ring-text').textContent = p.ring ? ITEMS[p.ring].name : 'bare finger';
  $('inv-count').textContent = `${p.inventory.length}/10`;

  const list = $('inv-list');
  list.innerHTML = '';
  if (!p.inventory.length) {
    const div = document.createElement('div');
    div.className = 'inv-empty';
    div.textContent = 'Nothing but lint.';
    list.appendChild(div);
  }
  p.inventory.forEach((entry, i) => {
    const def = ITEMS[entry.id];
    const btn = document.createElement('button');
    btn.className = 'inv-item';
    btn.title = def.effect || '';
    btn.innerHTML =
      `<span class="hotkey">[${(i + 1) % 10}]</span>` +
      `<span class="glyph" style="color:${def.color}">${def.glyph}</span>` +
      `<span>${def.name}${def.bonus ? ' +' + def.bonus : ''}</span>` +
      (entry.count > 1 ? `<span class="count">×${entry.count}</span>` : '');
    btn.addEventListener('click', ev => { ev.currentTarget.blur(); Sfx.ensure(); Music.start(); useItem(i); });
    btn.addEventListener('contextmenu', ev => { ev.preventDefault(); ev.currentTarget.blur(); dropItem(i); });
    if (IS_TOUCH) {
      // iOS never fires contextmenu — give every row an explicit drop chip
      const dc = document.createElement('span');
      dc.textContent = '✕';
      dc.style.cssText = 'margin-left:auto;padding:2px 8px;color:#9a91b8;border:1px solid rgba(154,145,184,.35);border-radius:6px;font-size:11px;';
      dc.addEventListener('click', ev => { ev.stopPropagation(); dropItem(i); });
      btn.appendChild(dc);
    }
    list.appendChild(btn);
  });
  const ob = $('owned-boons');
  if (ob) {
    const ids = Object.keys(p.boons || {});
    ob.innerHTML = ids.length ? ids.map(id => `<span class="boon-chip" title="${BOONS[id].desc}">${BOONS[id].name}</span>`).join('') : '';
  }
  drawMinimap();
}

function showBestLine() {
  try {
    const bits = [];
    const best = JSON.parse(localStorage.getItem('arcaneDepthsBest') || 'null');
    if (best) bits.push(`Best run — ${best.cls || 'hero'} · score ${best.score} · floor ${best.depth}${best.won ? ' · LICH SLAIN' : ''}`);
    const daily = JSON.parse(localStorage.getItem('arcaneDaily') || 'null');
    if (daily && daily.date === dailyKey()) bits.push(`Today's daily — ${daily.cls} · score ${daily.score}${daily.won ? ' · WON' : ''}`);
    $('best-line').textContent = bits.join('   ·   ');
  } catch (e) { /* ignore */ }
}
showBestLine();

function backToTitle() {
  cancelTravel();
  G.state = 'TITLE';
  let pref = 'standard';
  try { pref = localStorage.getItem('arcaneDiff') || 'standard'; } catch (e) { /* ignore */ }
  setDifficulty(pref);
  showBestLine();
  updateContinueLine();
  $('death-screen').classList.add('hidden');
  $('win-screen').classList.add('hidden');
  $('title-screen').classList.remove('hidden');
  // the sidebar kept showing the dead run's gear under the title screen
  // (obvious on the stacked mobile layout) — scrub it back to a blank slate
  try {
    const inv = $('inv-list'); if (inv) inv.innerHTML = '';
    const sp = $('spell-panel'); if (sp) sp.style.display = 'none';
    const hf = $('hp-fill'); if (hf) hf.style.width = '0%';
    const mf = $('mana-fill'); if (mf) mf.style.width = '0%';
    const st = $('status-line'); if (st) st.innerHTML = '';
    const ob = $('owned-boons'); if (ob) ob.innerHTML = '';
    for (const [id, txt] of [['weapon-text', 'bare fists'], ['armor-text', 'tattered rags'], ['ring-text', 'bare finger']]) {
      const el = $(id); if (el) el.textContent = txt;
    }
    for (const [id, txt] of [['atk-text', '—'], ['def-text', '—'], ['depth-text', '—'], ['gold-text', '—'], ['hp-text', ''], ['mana-text', '']]) {
      const el = $(id); if (el) el.textContent = txt;
    }
    if (typeof mmCtx !== 'undefined' && mmCtx) mmCtx.clearRect(0, 0, mmCanvas.width, mmCanvas.height);
  } catch (e) { /* cosmetic only */ }
}

/* ---------- options (volume, shake) ---------- */
const IS_DESKTOP = navigator.userAgent.includes('Electron');
const IS_SIM = navigator.userAgent === 'NodeSim';
const OPTS = { music: 50, sfx: 80, shake: true };
function loadOpts() {
  try { Object.assign(OPTS, JSON.parse(localStorage.getItem('arcaneOpts') || '{}')); } catch (e) { /* ignore */ }
  applyOpts();
}
function applyOpts() {
  Music.setVolume(OPTS.music / 100);
  Sfx.vol = OPTS.sfx / 100;
  FX.shakeEnabled = !!OPTS.shake;
  $('opt-music').value = OPTS.music;
  $('opt-sfx').value = OPTS.sfx;
  $('opt-shake').checked = !!OPTS.shake;
  try { localStorage.setItem('arcaneOpts', JSON.stringify(OPTS)); } catch (e) { /* ignore */ }
}
$('opt-music').addEventListener('input', ev => { OPTS.music = +ev.target.value; applyOpts(); });
$('opt-sfx').addEventListener('input', ev => { OPTS.sfx = +ev.target.value; applyOpts(); Sfx.ensure(); Sfx.pickup(); });
$('opt-shake').addEventListener('change', ev => { OPTS.shake = ev.target.checked; applyOpts(); });
$('btn-fullscreen').addEventListener('click', ev => {
  ev.currentTarget.blur();
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen();
});
loadOpts();
$('cutscene').addEventListener('click', () => skipCutsceneLine());

/* ---------- pause ---------- */
function pauseGame() {
  if (G.state !== 'PLAY') return;
  cancelTravel();
  G.state = 'PAUSED';
  $('pause-screen').classList.remove('hidden');
}
function resumeGame() {
  if (G.state !== 'PAUSED') return;
  G.state = 'PLAY';
  $('pause-screen').classList.add('hidden');
}
$('btn-resume').addEventListener('click', resumeGame);
$('btn-abandon').addEventListener('click', () => {
  $('pause-screen').classList.add('hidden');
  G.state = 'PLAY'; // restore so saveBest sees a live run
  saveBest();
  clearSave();
  backToTitle();
});
if (IS_DESKTOP) {
  const q = $('btn-quit');
  q.classList.remove('hidden');
  q.addEventListener('click', () => window.close());
}

/* ---------- mid-run save: closing the game must not cost the run ---------- */
const SAVE_KEY = 'arcaneRun';
function saveRun() {
  if (G.state !== 'PLAY') return;
  try {
    const m = G.map;
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: 1, rngS: RNG.s, diffId: G.diffId, daily: G.daily, classId: G.classId,
      depth: G.depth, turn: G.turn, floorTurns: G.floorTurns, floorDmg: G.floorDmg,
      clockSpawns: G.clockSpawns, kills: G.kills, killsBy: G.killsBy,
      goldEarned: G.goldEarned, bonusScore: G.bonusScore, potionsDrunk: G.potionsDrunk,
      purchases: G.purchases, shrineArmed: G.shrineArmed,
      player: G.player, monsters: G.monsters, items: G.items, shop: G.shop, decals: G.decals,
      lichSaid: G.lichSaid, echo: G.echo, darkNext: !!G.darkNext, dailyBase: G.dailyBase,
      projectiles: G.projectiles.map(pr => ({ fx: pr.fx, fy: pr.fy, dx: pr.dx, dy: pr.dy,
        speed: pr.speed, dmg: pr.dmg, color: pr.color, fromPlayer: !!pr.fromPlayer, drain: !!pr.drain })),
      shells: G.shells, gildedWarned: G.gildedWarned || {}, wareWarn: G.wareWarn || {}, shopSeen: !!G.shopSeen, darkUsed: !!G.darkUsed,
      map: {
        w: m.w, h: m.h, depth: m.depth,
        tiles: Array.from(m.tiles), explored: Array.from(m.explored), fovSeen: Array.from(m.fovSeen),
        trapSeen: Array.from(m.trapSeen), light: Array.from(m.light),
        rooms: m.rooms, startRoom: m.startRoom, endRoom: m.endRoom,
        stairsPos: m.stairsPos, hasGoldChest: m.hasGoldChest, theme: m.theme,
      },
    }));
  } catch (e) { /* storage full/unavailable — run continues unsaved */ }
}
function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
}
function peekSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { return null; }
}
function loadRun() {
  const s = peekSave();
  if (!s || s.v !== 1 || !CLASSES[s.classId]) return false;
  cancelTravel();
  setDifficulty(s.diffId);
  RNG.s = s.rngS >>> 0;
  G.daily = !!s.daily;
  G.classId = s.classId;
  G.classDef = CLASSES[s.classId];
  G.depth = s.depth; G.turn = s.turn; G.floorTurns = s.floorTurns; G.floorDmg = s.floorDmg || 0;
  G.clockSpawns = s.clockSpawns || 0; G.kills = s.kills;
  G.killsBy = s.killsBy || {}; G.goldEarned = s.goldEarned || 0; G.bonusScore = s.bonusScore || 0;
  G.potionsDrunk = s.potionsDrunk || 0; G.purchases = s.purchases || 0;
  G.shrineArmed = s.shrineArmed || {};
  G.lichSaid = s.lichSaid || {}; G.echo = s.echo || null; G.darkNext = !!s.darkNext; G.corpses = [];
  G.dailyBase = s.dailyBase != null ? s.dailyBase : null;
  G.projectiles = (s.projectiles || []).map(pr => ({ ...pr, src: null }));
  G.shells = s.shells || [];
  G.gildedWarned = s.gildedWarned || {};
  G.wareWarn = s.wareWarn || {};
  G.shopSeen = !!s.shopSeen;
  G.darkUsed = !!s.darkUsed;
  G.player = s.player; G.monsters = s.monsters; G.items = s.items;
  G.shop = s.shop || []; G.decals = s.decals || [];
  const m = new GameMap(s.map.depth);
  m.tiles.set(s.map.tiles); m.explored.set(s.map.explored);
  m.fovSeen.set(s.map.fovSeen || s.map.explored); // older saves: eyes saw whatever was explored
  m.trapSeen.set(s.map.trapSeen); m.light.set(s.map.light);
  m.rooms = s.map.rooms; m.startRoom = s.map.startRoom; m.endRoom = s.map.endRoom;
  m.stairsPos = s.map.stairsPos; m.hasGoldChest = s.map.hasGoldChest;
  m.theme = s.map.theme || { w: 1 };
  G.map = m;
  G.stairsPos = m.stairsPos;
  G.state = 'PLAY';
  $('log').innerHTML = '';
  $('title-screen').classList.add('hidden');
  $('death-screen').classList.add('hidden');
  $('win-screen').classList.add('hidden');
  buildSpellPanel();
  recomputeFOV();
  updateUI();
  if (window.GuruTelemetry) GuruTelemetry.runResume(
    { class_id: G.classId, difficulty: G.diffId, daily: G.daily },
    { depth: G.depth, turn: G.turn }
  );
  addMsg(`You shake off the dark dream and press on — floor ${G.depth}.`, 'm-magic');
  return true;
}
function updateContinueLine() {
  const s = peekSave();
  const el = $('continue-line');
  if (s && CLASSES[s.classId]) {
    el.classList.remove('hidden');
    el.textContent = `[C] continue your run — ${CLASSES[s.classId].name.toLowerCase()}, floor ${s.depth}`;
  } else el.classList.add('hidden');
}

/* ---------- light cutscenes: a still, a few lines, the Lich's voice ---------- */
const CUTSCENES = {
  intro: {
    img: 'title-bg.jpg',
    lines: [
      'The depths were sealed for a reason.',
      { text: '“SIX FLOORS DOWN, LITTLE ONE. I HAVE BEEN SO PATIENT.”', lich: true },
      'Someone must go down.',
    ],
  },
  floor6: {
    img: 'cut-lich.jpg',
    lines: [
      'The last stair ends in violet light.',
      { text: '“COME IN. I HAVE WORN YOUR DEATHS LIKE RINGS, AND I HAVE FINGERS LEFT.”', lich: true },
    ],
  },
  victory: {
    img: 'cut-victory.jpg',
    lines: [
      'The phylactery cracks. Six floors of darkness exhale at once.',
      { text: '“…WARM. I HAD FORGOTTEN… WARM.”', lich: true },
      'Light returns to the depths. Walk up slowly. You earned the climb.',
    ],
  },
};

let cutscene = null; // {key, lineIdx, typing, done, onDone}
function showCutscene(key, onDone) {
  const def = CUTSCENES[key];
  if (!def || IS_SIM) { if (onDone) onDone(); return; }
  cutscene = { def, lineIdx: -1, onDone, prevState: G.state };
  G.state = 'CUTSCENE';
  cancelTravel();
  const el = $('cutscene');
  $('cut-image').style.backgroundImage = `url(${def.img})`;
  $('cut-text').innerHTML = '';
  el.classList.remove('hidden');
  requestAnimationFrame(() => el.classList.add('lit'));
  advanceCutscene();
}
function advanceCutscene() {
  if (!cutscene) return;
  cutscene.lineIdx++;
  if (cutscene.lineIdx >= cutscene.def.lines.length) {
    const done = cutscene.onDone;
    $('cutscene').classList.add('hidden');
    $('cutscene').classList.remove('lit');
    G.state = cutscene.prevState === 'CUTSCENE' ? 'PLAY' : cutscene.prevState;
    cutscene = null;
    if (done) done();
    return;
  }
  const raw = cutscene.def.lines[cutscene.lineIdx];
  const line = typeof raw === 'string' ? { text: raw } : raw;
  const target = $('cut-text');
  target.innerHTML = '';
  const span = document.createElement('span');
  if (line.lich) span.className = 'lich-line';
  target.appendChild(span);
  if (line.lich) Sfx.whisper();
  // typewriter
  let i = 0;
  const tick = () => {
    if (!cutscene || span.parentNode !== target) return;
    span.textContent = line.text.slice(0, ++i);
    if (i < line.text.length) cutscene.typeTimer = setTimeout(tick, line.lich ? 34 : 24);
  };
  tick();
}
function skipCutsceneLine() {
  if (!cutscene) return;
  const raw = cutscene.def.lines[cutscene.lineIdx];
  const line = typeof raw === 'string' ? { text: raw } : raw;
  const span = $('cut-text').firstChild;
  if (span && span.textContent.length < line.text.length) {
    if (cutscene.typeTimer) clearTimeout(cutscene.typeTimer);
    span.textContent = line.text; // finish the line first
  } else {
    advanceCutscene();
  }
}

/* ---------- title backdrop (rendered in Blender, optional) ---------- */
(() => {
  const img = new Image();
  img.onload = () => {
    const ts = $('title-screen');
    ts.classList.add('has-art');
    ts.style.backgroundImage = 'linear-gradient(rgba(5,5,12,.66), rgba(5,5,12,.82)), url(title-bg.jpg)';
  };
  img.src = 'title-bg.jpg';
})();

/* ---------- title screen embers ---------- */
const tfx = $('title-fx');
const tctx = tfx.getContext('2d');
const embers = [];
function titleFrame() {
  if (G.state === 'TITLE' && !$('title-screen').classList.contains('hidden')) {
    if (tfx.width !== tfx.clientWidth || tfx.height !== tfx.clientHeight) {
      tfx.width = tfx.clientWidth || VIEW_W;
      tfx.height = tfx.clientHeight || VIEW_H;
    }
    tctx.clearRect(0, 0, tfx.width, tfx.height);
    if (embers.length < 36 && CRNG.chance(0.3))
      embers.push({
        x: CRNG.next() * tfx.width, y: tfx.height + 6,
        vy: 12 + CRNG.next() * 26, sway: CRNG.next() * 6.28,
        size: 1 + CRNG.next() * 2.2, life: 1,
        color: CRNG.chance(0.25) ? '199,164,255' : '255,170,80',
      });
    for (let i = embers.length - 1; i >= 0; i--) {
      const e = embers[i];
      e.y -= e.vy / 60;
      e.x += Math.sin(e.sway += 0.02) * 0.4;
      e.life -= 0.0022;
      if (e.life <= 0 || e.y < -8) { embers.splice(i, 1); continue; }
      tctx.fillStyle = `rgba(${e.color},${0.5 * e.life})`;
      tctx.fillRect(e.x, e.y, e.size, e.size);
    }
  }
  requestAnimationFrame(titleFrame);
}
requestAnimationFrame(titleFrame);

/* ---------- fit layout to window ---------- */
function fitView() {
  const wrap = $('wrap');
  if (window.innerWidth <= 760) { wrap.style.transform = 'none'; return; } // phones: the stacked CSS layout takes over
  const W = 1272, H = 814; // natural size of #wrap content
  const s = Math.min((window.innerWidth - 10) / W, (window.innerHeight - 10) / H);
  wrap.style.transform = `scale(${s})`;
}
window.addEventListener('resize', fitView);
fitView();

/* ---------- input ---------- */
const MOVE_KEYS = {
  arrowup: [0, -1], arrowdown: [0, 1], arrowleft: [-1, 0], arrowright: [1, 0],
  w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
  q: [-1, -1], e: [1, -1], z: [-1, 1], c: [1, 1],
};

for (const card of document.querySelectorAll('.class-card')) {
  card.addEventListener('click', () => {
    Sfx.ensure(); Music.start();
    newGame(card.dataset.class);
  });
}

for (const chip of document.querySelectorAll('.diff-chip')) {
  chip.addEventListener('click', ev => { ev.currentTarget.blur(); setDifficulty(chip.dataset.diff); });
}
// boot: restore saved difficulty (or Veteran) and surface any saved run
(() => {
  let pref = 'standard';
  try { pref = localStorage.getItem('arcaneDiff') || 'standard'; } catch (e) { /* ignore */ }
  setDifficulty(pref);
  updateContinueLine();
  if (window.GuruTelemetry) GuruTelemetry.init(() => ({
    state: G.state, depth: G.depth, turn: G.turn, score: score(),
    gold: G.player ? G.player.gold : 0, hp: G.player ? G.player.hp : 0,
  }));
})();

// Feedback widget reads window.GuruWidgetMetadata at submit time (highest
// precedence merge), so a getter here means every whisper to the Keeper
// carries a live snapshot of the run — bug reports arrive with the state
// that produced them instead of a prose reconstruction.
function gameStateSnapshot() {
  try {
    const p = G.player;
    const snap = {
      state: G.state,
      class: G.classDef ? G.classDef.name : null,
      difficulty: G.diff ? G.diff.name : null,
      daily: !!G.daily,
      daily_seed: G.dailyBase != null ? G.dailyBase : undefined,
      depth: G.depth, turn: G.turn, floor_turns: G.floorTurns,
      score: score(),
    };
    if (p) {
      snap.hp = p.hp; snap.max_hp = p.maxHp;
      snap.mana = p.mana; snap.gold = p.gold; snap.kills = G.kills;
      snap.weapon = p.weapon || null; snap.armor = p.armor || null; snap.ring = p.ring || null;
      snap.boons = Object.keys(p.boons || {});
    }
    const logEl = $('log');
    if (logEl) {
      // server rejects metadata >10KB outright — keep the tail tight
      snap.recent_log = Array.from(logEl.children).slice(-15).map(d => (d.textContent || '').slice(0, 160));
    }
    return snap;
  } catch (e) {
    return { snapshot_error: String(e) };
  }
}
window.GuruWidgetMetadata = window.GuruWidgetMetadata || {};
Object.defineProperty(window.GuruWidgetMetadata, 'game_state', {
  enumerable: true,
  get: gameStateSnapshot,
});

canvas.addEventListener('mousemove', ev => { FX.hover = canvasToTile(ev); });
canvas.addEventListener('mouseleave', () => { FX.hover = null; });
canvas.addEventListener('click', ev => {
  if (G.state !== 'PLAY') return;
  if (joySuppressClick) return; // a joystick drag just ended — not a tap
  Sfx.ensure(); Music.start();
  let { x, y } = canvasToTile(ev);
  // sub-tile precision: a tap on the OUTER band of your own tile means the
  // neighbor in that direction — phone tiles are 8-12 CSS px and edge taps
  // were resolving to 'wait' mid-combat
  {
    const rct = canvas.getBoundingClientRect();
    // map through the CAMERA, not the whole map — the pre-zoom version put
    // the band in the wrong place whenever the camera was panned off origin
    const fx2 = ((ev.clientX - rct.left) / rct.width * (VIEW_W / CAM.zoom) + CAM.x) / CELL;
    const fy2 = ((ev.clientY - rct.top) / rct.height * (VIEW_H / CAM.zoom) + CAM.y) / CELL;
    const p0 = G.player;
    if (x === p0.x && y === p0.y) {
      const ox = fx2 - (p0.x + 0.5), oy = fy2 - (p0.y + 0.5);
      if (Math.max(Math.abs(ox), Math.abs(oy)) > 0.3) {
        const ddx = Math.abs(ox) > 0.18 ? Math.sign(ox) : 0;
        const ddy = Math.abs(oy) > 0.18 ? Math.sign(oy) : 0;
        if ((ddx || ddy) && G.map.inBounds(p0.x + ddx, p0.y + ddy)) { x = p0.x + ddx; y = p0.y + ddy; }
      }
    }
  }
  // fat fingers on 8px tiles: snap a near-miss to the closest interesting
  // tile (monster, ware, chest, stairs) within 1 tile of the tap
  if (!monsterAt(x, y) && cheb(x, y, G.player.x, G.player.y) > 1) {
    let snap = null, sd = 99;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const sx2 = x + dx, sy2 = y + dy;
      if (!G.map.inBounds(sx2, sy2) || !G.visible.has(sx2 + ',' + sy2)) continue;
      const t2 = G.map.get(sx2, sy2);
      const interesting = monsterAt(sx2, sy2) || G.shop.some(s => s.x === sx2 && s.y === sy2)
        || t2 === T.CHEST || t2 === T.GOLDCHEST || t2 === T.SHRINE || t2 === T.GILDED
        || t2 === T.STAIRS || t2 === T.DARKSTAIRS;
      if (!interesting) continue;
      const d2 = dx * dx + dy * dy;
      if (d2 < sd) { sd = d2; snap = [sx2, sy2]; }
    }
    if (snap) { x = snap[0]; y = snap[1]; }
  }
  FX.hover = { x, y }; // touch has no mousemove — a tap doubles as the nameplate
  const p = G.player;
  let m = monsterAt(x, y);
  let my = y;
  if (!m) {
    // tall sprites overhang the tile above their anchor — be forgiving
    const below = monsterAt(x, y + 1);
    if (below && G.visible.has(x + ',' + (y + 1))) { m = below; my = y + 1; }
  }
  if (m && G.visible.has(x + ',' + my)) {
    if (cheb(x, my, p.x, p.y) <= 1) {
      cancelTravel();
      attackMonster(m);
      afterPlayerTurn();
    } else {
      // one honest step per tap — travel's watched-guard would veto the
      // approach and leave thumb players unable to engage ranged foes at all
      const f = computeDistField(G.map, m.x, m.y, 60);
      let best = null, bd = f[G.map.idx(p.x, p.y)];
      if (bd !== -1) {
        for (const [ddx, ddy] of DIRS8) {
          const nx2 = p.x + ddx, ny2 = p.y + ddy;
          if (!G.map.inBounds(nx2, ny2) || monsterAt(nx2, ny2)) continue;
          if (!diagOpen(G.map, p.x, p.y, ddx, ddy)) continue;
          const fd = f[G.map.idx(nx2, ny2)];
          if (fd !== -1 && fd < bd) { bd = fd; best = [ddx, ddy]; }
        }
      }
      if (best) { addMsg(`You advance on ${theM(m)}.`, 'm-dim'); cancelTravel(); tryMove(best[0], best[1]); }
      else addMsg(`No way through to ${theM(m)} — step around by hand.`, 'm-dim');
    }
    return;
  }
  if (x === p.x && y === p.y) { // tap yourself: buy underfoot, descend on stairs, else wait
    cancelTravel();
    if (G.shop.some(s => s.x === p.x && s.y === p.y)) { if (onEnterTile(p.x, p.y)) afterPlayerTurn(); return; }
    if (G.map.get(p.x, p.y) === T.STAIRS) { descend(); return; }
    if (G.map.get(p.x, p.y) === T.DARKSTAIRS) {
      if (G.darkAsk === G.turn) { G.darkAsk = null; descend(); return; }
      G.darkAsk = G.turn;
      addMsg('The dark stair plunges PAST the next floor — tap again to dare it.', 'm-bad');
      return;
    }
    addMsg('You wait, listening to the dark.', 'm-dim');
    afterPlayerTurn();
    return;
  }
  if (cheb(x, y, p.x, p.y) <= 1 && (x !== p.x || y !== p.y)) {
    cancelTravel();
    tryMove(x - p.x, y - p.y);
    return;
  }
  startTravelTo(x, y);
});

function toggleHelp() {
  const hs = $('help-screen');
  if (!hs) { printHelp(); return; }
  const opening = hs.classList.contains('hidden');
  if (opening && G.state === 'CUTSCENE') { printHelp(); return; } // splash pages own the keys
  hs.classList.toggle('hidden');
  const cls = $('help-class-block');
  if (opening && cls) {
    cls.innerHTML = G.classId === 'mage'
      ? '<b style="color:var(--gold)">Your craft (mage).</b> Firebolt flies 3 tiles a turn at the nearest foe — fast movers can dodge it; point-blank never misses. Nova freezes 2 tiles around you ~3 turns. Blink [V] jumps up to 5 tiles, wild. Kills siphon +2 mana — aggression sustains you. Your WARD drinks half of every blow at 1 mana per 2 damage — an empty pool means a naked mage. ⚔ Attack powers spells too: +atk gifts are caster gifts.'
      : G.classId === 'rogue'
      ? '<b style="color:var(--gold)">Your craft (rogue).</b> Dozing (z) and stirring (?) foes eat your blade for ×3 — stalk them; your steps are quiet, theirs are not. Shadow Dash [V] melts you beside a foe 2-3 tiles out, striking the unaware on arrival. Vault [B] leaps you clean OVER an adjacent foe — cornered is a choice now. A survivor of a botched stab screams. Frozen foes count as unaware.'
      : G.classId === 'warrior'
      ? '<b style="color:var(--gold)">Your craft (warrior).</b> Cleave [V] strikes every adjacent foe. Shield Charge [B] dashes up to 3 tiles down a clear line into a foe at +50% — your answer to archers and the Lich\'s bolts. Bulwark [G] plants your shield: until your next turn every hit is turned aside to 1 — spend the turn, soak the storm. You also passively BLOCK part of the first hit each turn (heavier armor, bigger block). You are the wall; make them come through you.'
      : '';
  }
}

function printHelp() {
  addMsg('Move/attack: WASD, arrows, QEZC diagonals — bump enemies to fight.', 'm-dim');
  addMsg('Click: travel or attack adjacent · O auto-explore · Space wait · Enter descend.', 'm-dim');
  addMsg('1–0 use items (Shift+digit or right-click to drop) · V/B abilities · X zoom · Esc pause · ? help.', 'm-dim');
  if (G.classId === 'mage') {
    addMsg('Spellcraft: firebolt flies 3/turn at the nearest foe — fast movers can dodge it; point-blank never misses.', 'm-dim');
    addMsg('Nova freezes 2 tiles around you for ~3 turns · Blink jumps ≤5 tiles (wild) · kills siphon +2 mana · ⚔ Attack powers spells too.', 'm-dim');
  }
}

let abandonAsk = 0;
window.addEventListener('keydown', ev => {
  // typing in an input (e.g. the feedback widget) must never move the hero
  const t = ev.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
  const key = ev.key.toLowerCase();
  if (key.startsWith('arrow') || key === ' ' || key === 'enter') ev.preventDefault();
  Sfx.ensure(); Music.start();

  if (G.state === 'CUTSCENE') { ev.preventDefault(); skipCutsceneLine(); return; }
  if (G.state === 'BOON') {
    if (/^[1-4]$/.test(key) && G.boonPicks && G.boonPicks[+key - 1]) { pickBoon(G.boonPicks[+key - 1]); return; }
    if (ev.key === '?') { toggleHelp(); return; }
    addMsg('Choose a gift first — click a card or press 1-' + ((G.boonPicks || []).length || 3) + '.', 'm-dim');
    return;
  }
  if (G.state === 'PAUSED') {
    if (key === 'escape' || key === 'enter') resumeGame();
    return;
  }
  if (G.state === 'TITLE') {
    if (ev.key === '?') { toggleHelp(); return; } // the footer promises help — honor it here too
    if (sanctumOpen) {
      if (key === 's' || key === 'escape') toggleSanctum(false);
      return;
    }
    if (key === 's') { toggleSanctum(true); return; }
    if (key === 'c' && peekSave()) { loadRun(); return; }
    if (key === 't') { // cycle difficulty
      const ids = Object.keys(DIFFICULTIES);
      setDifficulty(ids[(ids.indexOf(G.diffId) + 1) % ids.length]);
      return;
    }
    if (key === 'd') {
      dailyPending = !dailyPending;
      const el = $('daily-line');
      el.textContent = dailyPending
        ? `◆ DAILY CHALLENGE ARMED — ${dailyKey()} · pick a class ◆`
        : '[D] daily challenge — one seeded dungeon, same for everyone today';
      el.classList.toggle('armed', dailyPending);
      return;
    }
    if (key === '1') newGame('warrior');
    else if (key === '2') newGame('rogue');
    else if (key === '3') newGame('mage');
    return;
  }
  if (G.state === 'DEAD' || G.state === 'WIN') {
    if (key === 'r') backToTitle();
    return;
  }
  if (G.state !== 'PLAY') return;

  if (key === 'm') { // mute shouldn't interrupt travel
    Sfx.muted = !Sfx.muted;
    Music.setMuted(Sfx.muted);
    addMsg(Sfx.muted ? 'Sound muted.' : 'Sound on.', 'm-dim');
    return;
  }
  if (ev.key === '?') { toggleHelp(); return; }
  if (key === 'escape' && $('help-screen') && !$('help-screen').classList.contains('hidden')) { $('help-screen').classList.add('hidden'); return; }
  if (key === 'escape') { pauseGame(); return; }
  cancelTravel();
  if (key === 'r' && ev.shiftKey) {
    if (Date.now() - abandonAsk < 5000) { saveBest(); backToTitle(); }
    else { abandonAsk = Date.now(); addMsg('Abandon this run? Press Shift+R again to confirm.', 'm-bad'); }
    return;
  }
  if (key === 'f') { castSpell(0); return; }
  if (key === 'g') { if (G.classId === 'warrior') castBulwark(); else castSpell(1); return; }
  if (key === 'h') { castSpell(2); return; }
  if (key === 'v') {
    if (G.classId === 'warrior') castCleave();
    else if (G.classId === 'mage') castSpell(3);
    else castShadowDash();
    return;
  }
  if (key === 'b') {
    if (G.classId === 'warrior') castCharge();
    else if (G.classId === 'rogue') castVault();
    else addMsg('Blink [V] is your way through space.', 'm-dim');
    return;
  }
  // zoom lives on X — Z is a DIAGONAL (veteran playtest: zoom had shadowed
  // down-left movement for both keyboard AND the joystick's key dispatch)
  if (key === 'x') {
    const zl = cycleZoom();
    addMsg(`The dark draws ${zl === 1 ? 'back — the whole floor in view' : zl === 1.5 ? 'closer' : 'close enough to smell'}. (X to change)`, 'm-dim');
    return;
  }
  if (key === 'o') { autoExplore(); return; }
  if (MOVE_KEYS[key] && !ev.shiftKey) { tryMove(...MOVE_KEYS[key]); return; }
  if (key === ' ' || key === '.') { addMsg('You wait, listening to the dark.', 'm-dim'); afterPlayerTurn(); return; }
  if (key === 'enter' || ev.key === '>') {
    const hereTile = G.map.get(G.player.x, G.player.y);
    if (hereTile === T.DARKSTAIRS && G.state === 'PLAY') {
      // a permanent floor skip deserves a second keystroke
      if (G.darkAsk === G.turn) { G.darkAsk = null; descend(); return; }
      G.darkAsk = G.turn;
      addMsg('The dark stair plunges PAST the next floor — press Enter again to dare it.', 'm-bad');
      return;
    }
    const onStairs = hereTile === T.STAIRS;
    if (!onStairs && G.state === 'PLAY') {
      if (typeof travelPath !== 'undefined' && travelPath && travelPath.length) return; // already walking — don't stutter the journey
      let sx = -1, sy = -1;
      for (let y = 0; y < G.map.h && sx < 0; y++) for (let x = 0; x < G.map.w; x++) {
        const i = G.map.idx(x, y);
        if (G.map.explored[i] && G.map.tiles[i] === T.STAIRS) { sx = x; sy = y; break; }
      }
      if (sx >= 0) { addMsg('You make for the stairs.', 'm-dim'); startTravelTo(sx, sy); return; }
    }
    descend(); return;
  }
  if (/^[0-9]$/.test(key)) {
    const idx = key === '0' ? 9 : +key - 1;
    if (ev.shiftKey) dropItem(idx); else useItem(idx);
  }
});

// tappable restart + title lines (phones have no R/S/D keys)
(() => {
  const wire = (id, fn) => { const b = $(id); if (b) b.addEventListener('click', ev => { ev.currentTarget.blur(); fn(); }); };
  wire('btn-rise', () => backToTitle());
  wire('btn-again', () => backToTitle());
  const hc = $('btn-help-close');
  if (hc) hc.addEventListener('click', () => $('help-screen').classList.add('hidden'));
  const cl = $('continue-line');
  if (cl) { cl.style.cursor = 'pointer'; cl.addEventListener('click', () => { if (G.state === 'TITLE' && peekSave()) loadRun(); }); }
  const sl = $('sanctum-line'), dl2 = $('daily-line');
  if (sl) { sl.style.cursor = 'pointer'; sl.addEventListener('click', () => { if (G.state === 'TITLE') toggleSanctum(true); }); }
  if (dl2) { dl2.style.cursor = 'pointer'; dl2.addEventListener('click', () => { if (G.state === 'TITLE') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' })); }); }
})();

// touch devices get a thumb bar for everything that lives on the keyboard
(() => {
  const tb = $('touch-bar');
  if (!tb) return;
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const narrow = window.innerWidth <= 760;
  if (!coarse && !narrow) return;
  tb.classList.remove('hidden');
  const wireTb = (id, fn) => { const b = $(id); if (b) b.addEventListener('click', ev => { ev.currentTarget.blur(); Sfx.ensure(); Music.start(); fn(); }); };
  wireTb('tb-explore', () => autoExplore());
  wireTb('tb-wait', () => { if (G.state !== 'PLAY') return; addMsg('You wait, listening to the dark.', 'm-dim'); afterPlayerTurn(); });
  wireTb('tb-descend', () => { if (G.state !== 'PLAY') return; window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); });
  wireTb('tb-ability', () => {
    if (G.classId === 'warrior') castCleave();
    else if (G.classId === 'mage') castSpell(3);
    else castShadowDash();
  });
  wireTb('tb-ability2', () => {
    if (G.classId === 'warrior') castCharge();
    else if (G.classId === 'rogue') castVault();
    else castSpell(0);
  });
  wireTb('tb-ability3', () => {
    if (G.classId === 'warrior') castBulwark();
  });
  wireTb('tb-potion', () => {
    if (G.state !== 'PLAY') return;
    const i = G.player.inventory.findIndex(e => ITEMS[e.id] && ITEMS[e.id].kind === 'potion');
    if (i === -1) { addMsg('No potions left. The dark notices.', 'm-dim'); return; }
    useItem(i);
  });
  wireTb('tb-help', () => toggleHelp());
  // label the ability buttons for the chosen class once a run starts
  const relabel = () => {
    const a = $('tb-ability'), b = $('tb-ability2'), c = $('tb-ability3');
    if (!a || !b) return;
    b.style.display = '';
    if (c) c.style.display = G.classId === 'warrior' ? '' : 'none';
    if (G.classId === 'warrior') { a.textContent = 'cleave'; b.textContent = 'charge'; if (c) c.textContent = 'bulwark'; }
    else if (G.classId === 'rogue') { a.textContent = 'dash'; b.textContent = 'vault'; }
    else if (G.classId === 'mage') { a.textContent = 'blink'; b.textContent = 'bolt'; }
  };
  setInterval(relabel, 1500);
})();

/* ---------- virtual joystick (widget ee54a145: 'joystick and buttons are a must')
   Modern dynamic stick: touch anywhere on the canvas and a joystick spawns
   under the thumb. Drag past the deadzone to step in that 8-way direction;
   HOLD to keep walking. A plain tap (no drag) still falls through to the
   existing tap-to-move/attack handler. Movement reuses the keyboard
   dispatch so every input guard (overlays, widget-typing) applies. */
let joySuppressClick = false;
(() => {
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (!coarse) return;
  const base = $('joy-base'), knob = $('joy-knob'), holder = $('canvas-holder');
  if (!base || !knob || !holder) return;
  const DEAD = 16, RANGE = 40, REPEAT_MS = 210;
  const KEYS = { '1,0': 'ArrowRight', '-1,0': 'ArrowLeft', '0,1': 'ArrowDown', '0,-1': 'ArrowUp',
                 '-1,-1': 'q', '1,-1': 'e', '-1,1': 'z', '1,1': 'c' };
  let touchId = null, ox = 0, oy = 0, dirKey = null, timer = null, dragged = false;

  const step = () => { if (dirKey && G.state === 'PLAY') window.dispatchEvent(new KeyboardEvent('keydown', { key: dirKey })); };
  const setVector = (tx, ty) => {
    const dx = tx - ox, dy = ty - oy;
    const mag = Math.hypot(dx, dy);
    const kx = mag > RANGE ? dx / mag * RANGE : dx, ky = mag > RANGE ? dy / mag * RANGE : dy;
    knob.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
    if (mag < DEAD) { dirKey = null; return; }
    dragged = true;
    // snap the drag angle to the nearest of 8 octants
    const oct = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
    const sx = [1, 1, 0, -1, -1, -1, 0, 1][oct];
    const sy = [0, 1, 1, 1, 0, -1, -1, -1][oct];
    const wasNull = dirKey === null;
    dirKey = KEYS[`${sx},${sy}`];
    if (wasNull && dirKey) { step(); clearInterval(timer); timer = setInterval(step, REPEAT_MS); }
  };
  const end = () => {
    touchId = null; dirKey = null; clearInterval(timer); timer = null;
    base.classList.add('hidden');
    knob.style.transform = 'translate(-50%, -50%)';
    if (dragged) { joySuppressClick = true; setTimeout(() => { joySuppressClick = false; }, 400); }
    dragged = false;
  };

  canvas.addEventListener('touchstart', ev => {
    if (G.state !== 'PLAY' || touchId !== null) return;
    const t = ev.changedTouches[0];
    touchId = t.identifier;
    const hr = holder.getBoundingClientRect();
    ox = t.clientX; oy = t.clientY;
    base.style.left = (t.clientX - hr.left) + 'px';
    base.style.top = (t.clientY - hr.top) + 'px';
    base.classList.remove('hidden');
    dragged = false;
    Sfx.ensure(); Music.start();
  }, { passive: true });
  canvas.addEventListener('touchmove', ev => {
    for (const t of ev.changedTouches) {
      if (t.identifier !== touchId) continue;
      setVector(t.clientX, t.clientY);
      if (dragged) ev.preventDefault(); // dragging the stick must not scroll the page
    }
  }, { passive: false });
  for (const evName of ['touchend', 'touchcancel']) {
    canvas.addEventListener(evName, ev => {
      for (const t of ev.changedTouches) if (t.identifier === touchId) end();
    });
  }
})();

/* ---------- mobile HUD: the game is the screen, the UI floats on it ----------
   (user feedback 2026-06-11: 'I want the whole ui to be the gameplay screen
   with seamless and minimal margins where the buttons can live') */
(() => {
  if (typeof MOBILE_UI === 'undefined' || !MOBILE_UI) return;
  document.body.classList.add('mobile-ui');
  const hud = document.createElement('div');
  hud.id = 'mhud';
  hud.innerHTML =
    '<div class="hud-top">' +
      '<div class="hud-bars">' +
        '<div class="hud-bar hud-hp"><div id="mh-hp"></div></div>' +
        '<div class="hud-bar hud-mana" id="mh-mana-wrap"><div id="mh-mana"></div></div>' +
      '</div>' +
      '<div class="hud-chips" id="mh-chips"></div>' +
    '</div>' +
    '<div class="cluster-left">' +
      '<button class="mbtn small" id="mb-bag" title="pack &amp; map">\u2630</button>' +
      '<button class="mbtn small" id="mb-explore" title="auto-explore">\u25ce</button>' +
      '<button class="mbtn small" id="mb-wait" title="wait">\u00b7</button>' +
      '<button class="mbtn small" id="mb-descend" title="descend">\u25bc</button>' +
    '</div>' +
    '<div class="cluster-right" id="mh-abilities"></div>';
  document.body.appendChild(hud);

  const tap = (id, fn) => { const b = hud.querySelector('#' + id); if (b) b.addEventListener('click', ev => { ev.currentTarget.blur(); Sfx.ensure(); Music.start(); fn(); }); };
  // the pack stays shut during boon choice — the drawer was opening OVER
  // the gift cards and eating their taps (mobile playtest bug #1)
  tap('mb-bag', () => { if (G.state === 'PLAY') document.body.classList.toggle('drawer-open'); });
  tap('mb-explore', () => autoExplore());
  tap('mb-wait', () => { if (G.state !== 'PLAY') return; addMsg('You wait, listening to the dark.', 'm-dim'); afterPlayerTurn(); });
  tap('mb-descend', () => { if (G.state !== 'PLAY') return; window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); });

  // the log rolls and burns away; a tap opens the full scroll
  const logEl = $('log');
  if (logEl) logEl.addEventListener('click', () => logEl.classList.toggle('expanded'));

  // touch-true copy: cutscenes advance on tap, not keys
  const cutHint = $('cut-hint');
  if (cutHint) cutHint.textContent = '— tap to continue —';

  // first run on a phone: one joystick hint, once ever
  let joyHinted = false;
  try { joyHinted = !!localStorage.getItem('arcaneJoyHint'); } catch (e) { /* ignore */ }
  const maybeHint = () => {
    if (joyHinted || G.state !== 'PLAY') return;
    joyHinted = true;
    try { localStorage.setItem('arcaneJoyHint', '1'); } catch (e) { /* ignore */ }
    spawnFloater(G.player.x, G.player.y, 'drag anywhere to walk', '#a8f0c0', 13);
    addMsg('Drag anywhere on the dungeon to walk that way — hold to keep walking.', 'm-gold');
  };
  setInterval(maybeHint, 800);

  // ability cluster: little sprite-buttons with cooldown/cost/count badges
  const mkBtn = (glyph, title, fn) => {
    const b = document.createElement('button');
    b.className = 'mbtn';
    b.innerHTML = glyph + '<span class="badge" style="display:none"></span>';
    b.title = title;
    b.addEventListener('click', ev => { ev.currentTarget.blur(); Sfx.ensure(); Music.start(); fn(); });
    return b;
  };
  const SPELL_GLYPHS = ['\u2726', '\u2745', '\u271a', '\u2737']; // bolt, nova, mend, blink
  let builtFor = null;
  const buttons = [];
  const rebuild = () => {
    const box = hud.querySelector('#mh-abilities');
    box.innerHTML = ''; buttons.length = 0;
    const add = (glyph, title, fn, badgeOf) => { const b = mkBtn(glyph, title, fn); buttons.push({ b, badgeOf }); box.appendChild(b); };
    if (G.classId === 'mage') {
      SPELLS.forEach((sp, i) => add(SPELL_GLYPHS[i], sp.name, () => castSpell(i),
        p => (p.mana < sp.cost ? { txt: sp.cost + '\u25c6', cant: true } : { txt: sp.cost + '\u25c6' })));
    } else if (G.classId === 'warrior') {
      add('\u2694', 'Cleave', () => castCleave(), p => p.cleaveCd > 0 ? { txt: p.cleaveCd, cant: true } : null);
      add('\u00bb', 'Shield Charge', () => castCharge(), p => p.chargeCd > 0 ? { txt: p.chargeCd, cant: true } : null);
      add('\u26e8', 'Bulwark', () => castBulwark(), p => p.guardCd > 0 ? { txt: p.guardCd, cant: true } : null);
    } else if (G.classId === 'rogue') {
      add('\u00bb', 'Shadow Dash', () => castShadowDash(), p => p.dashCd > 0 ? { txt: p.dashCd, cant: true } : null);
      add('\u2934', 'Vault', () => castVault(), p => p.vaultCd > 0 ? { txt: p.vaultCd, cant: true } : null);
    }
    add('!', 'drink a potion', () => {
      if (G.state !== 'PLAY') return;
      const i = G.player.inventory.findIndex(e => ITEMS[e.id] && ITEMS[e.id].kind === 'potion');
      if (i === -1) { addMsg('No potions left. The dark notices.', 'm-dim'); return; }
      useItem(i);
    }, p => {
      const n = p.inventory.reduce((s, e) => s + (ITEMS[e.id] && ITEMS[e.id].kind === 'potion' ? (e.count || 1) : 0), 0);
      return n ? { txt: 'x' + n } : { txt: 'x0', cant: true };
    });
    builtFor = G.classId;
  };
  const refresh = () => {
    const p = G.player;
    const inRun = p && (G.state === 'PLAY' || G.state === 'BOON');
    hud.style.display = inRun ? 'block' : 'none';
    if (G.state !== 'PLAY') document.body.classList.remove('drawer-open');
    if (!inRun) return;
    if (builtFor !== G.classId) rebuild();
    $('mh-hp').style.width = (100 * p.hp / p.maxHp) + '%';
    const mw = hud.querySelector('#mh-mana-wrap');
    mw.style.display = p.maxMana > 0 ? '' : 'none';
    if (p.maxMana > 0) $('mh-mana').style.width = (100 * p.mana / p.maxMana) + '%';
    $('mh-chips').textContent = `\u25c8 ${G.depth}/${FINAL_DEPTH}  $${p.gold}`;
    for (const { b, badgeOf } of buttons) {
      const info = badgeOf ? badgeOf(p) : null;
      const badge = b.querySelector('.badge');
      if (info && info.txt != null) { badge.style.display = ''; badge.textContent = info.txt; }
      else badge.style.display = 'none';
      b.classList.toggle('cant', !!(info && info.cant));
    }
  };
  setInterval(refresh, 250);
  refresh();
})();

// title boot: the daily line carries today's date from the first paint
(() => { const dl = $('daily-line'); if (dl) dl.textContent = `[D] daily challenge \u2014 ${dailyKey()}: one seeded dungeon, same for everyone today`; })();
