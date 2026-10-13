import { createServer } from 'node:http';
import { Server } from 'socket.io';

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: process.env.CLIENT_ORIGIN?.split(',') || ['http://localhost:5173'], methods: ['GET','POST'] }
});
const rooms = new Map();
function getRoom(code) {
  if (!rooms.has(code)) rooms.set(code, { players: {}, objective: { glyphs: [false,false,false], bossHealth: 100, complete: false } });
  return rooms.get(code);
}
io.on('connection', socket => {
  socket.on('join-room', ({ room='WILDS5', avatar='TITAN', name='Explorer' } = {}) => {
    const code = String(room).toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,12) || 'WILDS5';
    const state = getRoom(code);
    if (Object.keys(state.players).length >= 5 && !state.players[socket.id]) {
      socket.emit('system-message', 'ROOM FULL · FIVE PLAYER SLOTS');
      return;
    }
    socket.data.room = code;
    socket.join(code);
    state.players[socket.id] = { id: socket.id, name: String(name).slice(0,24), avatar, position: {x:0,y:0,z:0}, rotation:0, health:100, lives:3 };
    socket.emit('room-state', state);
    socket.to(code).emit('player-joined', state.players[socket.id]);
    io.to(code).emit('room-state', state);
  });
  socket.on('player-update', data => {
    const code = socket.data.room; if (!code) return;
    const state = getRoom(code); const p = state.players[socket.id]; if (!p) return;
    // Basic sanity limits only; production must add server-authoritative physics and rate limiting.
    const pos = data?.position || {};
    if ([pos.x,pos.y,pos.z].every(n => Number.isFinite(n) && Math.abs(n) < 10000)) {
      p.position = { x: pos.x, y: pos.y, z: pos.z };
      p.rotation = Number.isFinite(data.rotation) ? data.rotation : 0;
      p.health = Math.max(0, Math.min(100, Number(data.health) || 0));
      p.lives = Math.max(0, Math.min(3, Number(data.lives) || 0));
      if (typeof data.avatar === 'string') p.avatar = data.avatar.slice(0,24);
      socket.to(code).emit('room-state', state);
    }
  });
  socket.on('objective-update', data => {
    const code = socket.data.room; if (!code) return;
    const state = getRoom(code); if (!state) return;
    // Prototype: objective values are synchronized but not trusted for production rewards.
    if (Array.isArray(data?.glyphs) && data.glyphs.length === 3) state.objective.glyphs = data.glyphs.map(Boolean);
    if (Number.isFinite(data?.bossHealth)) state.objective.bossHealth = Math.max(0, Math.min(100, data.bossHealth));
    if (typeof data?.complete === 'boolean') state.objective.complete = data.complete;
    io.to(code).emit('room-state', state);
  });
  socket.on('disconnect', () => {
    const code = socket.data.room; if (!code) return;
    const state = getRoom(code); delete state.players[socket.id];
    io.to(code).emit('room-state', state);
  });
});
const port = Number(process.env.PORT || 3001);
httpServer.listen(port, '0.0.0.0', () => console.log(`The Fifth Relic multiplayer server listening on ${port}`));
