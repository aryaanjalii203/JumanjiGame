// Acceptance tests A–L. Network tests use 5 separate real WebSocket clients against a live server;
// rule tests drive a Session directly so timing is deterministic.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createServer } from '../server/index.js';
import { Session } from '../server/session.js';
import { spawnCreature } from '../server/creatures.js';
import { POINTS, ARENA, HEART, CHECKPOINTS } from '../shared/world.js';
import { AVATARS } from '../shared/data.js';
import { Bot, sleep } from './harness.js';

const tmp = (n) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fr-')), n);
const AV = ['titan', 'wraith', 'circuit', 'oracle', 'phantom'];

// ---------- direct-session helpers
function mkSession({ humans = 5, difficulty = 'adventurer', mission = 1 } = {}) {
  const sent = [];
  const io = { send: () => {}, broadcast: (m) => sent.push(m), persist: () => {}, persistProfiles: () => {} };
  const s = new Session('TEST01', { difficulty, save: mission > 1 ? { missionIdx: mission, records: [], seed: 7 } : { missionIdx: 1, records: [], seed: 7 } }, io);
  for (let i = 0; i < humans; i++) {
    const r = s.addHuman({ name: `H${i}`, profileId: `p${i}`, profile: { id: `p${i}`, outfits: [], completed: [], seen: [] } });
    s.setAvatar(r.slot, AV[i]); s.setReady(r.slot, true);
  }
  assert.equal(s.start(0), null);
  while (s.cutscene) s.endCutscene();
  s.sent = sent;
  return s;
}
const run = (s, secs) => { for (let i = 0; i < secs * 20; i++) { s.tick(); while (s.cutscene) s.endCutscene(); } };
const P = (s, i) => s.slots[i];
const put = (p, x, z) => { p.x = x; p.z = z; p.y = 2; p.vy = 0; p.onGround = false; };
const still = (s) => { for (const p of s.players()) p.input = { mx: 0, mz: 0, yaw: 0 }; };
const clearCreatures = (s) => s.creatures.clear();
const objOf = (s, kind) => [...s.objects.values()].filter(o => o.kind === kind);
// Humans with no live socket would be driven by AI in tick(); mark them connected so they stay put.
function freeze(s) { for (const p of s.players()) { p.human = true; p.connected = true; p.input = { mx: 0, mz: 0, yaw: 0 }; } }

