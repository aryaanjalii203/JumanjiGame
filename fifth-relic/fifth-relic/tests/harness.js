// Headless test client: a real WebSocket connection speaking the same protocol as the browser client.
import WebSocket from 'ws';

export class Bot {
  constructor(port, name) {
    this.port = port; this.name = name; this.msgs = []; this.snap = null; this.events = []; this.lobby = null;
    this.seq = 0; this.aseq = 0; this.errors = [];
  }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(`ws://localhost:${this.port}/ws`);
      this.ws.on('open', res); this.ws.on('error', rej);
      this.ws.on('message', d => {
        const m = JSON.parse(d);
        if (m.type === 'snap') { this.snap = m; this.events.push(...(m.ev || [])); }
        else if (m.type === 'lobby') this.lobby = m;
        else if (m.type === 'error') this.errors.push(m.msg);
        else this.msgs.push(m);
      });
    });
  }
  send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  wait(pred, ms = 5000) {
    return new Promise((res, rej) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        let v; try { v = pred(this); } catch { v = null; }
        if (v) { clearInterval(iv); res(v); } else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error(`timeout waiting (${this.name}): ${pred}`)); }
      }, 15);
    });
  }
  msg(type, ms) { return this.wait(b => b.msgs.find(m => m.type === type), ms); }
  async hello(profileId) { this.send({ type: 'hello', name: this.name, profileId }); return this.msg('hello'); }
  me() { return this.snap?.p.find(p => p.s === this.slot); }
  input(mx, mz, extra = {}) { this.send({ type: 'input', seq: ++this.seq, mx, mz, yaw: extra.yaw ?? Math.atan2(mx, mz), ...extra }); }
  act(kind, aim = 0, extra = {}) { this.send({ type: 'act', seq: ++this.aseq, kind, aim, ...extra }); }
  close() { this.ws.terminate(); }
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
