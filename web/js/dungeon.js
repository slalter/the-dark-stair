'use strict';

const T = { WALL: 0, FLOOR: 1, STAIRS: 2, CHEST: 3, TORCH: 4, TRAP: 5, WATER: 6, SHRINE: 7, GOLDCHEST: 8, DARKSTAIRS: 9, GILDED: 10 };
const MAP_W = 48, MAP_H = 32;
const FINAL_DEPTH = 6;

/* classic corner rule: a diagonal step is blocked only when BOTH flanking
   orthogonals are walls — no slipping through sealed corners (applies to the
   hero, monsters, and pathfinding alike, so plans always match moves) */
function diagOpen(map, x, y, dx, dy) {
  if (!dx || !dy) return true;
  return map.walkable(x + dx, y) || map.walkable(x, y + dy);
}

function tileWalkable(t) { return t === T.FLOOR || t === T.STAIRS || t === T.TRAP || t === T.WATER || t === T.DARKSTAIRS; }
function tileOpaque(t) { return t === T.WALL || t === T.TORCH; }

class GameMap {
  constructor(depth) {
    this.w = MAP_W; this.h = MAP_H;
    this.depth = depth;
    this.tiles = new Uint8Array(this.w * this.h); // all WALL
    this.explored = new Uint8Array(this.w * this.h);
    this.fovSeen = new Uint8Array(this.w * this.h); // seen with your own eyes (magic reveals don't count)
    this.trapSeen = new Uint8Array(this.w * this.h);
    this.light = new Float32Array(this.w * this.h); // static torch light
    this.rooms = [];
  }
  idx(x, y) { return y * this.w + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  get(x, y) { return this.inBounds(x, y) ? this.tiles[this.idx(x, y)] : T.WALL; }
  set(x, y, t) { if (this.inBounds(x, y)) this.tiles[this.idx(x, y)] = t; }
  walkable(x, y) { return tileWalkable(this.get(x, y)); }
  opaque(x, y) { return tileOpaque(this.get(x, y)); }
}

/* ---------- generation ---------- */
function generateMap(depth) {
  const map = new GameMap(depth);
  map.theme = (typeof pickTheme === 'function') ? pickTheme(depth) : { w: 1 };
  const targetRooms = 8 + Math.min(depth, 4);

  for (let attempt = 0; attempt < 200 && map.rooms.length < targetRooms; attempt++) {
    const rw = RNG.int(4, 9), rh = RNG.int(4, 7);
    const x = RNG.int(1, map.w - rw - 2), y = RNG.int(1, map.h - rh - 2);
    const room = { x, y, w: rw, h: rh, cx: x + (rw >> 1), cy: y + (rh >> 1) };
    let overlaps = false;
    for (const r of map.rooms) {
      if (x - 1 < r.x + r.w + 1 && x + rw + 1 > r.x - 1 && y - 1 < r.y + r.h + 1 && y + rh + 1 > r.y - 1) { overlaps = true; break; }
    }
    if (overlaps) continue;
    for (let j = y; j < y + rh; j++)
      for (let i = x; i < x + rw; i++)
        map.set(i, j, T.FLOOR);
    map.rooms.push(room);
  }

  // connect rooms with L-corridors
  for (let i = 1; i < map.rooms.length; i++) {
    const a = map.rooms[i - 1], b = map.rooms[i];
    if (RNG.chance(0.5)) { carveH(map, a.cx, b.cx, a.cy); carveV(map, a.cy, b.cy, b.cx); }
    else { carveV(map, a.cy, b.cy, a.cx); carveH(map, a.cx, b.cx, b.cy); }
  }

  // torches on room walls
  if (!map.theme.noTorches)
  for (const r of map.rooms) {
    const n = RNG.int(1, 2);
    for (let k = 0; k < n; k++) {
      const side = RNG.int(0, 3);
      let tx, ty;
      if (side === 0) { tx = RNG.int(r.x, r.x + r.w - 1); ty = r.y - 1; }
      else if (side === 1) { tx = RNG.int(r.x, r.x + r.w - 1); ty = r.y + r.h; }
      else if (side === 2) { tx = r.x - 1; ty = RNG.int(r.y, r.y + r.h - 1); }
      else { tx = r.x + r.w; ty = RNG.int(r.y, r.y + r.h - 1); }
      if (map.get(tx, ty) === T.WALL) map.set(tx, ty, T.TORCH);
    }
  }

  // static torch light field
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    if (map.get(x, y) !== T.TORCH) continue;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const tx = x + dx, ty = y + dy;
      if (!map.inBounds(tx, ty)) continue;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 4) continue;
      const i = map.idx(tx, ty);
      map.light[i] = Math.min(0.6, map.light[i] + 0.45 * (1 - d / 4));
    }
  }

  // water pools: organic blobs grown inside rooms
  const poolCount = map.theme.pools ? RNG.int(map.theme.pools[0], map.theme.pools[1]) : RNG.int(0, 2);
  for (let k = 0; k < poolCount; k++) {
    const r = RNG.pick(map.rooms);
    let wx = RNG.int(r.x, r.x + r.w - 1), wy = RNG.int(r.y, r.y + r.h - 1);
    const blob = RNG.int(4, 9);
    for (let b = 0; b < blob; b++) {
      if (map.get(wx, wy) === T.FLOOR) map.set(wx, wy, T.WATER);
      const [dx, dy] = RNG.pick(DIRS8);
      wx = clamp(wx + dx, r.x, r.x + r.w - 1);
      wy = clamp(wy + dy, r.y, r.y + r.h - 1);
    }
  }

  // start room = rooms[0]; stairs in farthest room (boss arena on final depth)
  const start = map.rooms[0];
  let far = map.rooms[0], farD = -1;
  for (const r of map.rooms) {
    const d = dist2(r.cx, r.cy, start.cx, start.cy);
    if (d > farD) { farD = d; far = r; }
  }
  map.startRoom = start;
  map.endRoom = far;
  if (depth < FINAL_DEPTH) map.set(far.cx, far.cy, T.STAIRS);
  map.stairsPos = depth < FINAL_DEPTH ? { x: far.cx, y: far.cy } : null;

  // chests — placeBlocker: an unwalkable tile at a corridor mouth can sever
  // the level under the corner rule, so every blocking feature is validated
  const chestCount = RNG.int(1, 2);
  for (let k = 0; k < chestCount; k++)
    placeBlocker(map, T.CHEST, t => cheb(t.x, t.y, start.cx, start.cy) > 4);

  // traps (the Furnace studs the floor with extra ember vents)
  const trapCount = RNG.int(2, 3 + depth) + (map.theme.trapMod || 0);
  for (let k = 0; k < trapCount; k++) {
    const spot = randomFloor(map, t => cheb(t.x, t.y, start.cx, start.cy) > 5);
    if (spot) map.set(spot.x, spot.y, T.TRAP);
  }

  // the dark stair (floors 2-4): a riskier descent for richer spoils
  if (depth >= 2 && depth <= 4) {
    const spot = randomFloor(map, t => cheb(t.x, t.y, start.cx, start.cy) > 6 && cheb(t.x, t.y, far.cx, far.cy) > 6);
    if (spot) map.set(spot.x, spot.y, T.DARKSTAIRS);
  }

  // blood shrine (floors 2-5): an offering of blood for a gift of power
  if (depth >= 2 && depth <= 5)
    placeBlocker(map, T.SHRINE, t => cheb(t.x, t.y, start.cx, start.cy) > 5);

  // golden chest (floors 2+): locked — the floor's elite carries the key
  if (depth >= 2) {
    const spot = placeBlocker(map, T.GOLDCHEST, t => cheb(t.x, t.y, start.cx, start.cy) > 5);
    if (spot) map.hasGoldChest = true;
  }

  // the gilded corpse (floors 2-5): a dead man's treasure — and his killers
  if (depth >= 2 && depth <= 5 && RNG.chance(0.4))
    placeBlocker(map, T.GILDED, t => cheb(t.x, t.y, start.cx, start.cy) > 6);

  // a hand-built set piece, if one fits (after all features so the
  // connectivity check can protect every special tile)
  stampVault(map, depth);

  return map;
}

