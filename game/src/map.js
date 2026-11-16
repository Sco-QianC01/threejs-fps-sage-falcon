// DUSTLINE — "Yard 7": the map.
// One job: the yard's geometry, its collision boxes, the waypoint graph bots
// walk, and the two bomb sites. Everything here is axis-aligned on purpose:
// collision stays a cheap AABB test and the sim never allocates in hot loops.

import * as THREE from 'three';

// Yard bounds (metres). Attackers spawn south (+z), defenders north (-z).
export const MAP = { minX: -32, maxX: 32, minZ: -22, maxZ: 22, wallH: 4.5 };

// {x, z, w, d, h, c} — centre, footprint, height, palette colour.
const BOXES = [
  // perimeter walls (built as boxes so they collide like everything else)
  { x: 0, z: -22.5, w: 66, d: 1, h: 4.5, c: 0x3a3f46 },
  { x: 0, z: 22.5, w: 66, d: 1, h: 4.5, c: 0x3a3f46 },
  { x: -32.5, z: 0, w: 1, d: 46, h: 4.5, c: 0x3a3f46 },
  { x: 32.5, z: 0, w: 1, d: 46, h: 4.5, c: 0x3a3f46 },
  // mid warehouse block — the fight's spine, with gaps on both sides
  { x: 0, z: -2, w: 10, d: 8, h: 5.2, c: 0x4a4640 },
  // A-lane containers (east)
  { x: 14, z: 6, w: 6, d: 2.6, h: 2.6, c: 0x2f6f6a },
  { x: 14, z: 8.6, w: 6, d: 2.6, h: 2.6, c: 0xb4552d },
  { x: 22, z: -6, w: 2.6, d: 6, h: 2.6, c: 0xc08a2e },
  { x: 26, z: -14, w: 6, d: 2.6, h: 2.6, c: 0x2f6f6a },
  { x: 18, z: -16, w: 2.6, d: 6, h: 2.6, c: 0x7a6a58 },
  // B-lane containers (west)
  { x: -14, z: 6, w: 6, d: 2.6, h: 2.6, c: 0xb4552d },
  { x: -14, z: 8.6, w: 6, d: 2.6, h: 2.6, c: 0x2f6f6a },
  { x: -22, z: -6, w: 2.6, d: 6, h: 2.6, c: 0xc08a2e },
  { x: -26, z: -14, w: 6, d: 2.6, h: 2.6, c: 0x2f6f6a },
  { x: -18, z: -16, w: 2.6, d: 6, h: 2.6, c: 0x7a6a58 },
  // mid crates and cover
  { x: -6, z: 12, w: 2.4, d: 2.4, h: 2.4, c: 0x8a7f70 },
  { x: 6, z: 12, w: 2.4, d: 2.4, h: 1.2, c: 0x8a7f70 },
  { x: -8, z: -10, w: 2.4, d: 2.4, h: 2.4, c: 0x8a7f70 },
  { x: 8, z: -10, w: 2.4, d: 2.4, h: 1.2, c: 0x8a7f70 },
  { x: 0, z: 16, w: 3, d: 1.2, h: 1.2, c: 0x5a5348 },
  { x: 0, z: -14, w: 3, d: 1.2, h: 1.2, c: 0x5a5348 },
  // site backstops
  { x: 28, z: -18, w: 4, d: 2.6, h: 2.6, c: 0xb4552d },
  { x: -28, z: -18, w: 4, d: 2.6, h: 2.6, c: 0xb4552d },
];

export const SITES = {
  A: { x: 24, z: -13, r: 5 },
  B: { x: -24, z: -13, r: 5 },
};

export const SPAWNS = {
  attack: [[-4, 18], [0, 19], [4, 18], [0, 16]],
  defend: [[-8, -18], [0, -19], [8, -18], [-24, -10], [24, -10], [0, -12], [-14, -17], [14, -17]],
};

