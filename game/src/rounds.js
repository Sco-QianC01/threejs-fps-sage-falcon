// DUSTLINE — rounds and money.
// One job: the match clock. Freeze/buy, live play, win checks, payouts, and
// the next round's setup. It never touches rendering or input directly.

import { TEAM, ECONOMY, FREEZE_TIME, ROUND_TIME, BOMB_TIME, ROUNDS_TO_WIN, MAX_ROUNDS, WEAPONS } from './config.js';
import { PHASE, aliveOf, playerOf } from './state.js';
import { SPAWNS, SITES } from './map.js';
import { planRound, assignBotLoadouts, makeBotBrain } from './bots.js';

export function startMatch(game) {
  game.score = [0, 0];
  game.round = 1;
  game.money = ECONOMY.startMoney;
  game.playerKills = 0;
  game.playerDeaths = 0;
  game.matchWinner = -1;
  game.log = [];
  startRound(game);
}

export function startRound(game) {
  const waypoints = game._waypoints;
  game.phase = PHASE.FREEZE;
  game.freezeLeft = FREEZE_TIME;
  game.roundTimeLeft = ROUND_TIME;
  game.time = 0;
  game.roundWinner = -1;
  game.roundReason = '';
  game.grenades.length = 0;
  game.noises.length = 0;
  game.bomb.state = 'carried';
  game.bomb.plantProgress = 0;
  game.bomb.defuseProgress = 0;
  game.bomb.defuser = -1;
  game.bomb.fuseLeft = 0;
  game.bomb.plantedAt = null;
  game.spectateId = -1;

  // Spawn everyone, full health, fresh magazines.
  game.fighters.forEach((f, i) => {
    const wasAlive = f.alive;
    f.alive = true;
    f.hp = 100;
    f.vx = 0; f.vy = 0; f.vz = 0;
    f.reloading = 0; f.fireCooldown = 0;
    f.spreadBloom = 0; f.recoilPitch = 0;
    f.hasBomb = false;
    f.crouch = false;
    const spawn = f.team === TEAM.ATTACK ? SPAWNS.attack[i % SPAWNS.attack.length] : SPAWNS.defend[i % SPAWNS.defend.length];
    // Defenders use the later slots so the four of them spread out.
    const s = f.team === TEAM.DEFEND ? SPAWNS.defend[(i + 2) % SPAWNS.defend.length] : spawn;
    f.x = s[0]; f.z = s[1]; f.y = 0;
    f.yaw = f.team === TEAM.ATTACK ? Math.PI : 0;
    f.pitch = 0;
    // The dead keep nothing; the living keep their guns. A new round restocks
    // the magazines of whatever each fighter still owns.
    if (!wasAlive && game.round > 1) {
      f.weapons = { p9: { mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve } };
      f.current = 'p9';
      f.grenades = 0;
      f.armor = 0;
    }
    for (const id of Object.keys(f.weapons)) {
      f.weapons[id].mag = WEAPONS[id].mag;
      f.weapons[id].reserve = WEAPONS[id].reserve;
    }
    if (!f.weapons[f.current]) f.current = 'p9';
    if (!f.bot && !f.isPlayer) f.bot = makeBotBrain(f, game);
    if (f.bot) { f.bot.state = 'route'; f.bot.target = -1; f.bot.path = []; }
  });

  // The player carries the bomb; bots get their loadouts and jobs.
  const player = playerOf(game);
  player.hasBomb = true;
  game.bomb.carrier = player.id;
  assignBotLoadouts(game);
  planRound(game, waypoints);

  game.events.push({ type: 'roundStart', round: game.round });
}

export function endRound(game, winner, reason) {
  if (game.phase !== PHASE.LIVE && game.phase !== PHASE.FREEZE) return;
  game.phase = PHASE.ROUND_END;
  game.roundEndLeft = 4;
  game.roundWinner = winner;
  game.roundReason = reason;
  game.score[winner]++;
  const playerWon = winner === TEAM.ATTACK;
  game.money += playerWon ? ECONOMY.roundWin : ECONOMY.roundLoss;
  game.log.push(`Round ${game.round}: ${winner === TEAM.ATTACK ? 'VANGUARD' : 'ROOK'} wins — ${reason}`);
  game.events.push({ type: 'roundEnd', winner, reason });
  if (game.score[winner] >= ROUNDS_TO_WIN || game.round >= MAX_ROUNDS) {
    game.phase = PHASE.MATCH_END;
    game.matchWinner = game.score[0] > game.score[1] ? TEAM.ATTACK : TEAM.DEFEND;
    game.events.push({ type: 'matchEnd', winner: game.matchWinner });
  }
}

