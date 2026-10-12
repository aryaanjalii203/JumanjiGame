// WebSocket client with automatic session recovery (reconnect token kept in sessionStorage).
export class Net {
  constructor() { this.handlers = {}; this.queue = []; this.wantOpen = false; this.retry = 0; }
  on(type, fn) { (this.handlers[type] ||= []).push(fn); }
  emit(type, m) { for (const f of this.handlers[type] || []) f(m); }
  connect() {
    this.wantOpen = true;
    if (this.ws && this.ws.readyState <= 1 && this.pending) return this.pending;   // already open or opening
    this.pending = new Promise((res) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws = ws;
      ws.onopen = () => { this.retry = 0; this.emit('open'); for (const m of this.queue) ws.send(JSON.stringify(m)); this.queue = []; res(); };
      ws.onmessage = (e) => { const m = JSON.parse(e.data); this.emit(m.type, m); this.emit('*', m); };
      ws.onclose = (e) => {
        if (this.ws !== ws) return;
        this.pending = null;
        this.emit('close', e);
        if (this.wantOpen && e.code !== 4000) { this.retry++; setTimeout(() => this.connect(), Math.min(4000, 500 * this.retry)); }
      };
      ws.onerror = () => {};
    });
    return this.pending;
  }
  send(m) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m)); else if (m.type !== 'input') this.queue.push(m); }
  get open() { return this.ws?.readyState === 1; }
}
