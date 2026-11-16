// DUSTLINE — shared constants: weapons, economy, timings.
// One job: every tunable number in one place so the sim, HUD and bots agree.

export const TICK = 1 / 60; // fixed simulation step (seconds)
export const ROUND_TIME = 100; // seconds of live play per round
export const FREEZE_TIME = 12; // buy phase at the start of each round
export const BOMB_TIME = 35; // fuse after planting
export const PLANT_TIME = 3; // seconds holding E to plant
export const DEFUSE_TIME = 5; // seconds holding E to defuse
export const ROUNDS_TO_WIN = 5; // first to 5 takes the match
export const MAX_ROUNDS = 9;
export const PLAYER_RADIUS = 0.38;
export const PLAYER_HEIGHT = 1.72;
export const PLAYER_EYE = 1.58;
export const CROUCH_EYE = 1.08;
export const GRAVITY = 22;
export const WALK_SPEED = 4.6;
export const CROUCH_SPEED = 2.3;
export const JUMP_SPEED = 7.2;

export const TEAM = { ATTACK: 0, DEFEND: 1 };
export const TEAM_NAME = ['VANGUARD', 'ROOK'];
export const TEAM_COLOR = [0x2fae9e, 0xe06428]; // teal attackers, rust defenders

// name, price, mag, reserve, damage(body), headshot x, interval(s), auto, spread(deg),
// moveSpread(deg), recoil(deg), range, reload(s), tracer color, sound pitch
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 SIDEARM', short: 'P9', price: 0, mag: 12, reserve: 48,
    damage: 26, headMul: 3.2, interval: 0.16, auto: false, spread: 0.9,
    moveSpread: 2.6, recoil: 1.1, range: 60, reload: 1.4, pitch: 1.5,
  },
  hornet: {
    id: 'hornet', name: 'HORNET-9 SMG', short: 'HORNET', price: 900, mag: 28, reserve: 112,
    damage: 22, headMul: 3.0, interval: 0.085, auto: true, spread: 1.4,
    moveSpread: 3.4, recoil: 0.9, range: 45, reload: 2.1, pitch: 1.9,
  },
  kestrel: {
    id: 'kestrel', name: 'KESTREL-5 RIFLE', short: 'KESTREL', price: 2100, mag: 25, reserve: 75,
    damage: 34, headMul: 3.4, interval: 0.115, auto: true, spread: 0.7,
    moveSpread: 2.8, recoil: 1.5, range: 90, reload: 2.5, pitch: 1.0,
  },
};
export const WEAPON_ORDER = ['p9', 'hornet', 'kestrel'];

export const GRENADE = {
  id: 'frag', name: 'FRAG-6 GRENADE', price: 300, damage: 110, radius: 7.5,
  fuse: 1.7, throwSpeed: 15,
};

export const BUY_ITEMS = [
  { id: 'hornet', kind: 'weapon', name: 'HORNET-9 SMG', price: 900, desc: 'Fast, close-quarters spray. 28-round mag.' },
  { id: 'kestrel', kind: 'weapon', name: 'KESTREL-5 RIFLE', price: 2100, desc: 'Accurate at range. 25-round mag, heavy punch.' },
  { id: 'frag', kind: 'grenade', name: 'FRAG-6 GRENADE', price: 300, desc: 'Bounces once, then bursts. Clears corners.' },
  { id: 'vest', kind: 'vest', name: 'KEVLAR VEST', price: 650, desc: 'Absorbs half of incoming damage.' },
];

export const ECONOMY = {
  startMoney: 800,
  kill: 300,
  roundWin: 3250,
  roundLoss: 1900,
  plant: 300,
};

// Bot names — original callsigns, one per bot.
export const BOT_NAMES = {
  [TEAM.ATTACK]: ['MIRA', 'DUNE', 'HAVOC'],
  [TEAM.DEFEND]: ['SABLE', 'ORIN', 'VESK', 'TALON'],
};
