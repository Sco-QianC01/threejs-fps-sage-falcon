// DUSTLINE — visual feedback: tracers, muzzle flashes, impacts, explosions.
// One job: everything the sim spawns to be *seen*. All pools are fixed size
// and reused, so the render loop allocates nothing.

import * as THREE from 'three';

const MAX_TRACERS = 24;
const MAX_PARTICLES = 320;

export class FX {
  constructor(scene) {
    this.scene = scene;
    // --- tracer pool: one stretched box per shot, reused ------------------
    this.tracers = [];
    const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
    const tracerMat = new THREE.MeshBasicMaterial({
      color: 0xffd27a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    for (let i = 0; i < MAX_TRACERS; i++) {
      const m = new THREE.Mesh(tracerGeo, tracerMat.clone());
      m.visible = false;
      scene.add(m);
      this.tracers.push({ mesh: m, life: 0 });
    }
    this.tracerNext = 0;
    // --- particle pool: small boxes for sparks, smoke, debris -------------
    this.particles = [];
    const pGeo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const m = new THREE.Mesh(pGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
      m.visible = false;
      scene.add(m);
      this.particles.push({ mesh: m, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, grav: 0 });
    }
    this.particleNext = 0;
    // --- one reusable flash light at the shooter's muzzle ------------------
    this.flash = new THREE.PointLight(0xffc06a, 0, 9, 2);
    scene.add(this.flash);
    this.flashLife = 0;
    // --- explosion flash mesh ----------------------------------------------
    this.boom = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.boom.visible = false;
    scene.add(this.boom);
    this.boomLife = 0;
    // --- screen shake ---------------------------------------------------------
    this.shake = 0;
  }

  tracer(from, to) {
    const t = this.tracers[this.tracerNext];
    this.tracerNext = (this.tracerNext + 1) % MAX_TRACERS;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.2) return;
    t.mesh.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
    t.mesh.scale.set(0.02, 0.02, len);
    t.mesh.lookAt(to.x, to.y, to.z);
    t.mesh.material.opacity = 0.9;
    t.mesh.visible = true;
    t.life = 0.07;
  }

  muzzle(pos) {
    this.flash.position.set(pos.x, pos.y, pos.z);
    this.flash.intensity = 26;
    this.flashLife = 0.05;
  }

  sparks(pos, color = 0xffc06a, n = 10, speed = 5) {
    for (let i = 0; i < n; i++) {
      const p = this.particles[this.particleNext];
      this.particleNext = (this.particleNext + 1) % MAX_PARTICLES;
      p.mesh.position.set(pos.x, pos.y, pos.z);
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.9 + 0.2;
      p.vx = Math.cos(a) * speed * (0.4 + Math.random() * 0.6);
      p.vy = up * speed * 0.6;
      p.vz = Math.sin(a) * speed * (0.4 + Math.random() * 0.6);
      p.mesh.material.color.setHex(color);
      p.mesh.material.opacity = 1;
      p.mesh.visible = true;
      p.maxLife = 0.35 + Math.random() * 0.3;
      p.life = p.maxLife;
      p.grav = 12;
    }
  }

  smoke(pos, n = 14) {
    for (let i = 0; i < n; i++) {
      const p = this.particles[this.particleNext];
      this.particleNext = (this.particleNext + 1) % MAX_PARTICLES;
      p.mesh.position.set(pos.x + (Math.random() - 0.5), pos.y + Math.random() * 0.5, pos.z + (Math.random() - 0.5));
      p.vx = (Math.random() - 0.5) * 1.2;
      p.vy = 0.8 + Math.random() * 1.4;
      p.vz = (Math.random() - 0.5) * 1.2;
      p.mesh.scale.setScalar(3.2);
      p.mesh.material.color.setHex(0x8a8578);
      p.mesh.material.opacity = 0.5;
      p.mesh.visible = true;
      p.maxLife = 1.1 + Math.random() * 0.7;
      p.life = p.maxLife;
      p.grav = -0.4;
    }
  }

  explosion(pos, big = false) {
    this.boom.position.set(pos.x, Math.max(0.8, pos.y), pos.z);
    this.boom.scale.setScalar(big ? 2 : 1);
    this.boom.material.opacity = 0.85;
    this.boom.visible = true;
    this.boomLife = 0.45;
    this.sparks(pos, 0xff7a2c, big ? 40 : 26, big ? 11 : 8);
    this.sparks(pos, 0x3a3a3a, big ? 24 : 12, 4);
    this.smoke(pos, big ? 26 : 14);
    this.shake = Math.max(this.shake, big ? 0.9 : 0.5);
    this.flash.position.set(pos.x, pos.y + 1, pos.z);
    this.flash.intensity = 60;
    this.flashLife = 0.3;
  }

  update(dt) {
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) t.mesh.visible = false;
      else t.mesh.material.opacity = (t.life / 0.07) * 0.9;
    }
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; p.mesh.scale.setScalar(1); continue; }
      p.vy -= p.grav * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      if (p.mesh.position.y < 0.05) { p.mesh.position.y = 0.05; p.vy = 0; }
      p.mesh.material.opacity = Math.min(1, (p.life / p.maxLife) * 1.4);
    }
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      if (this.flashLife <= 0) this.flash.intensity = 0;
    }
    if (this.boomLife > 0) {
      this.boomLife -= dt;
      const k = Math.max(0, this.boomLife / 0.45);
      this.boom.scale.setScalar((1 - k) * 7 + 1);
      this.boom.material.opacity = k * 0.85;
      if (this.boomLife <= 0) this.boom.visible = false;
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
  }
}

