// DUSTLINE — bot AI.
// One job: make 7 bots play the objective. Each bot runs a small state
// machine (route / hold / engage / plant / defuse / investigate), follows the
// waypoint graph, and shoots with a reaction time and aim error so fights
// feel fair instead of aimbot-perfect.

import { TEAM, WEAPONS, PLANT_TIME, DEFUSE_TIME } from './config.js';
import { moveEntity, segmentClear } from './map.js';
import { SITES } from './map.js';
import { fireHitscan, eyePos, aimDir } from './combat.js';
import { startReload } from './player.js';

const BOT_SPEED = 3.9;
const PERCEIVE_EVERY = 0.15; // seconds between sight checks (staggered per bot)
const SIGHT_RANGE = 46;

export function makeBotBrain(bot, game) {
  return {
    state: 'route', // route | hold | engage | plant | defuse | investigate | dead
    path: [], // waypoint ids left to walk
    pathTarget: -1,
    holdNode: -1,
    holdUntil: 0,
    target: -1, // enemy fighter id currently engaged
    seenAt: -99, // when the target was last seen
    reactUntil: 0, // firing allowed after this time
    aimError: 0.05, // radians of aim wobble, shrinks while tracking
    burstLeft: 0,
    burstPause: 0,
    perceiveAt: Math.random() * PERCEIVE_EVERY,
    stuckAt: 0, stuckX: 0, stuckZ: 0,
    site: Math.random() < 0.5 ? 'A' : 'B',
    investigateX: 0, investigateZ: 0,
  };
}

export function assignBotLoadouts(game) {
  // Bots buy like players: defenders favour rifles, attackers mix SMG/rifle.
  for (const f of game.fighters) {
    if (f.isPlayer) continue;
    const rifle = f.team === TEAM.DEFEND ? Math.random() < 0.65 : Math.random() < 0.45;
    const id = rifle ? 'kestrel' : 'hornet';
    f.weapons[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve * 2 };
    f.current = id;
    f.grenades = Math.random() < 0.4 ? 1 : 0;
  }
}

// Breadth-first search over the waypoint graph. Returns waypoint ids.
function findPath(waypoints, from, to) {
  if (from === to) return [to];
  const prev = new Array(waypoints.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length) {
    const cur = queue.shift();
    for (const n of waypoints[cur].links) {
      if (prev[n] !== -1) continue;
      prev[n] = cur;
      if (n === to) {
        const path = [to];
        let c = to;
        while (c !== from) { c = prev[c]; path.unshift(c); }
        return path;
      }
      queue.push(n);
    }
  }
  return [to];
}

function nearestWaypoint(waypoints, x, z) {
  let best = 0, bestD = Infinity;
  for (const w of waypoints) {
    const d = (w.x - x) ** 2 + (w.z - z) ** 2;
    if (d < bestD) { bestD = d; best = w.id; }
  }
  return best;
}

function routeTo(bot, waypoints, node) {
  const from = nearestWaypoint(waypoints, bot.x, bot.z);
  bot.bot.path = findPath(waypoints, from, node);
  bot.bot.pathTarget = node;
}

function siteNode(site) {
  return site === 'A' ? 15 : 14;
}

function holdNodeNear(site) {
  // Defender hold spots just off each site.
  return site === 'A' ? [22, 13, 17] : [21, 12, 16];
}

export function planRound(game, waypoints) {
  // Called at round start: give every bot a job.
  const attackers = game.fighters.filter((f) => !f.isPlayer && f.team === TEAM.ATTACK);
  const defenders = game.fighters.filter((f) => f.team === TEAM.DEFEND);
  // Attackers split across the two sites; the bomb carrier goes with the majority.
  attackers.forEach((f, i) => {
    f.bot.site = i < 2 ? 'A' : 'B';
    f.bot.state = 'route';
    routeTo(f, waypoints, siteNode(f.bot.site));
  });
  defenders.forEach((f, i) => {
    f.bot.site = i % 2 === 0 ? 'A' : 'B';
    const spots = holdNodeNear(f.bot.site);
    f.bot.holdNode = spots[i % spots.length];
    f.bot.state = 'route';
    routeTo(f, waypoints, f.bot.holdNode);
  });
}