/* ---------- vaults: hand-authored set pieces stamped over a generated room ----------
   The prize sits behind terrain you must NAVIGATE (trap lines, baffles, chokes) —
   power through positioning, not stat checks. Legend:
   '#'=wall  '.'=floor  '^'=trap  '~'=water  'C'=chest  'S'=shrine  '?'=keep existing */
const VAULTS = [
  { name: 'the spiked treasury', rows: [   // chest behind a full trap moat
    '#######',
    '#C..^.?',
    '#...^.?',
    '#...^.?',
    '####?##',
  ] },
  { name: 'the serpent walk', rows: [      // S-baffle, traps at the blind turns
    '???????',
    '?#####?',
    '?C..^#?',
    '?####.?',
    '?^...??',
    '???????',
  ] },
  { name: 'the drowned alcove', rows: [    // shrine on a wet island, one dry approach
    '#######',
    '#~~S~~#',
    '#~...~#',
    '#~~.~~#',
    '???.???',
  ] },
  { name: 'the pillared hall', rows: [     // tactical pillars — kiting terrain, no prize
    '???????',
    '?.#.#.?',
    '?.....?',
    '?.#.#.?',
    '???????',
  ] },
  { name: 'the tollway', rows: [           // every path to the chest pays in blood
    '#######',
    '?.^.^C#',
    '?.....#',
    '?.^.^.#',
    '#######',
  ] },
];
const VAULTS_BAIT_DEFINED = true;
const VAULTS_BAIT = [
  { name: 'the gauntlet of coals', rows: [  // loot past a forced trap corridor
    '#######',
    '?.^^^.C',
    '#######',
  ] },
  { name: 'the killing lane', rows: [       // stand behind the lane; let them cross
    '???????',
    '?##^##?',
    '?..^..?',
    '?##^##?',
    '???????',
  ] },
];
/* set pieces built around the newer bestiary — monster markers ('L' cinder
   lobber, 'H' bone charger) stamp floor and queue a spawn for startLevel;
   'G' is the gilded corpse tile. minD gates them off the early floors. */
