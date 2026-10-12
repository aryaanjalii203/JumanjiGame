// Mission graph. Each mission: setup → per-tick update → objectives with prerequisites (`after`).
import { POINTS, CHECKPOINTS, ARENA, HEART } from '../shared/world.js';
import { TERMINALS } from '../shared/story.js';
import { spawnCreature } from './creatures.js';
import { Colossus, Curator } from './bosses.js';

const near = (s, pt, r) => s.alivePlayers().some(p => Math.hypot(p.x - pt.x, p.z - pt.z) < r);
const firstOpen = s => s.objectives.find(o => !o.done && (!o.after || o.after.every(a => s.objective(a)?.done)));

function add(s, props) {
  const id = s.id();
  const o = props; o.id = id;          // keep the object itself: spreading would freeze getters (e.g. a winch's hold time)
  s.objects.set(id, o);
  return o;
}

// A checkpoint camp: fire (avatar switching zone) + Life Shrine (donate a life to an eliminated teammate).
function addCamp(s, pt) {
  s.mstate.checkpoint = pt;
  add(s, { kind: 'campfire', x: pt.x, z: pt.z, label: 'Camp — switch avatars here' });
  add(s, {
    kind: 'shrine', x: pt.x + 4.5, z: pt.z, label: 'Life Shrine', hold: 2,
    usable: (s, p) => p.lives >= 2 && s.players().some(q => q.state === 'out'),
    use: (s, p) => {
      const q = s.players().find(q => q.state === 'out');
      if (!q || p.lives < 2) return;
      p.lives--; s.respawn(q, 1);
      s.event('donate', { from: p.slot, to: q.slot });
      s.steward('donate');
    },
  });
}

// Pressure plate: occupied by any living player standing on it. Optional latch keeps it down briefly (difficulty aid).
function addPlate(s, pt, extra = {}) {
  return add(s, {
    kind: 'plate', x: pt.x, z: pt.z, on: false, latch: 0, ...extra,
    view: function () { return { on: this.on ? 1 : 0 }; },
    tick: function (s, dt) {
      const stand = s.alivePlayers().some(p => Math.hypot(p.x - this.x, p.z - this.z) < 1.8 && p.y < 3);
      const L = s.diff.hints >= 2 ? 3 : 0;
      if (stand) this.latch = L; else this.latch = Math.max(0, this.latch - dt);
      this.on = stand || this.latch > 0;
    },
  });
}

function wpOf(s, map) {
  const o = firstOpen(s);
  return o && map[o.id] ? { ...map[o.id](s), label: o.text } : null;
}

export const MISSIONS = [];

