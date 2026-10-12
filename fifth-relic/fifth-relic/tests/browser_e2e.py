"""Real-browser acceptance test: five separate clients in one session.

Browsers play through the actual UI (menu, lobby, avatar tabs, ready, start, cutscenes, movement, chat,
reconnect). The remaining seats are filled by protocol-level clients (tests/e2e_bots.mjs) — separate
WebSocket connections speaking the same protocol. Set N_BROWSERS=5 on a machine with a real GPU to run
five browsers; software-rendered WebGL on a small VM can't sustain five.

Run:  python3 tests/browser_e2e.py
Needs: pip install playwright && python3 -m playwright install chromium
"""
import json, os, socket, subprocess, sys, tempfile, threading, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
N_BROWSERS = int(os.environ.get('N_BROWSERS', '2'))
SHOTS = os.environ.get('SHOTS', os.path.join(ROOT, 'tests', 'shots'))
os.makedirs(SHOTS, exist_ok=True)
AV = ['titan', 'wraith', 'circuit', 'oracle', 'phantom']
results = []

def free_port():
    with socket.socket() as so:
        so.bind(('127.0.0.1', 0)); return so.getsockname()[1]

def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  ({detail})' if detail else ''), flush=True)

PORT = free_port()
URL = f'http://localhost:{PORT}/'
env = dict(os.environ, PORT=str(PORT), FR_DATA=os.path.join(tempfile.mkdtemp(), 'saves.json'))
server = subprocess.Popen(['node', 'server/index.js'], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
bots_proc, bot_lines = None, []
time.sleep(1.2)

def state(pg, expr):
    return pg.evaluate(f'(() => {{ const S = window.__fr.state; return {expr}; }})()')

try:
    with sync_playwright() as p:
        pages, errors, browsers = [], [], []
        try:
            for i in range(N_BROWSERS):
                browser = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
                browsers.append(browser)
                ctx = browser.new_context(viewport={'width': 800, 'height': 450})
                ctx.add_init_script("localStorage.setItem('fr.settings', JSON.stringify({shadows:false, voice:false}))")
                pg = ctx.new_page(); pg.set_default_timeout(120000)
                pg.on('pageerror', lambda e, i=i: errors.append(f'browser{i+1}: {e}'))
                pg.goto(URL, wait_until='domcontentloaded')
                pages.append(pg)
            time.sleep(2)
            for i, pg in enumerate(pages):
                pg.keyboard.press('a'); time.sleep(0.4); pg.click('#skipPrologue'); time.sleep(0.5); pg.keyboard.press('a'); time.sleep(0.5)
                pg.fill('#nameInput', f'Browser{i+1}')
            pages[0].click('#btnCreate'); pages[0].wait_for_selector('#lobby:not(.hidden)')
            code = pages[0].inner_text('#lobbyCode').strip()
            check('host created a session through the menu', len(code) == 6, code)
            for pg in pages[1:]:
                pg.fill('#codeInput', code); pg.click('#btnJoin'); pg.wait_for_selector('#lobby:not(.hidden)')
            for i, pg in enumerate(pages):
                pg.click(f'#avatarTabs button:nth-child({i+1})', force=True); time.sleep(0.6)
            bots_proc = subprocess.Popen(['node', 'tests/e2e_bots.mjs', str(PORT), code, ','.join(AV[N_BROWSERS:])], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            threading.Thread(target=lambda: [bot_lines.append(l.strip()) for l in bots_proc.stdout], daemon=True).start()
            pages[0].wait_for_function("window.__fr.state.lobby && window.__fr.state.lobby.slots.filter(s => s && s.human).length === 5")
            check('five separate clients in one lobby', True, f'{N_BROWSERS} browsers + {5 - N_BROWSERS} protocol clients')
            avs = state(pages[-1], 'S.lobby.slots.map(s => s.avatar)')
            check('every client holds a distinct avatar (chosen in the lobby UI)', sorted(avs) == sorted(AV), str(avs))
            for pg in pages[1:]: pg.click('#btnReady', force=True); time.sleep(0.3)   # the host's Begin button counts as ready
            pages[0].wait_for_function("window.__fr.state.lobby.slots.every(s => s && (s.ready || s.slot === window.__fr.state.lobby.host))")
            pages[0].wait_for_function("!document.getElementById('btnStart').disabled")
            pages[0].click('#btnStart', force=True)
            for pg in pages: pg.wait_for_function("window.__fr.state.screen === 'game'")
            check('all browsers entered the game after the host started', True)
            for pg in pages: pg.wait_for_function("window.__fr.state.cut || (window.__fr.state.last && window.__fr.state.last.cut)")
            cuts = [state(pg, 'S.cut || (S.last && S.last.cut && S.last.cut.id)') for pg in pages]
            check('opening cutscene is synchronised across browsers', len(set(cuts)) == 1 and cuts[0] is not None, str(cuts))
            pages[0].screenshot(path=os.path.join(SHOTS, 'e2e_cutscene.png'))
            for pg in pages: pg.wait_for_function("window.__fr.state.last && !window.__fr.state.last.cut", timeout=240000)
            time.sleep(1)
            pages[0].screenshot(path=os.path.join(SHOTS, 'e2e_in_game.png'))
            before = state(pages[0], 'S.last.p.map(p => [p.s, p.x, p.z])')
            for pg in pages: pg.keyboard.down('KeyW')
            time.sleep(4)
            for pg in pages: pg.keyboard.up('KeyW')
            time.sleep(1.5)
            after = state(pages[-1], 'S.last.p.map(p => [p.s, p.x, p.z])')
            moved = [s for (s, x0, z0), (_, x1, z1) in zip(before, after) if ((x1 - x0) ** 2 + (z1 - z0) ** 2) ** 0.5 > 2]
            check('movement of all five clients is visible in another browser', len(moved) == 5, f'moved slots {moved}')
            views = [state(pg, 'JSON.stringify(S.last.p.map(p => [p.s, p.a, p.l, p.n]))') for pg in pages]
            check('browsers agree on players, avatars and lives', len(set(views)) == 1, views[0])
            pages[-1].keyboard.press('Enter'); pages[-1].keyboard.type('hello from the browser'); pages[-1].keyboard.press('Enter')
            time.sleep(2)
            got = [('hello from the browser' in pg.inner_text('#chatLog')) for pg in pages]
            check('chat typed in a browser reaches every browser', all(got), str(got))
            check('chat from a protocol client reaches the browsers', all('bot says hi' in pg.inner_text('#chatLog') for pg in pages))
            slot = state(pages[-1], 'S.slot')
            # Watch every snapshot in browser 1 so a brief drop is not missed between polls.
            pages[0].evaluate(f"window.__sawDrop = false; window.__fr.net.on('snap', m => {{ const q = m.p.find(p => p.s === {slot}); if (q && q.c === false) window.__sawDrop = true; }})")
            pages[-1].evaluate("window.__fr.net.ws.close()")
            pages[0].wait_for_function("window.__sawDrop === true", timeout=60000)
            pages[0].wait_for_function(f"window.__fr.state.last.p.find(p => p.s === {slot}).c === true", timeout=60000)
            check('a dropped browser auto-reconnects into the same slot; others see it drop and return', state(pages[-1], 'S.slot') == slot, f'slot {slot}')
            seen_by_bot = any(f'Browser{N_BROWSERS}' in l for l in bot_lines if l.startswith('BOTS_VIEW'))
            check('protocol clients see the browser players in their snapshots', seen_by_bot)
            for i, pg in enumerate(pages): pg.screenshot(path=os.path.join(SHOTS, f'e2e_browser{i+1}.png'))
            check('no uncaught page errors', not errors, '; '.join(errors[:3]))
        except Exception as ex:
            print('EXCEPTION', str(ex).splitlines()[0], flush=True)
            for i, pg in enumerate(pages):
                try: print(f'browser{i+1}', state(pg, "JSON.stringify({screen: S.screen, cut: S.cut, slot: S.slot, open: window.__fr.net.open})"), flush=True)
                except Exception as e2: print('diag failed', e2)
            results.append(('no exception', False, str(ex).splitlines()[0]))
        for b in browsers: b.close()
finally:
    if bots_proc: bots_proc.kill()
    server.kill(); server.wait()
ok = all(r[1] for r in results)
print(json.dumps({'passed': sum(r[1] for r in results), 'failed': sum(not r[1] for r in results)}))
sys.exit(0 if ok else 1)
