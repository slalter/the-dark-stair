'use strict';

const CELL = 20;
// WORLD = the dungeon in pixels (fixed). VIEW = the canvas (fixed on desktop,
// viewport-matched on phones so the game IS the screen — user feedback).
const WORLD_W = MAP_W * CELL, WORLD_H = MAP_H * CELL;
let VIEW_W = WORLD_W, VIEW_H = WORLD_H;

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const MOBILE_UI = typeof window !== 'undefined' && window.matchMedia
  && (window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 760);
function sizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  if (MOBILE_UI) {
    // full-bleed: the canvas wears the whole viewport; CSS pins it there
    VIEW_W = Math.max(200, window.innerWidth);
    VIEW_H = Math.max(200, window.innerHeight);
    canvas.style.width = '100vw';
    canvas.style.height = '100dvh';
  } else {
    canvas.style.width = VIEW_W + 'px';
    canvas.style.height = VIEW_H + 'px';
  }
  canvas.width = VIEW_W * dpr;
  canvas.height = VIEW_H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  CAM.snap = true;
}
// sizeCanvas() is first called below, after CAM exists (const TDZ)

const FX = { particles: [], floaters: [], shake: 0, hurtT: 0, hover: null, fadeT: 0, fadeText: '', boltGhosts: [] };

/* camera: the map no longer has to fit the screen — zoom in, follow the
   player, let the minimap carry wayfinding (user feedback 2026-06-11) */
const CAM = { zoom: 1.5, x: 0, y: 0, snap: true };
try { CAM.zoom = +(localStorage.getItem('arcaneZoom') || 1.5) || 1.5; } catch (e) { /* ignore */ }
function cycleZoom() {
  const levels = [1, 1.5, 2, 2.5, 3]; // deeper zoom range (widget 0683a4d4)
  CAM.zoom = levels[(levels.indexOf(CAM.zoom) + 1) % levels.length];
  CAM.snap = true;
  try { localStorage.setItem('arcaneZoom', String(CAM.zoom)); } catch (e) { /* ignore */ }
  return CAM.zoom;
}
function camView() { return { vw: VIEW_W / CAM.zoom, vh: VIEW_H / CAM.zoom }; }
sizeCanvas();
if (MOBILE_UI) { window.addEventListener('resize', sizeCanvas); window.addEventListener('orientationchange', () => setTimeout(sizeCanvas, 120)); }

/* deterministic per-tile hash for texture variation */
function tileHash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function canvasToTile(ev) {
  const r = canvas.getBoundingClientRect();
  const wx = (ev.clientX - r.left) / r.width * (VIEW_W / CAM.zoom) + CAM.x;
  const wy = (ev.clientY - r.top) / r.height * (VIEW_H / CAM.zoom) + CAM.y;
  return { x: Math.floor(wx / CELL), y: Math.floor(wy / CELL) };
}

/* ---------- fx spawners ---------- */
function spawnFloater(tx, ty, text, color, size = 13) {
  FX.floaters.push({ x: tx * CELL + CELL / 2, y: ty * CELL + 2, text, color, size, life: size > 13 ? 1.4 : 1 });
}
/* a slow, screen-centered announcement for boss moments */
function spawnBanner(text, color) {
  FX.floaters.push({ x: VIEW_W / 2, y: VIEW_H / 3, text, color, size: 26, life: 2.6, banner: true });
}
function spawnBurst(tx, ty, color, n = 10, speed = 70) {
  const cx = tx * CELL + CELL / 2, cy = ty * CELL + CELL / 2;
  for (let i = 0; i < n; i++) {
    const a = CRNG.next() * Math.PI * 2, s = speed * (0.4 + CRNG.next() * 0.8);
    FX.particles.push({ x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, decay: 1.8 + CRNG.next() * 1.5, color, size: 1.5 + CRNG.next() * 2 });
  }
}
function spawnBolt(x1, y1, x2, y2, color) {
  const ax = x1 * CELL + CELL / 2, ay = y1 * CELL + CELL / 2;
  const bx = x2 * CELL + CELL / 2, by = y2 * CELL + CELL / 2;
  const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 6);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    FX.particles.push({
      x: lerp(ax, bx, t) + (CRNG.next() - 0.5) * 4, y: lerp(ay, by, t) + (CRNG.next() - 0.5) * 4,
      vx: (CRNG.next() - 0.5) * 20, vy: (CRNG.next() - 0.5) * 20,
      life: 0.5 + t * 0.5, decay: 2.6, color, size: 2,
    });
  }
}
function addShake(n) { if (FX.shakeEnabled !== false) FX.shake = Math.min(8, FX.shake + n); }

function updateFX(dt) {
  FX.shake = Math.max(0, FX.shake - dt * 22);
  FX.hurtT = Math.max(0, FX.hurtT - dt * 2.5);
  FX.fadeT = Math.max(0, FX.fadeT - dt * 1.4);
  // hold a warning vignette while critically wounded
  let flash = FX.hurtT > 0 ? Math.min(1, FX.hurtT) : 0;
  if (typeof G !== 'undefined' && G.state === 'PLAY' && G.player && G.player.hp < G.player.maxHp * 0.25) {
    flash = Math.max(flash, 0.28 + 0.1 * Math.sin(performance.now() / 300));
  }
  document.getElementById('hurt-flash').style.opacity = flash;
  for (let i = FX.particles.length - 1; i >= 0; i--) {
    const p = FX.particles[i];
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= (1 - dt * 2); p.vy *= (1 - dt * 2);
    if (p.rise) p.vy -= 40 * dt;
    p.life -= p.decay * dt;
    if (p.life <= 0) FX.particles.splice(i, 1);
  }
  for (let i = FX.boltGhosts.length - 1; i >= 0; i--) {
    const g = FX.boltGhosts[i];
    const gdx = g.tx - g.x, gdy = g.ty - g.y;
    const dist = Math.hypot(gdx, gdy);
    const step = 16 * dt; // tiles per second — fast, but visible
    if (dist <= step) {
      spawnBurst(g.tx, g.ty, g.color, g.n, g.speed);
      FX.boltGhosts.splice(i, 1);
    } else {
      g.x += (gdx / dist) * step;
      g.y += (gdy / dist) * step;
    }
  }
  for (let i = FX.floaters.length - 1; i >= 0; i--) {
    const f = FX.floaters[i];
    f.y -= (f.banner ? 5 : 26) * dt;
    f.life -= dt * (f.banner ? 0.65 : 1.1);
    if (f.life <= 0) FX.floaters.splice(i, 1);
  }
}