// -------------------------------------------------------------------- 1. Lost in the Wilds
MISSIONS[1] = {
  objectives: [
    { id: 'shelter', text: 'Find shelter from the storm' },
    { id: 'map', text: 'Recover the torn map fragment', after: ['shelter'] },
    { id: 'pack', text: 'Survive the Razorback pack', after: ['map'], max: 4 },
    { id: 'camp', text: 'Reach the abandoned expedition camp', after: ['pack'] },
  ],
  setup(s, { first }) {
    s.mstate.checkpoint = CHECKPOINTS[1];
    add(s, { kind: 'marker', x: POINTS.shelter.x, z: POINTS.shelter.z, label: 'Shelter' });
    add(s, {
      kind: 'fragment', x: POINTS.mapFragment.x, z: POINTS.mapFragment.z, label: 'Map fragment',
      usable: s => s.objective('shelter').done,
      use: (s, p) => {
        for (const [id, o] of s.objects) if (o.kind === 'fragment') s.objects.delete(id);
        s.complete('map'); s.steward('map'); s.event('tutorial', { key: 'heal' });
        s.mstate.packAwake = true;
        for (const c of s.creatures.values()) if (c.pack === 1 && c.state === 'patrol') { c.state = 'alert'; c.timer = 1; c.target = p.slot; }
      },
    });
    add(s, { kind: 'camp', x: POINTS.camp.x, z: POINTS.camp.z, label: 'Abandoned camp' });
    for (let i = 0; i < 4; i++) spawnCreature(s, 'razorback', 18 + (i % 2) * 4, 96 + Math.floor(i / 2) * 4, { pack: 1 });
    spawnCreature(s, 'razorback', -22, 124, { pack: 2 });
    spawnCreature(s, 'razorback', -18, 128, { pack: 2 });
    if (first) s.playCutscene('transport', s2 => s2.playCutscene('reveal', s3 => s3.event('tutorial', { key: 'move' })));
    else s.event('tutorial', { key: 'move' });
  },
  update(s) {
    if (near(s, POINTS.shelter, 6) && s.complete('shelter')) { s.steward('shelter'); s.event('tutorial', { key: 'attack' }); }
    const pack = [...s.creatures.values()].filter(c => c.pack === 1);
    const beaten = 4 - pack.filter(c => c.hp > 0 && !c.fled).length;
    s.setProgress('pack', beaten);
    if (beaten >= 4 && s.complete('pack')) { s.steward('pack'); s.event('tutorial', { key: 'team' }); }
    if (!s.mstate.campDone && s.objective('pack').done && near(s, POINTS.camp, 8)) {
      s.mstate.campDone = true;
      s.complete('camp');
      s.playCutscene('camp', s2 => s2.advance());
    }
  },
  waypoint: s => wpOf(s, { shelter: () => POINTS.shelter, map: () => POINTS.mapFragment, pack: () => ({ x: 20, z: 98 }), camp: () => POINTS.camp }),
};

// -------------------------------------------------------------------- 2. The Broken Bridge
MISSIONS[2] = {
  objectives: [
    { id: 'cross', text: 'Lower the bridge (crank BOTH winches together) — or have TITAN heave the fallen log' },
    { id: 'far', text: 'Cross the ravine', after: ['cross'] },
  ],
  setup(s) {
    addCamp(s, CHECKPOINTS[2]);
    s.mstate.bridgeP = 0;
    const winch = (pt, broken) => add(s, {
      kind: 'winch', x: pt.x, z: pt.z, broken, useR: 2.6,
      get label() { return this.broken ? 'Broken winch — hold F to repair' : 'Winch — hold F (both at once)'; },
      get hold() { return this.broken ? 4 : 1e9; },
      rate: (s, p) => (p.avatar === 'circuit' ? 2 : 1),
      usable: s => !s.dyn.bridge,
      use: function (s) { if (this.broken) { this.broken = false; s.event('fx', { kind: 'repair', x: this.x, z: this.z }); s.say('STEWARD', 'Gears that grind can turn again.'); } },
      view: function (s) { return { broken: this.broken ? 1 : 0, busy: s.players().some(p => p.holding?.id === this.id) ? 1 : 0 }; },
    });
    s.mstate.wl = winch(POINTS.winchL, false);
    s.mstate.wr = winch(POINTS.winchR, true);
    add(s, {
      kind: 'log', x: POINTS.log.x, z: POINTS.log.z, heavy: true, label: 'Fallen log — TITAN can heave (E)',
      done: s.dyn.log,
      onHeave: function (s) { this.done = true; s.dyn.log = true; s.steward('logUp'); s.event('fx', { kind: 'heave', x: this.x, z: this.z }); },
      view: function () { return { done: this.done ? 1 : 0 }; },
    });
    for (const [x, z] of [[-14, 118], [13, 128], [-12, 146], [15, 150]]) spawnCreature(s, 'stalker', x, z);
    for (const [x, z] of [[-16, 200], [14, 214]]) spawnCreature(s, 'stalker', x, z);
    if (s.dyn.bridge || s.dyn.log) s.complete('cross');
  },
  update(s, dt) {
    const { wl, wr } = s.mstate;
    if (!s.dyn.bridge) {
      const held = o => !o.broken && s.players().some(p => p.holding?.id === o.id);
      if (held(wl) && held(wr)) {
        s.mstate.bridgeP += dt;
        if (!s.mstate.ambush) {
          s.mstate.ambush = true;
          s.say('STEWARD', 'The wheels are loud — the jungle hears.');
          for (const x of [-24, -20, 22, 26]) spawnCreature(s, 'razorback', x, 148, { aggro: true });
        }
        if (s.mstate.bridgeP >= 6) {
          s.dyn.bridge = true;
          for (const p of s.players()) if (p.holding && (p.holding.id === wl.id || p.holding.id === wr.id)) p.holding = null;
          s.steward('bridgeUp'); s.event('fx', { kind: 'bridge' });
        }
      }
    }
    if ((s.dyn.bridge || s.dyn.log)) s.complete('cross');
    if (s.objective('cross').done && s.alivePlayers().some(p => p.z > 194 && p.y > -1)) { s.complete('far'); s.advance(); return; }
    s.aiTasks = s.objective('cross').done ? [] : [{ kind: 'hold', id: wl.id, x: wl.x, z: wl.z }, { kind: 'hold', id: wr.id, x: wr.x, z: wr.z }];
  },
  waypoint: s => wpOf(s, { cross: () => ({ x: 0, z: 158 }), far: () => POINTS.far }),
};