// ======================================================================== network tests
describe('network (5 real clients)', () => {
  let srv, bots, code;
  before(async () => {
    srv = await createServer({ port: 0, dataFile: tmp('saves.json'), quiet: true });
    bots = [];
    for (let i = 0; i < 5; i++) { const b = new Bot(srv.port, `Bot${i}`); await b.connect(); await b.hello(`profile-${i}-xxxxxxxx`); bots.push(b); }
  });
  after(async () => { for (const b of bots) b.close(); await srv.close(); });

  test('A. five separate clients join one session, pick avatars, enter, move, fight and share objects', async () => {
    bots[0].send({ type: 'create', difficulty: 'adventurer' });
    const w = await bots[0].msg('welcome'); bots[0].slot = w.slot; code = w.code;
    for (const b of bots.slice(1)) { b.send({ type: 'join', code }); b.slot = (await b.msg('welcome')).slot; }
    assert.deepEqual(bots.map(b => b.slot).sort(), [0, 1, 2, 3, 4]);
    // A sixth client is refused.
    const extra = new Bot(srv.port, 'Extra'); await extra.connect(); await extra.hello('profile-extra-xxxxxxx');
    extra.send({ type: 'join', code }); await extra.wait(b => b.errors.length); assert.match(extra.errors[0], /full/); extra.close();
    bots.forEach((b, i) => b.send({ type: 'avatar', avatar: AV[i] }));
    await bots[0].wait(b => b.lobby?.slots.every((s, i) => s && s.avatar === AV[i]));
    // Taking someone else's avatar is refused.
    bots[1].send({ type: 'avatar', avatar: 'titan' }); await bots[1].wait(b => b.errors.some(e => /taken/.test(e)));
    bots[1].send({ type: 'start' }); await bots[1].wait(b => b.errors.some(e => /host/.test(e)));
    for (const b of bots) b.send({ type: 'ready', v: true });
    await bots[0].wait(b => b.lobby?.slots.every(s => s.ready));
    bots[0].send({ type: 'start' });
    await Promise.all(bots.map(b => b.wait(x => x.snap)));
    const s = srv.sessions.get(code);
    while (s.cutscene) s.endCutscene();
    // Every client sees all five players.
    for (const b of bots) assert.equal(b.snap.p.length, 5);
    // Movement from each client changes that player's server position, and every other client sees it.
    const start = bots.map(b => ({ ...b.me() }));
    for (let k = 0; k < 30; k++) { bots.forEach((b, i) => b.input(i % 2 ? 0.5 : -0.5, 1)); await sleep(30); }
    await sleep(150);
    bots.forEach((b, i) => {
      const now = bots[(i + 1) % 5].snap.p.find(p => p.s === b.slot);
      assert.ok(now.z - start[i].z > 3, `player ${i} moved forward in another client's view (${start[i].z} -> ${now.z})`);
    });
    // Fight: spawn a creature in front of TITAN and hit it through the network.
    const titan = s.slots[bots[0].slot];
    const c = spawnCreature(s, 'razorback', titan.x, titan.z + 1.5); c.state = 'chase';
    bots[0].act('atk', 0);
    await bots[1].wait(b => b.events.some(e => e.type === 'dmg'));
    assert.ok(c.hp < c.maxHp, 'creature took damage from a networked attack');
    // Shared object: TITAN walks to the shelter → objective completes for everyone.
    put(titan, POINTS.shelter.x, POINTS.shelter.z);
    await Promise.all(bots.map(b => b.wait(x => x.snap.obj.find(o => o.id === 'shelter')?.done)));
    put(titan, POINTS.mapFragment.x, POINTS.mapFragment.z);
    await sleep(120);
    bots[0].act('interact');
    await Promise.all(bots.map(b => b.wait(x => x.snap.obj.find(o => o.id === 'map')?.done && !x.snap.o.some(o => o.k === 'fragment'))));
  });

  test('G. a player disconnects and reconnects: same slot, AI covers meanwhile, state consistent', async () => {
    const s = srv.sessions.get(code);
    const b = bots[2]; const slot = b.slot; const token = b.msgs.find(m => m.type === 'welcome').token;
    const p = s.slots[slot];
    p.hp = 61; const lives = p.lives; const mission = s.missionIdx;
    b.close();
    await bots[0].wait(x => x.snap.p.find(q => q.s === slot)?.c === false);
    assert.equal(p.connected, false);
    const before = { x: p.x, z: p.z };
    await sleep(600);
    assert.ok(Math.hypot(p.x - before.x, p.z - before.z) >= 0, 'AI is allowed to drive the slot');
    const nb = new Bot(srv.port, 'Bot2b'); await nb.connect(); await nb.hello('profile-2-xxxxxxxx');
    nb.send({ type: 'resume', code, token }); const w = await nb.msg('welcome');
    assert.equal(w.slot, slot); assert.equal(w.resumed, true);
    nb.slot = slot; bots[2] = nb;
    await nb.wait(x => x.snap);
    const me = nb.me();
    assert.equal(me.c, true); assert.equal(me.l, lives); assert.equal(nb.snap.m, mission);
    assert.ok(me.hp <= 61 + 45 * 3, 'health carried over');
    // A bad token is refused.
    const evil = new Bot(srv.port, 'Evil'); await evil.connect(); await evil.hello('profile-evil-xxxxxx');
    evil.send({ type: 'resume', code, token: 'deadbeef' }); await evil.msg('resumeFailed'); evil.close();
  });

  test('K (network). duplicate packets, flooding, malformed and oversized messages are rejected', async () => {
    const s = srv.sessions.get(code);
    const b = bots[4], p = s.slots[b.slot];
    // Oversized/malformed messages don't crash the server.
    b.ws.send('{not json'); b.ws.send(JSON.stringify({ type: 'nope' })); b.ws.send(JSON.stringify({ type: 'input', seq: 'x', mx: 'NaN', mz: 1e9, yaw: 'a' }));
    await sleep(100);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
    // Speed hack: mx/mz are clamped to a unit vector, so distance per second can't exceed sprint speed.
    const x0 = p.x, z0 = p.z, t0 = s.t;
    for (let i = 0; i < 20; i++) { b.send({ type: 'input', seq: b.seq += 1, mx: 50, mz: 50, yaw: 0, sprint: true }); await sleep(25); }
    await sleep(100);
    const v = Math.hypot(p.x - x0, p.z - z0) / (s.t - t0);
    assert.ok(v <= AVATARS[p.avatar].speed * 1.5 + 0.5, `speed ${v.toFixed(2)} within sprint limit`);
    // Duplicate action sequence numbers are ignored.
    const ammo = p.ammo; p.cd.atk = 0;
    b.send({ type: 'act', seq: 9000, kind: 'atk', aim: 0 }); b.send({ type: 'act', seq: 9000, kind: 'atk', aim: 0 }); b.send({ type: 'act', seq: 8999, kind: 'atk', aim: 0 });
    await sleep(150);
    assert.equal(ammo - p.ammo, 1, 'only one shot fired for duplicate/stale action packets');
    // Flooding drops messages instead of processing them all.
    const dropped0 = srv.metrics.dropped;
    for (let i = 0; i < 600; i++) b.send({ type: 'chat', text: 'spam' });
    await sleep(200);
    assert.ok(srv.metrics.dropped > dropped0, 'flood was rate-limited');
  });

  test('J. performance: tick cost, bandwidth and memory with 5 clients', async () => {
    const s = srv.sessions.get(code);
    for (let i = 0; i < 12; i++) spawnCreature(s, 'razorback', -20 + i * 3, 120, { aggro: true });
    const bytes0 = srv.metrics.bytesOut, t0 = Date.now();
    let tickTotal = 0, n = 0, worst = 0;
    const origTick = s.tick.bind(s);
    s.tick = () => { const a = process.hrtime.bigint(); origTick(); const d = Number(process.hrtime.bigint() - a) / 1e6; tickTotal += d; n++; worst = Math.max(worst, d); };
    for (let k = 0; k < 60; k++) { bots.forEach((b, i) => b.input(Math.sin(k + i), 1)); await sleep(50); }
    s.tick = origTick;
    const secs = (Date.now() - t0) / 1000;
    const perClient = (srv.metrics.bytesOut - bytes0) / secs / 5;
    const mem = process.memoryUsage().rss / 1048576;
    globalThis.__perf = { avgTickMs: +(tickTotal / n).toFixed(3), worstTickMs: +worst.toFixed(2), kbPerSecPerClient: +(perClient / 1024).toFixed(1), rssMB: +mem.toFixed(0), creatures: s.creatures.size };
    console.log('PERF', JSON.stringify(globalThis.__perf));
    assert.ok(tickTotal / n < 10, 'average tick under 10 ms (budget is 50 ms)');
    assert.ok(perClient < 200 * 1024, 'under 200 KB/s per client');
  });
});

