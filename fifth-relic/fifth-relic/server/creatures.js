// Creature AI: explicit state machines with perception (sight cone, distance, noise), telegraphs and counters.
import { CREATURES } from '../shared/data.js';
import { collide, groundHeight, inRavine, onCrossing, WORLD } from '../shared/world.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function spawnCreature(s, type, x, z, opts = {}) {
  const C = CREATURES[type];
  const id = s.id();
  const c = {
    id, type, x, z, y: 0, yaw: Math.PI, hp: C.hp, maxHp: C.hp, r: C.radius, state: 'patrol',
    home: { x, z }, timer: 0, atkCd: 1 + Math.random(), target: null, tel: null, hidden: false,
    markedUntil: 0, revealUntil: 0, overloadUntil: 0, hitters: new Map(), lostT: 0, ...opts,
  };
  if (type === 'stalker') {
    const tree = opts.perch || nearestCanopy(x, z);
    c.perch = tree; c.x = tree.x; c.z = tree.z + 1.2; c.y = 12; c.state = 'perch'; c.hidden = true;
  } else c.y = groundHeight(c.x, c.z, s.dyn);
  if (opts.aggro) { c.state = 'chase'; }
  s.creatures.set(id, c);
  return c;
}

function nearestCanopy(x, z) {
  let best = null, bd = Infinity;
  for (const t of WORLD.trees) if (t.canopy) { const d = Math.hypot(t.x - x, t.z - z); if (d < bd) { bd = d; best = t; } }
  return best;
}

export function validTarget(s, slot) {
  const p = s.slots[slot];
  return p && p.state === 'alive' && !(p.fx.veil > 0) && !(p.fx.smoke > 0) ? p : null;
}

function alliesNear(s, p, r) {
  return s.alivePlayers().filter(q => q !== p && dist(q, p) < r).length;
}

// Sight cone + hearing. Crouching shrinks sight range; loud avatars (TITAN) are heard from further away.
function perceive(s, c) {
  const C = CREATURES[c.type];
  let best = null, bd = Infinity;
  for (const p of s.alivePlayers()) {
    if (!validTarget(s, p.slot)) continue;
    const d = dist(c, p);
    let ang = Math.atan2(p.x - c.x, p.z - c.z) - c.yaw; ang = Math.atan2(Math.sin(ang), Math.cos(ang));
    const seen = d < C.sight * (p.crouch ? 0.55 : 1) && (Math.abs(ang) < 1.05 || d < 4);
    const heard = d < C.hearing * (p.noise ?? 1);
    if ((seen || heard) && d < bd) { bd = d; best = p; }
  }
  return best;
}

function moveToward(s, c, tx, tz, speed, dt) {
  const dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz);
  if (d < 0.05) return d;
  const step = Math.min(d, speed * dt);
  const nx = c.x + dx / d * step, nz = c.z + dz / d * step;
  if (inRavine(nx, nz) && !onCrossing(nx, nz, s.dyn)) return d;   // creatures never walk into the ravine
  c.x = nx; c.z = nz; c.yaw = Math.atan2(dx, dz);
  const e = { x: c.x, z: c.z, y: c.y };
  collide(e, c.r, s.dyn);
  c.x = e.x; c.z = e.z;
  c.y = groundHeight(c.x, c.z, s.dyn);
  return d;
}

function face(c, tx, tz) { c.yaw = Math.atan2(tx - c.x, tz - c.z); }

function hurtInRadius(s, x, z, r, dmg, src, hitSet) {
  for (const p of s.alivePlayers()) {
    if (hitSet && hitSet.has(p.slot)) continue;
    if (Math.hypot(p.x - x, p.z - z) <= r + 0.4) { s.hurtPlayer(p, dmg, src); hitSet?.add(p.slot); }
  }
  for (const o of s.objects.values()) if (o.kind === 'decoy' && Math.hypot(o.x - x, o.z - z) < r) o.until = Math.min(o.until, s.t + 0.5);
}

// Resolve forced targets (decoy > taunt > own choice).
function forcedTarget(s, c) {
  if (c.decoy != null) {
    const d = s.objects.get(c.decoy);
    if (d && d.kind === 'decoy') return { x: d.x, z: d.z, decoy: true };
    c.decoy = null;
  }
  if (c.taunt && c.taunt.until > s.t && validTarget(s, c.taunt.slot)) { c.target = c.taunt.slot; }
  return null;
}

// Pack hunters prefer whoever is most isolated.
function pickIsolated(s, c) {
  let best = null, bs = Infinity;
  for (const p of s.alivePlayers()) {
    if (!validTarget(s, p.slot)) continue;
    const d = dist(c, p);
    if (d > 35) continue;
    const score = d + alliesNear(s, p, 8) * 7;
    if (score < bs) { bs = score; best = p; }
  }
  return best;
}

