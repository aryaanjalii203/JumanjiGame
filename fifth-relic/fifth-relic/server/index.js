// THE FIFTH RELIC — HTTP static server + authoritative WebSocket game server.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Session } from './session.js';
import { TICK_HZ } from '../shared/data.js';
import { Store } from './saves.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +process.env.PORT || 8080;
const MAX_MSG = 2048;

const MOUNTS = {
  '/shared/': path.join(ROOT, 'shared'),
  '/vendor/three/': path.join(ROOT, 'node_modules/three'),
  '/': path.join(ROOT, 'client'),
};
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

export function createServer({ port = PORT, dataFile = process.env.FR_DATA || path.join(ROOT, 'data/saves.json'), quiet = false } = {}) {
  const store = new Store(dataFile);
  const sessions = new Map();
  const log = (...a) => { if (!quiet) console.log(new Date().toISOString().slice(11, 19), ...a); };
  const metrics = { msgsIn: 0, bytesOut: 0, dropped: 0 };

  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    // Developer-only shortcut (FR_DEBUG=1): jump a session to a mission for testing/screenshots. Never enabled by default.
    if (process.env.FR_DEBUG === '1' && url === '/debug/warp') {
      const q = new URLSearchParams((req.url || '').split('?')[1]);
      const s = sessions.get((q.get('code') || '').toUpperCase());
      if (s && s.phase === 'game') { const m = +q.get('mission'); if (m >= 1 && m <= 6) { if (m >= 4) { s.dyn.bridge = true; s.dyn.open.add('gateA'); s.dyn.open.add('gateB'); } else if (m >= 3) s.dyn.bridge = true; s.beginMission(m, { retry: true }); } res.end('ok'); }
      else res.end('no session');
      return;
    }
    if (url === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, sessions: sessions.size, ...metrics })); return; }
    const mount = Object.keys(MOUNTS).find(m => url.startsWith(m));
    const base = MOUNTS[mount];
    let file = path.normalize(path.join(base, url.slice(mount.length) || 'index.html'));
    if (!file.startsWith(base)) { res.writeHead(403); res.end(); return; }   // path traversal guard
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(buf);
    });
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MSG });

  function makeSession(code, opts) {
    const io = {
      send(slot, msg) { for (const c of wss.clients) if (c.ctx?.session === s && c.ctx.slot === slot && c.readyState === 1) out(c, msg); },
      broadcast(msg) { const str = JSON.stringify(msg); for (const c of wss.clients) if (c.ctx?.session === s && c.readyState === 1) { c.send(str); metrics.bytesOut += str.length; } },
      persist(sess) { store.saveSession(sess); },
      persistProfiles() { store.flush(); },
    };
    const s = new Session(code, opts, io);
    if (opts.save) {
      s.dyn.bridge = !!opts.save.bridge; s.dyn.log = !!opts.save.log;
      for (const id of opts.save.open || []) s.dyn.open.add(id);
    }
    sessions.set(code, s);
    return s;
  }

  function newCode() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let c;
    do { c = Array.from(crypto.randomBytes(6), b => A[b % A.length]).join(''); } while (sessions.has(c) || store.data.sessions[c]);
    return c;
  }

  function out(ws, msg) { const str = JSON.stringify(msg); ws.send(str); metrics.bytesOut += str.length; }

  wss.on('connection', (ws) => {
    ws.ctx = { session: null, slot: -1, profile: null, budget: 120, strikes: 0 };
    ws.on('message', (raw) => {
      metrics.msgsIn++;
      const ctx = ws.ctx;
      // Token-bucket rate limit: refilled in the tick loop. Excess is dropped; persistent flooding disconnects.
      if (ctx.budget <= 0) { metrics.dropped++; if (++ctx.strikes > 600) ws.close(1008, 'rate limit'); return; }
      ctx.budget--;
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (!m || typeof m.type !== 'string') return;
      const s = ctx.session;
      try {
        switch (m.type) {
          case 'hello': {
            const pid = /^[a-zA-Z0-9-]{8,64}$/.test(m.profileId || '') ? m.profileId : crypto.randomUUID();
            ctx.profile = store.profile(pid, String(m.name || 'Bearer').slice(0, 16));
            ctx.name = String(m.name || ctx.profile.name || 'Bearer').replace(/[<>]/g, '').slice(0, 16);
            out(ws, { type: 'hello', profileId: pid, profile: ctx.profile, saves: store.listSaves() });
            break;
          }
          case 'create': case 'join': {
            if (!ctx.profile || s) return;
            let sess;
            if (m.type === 'create') sess = makeSession(newCode(), { difficulty: m.difficulty });
            else {
              const code = String(m.code || '').toUpperCase().trim();
              sess = sessions.get(code);
              if (!sess && store.data.sessions[code]) sess = makeSession(code, { difficulty: store.data.sessions[code].difficulty, save: store.data.sessions[code] });
              if (!sess) { out(ws, { type: 'error', msg: `No session with code ${code}.` }); return; }
            }
            const r = sess.addHuman({ name: ctx.name, profileId: ctx.profile.id, profile: ctx.profile });
            if (r.error) { out(ws, { type: 'error', msg: r.error }); return; }
            ctx.session = sess; ctx.slot = r.slot;
            out(ws, { type: 'welcome', code: sess.code, slot: r.slot, token: r.token, phase: sess.phase });
            log(`${ctx.name} -> ${sess.code} slot ${r.slot}`);
            if (sess.phase === 'game') out(ws, { type: 'started' });
            break;
          }
          case 'resume': {
            if (s) return;
            const sess = sessions.get(String(m.code || '').toUpperCase());
            const slot = sess?.reconnect(String(m.token || ''));
            if (slot == null) { out(ws, { type: 'resumeFailed' }); return; }
            for (const c of wss.clients) if (c !== ws && c.ctx?.session === sess && c.ctx.slot === slot) { c.ctx.session = null; c.close(4000, 'replaced'); }
            ctx.session = sess; ctx.slot = slot;
            out(ws, { type: 'welcome', code: sess.code, slot, token: m.token, phase: sess.phase, resumed: true });
            if (sess.phase === 'game') out(ws, { type: 'started' });
            if (sess.ending) out(ws, { type: 'ending', ...sess.ending });
            log(`slot ${slot} resumed ${sess.code}`);
            break;
          }
          case 'avatar': if (s) { const e = s.setAvatar(ctx.slot, m.avatar, m.outfit, m.build); if (e) out(ws, { type: 'error', msg: e }); } break;
          case 'ready': s?.setReady(ctx.slot, m.v); break;
          case 'difficulty': if (s && s.phase === 'lobby' && ctx.slot === s.hostSlot && ['story', 'adventurer', 'relentless'].includes(m.v)) { s.difficulty = m.v; s.lobbyChanged(); } break;
          case 'start': if (s) { const e = s.start(ctx.slot); if (e) out(ws, { type: 'error', msg: e }); } break;
          case 'input': s?.onInput(ctx.slot, m); break;
          case 'act': s?.onAction(ctx.slot, m); break;
          case 'skip': s?.voteSkip(ctx.slot); break;
          case 'chat': {
            const p = s?.slots[ctx.slot]; if (!p || s.t - p.chatT < 0.4) return;
            p.chatT = s.t;
            const text = String(m.text || '').replace(/[<>]/g, '').slice(0, 200).trim();
            if (text) s.event('chat', { from: p.name, slot: p.slot, text });
            if (s.phase === 'lobby') s.io.broadcast({ type: 'snapEv', ev: [{ type: 'chat', from: p.name, text }] });
            break;
          }
          case 'ping': {
            const p = s?.slots[ctx.slot]; if (!p || s.t - p.pingT < 0.8 || !Number.isFinite(+m.x) || !Number.isFinite(+m.z)) return;
            p.pingT = s.t;
            s.event('ping', { slot: p.slot, x: +(+m.x).toFixed(1), z: +(+m.z).toFixed(1), kind: m.kind === 'danger' ? 'danger' : 'go' });
            break;
          }
          case 'leave': if (s) { s.disconnect(ctx.slot); ctx.session = null; } break;
          default: break;
        }
      } catch (err) { log('handler error', err); }
    });
    ws.on('close', () => { if (ws.ctx.session) ws.ctx.session.disconnect(ws.ctx.slot); });
  });

  const interval = setInterval(() => {
    for (const c of wss.clients) if (c.ctx) c.ctx.budget = Math.min(120, c.ctx.budget + 60 / TICK_HZ * 1.5);
    for (const [code, s] of sessions) {
      try { s.tick(); } catch (err) { log('tick error', code, err); }
      const live = [...wss.clients].some(c => c.ctx?.session === s);
      if (!live) { s.idle = (s.idle || 0) + 1 / TICK_HZ; if (s.idle > 600) { sessions.delete(code); log('session closed', code); } } else s.idle = 0;
    }
  }, 1000 / TICK_HZ);

  return new Promise(resolve => {
    server.listen(port, () => {
      log(`THE FIFTH RELIC server on http://localhost:${server.address().port}`);
      resolve({
        port: server.address().port, sessions, store, metrics,
        close: () => new Promise(r => { clearInterval(interval); for (const c of wss.clients) c.terminate(); wss.close(); server.close(() => { store.flush(); r(); }); }),
      });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) createServer();
