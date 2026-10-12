// Boss encounters: The Hollow Colossus (multi-phase, team mechanics) and The Curator (final confrontation).
import { CREATURES } from '../shared/data.js';
import { ARENA, HEART } from '../shared/world.js';
import { spawnCreature } from './creatures.js';

const r2 = v => Math.round(v * 100) / 100;

function hurtArea(s, test, dmg, src) {
  for (const p of s.alivePlayers()) if (test(p)) s.hurtPlayer(p, dmg, src);
}

export class Colossus {
  constructor(s) {
    this.type = 'colossus';
    this.x = ARENA.x; this.z = ARENA.z + 6; this.yaw = Math.PI;
    this.maxHp = 950; this.hp = this.maxHp;
    this.plates = [0, 1, 2, 3].map(i => ({ i, hp: 190, a: Math.PI / 4 + i * Math.PI / 2 }));
    this.phase = 1; this.knelt = 0; this.anchorT = 0;
    this.timers = { stomp: 3, sweep: 5, rock: 6, hazard: 4 };
    this.tels = [];          // pending telegraphed attacks
    this.overloadUntil = 0; this.summoned = new Set();
    s.event('boss', { type: 'colossus', state: 'spawn' });
  }
  platePos(p) { return { x: this.x + Math.cos(p.a + this.yaw) * 3.4, z: this.z + Math.sin(p.a + this.yaw) * 3.4 }; }

  hitboxes(out) {
    for (const p of this.plates) if (p.hp > 0) { const q = this.platePos(p); out.push({ kind: 'boss', part: 'plate', i: p.i, x: q.x, z: q.z, r: 1.4 }); }
    out.push({ kind: 'boss', part: 'core', x: this.x, z: this.z, r: 2.4 });
  }

  damage(t, base, p) {
    const ov = this.overloadUntil > (this._t || 0) ? 3 : 1;
    if (t.part === 'plate') {
      const pl = this.plates[t.i];
      if (pl.hp <= 0) return 0;
      const dealt = Math.min(pl.hp, base * ov * (p.avatar === 'wraith' ? 0.5 : 1));
      pl.hp -= dealt;
      if (pl.hp <= 0) { this._s.event('boss', { type: 'colossus', state: 'plate', i: t.i }); }
      return dealt;
    }
    if (!this.knelt) return 0;            // core is out of reach unless the team drags it down
    const dealt = Math.min(this.hp, base * (ov > 1 ? 2 : 1) * 1.2);
    this.hp -= dealt;
    return dealt;
  }

  taunt(p, dur) { this.tauntSlot = p.slot; this.tauntUntil = this._t + dur; }