const VAULTS_BESTIARY = [
  { name: 'the artillery gallery', minD: 3, rows: [  // shells rain on the trap moat
    '#######',
    '#C..L.#',
    '#^^^^^#',
    '?.....?',
  ] },
  { name: 'the tusk run', minD: 2, rows: [           // a charger owns this hall
    '########',
    '#H.....C',
    '?......#',
    '########',
  ] },
  { name: "the dead man's parlor", minD: 2, rows: [  // every temptation, one door
    '#######',
    '#G.S..#',
    '#..^..#',
    '#C...??',
    '#######',
  ] },
];
VAULTS.push(...VAULTS_BAIT, ...VAULTS_BESTIARY);
const VAULT_TILE = { '#': T.WALL, '.': T.FLOOR, '^': T.TRAP, '~': T.WATER, 'C': T.CHEST, 'S': T.SHRINE, 'G': T.GILDED };
const VAULT_SPAWN = { 'L': 'lobber', 'H': 'charger' };

/* Stamp one vault into a fitting non-start/end room, then verify every special
   tile and the level exits remain reachable; revert the stamp otherwise. */
function stampVault(map, depth) {
  if (depth >= FINAL_DEPTH || !RNG.chance(depth === 1 ? 0.4 : 0.6)) return;
  const eligible = VAULTS.filter(vv => depth >= (vv.minD || 1));
  const v = RNG.pick(eligible);
  const vh = v.rows.length, vw = v.rows[0].length;
  const holdsSpecial = r => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const t = map.tiles[map.idx(x, y)];
      if (t === T.STAIRS || t === T.DARKSTAIRS || t === T.SHRINE || t === T.GOLDCHEST || t === T.CHEST || t === T.GILDED) return true;
    }
    return false;
  };
  const fits = map.rooms.filter(r => r !== map.startRoom && r !== map.endRoom
    && r.w >= vw && r.h >= vh && !holdsSpecial(r));
  if (!fits.length) return;
  const r = RNG.pick(fits);
  const ox = r.x + ((r.w - vw) >> 1), oy = r.y + ((r.h - vh) >> 1);

  const backup = [];
  const spawns = [];
  for (let j = 0; j < vh; j++) for (let i = 0; i < vw; i++) {
    const ch = v.rows[j][i];
    if (ch === '?') continue;
    const x = ox + i, y = oy + j;
    backup.push({ x, y, t: map.get(x, y) });
    if (VAULT_SPAWN[ch]) { map.set(x, y, T.FLOOR); spawns.push({ x, y, id: VAULT_SPAWN[ch] }); }
    else map.set(x, y, VAULT_TILE[ch]);
  }

  if (!vaultKeepsLevelConnected(map)) {
    for (const b of backup) map.set(b.x, b.y, b.t);
    return;
  }
  map.vault = v.name;
  map.vaultSpawns = spawns;
}

