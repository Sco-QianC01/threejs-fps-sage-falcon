// DUSTLINE — the one place all game state lives.
// Everything mutable about a match is on the object createGame() returns; modules
// read and write it, but nothing else keeps its own copy of match state.

import { TEAM, WEAPONS, ECONOMY } from './config.js';

export const PHASE = {
  MENU: 'menu', // start screen, world visible behind it
  FREEZE: 'freeze', // buy phase, players locked in spawn
  LIVE: 'live', // round in progress
  ROUND_END: 'roundEnd', // short pause, then next round
  MATCH_END: 'matchEnd',
};

export function makeFighter(id, name, team, isPlayer) {
  return {
    id, name, team, isPlayer,
    // kinematics
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
    vx: 0, vy: 0, vz: 0, onGround: true, crouch: false,
    // health
    hp: 100, armor: 0, alive: true,
    // loadout
    weapons: { p9: { mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve } },
    current: 'p9', grenades: 0, reloading: 0, fireCooldown: 0,
    spreadBloom: 0, recoilPitch: 0, ads: false,
    // bomb
    hasBomb: false,
    // combat feedback
    lastDamageFrom: null, lastDamageTime: -99,
    // bot brain (unused by the player)
    bot: null,
    // rendering (filled in by main.js)
    mesh: null, viewmodel: null,
  };
}

export function createGame() {
  const fighters = [];
  fighters.push(makeFighter(0, 'YOU', TEAM.ATTACK, true));
  let id = 1;
  for (const name of ['MIRA', 'DUNE', 'HAVOC']) {
    fighters.push(makeFighter(id++, name, TEAM.ATTACK, false));
  }
  for (const name of ['SABLE', 'ORIN', 'VESK', 'TALON']) {
    fighters.push(makeFighter(id++, name, TEAM.DEFEND, false));
  }
  return {
    phase: PHASE.MENU,
    round: 1,
    score: [0, 0], // rounds won per team
    kills: [0, 0],
    time: 0, // seconds in the current phase
    freezeLeft: 0,
    roundTimeLeft: 0,
    roundEndLeft: 0,
    roundWinner: -1,
    roundReason: '',
    matchWinner: -1,
    money: ECONOMY.startMoney,
    playerKills: 0,
    playerDeaths: 0,
    fighters,
    bomb: {
      state: 'carried', // carried | dropped | planted | defused | exploded
      carrier: 0, // fighter id while carried
      x: 0, y: 0, z: 0,
      plantProgress: 0, defuseProgress: 0, defuser: -1,
      fuseLeft: 0, plantedAt: null, // 'A' | 'B'
    },
    // events the HUD / audio consume once per tick (cleared by main.js)
    events: [],
    // grenades in flight
    grenades: [],
    // noise events bots hear: {x, z, loudness, time}
    noises: [],
    // spectate target while the player is dead
    spectateId: -1,
    // stats for the end screen
    log: [],
  };
}

export function aliveOf(game, team) {
  let n = 0;
  for (const f of game.fighters) if (f.team === team && f.alive) n++;
  return n;
}

export function fighterById(game, id) {
  return game.fighters[id];
}

export function playerOf(game) {
  return game.fighters[0];
}
