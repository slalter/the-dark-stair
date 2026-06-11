'use strict';

/* ---------- classes ---------- */
const CLASSES = {
  warrior: {
    name: 'Warrior', color: '#ffd75e', glyphColor: '#ffd75e',
    hp: 42, atk: 8, def: 2, crit: 0.08, fov: 8, mana: 0, dodge: 0,
    blurb: 'Heavy hands, heavier patience.',
    perks: ['42 HP · 8 ATK · 2 DEF', 'starts armed & armored', 'V: Cleave — strike all adjacent'],
    start: ['w_dagger', 'a_leather', 'potion_heal'],
  },
  rogue: {
    name: 'Rogue', color: '#7ee0a3', glyphColor: '#a8f0c0',
    hp: 38, atk: 7, def: 1, crit: 0.25, fov: 9, mana: 0, dodge: 0.18, sneak: 2, senses: true,
    blurb: 'The dark is a tool. So is a knife.',
    perks: ['25% crits · 18% evasion', 'senses hidden traps', 'stealthy · +1 sight'],
    start: ['w_dagger', 'potion_heal', 'scroll_tele'],
  },
  mage: {
    name: 'Mage', color: '#9ecbff', glyphColor: '#a8d4ff',
    hp: 34, atk: 4, def: 0, crit: 0.05, fov: 8, mana: 20, dodge: 0.05,
    blurb: 'Why swing steel when reality bends?',
    perks: ['20 mana · 4 spells', 'F bolt · G nova · H mend · V blink', 'fragile but devastating'],
    start: ['potion_heal', 'scroll_fire'],
  },
};

/* ---------- difficulty ---------- */
const DIFFICULTIES = {
  story: {
    name: 'Adventurer', color: '#7ee0a3',
    tagline: 'a gentler dark — for explorers',
    playerHp: 1.3, monHp: 0.85, monAtk: 0.8,
    eliteCh: 0.05, dreadAt: 220, scoreMult: 0.7,
    // the gentler dark stays gentle at the bottom: slower summons, a softer
    // beam, stronger potions (casual playtests died 100% at the endgame)
    lichSummonInterval: 6, lichBeamMult: 1.5, potionMult: 1.5,
    // shells and charges are guaranteed hits for players who don't read
    // telegraphs yet — soften them here so the gentler dark stays gentle
    telegraphMult: 0.6,
  },
  standard: {
    name: 'Veteran', color: '#ffd75e',
    tagline: 'the depths as intended',
    playerHp: 1, monHp: 1, monAtk: 1,
    eliteCh: 0.1, dreadAt: 160, scoreMult: 1,
  },
  nightmare: {
    name: 'Nightmare', color: '#e35d6a',
    tagline: 'the dark usually wins',
    playerHp: 0.9, monHp: 1.15, monAtk: 1.15,
    eliteCh: 0.2, dreadAt: 120, scoreMult: 1.5,
  },
};

const SPELLS = [
  { key: 'F', name: 'Firebolt', cost: 5, desc: 'sears the nearest visible foe — full power within 3 tiles, weaker beyond' },
  { key: 'G', name: 'Frost Nova', cost: 8, desc: 'freezes all foes within 2 tiles' },
  { key: 'H', name: 'Mend', cost: 6, desc: 'knits your wounds' },
  { key: 'V', name: 'Blink', cost: 4, desc: 'step through space to a visible tile (≤5)' },
];