// -------------------------------------------------------------------- 3. The Forgotten Temple
MISSIONS[3] = {
  objectives: [
    { id: 'plates', text: 'Hold all three pressure plates at the same time' },
    { id: 'glyphs', text: 'Turn the glyph pillars to match the mural', after: ['plates'] },
    { id: 'key', text: 'Take the Heart Key', after: ['glyphs'] },
    { id: 'exit', text: 'Leave the temple toward the hollow', after: ['key'] },
  ],
  setup(s, { first, retry }) {
    addCamp(s, CHECKPOINTS[3]);
    s.dyn.open.delete('gateA'); s.dyn.open.delete('gateB');
    s.mstate.plates = POINTS.plates.map(pt => addPlate(s, pt));
    const target = [0, 1, 2, 3].map(() => Math.floor(Math.random() * 6));
    s.mstate.target = target;
    add(s, { kind: 'mural', x: POINTS.mural.x, z: POINTS.mural.z, label: 'Mural', view: () => ({ glyphs: target }) });
    s.mstate.pillars = POINTS.pillars.map((pt, i) => add(s, {
      kind: 'pillar', x: pt.x, z: pt.z - 1.6, idx: i, glyph: (target[i] + 1 + Math.floor(Math.random() * 5)) % 6, lock: 0, useR: 3.4,
      label: 'Glyph pillar — F to turn',
      usable: function (s) { return s.objective('plates').done && !s.objective('glyphs').done && s.t >= this.lock; },
      use: function (s) {   // per-object lock serializes simultaneous turns (TEST F)
        this.lock = s.t + 0.35; this.glyph = (this.glyph + 1) % 6;
        s.event('fx', { kind: 'turn', x: this.x, z: this.z });
      },
      view: function (s) { return { g: this.glyph, ok: s.diff.hints >= 1 && this.glyph === target[i] ? 1 : 0 }; },
    }));
    add(s, {
      kind: 'key', x: POINTS.heartKey.x, z: POINTS.heartKey.z, label: 'Heart Key',
      usable: s => s.objective('glyphs').done,
      use: (s) => {
        for (const [id, o] of s.objects) if (o.kind === 'key') s.objects.delete(id);
        s.complete('key'); s.steward('key');
        for (const c of s.creatures.values()) if (c.type === 'guardian' && c.hp > 0 && c.state !== 'dead') { c.state = 'chase'; c.target = s.alivePlayers()[0]?.slot ?? null; }
      },
    });
    if (!s.dyn.open.has('cracked') && ![...s.objects.values()].some(o => o.kind === 'cracked')) add(s, {
      kind: 'cracked', x: POINTS.cracked.x, z: POINTS.cracked.z, r: 2.2, heavy: true, breakable: true, hp: 240, persistent: true,
      label: 'Cracked wall',
      onHeave: function (s) { this.break(s); },
      onHit: function (s, dmg) { this.hp -= dmg; if (this.hp <= 0) this.break(s); else s.event('dmg', { x: this.x, z: this.z, amount: dmg }); },
      break: function (s) { this.broken = true; this.done = true; s.dyn.open.add('cracked'); s.objects.delete(this.id); s.event('fx', { kind: 'crumble', x: this.x, z: this.z }); },
    });
    for (const [x, z] of [[-14, 232], [10, 240], [18, 236]]) spawnCreature(s, 'razorback', x, z);
    for (const [x, z] of [[-24, 300], [24, 286], [0, 322]]) spawnCreature(s, 'guardian', x, z);
    if (!retry) s.playCutscene('temple');
  },
  update(s) {
    const { plates, pillars, target } = s.mstate;
    if (!s.objective('plates').done && plates.every(p => p.on)) {
      s.complete('plates'); s.dyn.open.add('gateA'); s.steward('gateA'); s.event('fx', { kind: 'gate', id: 'gateA' });
    }
    if (s.objective('plates').done && !s.objective('glyphs').done && pillars.every((p, i) => p.glyph === target[i])) {
      s.complete('glyphs'); s.dyn.open.add('gateB'); s.steward('gateB'); s.event('fx', { kind: 'gate', id: 'gateB' });
    }
    if (s.objective('key').done && s.alivePlayers().some(p => p.z > 342)) { s.complete('exit'); s.advance(); return; }
    s.aiTasks = s.objective('plates').done ? [] : plates.map(p => ({ kind: 'stand', id: p.id, x: p.x, z: p.z }));
  },
  waypoint: s => wpOf(s, { plates: () => ({ x: 0, z: 258 }), glyphs: () => ({ x: 0, z: 295 }), key: () => POINTS.heartKey, exit: () => POINTS.templeExit }),
};