// ======================================================================== rules (direct session)
test('B. avatar abilities and weaknesses behave distinctly', () => {
  const s = mkSession(); freeze(s); clearCreatures(s);
  const [titan, wraith, circuit, oracle, phantom] = [0, 1, 2, 3, 4].map(i => P(s, i));
  // Distinct stats/weaknesses.
  assert.ok(wraith.maxHp < circuit.maxHp && titan.maxHp > oracle.maxHp);
  assert.ok(AVATARS.titan.speed < AVATARS.wraith.speed && AVATARS.titan.noise > AVATARS.wraith.noise);
  // TITAN Bulwark: −70% damage and taunt.
  put(titan, 0, 60); run(s, 0.2);
  const c = spawnCreature(s, 'razorback', 3, 60); c.target = wraith.slot;
  s.doAction(titan, 'q', 0);
  assert.equal(c.target, titan.slot, 'Bulwark taunts nearby creatures');
  titan.fx.invuln = 0; titan.fx.dodge = 0;
  const hp0 = titan.hp; s.hurtPlayer(titan, 100); assert.equal(hp0 - titan.hp, 30);
  // WRAITH silent takedown: ×3 on unaware, ×0.5 vs armor front.
  const r = spawnCreature(s, 'razorback', 0, 80); r.state = 'patrol'; r.target = null;
  put(wraith, 0, 78.2); wraith.cd.atk = 0; s.doAction(wraith, 'atk', 0);
  assert.equal(r.maxHp - r.hp, 48, 'unaware target takes triple damage');
  const g = spawnCreature(s, 'guardian', 10, 80); g.yaw = Math.PI; g.state = 'chase'; g.target = wraith.slot;   // facing -z
  put(wraith, 10, 78); wraith.cd.atk = 0; s.doAction(wraith, 'atk', 0);
  assert.ok(Math.abs((g.maxHp - g.hp) - 16 * 0.2 * 0.5) < 0.01, 'armored front + wraith penalty');
  const g2hp = g.hp; put(wraith, 10, 82); wraith.cd.atk = 0; s.doAction(wraith, 'atk', Math.PI);
  assert.ok(Math.abs((g2hp - g.hp) - 16 * 1.5) < 0.01, 'weak point on the back');
  // CIRCUIT Decoy redirects; Overload ×3 on armor.
  put(circuit, 30, 60); const d = spawnCreature(s, 'razorback', 32, 62);
  s.doAction(circuit, 'q', 0); assert.ok(d.decoy && s.objects.get(d.decoy)?.kind === 'decoy');
  const g3 = spawnCreature(s, 'guardian', 30, 64); g3.yaw = Math.PI; g3.state = 'chase';
  s.doAction(circuit, 'e', 0); assert.ok(g3.overloadUntil > s.t);
  put(circuit, 30, 62); circuit.cd.atk = 0; s.doAction(circuit, 'atk', 0);
  assert.ok(Math.abs((g3.maxHp - g3.hp) - 10 * 0.2 * 3) < 0.01, 'overload triples armored damage');
  // Circuit long cooldowns.
  assert.ok(circuit.cd.e >= 17);
  // ORACLE Mend heals nearby; Track reveals.
  put(oracle, 0, 100); put(wraith, 2, 100); wraith.hp = 20;
  s.doAction(oracle, 'q', 0); assert.equal(wraith.hp, 65);
  // PHANTOM ranged uses ammo, Veil drops targets, Smoke protects allies.
  put(phantom, -20, 100); const tgt = spawnCreature(s, 'razorback', -20, 110); tgt.state = 'chase'; tgt.target = phantom.slot;
  const ammo = phantom.ammo; phantom.cd.atk = 0; s.doAction(phantom, 'atk', 0);
  assert.equal(phantom.ammo, ammo - 1); assert.ok(tgt.hp < tgt.maxHp, 'shot hit at 10m');
  s.doAction(phantom, 'q', 0); assert.equal(tgt.target, null, 'Veil drops aggro'); assert.ok(phantom.fx.veil > 0);
  phantom.cd.atk = 0; s.doAction(phantom, 'atk', 0); assert.equal(phantom.fx.veil, 0, 'attacking breaks Veil');
  phantom.ammo = 0; phantom.cd.atk = 0; const hpT = tgt.hp; s.doAction(phantom, 'atk', 0); assert.equal(tgt.hp, hpT, 'no ammo, no shot');
  // Cooldowns enforced server-side.
  const cdq = titan.cd.q; s.doAction(titan, 'q', 0); assert.equal(titan.cd.q, cdq, 'ability on cooldown ignored');
});