/* ---------- boons: between-floor gifts that define a build ---------- */
const BOONS = {
  // modest pure gifts (common)
  b_vigor:    { name: 'Deep Vigor',      desc: '+8 max HP, healed in full', w: 4, rarity: 'common' },
  b_edge:     { name: 'Whetted Edge',    desc: '+1 attack', w: 4, rarity: 'common' },
  b_purse:    { name: 'Coin Sense',      desc: '+30% gold from every source', w: 3, rarity: 'common' },
  // bargains — power that costs something (rare)
  b_chill:    { name: 'Chill Aura',      desc: 'foes beside you falter 25% of the time — but −6 max HP', w: 3, rarity: 'rare' },
  b_fleet:    { name: 'Fleetfoot',       desc: '+15% dodge — but the dark hunts 40 turns sooner', w: 3, rarity: 'rare' },
  b_glass:    { name: 'Glass Edge',      desc: '+3 attack — but −1 defense', w: 3, rarity: 'rare' },
  b_pact:     { name: 'Blood Pact',      desc: '+14 max HP — but potions heal half', w: 3, rarity: 'rare' },
  b_vamp:     { name: 'Red Thirst',      desc: 'kills restore 1 HP — but −5 max HP now', w: 3, rarity: 'rare' },
  b_keen:     { name: 'Killer\'s Eye',   desc: '+12% critical chance — but −4 max HP', w: 3, rarity: 'rare' },
  b_greed:    { name: 'Midas Hunger',    desc: '+60% gold — but merchants charge +25%', w: 2, rarity: 'rare' },
  b_momentum: { name: 'Momentum',        desc: '+1 attack per kill (max +3) — resets when hit', w: 3, rarity: 'rare' },
  b_adrenal:  { name: 'Adrenaline',      desc: '+3 attack while below 30% HP', w: 3, rarity: 'rare' },
  b_thorns:   { name: 'Iron Thorns',     desc: 'melee attackers take 2 damage back', w: 2, rarity: 'rare' },
  b_regen:    { name: 'Troll Blood',     desc: 'regenerate every 8 turns — but healing potions heal half', w: 2, rarity: 'rare' },
  // legendary
  b_second:   { name: 'Second Wind',     desc: 'once per floor, survive a killing blow at 1 HP', w: 1, rarity: 'legendary' },
  b_reaper:   { name: 'Reaper\'s Due',   desc: 'kills grant +1 gold — but the dark hunts 20 turns sooner', w: 1, rarity: 'legendary' },
  // class bargains
  b_cleave:   { name: 'Berserker\'s Arc', desc: 'Cleave cooldown 10 → 5 — but each Cleave costs 2 HP', w: 3, rarity: 'rare', cls: 'warrior' },
  b_bulwark:  { name: 'Shield Rhythm',   desc: 'after you Cleave, +3 defense for 4 turns', w: 2, rarity: 'rare', cls: 'warrior' },
  b_shadow:   { name: 'Deeper Shadows',  desc: 'backstabs deal ×4 — but −8% dodge', w: 3, rarity: 'rare', cls: 'rogue' },
  b_ghost:    { name: 'Ghost Step',      desc: '+8% dodge and monsters notice you 1 tile later', w: 2, rarity: 'rare', cls: 'rogue' },
  b_font:     { name: 'Mana Font',       desc: '+8 max mana, +1 mana on kill — but −4 max HP', w: 3, rarity: 'rare', cls: 'mage' },
  b_blaze:    { name: 'Closer Flame',    desc: 'firebolt full power to 5 tiles — but costs +1 mana', w: 2, rarity: 'rare', cls: 'mage' },
  // ability modifiers — gifts that change what your buttons DO
  b_breaker:  { name: 'Charge Breaker',  desc: 'Shield Charge leaves its target reeling — it loses its next turn', w: 2, rarity: 'rare', cls: 'warrior' },
  b_juggern:  { name: 'Juggernaut',      desc: 'Shield Charge reaches 6 tiles', w: 3, rarity: 'common', cls: 'warrior' },
  b_fade:     { name: 'Vanishing Strike', desc: 'after Shadow Dash, foes within 2 tiles lose you for a beat — they stir', w: 2, rarity: 'rare', cls: 'rogue' },
  b_rhythm:   { name: 'Hunter\'s Rhythm', desc: 'backstab KILLS refund 6 turns of Shadow Dash', w: 3, rarity: 'common', cls: 'rogue' },
  b_fork:     { name: 'Forked Flame',    desc: 'when your firebolt kills, it leaps to the nearest foe in sight at half power', w: 2, rarity: 'rare', cls: 'mage' },
  b_frost:    { name: 'Deep Freeze',     desc: 'Frost Nova holds foes 5 turns, and the frozen take +2 from your blade', w: 3, rarity: 'common', cls: 'mage' },
};