// Waypoint graph bots navigate. Nodes are open ground; edges are walkable lines.
const WAYPOINTS = [
  [0, 19], [-6, 18], [6, 18], // 0-2 attacker spawn
  [0, 12], [-10, 12], [10, 12], // 3-5 south yard
  [-14, 2], [14, 2], [0, 4], // 6-8 mid south
  [-10, -4], [10, -4], [0, -6], // 9-11 mid north
  [-20, -8], [20, -8], // 12-13 site approaches
  [-24, -13], [24, -13], // 14-15 sites B / A
  [-24, -18], [24, -18], // 16-17 site backs
  [-8, -18], [8, -18], [0, -18], // 18-20 defender spawn
  [-16, -12], [16, -12], // 21-22 site fronts
  [-4, -12], [4, -12], // 23-24 mid north pockets
  [0, -14], // 25 centre north
];
const EDGES = [
  [0, 3], [1, 4], [2, 5], [3, 4], [3, 5], [3, 8], [4, 6], [5, 7], [6, 9],
  [7, 10], [8, 9], [8, 10], [8, 11], [9, 12], [10, 13], [9, 23], [10, 24],
  [11, 23], [11, 24], [11, 25], [12, 21], [13, 22], [12, 14], [13, 15],
  [14, 16], [15, 17], [14, 21], [15, 22], [16, 18], [17, 19], [18, 20],
  [19, 20], [18, 21], [19, 22], [21, 23], [22, 24], [23, 25], [24, 25],
  [6, 12], [7, 13], [4, 6], [5, 7], [3, 6], [3, 7],
];

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 352;
  const g = c.getContext('2d');
  g.fillStyle = '#8a7d6c'; g.fillRect(0, 0, 512, 352);
  // concrete noise
  for (let i = 0; i < 5200; i++) {
    const v = 110 + Math.random() * 50;
    g.fillStyle = `rgba(${v | 0},${(v * 0.92) | 0},${(v * 0.78) | 0},0.25)`;
    g.fillRect(Math.random() * 512, Math.random() * 352, 2, 2);
  }
  // painted lane lines
  g.strokeStyle = 'rgba(224,196,120,0.55)'; g.lineWidth = 3;
  g.setLineDash([18, 14]);
  g.beginPath(); g.moveTo(256, 352); g.lineTo(256, 0); g.stroke();
  g.beginPath(); g.moveTo(0, 176); g.lineTo(512, 176); g.stroke();
  g.setLineDash([]);
  // site circles
  g.strokeStyle = 'rgba(224,100,40,0.7)'; g.lineWidth = 4;
  g.beginPath(); g.arc(448, 66, 34, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(64, 66, 34, 0, Math.PI * 2); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function letterTexture(letter, color) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = color; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#f5efe4'; g.font = 'bold 84px sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(letter, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Preallocated scratch — collision and ray tests never allocate.

export function buildMap(scene) {
  const colliders = [];
  const group = new THREE.Group();
  group.name = 'yard7';

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(66, 46),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const geo = new THREE.BoxGeometry(1, 1, 1);
  const materials = new Map();
  const matFor = (c) => {
    if (!materials.has(c)) materials.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0.08 }));
    return materials.get(c);
  };
  for (const b of BOXES) {
    const mesh = new THREE.Mesh(geo, matFor(b.c));
    mesh.position.set(b.x, b.h / 2, b.z);
    mesh.scale.set(b.w, b.h, b.d);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push({
      minX: b.x - b.w / 2, maxX: b.x + b.w / 2,
      minY: 0, maxY: b.h,
      minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2,
    });
  }

  // site signs (A / B) on poles, and painted site pads
  for (const [key, site] of Object.entries(SITES)) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 4.6, 8),
      new THREE.MeshStandardMaterial({ color: 0x2c2f34, roughness: 0.6, metalness: 0.4 }),
    );
    pole.position.set(site.x, 2.3, site.z - site.r - 0.5);
    pole.castShadow = true;
    group.add(pole);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.7, 1.7),
      new THREE.MeshBasicMaterial({ map: letterTexture(key, '#c8501e'), side: THREE.DoubleSide }),
    );
    sign.position.set(site.x, 4.6, site.z - site.r - 0.5);
    group.add(sign);
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(site.r, 28),
      new THREE.MeshStandardMaterial({ color: 0xc8501e, roughness: 1, transparent: true, opacity: 0.16 }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(site.x, 0.02, site.z);
    group.add(pad);
  }

  // lamp poles with warm glow
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffc06a });
  for (const [lx, lz] of [[-16, 0], [16, 0], [0, -18], [-28, 14], [28, 14]]) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.12, 5.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x2c2f34, roughness: 0.6, metalness: 0.4 }),
    );
    pole.position.set(lx, 2.7, lz);
    pole.castShadow = true;
    group.add(pole);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), lampMat);
    lamp.position.set(lx, 5.5, lz);
    group.add(lamp);
  }

  // barrels for flavour (small, collidable)
  const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.05, 12);
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x4a5a66, roughness: 0.7, metalness: 0.3 });
  for (const [bx, bz] of [[-2, 20], [2.4, 20.4], [30, 8], [-30, 8], [12, -18.5]]) {
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.set(bx, 0.52, bz);
    barrel.castShadow = true;
    group.add(barrel);
    colliders.push({ minX: bx - 0.42, maxX: bx + 0.42, minY: 0, maxY: 1.05, minZ: bz - 0.42, maxZ: bz + 0.42 });
  }

  scene.add(group);

  const waypoints = WAYPOINTS.map(([x, z], i) => ({ id: i, x, z, links: [] }));
  for (const [a, b] of EDGES) {
    waypoints[a].links.push(b);
    waypoints[b].links.push(a);
  }
  return { colliders, waypoints, group };
}

