// DUSTLINE — hitscan, damage and grenades.
// One job: answer "did this shot hit anyone?" and "how much does it hurt?"
// Fighters are two stacked boxes (head, body) so headshots are a real hit test.

import { rayBox, traceMap, segmentClear } from './map.js';
import { PLAYER_RADIUS, PLAYER_HEIGHT, WEAPONS } from './config.js';

// Scratch vectors kept out of the hot loop.
const _dir = { x: 0, y: 0, z: 0 };

export function eyePos(f) {
  return { x: f.x, y: f.y + (f.crouch ? 1.08 : 1.58), z: f.z };
}

export function aimDir(f) {
  const cp = Math.cos(f.pitch);
  return {
    x: -Math.sin(f.yaw) * cp,
    y: Math.sin(f.pitch),
    z: -Math.cos(f.yaw) * cp,
  };
}

// A fighter's hitboxes in world space. Head sits on top of the body box.
export function hitBoxes(f) {
  const crouch = f.crouch;
  const h = crouch ? 1.15 : PLAYER_HEIGHT;
  const r = PLAYER_RADIUS;
  return {
    head: {
      minX: f.x - r * 0.62, maxX: f.x + r * 0.62,
      minY: f.y + h - 0.32, maxY: f.y + h,
      minZ: f.z - r * 0.62, maxZ: f.z + r * 0.62,
    },
    body: {
      minX: f.x - r, maxX: f.x + r,
      minY: f.y, maxY: f.y + h - 0.32,
      minZ: f.z - r, maxZ: f.z + r,
    },
  };
}

// Fire one hitscan shot from `shooter`. Returns a result object reused by the
// caller (fx, HUD, sounds) — or null when the shot cannot be taken.
export function fireHitscan(game, colliders, shooter, weaponId, out) {
  const w = WEAPONS[weaponId];
  const ammo = shooter.weapons[weaponId];
  if (!ammo || ammo.mag <= 0 || shooter.reloading > 0 || shooter.fireCooldown > 0) return null;
  ammo.mag--;
  shooter.fireCooldown = w.interval;

  // Spread grows with movement, bloom and recoil; ADS and crouch shrink it.
  const moving = Math.hypot(shooter.vx, shooter.vz) > 0.6;
  let spreadDeg = w.spread + shooter.spreadBloom;
  if (moving) spreadDeg += w.moveSpread;
  if (!shooter.onGround) spreadDeg += 3.5;
  if (shooter.ads) spreadDeg *= 0.45;
  if (shooter.crouch) spreadDeg *= 0.8;
  const spreadRad = (spreadDeg * Math.PI) / 180;

  const eye = eyePos(shooter);
  const base = aimDir(shooter);
  // Random cone: two uniform draws, no allocation.
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()) * spreadRad;
  // Build an orthonormal basis around the aim direction.
  let ux = -base.z, uy = 0, uz = base.x;
  const ul = Math.hypot(ux, uz) || 1;
  ux /= ul; uz /= ul;
  const vx = base.y * uz - base.z * uy;
  const vy = base.z * ux - base.x * uz;
  const vz = base.x * uy - base.y * ux;
  const dx = base.x + (ux * Math.cos(a) + vx * Math.sin(a)) * r;
  const dy = base.y + (uy * Math.cos(a) + vy * Math.sin(a)) * r;
  const dz = base.z + (uz * Math.cos(a) + vz * Math.sin(a)) * r;
  const dl = Math.hypot(dx, dy, dz);
  _dir.x = dx / dl; _dir.y = dy / dl; _dir.z = dz / dl;

  // Nearest wall first, then the nearest fighter box inside that distance.
  const wallT = traceMap(colliders, eye.x, eye.y, eye.z, _dir.x, _dir.y, _dir.z, w.range);
  let bestT = wallT;
  let hitFighter = null;
  let hitPart = '';
  for (const f of game.fighters) {
    if (!f.alive || f === shooter || f.team === shooter.team) continue;
    const boxes = hitBoxes(f);
    const th = rayBox(eye.x, eye.y, eye.z, _dir.x, _dir.y, _dir.z, boxes.head);
    const tb = rayBox(eye.x, eye.y, eye.z, _dir.x, _dir.y, _dir.z, boxes.body);
    const t = Math.min(th, tb);
    if (t < bestT) {
      bestT = t;
      hitFighter = f;
      hitPart = th <= tb ? 'head' : 'body';
    }
  }
  const endX = eye.x + _dir.x * bestT;
  const endY = eye.y + _dir.y * bestT;
  const endZ = eye.z + _dir.z * bestT;

  let damage = 0;
  if (hitFighter) {
    damage = w.damage * (hitPart === 'head' ? w.headMul : 1);
    // Damage falls off with distance.
    const falloff = bestT > 30 ? Math.max(0.55, 1 - (bestT - 30) / 120) : 1;
    damage *= falloff;
    applyDamage(game, hitFighter, damage, shooter, hitPart);
  }

  // Recoil kicks the shooter's pitch up and blooms the next shots.
  shooter.recoilPitch += w.recoil * 0.35;
  shooter.spreadBloom = Math.min(4.5, shooter.spreadBloom + w.recoil * 0.55);

  out.hit = hitFighter !== null;
  out.head = hitPart === 'head';
  out.target = hitFighter;
  out.damage = damage;
  out.endX = endX; out.endY = endY; out.endZ = endZ;
  out.wallT = wallT;
  return out;
}

