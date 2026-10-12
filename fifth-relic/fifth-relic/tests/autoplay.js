// Autoplay playtest: one scripted "human" + four AI companions play the campaign with NO teleporting.
// The bot only reads the same snapshot a client gets and sends the same input/action messages a client sends.
// Usage: node tests/autoplay.js [difficulty] [choice] [maxMinutes]
import { Session } from '../server/session.js';
import { route } from '../server/ai.js';
import { AVATARS } from '../shared/data.js';

export function autoplay({ difficulty = 'adventurer', choice = 'restore', maxMinutes = 40, avatar = 'titan', log = false } = {}) {
  const report = { missions: [], deaths: 0, wipes: 0, finished: false, minutes: 0, damageTaken: 0, downs: 0 };
  const io = { send() {}, broadcast(m) { for (const e of m.ev || []) { if (e.type === 'hurt') report.damageTaken += e.amount; if (e.type === 'downed') report.downs++; } }, persist() {}, persistProfiles() {} };
  const s = new Session('AUTO01', { difficulty }, io);
  const me = s.addHuman({ name: 'Autopilot', profileId: 'auto', profile: { id: 'auto', outfits: [], completed: [], seen: [] } });
  s.setAvatar(me.slot, avatar); s.setReady(me.slot, true); s.start(me.slot);
  const slot = me.slot; let seq = 0, aseq = 0;
  let missionStart = 0, lastM = s.missionIdx, stuckT = 0, lastPos = null, side = 1, holdT = 0, glyphT = 0;
  const act = (kind, aim = 0) => s.onAction(slot, { seq: ++aseq, kind, aim });
  const maxTicks = maxMinutes * 60 * 20;
  for (let tick = 0; tick < maxTicks; tick++) {
    if (s.cutscene) { s.voteSkip(slot); if (s.cutscene) { s.tick(); continue; } }
    const snap = s.snapshot();
    if (snap.m !== lastM) { report.missions.push({ m: lastM, secs: Math.round(s.t - missionStart) }); if (log) console.log(`mission ${lastM} done in ${Math.round(s.t - missionStart)}s`); lastM = snap.m; missionStart = s.t; }
    if (s.phase === 'ended') { report.missions.push({ m: lastM, secs: Math.round(s.t - missionStart) }); report.finished = true; break; }
    const P = snap.p.find(p => p.s === slot), real = s.slots[slot];
    let inp = { mx: 0, mz: 0, yaw: real.yaw, sprint: false, crouch: false, jump: false };
    if (P.st === 'alive') {
      const obj = snap.obj.find(o => !o.done && (!o.after || o.after.every(a => snap.obj.find(x => x.id === a)?.done)));
      let target = snap.wp ? { x: snap.wp.x, z: snap.wp.z } : null, stop = 1.2, wantUse = null;
      const near = (k, r = 2.6) => snap.o.filter(o => o.k === k).sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z))[0];
      // Mission-specific reading of the screen.
      if (obj?.id === 'glyphs') {
        const mural = near('mural');
        const wrong = snap.o.filter(o => o.k === 'pillar').find(pl => pl.g !== mural.glyphs[snap.o.filter(o => o.k === 'pillar').indexOf(pl)]);
        if (wrong) { target = { x: wrong.x, z: wrong.z + 1.0 }; stop = 0.6; if (Math.hypot(wrong.x - P.x, wrong.z - P.z) < 2.6 && (glyphT -= 0.05) <= 0) { act('interact'); glyphT = 0.45; } }
      }
      const dropped = snap.o.find(o => o.k === 'relic' && o.carrier == null);
      if (obj && (['map', 'key', 'terminals', 'choose', 'carry'].includes(obj.id) || (obj.id === 'channel' && dropped))) {
        const k = { map: 'fragment', key: 'key', terminals: 'terminal', choose: 'altar', carry: 'relic', channel: 'relic' }[obj.id];
        let o = obj.id === 'choose' ? snap.o.find(x => x.k === 'altar' && x.choice === choice && !x.locked) || snap.o.find(x => x.k === 'altar' && x.choice === 'restore')
          : obj.id === 'terminals' ? snap.o.filter(x => x.k === 'terminal' && !x.read).sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z))[0] : near(k);
        if (o) { target = { x: o.x, z: o.z }; stop = 1.0; if (Math.hypot(o.x - P.x, o.z - P.z) < 2.4) wantUse = o; }
      }
      if ((obj?.id === 'channel' && !dropped) || (obj?.id === 'carry' && snap.o.find(o => o.k === 'relic')?.carrier != null)) { target = { x: 0, z: 528 }; stop = 0.5; }
      if (obj?.id === 'nodes') { const n = snap.o.find(o => o.k === 'node' && !o.broken); if (n) { target = { x: n.x, z: n.z + 2.2 }; stop = 0.4; } }
      if (obj?.id === 'stones') { /* the bot reads the records it was given */ }
      // Fight: boss parts, then creatures near me.
      let foe = null;
      if (snap.b && snap.b.hp > 0) {
        if (snap.b.type === 'colossus') {
          const hits = []; s.boss.hitboxes(hits);
          const plate = hits.filter(h => h.part === 'plate').sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z))[0];
          foe = snap.b.knelt > 0 ? { x: snap.b.x, z: snap.b.z, r: 2.4 } : plate || null;
          if (foe) { target = { x: foe.x + (P.x - foe.x) * 0.2, z: foe.z + (P.z - foe.z) * 0.2 }; stop = 1.2; }
        } else if (!snap.b.shield) { foe = { x: snap.b.x, z: snap.b.z, r: 1.6 }; target = { x: foe.x, z: foe.z }; stop = 1.8; }
      }
      const cr = snap.c.filter(c => c.st !== 'dead' && !c.hid && Math.hypot(c.x - P.x, c.z - P.z) < 9).sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z))[0];
      if (cr && !(foe && snap.b?.knelt > 0) && !P.carry) { foe = { x: cr.x, z: cr.z, r: 0.8 }; if (obj?.id !== 'channel') { target = { x: cr.x, z: cr.z }; stop = 1.6; } }
      // Dodge telegraphs aimed at me.
      const tels = [...snap.c.map(c => c.tel).filter(Boolean), ...(snap.b?.tels || [])];
      const danger = tels.find(t => (t.k === 'ring' || t.kind === 'ring') && Math.hypot(P.x - t.x, P.z - t.z) < t.r + 0.5);
      if (danger && P.cd.d <= 0 && P.sta > 30 && obj?.id !== 'channel') { const dx = P.x - danger.x, dz = P.z - danger.z, d = Math.hypot(dx, dz) || 1; inp.mx = dx / d; inp.mz = dz / d; real.input = { ...inp }; act('dodge'); }
      if (target) {
        const r = route(s, real, target);
        const dx = r.x - P.x, dz = r.z - P.z, d = Math.hypot(dx, dz);
        if (d > stop) { inp.mx = dx / d; inp.mz = dz / d; inp.yaw = Math.atan2(dx, dz); inp.sprint = d > 6 && !foe; }
      }
      if (foe) {
        const aim = Math.atan2(foe.x - P.x, foe.z - P.z); inp.yaw = aim;
        const reach = AVATARS[P.a].attack.kind === 'ranged' ? 30 : AVATARS[P.a].attack.range + foe.r;
        if (Math.hypot(foe.x - P.x, foe.z - P.z) < reach && P.cd.a <= 0) act('atk', aim);
        if (P.cd.q <= 0 && snap.c.filter(c => c.st !== 'dead' && Math.hypot(c.x - P.x, c.z - P.z) < 8).length >= 2) act('q', aim);
      }
      if (P.hp < P.mhp * 0.4 && P.herbs > 0) act('herb');
      if (wantUse) { if (P.hold == null && (holdT -= 0.05) <= 0) { act('interact'); holdT = 0.3; } }
      // Unstick.
      if (lastPos && Math.hypot(lastPos.x - P.x, lastPos.z - P.z) < 0.02 && Math.hypot(inp.mx, inp.mz) > 0.5) stuckT += 0.05; else stuckT = Math.max(0, stuckT - 0.05);
      if (stuckT > 1) { const ax = inp.mx; inp.mx = inp.mz * side; inp.mz = -ax * side; inp.jump = true; if (stuckT > 2.2) { stuckT = 0; side = -side; } }
      lastPos = { x: P.x, z: P.z };
    }
    s.onInput(slot, { seq: ++seq, ...inp });
    const deathsBefore = s.players().reduce((a, p) => a + p.stats.deaths, 0);
    s.tick();
    report.deaths += s.players().reduce((a, p) => a + p.stats.deaths, 0) - deathsBefore;
  }
  report.wipes = s.teamStats.wipes;
  report.minutes = +(s.t / 60).toFixed(1);
  report.endMission = s.missionIdx; report.choice = s.flags.choice;
  report.objective = s.objectives.find(o => !o.done)?.text;
  return report;
}

if (process.argv[1]?.endsWith('autoplay.js')) {
  const [diff = 'adventurer', choice = 'restore', mins = '40'] = process.argv.slice(2);
  console.log(JSON.stringify(autoplay({ difficulty: diff, choice, maxMinutes: +mins, log: true }), null, 1));
}