  update(s, dt) {
    this._s = s; this._t = s.t;
    if (this.hp <= 0) return;
    const brokenPlates = this.plates.filter(p => p.hp <= 0).length;
    if (this.phase === 1 && brokenPlates === 4) {
      this.phase = 2; s.event('boss', { type: 'colossus', state: 'phase', phase: 2 });
      s.say('STEWARD', 'Its legs are bare — now pull the chains, together, or not at all.');
    }
    if (this.phase === 2 && this.hp < this.maxHp * 0.35) {
      this.phase = 3; s.event('boss', { type: 'colossus', state: 'phase', phase: 3 });
      s.say('CURATOR', 'Get UP. Get up!');
    }
    for (const pct of [0.75, 0.5, 0.25]) {
      if (this.hp < this.maxHp * pct && !this.summoned.has(pct)) {
        this.summoned.add(pct);
        for (const sx of [-1, 0, 1]) spawnCreature(s, 'razorback', ARENA.x + sx * 30, ARENA.z - 20 - Math.abs(sx) * 0, { aggro: true, home: { x: ARENA.x, z: ARENA.z } });
        s.say('STEWARD', 'The hollow calls its hounds.');
      }
    }
    // Kneel mechanic: both anchors held at once.
    if (this.knelt > 0) {
      this.knelt -= dt;
      if (this.knelt <= 0) { this.knelt = 0; s.event('boss', { type: 'colossus', state: 'rise' }); }
    } else if (this.phase >= 2) {
      const anchors = [...s.objects.values()].filter(o => o.kind === 'anchor');
      if (anchors.length === 2 && anchors.every(a => a.on)) {
        this.anchorT += dt;
        if (this.anchorT >= 1.5) {
          this.knelt = this.phase === 3 ? 6 : 8; this.anchorT = 0; this.tels = [];
          s.event('boss', { type: 'colossus', state: 'kneel' });
        }
      } else this.anchorT = Math.max(0, this.anchorT - dt * 2);
    }
    // Resolve telegraphs.
    for (const tel of this.tels) tel.t -= dt;
    for (const tel of this.tels.filter(t => t.t <= 0)) {
      if (tel.kind === 'ring') hurtArea(s, p => Math.hypot(p.x - tel.x, p.z - tel.z) < tel.r, tel.dmg, this);
      if (tel.kind === 'cone') hurtArea(s, p => {
        const dx = p.x - tel.x, dz = p.z - tel.z, d = Math.hypot(dx, dz);
        return d < tel.r && (dx * Math.sin(tel.yaw) + dz * Math.cos(tel.yaw)) > 0;
      }, tel.dmg, this);
      s.event('fx', { kind: 'quake', x: r2(tel.x), z: r2(tel.z), big: tel.r > 6 });
    }
    this.tels = this.tels.filter(t => t.t > 0);
    if (this.knelt > 0) return;

    // Movement: lumber toward the taunting Titan, or the nearest player, staying inside the arena.
    const alive = s.alivePlayers().filter(p => Math.hypot(p.x - ARENA.x, p.z - ARENA.z) < ARENA.r + 4);
    if (!alive.length) return;
    let tgt = (this.tauntUntil > s.t && s.slots[this.tauntSlot]?.state === 'alive') ? s.slots[this.tauntSlot] : null;
    if (!tgt) tgt = alive.reduce((a, b) => (Math.hypot(a.x - this.x, a.z - this.z) < Math.hypot(b.x - this.x, b.z - this.z) ? a : b));
    const want = Math.atan2(tgt.x - this.x, tgt.z - this.z);
    let dy = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
    this.yaw += Math.max(-0.9 * dt, Math.min(0.9 * dt, dy));
    const d = Math.hypot(tgt.x - this.x, tgt.z - this.z);
    if (d > 7) {
      const nx = this.x + Math.sin(this.yaw) * 1.6 * dt, nz = this.z + Math.cos(this.yaw) * 1.6 * dt;
      if (Math.hypot(nx - ARENA.x, nz - ARENA.z) < 24) { this.x = nx; this.z = nz; }
    }
    // Attacks — every one telegraphed on the ground first.
    const fast = this.phase === 3;
    for (const k in this.timers) this.timers[k] -= dt;
    if (this.timers.stomp <= 0) { this.timers.stomp = fast ? 2.6 : 4.2; this.tels.push({ kind: 'ring', x: this.x, z: this.z, r: 8, t: 1.3, dmg: CREATURES.colossus.dmg, tot: 1.3 }); }
    if (this.timers.sweep <= 0) { this.timers.sweep = 6.5; this.tels.push({ kind: 'cone', x: this.x, z: this.z, yaw: this.yaw, r: 11, t: 1.0, dmg: 26, tot: 1.0 }); }
    if (this.phase >= 2 && this.timers.rock <= 0) {
      this.timers.rock = 7;
      const far = alive.reduce((a, b) => (Math.hypot(a.x - this.x, a.z - this.z) > Math.hypot(b.x - this.x, b.z - this.z) ? a : b));
      this.tels.push({ kind: 'ring', x: far.x, z: far.z, r: 3, t: 1.6, dmg: 24, tot: 1.6 });
    }
    if (fast && this.timers.hazard <= 0) {
      this.timers.hazard = 5;
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 26;
        this.tels.push({ kind: 'ring', x: ARENA.x + Math.cos(a) * r, z: ARENA.z + Math.sin(a) * r, r: 3.5, t: 1.5, dmg: 18, tot: 1.5 });
      }
    }
  }

  view(s) {
    return {
      type: 'colossus', name: CREATURES.colossus.name, x: r2(this.x), z: r2(this.z), yaw: r2(this.yaw),
      hp: Math.round(this.hp), mhp: this.maxHp, phase: this.phase, knelt: r2(this.knelt), anchorT: r2(this.anchorT),
      plates: this.plates.map(p => Math.round(p.hp)), pmax: 190, ov: this.overloadUntil > s.t ? 1 : 0,
      tels: this.tels.map(t => ({ k: t.kind, x: r2(t.x), z: r2(t.z), r: t.r, yaw: r2(t.yaw || 0), p: r2(1 - t.t / t.tot) })),
    };
  }
}