// --- fighter bodies ----------------------------------------------------------
// A bot is a small group of boxes: torso in team colour, dark limbs, a visor
// slit and a gun. The player never sees their own body (first person), but
// their viewmodel is built the same way in main.js.

export function makeFighterMesh(fighter, teamColor) {
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.8, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.85, metalness: 0.1 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a37e, roughness: 0.9 });
  const visor = new THREE.MeshStandardMaterial({ color: 0x0d1117, roughness: 0.2, metalness: 0.6 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), suit);
  torso.position.y = 1.12;
  torso.castShadow = true;
  g.add(torso);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.3, 0.34), dark);
  vest.position.y = 1.18;
  g.add(vest);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), skin);
  head.position.y = 1.6;
  head.castShadow = true;
  g.add(head);
  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.34), dark);
  helmet.position.y = 1.76;
  g.add(helmet);
  const slit = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 0.02), visor);
  slit.position.set(0, 1.6, 0.16);
  g.add(slit);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.82, 0.22), dark);
  legL.position.set(-0.14, 0.41, 0);
  g.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.14;
  g.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.16), suit);
  armL.position.set(-0.33, 1.15, 0.1);
  armL.rotation.x = -0.9;
  g.add(armL);
  const armR = armL.clone();
  armR.position.x = 0.33;
  g.add(armR);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.72), dark);
  gun.position.set(0.12, 1.28, 0.28);
  g.add(gun);

  // Name tag: a small canvas sprite floating above the head.
  const c = document.createElement('canvas');
  c.width = 256; c.height = 48;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 30px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(10,12,14,0.55)';
  ctx.fillRect(0, 0, 256, 48);
  ctx.fillStyle = '#f5efe4';
  ctx.fillText(fighter.name, 128, 26);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  tag.scale.set(1.5, 0.28, 1);
  tag.position.y = 2.05;
  g.add(tag);

  g.userData.tag = tag;
  return g;
}

// The bomb itself: a small dark case with a blinking light, dropped or planted.
export function makeBombMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.26, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.5, metalness: 0.5 }),
  );
  body.castShadow = true;
  g.add(body);
  const light = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
  );
  light.position.set(0.12, 0.16, 0);
  g.add(light);
  g.userData.light = light;
  return g;
}