/* smooth render positions: ease entity.rx/ry toward grid x/y, decay attack lunges */
function easeEntity(e, dt) {
  if (e.rx === undefined) { e.rx = e.x; e.ry = e.y; }
  const k = Math.min(1, dt * 13);
  e.rx += (e.x - e.rx) * k;
  e.ry += (e.y - e.ry) * k;
  if (e.x < e.rx - 0.02) e.faceL = true;
  else if (e.x > e.rx + 0.02) e.faceL = false;
  if (Math.abs(e.x - e.rx) < 0.01) e.rx = e.x;
  if (Math.abs(e.y - e.ry) < 0.01) e.ry = e.y;
  const lk = Math.min(1, dt * 11);
  e.lx = (e.lx || 0) * (1 - lk);
  e.ly = (e.ly || 0) * (1 - lk);
}

/* a quick lunge toward (or recoil from) a target tile — combat needs motion */
function lunge(e, tx, ty, power) {
  const dx = tx - e.x, dy = ty - e.y;
  const len = Math.max(1, Math.abs(dx), Math.abs(dy));
  e.lx = (dx / len) * power;
  e.ly = (dy / len) * power;
}

/* ---------- draw ---------- */
const GLYPH_FONT = 'bold 15px Consolas, "Cascadia Mono", monospace';

/* ---------- sprites: Imagen-generated PNGs with glyph fallback ----------
   Lazy-loaded from sprites/<id>.png. Until an image arrives (or if it 404s)
   the renderer keeps drawing the original glyph, so the game never blocks. */
const SPRITES = { imgs: {}, status: {} };
function spriteFor(id) {
  if (id === 'slimelet') id = 'slime'; // slimelets reuse the slime art, drawn smaller
  const s = SPRITES.status[id];
  if (s === 'ok') return SPRITES.imgs[id];
  if (s === undefined && typeof Image !== 'undefined') {
    SPRITES.status[id] = 'loading';
    const img = new Image();
    img.onload = () => { SPRITES.status[id] = 'ok'; };
    img.onerror = () => { SPRITES.status[id] = 'err'; };
    const sp = 'sprites/' + id + '.png';
    img.src = (typeof BUNDLED_ASSETS !== 'undefined' && BUNDLED_ASSETS[sp]) || sp;
    SPRITES.imgs[id] = img;
  }
  return null;
}

/* map an item (or gold drop) to its prop sprite id */
function propSpriteFor(it) {
  if (it.gold) return spriteFor('prop_gold');
  const def = ITEMS[it.id];
  if (!def) return null;
  const kind = { potion: 'prop_potion', scroll: 'prop_scroll', weapon: 'prop_weapon',
                 armor: 'prop_armor', ring: 'prop_ring' }[def.kind];
  return kind ? spriteFor(kind) : null;
}

/* offscreen canvas for tint passes (hit flash, freeze) */
const _tintCv = (typeof document !== 'undefined' && document.createElement)
  ? document.createElement('canvas') : null;
function drawSprite(spr, cx, footY, targetH, opts = {}) {
  // scale by the LARGER dimension so wide sprites (bats, spiders) stay in-tile
  const scale = targetH / Math.max(spr.width, spr.height);
  const w = spr.width * scale, h = spr.height * scale;
  const x = cx - w / 2, y = footY - h;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (opts.flip) { ctx.translate(cx, 0); ctx.scale(-1, 1); ctx.translate(-cx, 0); }
  if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
  if (opts.tint && _tintCv && _tintCv.getContext) {
    const tc = _tintCv.getContext('2d');
    if (tc && tc.drawImage) {
      _tintCv.width = Math.max(1, Math.ceil(w));
      _tintCv.height = Math.max(1, Math.ceil(h));
      tc.imageSmoothingEnabled = false;
      tc.clearRect(0, 0, _tintCv.width, _tintCv.height);
      tc.drawImage(spr, 0, 0, _tintCv.width, _tintCv.height);
      tc.globalCompositeOperation = 'source-atop';
      tc.fillStyle = opts.tint;
      tc.fillRect(0, 0, _tintCv.width, _tintCv.height);
      tc.globalCompositeOperation = 'source-over';
      ctx.drawImage(_tintCv, x, y);
      ctx.restore();
      return;
    }
  }
  ctx.drawImage(spr, x, y, w, h);
  ctx.restore();
}

function drawChest(px, py, b) {
  ctx.fillStyle = shade('#7a5a28', b);
  ctx.fillRect(px + 4, py + 7, 12, 9);
  ctx.fillStyle = shade('#9a7434', b);
  ctx.fillRect(px + 4, py + 5, 12, 4);
  ctx.fillStyle = shade('#ffd75e', b);
  ctx.fillRect(px + 9, py + 9, 2, 3);
  ctx.strokeStyle = shade('#3a2c14', b);
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 4.5, py + 5.5, 11, 10);
}