function boonPool() {
  return Object.entries(BOONS)
    .filter(([id, b]) => (!b.cls || b.cls === G.classId) && !(G.player.boons[id] && b.rarity !== 'common'))
    .map(([id, b]) => [id, b.w]);
}

/* ---------- the Sanctum: permanent unlocks bought with soul embers ---------- */
const SANCTUM = {
  s_flask:  { name: 'Traveler\'s Flask', desc: 'begin every run with +1 healing potion', cost: 15 },
  s_map:    { name: 'Cartographer\'s Gift', desc: 'begin with a scroll of revelation', cost: 20 },
  s_purse:  { name: 'Inheritance', desc: 'begin with 25 gold', cost: 25 },
  s_stone:  { name: 'Whetstone of the First Floor', desc: '+1 starting attack', cost: 40 },
  s_ring:   { name: 'The Lich\'s Bargain', desc: 'begin with a random ring (he insists)', cost: 50 },
  s_fourth: { name: 'Boon of the Deep', desc: 'boon choices offer 4 options instead of 3', cost: 60 },
};

const ELITE_MODS = {
  frenzied: { name: 'frenzied', desc: '+50% attack, sometimes strikes twice' },
  armored:  { name: 'armored',  desc: '+3 defense, +60% health' },
  venomous: { name: 'venomous', desc: 'every hit poisons' },
};

/* ---------- monsters ---------- */
const MONSTERS = {
  rat:      { name: 'giant rat',      glyph: 'r', color: '#b08968', hp: 6,   atk: 3,  def: 0, xp: 4,  sight: 7,  minD: 1, maxD: 2 },
  bat:      { name: 'cave bat',       glyph: 'b', color: '#9b8ec4', hp: 5,   atk: 2,  def: 0, xp: 3,  sight: 9,  minD: 1, maxD: 3, erratic: true },
  goblin:   { name: 'goblin',         glyph: 'g', color: '#8fbf6f', hp: 10,  atk: 4,  def: 1, xp: 7,  sight: 8,  minD: 1, maxD: 3 },
  slime:    { name: 'amber slime',    glyph: 'j', color: '#e8c95e', hp: 12,  atk: 3,  def: 0, xp: 8,  sight: 6,  minD: 2, maxD: 4, splits: true },
  slimelet: { name: 'slimelet',       glyph: 'j', color: '#f0dc9a', hp: 4,   atk: 2,  def: 0, xp: 2,  sight: 6,  minD: 9, maxD: 0 },
  spider:   { name: 'fang spider',    glyph: 'x', color: '#c47ab8', hp: 8,   atk: 3,  def: 0, xp: 8,  sight: 8,  minD: 2, maxD: 5, venom: true },
  skeleton: { name: 'skeleton',       glyph: 's', color: '#d8d8d0', hp: 14,  atk: 5,  def: 1, xp: 10, sight: 8,  minD: 2, maxD: 4 },
  shaman:   { name: 'gnoll shaman',   glyph: 'S', color: '#5ec4a8', hp: 14,  atk: 4,  def: 1, xp: 14, sight: 9,  minD: 3, maxD: 6, healer: true },
  cultist:  { name: 'blood cultist',  glyph: 'c', color: '#d35d8e', hp: 12,  atk: 6,  def: 1, xp: 14, sight: 9,  minD: 3, maxD: 5, ranged: true, drain: true },
  charger:  { name: 'bone charger',   glyph: 'H', color: '#d8cfc0', hp: 18,  atk: 6,  def: 2, xp: 16, sight: 9,  minD: 2, maxD: 5, charger: true },
  lobber:   { name: 'cinder lobber',  glyph: 'L', color: '#e89a3c', hp: 13,  atk: 7,  def: 1, xp: 18, sight: 9,  minD: 3, maxD: 6, lobber: true },
  golem:    { name: 'stone golem',    glyph: 'G', color: '#9a9ab0', hp: 40,  atk: 9,  def: 4, xp: 45, sight: 6,  minD: 4, maxD: 6, heavy: true, slow: true },
  orc:      { name: 'orc warrior',    glyph: 'o', color: '#6f9f5a', hp: 20,  atk: 6,  def: 2, xp: 16, sight: 8,  minD: 3, maxD: 5, heavy: true },
  wraith:   { name: 'wraith',         glyph: 'w', color: '#8fd3e8', hp: 16,  atk: 7,  def: 1, xp: 20, sight: 10, minD: 4, maxD: 6, ranged: true },
  troll:    { name: 'cave troll',     glyph: 'T', color: '#7a9e7e', hp: 34,  atk: 8,  def: 3, xp: 30, sight: 7,  minD: 5, maxD: 6, regen: true, heavy: true },
  demon:    { name: 'flame demon',    glyph: 'D', color: '#e8744f', hp: 30,  atk: 10, def: 2, xp: 40, sight: 10, minD: 5, maxD: 6, ranged: true },
  warlord:  { name: 'Gruk the Warlord', glyph: 'W', color: '#e8a05e', hp: 52, atk: 9,  def: 3, xp: 60, sight: 10, minD: 9, maxD: 0, mini: true, heavy: true },
  lich:     { name: 'Vyrakhel the Lich', glyph: 'Ω', color: '#c77dff', hp: 185, atk: 13, def: 4, xp: 0, sight: 12, minD: 9, maxD: 0, ranged: true, boss: true },
};

