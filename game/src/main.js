// DUSTLINE — bootstrap and the game loop.
// One job: own the renderer, the camera and the fixed-step loop. The sim
// (player, bots, rounds, combat) runs at a fixed 60 Hz, apart from rendering;
// this file only moves pixels and turns sim events into sights and sounds.

import * as THREE from 'three';
import { TICK, WEAPONS, TEAM_COLOR } from './config.js';
import { createGame, PHASE, aliveOf, playerOf } from './state.js';
import { buildMap, SITES } from './map.js';
import { createInput, updatePlayer } from './player.js';
import { updateBot, makeBotBrain } from './bots.js';
import { updateRounds, startMatch, buyItem } from './rounds.js';
import { updateGrenades } from './combat.js';
import { AudioSys } from './audio.js';
import { FX, makeFighterMesh, makeBombMesh } from './fx.js';
import { buildHUD, updateHUD, showMessage, addKillfeed, flashHitmarker, flashDamage, flashWhite } from './hud.js';

const game = createGame();
const input = createInput();
const audio = new AudioSys();

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2e3648);
scene.fog = new THREE.Fog(0x2e3648, 28, 95);

const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.08, 220);
camera.rotation.order = 'YXZ';
scene.add(camera);

// Dusk light: a low warm sun and a cool sky fill.
const sun = new THREE.DirectionalLight(0xffb36b, 2.4);
sun.position.set(-28, 26, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
sun.shadow.camera.far = 90;
sun.shadow.bias = -0.0004;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0x8a9cc0, 0x4a3a28, 0.85));
const warmA = new THREE.PointLight(0xffc06a, 18, 26, 1.8);
warmA.position.set(-16, 5.4, 0);
scene.add(warmA);
const warmB = new THREE.PointLight(0xffc06a, 18, 26, 1.8);
warmB.position.set(16, 5.4, 0);
scene.add(warmB);

const { colliders, waypoints } = buildMap(scene);
game._waypoints = waypoints;
const fx = new FX(scene);

// Fighter meshes (bots only — the player is first-person).
for (const f of game.fighters) {
  if (f.isPlayer) continue;
  if (!f.bot) f.bot = makeBotBrain(f, game);
  f.mesh = makeFighterMesh(f, TEAM_COLOR[f.team]);
  f.mesh.visible = false;
  scene.add(f.mesh);
}
const bombMesh = makeBombMesh();
bombMesh.visible = false;
scene.add(bombMesh);

// Grenade meshes, pooled.
const grenadeMeshes = [];
for (let i = 0; i < 4; i++) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x2c4a2c, roughness: 0.5, metalness: 0.4 }),
  );
  m.visible = false;
  scene.add(m);
  grenadeMeshes.push(m);
}