export function updateCreature(s, c, dt) {
  if (c.state === 'dead') { c.deadT -= dt; if (c.deadT <= 0) s.creatures.delete(c.id); return; }
  c.atkCd = Math.max(0, c.atkCd - dt);
  if (c.stagger > 0) { c.stagger -= dt; c.tel = null; return; }
  for (const [slot, t] of c.hitters) if (s.t - t > 3) c.hitters.delete(slot);
  if (c.type === 'razorback') razorback(s, c, dt);
  else if (c.type === 'stalker') stalker(s, c, dt);
  else if (c.type === 'guardian') guardian(s, c, dt);
}

function patrol(s, c, dt, speedMul, roam) {
  if (!c.wp || dist(c, c.wp) < 1 || (c.timer -= dt) < -6) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * roam;
    c.wp = { x: c.home.x + Math.cos(a) * r, z: c.home.z + Math.sin(a) * r }; c.timer = 0;
  }
  moveToward(s, c, c.wp.x, c.wp.z, CREATURES[c.type].speed * speedMul, dt);
}

function aggro(s, c, p) {
  c.target = p.slot; c.state = 'alert'; c.timer = 0.5; c.tel = { kind: 'alert' };
  // Pack alert: nearby razorbacks join.
  if (c.type === 'razorback') for (const o of s.creatures.values()) {
    if (o !== c && o.type === 'razorback' && o.state === 'patrol' && dist(o, c) < 22) { o.state = 'alert'; o.timer = 0.7; o.target = p.slot; }
  }
}

function razorback(s, c, dt) {
  const C = CREATURES.razorback;
  const forced = forcedTarget(s, c);
  if (c.hp < c.maxHp * 0.3 && !c.fled && c.state !== 'charge') { c.state = 'flee'; c.fled = true; c.timer = 5; c.tel = null; }
  switch (c.state) {
    case 'patrol': {
      patrol(s, c, dt, 0.35, 9);
      const p = perceive(s, c);
      if (p) aggro(s, c, p);
      else if (forced) { c.state = 'chase'; }
      break;
    }
    case 'investigate':
      if (moveToward(s, c, c.noisePos.x, c.noisePos.z, C.speed * 0.6, dt) < 1.5) c.state = 'patrol';
      { const p = perceive(s, c); if (p) aggro(s, c, p); }
      break;
    case 'alert': c.timer -= dt; if (c.timer <= 0) { c.state = 'chase'; c.tel = null; } break;
    case 'circle': {
      const p = validTarget(s, c.target);
      c.timer -= dt;
      if (!p) { c.state = 'chase'; break; }
      const a = Math.atan2(c.z - p.z, c.x - p.x) + dt * 1.1 * (c.id % 2 ? 1 : -1);
      moveToward(s, c, p.x + Math.cos(a) * 8, p.z + Math.sin(a) * 8, C.speed, dt);
      if (c.timer <= 0) { c.state = 'chase'; c.hesitatedAt = s.t; }
      break;
    }
    case 'chase': {
      if (forced?.decoy) {
        if (moveToward(s, c, forced.x, forced.z, C.speed, dt) < 2.2 && c.atkCd <= 0) { c.atkCd = 1.5; hurtInRadius(s, forced.x, forced.z, 1, 0, c); }
        break;
      }
      if ((c.retarget = (c.retarget || 0) - dt) <= 0 && !(c.taunt && c.taunt.until > s.t)) {
        c.retarget = 1; const iso = pickIsolated(s, c); if (iso) c.target = iso.slot;
      }
      const p = validTarget(s, c.target);
      if (!p) {
        c.lostT += dt;
        if (c.lostT > 2.5) { c.state = 'investigate'; c.noisePos = c.lastSeen || c.home; c.lostT = 0; c.target = null; }
        break;
      }
      c.lostT = 0; c.lastSeen = { x: p.x, z: p.z };
      const d = dist(c, p);
      if (d > 45) { c.state = 'patrol'; c.target = null; break; }
      // Coordinated groups make the pack hesitate; lone players get rushed.
      if (alliesNear(s, p, 6) >= 2 && d < 14 && (!c.hesitatedAt || s.t - c.hesitatedAt > 6) && !(c.taunt && c.taunt.until > s.t)) {
        c.state = 'circle'; c.timer = 1.8; break;
      }
      if (d < 7.5 && c.atkCd <= 0) {
        face(c, p.x, p.z);
        c.state = 'windup'; c.timer = 0.65; c.dir = { x: (p.x - c.x) / d, z: (p.z - c.z) / d };
        c.tel = { kind: 'line', x: c.x, z: c.z, tx: c.x + c.dir.x * 9, tz: c.z + c.dir.z * 9, w: 1.4 };
        break;
      }
      moveToward(s, c, p.x, p.z, C.speed, dt);
      break;
    }
    case 'windup': c.timer -= dt; if (c.timer <= 0) { c.state = 'charge'; c.timer = 0.55; c.hitSet = new Set(); } break;
    case 'charge': {
      c.timer -= dt;
      moveToward(s, c, c.x + c.dir.x * 3, c.z + c.dir.z * 3, C.chargeSpeed, dt);
      hurtInRadius(s, c.x, c.z, c.r + 0.6, C.dmg, c, c.hitSet);
      if (c.timer <= 0) { c.state = 'recover'; c.timer = 0.7; c.atkCd = 2.4; c.tel = null; }
      break;
    }
    case 'recover': c.timer -= dt; if (c.timer <= 0) c.state = 'chase'; break;
    case 'flee': {
      c.timer -= dt;
      let near = null, nd = Infinity;
      for (const p of s.alivePlayers()) { const d = dist(c, p); if (d < nd) { nd = d; near = p; } }
      if (near) moveToward(s, c, c.x + (c.x - near.x), c.z + (c.z - near.z), C.speed * 1.1, dt);
      if (c.timer <= 0) { c.state = 'patrol'; c.target = null; c.home = { x: c.x, z: c.z }; c.hp = Math.min(c.maxHp, c.hp + c.maxHp * 0.2); }
      break;
    }
  }
}

