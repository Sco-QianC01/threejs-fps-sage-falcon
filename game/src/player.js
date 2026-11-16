// DUSTLINE — the human player: movement, looking, firing, planting.
// One job: turn raw input into a fighter's motion and actions, one fixed step
// at a time. Bots never come through here.

import { WEAPONS, WALK_SPEED, CROUCH_SPEED, JUMP_SPEED, GRAVITY, PLAYER_RADIUS, PLAYER_HEIGHT, PLANT_TIME, DEFUSE_TIME } from './config.js';
import { moveEntity, SITES } from './map.js';
import { fireHitscan, throwGrenade, eyePos } from './combat.js';
import { PHASE } from './state.js';

export function createInput() {
  return {
    keys: new Set(),
    mouseDX: 0, mouseDY: 0,
    firing: false, ads: false,
    // edge-triggered actions, set by the DOM layer and consumed by updatePlayer
    reloadPressed: false, buyPressed: false, interactHeld: false,
    weaponSlot: -1, // 1..4 requested this tick
    throwPressed: false,
  };
}

const _shot = { hit: false, head: false, target: null, damage: 0, endX: 0, endY: 0, endZ: 0, wallT: 0 };

export function updatePlayer(game, colliders, input, audio, dt, time) {
  const p = game.fighters[0];
  if (!p.alive) return;

  // --- look: mouse deltas accumulate between ticks -------------------------
  const sens = 0.0021 * (p.ads ? 0.6 : 1);
  p.yaw -= input.mouseDX * sens;
  p.pitch -= input.mouseDY * sens;
  p.pitch = Math.max(-1.52, Math.min(1.52, p.pitch));
  input.mouseDX = 0;
  input.mouseDY = 0;

  // Recoil recovery: the pitch kick eases back over a few ticks.
  if (p.recoilPitch > 0) {
    const back = Math.min(p.recoilPitch, 0.35 * dt * 60 * 0.016);
    p.pitch -= back * 0.4;
    p.recoilPitch -= back;
  }
  p.spreadBloom = Math.max(0, p.spreadBloom - 3.2 * dt);

  // --- movement: acceleration, friction, crouch, jump ----------------------
  const crouchHeld = input.keys.has('ControlLeft') || input.keys.has('KeyC');
  p.crouch = crouchHeld;
  const speed = p.crouch ? CROUCH_SPEED : WALK_SPEED;
  let ix = 0, iz = 0;
  if (input.keys.has('KeyW')) iz -= 1;
  if (input.keys.has('KeyS')) iz += 1;
  if (input.keys.has('KeyA')) ix -= 1;
  if (input.keys.has('KeyD')) ix += 1;
  const il = Math.hypot(ix, iz) || 1;
  ix /= il; iz /= il;
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  // Camera-relative: forward is -yaw, right is +yaw rotated.
  const wx = (ix * cos - iz * sin);
  const wz = (ix * sin + iz * cos);
  const targetVx = wx * speed;
  const targetVz = wz * speed;
  // Ground friction / air control: approach target velocity smoothly.
  const accel = p.onGround ? 14 : 4;
  p.vx += (targetVx - p.vx) * Math.min(1, accel * dt);
  p.vz += (targetVz - p.vz) * Math.min(1, accel * dt);

  if (input.keys.has('Space') && p.onGround && !p.crouch) {
    p.vy = JUMP_SPEED;
    p.onGround = false;
  }
  p.vy -= GRAVITY * dt;
  moveEntity(colliders, p, p.vx * dt, p.vz * dt, PLAYER_RADIUS, PLAYER_HEIGHT);
  p.y += p.vy * dt;
  if (p.y <= 0) { p.y = 0; p.vy = 0; p.onGround = true; }

  // --- footsteps ------------------------------------------------------------
  const moving = Math.hypot(p.vx, p.vz);
  p._stepAcc = (p._stepAcc || 0) + moving * dt;
  if (p._stepAcc > 2.2 && p.onGround && moving > 0.5) {
    p._stepAcc = 0;
    audio.step(moving > 4, 0);
  }

  // --- weapon switching ------------------------------------------------------
  if (input.weaponSlot >= 1 && input.weaponSlot <= 4) {
    const order = ['p9', 'hornet', 'kestrel'];
    if (input.weaponSlot <= 3) {
      const id = order[input.weaponSlot - 1];
      if (p.weapons[id]) { p.current = id; p.reloading = 0; }
    } else if (p.grenades > 0) {
      // Slot 4 throws the grenade straight away.
      if (throwGrenade(game, colliders, p)) audio.grenadeThrow();
    }
    input.weaponSlot = -1;
  }

  // --- reload -----------------------------------------------------------------
  if (input.reloadPressed) {
    input.reloadPressed = false;
    startReload(game, p, audio);
  }
  if (p.reloading > 0) {
    p.reloading -= dt;
    if (p.reloading <= 0) {
      p.reloading = 0;
      const w = WEAPONS[p.current];
      const ammo = p.weapons[p.current];
      const need = w.mag - ammo.mag;
      const take = Math.min(need, ammo.reserve);
      ammo.mag += take;
      ammo.reserve -= take;
    }
  }

  // --- firing (live rounds only — the freeze is for buying, not shooting) ------
  p.ads = input.ads;
  p.fireCooldown = Math.max(0, p.fireCooldown - dt);
  const w = WEAPONS[p.current];
  const wantFire = game.phase === PHASE.LIVE && input.firing && (w.auto || input._fireEdge);
  if (input._fireEdge) input._fireEdge = false;
  if (wantFire && p.fireCooldown <= 0 && p.reloading <= 0) {
    const ammo = p.weapons[p.current];
    if (ammo.mag > 0) {
      const res = fireHitscan(game, colliders, p, p.current, _shot);
      if (res) {
        audio.shot(w.pitch, 0.5, 0);
        game.noises.push({ x: p.x, z: p.z, loudness: 0.7, time, team: 0 });
        game.events.push({
          type: 'shot', x: eyePos(p).x, y: eyePos(p).y, z: eyePos(p).z,
          endX: res.endX, endY: res.endY, endZ: res.endZ, shooter: p.id,
        });
        if (res.hit) {
          audio.hit(res.head);
          game.events.push({ type: 'hitmarker', head: res.head });
        }
      }
    } else {
      audio.dryFire();
      p.fireCooldown = 0.25;
      startReload(game, p, audio);
    }
  }

  // --- bomb: pick up, plant, defuse -------------------------------------------
  updateBombInteraction(game, p, input, audio, dt);
}