// --- collision helpers -------------------------------------------------------

export function pointBlocked(colliders, x, y, z, r) {
  for (const c of colliders) {
    if (y < c.maxY && y + 1.7 > c.minY &&
      x + r > c.minX && x - r < c.maxX &&
      z + r > c.minZ && z - r < c.maxZ) return true;
  }
  return false;
}

// Axis-separated move: returns the new position, sliding along walls.
export function moveEntity(colliders, pos, dx, dz, r, height) {
  let nx = pos.x + dx;
  if (!pointBlocked(colliders, nx, pos.y, pos.z, r)) pos.x = nx;
  else {
    // try sliding with a smaller step, then give up on x
    nx = pos.x + dx * 0.5;
    if (!pointBlocked(colliders, nx, pos.y, pos.z, r)) pos.x = nx;
  }
  let nz = pos.z + dz;
  if (!pointBlocked(colliders, pos.x, pos.y, nz, r)) pos.z = nz;
  else {
    nz = pos.z + dz * 0.5;
    if (!pointBlocked(colliders, pos.x, pos.y, nz, r)) pos.z = nz;
  }
  pos.x = Math.max(MAP.minX + r, Math.min(MAP.maxX - r, pos.x));
  pos.z = Math.max(MAP.minZ + r, Math.min(MAP.maxZ - r, pos.z));
  return pos;
}

// Slab ray test against one AABB. Returns t or Infinity.
export function rayBox(ox, oy, oz, dx, dy, dz, b) {
  let tmin = 0;
  let tmax = Infinity;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  const mn = [b.minX, b.minY, b.minZ];
  const mx = [b.maxX, b.maxY, b.maxZ];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return Infinity;
    } else {
      let t1 = (mn[i] - o[i]) / d[i];
      let t2 = (mx[i] - o[i]) / d[i];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

// Nearest map hit along a ray; Infinity when clear. `maxDist` caps the search.
export function traceMap(colliders, ox, oy, oz, dx, dy, dz, maxDist) {
  let best = maxDist;
  for (const c of colliders) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, c);
    if (t < best) best = t;
  }
  return best;
}

// True when the segment from a to b is not blocked by the map.
export function segmentClear(colliders, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  const t = traceMap(colliders, ax, ay, az, dx / len, dy / len, dz / len, len);
  return t >= len;
}