/* corner-rule-aware reachability flood from (sx, sy) */
function floodWalk(map, sx, sy) {
  const seen = new Uint8Array(map.w * map.h);
  const qx = [sx], qy = [sy];
  seen[map.idx(sx, sy)] = 1;
  for (let h = 0; h < qx.length; h++) {
    for (const [dx, dy] of DIRS8) {
      const nx = qx[h] + dx, ny = qy[h] + dy;
      if (!map.inBounds(nx, ny) || seen[map.idx(nx, ny)] || !map.walkable(nx, ny)) continue;
      // corner rule: a diagonal squeeze does not count as a connection
      if (!diagOpen(map, qx[h], qy[h], dx, dy)) continue;
      seen[map.idx(nx, ny)] = 1;
      qx.push(nx); qy.push(ny);
    }
  }
  return seen;
}

/* stairs and every room center must stay walk-reachable from the start */
function coreConnected(map) {
  const seen = floodWalk(map, map.startRoom.cx, map.startRoom.cy);
  if (map.stairsPos && !seen[map.idx(map.stairsPos.x, map.stairsPos.y)]) return false;
  for (const r of map.rooms) if (!seen[map.idx(r.cx, r.cy)]) return false;
  return true;
}

/* drop an unwalkable feature tile, reverting any spot that severs ANY tile —
   a pocket cut off behind a blocker strands monsters in unreachable nooks */
function placeBlocker(map, tile, pred) {
  const count = seen => { let n = 0; for (let i = 0; i < seen.length; i++) n += seen[i]; return n; };
  const before = count(floodWalk(map, map.startRoom.cx, map.startRoom.cy));
  for (let tries = 0; tries < 12; tries++) {
    const spot = randomFloor(map, pred);
    if (!spot) return null;
    map.set(spot.x, spot.y, tile);
    if (count(floodWalk(map, map.startRoom.cx, map.startRoom.cy)) === before - 1) return spot;
    map.set(spot.x, spot.y, T.FLOOR);
  }
  return null;
}

function vaultKeepsLevelConnected(map) {
  const seen = floodWalk(map, map.startRoom.cx, map.startRoom.cy);
  const touchable = (x, y) => seen[map.idx(x, y)]
    || DIRS8.some(([dx, dy]) => map.inBounds(x + dx, y + dy) && seen[map.idx(x + dx, y + dy)]);
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const t = map.tiles[map.idx(x, y)];
    // stairs must be STOOD on — adjacency is not enough
    if ((t === T.STAIRS || t === T.DARKSTAIRS) && !seen[map.idx(x, y)]) return false;
    if ((t === T.CHEST || t === T.GOLDCHEST || t === T.SHRINE || t === T.GILDED) && !touchable(x, y)) return false;
  }
  // every room must stay reachable — a sealed side room can orphan loot or
  // the merchant (the shop is placed into an arbitrary room after stamping)
  for (const r of map.rooms) if (!seen[map.idx(r.cx, r.cy)]) return false;
  return !!seen[map.idx(map.endRoom.cx, map.endRoom.cy)];
}