function canSee(game, colliders, a, b) {
  const ea = eyePos(a), eb = eyePos(b);
  const d = Math.hypot(eb.x - ea.x, eb.y - ea.y, eb.z - ea.z);
  if (d > SIGHT_RANGE) return false;
  // Facing check: b must be in front of a (or very close).
  const fwd = aimDir(a);
  const dot = ((eb.x - ea.x) * fwd.x + (eb.y - ea.y) * fwd.y + (eb.z - ea.z) * fwd.z) / d;
  if (dot < 0.15 && d > 4) return false;
  return segmentClear(colliders, ea.x, ea.y, ea.z, eb.x, eb.y, eb.z);
}

function perceive(game, colliders, bot, time) {
  const b = bot.bot;
  if (time < b.perceiveAt) return;
  b.perceiveAt = time + PERCEIVE_EVERY + Math.random() * 0.05;
  let best = -1, bestD = Infinity;
  for (const f of game.fighters) {
    if (f.team === bot.team || !f.alive) continue;
    const d = Math.hypot(f.x - bot.x, f.z - bot.z);
    if (d < bestD && canSee(game, colliders, bot, f)) { best = f.id; bestD = d; }
  }
  if (best >= 0) {
    // The bomb carrier's job is the site, not the fight: only an enemy close
    // enough to stop the plant pulls the carrier off its route.
    if (bot.hasBomb && bestD > 8) return;
    if (b.target !== best) {
      // First sight of a new enemy: reaction delay before firing.
      b.reactUntil = time + 0.4 + Math.random() * 0.35;
      b.aimError = 0.09;
    }
    b.target = best;
    b.seenAt = time;
    if (b.state !== 'engage') b.state = 'engage';
  } else if (b.target >= 0 && time - b.seenAt > 1.2) {
    // Lost the target: remember where it was and go look.
    const t = game.fighters[b.target];
    b.investigateX = t.x; b.investigateZ = t.z;
    b.target = -1;
    b.state = 'investigate';
    routeTo(bot, game._waypoints, nearestWaypoint(game._waypoints, b.investigateX, b.investigateZ));
  }
  // Hearing: a loud noise nearby pulls bots off their hold — but only the
  // enemy's noise. Your own team's gunfire is not a reason to abandon a site.
  if (b.state === 'hold' || b.state === 'route') {
    for (const n of game.noises) {
      if (time - n.time > 1.5) continue;
      if (n.team !== undefined && n.team === bot.team) continue;
      const d = Math.hypot(n.x - bot.x, n.z - bot.z);
      if (d < 10 * n.loudness + 4 && d > 2) {
        b.investigateX = n.x; b.investigateZ = n.z;
        b.state = 'investigate';
        routeTo(bot, game._waypoints, nearestWaypoint(game._waypoints, n.x, n.z));
        break;
      }
    }
  }
}

function moveToward(bot, colliders, tx, tz, dt, speedMul = 1) {
  const dx = tx - bot.x, dz = tz - bot.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.15) return true;
  const sp = BOT_SPEED * speedMul;
  const vx = (dx / d) * sp;
  const vz = (dz / d) * sp;
  // Face the direction of travel.
  const targetYaw = Math.atan2(-vx, -vz);
  let dy = targetYaw - bot.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  bot.yaw += Math.max(-3.2 * dt, Math.min(3.2 * dt, dy));
  bot.vx = vx; bot.vz = vz;
  moveEntity(colliders, bot, vx * dt, vz * dt, 0.38, 1.72);
  // Stuck detection: barely moved for a while despite trying.
  const b = bot.bot;
  if (Math.hypot(bot.x - b.stuckX, bot.z - b.stuckZ) < 0.05) {
    b.stuckAt += dt;
    if (b.stuckAt > 1.6) {
      b.stuckAt = 0;
      b.path.shift(); // skip the waypoint we cannot reach
    }
  } else {
    b.stuckAt = 0;
    b.stuckX = bot.x; b.stuckZ = bot.z;
  }
  return false;
}

function followPath(bot, colliders, waypoints, dt) {
  const b = bot.bot;
  if (b.path.length === 0) return true;
  const node = waypoints[b.path[0]];
  if (moveToward(bot, colliders, node.x, node.z, dt)) b.path.shift();
  return b.path.length === 0;
}

