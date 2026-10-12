// Authoritative game session. Owns every gameplay-relevant value; clients only send intent.
import crypto from 'node:crypto';
import { AVATARS, AVATAR_IDS, OUTFITS, MAX_SLOTS, START_LIVES, DIFFICULTY, CREATURES, TICK_HZ } from '../shared/data.js';
import { stepMove, CHECKPOINTS, POINTS, rng } from '../shared/world.js';
import { CUTSCENES, STEWARD_LINES } from '../shared/story.js';
import { updateCreature, spawnCreature, damageCreature } from './creatures.js';
import { MISSIONS } from './missions.js';
import { aiInput } from './ai.js';

const DT = 1 / TICK_HZ;
const RECONNECT_GRACE = 120;   // seconds a disconnected human keeps their slot
const r2 = v => Math.round(v * 100) / 100;

export class Session {
  constructor(code, { difficulty = 'adventurer', save = null } = {}, io) {
    this.code = code;
    this.io = io;                       // { send(slot, msg), broadcast(msg), persist(session) }
    this.difficulty = DIFFICULTY[difficulty] ? difficulty : 'adventurer';
    this.phase = 'lobby';
    this.slots = new Array(MAX_SLOTS).fill(null);
    this.hostSlot = -1;
    this.t = 0; this.tickN = 0;
    this.dyn = { open: new Set(), bridge: false, log: false };
    this.creatures = new Map(); this.objects = new Map();
    this.nextId = 1;
    this.events = [];
    this.missionIdx = save?.missionIdx ?? 1;
    this.mission = null; this.objectives = []; this.mstate = {};
    this.flags = { records: new Set(save?.records || []), choice: null };
    this.seed = save?.seed ?? crypto.randomInt(1e9);
    this.cutscene = null;
    this.aiTasks = [];
    this.boss = null;
    this.startedAt = 0;
    this.ending = null;
    this.teamStats = { wipes: 0 };
    this.lastActive = Date.now();
    this.loaded = !!save;
  }

  get diff() { return DIFFICULTY[this.difficulty]; }
  id() { return this.nextId++; }
  players() { return this.slots.filter(Boolean); }
  humans() { return this.players().filter(p => p.human); }
  connectedHumans() { return this.humans().filter(p => p.connected); }
  alivePlayers() { return this.players().filter(p => p.state === 'alive'); }
  event(type, data = {}) { this.events.push({ type, ...data }); }
  say(speaker, text) { this.event('line', { speaker, text }); }
  steward(key) { if (STEWARD_LINES[key]) this.say('STEWARD', STEWARD_LINES[key]); }

  // ---------------------------------------------------------------- lobby
  addHuman({ name, profileId, profile }) {
    if (this.phase === 'ended') return { error: 'This session has finished.' };
    let slot = this.slots.findIndex(s => s && !s.human && this.phase === 'game');   // take over an AI slot mid-game
    if (slot < 0) slot = this.slots.findIndex(s => !s);
    if (slot < 0) return { error: 'Session is full (5/5).' };
    const prev = this.slots[slot];
    const token = crypto.randomBytes(16).toString('hex');
    const p = prev || this.newPlayer(slot);
    Object.assign(p, { human: true, connected: true, name: String(name || 'Bearer').slice(0, 16), profileId, profile, token, ready: false, droppedAt: 0 });
    if (!prev) {
      const free = AVATAR_IDS.find(a => !this.players().some(q => q.avatar === a));
      p.avatar = free; this.applyAvatar(p, true);
    }
    this.slots[slot] = p;
    if (this.hostSlot < 0 || !this.slots[this.hostSlot]?.human) this.hostSlot = slot;
    this.lobbyChanged();
    if (this.phase === 'game') this.event('chat', { from: 'SYSTEM', text: `${p.name} joined and took over ${AVATARS[p.avatar].name}.` });
    return { slot, token };
  }

  reconnect(token) {
    const p = this.players().find(q => q.human && q.token === token);
    if (!p) return null;
    p.connected = true; p.droppedAt = 0;
    this.event('chat', { from: 'SYSTEM', text: `${p.name} reconnected.` });
    this.lobbyChanged();
    return p.slot;
  }

  disconnect(slot) {
    const p = this.slots[slot];
    if (!p || !p.human) return;
    p.connected = false; p.droppedAt = this.t; p.input = blankInput(); p.holding = null;
    if (this.phase === 'lobby') { this.slots[slot] = null; }
    else this.event('chat', { from: 'SYSTEM', text: `${p.name} lost connection — an AI companion is covering.` });
    this.migrateHost();
    this.lobbyChanged();
  }

