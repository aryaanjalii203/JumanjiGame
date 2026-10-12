// Deterministic world layout, terrain and collision — shared by server (authority) and client (prediction + rendering).

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const RAVINE = { z0: 165, z1: 185 };
export const BRIDGE = { x0: -3, x1: 3 };
export const LOG = { x0: -32, x1: -28 };
export const ARENA = { x: 0, z: 400, r: 40 };
export const HEART = { x: 0, z: 505, r: 28 };
export const BOUNDS = { x: 56, z0: -4, z1: 542 };

// Key points used by missions, AI and rendering.
export const POINTS = {
  spawn: { x: 0, z: 6 },
  shelter: { x: -8, z: 42 },
  mapFragment: { x: 24, z: 104 },
  camp: { x: 0, z: 140 },
  winchL: { x: -9, z: 158 },
  winchR: { x: 9, z: 158 },
  log: { x: -30, z: 159 },
  far: { x: 0, z: 200 },
  plates: [{ x: -11, z: 260 }, { x: 0, z: 255 }, { x: 11, z: 260 }],
  pillars: [{ x: -15, z: 292 }, { x: -5, z: 292 }, { x: 5, z: 292 }, { x: 15, z: 292 }],
  mural: { x: 0, z: 308.5 },
  heartKey: { x: 0, z: 326 },
  cracked: { x: 29, z: 290 },
  templeExit: { x: 0, z: 345 },
  anchors: [{ x: -24, z: 400 }, { x: 24, z: 400 }],
  portal: { x: 0, z: 432 },
  labEntry: { x: 0, z: 460 },
  terminals: [{ x: -8, z: 466 }, { x: 8, z: 466 }, { x: 0, z: 474 }],
  relic: { x: 0, z: 505 },
  cradle: { x: 0, z: 528 },
  records: [{ x: -46, z: 68 }, { x: 34, z: 290 }, { x: 40, z: 352 }],
  caches: [{ x: 6, z: 138 }, { x: 4, z: 202 }, { x: -6, z: 343 }, { x: 6, z: 462 }],
};
// Altars for the final choice and the nodes/stones each path uses.
POINTS.altars = [
  { id: 'restore', x: -14, z: 492 }, { id: 'destroy', x: 14, z: 492 }, { id: 'separate', x: 0, z: 485 },
];
POINTS.nodes = [0, 1, 2].map(i => {
  const a = i * (Math.PI * 2 / 3) + Math.PI / 2;
  const x = Math.cos(a) * 12, z = HEART.z + Math.sin(a) * 12;
  const t = { x: -Math.sin(a), z: Math.cos(a) };
  return { x, z, plates: [{ x: x + t.x * 5, z: z + t.z * 5 }, { x: x - t.x * 5, z: z - t.z * 5 }] };
});
POINTS.stones = [0, 1, 2, 3, 4].map(i => {
  const a = i * (Math.PI * 2 / 5) - Math.PI / 2;
  return { x: Math.cos(a) * 18, z: HEART.z + Math.sin(a) * 18 };
});

// Checkpoint per mission (index = mission number).
export const CHECKPOINTS = [
  { x: 0, z: 6 }, { x: 0, z: 6 }, { x: 0, z: 140 }, { x: 0, z: 200 }, { x: 0, z: 345 }, { x: 0, z: 460 }, { x: 0, z: 488 },
];

// Path centreline through the jungle so trees leave a readable trail.
export function pathX(z) { return Math.sin(z * 0.035) * 9; }

function hillAmp(z) {
  if (z < 8) return 0.15;
  if (z > 250) return 0;
  if (z > RAVINE.z0 - 8 && z < RAVINE.z1 + 8) return 0.2;
  return 1;
}

export function baseHeight(x, z) {
  const a = hillAmp(z);
  if (!a) return 0;
  const h = 1.1 * Math.sin(x * 0.08 + 1) * Math.cos(z * 0.06) + 0.7 * Math.sin(z * 0.13 + x * 0.05) + 0.4 * Math.cos(x * 0.21 - z * 0.04);
  const edge = Math.max(0, Math.abs(x) - 40) * 0.25;           // terrain rises toward the cliff walls
  const trail = Math.min(1, Math.abs(x - pathX(z)) / 8);           // trail is flatter
  return a * (h * (0.35 + 0.65 * trail)) + edge;
}

