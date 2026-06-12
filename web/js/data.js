'use strict';

/* ---------- classes ---------- */
const CLASSES = {
  warrior: {
    name: 'Warrior', color: '#ffd75e', glyphColor: '#ffd75e',
    hp: 42, atk: 8, def: 2, crit: 0.08, fov: 8, mana: 0, dodge: 0,
    blurb: 'Heavy hands, heavier patience.',
    perks: ['42 HP · 8 ATK · 2 DEF', 'blocks: armor dulls the first hit each turn', 'V Cleave · B Charge · G Bulwark'],
    start: ['w_dagger', 'a_leather', 'potion_heal'],
  },
  rogue: {
    name: 'Rogue', color: '#7ee0a3', glyphColor: '#a8f0c0',
    hp: 38, atk: 7, def: 1, crit: 0.25, fov: 9, mana: 0, dodge: 0.18, sneak: 2, senses: true,
    blurb: 'The dark is a tool. So is a knife.',
    perks: ['25% crits · 18% evasion', 'senses traps · stealthy · +1 sight', 'V Shadow Dash · B Vault'],
    start: ['w_dagger', 'potion_heal', 'scroll_tele'],
  },
  mage: {
    name: 'Mage', color: '#9ecbff', glyphColor: '#a8d4ff',
    hp: 34, atk: 4, def: 0, crit: 0.05, fov: 8, mana: 20, dodge: 0.05,
    blurb: 'Why swing steel when reality bends?',
    perks: ['20 mana · 4 spells', 'wards: mana drinks half of every blow', 'F bolt · G nova · H mend · V blink'],
    start: ['potion_heal', 'scroll_fire'],
  },
  pilgrim: {
    name: 'Pilgrim', color: '#e8d9a8', glyphColor: '#f0e4bc',
    hp: 33, atk: 6, def: 0, crit: 0.05, fov: 8, mana: 0, dodge: 0.15, pilgrim: true,
    blurb: 'He owns nothing. The road provides.',
    perks: ['33 HP \u00b7 6 ATK \u00b7 0 DEF \u00b7 15% sidestep', 'a FREE relic every floor \u2014 they stack forever', 'Providence: the road spares him ONCE \u00b7 V Prostrate'],
    start: ['w_walk', 'potion_heal'],
  },
  mirrorblade: {
    name: 'Mirrorblade', color: '#bde0ff', glyphColor: '#d2ecff',
    hp: 38, atk: 7, def: 2, crit: 0.12, fov: 8, mana: 0, dodge: 0.08, mirror: true,
    blurb: 'Their blow. Your blade.',
    perks: ['38 HP \u00b7 7 ATK \u00b7 12% crit', 'V Mirror Stance: parry the next blow, answer DOUBLE', 'Perfect Read: a parried species takes +2 all run'],
    start: ['w_dagger', 'potion_heal'],
  },
  gravedigger: {
    name: 'Gravedigger', color: '#cfa86d', glyphColor: '#e0c089',
    hp: 40, atk: 8, def: 1, crit: 0.08, fov: 8, mana: 0, dodge: 0.05, digger: true,
    blurb: 'The dead owe him work.',
    perks: ['40 HP \u00b7 8 ATK \u00b7 1 DEF', 'grave-ward: +1 DEF while a shambler walks', 'V Exhume a shambler \u00b7 B Last Rites'],
    start: ['w_dagger', 'potion_heal'],
  },
};