function monsterPoolForDepth(d) {
  const pool = [];
  for (const [id, m] of Object.entries(MONSTERS)) {
    if (m.boss || m.mini || d < m.minD || d > m.maxD) continue;
    const span = m.maxD - m.minD + 1;
    const w = 3 + Math.min(span, 3) - Math.abs((d - m.minD) - span / 2);
    pool.push([id, w]);
  }
  return pool;
}

/* ---------- items ---------- */
const ITEMS = {
  potion_heal:  { name: 'healing potion',      glyph: '!', color: '#e35d6a', kind: 'potion', stack: true, price: d => 12 + 4 * d },
  potion_anti:  { name: 'antidote',            glyph: '!', color: '#8fe05e', kind: 'potion', stack: true, price: d => 10 + 3 * d },
  potion_vigor: { name: 'potion of vigor',     glyph: '!', color: '#ff9ecb', kind: 'potion', stack: true, price: d => 30 + 5 * d },
  elixir_str:   { name: 'elixir of strength',  glyph: '!', color: '#ffb55e', kind: 'potion', stack: true, price: d => 35 + 5 * d },
  scroll_fire:  { name: 'scroll of firestorm', glyph: '?', color: '#ff8c5e', kind: 'scroll', stack: true, price: d => 22 + 6 * d },
  scroll_tele:  { name: 'scroll of blinking',  glyph: '?', color: '#9ecbff', kind: 'scroll', stack: true, price: d => 18 + 5 * d },
  scroll_map:   { name: 'scroll of revelation',glyph: '?', color: '#c7a4ff', kind: 'scroll', stack: true, price: d => 15 + 4 * d },
  w_dagger:     { name: 'iron dagger',         glyph: '/', color: '#b9c2d0', kind: 'weapon', bonus: 2, price: () => 25 },
  w_sword:      { name: 'steel sword',         glyph: '/', color: '#d8e2f0', kind: 'weapon', bonus: 4, price: () => 35 },
  w_axe:        { name: 'dwarven battleaxe',   glyph: '/', color: '#e8c97a', kind: 'weapon', bonus: 6, price: () => 90 },
  w_rune:       { name: 'runeblade',           glyph: '/', color: '#9ee8ff', kind: 'weapon', bonus: 9, price: () => 75 },
  a_leather:    { name: 'leather armor',       glyph: '[', color: '#b08968', kind: 'armor', bonus: 1, price: () => 20 },
  a_chain:      { name: 'chainmail',           glyph: '[', color: '#b9c2d0', kind: 'armor', bonus: 3, price: () => 32 },
  a_plate:      { name: 'plate armor',         glyph: '[', color: '#d8e2f0', kind: 'armor', bonus: 5, price: () => 85 },
  a_dragon:     { name: 'dragonscale mail',    glyph: '[', color: '#7ee0a3', kind: 'armor', bonus: 7, price: () => 75 },
  ring_regen:   { name: 'ring of regeneration',glyph: '○', color: '#7ee0a3', kind: 'ring', effect: 'heals 1 HP / 5 turns', price: () => 45 },
  ring_might:   { name: 'ring of might',       glyph: '○', color: '#ff8c5e', kind: 'ring', effect: '+2 attack', price: () => 62 },
  ring_guard:   { name: 'ring of warding',     glyph: '○', color: '#9ecbff', kind: 'ring', effect: '+2 defense', price: () => 62 },
  ring_focus:   { name: 'ring of focus',       glyph: '○', color: '#c7a4ff', kind: 'ring', effect: '+1 sight · doubles mana flow', price: () => 58 },
};