export function inRavine(x, z) { return z > RAVINE.z0 && z < RAVINE.z1; }

export function onCrossing(x, z, dyn) {
  if (dyn.bridge && x > BRIDGE.x0 && x < BRIDGE.x1) return true;
  if (dyn.log && x > LOG.x0 && x < LOG.x1) return true;
  return false;
}

export function groundHeight(x, z, dyn) {
  if (inRavine(x, z)) return onCrossing(x, z, dyn) ? 0.3 : -60;
  return baseHeight(x, z);
}

// ---- Static colliders -----------------------------------------------------
// circle: {x,z,r,top}  box: {x0,x1,z0,z1,top,id?}   top=Infinity means unclimbable.

function buildColliders() {
  const R = rng(1989);
  const circles = [];
  const boxes = [];
  const trees = [];
  const keep = [POINTS.spawn, POINTS.shelter, POINTS.mapFragment, POINTS.camp, POINTS.winchL, POINTS.winchR, POINTS.log,
    POINTS.records[0], ...POINTS.caches];
  const clear = (x, z, d) => keep.some(p => Math.hypot(p.x - x, p.z - z) < d);

  // Jungle trees (Region A).
  for (let i = 0; i < 520; i++) {
    const z = 14 + R() * 238, x = (R() * 2 - 1) * 54;
    if (inRavine(x, z) || (z > RAVINE.z0 - 7 && z < RAVINE.z1 + 5)) continue;
    if (Math.abs(x - pathX(z)) < 6.5) continue;
    if (clear(x, z, 7.5)) continue;
    if (z > 236 && Math.abs(x) < 46) continue;
    const r = 0.45 + R() * 0.55;
    const tree = { x, z, r, top: Infinity, h: 9 + R() * 9, kind: R() < 0.2 ? 'palm' : 'broad', canopy: false };
    trees.push(tree); circles.push(tree);
  }
  // Canopy trees used as Stalker perches along the bridge approach.
  for (const [x, z] of [[-14, 118], [13, 128], [-12, 146], [15, 150], [-16, 200], [14, 214]]) {
    const t = { x, z, r: 1.3, top: Infinity, h: 16, kind: 'giant', canopy: true };
    trees.push(t); circles.push(t);
  }
  // Rocks.
  for (let i = 0; i < 70; i++) {
    const z = 10 + R() * 240, x = (R() * 2 - 1) * 50;
    if (inRavine(x, z) || Math.abs(x - pathX(z)) < 5 || clear(x, z, 6)) continue;
    circles.push({ x, z, r: 0.8 + R() * 1.4, top: 0.8 + R() * 1.2, rock: true });
  }

  // Research-station wreck at the start.
  boxes.push({ x0: -14, x1: -6, z0: -2, z1: 4, top: Infinity, deco: 'station' });
  boxes.push({ x0: 8, x1: 13, z0: 0, z1: 5, top: 2.2, deco: 'crate' });
  // Shelter (Mission 1) — a ruined lean-to.
  boxes.push({ x0: -12, x1: -11, z0: 38, z1: 46, top: Infinity, deco: 'ruin' });

  // Temple (Region B).
  const T = 4;
  boxes.push({ x0: -42, x1: -T, z0: 268, z1: 272, top: Infinity, deco: 'temple' });
  boxes.push({ x0: T, x1: 42, z0: 268, z1: 272, top: Infinity, deco: 'temple' });
  boxes.push({ x0: -T, x1: T, z0: 268, z1: 272, top: Infinity, id: 'gateA', deco: 'gate' });
  boxes.push({ x0: -42, x1: -38, z0: 268, z1: 338, top: Infinity, deco: 'temple' });
  boxes.push({ x0: 38, x1: 42, z0: 268, z1: 338, top: Infinity, deco: 'temple' });
  boxes.push({ x0: -38, x1: -T, z0: 310, z1: 313, top: Infinity, deco: 'temple' });
  boxes.push({ x0: T, x1: 38, z0: 310, z1: 313, top: Infinity, deco: 'temple' });
  boxes.push({ x0: -T, x1: T, z0: 310, z1: 313, top: Infinity, id: 'gateB', deco: 'gate' });
  boxes.push({ x0: -42, x1: -T, z0: 334, z1: 338, top: Infinity, deco: 'temple' });
  boxes.push({ x0: T, x1: 42, z0: 334, z1: 338, top: Infinity, deco: 'temple' });
  // Secret alcove behind a cracked wall (Lost Record #2).
  boxes.push({ x0: 26, x1: 38, z0: 284, z1: 285, top: Infinity, deco: 'temple' });
  boxes.push({ x0: 26, x1: 38, z0: 296, z1: 297, top: Infinity, deco: 'temple' });
  boxes.push({ x0: 28, x1: 30, z0: 285, z1: 296, top: Infinity, id: 'cracked', deco: 'cracked' });
  // Pillars.
  for (const p of POINTS.pillars) circles.push({ x: p.x, z: p.z, r: 1.1, top: Infinity, pillar: true });

  // Ledge climb for Lost Record #3 (jump + mantle).
  boxes.push({ x0: 33, x1: 37, z0: 350, z1: 354, top: 1.2, deco: 'ledge' });
  boxes.push({ x0: 38, x1: 42, z0: 350, z1: 354, top: 2.4, deco: 'ledge' });

  // Arena ring (Region D/E boundary) with a south opening.
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const x = ARENA.x + Math.cos(a) * (ARENA.r + 2), z = ARENA.z + Math.sin(a) * (ARENA.r + 2);
    if (z < ARENA.z - 30 && Math.abs(x) < 9) continue;
    circles.push({ x, z, r: 3.4, top: Infinity, rock: true, big: true });
  }
  // Pillars of the arena that block the far north (nothing beyond except via portal).
  boxes.push({ x0: -56, x1: 56, z0: 446, z1: 452, top: Infinity, deco: 'void' });

  // Heart of the Relic (Region E): lab corridor then chamber.
  boxes.push({ x0: -14, x1: -10, z0: 452, z1: 480, top: Infinity, deco: 'lab' });
  boxes.push({ x0: 10, x1: 14, z0: 452, z1: 480, top: Infinity, deco: 'lab' });
  boxes.push({ x0: -10, x1: 10, z0: 478, z1: 480, top: Infinity, id: 'heartDoor', deco: 'gate' });
  boxes.push({ x0: -40, x1: -10, z0: 476, z1: 480, top: Infinity, deco: 'heart' });
  boxes.push({ x0: 10, x1: 40, z0: 476, z1: 480, top: Infinity, deco: 'heart' });
  boxes.push({ x0: -40, x1: -36, z0: 480, z1: 542, top: Infinity, deco: 'heart' });
  boxes.push({ x0: 36, x1: 40, z0: 480, z1: 542, top: Infinity, deco: 'heart' });
  return { circles, boxes, trees };
}