const _shot = { hit: false, head: false, target: null, damage: 0, endX: 0, endY: 0, endZ: 0, wallT: 0 };

function botShoot(game, colliders, bot, time, dt) {
  const b = bot.bot;
  const target = game.fighters[b.target];
  if (!target || !target.alive) { b.target = -1; return; }
  // Aim at the target's chest with error that shrinks while tracking.
  const ea = eyePos(bot);
  const tx = target.x, ty = target.y + 1.25, tz = target.z;
  const dx = tx - ea.x, dy = ty - ea.y, dz = tz - ea.z;
  const dist = Math.hypot(dx, dy, dz);
  const wantYaw = Math.atan2(-dx, -dz);
  const wantPitch = Math.asin(Math.max(-1, Math.min(1, dy / dist)));
  b.aimError = Math.max(0.02, b.aimError - dt * 0.03);
  const err = b.aimError * (1 + dist / 40) * (bot.team === TEAM.ATTACK ? 0.9 : 1.1);
  const yawErr = (Math.random() - 0.5) * 2 * err;
  const pitchErr = (Math.random() - 0.5) * 2 * err;
  bot.yaw = wantYaw + yawErr;
  bot.pitch = wantPitch + pitchErr;
  bot.spreadBloom = 0;

  if (time < b.reactUntil) return;
  const w = WEAPONS[bot.current];
  bot.fireCooldown = Math.max(0, bot.fireCooldown - dt);
  if (b.burstPause > 0) { b.burstPause -= dt; return; }
  if (b.burstLeft <= 0) {
    b.burstLeft = 3 + Math.floor(Math.random() * 3);
    b.burstPause = 0.55 + Math.random() * 0.7;
  }
  if (bot.fireCooldown <= 0 && bot.reloading <= 0) {
    const ammo = bot.weapons[bot.current];
    if (ammo && ammo.mag > 0) {
      const res = fireHitscan(game, colliders, bot, bot.current, _shot);
      if (res) {
        b.burstLeft--;
        game.events.push({
          type: 'shot', x: ea.x, y: ea.y, z: ea.z,
          endX: res.endX, endY: res.endY, endZ: res.endZ, shooter: bot.id,
        });
        game.noises.push({ x: bot.x, z: bot.z, loudness: 0.7, time, team: bot.team });
        if (res.hit && res.target.isPlayer) game.events.push({ type: 'hitmarker', head: false, victim: true });
      }
    } else {
      startReload(game, bot, null);
    }
  }
}

