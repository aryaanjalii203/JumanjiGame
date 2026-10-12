// JSON-file persistence: session checkpoints (mission start + records) and player profiles (unlocks, one-time rewards).
import fs from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(file) {
    this.file = file;
    this.data = { sessions: {}, profiles: {} };
    try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* fresh store */ }
    this.data.sessions ||= {}; this.data.profiles ||= {};
    this.timer = null;
  }
  profile(id, name) {
    const p = this.data.profiles[id] ||= { id, name, outfits: [], completed: [], seen: [], endings: [], xp: 0 };
    if (name) p.name = name;
    return p;
  }
  saveSession(s) {
    // Checkpoints are written only at mission boundaries and record pickups — never mid-objective (prevents checkpoint farming).
    this.data.sessions[s.code] = {
      missionIdx: s.phase === 'ended' ? 1 : s.missionIdx, records: [...s.flags.records], seed: s.seed, difficulty: s.difficulty,
      bridge: s.dyn.bridge, log: s.dyn.log, open: [...s.dyn.open].filter(id => id === 'cracked' || id === 'gateA' || id === 'gateB'),
      finished: s.phase === 'ended' ? s.flags.choice : null, updated: Date.now(),
    };
    this.schedule();
  }
  listSaves() {
    return Object.entries(this.data.sessions).sort((a, b) => b[1].updated - a[1].updated).slice(0, 5)
      .map(([code, v]) => ({ code, mission: v.missionIdx, difficulty: v.difficulty, updated: v.updated, finished: v.finished }));
  }
  schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 300); }
  flush() {
    clearTimeout(this.timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (e) { console.error('save failed', e.message); }
  }
}