// --- viewmodel: the player's gun, attached to the camera --------------------
const viewmodel = new THREE.Group();
const vmDark = new THREE.MeshStandardMaterial({ color: 0x1e2126, roughness: 0.45, metalness: 0.55 });
const vmAccent = new THREE.MeshStandardMaterial({ color: 0x2f6f6a, roughness: 0.5, metalness: 0.3 });
{
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.52), vmDark);
  viewmodel.add(body);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.3), vmDark);
  barrel.position.set(0, 0.02, -0.38);
  viewmodel.add(barrel);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.1), vmAccent);
  grip.position.set(0, -0.12, 0.12);
  grip.rotation.x = 0.35;
  viewmodel.add(grip);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.09), vmDark);
  mag.position.set(0, -0.12, -0.02);
  viewmodel.add(mag);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.08), vmAccent);
  sight.position.set(0, 0.09, -0.05);
  viewmodel.add(sight);
}
const vmFlash = new THREE.Mesh(
  new THREE.PlaneGeometry(0.22, 0.22),
  new THREE.MeshBasicMaterial({ color: 0xffc06a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
);
vmFlash.position.set(0, 0.02, -0.56);
viewmodel.add(vmFlash);
viewmodel.position.set(0.26, -0.22, -0.42);
camera.add(viewmodel);

// --- HUD ---------------------------------------------------------------------
const hud = buildHUD({
  onPlay: () => {
    audio.unlock();
    startMatch(game);
    lockPointer();
  },
  onPlayAgain: () => {
    audio.unlock();
    startMatch(game);
    lockPointer();
  },
  onBuy: (id) => {
    const res = buyItem(game, id, audio);
    hud.buyMsg.textContent = res.ok ? `${id.toUpperCase()} purchased` : res.why;
    if (!res.ok) audio.denied();
  },
  onBuyClose: () => { hud._buyOpen = false; lockPointer(); },
});

const resumeOverlay = document.createElement('div');
resumeOverlay.className = 'overlay resume';
resumeOverlay.innerHTML = '<div class="title small">PAUSED</div><div class="subtitle">CLICK TO RESUME</div>';
document.getElementById('hud').appendChild(resumeOverlay);
resumeOverlay.addEventListener('click', () => lockPointer());

function lockPointer() {
  if (document.pointerLockElement !== renderer.domElement) {
    const r = renderer.domElement.requestPointerLock();
    if (r && r.catch) r.catch(() => { /* Chrome cools down re-locks; user clicks again */ });
  }
}

// --- input -------------------------------------------------------------------
document.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') e.preventDefault();
  if (e.repeat) return;
  input.keys.add(e.code);
  if (e.code === 'KeyR') input.reloadPressed = true;
  if (e.code === 'KeyB' && game.phase === PHASE.FREEZE) {
    hud._buyOpen = !hud._buyOpen;
    audio.click();
    if (hud._buyOpen) document.exitPointerLock();
    else lockPointer();
  }
  if (e.code === 'KeyE') input.interactHeld = true;
  if (e.code === 'Digit1') input.weaponSlot = 1;
  if (e.code === 'Digit2') input.weaponSlot = 2;
  if (e.code === 'Digit3') input.weaponSlot = 3;
  if (e.code === 'Digit4') input.weaponSlot = 4;
  if (e.code === 'KeyM') { audio.muted = !audio.muted; }
});
document.addEventListener('keyup', (e) => {
  input.keys.delete(e.code);
  if (e.code === 'KeyE') input.interactHeld = false;
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  input.mouseDX += e.movementX;
  input.mouseDY += e.movementY;
});
renderer.domElement.addEventListener('mousedown', (e) => {
  audio.unlock();
  if (document.pointerLockElement !== renderer.domElement) { lockPointer(); return; }
  if (e.button === 0) { input.firing = true; input._fireEdge = true; }
  if (e.button === 2) input.ads = true;
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) input.firing = false;
  if (e.button === 2) input.ads = false;
});
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- sim event handling -------------------------------------------------------
const _v = new THREE.Vector3();

function handleEvents() {
  const p = playerOf(game);
  for (const ev of game.events) {
    switch (ev.type) {
      case 'shot': {
        fx.tracer({ x: ev.x, y: ev.y, z: ev.z }, { x: ev.endX, y: ev.endY, z: ev.endZ });
        if (ev.shooter !== 0) {
          const s = audio.spatial(ev.x, ev.z, p.x, p.z, p.yaw);
          const shooter = game.fighters[ev.shooter];
          audio.shot(WEAPONS[shooter.current]?.pitch ?? 1, 0.45 * s.gain, s.pan);
          fx.muzzle({ x: ev.x, y: ev.y, z: ev.z });
        } else {
          vmFlash.material.opacity = 0.95;
          fx.muzzle({ x: ev.x, y: ev.y, z: ev.z });
        }
        break;
      }
      case 'hitmarker':
        if (!ev.victim) flashHitmarker(hud, ev.head);
        break;
      case 'damage':
        if (ev.victim === 0) { flashDamage(hud); audio.hurt(); }
        break;
      case 'kill': {
        const a = game.fighters[ev.attacker];
        const v = game.fighters[ev.victim];
        if (a && v) addKillfeed(hud, a, v, ev.head, WEAPONS[ev.weapon]?.short ?? ev.weapon);
        if (ev.victim === 0) showMessage(hud, 'YOU ARE DOWN', 'Spectating a teammate — the round goes on', 4);
        break;
      }
      case 'explosion':
        fx.explosion({ x: ev.x, y: ev.y, z: ev.z }, ev.big);
        {
          const s = audio.spatial(ev.x, ev.z, p.x, p.z, p.yaw);
          audio.explosion(0.9 * Math.max(0.25, s.gain), s.pan);
          if (Math.hypot(ev.x - p.x, ev.z - p.z) < 12) flashWhite(hud);
        }
        break;
      case 'grenadeBounce': {
        const s = audio.spatial(ev.x, ev.z, p.x, p.z, p.yaw);
        if (s.gain > 0.05) audio.grenadeBounce();
        break;
      }
      case 'grenadeThrow': {
        const s = audio.spatial(ev.x, ev.z, p.x, p.z, p.yaw);
        if (s.gain > 0.05) audio.grenadeThrow();
        break;
      }
      case 'roundStart':
        showMessage(hud, `ROUND ${ev.round}`, game.phase === PHASE.FREEZE ? 'Buy phase — press B for the buy menu' : '', 3);
        break;
      case 'roundLive':
        showMessage(hud, 'GO GO GO', 'Plant the device at A or B', 2.5);
        break;
      case 'roundEnd':
        showMessage(hud, ev.winner === 0 ? 'ROUND WON' : 'ROUND LOST', ev.reason, 3.5);
        if (ev.winner === 0) audio.roundWin(); else audio.roundLose();
        break;
      case 'matchEnd':
        if (game.matchWinner === 0) audio.roundWin(); else audio.roundLose();
        break;
      case 'bombPlanted':
        showMessage(hud, `DEVICE PLANTED — SITE ${ev.site}`, 'Defend it until it detonates', 4);
        audio.beep(true);
        break;
      case 'bombDefused':
        showMessage(hud, 'DEVICE DEFUSED', 'ROOK holds the yard', 4);
        break;
      case 'bombPickup':
        showMessage(hud, 'DEVICE RECOVERED', 'Carry it to A or B', 2.5);
        break;
      case 'bombDropped':
        showMessage(hud, 'DEVICE DROPPED', 'Recover it before ROOK camps it', 3);
        break;
      case 'plantTick':
      case 'defuseTick': {
        const s = audio.spatial(ev.x, ev.z, p.x, p.z, p.yaw);
        if (s.gain > 0.1) audio.plantTick();
        break;
      }
      case 'bombBeep':
        audio.beep();
        break;
      default:
        break;
    }
  }
  game.events.length = 0;
}