  migrateHost() {
    if (this.slots[this.hostSlot]?.human && this.slots[this.hostSlot].connected) return;
    const next = this.slots.findIndex(s => s && s.human && s.connected);
    this.hostSlot = next;
    if (next >= 0) this.event('chat', { from: 'SYSTEM', text: `${this.slots[next].name} is now the host.` });
  }

  newPlayer(slot) {
    return {
      slot, human: false, connected: false, name: 'Companion', avatar: null, outfit: 'expedition', build: 'm', ready: true,
      x: 0, y: 0, z: 0, vy: 0, onGround: true, yaw: 0, hp: 100, maxHp: 100, lives: START_LIVES, state: 'alive',
      stamina: 100, staminaT: 0, cd: { atk: 0, q: 0, e: 0, dodge: 0 }, ammo: 0, herbs: 1,
      fx: { bulwark: 0, veil: 0, smoke: 0, invuln: 0, dodge: 0, recover: 0, noisy: 0 }, dodgeDir: null,
      input: blankInput(), lastSeq: -1, lastActSeq: -1, holding: null, downT: 0, respawnAt: 0,
      stats: { dmg: 0, kills: 0, deaths: 0, revives: 0, heals: 0 }, msgBudget: 60, carrying: false, cachesUsed: new Set(),
      chatT: 0, pingT: 0, aiMem: {},
    };
  }

  applyAvatar(p, full) {
    const A = AVATARS[p.avatar];
    const frac = full ? 1 : p.hp / p.maxHp;
    p.maxHp = A.hp; p.hp = Math.max(1, Math.round(A.hp * frac));
    p.ammo = A.attack.ammo ?? 0;
    p.herbs = Math.min(p.herbs, this.herbCap(p));
  }
  herbCap(p) { return p.avatar === 'oracle' ? 2 : 3; }

  setAvatar(slot, avatar, outfit, build) {
    const p = this.slots[slot];
    if (!p || !AVATARS[avatar]) return 'Unknown avatar.';
    if (build === 'f' || build === 'm') p.build = build;
    if (outfit && OUTFITS.includes(outfit)) {
      if (outfit === 'relic' && !p.profile?.outfits?.includes('relic')) return 'The Relic outfit unlocks when you finish the campaign.';
      p.outfit = outfit;
    }
    if (p.avatar === avatar) { this.lobbyChanged(); return null; }
    const holder = this.players().find(q => q.avatar === avatar);
    if (this.phase === 'game') {
      const why = this.switchBlocked(p);
      if (why) return why;
      if (holder && holder.human) return `${AVATARS[avatar].name} is taken by ${holder.name}.`;
    } else if (holder && holder.human) return `${AVATARS[avatar].name} is taken by ${holder.name}.`;
    if (holder) { holder.avatar = p.avatar; this.applyAvatar(holder, this.phase === 'lobby'); }
    p.avatar = avatar; this.applyAvatar(p, this.phase === 'lobby');
    if (this.phase === 'game') this.event('chat', { from: 'SYSTEM', text: `${p.name} is now ${AVATARS[avatar].name}.` });
    this.lobbyChanged();
    return null;
  }

  // Avatar switching is only allowed at the current checkpoint and out of combat.
  switchBlocked(p) {
    const cp = this.checkpoint();
    if (p.state !== 'alive') return 'You can only switch avatars while alive.';
    if (Math.hypot(p.x - cp.x, p.z - cp.z) > 9) return 'Switch avatars at the current checkpoint camp.';
    for (const c of this.creatures.values()) if (c.hp > 0 && c.target != null && Math.hypot(c.x - p.x, c.z - p.z) < 30) return 'Not while creatures are hunting you.';
    if (this.boss && this.boss.hp > 0) return 'Not during a boss fight.';
    return null;
  }

  setReady(slot, v) { const p = this.slots[slot]; if (p) { p.ready = !!v; this.lobbyChanged(); } }

  start(slot) {
    if (this.phase !== 'lobby') return 'Already started.';
    if (slot !== this.hostSlot) return 'Only the host can start.';
    if (!this.humans().every(h => h.ready)) return 'Everyone must be ready.';
    for (let i = 0; i < MAX_SLOTS; i++) {
      if (!this.slots[i]) {
        const p = this.newPlayer(i);
        p.avatar = AVATAR_IDS.find(a => !this.players().some(q => q.avatar === a));
        p.name = `${AVATARS[p.avatar].name} (AI)`;
        p.build = i % 2 ? 'f' : 'm';
        this.applyAvatar(p, true);
        this.slots[i] = p;
      }
    }
    this.phase = 'game';
    this.startedAt = this.t;
    this.spawnPersistent();
    this.beginMission(this.missionIdx, { first: true });
    this.io.broadcast({ type: 'started' });
    this.lobbyChanged();
    return null;
  }

