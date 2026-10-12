// AI companions: fill empty or disconnected slots. They revive, take puzzle/boss stations, fight, heal and follow.
import { AVATARS } from '../shared/data.js';
import { RAVINE, BRIDGE, LOG, POINTS, inRavine } from '../shared/world.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const DOORS = [{ z: 270, id: 'gateA' }, { z: 311.5, id: 'gateB' }, { z: 336, id: null }, { z: 479, id: 'heartDoor' }];

// Route around the few chokepoints so companions don't grind against walls or walk into the ravine.
export function route(s, p, t) {
  const crossX = s.dyn.bridge ? 0 : s.dyn.log ? (LOG.x0 + LOG.x1) / 2 : null;
  const side = z => (z < RAVINE.z0 ? -1 : z > RAVINE.z1 ? 1 : 0);
  if (side(p.z) !== side(t.z) && !(side(p.z) === 0 || side(t.z) === 0)) {
    if (crossX == null) return { x: t.x, z: side(p.z) < 0 ? RAVINE.z0 - 3 : RAVINE.z1 + 3 };
    if (Math.abs(p.x - crossX) > 1.2) return { x: crossX, z: side(p.z) < 0 ? RAVINE.z0 - 2 : RAVINE.z1 + 2 };
    return { x: crossX, z: t.z };
  }
  if (inRavine(p.x, p.z) && crossX != null) return { x: crossX, z: t.z };
  for (const d of DOORS) {
    if ((p.z - d.z) * (t.z - d.z) < 0 && Math.abs(p.x) > 2.2 && Math.abs(p.z - d.z) < 40 && Math.abs(p.x) < 40) {
      if (d.id && !s.dyn.open.has(d.id)) return { x: t.x, z: p.z };   // closed: wait on this side
      return { x: 0, z: d.z + (p.z < d.z ? -3 : 3) };
    }
  }
  return t;
}

function telegraphDanger(s, p) {
  for (const c of s.creatures.values()) {
    const t = c.tel;
    if (t && t.kind === 'ring' && Math.hypot(p.x - t.x, p.z - t.z) < t.r + 0.8) return { x: t.x, z: t.z };
    if (t && t.kind === 'line') {
      const vx = t.tx - t.x, vz = t.tz - t.z, L2 = vx * vx + vz * vz, u = ((p.x - t.x) * vx + (p.z - t.z) * vz) / L2;
      if (u > 0 && u < 1 && Math.hypot(t.x + vx * u - p.x, t.z + vz * u - p.z) < 1.6) return { x: t.x + vx * u, z: t.z + vz * u };
    }
  }
  const b = s.boss?.view?.(s);
  for (const t of b?.tels || []) {
    if (t.k === 'ring' && Math.hypot(p.x - t.x, p.z - t.z) < t.r + 0.6) return { x: t.x, z: t.z };
    if (t.k === 'cone' && Math.hypot(p.x - t.x, p.z - t.z) < t.r && ((p.x - t.x) * Math.sin(t.yaw) + (p.z - t.z) * Math.cos(t.yaw)) > 0) return { x: t.x, z: t.z };
  }
  return null;
}

function nearestEnemy(s, p, range) {
  let best = null, bd = range;
  for (const h of s.hittables()) {
    if (h.kind === 'object') continue;
    if (h.kind === 'boss' && h.part === 'core' && !(s.boss?.knelt > 0) && s.boss?.type === 'colossus') continue;
    if (h.kind === 'boss' && s.boss?.shield) continue;
    const d = dist(p, h) - h.r;
    if (d < bd) { bd = d; best = h; }
  }
  return best;
}