// --- fixed-step simulation ------------------------------------------------------
function stepSim(dt) {
  game.time += dt;
  if (game.phase === PHASE.FREEZE || game.phase === PHASE.LIVE) {
    const p = playerOf(game);
    if (game.phase === PHASE.LIVE) {
      updatePlayer(game, colliders, input, audio, dt, game.time);
      for (const f of game.fighters) {
        if (!f.isPlayer && f.alive) updateBot(game, colliders, waypoints, f, audio, dt, game.time);
      }
      updateGrenades(game, colliders, dt);
    } else {
      // Freeze: players can walk their spawn and buy, but not fire.
      updatePlayer(game, colliders, input, audio, dt, game.time);
      input.firing = false;
    }
  }
  // The round clock runs in freeze, live play and the between-rounds pause
  // alike — without this the ROUND_END pause would never count down.
  if (game.phase === PHASE.FREEZE || game.phase === PHASE.LIVE || game.phase === PHASE.ROUND_END) {
    updateRounds(game, dt);
  }
  // The bomb's blink and the spectate pick need no phase.
  if (game.phase === PHASE.LIVE && !playerOf(game).alive && game.spectateId < 0) {
    const mate = game.fighters.find((f) => f.team === 0 && f.alive && !f.isPlayer);
    game.spectateId = mate ? mate.id : -1;
  }
  handleEvents();
}