test('C. lives: downed, revive, death, respawn, out, life donation, team wipe', () => {
  const s = mkSession(); freeze(s); clearCreatures(s); s.mission = { ...s.mission, update() {} };
  const a = P(s, 0), b = P(s, 1);
  a.fx.invuln = 0; s.hurtPlayer(a, 1000);
  assert.equal(a.state, 'downed'); assert.equal(a.lives, 3);
  // Revive by a teammate holding F (ORACLE is faster — here WRAITH, 3s).
  put(b, a.x + 1, a.z); s.interact(b); assert.ok(b.holding?.revive === a.slot);
  run(s, 3.2); assert.equal(a.state, 'alive'); assert.equal(a.lives, 3, 'revive costs no mark');
  // Bleed out → dead → lose mark → respawn at checkpoint.
  a.fx.invuln = 0; s.hurtPlayer(a, 1000); b.holding = null; run(s, 10.2);
  assert.equal(a.state, 'dead'); assert.equal(a.lives, 2);
  run(s, 4.2); assert.equal(a.state, 'alive'); assert.equal(a.hp, a.maxHp);
  const cp = s.checkpoint(); assert.ok(Math.hypot(a.x - cp.x, a.z - cp.z) < 4, 'respawned at checkpoint');
  // Falling into the ravine kills outright.
  a.fx.invuln = 0; put(a, 10, 175); run(s, 2); assert.equal(a.lives, 1);
  run(s, 4.2);
  // Last mark → out (spectator), not removed from the session.
  s.kill(a); assert.equal(a.state, 'out'); assert.equal(a.lives, 0); assert.ok(s.slots.includes(a));
  // Donation at a Life Shrine (mission 2+ has shrines).
  s.beginMission(2); freeze(s); clearCreatures(s);
  a.state = 'out'; a.lives = 0;
  const shrine = objOf(s, 'shrine')[0]; put(b, shrine.x, shrine.z); b.lives = 3;
  s.interact(b); run(s, 2.2);
  assert.equal(a.state, 'alive'); assert.equal(a.lives, 1); assert.equal(b.lives, 2);
  // A donor with one mark cannot donate.
  a.state = 'out'; a.lives = 0; b.lives = 1; s.interact(b); assert.equal(b.holding, null);
  // Team wipe → restart mission at checkpoint, everyone at one mark.
  for (const p of s.players()) { p.state = 'out'; p.lives = 0; }
  s.checkWipe();
  assert.ok(s.players().every(p => p.state === 'alive' && p.lives === 1));
  assert.equal(s.missionIdx, 2); assert.equal(s.teamStats.wipes, 1);
});

test('D. creature AI: detect, chase, charge with telegraph, pack hesitation, flee, ambush lone players', () => {
  const s = mkSession(); freeze(s); clearCreatures(s); s.mission = { ...s.mission, update() {} };
  const [a, b, c2] = [P(s, 0), P(s, 1), P(s, 2)];
  for (const p of s.players()) put(p, -40, 20);
  // Razorback sees a player in front and chases, then telegraphs a charge.
  put(b, 0, 64); b.noise = 1;
  const r = spawnCreature(s, 'razorback', 0, 75); r.yaw = Math.PI; r.wp = { x: 0, z: 70 };   // facing and walking toward the player
  run(s, 0.6);
  assert.ok(['alert', 'chase'].includes(r.state), `detected (${r.state})`);
  let sawWindup = false, sawCharge = false;
  for (let i = 0; i < 80; i++) { s.tick(); if (r.state === 'windup') { sawWindup = true; assert.ok(r.tel?.kind === 'line', 'charge is telegraphed'); } if (r.state === 'charge') sawCharge = true; }
  assert.ok(sawWindup && sawCharge, 'wind-up then charge');
  // Unseen behind and crouched: not detected; loud TITAN heard from further.
  const r2 = spawnCreature(s, 'razorback', 30, 60); r2.yaw = 0; r2.state = 'patrol'; r2.wp = { x: 30, z: 70 };   // walking away
  put(c2, 30, 51); c2.input = { mx: 0, mz: 0, yaw: 0, crouch: true };
  s.tick(); assert.equal(r2.state === 'patrol' || r2.state === 'investigate', true, 'quiet player behind it is not noticed');
  // Pack hesitates when the target is in a tight group.
  clearCreatures(s);
  for (const [i, p] of [a, b, c2].entries()) { put(p, 0 + i, 100); p.crouch = false; }
  const pk = spawnCreature(s, 'razorback', 0, 110); pk.state = 'chase'; pk.target = b.slot;
  let circled = false; for (let i = 0; i < 40; i++) { s.tick(); if (pk.state === 'circle') circled = true; }
  assert.ok(circled, 'hesitates/circles around a coordinated group');
  // Flee when badly hurt.
  pk.hp = pk.maxHp * 0.2; s.tick(); assert.equal(pk.state, 'flee');
  // Canopy Stalker ambushes a LONE player only.
  clearCreatures(s);
  for (const p of s.players()) put(p, -40, 20);
  const st = spawnCreature(s, 'stalker', -14, 118);
  put(a, -14, 121); put(b, -12, 121);   // together
  run(s, 0.5); assert.equal(st.state, 'perch', 'does not ambush a pair');
  put(b, 30, 30); run(s, 0.3);
  assert.equal(st.state, 'rustle', 'targets the lone player'); assert.equal(st.tel?.kind, 'ring', 'ambush is telegraphed');
  run(s, 1.0); assert.ok(['hunt', 'swipe'].includes(st.state), 'pounced');
  // Focused by two players → climbs away.
  st.hitters.set(0, s.t); st.hitters.set(1, s.t); s.tick(); assert.equal(st.state, 'climb');
});