function carveH(map, x1, x2, y) {
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++)
    if (map.get(x, y) !== T.FLOOR) map.set(x, y, T.FLOOR);
}
function carveV(map, y1, y2, x) {
  for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++)
    if (map.get(x, y) !== T.FLOOR) map.set(x, y, T.FLOOR);
}

function randomFloor(map, pred) {
  for (let tries = 0; tries < 400; tries++) {
    const r = RNG.pick(map.rooms);
    const x = RNG.int(r.x, r.x + r.w - 1), y = RNG.int(r.y, r.y + r.h - 1);
    if (map.get(x, y) !== T.FLOOR) continue;
    if (pred && !pred({ x, y })) continue;
    return { x, y };
  }
  return null;
}

/* ---------- field of view (recursive shadowcasting) ---------- */
const FOV_MULT = [
  [1, 0, 0, -1, -1, 0, 0, 1],
  [0, 1, -1, 0, 0, -1, 1, 0],
  [0, 1, 1, 0, 0, -1, -1, 0],
  [1, 0, 0, 1, -1, 0, 0, -1],
];

function computeFOV(map, px, py, radius) {
  const visible = new Set([px + ',' + py]);
  function castLight(row, start, end, xx, xy, yx, yy) {
    if (start < end) return;
    let newStart = 0;
    let blockedF = false;
    for (let d = row; d <= radius && !blockedF; d++) {
      const dy = -d;
      for (let dx = -d; dx <= 0; dx++) {
        const curX = px + dx * xx + dy * xy;
        const curY = py + dx * yx + dy * yy;
        const lSlope = (dx - 0.5) / (dy + 0.5);
        const rSlope = (dx + 0.5) / (dy - 0.5);
        if (start < rSlope) continue;
        if (end > lSlope) break;
        const inB = map.inBounds(curX, curY);
        if (dx * dx + dy * dy <= radius * radius && inB) visible.add(curX + ',' + curY);
        const isBlocked = !inB || map.opaque(curX, curY);
        if (blockedF) {
          if (isBlocked) { newStart = rSlope; }
          else { blockedF = false; start = newStart; }
        } else if (isBlocked && d < radius) {
          blockedF = true;
          castLight(d + 1, start, lSlope, xx, xy, yx, yy);
          newStart = rSlope;
        }
      }
    }
  }
  for (let i = 0; i < 8; i++)
    castLight(1, 1.0, 0.0, FOV_MULT[0][i], FOV_MULT[1][i], FOV_MULT[2][i], FOV_MULT[3][i]);
  return visible;
}

/* ---------- distance field (BFS from player, 8-dir) for monster pathing ---------- */
function computeDistField(map, px, py, maxD = 40) {
  const field = new Int16Array(map.w * map.h).fill(-1);
  const qx = new Int16Array(map.w * map.h), qy = new Int16Array(map.w * map.h);
  let head = 0, tail = 0;
  field[map.idx(px, py)] = 0;
  qx[tail] = px; qy[tail] = py; tail++;
  while (head < tail) {
    const x = qx[head], y = qy[head]; head++;
    const d = field[map.idx(x, y)];
    if (d >= maxD) continue; // cap search radius
    for (const [dx, dy] of DIRS8) {
      const nx = x + dx, ny = y + dy;
      if (!map.inBounds(nx, ny) || !map.walkable(nx, ny)) continue;
      if (!diagOpen(map, x, y, dx, dy)) continue;
      const i = map.idx(nx, ny);
      if (field[i] !== -1) continue;
      field[i] = d + 1;
      qx[tail] = nx; qy[tail] = ny; tail++;
    }
  }
  return field;
}