// -------------------------------------------------------------------- 4. The Hollow Colossus
MISSIONS[4] = {
  objectives: [
    { id: 'plates', text: 'Break the Colossus leg plates', max: 4 },
    { id: 'kneel', text: 'Hold BOTH chain anchors at once to drag it to its knees', after: ['plates'] },
    { id: 'core', text: 'Destroy the exposed core', after: ['kneel'] },
    { id: 'portal', text: 'Step into the exit portal', after: ['core'] },
  ],
  setup(s) {
    addCamp(s, CHECKPOINTS[4]);
    s.dyn.open.add('gateA'); s.dyn.open.add('gateB');
    s.mstate.anchors = POINTS.anchors.map(pt => addPlate(s, pt, { kind: 'anchor', label: 'Chain anchor' }));
  },
  update(s) {
    if (!s.boss && !s.mstate.intro && near(s, ARENA, 30)) {
      s.mstate.intro = true;
      s.playCutscene('colossus', s2 => { s2.boss = new Colossus(s2); });
    }
    const b = s.boss;
    if (!b) return;
    s.setProgress('plates', b.plates.filter(p => p.hp <= 0).length);
    if (b.plates.every(p => p.hp <= 0)) s.complete('plates');
    if (b.knelt > 0) s.complete('kneel');
    if (b.hp <= 0 && !s.mstate.dead) {
      s.mstate.dead = true;
      s.complete('core');
      s.event('boss', { type: 'colossus', state: 'dead' });
      s.say('STEWARD', 'The hollow falls. The way is open. The way is—');
      add(s, {
        kind: 'portal', x: POINTS.portal.x, z: POINTS.portal.z, label: 'Exit portal',
        tick: function (s) {
          if (!s.mstate.entered && near(s, this, 2.6)) {
            s.mstate.entered = true; s.complete('portal');
            s.playCutscene('falseexit', s2 => { s2.boss = null; s2.advance(); });
          }
        },
      });
    }
    s.aiTasks = (b.phase >= 2 && !b.knelt && b.hp > 0) ? s.mstate.anchors.map(a => ({ kind: 'stand', id: a.id, x: a.x, z: a.z })) : [];
  },
  waypoint: s => wpOf(s, {
    plates: () => ({ x: ARENA.x, z: ARENA.z }), kneel: () => POINTS.anchors[0], core: () => (s.boss ? { x: s.boss.x, z: s.boss.z } : ARENA), portal: () => POINTS.portal,
  }),
};