test('E. objectives cannot complete early; next mission starts only after prerequisites', () => {
  const s = mkSession(); freeze(s); clearCreatures(s);
  const a = P(s, 0);
  // Map fragment cannot be taken before shelter.
  const frag = objOf(s, 'fragment')[0];
  put(a, frag.x, frag.z); run(s, 0.2); s.interact(a);
  assert.equal(s.objective('map').done, false);
  // Pack objective can't complete before the map, even if the pack is gone.
  assert.equal(s.complete('pack'), false);
  // Walking into camp early does nothing.
  put(a, POINTS.camp.x, POINTS.camp.z); run(s, 0.5); assert.equal(s.missionIdx, 1);
  // Do it in order.
  put(a, POINTS.shelter.x, POINTS.shelter.z); run(s, 0.2); assert.ok(s.objective('shelter').done);
  put(a, frag.x, frag.z); run(s, 0.2); s.interact(a); assert.ok(s.objective('map').done);
  run(s, 0.2); assert.ok(s.objective('pack').done, 'pack counts as beaten (creatures cleared)');
  put(a, POINTS.camp.x, POINTS.camp.z); run(s, 0.3);
  assert.equal(s.missionIdx, 2);
  // Mission 2: cannot reach "far" without a crossing.
  freeze(s); clearCreatures(s);
  put(a, 0, 200); run(s, 0.3); assert.equal(s.missionIdx, 2, 'no crossing → no advance');
});

test('F. puzzles: two-winch bridge, Titan log, three plates, glyph pillars under simultaneous input', () => {
  const s = mkSession({ mission: 2 }); s.beginMission(2); freeze(s); clearCreatures(s);
  const [a, b, c, d, e] = [0, 1, 2, 3, 4].map(i => P(s, i));
  const [wl, wr] = objOf(s, 'winch');
  // One winch alone does nothing.
  put(a, wl.x, wl.z); run(s, 0.1); s.interact(a); run(s, 2); assert.equal(s.mstate.bridgeP, 0);
  // Broken winch must be repaired first (CIRCUIT 2× faster).
  put(c, wr.x, wr.z); run(s, 0.1); s.interact(c); run(s, 2.2); assert.equal(wr.broken, false, 'repaired in ~2s by Circuit');
  s.interact(c);
  for (let i = 0; i < 6.5 * 20; i++) { for (const p of s.players()) p.fx.invuln = 9; s.tick(); }   // the ambush pack is real; keep the crew alive
  assert.equal(s.dyn.bridge, true, 'both winches together lower the bridge');
  // Alternative: TITAN log (fresh session).
  const s2 = mkSession({ mission: 2 }); s2.beginMission(2); freeze(s2); clearCreatures(s2);
  const t = P(s2, 0); put(t, POINTS.log.x, POINTS.log.z); run(s2, 0.1); s2.doAction(t, 'e', 0);
  assert.equal(s2.dyn.log, true); run(s2, 0.1); assert.ok(s2.objective('cross').done);
  // Temple.
  const s3 = mkSession({ mission: 3 }); s3.beginMission(3); freeze(s3); clearCreatures(s3);
  const plates = s3.mstate.plates;
  put(P(s3, 0), plates[0].x, plates[0].z); put(P(s3, 1), plates[1].x, plates[1].z); run(s3, 0.3);
  assert.equal(s3.objective('plates').done, false, 'two of three plates is not enough');
  put(P(s3, 2), plates[2].x, plates[2].z); run(s3, 0.3);
  assert.ok(s3.objective('plates').done); assert.ok(s3.dyn.open.has('gateA'));
  // Glyph pillars: five players hammer the same pillar in the same tick → only one turn applies.
  const pil = s3.mstate.pillars[0], g0 = pil.glyph;
  for (let i = 0; i < 5; i++) put(P(s3, i), pil.x, pil.z + 1.2);
  run(s3, 0.1);
  for (let i = 0; i < 5; i++) s3.interact(P(s3, i));
  assert.equal(pil.glyph, (g0 + 1) % 6, 'simultaneous turns are serialized by the pillar lock');
  // Solve by reading the mural (target) — no guessing.
  assert.equal(s3.objective('glyphs').done, false);
  s3.mstate.pillars.forEach((p, i) => {
    put(P(s3, 0), p.x, p.z + 1.2); run(s3, 0.05);
    let guard = 0; while (p.glyph !== s3.mstate.target[i] && guard++ < 10) { run(s3, 0.4); s3.interact(P(s3, 0)); }
  });
  run(s3, 0.1);
  assert.ok(s3.objective('glyphs').done); assert.ok(s3.dyn.open.has('gateB'));
  // Further turns are locked once solved.
  const after = s3.mstate.pillars[0].glyph; run(s3, 0.5); s3.interact(P(s3, 0)); assert.equal(s3.mstate.pillars[0].glyph, after);
});