/* ---------- relics: the pilgrim's road-gifts — small, pure, and they stack ---------- */
const RELICS = {
  r_sting:     { name: 'Nettle Sting',      desc: '+1 attack' },
  r_hide:      { name: 'Oxhide Page',       desc: '+6 max HP, healed in full' },
  r_ward:      { name: 'Pewter Icon',       desc: '+1 defense' },
  r_quick:     { name: 'Swallow Feather',   desc: '+4% dodge' },
  r_beastbane: { name: 'Hunter\'s Psalm',   desc: '+2 damage to beasts (rats, bats, spiders, slimes, trolls)' },
  r_bonebane:  { name: 'Litany of Dust',    desc: '+2 damage to the risen dead (skeletons, wraiths, chargers, the Lich)' },
  r_lantern:   { name: 'Vigil Lantern',     desc: '+1 sight' },
  r_soles:     { name: 'Tireless Soles',    desc: 'heal 3 every time you descend' },
  r_alms:      { name: 'Alms Bowl',         desc: '+35 gold, blessed into your purse now' },
  r_psalter:   { name: 'Dog-eared Psalter', desc: '+8% critical chance' },
  r_clarity:   { name: 'Clear Eye',         desc: 'you sense hidden traps, as a rogue does' },
  r_thorn:     { name: 'Crown of Briars',   desc: 'melee attackers take 1 damage back' },
  r_chalice:   { name: 'Tin Chalice',       desc: 'potions heal +4 more' },
  r_zeal:      { name: 'Martyr\'s Knot',    desc: '+2 attack while below 30% HP' },
  r_beacon:    { name: 'Coin of Passage',   desc: '+10% gold from every source' },
};
const RELIC_BEASTS = new Set(['rat', 'bat', 'spider', 'slime', 'slimelet', 'troll']);
const RELIC_BONES = new Set(['skeleton', 'wraith', 'charger', 'lich']);

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
  { key: 'V', name: 'Blink', cost: 6, desc: 'step through space to a CHOSEN visible tile (≤4)' },
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
  // mechanic boons (widget 0d979881): choices that bend ABILITIES, not stats
  b_thrift:      { name: 'Frugal Weave',   desc: 'all spells cost 1 less mana (minimum 2)', w: 2, rarity: 'rare', cls: 'mage' },
  b_overchannel: { name: 'Overchannel',    desc: 'firebolt hits +4 harder — but costs 1 more', w: 2, rarity: 'rare', cls: 'mage' },
  b_stonewall:   { name: 'Stonewall',      desc: 'planting your Bulwark staggers all adjacent foes', w: 2, rarity: 'rare', cls: 'warrior' },
  b_aftershock:  { name: 'Aftershock',     desc: 'foes that survive your Cleave are staggered a turn', w: 2, rarity: 'rare', cls: 'warrior' },
  b_thirdgrave:  { name: 'The Third Grave', desc: 'a THIRD shambler may walk for you', w: 2, rarity: 'rare', cls: 'gravedigger' },
  b_coldrest:    { name: 'Cold Rest',       desc: 'corpses keep for 30 turns instead of 18', w: 3, rarity: 'rare', cls: 'gravedigger' },
  b_embalmer:    { name: 'Embalmer\'s Art', desc: 'Last Rites also purge all venom from your veins', w: 2, rarity: 'rare', cls: 'gravedigger' },
  b_slipvault:   { name: 'Slipstream',     desc: 'Vault resets Shadow Dash', w: 2, rarity: 'rare', cls: 'rogue' },
  b_springheel:  { name: 'Spring-Heel',    desc: 'Vault recovers 3 turns faster', w: 2, rarity: 'rare', cls: 'rogue' },
  b_font:     { name: 'Mana Font',       desc: '+8 max mana, +1 mana on kill — but −4 max HP', w: 3, rarity: 'rare', cls: 'mage' },
  b_blaze:    { name: 'Closer Flame',    desc: 'firebolt full power to 5 tiles — but costs +1 mana', w: 2, rarity: 'rare', cls: 'mage' },
  // ability modifiers — gifts that change what your buttons DO
  b_breaker:  { name: 'Charge Breaker',  desc: 'Shield Charge leaves its target reeling — it loses its next turn', w: 3, rarity: 'rare', cls: 'warrior', once: true },
  b_juggern:  { name: 'Juggernaut',      desc: 'Shield Charge reaches 6 tiles', w: 3, rarity: 'common', cls: 'warrior', once: true },
  b_fade:     { name: 'Vanishing Strike', desc: 'after Shadow Dash, foes within 2 tiles lose you for a beat — they stir', w: 3, rarity: 'rare', cls: 'rogue', once: true },
  b_rhythm:   { name: 'Hunter\'s Rhythm', desc: 'backstab KILLS fully refresh Shadow Dash', w: 3, rarity: 'common', cls: 'rogue', once: true },
  b_fork:     { name: 'Forked Flame',    desc: 'when your firebolt kills, it leaps to the nearest foe in sight at half power', w: 3, rarity: 'rare', cls: 'mage', once: true },
  b_frost:    { name: 'Deep Freeze',     desc: 'Frost Nova holds foes 5 turns, and the frozen take +2 from your blade', w: 3, rarity: 'common', cls: 'mage', once: true },
};