// Called every fixed tick while a round is live.
export function updateRounds(game, dt) {
  if (game.phase === PHASE.FREEZE) {
    game.freezeLeft -= dt;
    if (game.freezeLeft <= 0) {
      game.phase = PHASE.LIVE;
      game.time = 0;
      game.events.push({ type: 'roundLive' });
    }
    return;
  }
  if (game.phase === PHASE.ROUND_END) {
    game.roundEndLeft -= dt;
    if (game.roundEndLeft <= 0) {
      if (game.phase === PHASE.MATCH_END) return;
      game.round++;
      startRound(game);
    }
    return;
  }
  if (game.phase !== PHASE.LIVE) return;

  game.roundTimeLeft -= dt;

  // Bomb fuse.
  const bomb = game.bomb;
  if (bomb.state === 'planted') {
    bomb.fuseLeft -= dt;
    if (bomb.fuseLeft <= 10 && Math.floor(bomb.fuseLeft) !== Math.floor(bomb.fuseLeft + dt)) {
      game.events.push({ type: 'bombBeep', x: SITES[bomb.plantedAt].x, z: SITES[bomb.plantedAt].z });
    }
    if (bomb.fuseLeft <= 0) {
      bomb.state = 'exploded';
      game.events.push({ type: 'explosion', x: SITES[bomb.plantedAt].x, y: 1, z: SITES[bomb.plantedAt].z, owner: -1, big: true });
      endRound(game, TEAM.ATTACK, 'The device detonated');
      return;
    }
  }
  if (bomb.state === 'defused') {
    endRound(game, TEAM.DEFEND, 'The device was defused');
    return;
  }

  // Elimination wins.
  const atk = aliveOf(game, TEAM.ATTACK);
  const def = aliveOf(game, TEAM.DEFEND);
  if (atk === 0) { endRound(game, TEAM.DEFEND, 'VANGUARD eliminated'); return; }
  if (def === 0) {
    if (bomb.state === 'planted') {
      // Attackers still win only if the bomb goes off; defenders are gone,
      // so the plant stands — count it now to keep the round moving.
      endRound(game, TEAM.ATTACK, 'ROOK eliminated — site held');
    } else {
      endRound(game, TEAM.ATTACK, 'ROOK eliminated');
    }
    return;
  }

  // Clock runs out with no plant: defenders hold the yard.
  if (game.roundTimeLeft <= 0) {
    if (bomb.state === 'planted') return; // fuse decides from here
    endRound(game, TEAM.DEFEND, 'Time expired — sites held');
  }
}

// --- buy menu ---------------------------------------------------------------

export function buyItem(game, itemId, audio) {
  const player = playerOf(game);
  if (game.phase !== PHASE.FREEZE) return { ok: false, why: 'The buy phase is over' };
  const item = { hornet: WEAPONS.hornet, kestrel: WEAPONS.kestrel }[itemId];
  if (itemId === 'frag') {
    if (game.money < 300) return { ok: false, why: 'Not enough money' };
    if (player.grenades >= 2) return { ok: false, why: 'Already carrying two' };
    game.money -= 300;
    player.grenades++;
    audio.buy();
    return { ok: true };
  }
  if (itemId === 'vest') {
    if (game.money < 650) return { ok: false, why: 'Not enough money' };
    if (player.armor >= 100) return { ok: false, why: 'Vest already full' };
    game.money -= 650;
    player.armor = 100;
    audio.buy();
    return { ok: true };
  }
  if (item) {
    if (game.money < item.price) return { ok: false, why: 'Not enough money' };
    if (player.weapons[itemId]) return { ok: false, why: 'Already owned' };
    game.money -= item.price;
    player.weapons[itemId] = { mag: item.mag, reserve: item.reserve };
    player.current = itemId;
    audio.buy();
    return { ok: true };
  }
  return { ok: false, why: 'Unknown item' };
}