export const WORLD = buildColliders();

// Region lookup for HUD/music/weather.
export function regionAt(z) {
  if (z < 160) return { id: 'wilds', name: 'The Emerald Wilds' };
  if (z < 250) return { id: 'ravine', name: 'The Broken Ravine' };
  if (z < 345) return { id: 'ruins', name: 'The Forgotten Temple' };
  if (z < 450) return { id: 'peaks', name: 'Colossus Hollow' };
  return { id: 'heart', name: 'The Heart of the Relic' };
}

// ---- Movement -------------------------------------------------------------
export const GRAVITY = 22;
export const JUMP_V = 7.6;

function solid(b, dyn) { return !(b.id && dyn.open && dyn.open.has(b.id)); }

export function supportHeight(x, z, y, dyn) {
  let g = groundHeight(x, z, dyn);
  for (const b of WORLD.boxes) {
    if (b.top === Infinity || !solid(b, dyn)) continue;
    if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && y >= b.top - 0.35) g = Math.max(g, b.top);
  }
  for (const c of WORLD.circles) {
    if (c.top === Infinity) continue;
    if ((x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r && y >= c.top - 0.35) g = Math.max(g, c.top);
  }
  return g;
}

// Push an entity of radius r out of blocking geometry. Climbable tops are stood on, not blocked,
// when the entity's feet are above (mantle tolerance applies while airborne).
export function collide(e, r, dyn, airborne = false) {
  const lift = airborne ? 1.3 : 0.45;
  for (const c of WORLD.circles) {
    if (Math.abs(c.x - e.x) > c.r + r + 1 || Math.abs(c.z - e.z) > c.r + r + 1) continue;
    if (c.top !== Infinity && e.y + lift >= c.top) { if (airborne) continue; else if (e.y >= c.top - 0.35) continue; }
    const dx = e.x - c.x, dz = e.z - c.z, d = Math.hypot(dx, dz), min = c.r + r;
    if (d < min && d > 1e-6) { e.x = c.x + dx / d * min; e.z = c.z + dz / d * min; }
  }
  for (const b of WORLD.boxes) {
    if (!solid(b, dyn)) continue;
    if (b.top !== Infinity && e.y + lift >= b.top) {
      if (airborne && e.x > b.x0 - r && e.x < b.x1 + r && e.z > b.z0 - r && e.z < b.z1 + r) e.y = Math.max(e.y, b.top);
      continue;
    }
    const cx = Math.max(b.x0, Math.min(e.x, b.x1)), cz = Math.max(b.z0, Math.min(e.z, b.z1));
    const dx = e.x - cx, dz = e.z - cz, d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-9) { const d = Math.sqrt(d2); e.x = cx + dx / d * r; e.z = cz + dz / d * r; }
    else { // centre inside box: push out along smallest axis
      const pushes = [[e.x - b.x0 + r, -1, 0], [b.x1 - e.x + r, 1, 0], [e.z - b.z0 + r, 0, -1], [b.z1 - e.z + r, 0, 1]];
      pushes.sort((a, c) => a[0] - c[0]);
      e.x += pushes[0][1] * pushes[0][0]; e.z += pushes[0][2] * pushes[0][0];
    }
  }
  e.x = Math.max(-BOUNDS.x, Math.min(BOUNDS.x, e.x));
  e.z = Math.max(BOUNDS.z0, Math.min(BOUNDS.z1, e.z));
}