function stalker(s, c, dt) {
  const C = CREATURES.stalker;
  switch (c.state) {
    case 'perch': {
      c.hidden = true; c.y = 12; c.x = c.perch.x; c.z = c.perch.z + 1.2;
      c.hp = Math.min(c.maxHp, c.hp + 3 * dt);
      for (const p of s.alivePlayers()) {
        if (!validTarget(s, p.slot)) continue;
        const d = Math.hypot(p.x - c.x, p.z - c.z);
        if (d < 11 && alliesNear(s, p, 8) === 0) {
          c.target = p.slot; c.state = 'rustle'; c.timer = 0.85; c.land = { x: p.x, z: p.z };
          c.tel = { kind: 'ring', x: p.x, z: p.z, r: 2.4 };
          break;
        }
      }
      break;
    }
    case 'rustle': {
      c.timer -= dt;
      const p = validTarget(s, c.target);
      if (p && c.timer > 0.35) { c.land = { x: p.x, z: p.z }; c.tel = { kind: 'ring', x: p.x, z: p.z, r: 2.4 }; }  // tracks briefly, then commits
      if (c.timer <= 0) { c.state = 'pounce'; c.timer = 0.35; c.hidden = false; c.from = { x: c.x, z: c.z, y: c.y }; }
      break;
    }
    case 'pounce': {
      c.timer -= dt;
      const k = 1 - Math.max(0, c.timer) / 0.35;
      c.x = c.from.x + (c.land.x - c.from.x) * k; c.z = c.from.z + (c.land.z - c.from.z) * k;
      c.y = c.from.y * (1 - k) + groundHeight(c.x, c.z, s.dyn) * k;
      if (c.timer <= 0) {
        hurtInRadius(s, c.land.x, c.land.z, 2.4, C.dmg, c);
        c.tel = null; c.state = 'hunt'; c.timer = 8; c.atkCd = 1.2;
        c.y = groundHeight(c.x, c.z, s.dyn);
      }
      break;
    }
    case 'hunt': {
      c.timer -= dt;
      const focused = c.hitters.size >= 2;
      if (c.timer <= 0 || c.hp < c.maxHp * 0.5 || focused) { c.state = 'climb'; c.tel = null; break; }
      const forced = forcedTarget(s, c);
      const p = forced?.decoy ? null : validTarget(s, c.target) || pickIsolated(s, c);
      if (!p) { if (forced?.decoy) moveToward(s, c, forced.x, forced.z, C.speed, dt); else c.state = 'climb'; break; }
      c.target = p.slot;
      const d = dist(c, p);
      if (d < 2.4 && c.atkCd <= 0) {
        face(c, p.x, p.z); c.state = 'swipe'; c.timer = 0.5;
        const fx = c.x + Math.sin(c.yaw) * 1.4, fz = c.z + Math.cos(c.yaw) * 1.4;
        c.tel = { kind: 'ring', x: fx, z: fz, r: 2.0 }; c.swipeAt = { x: fx, z: fz };
      } else moveToward(s, c, p.x, p.z, C.speed, dt);
      break;
    }
    case 'swipe':
      c.timer -= dt;
      if (c.timer <= 0) { hurtInRadius(s, c.swipeAt.x, c.swipeAt.z, 2.0, C.dmg * 0.7, c); c.state = 'hunt'; c.atkCd = 1.6; c.tel = null; }
      break;
    case 'climb': {
      const d = moveToward(s, c, c.perch.x, c.perch.z + 1.2, C.speed * 1.3, dt);
      if (d < 1.2) { c.y += 14 * dt; if (c.y >= 12) { c.state = 'perch'; c.target = null; c.hitters.clear(); } }
      break;
    }
  }
}