export function startReload(game, p, audio) {
  const w = WEAPONS[p.current];
  const ammo = p.weapons[p.current];
  if (!ammo || p.reloading > 0 || ammo.mag >= w.mag || ammo.reserve <= 0) return;
  p.reloading = w.reload;
  if (audio) audio.reload();
}

function siteAt(x, z) {
  for (const [key, s] of Object.entries(SITES)) {
    if (Math.hypot(x - s.x, z - s.z) <= s.r) return key;
  }
  return null;
}

function updateBombInteraction(game, p, input, audio, dt) {
  const bomb = game.bomb;
  // Pick up a dropped bomb by walking over it.
  if (bomb.state === 'dropped' && Math.hypot(p.x - bomb.x, p.z - bomb.z) < 1.2) {
    bomb.state = 'carried';
    bomb.carrier = p.id;
    p.hasBomb = true;
    game.events.push({ type: 'bombPickup', x: p.x, z: p.z });
    audio.beep();
  }
  if (game.phase !== 'live') return;

  // Planting: carrier stands in a site and holds E.
  if (bomb.state === 'carried' && bomb.carrier === p.id) {
    const site = siteAt(p.x, p.z);
    if (site && input.interactHeld) {
      bomb.plantProgress += dt;
      if (Math.floor(bomb.plantProgress * 4) !== Math.floor((bomb.plantProgress - dt) * 4)) audio.plantTick();
      if (bomb.plantProgress >= PLANT_TIME) {
        bomb.state = 'planted';
        bomb.plantedAt = site;
        bomb.fuseLeft = 35;
        bomb.plantProgress = 0;
        p.hasBomb = false;
        game.money += 300;
        game.events.push({ type: 'bombPlanted', site, x: SITES[site].x, z: SITES[site].z });
        audio.beep(true);
      }
    } else {
      bomb.plantProgress = Math.max(0, bomb.plantProgress - dt * 2);
    }
    return;
  }

  // Defusing: a defender (the player is the attacker — but after a plant the
  // player can still stop a defuse by killing the defuser; defuse is a bot job).
  if (bomb.state === 'planted') {
    bomb.plantProgress = 0;
  }
}