// One movement step. `inp` = {mx, mz, jump} in world space; `speed` already includes modifiers.
export function stepMove(e, inp, speed, dt, dyn, r = 0.5) {
  let mx = +inp.mx || 0, mz = +inp.mz || 0;
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  const airborne = !e.onGround;
  e.x += mx * speed * dt; e.z += mz * speed * dt;
  collide(e, r, dyn, airborne);
  const g = supportHeight(e.x, e.z, e.y, dyn);
  if (e.onGround && inp.jump) { e.vy = JUMP_V; e.onGround = false; }
  e.vy -= GRAVITY * dt;
  e.y += e.vy * dt;
  if (e.y <= g) {
    if (e.onGround && g - e.y > 0.6) { /* stepping up a small ledge */ }
    e.y = g; e.vy = 0; e.onGround = true;
  } else if (e.onGround && e.y - g < 0.5 && e.vy <= 0) { e.y = g; e.vy = 0; }  // stick to slopes
  else e.onGround = false;
}

// True if a wall (or closed gate) stands between two points — used for line of sight.
export function wallBetween(x1, z1, x2, z2, dyn) {
  const L = Math.hypot(x2 - x1, z2 - z1), n = Math.ceil(L / 0.8);
  for (const b of WORLD.boxes) {
    if (b.top !== Infinity || !solid(b, dyn)) continue;
    if (Math.max(x1, x2) < b.x0 || Math.min(x1, x2) > b.x1 || Math.max(z1, z2) < b.z0 || Math.min(z1, z2) > b.z1) continue;
    for (let i = 1; i < n; i++) {
      const t = i / n, x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
      if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return true;
    }
  }
  return false;
}