export function aiInput(s, p, dt) {
  const m = p.aiMem;
  const inp = { mx: 0, mz: 0, yaw: p.yaw, sprint: false, crouch: false, jump: false };
  const A = AVATARS[p.avatar];
  const go = (t, sprint = false, stopAt = 0.6) => {
    const r = route(s, p, t);
    const dx = r.x - p.x, dz = r.z - p.z, d = Math.hypot(dx, dz);
    if (d > stopAt) { inp.mx = dx / d; inp.mz = dz / d; inp.yaw = Math.atan2(dx, dz); inp.sprint = sprint && d > 6; }
    return dist(p, t);
  };

  // Unstick: if trying to move but not moving, sidestep briefly.
  m.chk = (m.chk || 0) - dt;
  if (m.chk <= 0) { m.chk = 1; m.stuck = m.last && dist(m.last, p) < 0.3 && m.wantMove ? 0.8 : 0; m.last = { x: p.x, z: p.z }; m.side = Math.random() < 0.5 ? 1 : -1; }

  if (p.holding) {
    // Keep holding (winch, revive, terminal) unless danger.
    if (!telegraphDanger(s, p)) return inp;
    s.doAction(p, 'interactEnd');
  }

  // Carrying the Relic: walk it to the Cradle and stay there while it binds.
  if (p.carrying) { go(POINTS.cradle, false, 0.8); m.wantMove = dist(p, POINTS.cradle) > 0.8; return inp; }

  // Leader: nearest living human, else nearest living teammate.
  const humans = s.players().filter(q => q.human && q.connected && q.state === 'alive');
  const pool = humans.length ? humans : s.alivePlayers().filter(q => q !== p);
  const leader = pool.length ? pool.reduce((a, b) => (dist(a, p) < dist(b, p) ? a : b)) : null;

  // Catch-up teleport when far behind and out of combat.
  if (leader && dist(leader, p) > 55 && !nearestEnemy(s, p, 20) && leader.onGround && !inRavine(leader.x, leader.z)) {
    const a = p.slot * 1.3;
    p.x = leader.x - Math.sin(leader.yaw) * 3 + Math.cos(a); p.z = leader.z - Math.cos(leader.yaw) * 3 + Math.sin(a); p.y = leader.y + 1; p.vy = 0;
    return inp;
  }

  // Self-care & support abilities.
  if (p.hp < p.maxHp * 0.35 && p.herbs > 0) s.doAction(p, 'herb');
  let danger = telegraphDanger(s, p);
  if (danger) {
    // Companions notice only some telegraphs (decided once per threat), and react late.
    const key = `${Math.round(danger.x)},${Math.round(danger.z)}`;
    if (m.threat !== key) { m.threat = key; m.notice = Math.random() < 0.55; m.react = 0.15 + Math.random() * 0.35; }
    m.react -= dt;
    if (!m.notice || m.react > 0) danger = null;
  }
  if (danger) {
    const dx = p.x - danger.x, dz = p.z - danger.z, d = Math.hypot(dx, dz) || 1;
    inp.mx = dx / d; inp.mz = dz / d; inp.yaw = Math.atan2(dx, dz);
    if (p.stamina > 40 && p.cd.dodge <= 0) { p.input = inp; s.doAction(p, 'dodge'); }
    m.wantMove = true;
    return inp;
  }
  const team = s.alivePlayers();
  const hurt = team.filter(q => q.hp < q.maxHp * 0.55 && dist(q, p) < 10);
  const enemiesNear = [...s.creatures.values()].filter(c => c.hp > 0 && dist(c, p) < 10);
  if (p.cd.q <= 0) {
    if (p.avatar === 'oracle' && hurt.length) s.doAction(p, 'q', p.yaw);
    if (p.avatar === 'titan' && enemiesNear.length >= 2) s.doAction(p, 'q', p.yaw);
    if (p.avatar === 'circuit' && enemiesNear.length >= 3) s.doAction(p, 'q', p.yaw);
    if (p.avatar === 'wraith' && [...s.creatures.values()].some(c => c.hp > 0 && dist(c, p) < 20 && !(c.markedUntil > s.t))) s.doAction(p, 'q', p.yaw);
    if (p.avatar === 'phantom' && p.hp < p.maxHp * 0.35 && enemiesNear.length) s.doAction(p, 'q', p.yaw);
  }
  if (p.cd.e <= 0) {
    if (p.avatar === 'circuit' && (s.boss && dist(s.boss, p) < 25 || enemiesNear.some(c => c.type === 'guardian'))) s.doAction(p, 'e', p.yaw);
    if (p.avatar === 'oracle' && enemiesNear.length) s.doAction(p, 'e', p.yaw);
    if (p.avatar === 'phantom' && team.some(q => dist(q, p) < 9 && q.hp < q.maxHp * 0.3)) s.doAction(p, 'e', p.yaw);
  }

  // 1. Revive downed teammates.
  const downed = s.players().filter(q => q.state === 'downed' && dist(q, p) < 30 && !s.players().some(r => r !== p && r.holding?.revive === q.slot));
  if (downed.length) {
    const q = downed.reduce((a, b) => (dist(a, p) < dist(b, p) ? a : b));
    if (go(q, true, 1.6) < 2.2) s.doAction(p, 'interact');
    m.wantMove = true; return inp;
  }

  // 2. Mission stations (plates, winches, anchors, the Relic).
  const ais = s.players().filter(q => !(q.human && q.connected) && q.state === 'alive').sort((a, b) => a.slot - b.slot);
  const open = s.aiTasks.filter(t => t.kind === 'use' || !humans.some(h => (t.kind === 'hold' ? h.holding?.id === t.id : Math.hypot(h.x - t.x, h.z - t.z) < 1.8)));
  // Assign each open task to the closest unassigned AI (stable enough per tick for a small team).
  const assign = new Map();
  for (const t of open) {
    let best = null, bd = Infinity;
    for (const q of ais) { if ([...assign.values()].includes(q.slot)) continue; const d = dist(q, t); if (d < bd) { bd = d; best = q; } }
    if (best) assign.set(t, best.slot);
  }
  const task = [...assign.entries()].find(([, slot]) => slot === p.slot)?.[0];
  if (task) {
    const d = go(task, true, task.kind === 'stand' ? 0.5 : 1.4);
    if ((task.kind === 'hold' || task.kind === 'use') && d < 2.2) s.doAction(p, 'interact');
    // Fight from the station if something comes close.
    const e = nearestEnemy(s, p, A.attack.kind === 'ranged' ? 30 : 3);
    if (e && d < 1.5) { const aim = Math.atan2(e.x - p.x, e.z - p.z); inp.yaw = aim; s.doAction(p, 'atk', aim); }
    m.wantMove = d > 0.6; return inp;
  }

  // Refill ammo.
  if (A.attack.ammo && p.ammo === 0) {
    const cache = POINTS.caches.reduce((a, b) => (dist(a, p) < dist(b, p) ? a : b));
    if (dist(cache, p) < 70) { if (go(cache, true, 1.5) < 2.5) s.doAction(p, 'interact'); m.wantMove = true; return inp; }
  }

  // 3. Combat.
  const e = nearestEnemy(s, p, leader ? 18 : 25);
  if (e && (!leader || dist(e, leader) < 26)) {
    const d = dist(e, p) - e.r;
    const aim = Math.atan2(e.x - p.x, e.z - p.z);
    if (A.attack.kind === 'ranged') {
      if (d > 16) go(e); else if (d < 6) { inp.mx = -Math.sin(aim); inp.mz = -Math.cos(aim); }
    } else if (d > A.attack.range - 0.6) go(e, false, 0.2);
    inp.yaw = aim;
    if (d < A.attack.range + 0.2 || (A.attack.kind === 'ranged' && d < 30)) s.doAction(p, 'atk', aim);
    m.wantMove = true;
    if (m.stuck > 0) { inp.mx += Math.cos(aim) * m.side; inp.mz -= Math.sin(aim) * m.side; m.stuck -= dt; }
    return inp;
  }

  // 4. Follow the leader in a loose formation (or the waypoint if no one to follow).
  const wp = s.mission?.waypoint?.(s);
  let target = null;
  if (leader) {
    const spots = [[1.6, 3.5], [-1.6, 3.5], [2.4, 5], [-2.4, 5], [0.9, 4.5]];
    const [ang, r] = spots[p.slot % 5];
    const a = leader.yaw + ang;
    target = { x: leader.x + Math.sin(a) * r, z: leader.z + Math.cos(a) * r };
    if (dist(target, p) < 2.5) target = null;
  } else if (wp) target = wp;
  if (target) {
    const sprint = leader ? dist(leader, p) > 10 : true;
    go(target, sprint, 0.8);
    m.wantMove = true;
    if (m.stuck > 0) { const ax = inp.mx, az = inp.mz; inp.mx = az * m.side + ax * 0.2; inp.mz = -ax * m.side + az * 0.2; m.stuck -= dt; inp.jump = true; }
  } else m.wantMove = false;
  return inp;
}