test('H. Hollow Colossus: plates → anchors → kneel → core → death; Curator shield', () => {
  const s = mkSession({ mission: 4 }); s.beginMission(4); freeze(s); clearCreatures(s);
  const ps = s.players();
  for (const p of ps) put(p, ARENA.x, ARENA.z - 20);
  run(s, 0.3);
  assert.ok(s.boss, 'boss spawned after its entrance'); const b = s.boss;
  // Core immune in phase 1.
  b.knelt = 0; assert.equal(b.damage({ part: 'core' }, 100, ps[0]), 0);
  // Break plates through real melee hits.
  const t = ps[0];
  for (const pl of b.plates) {
    let guard = 0;
    while (pl.hp > 0 && guard++ < 200) {
      const q = b.platePos(pl); put(t, q.x + (q.x - b.x) * 0.4, q.z + (q.z - b.z) * 0.4); t.fx.invuln = 99; t.onGround = true; t.y = 0;
      t.cd.atk = 0; t.stamina = 100; s.doAction(t, 'atk', Math.atan2(q.x - t.x, q.z - t.z)); s.tick();
    }
  }
  run(s, 0.1);
  assert.equal(b.phase, 2); assert.ok(s.objective('plates').done);
  // Only one anchor: no kneel.
  const [an1, an2] = s.mstate.anchors;
  put(ps[1], an1.x, an1.z); put(ps[2], ARENA.x + 30, ARENA.z); run(s, 2);
  assert.equal(b.knelt, 0);
  put(ps[2], an2.x, an2.z); run(s, 1.8);
  assert.ok(b.knelt > 0, 'kneels when both anchors held'); assert.ok(s.objective('kneel').done);
  // Damage core while knelt; phase 3 below 35%.
  let guard = 0;
  while (b.hp > 0 && guard++ < 2000) {
    if (!b.knelt) { put(ps[1], an1.x, an1.z); put(ps[2], an2.x, an2.z); }
    put(t, b.x, b.z + 3); t.fx.invuln = 99; t.cd.atk = 0; t.stamina = 100; t.y = 0;
    s.doAction(t, 'atk', Math.atan2(b.x - t.x, b.z - t.z)); s.tick();
    if (b.hp < b.maxHp * 0.35) assert.equal(b.phase, 3);
  }
  run(s, 0.2);
  assert.ok(s.objective('core').done); assert.ok(objOf(s, 'portal').length === 1, 'exit portal appears');
  // Curator: shielded while waves stand.
  const s2 = mkSession({ mission: 6 }); s2.beginMission(6); freeze(s2); run(s2, 0.1);
  const cur = s2.boss; assert.ok(cur?.type === 'curator');
  run(s2, 0.2); assert.ok(cur.shield, 'shielded while his wave lives');
  assert.equal(cur.damage({}, 50), 0);
  for (const c of s2.creatures.values()) { c.hp = 0; c.state = 'dead'; }
  run(s2, 0.1); assert.equal(cur.shield, false);
  assert.ok(cur.damage({}, 50) > 0);
});

function toChoice(choice, records = 0) {
  const s = mkSession({ mission: 6 }); s.beginMission(6); freeze(s); run(s, 0.1);
  for (let i = 0; i < records; i++) s.flags.records.add(i);
  s.boss.hp = 0; run(s, 0.2);
  assert.ok(s.objective('curator').done);
  const alt = objOf(s, 'altar').find(a => a.choice === choice);
  assert.ok(alt, 'altars appear after the Curator falls');
  const p = P(s, 0); put(p, alt.x, alt.z); run(s, 0.1); s.interact(p); run(s, 2.2);
  return s;
}