// -------------------------------------------------------------------- 5. The False Exit / World Beneath the World
MISSIONS[5] = {
  objectives: [
    { id: 'terminals', text: 'Wake the station terminals', max: 3 },
    { id: 'enter', text: 'Enter the Heart of the Relic', after: ['terminals'] },
  ],
  setup(s) {
    addCamp(s, CHECKPOINTS[5]);
    s.dyn.open.delete('heartDoor');
    for (const p of s.players()) if (p.state !== 'out') s.placeAtCheckpoint(p, p.slot);
    s.mstate.read = 0;
    POINTS.terminals.forEach((pt, i) => add(s, {
      kind: 'terminal', x: pt.x, z: pt.z, hold: 2, idx: i, read: false, label: 'Station terminal — hold F',
      usable: function () { return !this.read; },
      use: function (s) {
        this.read = true; s.mstate.read++;
        s.event('log', { title: TERMINALS[i].title, text: TERMINALS[i].text });
        if (s.mstate.read === 2) { s.say('CURATOR', 'Stop reading. STOP.'); for (const x of [-6, 0, 6]) spawnCreature(s, 'razorback', x, 476, { aggro: true }); spawnCreature(s, 'guardian', 0, 458, { aggro: true }); }
      },
      view: function () { return { read: this.read ? 1 : 0 }; },
    }));
    s.steward('terminals');
  },
  update(s) {
    s.setProgress('terminals', s.mstate.read);
    if (s.mstate.read >= 3 && s.complete('terminals')) { s.dyn.open.add('heartDoor'); s.steward('doorOpen'); s.event('fx', { kind: 'gate', id: 'heartDoor' }); }
    if (s.objective('terminals').done && s.alivePlayers().some(p => p.z > 483)) { s.complete('enter'); s.advance(); return; }
  },
  waypoint: s => wpOf(s, { terminals: () => POINTS.terminals.find((_, i) => ![...s.objects.values()].some(o => o.kind === 'terminal' && o.idx === i && o.read)) || POINTS.terminals[2], enter: () => ({ x: 0, z: 486 }) }),
};

// -------------------------------------------------------------------- 6. The Last Choice
MISSIONS[6] = {
  objectives: [
    { id: 'curator', text: "Break the Curator's hold (his shield falls when his creatures do)" },
    { id: 'choose', text: "Choose the Relic's fate at an altar", after: ['curator'] },
  ],
  setup(s, { retry }) {
    addCamp(s, CHECKPOINTS[6]);
    s.dyn.open.add('heartDoor');
    for (const p of s.players()) if (p.state !== 'out') s.placeAtCheckpoint(p, p.slot);
    const go = s2 => { s2.boss = new Curator(s2); };
    if (retry) go(s); else s.playCutscene('curator', go);
  },
  update(s, dt) {
    const b = s.boss;
    if (b && b.hp <= 0 && !s.mstate.curatorDown) {
      s.mstate.curatorDown = true;
      s.complete('curator');
      for (const c of s.creatures.values()) if (c.wave) { c.hp = 0; c.state = 'dead'; c.deadT = 1; }
      s.event('boss', { type: 'curator', state: 'dead' });
      s.playCutscene('choice', s2 => { s2.boss = null; spawnAltars(s2); });
    }
    const path = s.mstate.path;
    if (!path) { s.aiTasks = []; return; }
    // Harassment waves during every path keep the choice a fight, not a menu.
    s.mstate.waveT = (s.mstate.waveT ?? 6) - dt;
    const living = [...s.creatures.values()].filter(c => c.hp > 0 && c.state !== 'dead').length;
    if (s.mstate.waveT <= 0 && living < 5) {
      s.mstate.waveT = path === 'separate' ? 16 : 13;
      s.mstate.waveN = (s.mstate.waveN || 0) + 1;
      const n = s.mstate.waveN % 3 === 0 ? 3 : 2;
      for (let i = 0; i < n; i++) { const a = Math.random() * 6.28; spawnCreature(s, i === 2 ? 'guardian' : 'razorback', HEART.x + Math.cos(a) * 24, HEART.z + Math.sin(a) * 24, { aggro: true, leash: { x: HEART.x, z: HEART.z, r: 32 } }); }
    }
    PATHS[path].update(s, dt);
  },
  onDrop(s, p) { if (s.mstate.path === 'restore') PATHS.restore.drop(s, p); },
  waypoint: s => {
    const o = firstOpen(s);
    if (!o) return null;
    if (o.id === 'curator') return s.boss ? { x: s.boss.x, z: s.boss.z, label: o.text } : null;
    if (o.id === 'choose') return { x: 0, z: 490, label: o.text };
    return PATHS[s.mstate.path]?.waypoint(s, o);
  },
};