function draw(t) {
  ctx.save();
  ctx.fillStyle = '#0a0a12';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  if (FX.shake > 0) ctx.translate((CRNG.next() - 0.5) * FX.shake, (CRNG.next() - 0.5) * FX.shake);

  if (typeof G === 'undefined' || !G.map) { ctx.restore(); return; }
  const map = G.map, p = G.player;
  const dt60 = G._dt || 1 / 60;

  // ---- camera: center the player, clamp to the map, glide between moves ----
  {
    const { vw, vh } = camView();
    // on phones the bottom ~25% of the screen is HUD + log, so the player
    // rides above center — the boss fight should not happen behind buttons
    const cy = MOBILE_UI ? 0.40 : 0.5;
    const tx2 = clamp((p.rx + 0.5) * CELL - vw / 2, 0, Math.max(0, WORLD_W - vw));
    const ty2 = clamp((p.ry + 0.5) * CELL - vh * cy, 0, Math.max(0, WORLD_H - vh));
    if (CAM.snap) { CAM.x = tx2; CAM.y = ty2; CAM.snap = false; }
    else {
      CAM.x += (tx2 - CAM.x) * Math.min(1, dt60 * 7);
      CAM.y += (ty2 - CAM.y) * Math.min(1, dt60 * 7);
    }
    ctx.scale(CAM.zoom, CAM.zoom);
    ctx.translate(-CAM.x, -CAM.y);
  }
  ctx.font = GLYPH_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // ---- tiles ----
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const i = map.idx(x, y);
      if (!map.explored[i]) continue;
      const vis = G.visible.has(x + ',' + y);
      const tile = map.tiles[i];
      const hash = tileHash(x, y);
      let b;
      if (vis) {
        const d = Math.sqrt(dist2(x, y, p.x, p.y));
        const flick = 0.93 + 0.07 * Math.sin(t / 130 + x * 7.3 + y * 13.7);
        b = clamp(clamp(1.18 - d / (G.fovRadius + 1.5), 0.5, 1.05) * flick + map.light[i] * flick, 0.48, 1.35);
      } else {
        b = 0.3;
      }
      const px = x * CELL, py = y * CELL;
      const wallC = map.theme && map.theme.wall || '#3c3c5a';
      const floorC = map.theme && map.theme.floor || '#1e1e2e';
      if (tile === T.WALL || tile === T.TORCH) {
        const tone = 0.92 + hash * 0.16; // stone variation
        ctx.fillStyle = shade(wallC, b * tone);
        ctx.fillRect(px, py, CELL, CELL);
        ctx.fillStyle = shade(wallC, b * tone * 1.35);
        ctx.fillRect(px, py, CELL, 2);
        // front face when floor is below: pseudo-3D dungeon walls
        if (y + 1 < map.h && tileWalkable(map.tiles[map.idx(x, y + 1)])) {
          const g = ctx.createLinearGradient(px, py + CELL - 7, px, py + CELL);
          g.addColorStop(0, shade(wallC, b * tone * 1.5));
          g.addColorStop(1, shade(wallC, b * tone * 0.85));
          ctx.fillStyle = g;
          ctx.fillRect(px, py + CELL - 7, CELL, 7);
        }
        if (hash > 0.72 && vis) { // mossy fleck
          ctx.fillStyle = shade('#3d5244', b);
          ctx.fillRect(px + 3 + hash * 10, py + 5 + (hash * 53 % 1) * 9, 2, 2);
        }
        if (tile === T.TORCH && vis) {
          const fl = 0.8 + 0.2 * Math.sin(t / 90 + x * 5 + y * 3);
          const g = ctx.createRadialGradient(px + 10, py + 10, 1, px + 10, py + 10, 10);
          g.addColorStop(0, `rgba(255,190,90,${0.95 * fl})`);
          g.addColorStop(1, 'rgba(255,120,30,0)');
          ctx.fillStyle = g;
          ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
          ctx.fillStyle = `rgba(255,230,160,${fl})`;
          ctx.beginPath(); ctx.arc(px + 10, py + 9, 2.4, 0, 7); ctx.fill();
          if (CRNG.chance(0.02)) // drifting embers
            FX.particles.push({ x: px + 10, y: py + 8, vx: (CRNG.next() - 0.5) * 8, vy: -14, life: 0.9, decay: 0.9, color: '#ffb55e', size: 1.5, rise: true });
        }
      } else if (tile === T.WATER) {
        const ripple = 0.85 + 0.15 * Math.sin(t / 480 + x * 1.7 + y * 2.3);
        ctx.fillStyle = shade('#16283e', b * ripple);
        ctx.fillRect(px, py, CELL, CELL);
        if (vis) {
          ctx.fillStyle = `rgba(140,190,235,${0.10 + 0.08 * Math.sin(t / 350 + x * 2.9 + y * 1.3)})`;
          ctx.fillRect(px + 2, py + 6 + 3 * Math.sin(t / 600 + x), CELL - 4, 1.5);
          ctx.fillRect(px + 4, py + 13 + 2 * Math.sin(t / 500 + y), CELL - 8, 1);
        }
      } else {
        const tone = 0.92 + hash * 0.16;
        ctx.fillStyle = shade(floorC, b * tone);
        ctx.fillRect(px, py, CELL, CELL);
        if (hash > 0.8) { // rubble / cracks
          ctx.fillStyle = shade('#22222f', b);
          ctx.fillRect(px + 3 + hash * 8, py + 4 + (hash * 91 % 1) * 10, 3, 1.5);
          ctx.fillRect(px + 11 - hash * 6, py + 13, 1.5, 1.5);
        }
        if (tile === T.FLOOR) {
          ctx.fillStyle = shade('#3c4156', b);
          ctx.fillRect(px + 9, py + 9, 2, 2);
        } else if (tile === T.STAIRS) {
          const pulse = 0.75 + 0.25 * Math.sin(t / 400);
          const g = ctx.createRadialGradient(px + 10, py + 10, 1, px + 10, py + 10, 11);
          g.addColorStop(0, `rgba(126,224,163,${0.22 * pulse})`);
          g.addColorStop(1, 'rgba(126,224,163,0)');
          ctx.fillStyle = g;
          ctx.fillRect(px, py, CELL, CELL);
          const sps = spriteFor('prop_stairs');
          // a full-bleed TILE at full alpha — alpha-dimming was washing out
          // three generations of stair art (user feedback round 4). Round 5:
          // treads descend top-to-bottom into the glow, NO '>' overlay.
          if (sps) ctx.drawImage(sps, px, py, CELL, CELL);
          else {
            ctx.fillStyle = shade('#7ee0a3', b * pulse + 0.3);
            ctx.fillText('>', px + CELL / 2, py + CELL / 2 + 1);
          }
        } else if (tile === T.DARKSTAIRS) {
          const pulse = 0.75 + 0.25 * Math.sin(t / 300);
          const g = ctx.createRadialGradient(px + 10, py + 10, 1, px + 10, py + 10, 11);
          g.addColorStop(0, `rgba(227,93,106,${0.25 * pulse})`);
          g.addColorStop(1, 'rgba(227,93,106,0)');
          ctx.fillStyle = g;
          ctx.fillRect(px, py, CELL, CELL);
          const spd = spriteFor('prop_darkstairs');
          if (spd) ctx.drawImage(spd, px, py, CELL, CELL);
          else {
            ctx.fillStyle = shade('#e35d6a', b * pulse + 0.3);
            ctx.fillText('>', px + CELL / 2, py + CELL / 2 + 1);
          }
        } else if (tile === T.CHEST) {
          const cs = spriteFor('prop_chest');
          if (cs) drawSprite(cs, px + CELL / 2, py + CELL - 2, CELL * 0.85, { alpha: clamp(b, 0.35, 1) });
          else drawChest(px, py, b);
        } else if (tile === T.GOLDCHEST) {
          const pulse = 0.85 + 0.15 * Math.sin(t / 350);
          const gs = spriteFor('prop_goldchest');
          if (gs) {
            drawSprite(gs, px + CELL / 2, py + CELL - 2, CELL * 0.9, { alpha: clamp(b * pulse, 0.4, 1) });
          } else {
            ctx.fillStyle = shade('#8a6a18', b * pulse);
            ctx.fillRect(px + 4, py + 7, 12, 9);
            ctx.fillStyle = shade('#d4a826', b * pulse);
            ctx.fillRect(px + 4, py + 5, 12, 4);
            ctx.fillStyle = shade('#1a1408', b);
            ctx.fillRect(px + 9, py + 9, 2, 4);
            ctx.strokeStyle = shade('#ffd75e', b * pulse);
            ctx.lineWidth = 1;
            ctx.strokeRect(px + 4.5, py + 5.5, 11, 10);
          }
        } else if (tile === T.GILDED) {
          const pulse = 0.8 + 0.2 * Math.sin(t / 380);
          const gg = ctx.createRadialGradient(px + 10, py + 10, 1, px + 10, py + 10, 10);
          gg.addColorStop(0, `rgba(255,215,94,${0.18 * pulse})`);
          gg.addColorStop(1, 'rgba(255,215,94,0)');
          ctx.fillStyle = gg;
          ctx.fillRect(px, py, CELL, CELL);
          const gsp = spriteFor('prop_gilded');
          if (gsp) drawSprite(gsp, px + CELL / 2, py + CELL - 1, CELL * 0.95, { alpha: clamp(b * pulse + 0.2, 0.4, 1) });
          else {
            ctx.fillStyle = shade('#ffd75e', b * pulse + 0.2);
            ctx.fillText('✝', px + CELL / 2, py + CELL / 2 + 1);
          }
        } else if (tile === T.SHRINE) {
          const pulse = 0.7 + 0.3 * Math.sin(t / 420);
          const g = ctx.createRadialGradient(px + 10, py + 10, 1, px + 10, py + 10, 11);
          g.addColorStop(0, `rgba(199,125,255,${0.25 * pulse})`);
          g.addColorStop(1, 'rgba(199,125,255,0)');
          ctx.fillStyle = g;
          ctx.fillRect(px, py, CELL, CELL);
          const ss = spriteFor('prop_shrine');
          if (ss) drawSprite(ss, px + CELL / 2, py + CELL - 1, CELL * 0.95, { alpha: clamp(b * pulse + 0.25, 0.4, 1) });
          else {
            ctx.fillStyle = shade('#c7a4ff', b * pulse + 0.25);
            ctx.fillText('Ψ', px + CELL / 2, py + CELL / 2 + 1);
          }
        } else if (tile === T.TRAP && map.trapSeen[i]) {
          const spt = spriteFor('prop_trap');
          if (spt) drawSprite(spt, px + CELL / 2, py + CELL - 2, CELL * 0.8, { alpha: clamp(b, 0.4, 1) });
          else {
            ctx.fillStyle = shade('#d46a6a', b);
            ctx.fillText('^', px + CELL / 2, py + CELL / 2 + 1);
          }
        }
      }
    }
  }

  // ---- fading corpses ----
  if (G.corpses) {
    ctx.font = GLYPH_FONT;
    for (let i = G.corpses.length - 1; i >= 0; i--) {
      const c = G.corpses[i];
      c.life -= dt60 * 1.1;
      if (c.life <= 0) { G.corpses.splice(i, 1); continue; }
      if (!G.visible.has(c.x + ',' + c.y)) continue;
      const sink = (1 - c.life) * 4;
      const cspr = c.id ? spriteFor(c.id) : null;
      if (cspr) {
        drawSprite(cspr, c.x * CELL + CELL / 2, c.y * CELL + CELL - 2 + sink,
          CELL * 1.1, { alpha: clamp(c.life, 0, 1) * 0.5, flip: c.faceL });
        continue;
      }
      ctx.globalAlpha = clamp(c.life, 0, 1) * 0.55;
      ctx.fillStyle = c.color;
      ctx.fillText(c.glyph, c.x * CELL + CELL / 2, c.y * CELL + CELL / 2 + 1 + sink);
    }
    ctx.globalAlpha = 1;
  }

  // ---- echo of a fallen hero ----
  if (G.echo && G.visible.has(G.echo.x + ',' + G.echo.y)) {
    const fl = 0.3 + 0.18 * Math.sin(t / 350);
    ctx.globalAlpha = fl;
    ctx.fillStyle = '#9fe8ff';
    ctx.fillText('@', G.echo.x * CELL + CELL / 2, G.echo.y * CELL + CELL / 2 + 1 + Math.sin(t / 500) * 1.5);
    ctx.globalAlpha = 1;
  }

  // ---- blood decals ----
  for (const d of G.decals) {
    if (!map.explored[map.idx(d.x, d.y)]) continue;
    const vis = G.visible.has(d.x + ',' + d.y);
    ctx.globalAlpha = vis ? 0.28 : 0.12;
    ctx.fillStyle = d.color;
    const cx = d.x * CELL + CELL / 2 + (d.seed - 0.5) * 8;
    const cy = d.y * CELL + CELL / 2 + ((d.seed * 7) % 1 - 0.5) * 8;
    ctx.beginPath(); ctx.ellipse(cx, cy, 4 + d.seed * 3, 3, d.seed * 3, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + 5, cy + 2, 2, 1.5, 0, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ---- shop wares ----
  if (G.shop) {
    for (const s of G.shop) {
      const i = map.idx(s.x, s.y);
      if (!map.explored[i]) continue;
      const vis = G.visible.has(s.x + ',' + s.y);
      const b = vis ? 1 : 0.4;
      const px = s.x * CELL, py = s.y * CELL;
      // arcane carpet
      ctx.fillStyle = `rgba(120,80,200,${vis ? 0.16 : 0.07})`;
      ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
      ctx.strokeStyle = `rgba(199,164,255,${vis ? 0.4 : 0.15})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 1.5, py + 1.5, CELL - 3, CELL - 3);
      const def = ITEMS[s.id];
      const ws = propSpriteFor(s);
      if (ws) {
        drawSprite(ws, px + CELL / 2, py + CELL - 6, CELL * 0.7, { alpha: vis ? 1 : 0.4 });
      } else {
        ctx.fillStyle = shade(def.color, b);
        ctx.fillText(def.glyph, px + CELL / 2, py + CELL / 2 - 2);
      }
      ctx.font = 'bold 8px Consolas, monospace';
      ctx.fillStyle = shade('#ffd75e', b);
      ctx.fillText(warePrice(s) + '$', px + CELL / 2, py + CELL - 4);
      ctx.font = GLYPH_FONT;
    }
  }

  // ---- ground items ----
  for (const it of G.items) {
    if (!G.visible.has(it.x + ',' + it.y)) continue;
    const def = it.gold ? { glyph: '$', color: '#ffd75e' } : ITEMS[it.id];
    const bob = Math.sin(t / 320 + it.x * 3 + it.y) * 1.2;
    const ps = propSpriteFor(it);
    if (ps) {
      drawSprite(ps, it.x * CELL + CELL / 2, it.y * CELL + CELL - 2 + bob, CELL * 0.85);
    } else {
      ctx.fillStyle = def.color;
      ctx.fillText(def.glyph, it.x * CELL + CELL / 2, it.y * CELL + CELL / 2 + 1 + bob);
    }
  }

  // ---- adjacency ring: the 8 tiles you can actually step to or strike ----
  if (G.state === 'PLAY') {
    const pp = G.player;
    ctx.lineWidth = 1;
    for (const [adx, ady] of DIRS8) {
      const ax = pp.x + adx, ay = pp.y + ady;
      if (!G.map.inBounds(ax, ay)) continue;
      const open = G.map.walkable(ax, ay) && diagOpen(G.map, pp.x, pp.y, adx, ady);
      const occ = monsterAt(ax, ay);
      if (occ && G.visible.has(ax + ',' + ay)) {
        const apulse = 0.5 + 0.5 * Math.sin(t / 110);
        ctx.strokeStyle = `rgba(255,90,90,${0.5 + 0.3 * apulse})`; // a foe in arm's reach
        ctx.lineWidth = 2;
        ctx.strokeRect(ax * CELL + 1.5, ay * CELL + 1.5, CELL - 3, CELL - 3);
        ctx.lineWidth = 1;
      } else if (open) {
        ctx.strokeStyle = 'rgba(245,243,255,0.10)';
        ctx.strokeRect(ax * CELL + 2.5, ay * CELL + 2.5, CELL - 5, CELL - 5);
      }
    }
  }

  // ---- telegraphs: wound-up blows and channeled beams ----
  for (const m of G.monsters) {
    if (m.windup === 1 && G.visible.has(m.x + ',' + m.y)) {
      const pulse = 0.5 + 0.5 * Math.sin(t / 90);
      ctx.fillStyle = `rgba(255,82,82,${0.18 + 0.14 * pulse})`;
      ctx.fillRect(m.windupX * CELL + 1, m.windupY * CELL + 1, CELL - 2, CELL - 2);
      ctx.strokeStyle = `rgba(255,82,82,${0.5 + 0.3 * pulse})`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(m.windupX * CELL + 1.5, m.windupY * CELL + 1.5, CELL - 3, CELL - 3);
    }
    if (m.beam) {
      const pulse = 0.5 + 0.5 * Math.sin(t / 80);
      ctx.fillStyle = `rgba(199,125,255,${0.16 + 0.16 * pulse})`;
      for (const bt of m.beam) ctx.fillRect(bt.x * CELL + 1, bt.y * CELL + 1, CELL - 2, CELL - 2);
    }
  }

  // ---- charge lanes: the bone charger's marked dash path ----
  for (const m of G.monsters) {
    if (!m.lane || !m.lane.length || !G.visible.has(m.x + ',' + m.y)) continue;
    const pulse = 0.5 + 0.5 * Math.sin(t / 75);
    ctx.fillStyle = `rgba(255,120,90,${0.18 + 0.16 * pulse})`;
    for (const lt of m.lane) ctx.fillRect(lt.x * CELL + 1, lt.y * CELL + 1, CELL - 2, CELL - 2);
    const tip = m.lane[m.lane.length - 1];
    ctx.strokeStyle = `rgba(255,120,90,${0.5 + 0.3 * pulse})`;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(tip.x * CELL + 1.5, tip.y * CELL + 1.5, CELL - 3, CELL - 3);
  }

  // ---- lobbed shells: marked landing tile + orthogonal splash, urgency by fuse ----
  for (const sh of (G.shells || [])) {
    const urgent = sh.timer <= 1;
    const pulse = 0.5 + 0.5 * Math.sin(t / (urgent ? 70 : 140));
    for (const z of shellZone(sh)) {
      const a = (z.full ? 0.22 : 0.17) + (z.full ? 0.16 : 0.12) * pulse + (urgent ? 0.08 : 0);
      ctx.fillStyle = `rgba(255,140,30,${a})`;
      ctx.fillRect(z.x * CELL + 1, z.y * CELL + 1, CELL - 2, CELL - 2);
    }
    ctx.strokeStyle = `rgba(255,140,30,${0.55 + 0.35 * pulse})`;
    ctx.lineWidth = urgent ? 2 : 1.25;
    ctx.beginPath();
    ctx.arc(sh.x * CELL + CELL / 2, sh.y * CELL + CELL / 2, CELL * (0.28 + 0.10 * pulse), 0, Math.PI * 2);
    ctx.stroke();
  }

  // ---- monsters (y-sorted so southern sprites correctly overlap northern) ----
  for (const m of [...G.monsters].sort((a, b) => a.y - b.y || a.x - b.x)) {
    easeEntity(m, dt60);
    const onScreen = G.visible.has(m.x + ',' + m.y);
    if (!onScreen) continue;
    const cx = (m.rx + (m.lx || 0)) * CELL + CELL / 2, cy = (m.ry + (m.ly || 0)) * CELL + CELL / 2;
    if (m.elite) {
      const pulse = 0.6 + 0.4 * Math.sin(t / 240);
      ctx.strokeStyle = shade(m.color, 1.2);
      ctx.globalAlpha = 0.55 * pulse;
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - 9, cy - 9, 18, 18);
      ctx.globalAlpha = 1;
      ctx.font = 'bold 17px Consolas, monospace';
    }
    if (m.boss) {
      const fl = 0.5 + 0.5 * Math.sin(t / 200);
      const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 17);
      g.addColorStop(0, `rgba(199,125,255,${0.28 + 0.16 * fl})`);
      g.addColorStop(1, 'rgba(199,125,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - 17, cy - 17, 34, 34);
      ctx.font = 'bold 19px Consolas, monospace';
    } else if (m.mini) {
      ctx.font = 'bold 17px Consolas, monospace';
    }
    // dim rooms swallow sprites — give every visible foe a faint halo of its own color
    const mlb = G.map.light[G.map.idx(m.x, m.y)] || 0;
    if (mlb < 0.18) {
      const hg2 = ctx.createRadialGradient(cx, cy, 2, cx, cy, 13);
      hg2.addColorStop(0, m.color + '3a');
      hg2.addColorStop(1, m.color + '00');
      ctx.fillStyle = hg2;
      ctx.fillRect(cx - 13, cy - 13, 26, 26);
    }
    // tile-base marker: pins the sprite to its true tile in the oblique view
    ctx.beginPath();
    ctx.ellipse(cx, cy + CELL / 2 - 2, 6.5, 2.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10,8,16,0.45)';
    ctx.fill();
    ctx.strokeStyle = m.color + '88';
    ctx.lineWidth = 1;
    ctx.stroke();
    const spr = spriteFor(m.id);
    if (spr) {
      const big = m.boss ? 40 : m.mini ? 32 : CELL * 1.3;
      const hgt = big * (m.id === 'slimelet' ? 0.55 : 1);
      const bob = Math.sin(t / 300 + m.x * 7 + m.y * 3) * 1.2;
      const tint = m.flashT > 0 ? 'rgba(255,255,255,0.85)'
        : m.frozen > 0 ? 'rgba(150,220,255,0.55)' : null;
      drawSprite(spr, cx, cy + CELL / 2 - 1 + bob, hgt, { flip: m.faceL, tint });
    } else {
      let color = m.color;
      if (m.flashT > 0) color = '#ffffff';
      else if (m.frozen > 0) color = '#bdf0ff';
      ctx.fillStyle = color;
      ctx.fillText(m.glyph, cx, cy + 1);
    }
    if (m.frozen > 0) {
      ctx.font = 'bold 9px Consolas, monospace';
      ctx.fillStyle = '#e0f8ff';
      ctx.fillText('❄', cx + 6, cy - 6);
      ctx.font = GLYPH_FONT;
    }
    if (m.windup === 1) {
      ctx.font = 'bold 12px Consolas, monospace';
      ctx.fillStyle = '#ff5252';
      ctx.fillText('!', cx + 7, cy - 7);
    }
    if (m.awake && m.skipT > 0 && m.stirring) {
      // just noticed you — one stunned beat before it acts
      ctx.font = 'bold 10px Consolas, monospace';
      ctx.fillStyle = '#ffd75e';
      ctx.fillText('?', cx + 7, cy - 7);
      ctx.font = GLYPH_FONT;
    }
    if (!m.awake && !m.boss && !m.mini) {
      // dozing — a sneak-attack window, telegraphed
      ctx.font = 'bold 9px Consolas, monospace';
      ctx.fillStyle = `rgba(154,160,184,${0.55 + 0.25 * Math.sin(t / 500)})`;
      ctx.fillText('z', cx + 7, cy - 7);
      ctx.font = GLYPH_FONT;
    }
    if (m.ranged && m.cd > 0 && !m.windup) {
      // dim pip: this archer is reloading and cannot fire this turn
      ctx.fillStyle = 'rgba(154,160,184,0.55)';
      ctx.beginPath();
      ctx.arc(cx + 8, cy - 8, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = GLYPH_FONT;
    m.flashT = Math.max(0, m.flashT - dt60 * 3.5);
    if (m.hp < m.maxHp) {
      const w = m.boss ? 26 : m.mini ? 20 : 16;
      // sit the bar above the sprite's head, not through its chest
      const sprH = spriteFor(m.id) ? (m.boss ? 40 : m.mini ? 32 : CELL * 1.3) : 0;
      const by = sprH ? cy + CELL / 2 - 1 - sprH - 6 : cy - 13;
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      ctx.fillRect(cx - w / 2, by, w, 3);
      ctx.fillStyle = m.hp / m.maxHp > 0.4 ? '#7ee0a3' : '#e35d6a';
      ctx.fillRect(cx - w / 2, by, w * (m.hp / m.maxHp), 3);
    }
  }

  // ---- player ----
  if (G.state === 'PLAY' || G.state === 'PAUSED' || G.state === 'WIN' || G.state === 'DYING') {
    easeEntity(p, dt60);
    const cx = (p.rx + (p.lx || 0)) * CELL + CELL / 2, cy = (p.ry + (p.ly || 0)) * CELL + CELL / 2;
    if (G.state !== 'DYING') {
      const hg = ctx.createRadialGradient(cx, cy, 4, cx, cy, 46);
      hg.addColorStop(0, 'rgba(255,225,160,0.10)');
      hg.addColorStop(1, 'rgba(255,225,160,0)');
      ctx.fillStyle = hg;
      ctx.fillRect(cx - 46, cy - 46, 92, 92);
    }
    const pspr = G.classId ? spriteFor('player_' + G.classId) : null;
    if (pspr) {
      const bob = Math.sin(t / 280) * 1.1;
      const tint = G.state === 'DYING' ? 'rgba(90,10,20,0.75)'
        : p.flashT > 0 ? 'rgba(255,80,80,0.6)' : null;
      drawSprite(pspr, cx, cy + CELL / 2 - 1 + bob, CELL * 1.35, { flip: p.faceL, tint });
    } else {
      ctx.fillStyle = G.state === 'DYING' ? '#7a1620'
        : p.flashT > 0 ? '#ff6b6b'
        : (G.classDef ? G.classDef.glyphColor : '#ffd75e');
      ctx.fillText('@', cx, cy + 1);
    }
    p.flashT = Math.max(0, p.flashT - dt60 * 3.5);
    // base ring drawn last: YOU are always findable under a sprite pile
    ctx.beginPath();
    ctx.ellipse(cx, cy + CELL / 2 - 2, 7.5, 2.8, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,215,94,0.75)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  // ---- impact ghosts: the orb finishing its flight ----
  for (const g of FX.boltGhosts) {
    const gx = g.x * CELL + CELL / 2, gy = g.y * CELL + CELL / 2;
    const gg = ctx.createRadialGradient(gx, gy, 1, gx, gy, 8);
    gg.addColorStop(0, g.color);
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = gg;
    ctx.fillRect(gx - 8, gy - 8, 16, 16);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff4dc';
    ctx.beginPath(); ctx.arc(gx, gy, 2, 0, 7); ctx.fill();
  }

  // ---- projectiles in flight: a visible bolt crossing real space ----
  for (const pr of G.projectiles) {
    if (pr.rx === undefined) { pr.rx = pr.fx; pr.ry = pr.fy; }
    const k = Math.min(1, dt60 * 14);
    pr.rx += (pr.fx - pr.rx) * k;
    pr.ry += (pr.fy - pr.ry) * k;
    const vis = G.visible.has(Math.round(pr.rx) + ',' + Math.round(pr.ry))
      || G.visible.has(Math.round(pr.fx) + ',' + Math.round(pr.fy));
    if (!vis) continue;
    const cx = pr.rx * CELL + CELL / 2, cy = pr.ry * CELL + CELL / 2;
    if (CRNG.chance(0.8)) FX.particles.push({
      x: cx + (CRNG.next() - 0.5) * 4, y: cy + (CRNG.next() - 0.5) * 4,
      vx: -pr.dx * 30 + (CRNG.next() - 0.5) * 12, vy: -pr.dy * 30 + (CRNG.next() - 0.5) * 12,
      life: 0.5, decay: 2.4, color: pr.color, size: 1.5 + CRNG.next() * 1.5,
    });
    const pg = ctx.createRadialGradient(cx, cy, 1, cx, cy, 9);
    pg.addColorStop(0, pr.color);
    pg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = pg;
    ctx.fillRect(cx - 9, cy - 9, 18, 18);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff4dc';
    ctx.beginPath(); ctx.arc(cx, cy, 2.2, 0, 7); ctx.fill();

    // predictive trajectory: the NEXT turn's travel burns bright (committed —
    // nothing can move before it lands there); tiles beyond are grey (the
    // target still gets a move). The intercept ring is solid when locked,
    // dashed when the foe could still step off the line.
    const pulse = 0.6 + 0.4 * Math.sin(t / 110);
    let px2 = pr.fx, py2 = pr.fy;
    const seen = new Set();
    let intercept = null, interceptCommitted = false, lastTx = null, lastTy = null;
    const MAXLOOK = 9 * 2; // half-tile sub-steps, capped lookahead
    for (let s = 0; s < MAXLOOK; s++) {
      px2 += pr.dx / 2; py2 += pr.dy / 2;
      const ttx = Math.round(px2), tty = Math.round(py2);
      if (!G.map.inBounds(ttx, tty) || G.map.opaque(ttx, tty)) break;
      const committed = s < pr.speed * 2; // resolves this coming turn
      const k = ttx + ',' + tty;
      if (!seen.has(k)) {
        seen.add(k);
        ctx.globalAlpha = committed ? 0.12 + 0.08 * pulse : 0.07 + 0.04 * pulse;
        ctx.fillStyle = committed ? pr.color : '#a0a0b4';
        ctx.fillRect(ttx * CELL + 2, tty * CELL + 2, CELL - 4, CELL - 4);
        ctx.globalAlpha = 1;
      }
      if (!intercept) {
        const im = monsterAt(ttx, tty);
        if (im && (pr.fromPlayer || im !== pr.src)) { intercept = [ttx, tty]; interceptCommitted = committed; }
      }
      lastTx = ttx; lastTy = tty;
    }
    const ringX = intercept ? intercept[0] : lastTx, ringY = intercept ? intercept[1] : lastTy;
    if (ringX !== null) {
      ctx.globalAlpha = 0.35 + 0.25 * pulse;
      ctx.strokeStyle = intercept && !interceptCommitted ? '#a0a0b4' : pr.color;
      ctx.lineWidth = 1.5;
      if (intercept && !interceptCommitted) ctx.setLineDash([3, 3]); // it may yet slip the line
      ctx.strokeRect(ringX * CELL + 2.5, ringY * CELL + 2.5, CELL - 5, CELL - 5);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }

  // ---- light & bloom pass: soft additive glows over everything lit ----
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const glow = (gx, gy, r, rgba) => {
    const g = ctx.createRadialGradient(gx, gy, 2, gx, gy, r);
    g.addColorStop(0, rgba);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(gx - r, gy - r, r * 2, r * 2);
  };
  if (G.state !== 'TITLE') {
    const pcx = (p.rx + (p.lx || 0)) * CELL + CELL / 2, pcy = (p.ry + (p.ly || 0)) * CELL + CELL / 2;
    glow(pcx, pcy, 120, 'rgba(255,196,110,0.13)'); // the hero carries warmth
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      if (!G.visible.has(x + ',' + y)) continue;
      const tl = map.tiles[map.idx(x, y)];
      const cx = x * CELL + 10, cy = y * CELL + 10;
      if (tl === T.TORCH) {
        const fl = 0.75 + 0.25 * Math.sin(t / 95 + x * 5 + y * 3);
        glow(cx, cy, 64, `rgba(255,150,50,${0.20 * fl})`);
      } else if (tl === T.STAIRS) glow(cx, cy, 42, `rgba(110,230,160,${0.10 + 0.05 * Math.sin(t / 400)})`);
      else if (tl === T.SHRINE) glow(cx, cy, 46, `rgba(190,120,255,${0.12 + 0.05 * Math.sin(t / 420)})`);
      else if (tl === T.STAIRS) glow(cx, cy, 40, `rgba(126,224,163,${0.14 + 0.07 * Math.sin(t / 380)})`);
      else if (tl === T.GOLDCHEST) glow(cx, cy, 36, 'rgba(255,205,90,0.10)');
    }
    for (const m of G.monsters) {
      if (!G.visible.has(m.x + ',' + m.y)) continue;
      if (m.boss) glow(m.rx * CELL + 10, m.ry * CELL + 10, 90, 'rgba(190,120,255,0.16)');
      if (m.beam) for (const bt of m.beam) glow(bt.x * CELL + 10, bt.y * CELL + 10, 26, 'rgba(190,120,255,0.13)');
    }
  }
  ctx.restore();

  // ---- particles ----
  for (const pt of FX.particles) {
    ctx.globalAlpha = clamp(pt.life, 0, 1);
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
  }
  ctx.globalAlpha = 1;

  // ---- aim hints: faint corner brackets on the foe a READY ability would
  // take (Hades-style 'subtle/discoverable' targeting — live whisper) ----
  if (typeof aimHints === 'function' && G.state === 'PLAY') {
    const pulse = 0.35 + 0.18 * Math.sin(t / 280);
    for (const h of aimHints()) {
      if (!G.visible.has(h.x + ',' + h.y)) continue;
      const bx = h.x * CELL, by = h.y * CELL, L = 5;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = h.color;
      ctx.lineWidth = 1.5;
      for (const [cx2, cy2, sx2, sy2] of [[bx + 1, by + 1, 1, 1], [bx + CELL - 1, by + 1, -1, 1], [bx + 1, by + CELL - 1, 1, -1], [bx + CELL - 1, by + CELL - 1, -1, -1]]) {
        ctx.beginPath();
        ctx.moveTo(cx2 + sx2 * L, cy2);
        ctx.lineTo(cx2, cy2);
        ctx.lineTo(cx2, cy2 + sy2 * L);
        ctx.stroke();
      }
      // the ability's own glyph rides the mark so it explains itself
      // (live whisper: 'the aiming system... kinda just confusing')
      if (h.glyph) {
        ctx.globalAlpha = Math.min(1, pulse + 0.25);
        ctx.fillStyle = h.color;
        ctx.font = 'bold 9px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(h.glyph, bx + CELL / 2, by - 4);
        ctx.font = GLYPH_FONT;
      }
      ctx.restore();
    }
  }

  // ---- hover nameplate ----
  if (FX.hover && G.state === 'PLAY') {
    const { x: hx, y: hy } = FX.hover;
    if (G.visible.has(hx + ',' + hy)) {
      const m = G.monsters.find(mm => mm.x === hx && mm.y === hy);
      const s = G.shop && G.shop.find(ss => ss.x === hx && ss.y === hy);
      const it = G.items.find(ii => ii.x === hx && ii.y === hy);
      let label = null, sub = null;
      if (m) { label = m.name; sub = `${m.hp}/${m.maxHp} hp` + (m.elite ? ' · ELITE' : '') + (!m.awake && !m.boss && !m.mini ? ' · dozing' : ''); }
      else if (s) { label = ITEMS[s.id].name; sub = warePrice(s) + ' gold — step to buy · drops here sell for half'; }
      else if (it) { label = it.gold ? it.gold + ' gold' : ITEMS[it.id].name; }
      else if (map.get(hx, hy) === T.CHEST) { label = 'sealed chest'; sub = 'bump to open'; }
      else if (map.get(hx, hy) === T.GOLDCHEST) { label = 'golden chest'; sub = 'locked — an elite carries the key'; }
      else if (map.get(hx, hy) === T.SHRINE) { label = 'blood shrine'; sub = 'bump to commune'; }
      else if (map.get(hx, hy) === T.GILDED) { label = 'gilded corpse'; sub = 'something glitters in his fist — it will not go unanswered'; }
      else if (map.get(hx, hy) === T.DARKSTAIRS) { label = 'the dark stair'; sub = 'plunges PAST the next floor — the dark rules where you land'; }
      if (label) {
        ctx.font = 'bold 11px Consolas, monospace';
        const w = Math.max(ctx.measureText(label).width, sub ? ctx.measureText(sub).width : 0) + 12;
        const { vw: nvw, vh: nvh } = camView();
        const bx = clamp(hx * CELL + CELL / 2 - w / 2, CAM.x + 2, CAM.x + nvw - w - 2);
        let by = clamp(hy * CELL - (sub ? 32 : 20), CAM.y + 2, CAM.y + nvh - 40);
        // never park the nameplate over a visible monster — an approaching foe
        // hidden behind a price tag reads as 'attacked from nowhere'
        const covers = (yy) => G.monsters.some(mm => G.visible.has(mm.x + ',' + mm.y)
          && mm.x * CELL + CELL > bx && mm.x * CELL < bx + w
          && mm.y * CELL + CELL > yy && mm.y * CELL < yy + (sub ? 28 : 16));
        if (covers(by)) {
          const below = clamp(hy * CELL + CELL + 4, 2, WORLD_H - 40);
          if (!covers(below)) by = below;
        }
        ctx.fillStyle = 'rgba(8,8,16,.78)';
        ctx.fillRect(bx, by, w, sub ? 28 : 16);
        ctx.strokeStyle = 'rgba(199,164,255,.4)';
        ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, sub ? 27 : 15);
        ctx.fillStyle = '#e8e2f0';
        ctx.fillText(label, bx + w / 2, by + 9);
        if (sub) { ctx.fillStyle = '#9a91b8'; ctx.fillText(sub, bx + w / 2, by + 21); }
        ctx.font = GLYPH_FONT;
      }
    }
  }

  // ---- floaters ----
  for (const f of FX.floaters) {
    ctx.font = `bold ${f.size || 13}px Consolas, monospace`;
    ctx.globalAlpha = clamp(f.life, 0, 1);
    ctx.fillStyle = '#000';
    const fx2 = f.banner ? CAM.x + (VIEW_W / CAM.zoom) / 2 : f.x;
    const fy2 = f.banner ? CAM.y + (VIEW_H / CAM.zoom) / 3 + (f.y - VIEW_H / 3) : f.y;
    ctx.fillText(f.text, fx2 + 1, fy2 + 1);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, fx2, fy2);
  }
  ctx.globalAlpha = 1;
  ctx.font = GLYPH_FONT;

  // ---- descent fade + floor card ----
  if (FX.fadeT > 0) {
    const { vw, vh } = camView();
    ctx.globalAlpha = clamp(FX.fadeT, 0, 1);
    ctx.fillStyle = '#05050a';
    ctx.fillRect(CAM.x, CAM.y, vw, vh);
    if (FX.fadeT > 0.15) {
      ctx.font = '28px Consolas, monospace';
      ctx.fillStyle = '#ffd75e';
      ctx.globalAlpha = clamp(FX.fadeT * 1.4, 0, 1);
      ctx.fillText(FX.fadeText, CAM.x + vw / 2, CAM.y + vh / 2);
      ctx.font = GLYPH_FONT;
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/* ---------- minimap ---------- */
const mmCanvas = document.getElementById('minimap');
const mmCtx = mmCanvas.getContext('2d');
function drawMinimap() {
  if (typeof G === 'undefined' || !G.map) return;
  const map = G.map, sx = mmCanvas.width / map.w, sy = mmCanvas.height / map.h;
  mmCtx.fillStyle = '#0a0a12';
  mmCtx.fillRect(0, 0, mmCanvas.width, mmCanvas.height);
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const i = map.idx(x, y);
    if (!map.explored[i]) continue;
    const tl = map.tiles[i];
    let big = false;
    if (tl === T.WALL || tl === T.TORCH) mmCtx.fillStyle = '#2c2c44';
    else if (tl === T.STAIRS) { mmCtx.fillStyle = `rgba(126,224,163,${0.6 + 0.4 * Math.sin(Date.now() / 350)})`; big = true; }
    else if (tl === T.DARKSTAIRS) { mmCtx.fillStyle = '#e35d6a'; big = true; }
    else if (tl === T.WATER) mmCtx.fillStyle = '#1c3450';
    else if (tl === T.CHEST || tl === T.GOLDCHEST) { mmCtx.fillStyle = '#ffd75e'; big = tl === T.GOLDCHEST; }
    else if (tl === T.SHRINE) mmCtx.fillStyle = '#c7a4ff';
    else if (tl === T.TRAP && map.trapSeen[i]) mmCtx.fillStyle = '#a04545';
    else mmCtx.fillStyle = '#15151f';
    if (big) mmCtx.fillRect(x * sx - 1, y * sy - 1, sx + 2, sy + 2);
    else mmCtx.fillRect(x * sx, y * sy, Math.ceil(sx), Math.ceil(sy));
  }
  if (G.shop) for (const s of G.shop) {
    if (map.explored[map.idx(s.x, s.y)]) { mmCtx.fillStyle = '#c7a4ff'; mmCtx.fillRect(s.x * sx, s.y * sy, sx, sy); }
  }
  mmCtx.fillStyle = '#ffd75e';
  mmCtx.fillRect(G.player.x * sx - 1, G.player.y * sy - 1, sx + 2, sy + 2);
  // the floor's weather, stamped on the chart
  if (G.map.theme && G.map.theme.name) {
    mmCtx.font = 'bold 9px Consolas, monospace';
    mmCtx.fillStyle = 'rgba(8,8,16,.75)';
    mmCtx.fillRect(2, mmCanvas.height - 13, mmCtx.measureText(G.map.theme.name).width + 8, 11);
    mmCtx.fillStyle = G.map.theme.wall ? shade(G.map.theme.wall, 2.2) : '#9a91b8';
    mmCtx.fillText(G.map.theme.name, 6, mmCanvas.height - 4);
  }
}

/* ---------- main loop ---------- */
let _lastT = 0;
function frame(t) {
  const dt = Math.min(0.05, (t - _lastT) / 1000);
  _lastT = t;
  if (typeof G !== 'undefined') G._dt = dt;
  updateFX(dt);
  draw(t);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