function guardian(s, c, dt) {
  const C = CREATURES.guardian;
  if (c.dormant) { c.state = 'dormant'; return; }
  switch (c.state) {
    case 'dormant': c.state = 'patrol'; break;
    case 'patrol': {
      patrol(s, c, dt, 0.5, 6);
      const p = perceive(s, c);
      if (p) { c.target = p.slot; c.state = 'chase'; c.tel = { kind: 'alert' }; }
      if (forcedTarget(s, c)) c.state = 'chase';
      break;
    }
    case 'chase': {
      const forced = forcedTarget(s, c);
      const p = forced?.decoy ? forced : validTarget(s, c.target);
      if (!p) { c.lostT += dt; if (c.lostT > 3) { c.state = 'patrol'; c.lostT = 0; } break; }
      c.lostT = 0;
      const d = dist(c, p);
      if (d < 3.4 && c.atkCd <= 0) {
        face(c, p.x, p.z); c.state = 'slam'; c.timer = 0.95;
        const fx = c.x + Math.sin(c.yaw) * 1.8, fz = c.z + Math.cos(c.yaw) * 1.8;
        c.slamAt = { x: fx, z: fz }; c.tel = { kind: 'ring', x: fx, z: fz, r: 3.2 };
      } else moveToward(s, c, p.x, p.z, C.speed, dt);
      break;
    }
    case 'slam':
      c.timer -= dt;
      if (c.timer <= 0) { hurtInRadius(s, c.slamAt.x, c.slamAt.z, 3.2, C.dmg, c); c.state = 'chase'; c.atkCd = 2.4; c.tel = null; s.event('fx', { kind: 'quake', x: c.slamAt.x, z: c.slamAt.z }); }
      break;
  }
}

// Damage with counters: silent takedowns, marks, armor facing, overload.
export function damageCreature(s, c, base, p) {
  if (c.hp <= 0 || c.state === 'dead') return 0;
  const C = CREATURES[c.type];
  let mult = 1;
  const unaware = ['patrol', 'investigate', 'perch', 'dormant'].includes(c.state) && c.target !== p.slot;
  if (p.avatar === 'wraith' && unaware) { mult *= 3; s.event('fx', { kind: 'takedown', slot: p.slot }); }
  if (c.markedUntil > s.t) mult *= 1.25;
  if (C.armor) {
    const toAtt = Math.atan2(p.x - c.x, p.z - c.z) - c.yaw;
    const front = Math.cos(toAtt) > 0.2;
    const ov = c.overloadUntil > s.t ? 3 : 1;
    if (front) { mult *= (1 - C.armor) * ov; if (p.avatar === 'wraith') mult *= 0.5; }
    else mult *= 1.5 * ov;
  }
  const dealt = Math.min(c.hp, base * mult);
  c.hp -= dealt;
  c.hitters.set(p.slot, s.t);
  if (c.state === 'patrol' || c.state === 'investigate') { c.target = p.slot; c.state = c.type === 'razorback' ? 'alert' : 'chase'; c.timer = 0.3; }
  if (c.state === 'perch') { c.state = 'pounce'; c.timer = 0.35; c.land = { x: p.x, z: p.z }; c.from = { x: c.x, z: c.z, y: c.y }; c.hidden = false; }
  if (c.hp <= 0) {
    c.hp = 0; c.state = 'dead'; c.deadT = 2.5; c.tel = null; c.hidden = false;
    p.stats.kills++;
    s.event('kill', { id: c.id, type: c.type, by: p.slot });
    const oracleNear = s.alivePlayers().some(q => q.avatar === 'oracle' && dist(q, c) < 15);
    if (Math.random() < s.diff.herbChance * (oracleNear ? 1.6 : 1)) s.spawnHerb(c.x, c.z);
    s.mission?.onKill?.(s, c);
  }
  return dealt;
}
