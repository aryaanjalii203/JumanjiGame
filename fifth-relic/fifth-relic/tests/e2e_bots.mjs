// Protocol-level clients used by browser_e2e.py to fill the remaining seats.
// Usage: node tests/e2e_bots.mjs <port> <code> <avatar,avatar,...>
import { Bot, sleep } from './harness.js';

const [port, code, avs] = process.argv.slice(2);
const avatars = avs.split(',');
const bots = [];
for (const [i, a] of avatars.entries()) {
  const b = new Bot(+port, `Bot${i + 1}`); await b.connect(); await b.hello(`e2e-bot-${i}-xxxxxxxx`);
  b.send({ type: 'join', code }); b.slot = (await b.msg('welcome')).slot;
  b.send({ type: 'avatar', avatar: a }); await sleep(200); b.send({ type: 'ready', v: true });
  bots.push(b);
}
console.log('BOTS_READY', bots.map(b => b.slot).join(','));
await Promise.all(bots.map(b => b.wait(x => x.snap, 600000)));
await Promise.all(bots.map(b => b.wait(x => x.snap && !x.snap.cut, 600000)));
console.log('BOTS_IN_GAME');
// Walk forward for a few seconds, then say hello.
for (let k = 0; k < 80; k++) { for (const b of bots) b.input(0, 1); await sleep(50); }
bots[0].send({ type: 'chat', text: 'bot says hi' });
console.log('BOTS_MOVED', JSON.stringify(bots.map(b => { const m = b.me(); return [m.s, m.x, m.z]; })));
// Report what the bots see of the browser players, then idle until killed.
setInterval(() => console.log('BOTS_VIEW', JSON.stringify(bots[0].snap.p.map(p => [p.s, p.n, p.x, p.z, p.c]))), 2000);