export function applyDamage(game, victim, damage, attacker, part) {
  if (!victim.alive) return;
  let remaining = damage;
  if (victim.armor > 0) {
    const absorbed = Math.min(victim.armor, remaining * 0.5);
    victim.armor -= absorbed;
    remaining -= absorbed;
  }
  victim.hp -= remaining;
  victim.lastDamageFrom = attacker ? attacker.id : -1;
  victim.lastDamageTime = game.time;
  if (victim.hp <= 0) {
    victim.hp = 0;
    victim.alive = false;
    game.events.push({
      type: 'kill', attacker: attacker ? attacker.id : -1, victim: victim.id,
      head: part === 'head', weapon: attacker ? attacker.current : '',
    });
    if (attacker) {
      game.kills[attacker.team]++;
      if (attacker.isPlayer) game.playerKills++;
      if (attacker.isPlayer) game.money += 300;
    }
    if (victim.isPlayer) game.playerDeaths++;
    // The bomb drops where its carrier falls.
    if (victim.hasBomb) {
      victim.hasBomb = false;
      game.bomb.state = 'dropped';
      game.bomb.x = victim.x; game.bomb.y = 0; game.bomb.z = victim.z;
      game.events.push({ type: 'bombDropped', x: victim.x, z: victim.z });
    }
    if (victim.bot) victim.bot.state = 'dead';
  } else {
    game.events.push({ type: 'damage', victim: victim.id, attacker: attacker ? attacker.id : -1, head: part === 'head' });
  }
}

// --- grenades ---------------------------------------------------------------

export function throwGrenade(game, colliders, thrower) {
  if (thrower.grenades <= 0 || thrower.fireCooldown > 0) return false;
  thrower.grenades--;
  thrower.fireCooldown = 0.45;
  const eye = eyePos(thrower);
  const d = aimDir(thrower);
  game.grenades.push({
    x: eye.x + d.x * 0.5, y: eye.y - 0.15, z: eye.z + d.z * 0.5,
    vx: d.x * 15 + thrower.vx * 0.5, vy: d.y * 15 + 3.5, vz: d.z * 15 + thrower.vz * 0.5,
    fuse: 1.7, bounced: false, owner: thrower.id,
  });
  game.events.push({ type: 'grenadeThrow', x: eye.x, z: eye.z, owner: thrower.id });
  game.noises.push({ x: thrower.x, z: thrower.z, loudness: 0.5, time: game.time, team: thrower.team });
  return true;
}

export function updateGrenades(game, colliders, dt) {
  for (let i = game.grenades.length - 1; i >= 0; i--) {
    const g = game.grenades[i];
    g.fuse -= dt;
    g.vy -= 22 * dt;
    // Integrate with a simple bounce: step, then push out of any box hit.
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    g.z += g.vz * dt;
    if (g.y < 0.08) {
      g.y = 0.08;
      if (Math.abs(g.vy) > 2) game.events.push({ type: 'grenadeBounce', x: g.x, z: g.z });
      g.vy = -g.vy * 0.42;
      g.vx *= 0.72; g.vz *= 0.72;
      g.bounced = true;
    }
    for (const c of colliders) {
      if (g.x > c.minX - 0.1 && g.x < c.maxX + 0.1 && g.y > c.minY - 0.1 && g.y < c.maxY + 0.1 &&
          g.z > c.minZ - 0.1 && g.z < c.maxZ + 0.1) {
        // Push out along the smallest penetration axis and reflect.
        const px = Math.min(g.x - (c.minX - 0.1), (c.maxX + 0.1) - g.x);
        const pz = Math.min(g.z - (c.minZ - 0.1), (c.maxZ + 0.1) - g.z);
        const py = Math.min(g.y - (c.minY - 0.1), (c.maxY + 0.1) - g.y);
        if (px <= py && px <= pz) { g.vx = -g.vx * 0.45; g.x += g.vx > 0 ? px : -px; }
        else if (pz <= py) { g.vz = -g.vz * 0.45; g.z += g.vz > 0 ? pz : -pz; }
        else { g.vy = -g.vy * 0.45; g.y += g.vy > 0 ? py : -py; }
        if (!g.bounced) game.events.push({ type: 'grenadeBounce', x: g.x, z: g.z });
        g.bounced = true;
      }
    }
    if (g.fuse <= 0) {
      game.grenades.splice(i, 1);
      game.events.push({ type: 'explosion', x: g.x, y: Math.max(0.4, g.y), z: g.z, owner: g.owner });
      game.noises.push({ x: g.x, z: g.z, loudness: 1, time: game.time, team: game.fighters[g.owner].team });
      for (const f of game.fighters) {
        if (!f.alive || f.team === game.fighters[g.owner].team) continue;
        const d = Math.hypot(f.x - g.x, (f.y + 0.9) - g.y, f.z - g.z);
        if (d > 7.5) continue;
        // A wall between the blast and the fighter halves the damage.
        const clear = segmentClear(colliders, g.x, g.y, g.z, f.x, f.y + 0.9, f.z);
        const dmg = 110 * Math.max(0.15, 1 - d / 7.5) * (clear ? 1 : 0.45);
        applyDamage(game, f, dmg, game.fighters[g.owner], 'blast');
      }
    }
  }
}