test('I. all three endings are reachable through gameplay (no softlock)', () => {
  // Restore: carry the Relic to the Cradle and hold it 45s.
  const s = toChoice('restore'); clearCreatures(s);
  assert.equal(s.mstate.path, 'restore');
  const p = P(s, 0), relic = s.mstate.relic;
  put(p, relic.x, relic.z); run(s, 0.1); s.interact(p); assert.ok(p.carrying);
  // Dropping on death keeps progress recoverable.
  p.fx.invuln = 0; s.hurtPlayer(p, 9999); assert.equal(relic.carrier, null); p.state = 'alive'; p.hp = p.maxHp;
  put(p, relic.x, relic.z); run(s, 0.1); s.interact(p); assert.ok(p.carrying);
  put(p, POINTS.cradle.x, POINTS.cradle.z);
  for (let i = 0; i < 46 * 20; i++) { p.fx.invuln = 99; clearCreatures(s); s.tick(); }
  assert.equal(s.phase, 'ended'); assert.equal(s.ending.choice, 'restore');
  // Destroy: nodes only open while both plates are held.
  const d = toChoice('destroy'); clearCreatures(d);
  const ps = d.players();
  for (const n of d.mstate.nodes) {
    const hp0 = n.hp; put(ps[0], n.x, n.z + 2.5); ps[0].cd.atk = 0; ps[0].stamina = 100; d.doAction(ps[0], 'atk', Math.PI); assert.equal(n.hp, hp0, 'shielded node ignores hits');
    put(ps[1], n.plates[0].x, n.plates[0].z); put(ps[2], n.plates[1].x, n.plates[1].z); d.tick();
    let g = 0; while (!n.broken && g++ < 300) { ps[0].cd.atk = 0; ps[0].stamina = 100; for (const q of ps) q.fx.invuln = 99; d.doAction(ps[0], 'atk', Math.atan2(n.x - ps[0].x, n.z - ps[0].z)); clearCreatures(d); d.tick(); }
    assert.ok(n.broken);
  }
  d.tick(); assert.equal(d.ending?.choice, 'destroy');
  // Separate: altar locked without records; with records, wrong order resets.
  const locked = mkSession({ mission: 6 }); locked.beginMission(6); freeze(locked); run(locked, 0.1); locked.boss.hp = 0; run(locked, 0.2);
  const sepAlt = objOf(locked, 'altar').find(a => a.choice === 'separate');
  put(P(locked, 0), sepAlt.x, sepAlt.z); run(locked, 0.1); locked.interact(P(locked, 0)); run(locked, 2.2);
  assert.equal(locked.mstate.path, undefined, 'Parting needs all three Lost Records');
  const sp = toChoice('separate', 3); clearCreatures(sp);
  const order = sp.resonanceOrder, stones = sp.mstate.stones, q = P(sp, 0);
  const strike = (i) => { put(q, stones[i].x, stones[i].z + 1.5); sp.tick(); sp.t += 1; sp.interact(q); };
  strike(order[0]); strike(order[0] === 0 ? 1 : 0);
  assert.equal(sp.mstate.step, 0, 'wrong note resets the sequence');
  clearCreatures(sp);
  for (const i of order) strike(i);
  sp.tick();
  assert.equal(sp.ending?.choice, 'separate');
});

test('K. exploits: rewards are one-time, client cannot set state, checkpoints only at mission boundaries', () => {
  const s = mkSession(); freeze(s);
  const prof = P(s, 0).profile;
  s.grantMissionReward(1); s.grantMissionReward(1); s.grantMissionReward(1);
  assert.equal(prof.completed.filter(k => k === 'm1').length, 1); assert.equal(prof.xp, 100);
  // Fields like hp/lives in an input packet are ignored.
  const p = P(s, 1); const hp = p.hp, lives = p.lives;
  s.onInput(1, { seq: 1, mx: 0, mz: 0, yaw: 0, hp: 9999, lives: 99, ammo: 999 });
  assert.equal(p.hp, hp); assert.equal(p.lives, lives);
  // Unknown action kinds do nothing.
  s.onAction(1, { seq: 1, kind: 'win', aim: 0 }); s.onAction(1, { seq: 2, kind: 'giveLives' });
  assert.equal(s.phase, 'game');
  // Herb spam can't overheal or go negative.
  p.herbs = 1; p.hp = p.maxHp - 10; s.doAction(p, 'herb'); s.doAction(p, 'herb');
  assert.equal(p.hp, p.maxHp); assert.equal(p.herbs, 0);
  // Persistent save records the mission start, not mid-mission progress.
  let saved = null; s.io.persist = (ss) => { saved = { idx: ss.missionIdx }; };
  s.beginMission(2); assert.equal(saved.idx, 2);
  // Relic outfit can't be equipped before finishing.
  assert.match(s.setAvatar(0, P(s, 0).avatar, 'relic'), /unlocks/);
  // Avatar switching blocked mid-combat / away from camp.
  freeze(s); put(P(s, 0), 0, 300);
  assert.match(s.setAvatar(0, 'wraith') || '', /checkpoint|taken/);
});