  lobbyChanged() { this._lobbyDirty = true; }
  lobbyState() {
    return {
      type: 'lobby', code: this.code, phase: this.phase, host: this.hostSlot, difficulty: this.difficulty,
      mission: this.missionIdx, loaded: this.loaded,
      slots: this.slots.map(p => p && { slot: p.slot, name: p.name, human: p.human, connected: p.connected, avatar: p.avatar, outfit: p.outfit, build: p.build, ready: p.ready }),
    };
  }

  // ---------------------------------------------------------------- input (all validated)
  onInput(slot, m) {
    const p = this.slots[slot];
    if (!p || this.phase !== 'game') return;
    const seq = m.seq | 0;
    if (seq <= p.lastSeq) return;                        // stale or duplicated packet
    p.lastSeq = seq;
    const num = (v, lim) => (Number.isFinite(+v) ? Math.max(-lim, Math.min(lim, +v)) : 0);
    p.input = {
      mx: num(m.mx, 1), mz: num(m.mz, 1), yaw: num(m.yaw, 100), sprint: !!m.sprint, crouch: !!m.crouch, jump: !!m.jump,
    };
  }

  onAction(slot, m) {
    const p = this.slots[slot];
    if (!p || this.phase !== 'game') return;
    const seq = m.seq | 0;
    if (seq <= p.lastActSeq) return;                     // duplicate action request
    p.lastActSeq = seq;
    if (this.cutscene) return;
    this.doAction(p, m.kind, Number.isFinite(+m.aim) ? +m.aim : p.yaw, m);
  }

  doAction(p, kind, aim, m = {}) {
    if (kind === 'interactEnd') { p.holding = null; return; }
    if (kind === 'skip') return;
    if (p.state !== 'alive') { if (kind === 'interact' && p.state === 'out') return; return; }
    const A = AVATARS[p.avatar];
    switch (kind) {
      case 'atk': return this.attack(p, aim);
      case 'q': return this.ability(p, 'q', aim);
      case 'e': return this.ability(p, 'e', aim);
      case 'dodge': {
        if (p.cd.dodge > 0 || p.stamina < 25) return;
        p.stamina -= 25; p.staminaT = 0.6; p.cd.dodge = 0.9; p.fx.dodge = 0.35;
        const mx = p.input.mx, mz = p.input.mz, l = Math.hypot(mx, mz);
        p.dodgeDir = l > 0.1 ? { x: mx / l, z: mz / l, s: 15 } : { x: Math.sin(p.yaw), z: Math.cos(p.yaw), s: 15 };
        this.event('fx', { kind: 'dodge', slot: p.slot });
        return;
      }
      case 'herb': {
        if (p.herbs <= 0 || p.hp >= p.maxHp) return;
        p.herbs--; p.hp = Math.min(p.maxHp, p.hp + 55); p.stats.heals++;
        this.event('fx', { kind: 'heal', slot: p.slot, amount: 55 });
        return;
      }
      case 'interact': return this.interact(p);
      default: return;
    }
    void A;
  }

