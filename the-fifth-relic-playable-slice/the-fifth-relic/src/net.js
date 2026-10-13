import { io } from 'socket.io-client';

const SERVER = import.meta.env.VITE_GAME_SERVER || 'http://localhost:3001';
export function createNetwork(onState, onMessage) {
  const socket = io(SERVER, { autoConnect: false, transports: ['websocket','polling'] });
  socket.on('connect', () => { window.__relicSocketId = socket.id; onMessage(`ONLINE · ${socket.id.slice(0,6)}`); });
  socket.on('disconnect', () => onMessage('OFFLINE · LOCAL PLAY CONTINUES'));
  socket.on('room-state', onState);
  socket.on('player-joined', p => onMessage(`${p.name} entered the wilds`));
  socket.on('system-message', onMessage);
  return {
    connect(room, avatar) {
      if (!socket.connected) socket.connect();
      socket.once('connect', () => socket.emit('join-room', { room, avatar, name: avatar }));
      if (socket.connected) socket.emit('join-room', { room, avatar, name: avatar });
    },
    sendPosition(position, rotation, health, lives, avatar) {
      if (socket.connected) socket.emit('player-update', { position, rotation, health, lives, avatar });
    },
    sendObjective(objective) { if (socket.connected) socket.emit('objective-update', objective); },
    disconnect() { socket.disconnect(); },
    get connected() { return socket.connected; }
  };
}