function spawnAltars(s) {
  for (const a of POINTS.altars) add(s, {
    kind: 'altar', choice: a.id, x: a.x, z: a.z, hold: 2,
    label: { restore: 'Altar of Restoring — hold F', destroy: 'Altar of Breaking — hold F', separate: 'Altar of Parting — needs all 3 Lost Records' }[a.id],
    usable: (s) => !s.mstate.path && (a.id !== 'separate' || s.flags.records.size === 3),
    use: (s, p) => {
      if (s.mstate.path) return;
      s.mstate.path = a.id; s.complete('choose');
      for (const [id, o] of s.objects) if (o.kind === 'altar') s.objects.delete(id);
      s.event('choice', { choice: a.id, by: p.slot });
      PATHS[a.id].setup(s);
    },
    view: (s) => ({ choice: a.id, locked: a.id === 'separate' && s.flags.records.size < 3 ? 1 : 0 }),
  });
}

const PATHS = {
  restore: {
    setup(s) {
      s.objectives.push({ id: 'carry', text: 'Carry the Relic to the Cradle (carrier cannot attack)', done: false });
      s.objectives.push({ id: 'channel', text: 'Defend the Cradle while it binds', done: false, after: ['carry'], max: 45, progress: 0 });
      s.mstate.channel = 0;
      s.mstate.relic = add(s, {
        kind: 'relic', x: POINTS.relic.x, z: POINTS.relic.z, label: 'The Relic — F to carry', carrier: null,
        usable: function () { return this.carrier == null; },
        use: function (s, p) { this.carrier = p.slot; p.carrying = true; s.event('fx', { kind: 'pickup', slot: p.slot, what: 'relic' }); },
        tick: function (s) { const c = this.carrier != null ? s.slots[this.carrier] : null; if (c) { this.x = c.x; this.z = c.z; } },
        view: function () { return { carrier: this.carrier }; },
      });
      add(s, { kind: 'cradle', x: POINTS.cradle.x, z: POINTS.cradle.z, label: 'The Cradle' });
      s.say('STEWARD', 'Carry the Heart to where it slept; guard it while the vow is kept.');
    },
    drop(s, p) { const r = s.mstate.relic; r.carrier = null; r.x = p.x; r.z = p.z; s.say('STEWARD', 'The Heart has fallen. Lift it again.'); },
    update(s, dt) {
      const r = s.mstate.relic, c = r.carrier != null ? s.slots[r.carrier] : null;
      const atCradle = c && c.state === 'alive' && Math.hypot(c.x - POINTS.cradle.x, c.z - POINTS.cradle.z) < 4;
      if (atCradle) { s.complete('carry'); s.mstate.channel += dt; }
      s.setProgress('channel', Math.floor(s.mstate.channel));
      if (s.mstate.channel >= 45 && s.complete('channel')) s.finish('restore');
      s.aiTasks = r.carrier == null ? [{ kind: 'use', id: r.id, x: r.x, z: r.z }] : [];
    },
    waypoint: (s, o) => (o.id === 'carry' && s.mstate.relic.carrier == null ? { x: s.mstate.relic.x, z: s.mstate.relic.z, label: o.text } : { ...POINTS.cradle, label: o.text }),
  },
  destroy: {
    setup(s) {
      s.objectives.push({ id: 'nodes', text: 'Break the three fracture nodes (each opens only while BOTH its plates are held)', done: false, max: 3, progress: 0 });
      s.mstate.nodes = POINTS.nodes.map((n, i) => {
        const plates = n.plates.map(pt => addPlate(s, pt, { kind: 'plate', node: i }));
        return add(s, {
          kind: 'node', x: n.x, z: n.z, r: 1.6, breakable: true, hp: 150, idx: i, plates, label: 'Fracture node',
          open() { return this.plates.every(p => p.on); },
          onHit: function (s, dmg) {
            if (!this.open()) { s.event('dmg', { x: this.x, z: this.z, amount: 0, blocked: true }); return; }
            this.hp -= dmg; s.event('dmg', { x: this.x, z: this.z, amount: dmg });
            if (this.hp <= 0) { this.broken = true; s.event('fx', { kind: 'shatter', x: this.x, z: this.z }); }
          },
          view: function () { return { hp: Math.max(0, Math.round(this.hp)), open: this.open() ? 1 : 0, broken: this.broken ? 1 : 0 }; },
        });
      });
      s.say('STEWARD', 'Three cracks hold the Heart in place. Two must stand while one strikes the face.');
    },
    update(s) {
      const left = s.mstate.nodes.filter(n => !n.broken);
      s.setProgress('nodes', 3 - left.length);
      if (!left.length && s.complete('nodes')) s.finish('destroy');
      const n = left[0];
      s.aiTasks = n ? n.plates.map(p => ({ kind: 'stand', id: p.id, x: p.x, z: p.z })) : [];
    },
    waypoint: (s, o) => { const n = s.mstate.nodes.find(n => !n.broken); return n ? { x: n.x, z: n.z, label: o.text } : null; },
  },
  separate: {
    setup(s) {
      s.objectives.push({ id: 'stones', text: 'Strike the resonance stones in the order the Lost Records teach', done: false, max: 5, progress: 0 });
      s.mstate.step = 0;
      s.mstate.stones = POINTS.stones.map((pt, i) => add(s, {
        kind: 'stone', x: pt.x, z: pt.z, idx: i, lock: 0, label: 'Resonance stone — F to strike', useR: 2.8,
        usable: function (s) { return s.t >= this.lock && s.mstate.step < 5; },
        use: function (s) {
          this.lock = s.t + 0.5;
          const want = s.resonanceOrder[s.mstate.step];
          if (i === want) { s.mstate.step++; s.event('fx', { kind: 'chime', x: this.x, z: this.z, n: s.mstate.step }); }
          else {
            s.mstate.step = 0; s.event('fx', { kind: 'discord', x: this.x, z: this.z });
            s.say('STEWARD', 'Discord. Begin again.');
            for (let k = 0; k < 2; k++) spawnCreature(s, 'razorback', this.x + (k ? 6 : -6), this.z, { aggro: true });
          }
        },
        view: function () { return { g: i }; },
      }));
            s.say('STEWARD', 'Five stones, five notes, in the order the lost ones wrote.');
    },
    update(s) {
      s.setProgress('stones', s.mstate.step);
      if (s.mstate.step >= 5 && s.complete('stones')) s.finish('separate');
      s.aiTasks = [];
    },
    waypoint: (s, o) => ({ x: HEART.x, z: HEART.z, label: o.text }),   // never reveals the answer
  },
};