export class Curator {
  constructor(s) {
    this.type = 'curator';
    this.x = HEART.x; this.z = HEART.z; this.yaw = Math.PI;
    this.maxHp = CREATURES.curator.hp; this.hp = this.maxHp;
    this.timers = { beam: 4, blink: 9, wave: 0 };
    this.tels = []; this.waves = 0; this.shield = true; this.overloadUntil = 0;
    s.event('boss', { type: 'curator', state: 'spawn' });
  }
  hitboxes(out) { out.push({ kind: 'boss', part: 'body', x: this.x, z: this.z, r: 1.6 }); }
  damage(t, base) {
    if (this.shield) return 0;
    const dealt = Math.min(this.hp, base);
    this.hp -= dealt;
    return dealt;
  }
  spawnWave(s) {
    this.waves++;
    const n = Math.min(4 + this.waves, 8);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.waves;
      const type = i % 3 === 2 && this.waves >= 2 ? 'guardian' : 'razorback';
      const c = spawnCreature(s, type, HEART.x + Math.cos(a) * 20, HEART.z + Math.sin(a) * 20, { aggro: true, wave: true, leash: { x: HEART.x, z: HEART.z, r: 30 } });
      c.target = null; c.state = type === 'razorback' ? 'chase' : 'chase';
    }
    s.say('CURATOR', ['Hold them!', 'Again. AGAIN.', 'I made you. Obey me.', 'Do not let them near it!'][this.waves % 4]);
  }
  update(s, dt) {
    if (this.hp <= 0) return;
    const waveAlive = [...s.creatures.values()].some(c => c.wave && c.hp > 0 && c.state !== 'dead' && Math.hypot(c.x - HEART.x, c.z - HEART.z) < 34);
    const was = this.shield;
    this.shield = waveAlive;
    if (was && !this.shield) { this.timers.wave = 12; s.event('boss', { type: 'curator', state: 'exposed' }); }
    if (!this.shield) { this.timers.wave -= dt; if (this.timers.wave <= 0) this.spawnWave(s); }
    if (this.waves === 0) this.spawnWave(s);
    for (const tel of this.tels) tel.t -= dt;
    for (const tel of this.tels.filter(t => t.t <= 0)) {
      hurtArea(s, p => {
        const vx = tel.tx - tel.x, vz = tel.tz - tel.z, L = Math.hypot(vx, vz);
        const u = ((p.x - tel.x) * vx + (p.z - tel.z) * vz) / (L * L);
        if (u < 0 || u > 1) return false;
        return Math.hypot(tel.x + vx * u - p.x, tel.z + vz * u - p.z) < tel.w / 2 + 0.4;
      }, CREATURES.curator.dmg, this);
      s.event('fx', { kind: 'beam', x: r2(tel.x), z: r2(tel.z), tx: r2(tel.tx), tz: r2(tel.tz) });
    }
    this.tels = this.tels.filter(t => t.t > 0);
    for (const k of ['beam', 'blink']) this.timers[k] -= dt;
    const alive = s.alivePlayers();
    if (!alive.length) return;
    const tgt = alive[Math.floor(Math.random() * alive.length)];
    if (this.timers.beam <= 0) {
      this.timers.beam = this.shield ? 5 : 3.5;
      const dx = tgt.x - this.x, dz = tgt.z - this.z, d = Math.hypot(dx, dz) || 1;
      this.yaw = Math.atan2(dx, dz);
      this.tels.push({ kind: 'line', x: this.x, z: this.z, tx: this.x + dx / d * 34, tz: this.z + dz / d * 34, w: 1.8, t: 1.2, tot: 1.2 });
    }
    if (this.timers.blink <= 0) {
      this.timers.blink = 9;
      const a = Math.random() * Math.PI * 2;
      this.x = HEART.x + Math.cos(a) * 8; this.z = HEART.z + Math.sin(a) * 8;
      s.event('fx', { kind: 'blink', x: r2(this.x), z: r2(this.z) });
    }
  }
  view() {
    return {
      type: 'curator', name: CREATURES.curator.name, x: r2(this.x), z: r2(this.z), yaw: r2(this.yaw), hp: Math.round(this.hp), mhp: this.maxHp,
      shield: this.shield ? 1 : 0, tels: this.tels.map(t => ({ k: 'line', x: r2(t.x), z: r2(t.z), tx: r2(t.tx), tz: r2(t.tz), w: t.w, p: r2(1 - t.t / t.tot) })),
    };
  }
}