export function updateBot(game, colliders, waypoints, bot, audio, dt, time) {
  if (!bot.alive) return;
  const b = bot.bot;
  bot.fireCooldown = Math.max(0, bot.fireCooldown - dt);
  if (bot.reloading > 0) {
    bot.reloading -= dt;
    if (bot.reloading <= 0) {
      bot.reloading = 0;
      const w = WEAPONS[bot.current];
      const ammo = bot.weapons[bot.current];
      const take = Math.min(w.mag - ammo.mag, ammo.reserve);
      ammo.mag += take; ammo.reserve -= take;
    }
  }
  // Reload when the mag runs dry, even mid-fight.
  const ammo = bot.weapons[bot.current];
  if (ammo && ammo.mag === 0 && bot.reloading <= 0) startReload(game, bot, null);

  perceive(game, colliders, bot, time);

  const bomb = game.bomb;

  // --- objective states -----------------------------------------------------
  if (bot.hasBomb && bomb.state === 'carried') {
    const site = SITES[b.site];
    const d = Math.hypot(bot.x - site.x, bot.z - site.z);
    if (d <= site.r && b.target < 0) {
      // Plant: stand still in the site.
      b.state = 'plant';
      bot.vx = 0; bot.vz = 0;
      bomb.plantProgress += dt;
      if (Math.floor(bomb.plantProgress * 4) !== Math.floor((bomb.plantProgress - dt) * 4)) {
        game.events.push({ type: 'plantTick', x: bot.x, z: bot.z });
      }
      if (bomb.plantProgress >= PLANT_TIME) {
        bomb.state = 'planted';
        bomb.plantedAt = b.site;
        bomb.fuseLeft = 35;
        bomb.plantProgress = 0;
        bot.hasBomb = false;
        game.events.push({ type: 'bombPlanted', site: b.site, x: site.x, z: site.z });
      }
      return;
    }
    if (b.target < 0 && b.state !== 'route') {
      b.state = 'route';
      routeTo(bot, waypoints, siteNode(b.site));
    }
  }

  if (bomb.state === 'planted' && bot.team === TEAM.DEFEND && b.target < 0) {
    const site = SITES[bomb.plantedAt];
    const d = Math.hypot(bot.x - site.x, bot.z - site.z);
    if (d <= 1.6) {
      b.state = 'defuse';
      bot.vx = 0; bot.vz = 0;
      bomb.defuseProgress += dt;
      bomb.defuser = bot.id;
      if (Math.floor(bomb.defuseProgress * 4) !== Math.floor((bomb.defuseProgress - dt) * 4)) {
        game.events.push({ type: 'defuseTick', x: bot.x, z: bot.z });
      }
      if (bomb.defuseProgress >= DEFUSE_TIME) {
        bomb.state = 'defused';
        game.events.push({ type: 'bombDefused', x: site.x, z: site.z });
      }
      return;
    }
    if (b.state !== 'route') {
      b.state = 'route';
      routeTo(bot, waypoints, siteNode(bomb.plantedAt));
    }
  }

  if (bomb.state === 'dropped' && bot.team === TEAM.ATTACK && b.target < 0) {
    const d = Math.hypot(bot.x - bomb.x, bot.z - bomb.z);
    if (d < 1.2) {
      bomb.state = 'carried';
      bomb.carrier = bot.id;
      bot.hasBomb = true;
      game.events.push({ type: 'bombPickup', x: bot.x, z: bot.z });
      b.state = 'route';
      routeTo(bot, waypoints, siteNode(b.site));
      return;
    }
    if (b.state !== 'route') {
      b.state = 'route';
      routeTo(bot, waypoints, nearestWaypoint(waypoints, bomb.x, bomb.z));
    }
  }

  // --- combat ----------------------------------------------------------------
  if (b.state === 'engage' && b.target >= 0) {
    const target = game.fighters[b.target];
    if (target && target.alive) {
      // Strafe sideways while shooting, keep ~8-18m distance.
      const d = Math.hypot(target.x - bot.x, target.z - bot.z);
      bot.vx = 0; bot.vz = 0;
      if (d > 18) moveToward(bot, colliders, target.x, target.z, dt, 0.7);
      else if (d < 6) moveToward(bot, colliders, bot.x + (bot.x - target.x), bot.z + (bot.z - target.z), dt, 0.6);
      else {
        // Sidestep: perpendicular drift, flip direction every couple of seconds.
        const dir = (Math.floor(time / 2.4) % 2 === 0) ? 1 : -1;
        const px = -(target.z - bot.z) / Math.max(1, d) * dir;
        const pz = (target.x - bot.x) / Math.max(1, d) * dir;
        moveEntity(colliders, bot, px * BOT_SPEED * 0.55 * dt, pz * BOT_SPEED * 0.55 * dt, 0.38, 1.72);
      }
      botShoot(game, colliders, bot, time, dt);
      return;
    }
    b.target = -1;
  }

  // --- navigation -------------------------------------------------------------
  if (b.state === 'route' || b.state === 'investigate') {
    if (followPath(bot, colliders, waypoints, dt)) {
      if (b.state === 'investigate') {
        b.state = 'hold';
        b.holdUntil = time + 2.5;
      } else {
        b.state = 'hold';
        b.holdUntil = time + 999; // hold the spot until something happens
      }
    }
    // Scan while walking: slow yaw sweep.
    bot.pitch = 0;
    return;
  }

  if (b.state === 'hold') {
    bot.vx = 0; bot.vz = 0;
    // Slow scanning sweep across the lane.
    bot.yaw += Math.sin(time * 0.45 + bot.id * 1.7) * 0.35 * dt;
    bot.pitch = 0;
    // After a plant, attackers fall back to hold near the site.
    if (bomb.state === 'planted' && bot.team === TEAM.ATTACK && b.target < 0) {
      const site = SITES[bomb.plantedAt];
      const d = Math.hypot(bot.x - site.x, bot.z - site.z);
      if (d > 9) {
        b.state = 'route';
        routeTo(bot, waypoints, siteNode(bomb.plantedAt));
      }
    }
  }
}