function boonPool() {
  // rarity must MEAN something: raw weights had rares drawing ~70% of all
  // cards (harness audit, widget ad254c3e). Commons carry the draft now.
  const RARITY_W = { common: 4, rare: 1, legendary: 1.5 }; // legendary ≈ 2.5% of draws — rare, not mythical
  return Object.entries(BOONS)
    .filter(([id, b]) => (!b.cls || b.cls === G.classId) && !(G.player.boons[id] && (b.rarity !== 'common' || b.once)))
    .map(([id, b]) => [id, b.w * (RARITY_W[b.rarity] || 1)]);
}

/* ---------- the Sanctum: permanent unlocks bought with soul embers ---------- */
const SANCTUM = {
  s_flask:  { name: 'Traveler\'s Flask', desc: 'begin every run with +1 healing potion', cost: 15 },
  s_map:    { name: 'Cartographer\'s Gift', desc: 'begin with a scroll of revelation', cost: 20 },
  s_purse:  { name: 'Inheritance', desc: 'begin with 25 gold', cost: 25 },
  s_stone:  { name: 'Whetstone of the First Floor', desc: '+1 starting attack', cost: 40 },
  s_ring:   { name: 'The Lich\'s Bargain', desc: 'begin with a random ring (he insists)', cost: 50 },
  s_fourth: { name: 'Boon of the Deep', desc: 'boon choices offer 4 options instead of 3', cost: 60 },
  // the tree grows (widget 1c465414): deeper kindlings, each rooted in a first
  s_flask2: { name: 'Deeper Flask', desc: 'the flask holds a potion of vigor as well', cost: 55, requires: 's_flask' },
  s_lore:   { name: 'Keeper\'s Lore', desc: 'begin each floor knowing where the stairs lie', cost: 45, requires: 's_map' },
  s_purse2: { name: 'Estate', desc: 'the inheritance grows to 60 gold', cost: 60, requires: 's_purse' },
  s_stone2: { name: 'Anvil of the First Floor', desc: '+1 starting defense', cost: 70, requires: 's_stone' },
  // the embers never go dead (endgame menu #2): two REPEATABLE sinks
  s_torch:  { name: 'Kindle a Torch', desc: 'set one more flame against the dark — forever. A monument, nothing more.', cost: 10, repeat: true, counter: 'arcaneTorches' },
  s_cache:  { name: 'Traveler\'s Cache', desc: 'bury a scroll for a future self — your next run starts with one more, once per purchase', cost: 30, repeat: true, counter: 'arcaneCache' },
};

const ELITE_MODS = {
  frenzied: { name: 'frenzied', desc: '+50% attack, sometimes strikes twice' },
  armored:  { name: 'armored',  desc: '+3 defense, +60% health' },
  venomous: { name: 'venomous', desc: 'every hit poisons' },
};