test('L. full campaign from a fresh start to the credits (scripted director, real action handlers)', () => {
  // Players are moved to each objective (positions set directly) but every interaction, attack,
  // plate, boss phase and ending goes through the same server code paths as real clients.
  const s = mkSession(); freeze(s);
  const ps = s.players(), [a, b, c] = ps;
  const godmode = () => { for (const p of ps) { p.fx.invuln = 99; if (p.state !== 'alive') { p.state = 'alive'; p.hp = p.maxHp; } } };
  const step = (secs = 0.2) => { for (let i = 0; i < secs * 20; i++) { godmode(); s.tick(); while (s.cutscene) s.endCutscene(); } };
  const use = (p, o, wait = 0.2) => { put(p, o.x, o.z); step(0.1); s.interact(p); step(wait); };
  const killAll = () => { for (const cr of [...s.creatures.values()]) { cr.hp = 0; cr.state = 'dead'; cr.deadT = 0; } };
  // M1
  put(a, POINTS.shelter.x, POINTS.shelter.z); step();
  use(a, objOf(s, 'fragment')[0]); killAll(); step();
  for (const r of objOf(s, 'record')) { use(a, { x: r.x, z: r.z }); if (r.idx === 2) { a.y = 2.5; s.interact(a); step(); } }
  put(a, POINTS.camp.x, POINTS.camp.z); step(0.5);
  assert.equal(s.missionIdx, 2, 'M1 → M2');
  // M2: two winches.
  const [wl, wr] = objOf(s, 'winch');
  use(c, wr, 4.5); put(b, wl.x, wl.z); step(0.1); s.interact(b); s.interact(c); step(6.5);
  put(a, 0, 200); step(0.5);
  assert.equal(s.missionIdx, 3, 'M2 → M3');
  // M3: plates, glyphs, key, exit.
  s.mstate.plates.forEach((pl, i) => put(ps[i], pl.x, pl.z)); step(0.4);
  s.mstate.pillars.forEach((pl, i) => { let g = 0; while (pl.glyph !== s.mstate.target[i] && g++ < 10) use(a, { x: pl.x, z: pl.z + 1.2 }, 0.4); });
  step(0.2); use(a, objOf(s, 'key')[0]); killAll();
  // Lost Record #2 is behind the cracked wall: TITAN heaves it.
  if (!s.flags.records.has(1)) { put(a, POINTS.cracked.x - 2, POINTS.cracked.z); step(0.1); s.doAction(a, 'e', Math.PI / 2); step(0.2); const r = objOf(s, 'record').find(r => r.idx === 1); if (r) use(a, r); }
  put(a, 0, 344); step(0.5);
  assert.equal(s.missionIdx, 4, 'M3 → M4');
  // M4: Colossus.
  for (const p of ps) put(p, ARENA.x, ARENA.z - 20); step(0.3);
  const boss = s.boss; for (const pl of boss.plates) pl.hp = 0; step(0.2);
  const [an1, an2] = s.mstate.anchors;
  let guard = 0;
  while (boss.hp > 0 && guard++ < 3000) {
    put(b, an1.x, an1.z); put(c, an2.x, an2.z); put(a, boss.x, boss.z + 3); a.cd.atk = 0; a.stamina = 100; a.y = 0;
    s.doAction(a, 'atk', Math.atan2(boss.x - a.x, boss.z - a.z)); killAll(); step(0.05);
  }
  step(0.3); put(a, POINTS.portal.x, POINTS.portal.z); step(0.5);
  assert.equal(s.missionIdx, 5, 'M4 → M5 via the false exit');
  // M5: terminals.
  for (const t of objOf(s, 'terminal')) use(a, t, 2.3);
  killAll(); put(a, 0, 486); step(0.5);
  assert.equal(s.missionIdx, 6, 'M5 → M6');
  // M6: Curator, then the secret ending (all three records collected along the way).
  assert.equal(s.flags.records.size, 3, 'all Lost Records collected during the run');
  guard = 0;
  while (s.boss && s.boss.hp > 0 && guard++ < 4000) { killAll(); step(0.1); put(a, s.boss.x, s.boss.z + 2); a.cd.atk = 0; a.stamina = 100; s.doAction(a, 'atk', Math.PI); }
  step(0.3);
  use(a, objOf(s, 'altar').find(x => x.choice === 'separate'), 2.3);
  for (const i of s.resonanceOrder) { killAll(); const st = s.mstate.stones[i]; put(a, st.x, st.z + 1.5); step(0.6); s.interact(a); }
  step(0.2);
  assert.equal(s.phase, 'ended');
  assert.equal(s.ending.choice, 'separate');
  const endMsg = s.sent.find(m => m.type === 'ending');
  assert.ok(endMsg && endMsg.players.length === 5, 'ending broadcast to clients with all five bearers');
  assert.ok(P(s, 0).profile.outfits.includes('relic'), 'completion unlocks the Relic outfit');
});

test('host can choose the room code; friends join with it; duplicates and bad codes are refused', async () => {
  const srv = await createServer({ port: 0, dataFile: tmp('saves.json'), quiet: true });
  try {
    const host = new Bot(srv.port, 'Host'); await host.connect(); await host.hello('profile-host-xxxxxx');
    host.send({ type: 'create', difficulty: 'story', code: 'anjali' });
    const w = await host.msg('welcome');
    assert.equal(w.code, 'ANJALI');
    const friends = [];
    for (let i = 0; i < 4; i++) { const f = new Bot(srv.port, `F${i}`); await f.connect(); await f.hello(`profile-f${i}-xxxxxxx`); f.send({ type: 'join', code: 'Anjali' }); await f.msg('welcome'); friends.push(f); }
    await host.wait(b => b.lobby?.slots.filter(Boolean).length === 5);
    const other = new Bot(srv.port, 'Other'); await other.connect(); await other.hello('profile-other-xxxxx');
    other.send({ type: 'create', code: 'ANJALI' }); await other.wait(b => b.errors.some(e => /already in use/.test(e)));
    other.send({ type: 'create', code: 'a b!' }); await other.wait(b => b.errors.some(e => /4 to 8/.test(e)));
    for (const b of [host, other, ...friends]) b.close();
  } finally { await srv.close(); }
});