  attack(p, aim) {
    const A = AVATARS[p.avatar], at = A.attack;
    if (p.cd.atk > 0 || p.fx.recover > 0 || p.carrying) return;
    if (at.kind === 'melee' && at.stamina && p.stamina < at.stamina * (p.avatar === 'titan' ? 1 : 0.3)) return;
    if (at.kind === 'ranged' && p.ammo <= 0) { this.event('fx', { kind: 'empty', slot: p.slot }); return; }
    p.cd.atk = at.cd * (p.human && p.connected ? 1 : 1.35); p.yaw = aim; p.fx.noisy = 1.2;   // companions swing a little slower than players
    if (at.stamina) { p.stamina = Math.max(0, p.stamina - at.stamina); p.staminaT = 0.6; }
    if (p.fx.veil > 0) { p.fx.veil = 0; this.event('fx', { kind: 'unveil', slot: p.slot }); }
    const dirx = Math.sin(aim), dirz = Math.cos(aim);
    const targets = this.hittables();
    if (at.kind === 'ranged') {
      p.ammo--;
      let best = null, bestD = at.range;
      for (const t of targets) {
        const dx = t.x - p.x, dz = t.z - p.z, along = dx * dirx + dz * dirz;
        if (along < 0 || along > bestD) continue;
        const perp = Math.abs(dx * dirz - dz * dirx);
        if (perp < t.r + 0.6) { best = t; bestD = along; }
      }
      this.event('fx', { kind: 'shot', slot: p.slot, x: r2(p.x), z: r2(p.z), tx: r2(p.x + dirx * bestD), tz: r2(p.z + dirz * bestD) });
      if (best) this.hit(best, at.dmg, p);
    } else {
      this.event('fx', { kind: 'swing', slot: p.slot });
      for (const t of targets) {
        const dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz);
        if (d > at.range + t.r) continue;
        let ang = Math.atan2(dx, dz) - aim; ang = Math.atan2(Math.sin(ang), Math.cos(ang));
        if (d > t.r + 0.4 && Math.abs(ang) > at.arc / 2 + Math.atan2(t.r, d)) continue;
        this.hit(t, at.dmg, p);
      }
    }
  }

  // Everything a player can damage, with a common shape.
  hittables() {
    const out = [];
    for (const c of this.creatures.values()) {
      if (c.hp <= 0 || (c.hidden && !(c.revealUntil > this.t))) continue;
      out.push({ kind: 'creature', ref: c, x: c.x, z: c.z, r: c.r });
    }
    if (this.boss && this.boss.hp > 0) this.boss.hitboxes(out);
    for (const o of this.objects.values()) if (o.breakable && !o.broken) out.push({ kind: 'object', ref: o, x: o.x, z: o.z, r: o.r ?? 1.5 });
    return out;
  }

  hit(t, base, p) {
    if (t.kind === 'creature') {
      const dealt = damageCreature(this, t.ref, base, p);
      if (dealt > 0) { p.stats.dmg += dealt; this.event('dmg', { x: r2(t.x), z: r2(t.z), amount: Math.round(dealt), crit: dealt > base * 1.4, by: p.slot }); }
    } else if (t.kind === 'boss') {
      const dealt = this.boss.damage(t, base, p);
      if (dealt > 0) { p.stats.dmg += dealt; this.event('dmg', { x: r2(t.x), z: r2(t.z), amount: Math.round(dealt), crit: dealt > base * 1.4, by: p.slot }); }
      else this.event('dmg', { x: r2(t.x), z: r2(t.z), amount: 0, blocked: true, by: p.slot });
    } else if (t.kind === 'object') {
      const o = t.ref;
      if (o.onHit) o.onHit(this, base, p);
    }
  }

  ability(p, key, aim) {
    const A = AVATARS[p.avatar], ab = A[key];
    if (p.cd[key] > 0 || p.fx.recover > 0) return;
    let used = true;
    const near = (r) => this.alivePlayers().filter(q => Math.hypot(q.x - p.x, q.z - p.z) <= r);
    const nearC = (r) => [...this.creatures.values()].filter(c => c.hp > 0 && Math.hypot(c.x - p.x, c.z - p.z) <= r);
    switch (`${p.avatar}.${key}`) {
      case 'titan.q':
        p.fx.bulwark = ab.dur;
        for (const c of nearC(18)) { c.taunt = { slot: p.slot, until: this.t + ab.dur }; c.target = p.slot; }
        if (this.boss?.taunt) this.boss.taunt(p, ab.dur);
        break;
      case 'titan.e': {
        const o = this.nearestObject(p, 4.5, o => o.heavy && !o.done);
        if (o) { o.onHeave(this, p); break; }
        for (const c of nearC(4.5)) { c.stagger = 1.0; damageCreature(this, c, 8, p); }
        this.event('fx', { kind: 'quake', x: r2(p.x), z: r2(p.z) });
        break;
      }
      case 'wraith.q':
        for (const c of nearC(30)) { c.markedUntil = this.t + ab.dur; c.revealUntil = this.t + ab.dur; }
        this.event('fx', { kind: 'mark', slot: p.slot });
        break;
      case 'wraith.e': {
        const l = Math.hypot(p.input.mx, p.input.mz);
        p.dodgeDir = l > 0.1 ? { x: p.input.mx / l, z: p.input.mz / l, s: 30 } : { x: Math.sin(aim), z: Math.cos(aim), s: 30 };
        p.fx.dodge = 0.3;
        break;
      }
      case 'circuit.q': {
        const id = this.id();
        this.objects.set(id, { id, kind: 'decoy', x: p.x + Math.sin(aim) * 2, z: p.z + Math.cos(aim) * 2, until: this.t + ab.dur, owner: p.slot });
        for (const c of nearC(22)) c.decoy = id;
        break;
      }
      case 'circuit.e':
        for (const c of nearC(25)) c.overloadUntil = this.t + ab.dur;
        if (this.boss && Math.hypot(this.boss.x - p.x, this.boss.z - p.z) < 40) this.boss.overloadUntil = this.t + ab.dur;
        this.event('fx', { kind: 'overload', x: r2(p.x), z: r2(p.z) });
        break;
      case 'oracle.q':
        for (const q of near(10)) { const before = q.hp; q.hp = Math.min(q.maxHp, q.hp + 45); p.stats.heals += q.hp > before ? 1 : 0; }
        this.event('fx', { kind: 'mend', x: r2(p.x), z: r2(p.z) });
        break;
      case 'oracle.e': {
        const seen = new Set();
        for (const c of nearC(60)) { c.revealUntil = this.t + ab.dur; seen.add(c.type); }
        if (this.boss && this.boss.hp > 0) seen.add(this.boss.type);
        for (const type of seen) this.event('hint', { slot: p.slot, text: `${CREATURES[type].name}: ${CREATURES[type].hint}` });
        if (!seen.size) this.event('hint', { slot: p.slot, text: 'No tracks nearby. The jungle is quiet — for now.' });
        break;
      }
      case 'phantom.q': p.fx.veil = ab.dur; for (const c of this.creatures.values()) if (c.target === p.slot) c.target = null; break;
      case 'phantom.e':
        for (const q of near(9)) { q.fx.smoke = ab.dur; for (const c of this.creatures.values()) if (c.target === q.slot) c.target = null; }
        this.event('fx', { kind: 'smoke', x: r2(p.x), z: r2(p.z) });
        break;
      default: used = false;
    }
    if (used) { p.cd[key] = ab.cd; this.event('fx', { kind: 'ability', slot: p.slot, key, name: ab.name }); }
  }

  nearestObject(p, range, filter) {
    let best = null, bd = Infinity;
    for (const o of this.objects.values()) {
      if (!filter(o)) continue;
      const d = Math.hypot(o.x - p.x, o.z - p.z);
      if (d <= (o.useR ?? range) && d < bd) { best = o; bd = d; }
    }
    return best;
  }

  interact(p) {
    // Revive takes priority.
    const down = this.players().find(q => q !== p && q.state === 'downed' && Math.hypot(q.x - p.x, q.z - p.z) < 2.6);
    if (down) { p.holding = { revive: down.slot, prog: 0 }; return; }
    const o = this.nearestObject(p, 3.2, o => o.usable && o.usable(this, p));
    if (!o) return;
    if (o.hold) p.holding = { id: o.id, prog: 0 };
    else o.use(this, p);
  }

  updateHolding(p, dt) {
    const h = p.holding;
    if (!h) return;
    if (p.state !== 'alive') { p.holding = null; return; }
    if (h.revive != null) {
      const q = this.slots[h.revive];
      if (!q || q.state !== 'downed' || Math.hypot(q.x - p.x, q.z - p.z) > 3) { p.holding = null; return; }
      h.prog += dt * (p.avatar === 'oracle' ? 2 : 1);
      if (h.prog >= 3) {
        q.state = 'alive'; q.hp = Math.round(q.maxHp * 0.35); q.fx.invuln = 1.5; p.stats.revives++;
        this.event('fx', { kind: 'revive', slot: q.slot, by: p.slot });
        p.holding = null;
      }
      return;
    }
    const o = this.objects.get(h.id);
    if (!o || !o.usable || !o.usable(this, p) || Math.hypot(o.x - p.x, o.z - p.z) > (o.useR ?? 3.2) + 0.8) { p.holding = null; return; }
    const rate = o.rate ? o.rate(this, p) : 1;
    h.prog += dt * rate;
    if (o.onHoldTick) o.onHoldTick(this, p, dt);
    if (h.prog >= o.hold) { p.holding = null; o.use(this, p); }
  }

  // ---------------------------------------------------------------- damage & lives
  hurtPlayer(p, amount, src = {}) {
    if (p.state !== 'alive' || this.cutscene) return 0;
    if (p.fx.invuln > 0 || p.fx.dodge > 0) { this.event('fx', { kind: 'evade', slot: p.slot }); return 0; }
    let a = amount * this.diff.enemyDmg;
    if (p.fx.bulwark > 0) a *= 0.3;
    if (p.avatar === 'phantom') {
      const crowd = [...this.creatures.values()].filter(c => c.hp > 0 && Math.hypot(c.x - p.x, c.z - p.z) < 6).length;
      if (crowd >= 3) a *= 1.3;
    }
    a = Math.round(a);
    p.hp -= a;
    this.event('hurt', { slot: p.slot, amount: a, from: src.type || '' });
    if (p.hp <= 0) {
      p.hp = 0; p.holding = null;
      if (p.carrying) this.dropCarried(p);
      p.state = 'downed'; p.downT = 10;
      this.event('downed', { slot: p.slot });
    }
    return a;
  }

  kill(p, cause = 'fell') {
    if (p.state === 'dead' || p.state === 'out') return;
    if (p.carrying) this.dropCarried(p);
    p.lives = Math.max(0, p.lives - 1);
    p.stats.deaths++;
    p.hp = 0; p.holding = null;
    if (p.lives > 0) {
      p.state = 'dead'; p.respawnAt = this.t + 4;
      this.event('death', { slot: p.slot, lives: p.lives, cause });
      if (p.human) this.steward('dead');
    } else {
      p.state = 'out';
      this.event('death', { slot: p.slot, lives: 0, cause, out: true });
      this.steward('out');
    }
  }

  dropCarried(p) { p.carrying = false; this.mission?.onDrop?.(this, p); }

  checkpoint() { return this.mstate.checkpoint || CHECKPOINTS[this.missionIdx]; }

  placeAtCheckpoint(p, i) {
    const cp = this.checkpoint();
    const a = (i / MAX_SLOTS) * Math.PI * 2;
    p.x = cp.x + Math.cos(a) * 2.5; p.z = cp.z + Math.sin(a) * 2.5; p.y = 2; p.vy = 0; p.onGround = false;
  }

  respawn(p, lives = null) {
    if (lives != null) p.lives = lives;
    p.state = 'alive'; p.hp = p.maxHp; p.fx.invuln = 2; p.fx.recover = 2; p.stamina = 100;
    this.placeAtCheckpoint(p, p.slot);
    this.event('respawn', { slot: p.slot, lives: p.lives });
  }

  rescueOut() {
    for (const p of this.players()) if (p.state === 'out') { this.respawn(p, 1); this.event('chat', { from: 'SYSTEM', text: `${p.name} was carried to the checkpoint and returns with one mark.` }); }
  }

  checkWipe() {
    const ps = this.players();
    if (!ps.length || !ps.every(p => p.state === 'out')) return;
    this.teamStats.wipes++;
    this.steward('wipe');
    this.event('wipe', {});
    for (const p of ps) { p.herbs = 0; p.carrying = false; this.respawn(p, 1); }
    this.beginMission(this.missionIdx, { retry: true });
  }

  // ---------------------------------------------------------------- persistent world objects
  spawnPersistent() {
    const R = rng(this.seed);
    this.resonanceOrder = [0, 1, 2, 3, 4].sort(() => R() - 0.5);
    // Lost Records.
    POINTS.records.forEach((pt, i) => {
      if (this.flags.records.has(i)) return;
      const id = this.id();
      this.objects.set(id, {
        id, kind: 'record', idx: i, x: pt.x, z: pt.z, y: i === 2 ? 2.4 : 0, persistent: true, label: 'Lost Record',
        usable: (s, p) => i !== 2 || p.y > 2.0,
        use: (s, p) => {
          s.flags.records.add(i); s.objects.delete(id);
          s.event('record', { idx: i, by: p.slot, order: s.resonanceOrder });
          s.event('chat', { from: 'SYSTEM', text: `${p.name} found a Lost Record (${s.flags.records.size}/3).` });
          s.io.persist(s);
        },
      });
    });
    // Supply caches (ammo + one herb per player per cache).
    POINTS.caches.forEach((pt, i) => {
      const id = this.id();
      this.objects.set(id, {
        id, kind: 'cache', x: pt.x, z: pt.z, persistent: true, label: 'Supply cache',
        usable: () => true,
        use: (s, p) => {
          const A = AVATARS[p.avatar];
          if (A.attack.ammo) p.ammo = A.attack.ammo;
          if (!p.cachesUsed.has(i) && p.herbs < s.herbCap(p)) { p.herbs++; p.cachesUsed.add(i); }
          s.event('fx', { kind: 'resupply', slot: p.slot });
        },
      });
    });
    // Scattered herbs.
    const herbSpots = [[6, 30], [-20, 60], [30, 75], [-5, 120], [20, 145], [-8, 210], [12, 230], [-20, 300], [20, 320], [-30, 380], [30, 420]];
    for (const [x, z] of herbSpots) this.spawnHerb(x, z, true);
  }

  spawnHerb(x, z, persistent = false) {
    const id = this.id();
    this.objects.set(id, {
      id, kind: 'herb', x, z, persistent, label: 'Healing herb',
      usable: (s, p) => p.herbs < s.herbCap(p),
      use: (s, p) => { p.herbs++; s.objects.delete(id); s.event('fx', { kind: 'pickup', slot: p.slot, what: 'herb' }); },
    });
  }

  // ---------------------------------------------------------------- missions & cutscenes
  beginMission(idx, { first = false, retry = false } = {}) {
    // Clear mission-scoped entities.
    for (const [id, o] of this.objects) if (!o.persistent) this.objects.delete(id);
    this.creatures.clear();
    this.boss = null; this.aiTasks = [];
    this.missionIdx = idx;
    this.mstate = {};
    const M = MISSIONS[idx];
    this.mission = M;
    this.objectives = M.objectives.map(o => ({ ...o, done: false, progress: o.max ? 0 : undefined }));
    if (first || retry) for (const p of this.players()) { if (p.state !== 'out') this.placeAtCheckpoint(p, p.slot); }
    M.setup(this, { first, retry });
    this.event('mission', { idx, retry });
    this.io.persist(this);
  }

  objective(id) { return this.objectives.find(o => o.id === id); }
  // Objectives complete only when their prerequisites are done (TEST E).
  complete(id) {
    const o = this.objective(id);
    if (!o || o.done) return false;
    if (o.after && !o.after.every(a => this.objective(a)?.done)) return false;
    o.done = true;
    this.event('objective', { id, text: o.text });
    return true;
  }
  setProgress(id, v) { const o = this.objective(id); if (o && !o.done) o.progress = v; }

  advance() {
    this.rescueOut();
    this.grantMissionReward(this.missionIdx);
    if (this.missionIdx + 1 >= MISSIONS.length) return;
    this.beginMission(this.missionIdx + 1);
  }

  grantMissionReward(idx) {
    // Rewards are granted server-side once per profile per mission (no duplicates, no client claims).
    for (const p of this.humans()) {
      const prof = p.profile; if (!prof) continue;
      prof.completed ||= [];
      const key = `m${idx}`;
      if (prof.completed.includes(key)) continue;
      prof.completed.push(key);
      prof.xp = (prof.xp || 0) + 100;
      this.io.send(p.slot, { type: 'reward', text: `Mission ${idx} complete — +100 expedition XP.`, xp: prof.xp });
    }
    this.io.persistProfiles?.();
  }

  playCutscene(id, after) {
    const C = CUTSCENES[id];
    const seenByAll = this.connectedHumans().every(h => h.profile?.seen?.includes(id));
    this.cutscene = { id, until: this.t + C.dur, votes: new Set(), skippable: seenByAll, after };
    for (const h of this.humans()) { if (h.profile) { h.profile.seen ||= []; if (!h.profile.seen.includes(id)) h.profile.seen.push(id); } }
    this.event('cutscene', { id, skippable: seenByAll });
    for (const p of this.players()) p.holding = null;
  }

  voteSkip(slot) {
    if (!this.cutscene || !this.cutscene.skippable) return;
    this.cutscene.votes.add(slot);
    if (this.connectedHumans().every(h => this.cutscene.votes.has(h.slot))) this.endCutscene();
    else this.event('skipvote', { n: this.cutscene.votes.size, of: this.connectedHumans().length });
  }

  endCutscene() {
    const c = this.cutscene; this.cutscene = null;
    this.event('cutsceneEnd', { id: c.id });
    if (c.after) c.after(this);
  }

  finish(choice) {
    this.phase = 'ended';
    this.flags.choice = choice;
    const time = Math.round(this.t - this.startedAt);
    for (const p of this.humans()) {
      const prof = p.profile; if (!prof) continue;
      prof.endings ||= []; if (!prof.endings.includes(choice)) prof.endings.push(choice);
      prof.outfits ||= []; if (!prof.outfits.includes('relic')) prof.outfits.push('relic');
    }
    this.grantMissionReward(this.missionIdx);
    this.ending = {
      choice, time, records: this.flags.records.size, wipes: this.teamStats.wipes,
      players: this.players().map(p => ({ slot: p.slot, name: p.name, avatar: p.avatar, human: p.human, lives: p.lives, ...p.stats, dmg: Math.round(p.stats.dmg) })),
    };
    this.io.broadcast({ type: 'ending', ...this.ending });
    this.io.persist(this);
    this.io.persistProfiles?.();
  }

  // ---------------------------------------------------------------- simulation
  tick() {
    const dt = DT;
    this.t += dt; this.tickN++;
    if (this.phase !== 'game') { this.flush(); return; }
    // Release slots of humans who never came back (keep AI driving).
    for (const p of this.humans()) if (!p.connected && this.t - p.droppedAt > RECONNECT_GRACE) { p.human = false; p.name = `${AVATARS[p.avatar].name} (AI)`; p.token = null; this.migrateHost(); this.lobbyChanged(); }
    if (this.cutscene) {
      if (this.t >= this.cutscene.until) this.endCutscene();
      this.flush(); return;
    }
    for (const p of this.players()) this.updatePlayer(p, dt);
    for (const c of [...this.creatures.values()]) updateCreature(this, c, dt);
    if (this.boss) this.boss.update(this, dt);
    for (const [id, o] of this.objects) {
      if (o.until && this.t > o.until) { this.objects.delete(id); continue; }
      if (o.tick) o.tick(this, dt);
    }
    this.mission?.update(this, dt);
    this.checkWipe();
    this.flush();
  }

  updatePlayer(p, dt) {
    for (const k in p.cd) p.cd[k] = Math.max(0, p.cd[k] - dt);
    for (const k in p.fx) p.fx[k] = Math.max(0, p.fx[k] - dt);
    if (p.state === 'dead') { if (this.t >= p.respawnAt) this.respawn(p); return; }
    if (p.state === 'out') return;
    if (p.state === 'downed') {
      p.downT -= dt;
      if (p.downT <= 0) this.kill(p, 'bled out');
      return;
    }
    const inp = (p.human && p.connected) ? p.input : aiInput(this, p, dt);
    if (!(p.human && p.connected)) p.input = inp;
    const A = AVATARS[p.avatar];
    // Stamina.
    const moving = Math.hypot(inp.mx, inp.mz) > 0.1;
    let sprint = inp.sprint && moving && p.stamina > 1 && !inp.crouch && !p.carrying;
    if (sprint) { p.stamina = Math.max(0, p.stamina - 18 * dt); p.staminaT = 0.6; }
    else if ((p.staminaT -= dt) <= 0) p.stamina = Math.min(100, p.stamina + 24 * dt);
    let speed = A.speed * (sprint ? 1.5 : 1) * (inp.crouch ? 0.5 : 1);
    if (p.carrying && p.avatar !== 'titan') speed *= 0.6;
    if (p.holding) speed = 0;
    p.yaw = inp.yaw;
    if (p.fx.dodge > 0 && p.dodgeDir) stepMove(p, { mx: p.dodgeDir.x, mz: p.dodgeDir.z }, p.dodgeDir.s, dt, this.dyn, A.radius);
    else stepMove(p, inp, speed, dt, this.dyn, A.radius);
    p.noise = A.noise * (sprint ? 1.6 : inp.crouch ? 0.4 : 1) * (p.fx.noisy > 0 ? 1.8 : 1);
    p.crouch = inp.crouch; p.sprinting = sprint;
    if (p.y < -12) { this.kill(p, 'fell into the ravine'); return; }
    this.updateHolding(p, dt);
  }

  // Snapshot for clients. Everything is rounded to keep packets small.
  snapshot() {
    return {
      type: 'snap', t: r2(this.t), m: this.missionIdx,
      dyn: { open: [...this.dyn.open], bridge: this.dyn.bridge, log: this.dyn.log, bridgeP: r2(this.mstate.bridgeP || 0) },
      p: this.players().map(p => ({
        s: p.slot, n: p.name, a: p.avatar, o: p.outfit, g: p.build, h: p.human, c: p.connected,
        x: r2(p.x), y: r2(p.y), z: r2(p.z), yaw: r2(p.yaw), hp: Math.round(p.hp), mhp: p.maxHp, l: p.lives, st: p.state,
        sta: Math.round(p.stamina), ammo: p.ammo, herbs: p.herbs, cr: p.crouch ? 1 : 0, sp: p.sprinting ? 1 : 0,
        cd: { a: r2(p.cd.atk), q: r2(p.cd.q), e: r2(p.cd.e), d: r2(p.cd.dodge) },
        fx: Object.fromEntries(Object.entries(p.fx).filter(([, v]) => v > 0).map(([k, v]) => [k, r2(v)])),
        hold: p.holding ? r2(p.holding.prog) : null, down: p.state === 'downed' ? r2(p.downT) : null,
        resp: p.state === 'dead' ? r2(p.respawnAt - this.t) : null, carry: p.carrying ? 1 : 0, seq: p.lastSeq,
      })),
      c: [...this.creatures.values()].map(c => ({
        i: c.id, k: c.type, x: r2(c.x), y: r2(c.y || 0), z: r2(c.z), yaw: r2(c.yaw), hp: Math.round(c.hp), mhp: c.maxHp,
        st: c.state, hid: c.hidden && !(c.revealUntil > this.t) ? 1 : 0, mk: c.markedUntil > this.t ? 1 : 0,
        ov: c.overloadUntil > this.t ? 1 : 0, tg: c.target, tel: c.tel || null,
      })),
      o: [...this.objects.values()].map(o => ({
        i: o.id, k: o.kind, x: r2(o.x), z: r2(o.z), y: o.y || 0, ...(o.view ? o.view(this) : {}), lb: o.label,
      })),
      b: this.boss ? this.boss.view(this) : null,
      obj: this.objectives.map(o => ({ id: o.id, text: o.text, done: o.done, pr: o.progress, max: o.max, after: o.after })),
      wp: this.mission?.waypoint ? this.mission.waypoint(this) : null,
      cut: this.cutscene ? { id: this.cutscene.id, left: r2(this.cutscene.until - this.t) } : null,
      rec: this.flags.records.size,
    };
  }

  flush() {
    if (this._lobbyDirty) { this._lobbyDirty = false; this.io.broadcast(this.lobbyState()); }
    if (this.phase === 'lobby') { this.events = []; return; }
    const snap = this.snapshot();
    snap.ev = this.events; this.events = [];
    this.io.broadcast(snap);
  }
}

export function blankInput() { return { mx: 0, mz: 0, yaw: 0, sprint: false, crouch: false, jump: false }; }