/* ---------- monsters ---------- */
const MONSTERS = {
  rat:      { name: 'giant rat',      glyph: 'r', color: '#b08968', hp: 6,   atk: 3,  def: 0, xp: 4,  sight: 7,  minD: 1, maxD: 2 , lore: "The first thing the dark sends. Not the last." },
  bat:      { name: 'cave bat',       glyph: 'b', color: '#9b8ec4', hp: 5,   atk: 2,  def: 0, xp: 3,  sight: 9,  minD: 1, maxD: 3, erratic: true , lore: "It does not hunt you. It simply cannot fly straight." },
  goblin:   { name: 'goblin',         glyph: 'g', color: '#8fbf6f', hp: 10,  atk: 4,  def: 1, xp: 7,  sight: 8,  minD: 1, maxD: 3 , lore: "Found the stairs once. Sold the map to no one." },
  slime:    { name: 'amber slime',    glyph: 'j', color: '#e8c95e', hp: 12,  atk: 3,  def: 0, xp: 8,  sight: 6,  minD: 2, maxD: 4, splits: true , lore: "Cut it and you have two problems, both still hungry." },
  slimelet: { name: 'slimelet',       glyph: 'j', color: '#f0dc9a', hp: 4,   atk: 2,  def: 0, xp: 2,  sight: 6,  minD: 9, maxD: 0 , lore: "A problem's smaller, faster half." },
  spider:   { name: 'fang spider',    glyph: 'x', color: '#c47ab8', hp: 8,   atk: 3,  def: 0, xp: 8,  sight: 8,  minD: 2, maxD: 5, venom: true , lore: "Its venom outlives its body. Plan accordingly." },
  skeleton: { name: 'skeleton',       glyph: 's', color: '#d8d8d0', hp: 14,  atk: 5,  def: 1, xp: 10, sight: 8,  minD: 2, maxD: 4 , lore: "Someone's bad decision, still standing." },
  shaman:   { name: 'gnoll shaman',   glyph: 'S', color: '#5ec4a8', hp: 14,  atk: 4,  def: 1, xp: 14, sight: 9,  minD: 3, maxD: 6, healer: true , lore: "It mends the dark's own. Silence it first." },
  cultist:  { name: 'blood cultist',  glyph: 'c', color: '#d35d8e', hp: 12,  atk: 6,  def: 1, xp: 14, sight: 9,  minD: 3, maxD: 5, ranged: true, drain: true , lore: "Trades its blood for yours at a rate it likes." },
  charger:  { name: 'bone charger',   glyph: 'H', color: '#d8cfc0', hp: 18,  atk: 6,  def: 2, xp: 16, sight: 9,  minD: 2, maxD: 5, charger: true , lore: "Reads the lane, paws the ground, and tells you exactly where it will be. Believe it." },
  lobber:   { name: 'cinder lobber',  glyph: 'L', color: '#e89a3c', hp: 13,  atk: 7,  def: 1, xp: 18, sight: 9,  minD: 3, maxD: 6, lobber: true , lore: "Throws fire on a timer. The mark on the floor is a promise." },
  golem:    { name: 'stone golem',    glyph: 'G', color: '#9a9ab0', hp: 40,  atk: 9,  def: 4, xp: 45, sight: 6,  minD: 4, maxD: 6, heavy: true, slow: true , lore: "Old masonry with a grudge. Slow, and entirely sure of itself." },
  orc:      { name: 'orc warrior',    glyph: 'o', color: '#6f9f5a', hp: 20,  atk: 6,  def: 2, xp: 16, sight: 8,  minD: 3, maxD: 5, heavy: true , lore: "Rears back before the blow that matters. Step anywhere else." },
  wraith:   { name: 'wraith',         glyph: 'w', color: '#8fd3e8', hp: 16,  atk: 7,  def: 1, xp: 20, sight: 10, minD: 4, maxD: 6, ranged: true , lore: "A bolt with a memory of being a person." },
  troll:    { name: 'cave troll',     glyph: 'T', color: '#7a9e7e', hp: 34,  atk: 8,  def: 3, xp: 30, sight: 7,  minD: 5, maxD: 6, regen: true, heavy: true , lore: "Wounds close while you watch. Finish what you start." },
  demon:    { name: 'flame demon',    glyph: 'D', color: '#e8744f', hp: 30,  atk: 10, def: 2, xp: 40, sight: 10, minD: 5, maxD: 6, ranged: true , lore: "The furnace's opinion of you, delivered at range." },
  warlord:  { name: 'Gruk the Warlord', glyph: 'W', color: '#e8a05e', hp: 52, atk: 9,  def: 3, xp: 60, sight: 10, minD: 9, maxD: 0, mini: true, heavy: true , lore: "Gruk guards the stairs. Gruk ALWAYS guards." },
  lich:     { name: 'Vyrakhel the Lich', glyph: 'Ω', color: '#c77dff', hp: 185, atk: 13, def: 4, xp: 0, sight: 12, minD: 9, maxD: 0, ranged: true, boss: true , lore: "Vyrakhel sealed the depths for a reason. He is the reason." },
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
  w_walk:       { name: 'walking staff',       glyph: '/', color: '#c9b08a', kind: 'weapon', bonus: 1, price: () => 8 },
  w_dagger:     { name: 'iron dagger',         glyph: '/', color: '#b9c2d0', kind: 'weapon', bonus: 2, price: () => 25 },
  w_sword:      { name: 'steel sword',         glyph: '/', color: '#d8e2f0', kind: 'weapon', bonus: 4, price: () => 35 },
  w_axe:        { name: 'dwarven battleaxe',   glyph: '/', color: '#e8c97a', kind: 'weapon', bonus: 6, price: () => 90 },
  w_rune:       { name: 'runeblade',           glyph: '/', color: '#9ee8ff', kind: 'weapon', bonus: 9, price: () => 75 },
  // weapons with souls (widget 2777b20b): the trait IS the reason to wield it
  w_staff:      { name: 'ashwood staff',       glyph: '/', color: '#c9a87a', kind: 'weapon', bonus: 3, trait: 'mana',   effect: '+6 max mana while wielded',        price: () => 45 },
  w_orb:        { name: 'soulglass orb',       glyph: '/', color: '#b48fe8', kind: 'weapon', bonus: 5, trait: 'siphon', effect: 'kills siphon +1 more mana',        price: () => 80 },
  w_maul:       { name: 'tempest maul',        glyph: '/', color: '#e8b05e', kind: 'weapon', bonus: 5, trait: 'tempo',  effect: 'abilities return 2 turns sooner',  price: () => 80 },
  w_fangs:      { name: 'twin fangs',          glyph: '/', color: '#7ee0a3', kind: 'weapon', bonus: 4, trait: 'shadow', effect: 'backstabs bite one tier deeper',   price: () => 70 },
  a_leather:    { name: 'leather armor',       glyph: '[', color: '#b08968', kind: 'armor', bonus: 1, price: () => 20 },
  a_chain:      { name: 'chainmail',           glyph: '[', color: '#b9c2d0', kind: 'armor', bonus: 3, price: () => 32 },
  a_plate:      { name: 'plate armor',         glyph: '[', color: '#d8e2f0', kind: 'armor', bonus: 5, price: () => 85 },
  a_dragon:     { name: 'dragonscale mail',    glyph: '[', color: '#7ee0a3', kind: 'armor', bonus: 7, price: () => 75 },
  ring_regen:   { name: 'ring of regeneration',glyph: '○', color: '#7ee0a3', kind: 'ring', effect: 'heals 1 HP / 5 turns', price: () => 45 },
  ring_might:   { name: 'ring of might',       glyph: '○', color: '#ff8c5e', kind: 'ring', effect: '+2 attack', price: () => 62 },
  ring_guard:   { name: 'ring of warding',     glyph: '○', color: '#9ecbff', kind: 'ring', effect: '+2 defense', price: () => 62 },
  ring_focus:   { name: 'ring of focus',       glyph: '○', color: '#c7a4ff', kind: 'ring', effect: '+1 sight · doubles mana flow', price: () => 58 },
  ring_swift:   { name: 'ring of the zephyr',  glyph: '○', color: '#a8f0c0', kind: 'ring', effect: '+8% dodge', price: () => 55 },
  ring_blood:   { name: 'ring of the leech',   glyph: '○', color: '#e35d6a', kind: 'ring', effect: 'kills feed you 1 HP', price: () => 60 },
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
  // caster gear only falls for casters: +6 max mana on a warrior is dead
  // weight, and a veteran playtest rolled the staff 3 times in 9 on
  // sword-hands while never once seeing fangs/maul/orb
  const caster = typeof G !== 'undefined' && G.classDef && G.classDef.mana > 0;
  if (d <= 2) pool.push(['w_dagger', 1], ['a_leather', 1]);
  if (d >= 2 && d <= 4) pool.push(['w_sword', 3], ['a_chain', 3]);
  if (caster && d >= 2 && d <= 4) pool.push(['w_staff', 3]);
  if (d >= 3) pool.push(['ring_regen', 1], ['ring_might', 1], ['ring_guard', 1], ['ring_focus', 1],
    ['ring_swift', 1], ['ring_blood', 1], ['w_fangs', 3]);
  if (d >= 4) pool.push(['w_axe', 2], ['a_plate', 2], ['w_maul', 2]);
  if (caster && d >= 4) pool.push(['w_orb', 2]);
  if (d >= 5) pool.push(['w_rune', 1], ['a_dragon', 1]);
  return pool;
}

/* shop stock: one consumable, one scroll, one piece of gear
   floor 2: starter gear at starter wallets · floor 4: rings (the only gear with no free source)
   floor 5: the premium sink before the Lich */
function shopStockForDepth(d) {
  const consumables = ['potion_heal', 'potion_anti', 'potion_vigor', 'elixir_str'];
  const scrolls = ['scroll_fire', 'scroll_tele', 'scroll_map'];
  const caster = typeof G !== 'undefined' && G.classDef && G.classDef.mana > 0;
  if (d >= 5) return ['potion_heal',
    RNG.pick(caster ? ['w_rune', 'a_dragon', 'w_orb', 'w_orb'] : ['w_rune', 'a_dragon', 'w_maul']),
    RNG.pick(['ring_might', 'ring_guard', 'ring_focus', 'ring_swift', 'ring_blood'])];
  const gear = d <= 2 ? (caster ? ['w_staff', 'w_staff', 'a_chain', 'ring_regen'] : ['w_sword', 'a_chain', 'ring_regen'])
    : ['ring_might', 'ring_guard', 'ring_focus', 'ring_regen', 'ring_swift', 'ring_blood', 'w_fangs', 'w_maul'];
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