function itemPoolForDepth(d) {
  const pool = [
    ['potion_heal', 10],
    ['scroll_tele', 3],
    ['scroll_map', 2],
    ['scroll_fire', d >= 2 ? 4 : 1],
    ['potion_vigor', 2],
    ['elixir_str', 2],
  ];
  if (d >= 2) pool.push(['potion_anti', 3]);
  if (d <= 2) pool.push(['w_dagger', 1], ['a_leather', 1]);
  if (d >= 2 && d <= 4) pool.push(['w_sword', 3], ['a_chain', 3]);
  if (d >= 3) pool.push(['ring_regen', 1], ['ring_might', 1], ['ring_guard', 1], ['ring_focus', 1]);
  if (d >= 4) pool.push(['w_axe', 2], ['a_plate', 2]);
  if (d >= 5) pool.push(['w_rune', 1], ['a_dragon', 1]);
  return pool;
}

/* shop stock: one consumable, one scroll, one piece of gear
   floor 2: starter gear at starter wallets · floor 4: rings (the only gear with no free source)
   floor 5: the premium sink before the Lich */
function shopStockForDepth(d) {
  const consumables = ['potion_heal', 'potion_anti', 'potion_vigor', 'elixir_str'];
  const scrolls = ['scroll_fire', 'scroll_tele', 'scroll_map'];
  if (d >= 5) return ['potion_heal', RNG.pick(['w_rune', 'a_dragon']), RNG.pick(['ring_might', 'ring_guard', 'ring_focus'])];
  const gear = d <= 2 ? ['w_sword', 'a_chain', 'ring_regen']
    : ['ring_might', 'ring_guard', 'ring_focus', 'ring_regen'];
  return [RNG.pick(consumables), RNG.pick(scrolls), RNG.pick(gear)];
}

/* ---------- floor themes: every descent should feel different ---------- */
const FLOOR_THEMES = {
  plain:     { w: 5, name: '' },
  flooded:   { w: 2, minD: 2, name: 'FLOODED HALLS',
               msg: 'Black water sheets over the stone here. Bad footing in the pools — harder to dodge.',
               wall: '#2e4258', floor: '#182430', pools: [5, 8] },
  lightless: { w: 2, minD: 2, name: 'THE LIGHTLESS',
               msg: 'Every torch is dead. The dark drinks your sight.',
               wall: '#2a2a3e', floor: '#14141e', fovMod: -2, noTorches: true, goldMult: 1.5 },
  infested:  { w: 2, minD: 3, name: 'THE BROODING DARK',
               msg: 'Chittering from every wall. And glints of gold…',
               wall: '#3a2f4a', floor: '#1f1a28', packChance: 0.6, countMod: 2, lootMod: 2, goldMult: 1.5 },
  furnace:   { w: 2, minD: 3, name: 'THE FURNACE',
               msg: 'Heat shimmers off the stone. Ember vents stud the floor — and they burn whatever steps on them.',
               wall: '#4a2c1e', floor: '#2a160e', trapMod: 4, goldMult: 1.3 },
  bonehalls: { w: 1, minD: 3, name: 'HALLS OF BONE',
               msg: 'Bones carpet this place. They remember walking.',
               wall: '#44424c', floor: '#23222a', monoPool: 'skeleton', lootMod: 1 },
};
function pickTheme(d) {
  if (d === 1 || d === FINAL_DEPTH) return FLOOR_THEMES.plain;
  const pool = Object.entries(FLOOR_THEMES)
    .filter(([, t]) => !t.minD || d >= t.minD)
    .map(([k, t]) => [k, t.w]);
  return FLOOR_THEMES[RNG.weighted(pool)];
}