// --- per-frame rendering ---------------------------------------------------------
let last = performance.now();
let acc = 0;
let walkPhase = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;

  acc += dt;
  let steps = 0;
  while (acc >= TICK && steps < 5) {
    stepSim(TICK);
    acc -= TICK;
    steps++;
  }
  if (steps === 5) acc = 0;

  const p = playerOf(game);
  const dtF = dt;

  // --- camera ------------------------------------------------------------------
  if (game.phase === PHASE.MENU) {
    // Slow cinematic orbit over the yard behind the start screen.
    const t = now / 1000;
    camera.position.set(Math.sin(t * 0.07) * 26, 12 + Math.sin(t * 0.11) * 2, Math.cos(t * 0.07) * 20);
    camera.lookAt(0, 1, -6);
    camera.fov = 60;
    camera.updateProjectionMatrix();
  } else if (!p.alive && game.spectateId >= 0) {
    const mate = game.fighters[game.spectateId];
    if (mate && mate.alive) {
      camera.position.set(mate.x, mate.y + 1.58, mate.z);
      camera.rotation.set(mate.pitch, mate.yaw, 0);
    }
  } else {
    const eyeH = p.crouch ? 1.08 : 1.58;
    const moving = Math.hypot(p.vx, p.vz);
    walkPhase += moving * dtF * 1.6;
    const bobY = Math.sin(walkPhase * 2) * 0.028 * Math.min(1, moving / 4);
    const bobX = Math.cos(walkPhase) * 0.014 * Math.min(1, moving / 4);
    camera.position.set(p.x + bobX * Math.cos(p.yaw), p.y + eyeH + bobY, p.z - bobX * Math.sin(p.yaw));
    let shakeX = 0, shakeY = 0;
    if (fx.shake > 0) {
      shakeX = (Math.random() - 0.5) * fx.shake * 0.06;
      shakeY = (Math.random() - 0.5) * fx.shake * 0.06;
    }
    camera.rotation.set(p.pitch + p.recoilPitch * 0.55 + shakeY, p.yaw + shakeX, 0);
    // ADS: tighten the view.
    const targetFov = p.ads ? 56 : 74;
    camera.fov += (targetFov - camera.fov) * Math.min(1, dtF * 12);
    camera.updateProjectionMatrix();
  }

  // --- viewmodel ---------------------------------------------------------------
  viewmodel.visible = p.alive && game.phase !== PHASE.MENU;
  if (viewmodel.visible) {
    const targetX = p.ads ? 0 : 0.26;
    const targetY = p.ads ? -0.185 : -0.22;
    viewmodel.position.x += (targetX - viewmodel.position.x) * Math.min(1, dtF * 14);
    viewmodel.position.y += (targetY - viewmodel.position.y) * Math.min(1, dtF * 14);
    viewmodel.position.z = -0.42 + p.recoilPitch * 0.03 + Math.sin(walkPhase * 2) * 0.006;
    viewmodel.rotation.x = p.recoilPitch * 0.35;
    vmFlash.material.opacity = Math.max(0, vmFlash.material.opacity - dtF * 22);
  }

  // --- fighter meshes ------------------------------------------------------------
  for (const f of game.fighters) {
    if (f.isPlayer || !f.mesh) continue;
    const m = f.mesh;
    if (game.phase === PHASE.MENU) { m.visible = false; continue; }
    m.visible = true;
    m.position.set(f.x, f.y, f.z);
    if (!f.alive) {
      m.rotation.set(0, f.yaw, Math.PI / 2 * 0.94);
      m.position.y = 0.25;
      m.userData.tag.visible = false;
      continue;
    }
    m.rotation.set(0, f.yaw, 0);
    // Walk cycle: legs swing, body bobs.
    const sp = Math.hypot(f.vx, f.vz);
    f._walk = (f._walk || 0) + sp * dtF * 2.4;
    const swing = Math.sin(f._walk) * 0.55 * Math.min(1, sp / 3);
    m.children[5].rotation.x = swing; // legL
    m.children[6].rotation.x = -swing; // legR
    m.position.y = f.y + Math.abs(Math.sin(f._walk)) * 0.03;
    if (f.crouch) m.scale.y = 0.72; else m.scale.y = 1;
    m.userData.tag.visible = true;
  }

  // --- bomb mesh ------------------------------------------------------------------
  if (game.bomb.state === 'dropped') {
    bombMesh.visible = true;
    bombMesh.position.set(game.bomb.x, 0.14, game.bomb.z);
    bombMesh.rotation.y += dtF;
  } else if (game.bomb.state === 'planted') {
    const site = SITES[game.bomb.plantedAt];
    bombMesh.visible = true;
    bombMesh.position.set(site.x, 0.14, site.z);
    const blink = Math.sin(now / 130) > 0;
    bombMesh.userData.light.material.color.setHex(blink ? 0xff2a1a : 0x551108);
  } else {
    bombMesh.visible = false;
  }

  // --- grenade meshes ---------------------------------------------------------------
  game.grenades.forEach((g, i) => {
    const m = grenadeMeshes[i];
    if (!m) return;
    m.visible = true;
    m.position.set(g.x, g.y, g.z);
  });
  for (let i = game.grenades.length; i < grenadeMeshes.length; i++) grenadeMeshes[i].visible = false;

  fx.update(dtF);
  updateHUD(game, hud, now / 1000);

  // Pause overlay: pointer lock lost mid-match. The buy menu closes itself
  // when the freeze ends, so never leave _buyOpen set outside the freeze.
  if (game.phase !== PHASE.FREEZE) hud._buyOpen = false;
  const locked = document.pointerLockElement === renderer.domElement;
  resumeOverlay.classList.toggle('open',
    game.phase !== PHASE.MENU && game.phase !== PHASE.MATCH_END && !locked && !hud._buyOpen);

  renderer.render(scene, camera);
}

requestAnimationFrame(frame);
