// THE FIFTH RELIC — client entry: screens, input, prediction, camera, HUD, cutscenes.
import * as THREE from 'three';
import { World3D, glyphTexture } from './render.js';
import { Audio } from './audio.js';
import { Net } from './net.js';
import { AVATARS, AVATAR_IDS, OUTFITS, CREATURES, GLYPHS, DIFFICULTY } from '/shared/data.js';
import { stepMove, groundHeight, regionAt, POINTS, ARENA, HEART, RAVINE, WORLD, CHECKPOINTS } from '/shared/world.js';
import { CUTSCENES, MISSION_TEXT, TUTORIAL, RECORDS, ENDINGS } from '/shared/story.js';

const $ = (id) => document.getElementById(id);
const show = (el, v = true) => (typeof el === 'string' ? $(el) : el).classList.toggle('hidden', !v);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lerp = (a, b, k) => a + (b - a) * k;

// ------------------------------------------------------------------ settings
const DEFAULTS = { vol: 0.8, music: 0.55, sens: 1, invert: false, voice: true, subs: true, subSize: 1, shake: true, shadows: true, contrast: false };
const settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('fr.settings') || '{}') };
const saveSettings = () => localStorage.setItem('fr.settings', JSON.stringify(settings));
document.documentElement.style.setProperty('--sub-scale', settings.subSize);

const world = new World3D($('view'), settings);
const audio = new Audio(settings);
const net = new Net();
window.__fr = { world, net, get state() { return S; } };   // debug/test hook

// ------------------------------------------------------------------ client state
const S = {
  screen: 'title', profileId: localStorage.getItem('fr.profile') || null, profile: null,
  code: null, slot: -1, token: null, lobby: null, phase: 'none',
  snaps: [], last: null, me: null, camYaw: 0, camPitch: 0.25, keys: new Set(), seq: 0, aseq: 0,
  jumpPulse: false, lastAtk: 0, mouseDown: false, journal: { records: [], logs: [], notes: new Set() },
  cut: null, cutStart: 0, cutSkippable: false, ending: null, selAvatar: 'titan', subtitleT: 0, toastT: 0,
  tutorialT: 0, interacting: false, spectate: 0, hurtFlash: 0, shake: 0, lastHp: null, lastState: null, chatOpen: false,
};

// ------------------------------------------------------------------ title + prologue
let prologue = null;
const relicProp = new THREE.Group();
{
  const dev = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.75), new THREE.MeshStandardMaterial({ color: 0x3a3048, metalness: 0.5, emissive: 0x2a1a50 }));
  relicProp.add(dev);
  relicProp.userData.lights = [0, 1, 2, 3, 4].map(i => { const l = new THREE.Mesh(new THREE.SphereGeometry(0.035), new THREE.MeshBasicMaterial({ color: 0x223a30 })); l.position.set(-0.16 + i * 0.08, 0.1, 0.26); relicProp.add(l); return l; });
  const pl = new THREE.PointLight(0x7ff0c4, 0, 6); pl.position.y = 0.6; relicProp.add(pl); relicProp.userData.pl = pl;
  relicProp.position.set(10.5, 2.35, 2.5); world.scene.add(relicProp);
}
function startPrologue() {
  audio.start();
  prologue = { t: 0, dur: CUTSCENES.prologue.dur, shown: new Set() };
  show('pressKey', false); show('titleMark', false);
}
function endPrologue() {
  prologue = null;
  show('titleMark', true); show('pressKey', true); $('pressKey').textContent = 'Press any key';
  S.screen = 'titleDone';
  $('subtitle').textContent = '';
  relicProp.userData.lights[4].material.color.setHex(0x7ff0c4); relicProp.userData.pl.intensity = 8;
}
function prologueCamera(t) {
  // Storm over the settlement → through the station → the device → pull out to the jungle.
  const keys = [
    [0, [-30, 18, -30], [0, 2, 20]], [6, [-20, 6, -10], [-10, 2, 1]], [11, [-16, 2.4, 0], [-6, 2, 2]],
    [17, [2, 2.2, 1], [10.5, 2.3, 2.5]], [24, [9.2, 2.9, 1.2], [10.5, 2.35, 2.5]], [29, [9.6, 2.6, 1.8], [10.5, 2.35, 2.5]], [34, [0, 14, -20], [0, 4, 60]],
  ];
  let i = 0; while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const [t0, p0, l0] = keys[i], [t1, p1, l1] = keys[i + 1];
  const k = Math.min(1, Math.max(0, (t - t0) / (t1 - t0))), e = k * k * (3 - 2 * k);
  world.camera.position.set(lerp(p0[0], p1[0], e), lerp(p0[1], p1[1], e), lerp(p0[2], p1[2], e));
  world.camera.lookAt(lerp(l0[0], l1[0], e), lerp(l0[1], l1[1], e), lerp(l0[2], l1[2], e));
}
function idleCamera(t) {
  world.camera.position.set(Math.sin(t * 0.05) * 30, 16, -18 + Math.cos(t * 0.05) * 8);
  world.camera.lookAt(0, 4, 60);
}

function subtitle(speaker, text, secs = 5) {
  if (!settings.subs && speaker) { audio.speak(speaker, text); return; }
  const el = S.cut || prologue ? $('cutSub') : $('subtitle');
  el.innerHTML = speaker ? `<b class="${speaker}">${speaker === 'TEAM' ? 'Your team' : speaker === 'LOG' ? 'Recording' : speaker === 'STEWARD' ? 'The Steward' : speaker === 'CURATOR' ? 'The Curator' : speaker}</b> ${esc(text)}` : `<i>${esc(text)}</i>`;
  if (prologue) $('subtitle').innerHTML = el.innerHTML;
  S.subtitleT = secs; S.subEl = el;
  if (speaker) { audio.speak(speaker, text); audio.play(speaker === 'CURATOR' ? 'curator' : 'steward', { vol: 0.6 }); }
}

// ------------------------------------------------------------------ menu
$('nameInput').value = localStorage.getItem('fr.name') || '';
function menuError(m) { $('menuError').textContent = m || ''; }
async function ensureHello() {
  if (!net.open) await net.connect();
  const name = ($('nameInput').value.trim() || 'Bearer').slice(0, 16);
  localStorage.setItem('fr.name', name);
  net.send({ type: 'hello', name, profileId: S.profileId });
}
function goMenu() {
  S.screen = 'menu'; show('title', false); show('menu'); show('lobby', false); show('hud', false); show('ending', false);
  $('codeInput').value = ''; menuError('');
  ensureHello();
}
$('btnCreate').onclick = async () => {
  audio.play('ui');
  const room = $('roomInput').value.trim().toUpperCase();
  if (room && !/^[A-Z0-9]{4,8}$/.test(room)) { menuError('Room codes are 4 to 8 letters or numbers, with no spaces.'); return; }
  await ensureHello(); net.send({ type: 'create', difficulty: $('diffSelect').value, code: room || undefined, seats: +$('seatsSelect').value });
  localStorage.setItem('fr.seats', $('seatsSelect').value);
};
if (localStorage.getItem('fr.seats')) $('seatsSelect').value = localStorage.getItem('fr.seats');
$('roomInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnCreate').click(); });
$('btnJoin').onclick = async () => {
  audio.play('ui');
  const code = $('codeInput').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(code)) { menuError('Type the room code your host shared, 4 to 8 letters or numbers.'); return; }
  await ensureHello(); net.send({ type: 'join', code });
};
$('codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnJoin').click(); });
$('btnPrologue').onclick = () => { show('menu', false); show('title'); S.screen = 'title'; startPrologue(); };
$('skipPrologue').onclick = () => { if (prologue) endPrologue(); else goMenu(); };
$('btnSettings').onclick = $('btnPSettings').onclick = () => openSettings();
$('btnControls').onclick = $('btnPControls').onclick = () => show('controls');
document.querySelectorAll('.overlay .close').forEach(b => b.onclick = () => { b.closest('.overlay').classList.add('hidden'); });

function openSettings() {
  show('settings');
  const bind = (id, key, prop = 'value', conv = v => v) => { const el = $(id); el[prop] = settings[key]; el.oninput = el.onchange = () => { settings[key] = conv(el[prop]); saveSettings(); audio.applyVolumes(); document.documentElement.style.setProperty('--sub-scale', settings.subSize); }; };
  bind('setVol', 'vol', 'value', Number); bind('setMusic', 'music', 'value', Number); bind('setSens', 'sens', 'value', Number);
  bind('setInvert', 'invert', 'checked'); bind('setVoice', 'voice', 'checked'); bind('setSubs', 'subs', 'checked');
  bind('setSubSize', 'subSize', 'value', Number); bind('setShake', 'shake', 'checked'); bind('setShadows', 'shadows', 'checked'); bind('setContrast', 'contrast', 'checked');
}

// ------------------------------------------------------------------ network handlers
net.on('hello', m => {
  S.profileId = m.profileId; S.profile = m.profile; localStorage.setItem('fr.profile', m.profileId);
  const box = $('saves'); box.innerHTML = '';
  // Offer to resume an interrupted session from this browser first.
  const resume = JSON.parse(sessionStorage.getItem('fr.resume') || 'null');
  if (resume && S.phase === 'none' && !S.triedResume) { S.triedResume = true; net.send({ type: 'resume', code: resume.code, token: resume.token }); }
  if (m.saves?.length) {
    const p = document.createElement('p'); p.className = 'muted small'; p.textContent = 'Continue an expedition saved on this server'; box.append(p);
    for (const s of m.saves) {
      const b = document.createElement('button');
      b.textContent = s.finished ? `${s.code}: finished (${s.finished}), start again` : `${s.code}: ${MISSION_TEXT[s.mission]?.title || 'Mission ' + s.mission}, ${DIFFICULTY[s.difficulty]?.name || ''}`;
      b.onclick = () => { $('codeInput').value = s.code; $('btnJoin').click(); };
      box.append(b);
    }
  }
});
net.on('resumeFailed', () => { sessionStorage.removeItem('fr.resume'); });
net.on('welcome', m => {
  S.code = m.code; S.slot = m.slot; S.token = m.token;
  sessionStorage.setItem('fr.resume', JSON.stringify({ code: m.code, token: m.token }));
  show('netStatus', false);
  if (m.phase === 'lobby') enterLobby();
  // Apply this player's body choice as soon as they have a seat.
  setTimeout(() => { const me = S.lobby?.slots[S.slot]; if (me) net.send({ type: 'avatar', avatar: me.avatar, outfit: me.outfit, build: myBuild() }); }, 300);
});
function myBuild() { return localStorage.getItem('fr.build') || 'f'; }
net.on('error', m => { if (S.screen === 'lobby') $('lobbyError').textContent = m.msg; else if (S.screen === 'game') toast(m.msg, 2.5); else menuError(m.msg); });
net.on('lobby', m => { S.lobby = m; if (S.screen === 'lobby') renderLobby(); });
net.on('started', () => enterGame());
net.on('snap', m => onSnap(m));
net.on('snapEv', m => { for (const e of m.ev) handleEvent(e); });
net.on('reward', m => toast(m.text, 3));
net.on('ending', m => startEnding(m));
net.on('close', () => { if (S.code && S.screen !== 'menu') { $('netStatus').textContent = 'Connection lost. Reconnecting, your AI companion is covering for you.'; show('netStatus'); } });
net.on('open', () => {
  if (S.code && S.token && S.screen !== 'menu' && S.screen !== 'title') {
    net.send({ type: 'hello', name: $('nameInput').value || 'Bearer', profileId: S.profileId });
    net.send({ type: 'resume', code: S.code, token: S.token });
  }
});

// ------------------------------------------------------------------ lobby
const preview = { renderer: null, scene: null, cam: null, model: null, t: 0 };
function setupPreview() {
  if (preview.renderer) return;
  const cv = $('preview');
  preview.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
  preview.scene = new THREE.Scene();
  preview.cam = new THREE.PerspectiveCamera(35, 1, 0.1, 50); preview.cam.position.set(0, 2.2, 9.5); preview.cam.lookAt(0, 1.5, 0);
  preview.scene.add(new THREE.HemisphereLight(0xcff5e2, 0x1a2a20, 1.4));
  const d = new THREE.DirectionalLight(0xffe2b0, 2); d.position.set(3, 5, 4); preview.scene.add(d);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 0.2, 24), new THREE.MeshStandardMaterial({ color: 0x2c4a3a, flatShading: true })); disc.position.y = -0.1; preview.scene.add(disc);
}
function previewAvatar(id, outfit, build) {
  setupPreview();
  if (preview.model) preview.scene.remove(preview.model);
  preview.model = world.makeAvatar(id, outfit, build); preview.scene.add(preview.model);
}
function enterLobby() {
  S.screen = 'lobby'; show('menu', false); show('title', false); show('lobby'); show('hud', false);
  $('lobbyError').textContent = '';
  renderLobby();
}
function renderLobby() {
  const L = S.lobby; if (!L) return;
  $('lobbyCode').textContent = L.code;
  $('lobbyDiff').textContent = `Difficulty: ${DIFFICULTY[L.difficulty].name}${L.loaded ? `. Continuing from ${MISSION_TEXT[L.mission]?.title}.` : ''}`;
  const me = L.slots[S.slot];
  const seats = L.seats || 5, humans = L.slots.filter(p => p && p.human).length;
  $('lobbyHint').textContent = seats === 1
    ? 'Solo game: four AI companions join you when you begin.'
    : `Room for ${seats} players (${humans} here). Share the code so friends can join${seats < 5 ? `; the other ${5 - seats} seat${5 - seats === 1 ? ' is an AI companion' : 's are AI companions'}` : ''}. Seats nobody takes are filled by AI.`;
  let openSeats = seats - humans;
  const list = $('slotList'); list.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const p = L.slots[i];
    if (!p) { const li = document.createElement('li'); const forPlayer = openSeats-- > 0; li.innerHTML = forPlayer ? `<span class="light"></span><span class="who muted">Open seat for a player<small>An AI companion fills it if nobody joins</small></span><span></span>` : `<span class="light ai"></span><span class="who muted">AI companion<small>Joins when you begin</small></span><span></span>`; list.append(li); continue; }
    const li = document.createElement('li');
    li.innerHTML = p
      ? `<span class="light ${p.human ? 'on' : 'ai'}"></span><span class="who">${esc(p.name)}${i === S.slot ? ' (you)' : ''}${i === L.host ? ', host' : ''}<small>${AVATARS[p.avatar]?.name || ''}${p.outfit !== 'expedition' ? `, ${p.outfit}` : ''}</small></span><span class="ok">${p.ready ? 'Ready' : ''}</span>`
      : `<span class="light"></span><span class="who muted">Open slot<small>An AI companion fills this when you begin</small></span><span></span>`;
    list.append(li);
  }
  $('btnReady').textContent = me?.ready ? 'Not ready' : 'Ready';
  const isHost = L.host === S.slot;
  show('btnStart', isHost);
  $('btnStart').disabled = !L.slots.every(p => !p || !p.human || p.ready || p.slot === L.host);
  show('btnReady', !isHost);
  if (me) S.selAvatar = me.avatar;
  // Avatar tabs.
  const tabs = $('avatarTabs'); tabs.innerHTML = '';
  for (const id of AVATAR_IDS) {
    const b = document.createElement('button'); b.textContent = AVATARS[id].name; b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(id === S.viewAvatar));
    const holder = L.slots.find(p => p && p.avatar === id);
    if (holder && holder.slot !== S.slot && holder.human) b.classList.add('taken');
    b.onclick = () => { S.viewAvatar = id; audio.play('ui'); if (!(holder && holder.human && holder.slot !== S.slot)) net.send({ type: 'avatar', avatar: id, build: myBuild() }); renderAvatarInfo(); renderLobby(); };
    tabs.append(b);
  }
  if (!S.viewAvatar) S.viewAvatar = S.selAvatar;
  renderAvatarInfo();
}
function renderAvatarInfo() {
  const id = S.viewAvatar || 'titan', A = AVATARS[id];
  const me = S.lobby?.slots[S.slot];
  const holder = S.lobby?.slots.find(p => p && p.avatar === id);
  $('avatarInfo').innerHTML = `
    <h3>${A.role}${holder && holder.slot !== S.slot ? `. ${holder.human ? 'taken by ' + esc(holder.name) : 'an AI will play this'}` : ''}</h3>
    <p class="lore">${A.lore}</p>
    <p class="ab"><b>Attack</b> ${A.attack.kind === 'ranged' ? `Ranged shot, ${A.attack.dmg} damage, ${A.attack.ammo} shots` : `${A.attack.dmg} damage melee`}</p>
    <p class="ab"><b>Q ${A.q.name}</b> ${A.q.desc}</p>
    <p class="ab"><b>E ${A.e.name}</b> ${A.e.desc}</p>
    <p class="ab"><b>Passive</b> ${A.passive}</p>
    <p>Health ${A.hp}, speed ${A.speed}</p>
    <p class="weak">Weaknesses: ${A.weakness.join('; ')}.</p>`;
  const row = $('outfitRow'); row.innerHTML = '';
  for (const o of OUTFITS) {
    const locked = o === 'relic' && !S.profile?.outfits?.includes('relic');
    const b = document.createElement('button'); b.textContent = locked ? 'Relic (finish the campaign)' : o[0].toUpperCase() + o.slice(1);
    b.disabled = locked; b.setAttribute('aria-pressed', String(me?.outfit === o));
    b.onclick = () => { net.send({ type: 'avatar', avatar: me.avatar, outfit: o, build: myBuild() }); };
    row.append(b);
  }
  // Body choice: applies to whichever avatar this player uses.
  const body = document.createElement('span'); body.className = 'muted'; body.textContent = 'Body:'; row.append(body);
  for (const [b, label] of [['f', 'Woman'], ['m', 'Man']]) {
    const btn = document.createElement('button'); btn.textContent = label; btn.setAttribute('aria-pressed', String(myBuild() === b));
    btn.onclick = () => { localStorage.setItem('fr.build', b); audio.play('ui'); net.send({ type: 'avatar', avatar: me.avatar, outfit: me.outfit, build: b }); renderAvatarInfo(); };
    row.append(btn);
  }
  previewAvatar(id, id === me?.avatar ? me.outfit : 'expedition', myBuild());
}
$('btnReady').onclick = () => { audio.play('ui'); net.send({ type: 'ready', v: !S.lobby?.slots[S.slot]?.ready }); };
$('btnStart').onclick = () => { audio.play('ui'); net.send({ type: 'ready', v: true }); net.send({ type: 'start' }); };
$('btnLeave').onclick = () => { net.send({ type: 'leave' }); sessionStorage.removeItem('fr.resume'); S.code = null; goMenu(); };
$('lobbyChatInput').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.value.trim()) { net.send({ type: 'chat', text: e.target.value }); e.target.value = ''; } });

// ------------------------------------------------------------------ game
function enterGame() {
  if (S.screen === 'game') return;
  S.screen = 'game'; S.phase = 'game';
  show('lobby', false); show('menu', false); show('title', false); show('hud');
  S.me = null; S.snaps = [];
  audio.start();
}

function onSnap(m) {
  S.snaps.push({ at: performance.now(), d: m });
  if (S.snaps.length > 30) S.snaps.shift();
  S.last = m;
  const mine = m.p.find(p => p.s === S.slot);
  if (mine) {
    if (!S.me || mine.st !== 'alive' || S.lastState !== 'alive') S.me = { x: mine.x, y: mine.y, z: mine.z, vy: 0, onGround: true };
    else {
      // Reconcile prediction with the authoritative position.
      const ex = mine.x - S.me.x, ez = mine.z - S.me.z, ey = mine.y - S.me.y, err = Math.hypot(ex, ez);
      if (err > 3.5 || Math.abs(ey) > 3) Object.assign(S.me, { x: mine.x, y: mine.y, z: mine.z });
      else { S.me.x += ex * 0.25; S.me.z += ez * 0.25; if (Math.abs(ey) > 0.5) S.me.y += ey * 0.3; }
    }
    onMyState(mine);
  }
  if (m.cut && !S.cut) startCut(m.cut);
  if (!m.cut && S.cut) endCut();
  for (const e of m.ev || []) handleEvent(e);
}

function onMyState(p) {
  if (S.lastHp != null && p.hp < S.lastHp && p.st === 'alive') { S.hurtFlash = 0.5; if (settings.shake) S.shake = 0.35; }
  S.lastHp = p.hp;
  if (p.st !== S.lastState) {
    if (p.st === 'dead') { showDeath(p, false); audio.play('death'); }
    else if (p.st === 'out') { showDeath(p, true); audio.play('death'); }
    else if (p.st === 'alive') show('death', false);
    if (p.st === 'downed') toast('You are down. A teammate can revive you.', 3);
    S.lastState = p.st;
  }
  if (p.st === 'dead') $('deathSub').textContent = `Respawning at the checkpoint in ${Math.max(0, Math.ceil(p.resp))}s`;
}
function showDeath(p, out) {
  show('death');
  $('deathTitle').textContent = out ? 'No marks remain' : 'A mark is spent';
  $('deathMarks').innerHTML = [0, 1, 2].map(i => `<i class="${i < p.l ? '' : 'spent'}"></i>`).join('');
  $('deathSub').textContent = out ? 'Your team can bring you back: a teammate with two marks can give you one at a Life Shrine, or the next checkpoint will carry you home. Click to watch another teammate.' : '';
}

// Events from the server (feed, effects, story).
const feed = (text, cls = '') => { const p = document.createElement('p'); p.className = cls; p.textContent = text; $('feed').prepend(p); while ($('feed').children.length > 6) $('feed').lastChild.remove(); };
const nameOf = s => S.last?.p.find(p => p.s === s)?.n || 'Someone';
function at(x, z) { const me = S.me || { x: 0, z: 0 }; const dx = x - me.x, dz = z - me.z; const d = Math.hypot(dx, dz); const ang = Math.atan2(dx, dz) - S.camYaw; return { dist: d, pan: -Math.sin(ang) }; }
function playerPos(slot) { return S.last?.p.find(p => p.s === slot); }
function handleEvent(e) {
  switch (e.type) {
    case 'line': subtitle(e.speaker, e.text, Math.max(4, e.text.length / 14)); break;
    case 'chat': chatLine(e.from, e.text); break;
    case 'objective': feed(`Done: ${e.text}`, 'good'); audio.play('pickup'); break;
    case 'mission': if (!e.retry) missionCard(e.idx); else feed('The expedition starts this mission again.', 'bad'); break;
    case 'tutorial': S.tutorial = TUTORIAL[e.key]; S.tutorialT = 9; break;
    case 'hint': if (e.slot === S.slot) { feed(e.text); S.journal.notes.add(e.text); } break;
    case 'record': {
      const R = RECORDS[e.idx];
      const text = R.text.replace(/\{(\d)\}/g, (_, k) => GLYPHS[e.order[+k]]);
      if (!S.journal.records.some(r => r.idx === e.idx)) S.journal.records.push({ idx: e.idx, title: R.title, text });
      subtitle('LOG', text, 9); feed(`Lost Record found (${S.journal.records.length}/3). Press J to read it.`, 'good'); audio.play('pickup');
      break;
    }
    case 'log': S.journal.logs.push(e); subtitle('LOG', `${e.title}: ${e.text}`, 10); feed('New station log in your journal (J).', 'good'); break;
    case 'death': feed(e.out ? `${nameOf(e.slot)} has no marks left` : `${nameOf(e.slot)} lost a mark (${e.lives} left)`, 'bad'); break;
    case 'downed': if (e.slot !== S.slot) feed(`${nameOf(e.slot)} is down. Hold F next to them to revive.`, 'bad'); { const p = playerPos(e.slot); if (p) audio.play('hurt', at(p.x, p.z)); } break;
    case 'respawn': if (e.slot === S.slot) { S.me = null; } break;
    case 'donate': feed(`${nameOf(e.from)} gave a mark to ${nameOf(e.to)}`, 'good'); audio.play('heal'); break;
    case 'wipe': toast('The whole team fell. Back to the checkpoint, one mark each.', 4); break;
    case 'hurt': if (e.slot === S.slot) audio.play('hurt', { vol: 0.8 }); break;
    case 'dmg': { if (e.by != null && e.by !== S.slot) { audio.play('hit', { ...at(e.x, e.z), vol: 0.4 }); break; } const y = 2 + Math.random(); world.number(e.x, groundHeight(e.x, e.z, { open: new Set(), bridge: true, log: true }) + y, e.z, e.blocked ? 'blocked' : String(e.amount), e.blocked ? '#9aa3a6' : e.crit ? '#f2a33a' : '#e8dfc8'); audio.play(e.blocked ? 'blocked' : 'hit', at(e.x, e.z)); break; }
    case 'kill': audio.play('roar', { vol: 0.3 }); break;
    case 'ping': world.ping(e.x, e.z, e.kind === 'danger'); audio.play('ui', at(e.x, e.z)); if (e.slot !== S.slot) feed(`${nameOf(e.slot)} pinged ${e.kind === 'danger' ? 'danger' : 'a spot'}`); break;
    case 'cutscene': S.cutSkippable = e.skippable; break;
    case 'skipvote': $('cutSkip').textContent = `Skip votes: ${e.n} of ${e.of}`; break;
    case 'choice': feed(`${nameOf(e.by)} chose: ${{ restore: 'restore the Heart', destroy: 'break the Heart', separate: 'part the world from the Relic' }[e.choice]}`, 'good'); break;
    case 'boss':
      if (e.state === 'kneel') { toast('It kneels — strike the core!', 2.5); audio.play('quake'); }
      if (e.state === 'plate') { audio.play('blocked'); feed('A leg plate shattered'); }
      if (e.state === 'phase') audio.play('roar');
      if (e.state === 'exposed') toast('His shield is down!', 2);
      if (e.state === 'dead') audio.play('quake');
      break;
    case 'fx': fx(e); break;
    default: break;
  }
}
function fx(e) {
  const p = e.slot != null ? playerPos(e.slot) : null;
  const pos = p ? at(p.x, p.z) : (e.x != null ? at(e.x, e.z) : {});
  switch (e.kind) {
    case 'swing': audio.play('swing', pos); if (world.players.get(e.slot)) world.players.get(e.slot).g.userData.swing = 1; break;
    case 'shot': audio.play('shot', pos); world.tracer(e.x, e.z, e.tx, e.tz); if (world.players.get(e.slot)) world.players.get(e.slot).g.userData.swing = 0.6; break;
    case 'heal': case 'mend': audio.play('heal', pos); if (e.x != null) world.wave(e.x, e.z, 0x9ff07f, 10); else if (p) world.burst(p.x, p.y + 1.5, p.z, 0x9ff07f, 10); break;
    case 'revive': audio.play('heal', pos); feed(`${nameOf(e.by)} revived ${nameOf(e.slot)}`, 'good'); break;
    case 'ability': audio.play('ability', pos); if (e.slot === S.slot) feed(e.name); break;
    case 'quake': audio.play('quake', { ...pos, vol: e.big ? 1 : 0.6 }); world.wave(e.x, e.z, 0xf2a33a, e.big ? 9 : 4); if (settings.shake && pos.dist < 20) S.shake = Math.max(S.shake, e.big ? 0.6 : 0.3); break;
    case 'overload': world.wave(e.x, e.z, 0xe0c23a, 25, 0.8); break;
    case 'mark': if (p) world.wave(p.x, p.z, 0xe4573d, 30, 0.8); break;
    case 'smoke': world.smoke(e.x, e.z); break;
    case 'dodge': audio.play('evade', pos); break;
    case 'evade': if (e.slot === S.slot) feed('Evaded'); break;
    case 'takedown': if (e.slot === S.slot) feed('Silent takedown', 'good'); break;
    case 'pickup': case 'resupply': if (e.slot === S.slot) audio.play('pickup'); break;
    case 'empty': if (e.slot === S.slot) { audio.play('empty'); toast('Out of shots. Refill at a supply cache.', 2); } break;
    case 'gate': audio.play('gate'); if (settings.shake) S.shake = 0.4; break;
    case 'bridge': audio.play('gate'); toast('The bridge is down', 2); break;
    case 'heave': audio.play('quake'); break;
    case 'repair': audio.play('pickup', pos); feed('Winch repaired', 'good'); break;
    case 'turn': audio.play('ui', pos); break;
    case 'crumble': audio.play('quake', pos); world.burst(e.x, 3, e.z, 0x7a7462, 30, 6, 1.2, 0.4); feed('The cracked wall gave way'); break;
    case 'chime': audio.play('chime', { ...pos, f: [523, 587, 659, 784, 880][e.n - 1] }); world.wave(e.x, e.z, 0xd79cff, 5); break;
    case 'discord': audio.play('discord', pos); break;
    case 'shatter': audio.play('quake', pos); world.burst(e.x, 2, e.z, 0xd79cff, 40, 8, 1.4, 0.3); break;
    case 'beam': audio.play('beam', pos); world.tracer(e.x, e.z, e.tx, e.tz, 0xd79cff, 1.6, 0.4); break;
    case 'blink': world.burst(e.x, 2, e.z, 0xd79cff, 20, 5); break;
    case 'unveil': break;
    default: break;
  }
}
function chatLine(from, text) {
  for (const id of ['chatLog', 'lobbyChat']) { const p = document.createElement('p'); p.innerHTML = `<b>${esc(from)}</b> ${esc(text)}`; $(id).append(p); $(id).scrollTop = 1e9; while ($(id).children.length > 40) $(id).firstChild.remove(); }
}
function toast(text, secs = 2.5) { $('toast').textContent = text; show('toast'); S.toastT = secs; }
function missionCard(idx) {
  const M = MISSION_TEXT[idx]; if (!M) return;
  $('mcSub').textContent = M.sub; $('mcTitle').textContent = M.title;
  const el = $('missionCard'); show(el); el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  setTimeout(() => show(el, false), 4300);
}

// ------------------------------------------------------------------ cutscenes (server-synchronised)
function startCut(c) {
  S.cut = c.id; S.cutStart = performance.now() / 1000 - (CUTSCENES[c.id].dur - c.left); S.cutLines = new Set();
  show('cut'); show('hud', false); $('cutSub').innerHTML = '';
  $('cutSkip').textContent = S.cutSkippable ? 'Press K to vote to skip' : '';
  if (document.pointerLockElement) document.exitPointerLock();
  if (c.id === 'transport' || c.id === 'falseexit') audio.play('warp');
}
function endCut() { S.cut = null; show('cut', false); if (S.screen === 'game') show('hud'); $('cutSub').innerHTML = ''; }
function cutCamera(id, t, view) {
  const cam = world.camera; const team = view.players.filter(p => p.st === 'alive');
  const center = team.length ? { x: team.reduce((a, p) => a + p.x, 0) / team.length, z: team.reduce((a, p) => a + p.z, 0) / team.length } : CHECKPOINTS[S.last?.m || 1];
  const orbit = (c, r, h, speed, look = 1.5) => { cam.position.set(c.x + Math.sin(t * speed) * r, (c.y || 0) + h, c.z + Math.cos(t * speed) * r); cam.lookAt(c.x, (c.y || 0) + look, c.z); };
  switch (id) {
    case 'transport': cam.fov = 62 + Math.sin(t * 3) * 12 + t * 3; cam.updateProjectionMatrix(); orbit(center, 6 - t * 0.4, 3 + t, 1.2); world.flash = t > 7 ? 1 : 0; break;
    case 'reveal': {
      cam.fov = 50; cam.updateProjectionMatrix();
      const i = Math.floor(t / 2.4);
      const p = view.players.slice().sort((a, b) => a.s - b.s)[i];
      if (p && i < 5) { const a = p.yaw + 0.5; cam.position.set(p.x + Math.sin(a) * 3.2, p.y + 1.9, p.z + Math.cos(a) * 3.2); cam.lookAt(p.x, p.y + 1.5, p.z); $('cutSkip').dataset.name = `${AVATARS[p.a].name}, ${AVATARS[p.a].role}`; if (S.revealIdx !== i) { S.revealIdx = i; $('cutSub').innerHTML = `<b>${esc(p.n)}</b> ${AVATARS[p.a].name}: ${esc(AVATARS[p.a].role)}`; } }
      else { cam.fov = 62; cam.updateProjectionMatrix(); cam.position.set(center.x, 8 + (t - 12) * 0.6, center.z - 10); cam.lookAt(center.x, 3, center.z + 40); }
      break;
    }
    case 'camp': orbit(POINTS.camp, 10, 4, 0.15, 2); break;
    case 'temple': { const k = Math.min(1, t / 10); cam.position.set(lerp(-14, 10, k), 9, lerp(250, 300, k)); cam.lookAt(0, 3, lerp(262, 309, k)); break; }
    case 'colossus': cam.position.set(Math.sin(t * 0.1) * 30, 3 + t * 0.6, ARENA.z - 30); cam.lookAt(ARENA.x, 6 + t * 0.4, ARENA.z); break;
    case 'falseexit': cam.position.set(Math.sin(t * 0.3) * 6, 3 + Math.sin(t * 9) * (t < 3 ? 0.3 : 0), POINTS.portal.z - 7); cam.lookAt(0, 3, POINTS.portal.z); world.flash = t < 3 ? (Math.sin(t * 20) > 0 ? 0.6 : 0) : 0; break;
    case 'curator': orbit({ x: HEART.x, z: HEART.z }, 14, 5, 0.12, 3); break;
    case 'choice': orbit({ x: 0, z: 490 }, 11, 6, 0.1, 1.5); break;
    default: orbit(center, 10, 5, 0.2);
  }
}

// ------------------------------------------------------------------ input
const canvas = $('view');
canvas.addEventListener('click', () => {
  if (S.screen === 'game' && !S.cut && !document.pointerLockElement && !anyOverlay()) canvas.requestPointerLock();
  if (S.me && S.last?.p.find(p => p.s === S.slot)?.st === 'out') S.spectate++;
});
function anyOverlay() { return ['pause', 'journal', 'settings', 'controls', 'mapView'].some(id => !$(id).classList.contains('hidden')) || S.chatOpen; }
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && S.screen === 'game' && !S.cut && !anyOverlay() && !S.ending && !S.relock) show('pause');
  S.relock = false;
});
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas) return;
  S.camYaw -= e.movementX * 0.0025 * settings.sens;
  S.camPitch = Math.max(-0.6, Math.min(1.1, S.camPitch + e.movementY * 0.0022 * settings.sens * (settings.invert ? -1 : 1)));
});
document.addEventListener('mousedown', e => { if (document.pointerLockElement === canvas && e.button === 0) { S.mouseDown = true; attack(); } });
document.addEventListener('mouseup', e => { if (e.button === 0) S.mouseDown = false; });

function act(kind, extra = {}) { net.send({ type: 'act', seq: ++S.aseq, kind, aim: S.camYaw, ...extra }); }
function attack() { const mine = S.last?.p.find(p => p.s === S.slot); if (!mine || mine.cd.a > 0.05) return; S.lastAtk = performance.now(); act('atk'); }

addEventListener('keydown', e => {
  if (S.screen === 'title') { if (!prologue && S.screen === 'title') { startPrologue(); return; } }
  if (S.screen === 'titleDone') { goMenu(); return; }
  if (S.screen !== 'game') return;
  if (S.chatOpen) {
    if (e.key === 'Enter') { const v = $('chatInput').value.trim(); if (v) net.send({ type: 'chat', text: v }); closeChat(); }
    if (e.key === 'Escape') closeChat();
    return;
  }
  if (e.code === 'Tab') { e.preventDefault(); show('mapView'); return; }
  if (e.repeat) return;
  const k = e.code;
  S.keys.add(k);
  if (S.cut) { if (k === 'KeyK') { net.send({ type: 'skip' }); $('cutSkip').textContent = 'Waiting for the team to skip'; } return; }
  if (k === 'Escape') { if (anyOverlay()) closeOverlays(); return; }
  if (k === 'Enter') { openChat(); return; }
  if (k === 'KeyJ') { openJournal(); return; }
  if (anyOverlay()) return;
  if (k === 'Space') S.jumpPulse = true;
  if (k === 'KeyQ') act('q');
  if (k === 'KeyE') act('e');
  if (k === 'KeyV') act('dodge');
  if (k === 'KeyH') act('herb');
  if (k === 'KeyF') { S.interacting = true; act('interact'); }
  if (k === 'KeyG') ping(e.altKey);
});
addEventListener('keyup', e => {
  S.keys.delete(e.code);
  if (e.code === 'Tab') show('mapView', false);
  if (e.code === 'KeyF' && S.interacting) { S.interacting = false; act('interactEnd'); }
});
addEventListener('mousedown', () => { if (S.screen === 'title' && !prologue) startPrologue(); else if (S.screen === 'titleDone') goMenu(); });
addEventListener('blur', () => { S.keys.clear(); S.mouseDown = false; });

function openChat() { S.chatOpen = true; S.relock = true; show('chatInput'); $('chatInput').focus(); if (document.pointerLockElement) document.exitPointerLock(); }
function closeChat() { S.chatOpen = false; $('chatInput').value = ''; show('chatInput', false); $('chatInput').blur(); }
function closeOverlays() { for (const id of ['pause', 'journal', 'settings', 'controls', 'mapView']) show(id, false); }
$('btnResume').onclick = () => { show('pause', false); canvas.requestPointerLock(); };
$('btnJournal').onclick = () => openJournal();
$('btnQuit').onclick = () => { net.send({ type: 'leave' }); sessionStorage.removeItem('fr.resume'); S.code = null; S.screen = 'menu'; closeOverlays(); show('death', false); location.reload(); };
function openJournal() {
  S.relock = true; if (document.pointerLockElement) document.exitPointerLock();
  const J = S.journal;
  const seen = new Set((S.last?.c || []).map(c => c.k));
  let h = '';
  h += `<h3>Lost Records (${J.records.length}/3)</h3>` + (J.records.length ? J.records.sort((a, b) => a.idx - b.idx).map(r => `<p><b>${esc(r.title)}.</b> ${esc(r.text)}</p>`).join('') : '<p class="muted">None found yet. They glow faintly green, and the expedition hid them off the trail.</p>');
  h += '<h3>Station logs</h3>' + (J.logs.length ? J.logs.map(l => `<p><b>${esc(l.title)}.</b> ${esc(l.text)}</p>`).join('') : '<p class="muted">Nothing recovered yet.</p>');
  h += '<h3>Creature notes</h3>' + Object.entries(CREATURES).filter(([k]) => seen.has(k) || [...J.notes].some(n => n.startsWith(CREATURES[k].name))).map(([, c]) => `<p><b>${c.name}.</b> ${c.hint}</p>`).join('') + (J.notes.size ? '' : '<p class="muted">ORACLE\'s Track ability teaches how each creature hunts.</p>');
  $('journalBody').innerHTML = h;
  show('pause', false); show('journal');
}
function ping(danger) {
  // March the camera ray to the ground.
  const dir = new THREE.Vector3(); world.camera.getWorldDirection(dir);
  const p = world.camera.position.clone();
  for (let i = 0; i < 300; i++) {
    p.addScaledVector(dir, 0.5);
    if (p.y < groundHeight(p.x, p.z, S.last?.dyn ? { open: new Set(S.last.dyn.open), bridge: S.last.dyn.bridge, log: S.last.dyn.log } : { open: new Set() })) break;
  }
  net.send({ type: 'ping', x: p.x, z: p.z, kind: danger ? 'danger' : 'go' });
}

// Gamepad (standard mapping).
const padPrev = {};
function pollPad(dt) {
  const gp = navigator.getGamepads?.()[0]; if (!gp || S.screen !== 'game') return null;
  const dz = v => (Math.abs(v) < 0.15 ? 0 : v);
  S.camYaw -= dz(gp.axes[2]) * 2.6 * dt * settings.sens;
  S.camPitch = Math.max(-0.6, Math.min(1.1, S.camPitch + dz(gp.axes[3]) * 1.8 * dt * settings.sens * (settings.invert ? -1 : 1)));
  const pressed = i => gp.buttons[i]?.pressed;
  const edge = (i, fn) => { const v = pressed(i); if (v && !padPrev[i]) fn(); padPrev[i] = v; };
  edge(0, () => (S.jumpPulse = true)); edge(4, () => act('q')); edge(5, () => act('e')); edge(1, () => act('dodge'));
  edge(13, () => act('herb')); edge(12, () => ping(false)); edge(9, () => show('pause'));
  edge(3, () => { if (S.cut) net.send({ type: 'skip' }); });
  const x = pressed(2); if (x && !padPrev.x) { S.interacting = true; act('interact'); } if (!x && padPrev.x) { S.interacting = false; act('interactEnd'); } padPrev.x = x;
  if (gp.buttons[7]?.value > 0.5) attack();
  return { mx: dz(gp.axes[0]), my: dz(gp.axes[1]), sprint: pressed(10), crouch: pressed(11) };
}

// ------------------------------------------------------------------ interpolation
function viewState() {
  const snaps = S.snaps; if (!snaps.length) return null;
  const renderAt = performance.now() - 100;
  let a = snaps[0], b = snaps[snaps.length - 1];
  for (let i = snaps.length - 1; i > 0; i--) if (snaps[i - 1].at <= renderAt) { a = snaps[i - 1]; b = snaps[i]; break; }
  const k = b.at > a.at ? Math.max(0, Math.min(1, (renderAt - a.at) / (b.at - a.at))) : 1;
  const L = S.last;
  const mix = (list, la, key) => list.map(e => { const o = la.find(x => x[key] === e[key]); if (!o) return e; const yawD = Math.atan2(Math.sin(e.yaw - o.yaw), Math.cos(e.yaw - o.yaw)); return { ...e, x: lerp(o.x, e.x, k), y: lerp(o.y, e.y, k), z: lerp(o.z, e.z, k), yaw: o.yaw + yawD * k }; });
  const players = mix(b.d.p, a.d.p, 's').map(p => {
    const latest = L.p.find(q => q.s === p.s) || p;
    if (p.s === S.slot && S.me && latest.st === 'alive') return { ...latest, x: S.me.x, y: S.me.y, z: S.me.z, yaw: S.myYaw ?? latest.yaw };
    return { ...latest, x: p.x, y: p.y, z: p.z, yaw: p.yaw };
  });
  const creatures = mix(b.d.c, a.d.c, 'i').map(c => ({ ...(L.c.find(q => q.i === c.i) || c), x: c.x, y: c.y, z: c.z, yaw: c.yaw }));
  return { players, creatures, objects: L.o, dyn: L.dyn, boss: L.b, wp: L.wp, m: L.m };
}

// ------------------------------------------------------------------ main loop
let lastT = performance.now(), sendAcc = 0, clock = 0;
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now(), realDt = Math.min(1, (now - lastT) / 1000), dt = Math.min(0.05, realDt); lastT = now; clock += dt; S.realDt = realDt;
  if (S.screen === 'title' || S.screen === 'titleDone' || S.screen === 'menu' || S.screen === 'lobby') {
    if (prologue) {
      prologue.t += dt; prologueCamera(prologue.t);
      for (const [t, sp, text] of CUTSCENES.prologue.lines) if (prologue.t >= t && !prologue.shown.has(t)) { prologue.shown.add(t); subtitle(sp, text, 5.5); }
      const lights = relicProp.userData.lights;
      if (prologue.t > 29) { lights[4].material.color.setHex(Math.random() > 0.3 ? 0x7ff0c4 : 0x223a30); relicProp.userData.pl.intensity = 6; }
      if (prologue.t > 24 && prologue.t < 25) show('titleMark');
      if (prologue.t >= prologue.dur) endPrologue();
    } else idleCamera(clock);
    world.sync({ players: [], creatures: [], objects: [], dyn: { open: [] }, boss: null }, dt, -1);
    const env = world.environment({ x: world.camera.position.x, y: 2, z: Math.max(0, world.camera.position.z) }, dt, audio);
    audio.update({ ...env, inGame: false, danger: 0 });
    tickSubtitle(realDt);
    world.render();
    if (preview.renderer && S.screen === 'lobby') {
      const cv = $('preview'), w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== w || cv.height !== h) { preview.renderer.setSize(w, h, false); preview.cam.aspect = w / h; preview.cam.updateProjectionMatrix(); }
      preview.t += dt;
      if (preview.model) { preview.model.rotation.y += dt * 0.6; const u = preview.model.userData; u.phase += dt * 6; u.armR.rotation.x = (preview.t % 3) < 0.5 ? -2.4 * Math.sin((preview.t % 3) / 0.5 * Math.PI) : Math.sin(u.phase) * 0.2; u.armL.rotation.x = -Math.sin(u.phase) * 0.2; }
      preview.renderer.render(preview.scene, preview.cam);
    }
    return;
  }
  if (S.screen !== 'game' || !S.last) { world.render(); return; }

  const view = viewState();
  const mine = S.last.p.find(p => p.s === S.slot);
  // --- local movement prediction ---
  const pad = pollPad(dt);
  let fw = 0, rt = 0;
  if (!S.chatOpen && !anyOverlay()) {
    if (S.keys.has('KeyW')) fw += 1; if (S.keys.has('KeyS')) fw -= 1; if (S.keys.has('KeyD')) rt += 1; if (S.keys.has('KeyA')) rt -= 1;
  }
  if (pad) { fw -= pad.my; rt += pad.mx; }
  const fx_ = Math.sin(S.camYaw), fz = Math.cos(S.camYaw), rx = -Math.cos(S.camYaw), rz = Math.sin(S.camYaw);
  let mx = fx_ * fw + rx * rt, mz = fz * fw + rz * rt; const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
  const sprint = S.keys.has('ShiftLeft') || S.keys.has('ShiftRight') || !!pad?.sprint;
  const crouch = S.keys.has('KeyC') || !!pad?.crouch;
  const aiming = now - S.lastAtk < 700 || S.mouseDown;
  const yaw = aiming || ml < 0.1 ? (ml < 0.1 && !aiming ? (S.myYaw ?? S.camYaw) : S.camYaw) : Math.atan2(mx, mz);
  S.myYaw = yaw;
  if (S.mouseDown && document.pointerLockElement) attack();
  const canMove = mine && mine.st === 'alive' && !S.cut && mine.hold == null;
  if (S.me && canMove) {
    const A = AVATARS[mine.a];
    const spd = A.speed * (sprint && mine.sta > 1 && !crouch && !mine.carry ? 1.5 : 1) * (crouch ? 0.5 : 1) * (mine.carry && mine.a !== 'titan' ? 0.6 : 1);
    if (!(mine.fx?.dodge > 0)) {
      const dyn = { open: new Set(S.last.dyn.open), bridge: S.last.dyn.bridge, log: S.last.dyn.log };
      stepMove(S.me, { mx, mz, jump: S.jumpPulse }, spd, dt, dyn, A.radius);
    }
  }
  sendAcc += dt;
  if (sendAcc >= 0.05) {
    sendAcc = 0;
    net.send({ type: 'input', seq: ++S.seq, mx: canMove ? +mx.toFixed(3) : 0, mz: canMove ? +mz.toFixed(3) : 0, yaw: +yaw.toFixed(3), sprint, crouch, jump: S.jumpPulse });
    S.jumpPulse = false;
  }

  // --- render world ---
  world.sync(view, dt, S.slot);

  // --- camera ---
  if (S.cut) {
    const t = performance.now() / 1000 - S.cutStart;
    cutCamera(S.cut, t, view);
    for (const [lt, sp, text] of CUTSCENES[S.cut]?.lines || []) if (t >= lt && !S.cutLines.has(lt)) { S.cutLines.add(lt); subtitle(sp, text, 5); }
  } else {
    if (world.camera.fov !== 62) { world.camera.fov = 62; world.camera.updateProjectionMatrix(); }
    let focus = view.players.find(p => p.s === S.slot);
    if (mine && (mine.st === 'out' || mine.st === 'dead')) {
      const others = view.players.filter(p => p.st === 'alive');
      if (others.length && mine.st === 'out') focus = others[S.spectate % others.length];
      else focus = { ...CHECKPOINTS[S.last.m], y: 0 };
    }
    if (focus) {
      const dist = 6.5, h = 1.7;
      const cx = focus.x - Math.sin(S.camYaw) * Math.cos(S.camPitch) * dist + Math.cos(S.camYaw) * 0.7;
      const cz = focus.z - Math.cos(S.camYaw) * Math.cos(S.camPitch) * dist - Math.sin(S.camYaw) * 0.7;
      let cy = focus.y + h + Math.sin(S.camPitch) * dist;
      cy = Math.max(cy, groundHeight(cx, cz, { open: new Set(), bridge: true, log: true }) + 0.6);
      world.camera.position.set(cx, cy, cz);
      world.camera.lookAt(focus.x + Math.cos(S.camYaw) * 0.7, focus.y + h, focus.z - Math.sin(S.camYaw) * 0.7);
      if (S.shake > 0) { S.shake -= dt; world.camera.position.x += (Math.random() - 0.5) * S.shake; world.camera.position.y += (Math.random() - 0.5) * S.shake; }
    }
  }
  const focusP = S.me || { x: 0, y: 0, z: 0 };
  const env = world.environment(S.cut ? { x: world.camera.position.x, y: world.camera.position.y, z: world.camera.position.z } : focusP, dt, audio);
  const chasing = view.creatures.filter(c => c.tg != null && c.st !== 'dead' && c.st !== 'perch' && Math.hypot(c.x - focusP.x, c.z - focusP.z) < 35).length;
  audio.update({ ...env, inGame: true, danger: Math.min(1, chasing / 4 + (view.boss ? 0.7 : 0)) });
  world.render();
  updateHUD(view, mine, realDt);
  tickSubtitle(realDt);
}
function tickSubtitle(dt) {
  if (S.subtitleT > 0) { S.subtitleT -= dt; if (S.subtitleT <= 0) { $('subtitle').innerHTML = ''; if (!S.cut) $('cutSub').innerHTML = ''; } }
  if (S.toastT > 0) { S.toastT -= dt; if (S.toastT <= 0) show('toast', false); }
}

// ------------------------------------------------------------------ HUD
const HOLD_TIME = { shrine: 2, terminal: 2, altar: 2 };
function updateHUD(view, mine, dt) {
  if (!mine) return;
  const L = S.last;
  // Objectives.
  const objs = L.obj || [];
  const open = objs.find(o => !o.done && (!o.after || o.after.every(a => objs.find(x => x.id === a)?.done)));
  const done = objs.filter(o => o.done).slice(-2);
  $('objective').innerHTML = `<div class="mission">${esc(MISSION_TEXT[L.m]?.title || '')}</div>` + done.map(o => `<div class="done">${esc(o.text)}</div>`).join('') +
    (open ? `<div class="now">${esc(open.text)}${open.max ? ` <em>${open.pr ?? 0}/${open.max}</em>` : ''}</div>` : '') +
    (S.tutorialT > 0 ? `<div class="small muted" style="margin-top:6px">${esc(S.tutorial)}</div>` : '');
  S.tutorialT -= dt;
  const reg = regionAt(S.me?.z ?? mine.z);
  $('region').textContent = `${reg.name}${L.rec ? `. Lost Records ${L.rec}/3` : ''}`;
  // Team strip: five Relic lights.
  $('team').innerHTML = L.p.slice().sort((a, b) => a.s - b.s).map(p => `
    <div class="tm ${p.st} ${p.s === S.slot ? 'me' : ''}"><div class="nm">${esc(p.n)}<small>${AVATARS[p.a].name}${!p.c && p.h ? ', reconnecting' : ''}, ${p.l} mark${p.l === 1 ? '' : 's'}${p.st === 'downed' ? `, down ${Math.ceil(p.down)}s` : p.st === 'out' ? ', out' : p.st === 'dead' ? ', respawning' : ''}</small>
    <div class="mini"><i style="width:${Math.max(0, p.hp / p.mhp * 100)}%"></i></div></div><span class="light"></span></div>`).join('');
  // Boss.
  if (L.b) {
    show('boss'); $('bossName').textContent = L.b.name; $('bossBar').style.width = `${Math.max(0, L.b.hp / L.b.mhp * 100)}%`;
    $('bossSub').textContent = L.b.type === 'colossus'
      ? (L.b.phase === 1 ? `Leg plates remaining: ${L.b.plates.filter(x => x > 0).length}. Its core can't be reached yet.` : L.b.knelt > 0 ? 'It kneels — hit the glowing core!' : `Hold both chain anchors together (${Math.round(L.b.anchorT / 1.5 * 100)}%).`)
      : (L.b.shield ? 'Shielded while his creatures stand.' : 'Shield down — strike him!');
  } else show('boss', false);
  // Vitals.
  $('lifeMarks').innerHTML = [0, 1, 2].map(i => `<i class="${i < mine.l ? '' : 'spent'}"></i>`).join('');
  $('hpBar').style.width = `${mine.hp / mine.mhp * 100}%`; $('staBar').style.width = `${mine.sta}%`;
  const A = AVATARS[mine.a];
  $('vitalsText').textContent = `${A.name}, ${mine.hp}/${mine.mhp}. ${mine.herbs} herb${mine.herbs === 1 ? '' : 's'}${A.attack.ammo ? `, ${mine.ammo} shots` : ''}.`;
  // Abilities.
  const slot = (key, label, name, cd, max, active) => `<div class="abl"><div class="key ${cd <= 0 ? 'ready' : ''} ${active ? 'active' : ''}">${label}<i style="height:${Math.min(100, cd / max * 100)}%"></i></div><span>${name}</span></div>`;
  $('abilities').innerHTML = slot('a', 'LMB', A.attack.kind === 'ranged' ? 'Shoot' : 'Strike', mine.cd.a, A.attack.cd) +
    slot('q', 'Q', A.q.name, mine.cd.q, A.q.cd, mine.fx.bulwark || mine.fx.veil) + slot('e', 'E', A.e.name, mine.cd.e, A.e.cd) + slot('d', 'V', 'Dodge', mine.cd.d, 0.9);
  // Interaction prompt.
  let prompt = null;
  if (mine.st === 'alive') {
    const down = L.p.find(p => p.s !== S.slot && p.st === 'downed' && Math.hypot(p.x - S.me.x, p.z - S.me.z) < 2.6);
    if (down) prompt = `Hold <kbd>F</kbd> to revive ${esc(down.n)}`;
    else {
      let best = null, bd = 3.4;
      const canDonate = mine.l >= 2 && L.p.some(p => p.st === 'out');
      for (const o of L.o) { if (!o.lb || (o.k === 'shrine' && !canDonate) || ['campfire', 'marker', 'camp', 'mural', 'plate', 'anchor', 'cradle', 'node', 'cracked'].includes(o.k)) continue; const d = Math.hypot(o.x - S.me.x, o.z - S.me.z); if (d < bd) { bd = d; best = o; } }
      if (best) prompt = `<kbd>F</kbd>${esc(best.lb)}`;
      const near = (k, r) => L.o.find(o => o.k === k && Math.hypot(o.x - S.me.x, o.z - S.me.z) < r);
      if (!best && mine.a === 'titan' && near('log', 4.5) && !L.dyn.log) prompt = '<kbd>E</kbd>Heave the fallen log across the ravine';
      if (!best && near('cracked', 4.5)) prompt = mine.a === 'titan' ? '<kbd>E</kbd>Heave through the cracked wall' : 'This wall is cracked. Hit it, or bring TITAN.';
      if (!best && near('campfire', 7)) prompt = 'Camp: press 1 to 5 to switch avatar while out of combat';
    }
  }
  if (prompt) { $('prompt').innerHTML = prompt; show('prompt'); } else show('prompt', false);
  // Hold progress ring.
  if (mine.hold != null) {
    let need = 3;
    const nearO = L.o.reduce((b, o) => { const d = Math.hypot(o.x - mine.x, o.z - mine.z); return d < (b?.d ?? 4) ? { o, d } : b; }, null)?.o;
    if (nearO) need = nearO.k === 'winch' ? (nearO.broken ? (mine.a === 'circuit' ? 2 : 4) : 0) : HOLD_TIME[nearO.k] ?? 3;
    if (nearO?.k === 'winch' && !nearO.broken) { need = 6; mine.hold = L.dyn.bridgeP; }
    if (!nearO || nearO.k !== 'winch') { if (L.p.some(p => p.st === 'downed' && Math.hypot(p.x - mine.x, p.z - mine.z) < 3)) need = mine.a === 'oracle' ? 3 : 3; }
    show('holdRing'); $('holdArc').style.strokeDashoffset = String(100.5 * (1 - Math.min(1, mine.hold / need)));
  } else show('holdRing', false);
  // Death overlay hide when spectating revived.
  if (mine.st === 'downed') $('subtitle').innerHTML ||= `<i>You are down. ${Math.ceil(mine.down)}s until you lose a mark.</i>`;
  drawMinimap(view, mine);
  if (!$('mapView').classList.contains('hidden')) drawBigMap(view);
  document.body.style.boxShadow = '';
  if (S.hurtFlash > 0) { S.hurtFlash -= dt; $('view').style.filter = `saturate(${1 - S.hurtFlash}) brightness(${1 + S.hurtFlash * 0.3})`; } else $('view').style.filter = '';
}

function drawMinimap(view, mine) {
  const cv = $('minimap'), g = cv.getContext('2d'), R = 90, scale = 1.6;
  g.clearRect(0, 0, 180, 180);
  g.save(); g.beginPath(); g.arc(R, R, R, 0, Math.PI * 2); g.clip();
  g.fillStyle = 'rgba(15,29,23,.75)'; g.fillRect(0, 0, 180, 180);
  const me = S.me || mine;
  const tx = (x, z) => { const dx = (x - me.x) * scale, dz = (z - me.z) * scale; const c = Math.cos(S.camYaw), s = Math.sin(S.camYaw); return [R + (dx * c - dz * s) * -1, R - (dx * s + dz * c)]; };
  // Ravine band.
  g.strokeStyle = 'rgba(31,79,90,.9)'; g.lineWidth = 20 * scale;
  { const a = tx(-60, 175), b = tx(60, 175); g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke(); }
  g.lineWidth = 1;
  for (const c of view.creatures) { if (c.hid || c.st === 'dead') continue; const [x, y] = tx(c.x, c.z); g.fillStyle = c.mk ? '#ff7a5a' : '#e4573d'; g.fillRect(x - 2, y - 2, 4, 4); }
  for (const o of view.objects) { if (!['record', 'herb', 'cache', 'shrine', 'key', 'portal', 'altar', 'terminal', 'stone'].includes(o.k)) continue; const [x, y] = tx(o.x, o.z); g.fillStyle = o.k === 'record' ? '#7ff0c4' : o.k === 'herb' ? '#9ff07f' : '#f2a33a'; g.beginPath(); g.arc(x, y, 2.5, 0, 7); g.fill(); }
  for (const p of view.players) { if (p.st === 'dead' || p.st === 'out') continue; const [x, y] = tx(p.x, p.z); g.fillStyle = p.s === S.slot ? '#ffffff' : p.st === 'downed' ? '#f2a33a' : '#7ff0c4'; g.beginPath(); g.arc(x, y, p.s === S.slot ? 4 : 3.5, 0, 7); g.fill(); }
  if (view.wp) {
    let [x, y] = tx(view.wp.x, view.wp.z); const dx = x - R, dy = y - R, d = Math.hypot(dx, dy);
    if (d > R - 8) { x = R + dx / d * (R - 8); y = R + dy / d * (R - 8); }
    g.fillStyle = '#7ff0c4'; g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 5, y + 4); g.lineTo(x - 5, y + 4); g.fill();
  }
  g.restore();
  g.strokeStyle = 'rgba(127,240,196,.5)'; g.beginPath(); g.arc(R, R, R - 1, 0, Math.PI * 2); g.stroke();
}
function drawBigMap(view) {
  const cv = $('bigmap'), g = cv.getContext('2d'), W = cv.width, H = cv.height;
  const sx = x => W / 2 + x * (W / 124), sz = z => H - (z + 6) * (H / 552);
  g.fillStyle = '#16291f'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#1f4f5a'; g.fillRect(0, sz(185), W, sz(165) - sz(185));
  if (view.dyn.bridge) { g.fillStyle = '#7a5a36'; g.fillRect(sx(-3), sz(185), sx(3) - sx(-3), sz(165) - sz(185)); }
  if (view.dyn.log) { g.fillStyle = '#5a4027'; g.fillRect(sx(-32), sz(185), sx(-28) - sx(-32), sz(165) - sz(185)); }
  g.fillStyle = '#4b483c';
  for (const b of WORLD.boxes) { if (b.deco === 'void' || b.deco === 'crate') continue; if (b.id && view.dyn.open.includes(b.id)) continue; g.fillRect(sx(b.x0), sz(b.z1), sx(b.x1) - sx(b.x0), sz(b.z0) - sz(b.z1)); }
  g.strokeStyle = '#4b483c'; g.lineWidth = 4; g.beginPath(); g.arc(sx(ARENA.x), sz(ARENA.z), ARENA.r * (W / 124), 0, 7); g.stroke();
  g.fillStyle = '#e8dfc8'; g.font = '13px Instrument Sans, sans-serif';
  for (const [z, n] of [[20, 'Emerald Wilds'], [175, 'Broken Ravine'], [300, 'Forgotten Temple'], [400, 'Colossus Hollow'], [505, 'Heart of the Relic']]) g.fillText(n, 10, sz(z));
  if (view.wp) { g.fillStyle = '#7ff0c4'; g.beginPath(); g.arc(sx(view.wp.x), sz(view.wp.z), 6, 0, 7); g.fill(); }
  for (const p of view.players) { if (p.st === 'out' || p.st === 'dead') continue; g.fillStyle = p.s === S.slot ? '#fff' : '#7ff0c4'; g.beginPath(); g.arc(sx(p.x), sz(p.z), 5, 0, 7); g.fill(); g.fillText(p.n, sx(p.x) + 8, sz(p.z) + 4); }
  $('teamDetail').innerHTML = S.last.p.map(p => `<p><b>${esc(p.n)}</b><br><span class="muted small">${AVATARS[p.a].name}, ${p.h ? (p.c ? 'player' : 'reconnecting') : 'AI companion'}. ${p.hp}/${p.mhp} health, ${p.l} marks, ${p.herbs} herbs. ${p.st}</span></p>`).join('');
}

// Avatar switching at camps (number keys 1–5 when standing at the current checkpoint).
addEventListener('keydown', e => {
  if (S.screen !== 'game' || S.chatOpen || anyOverlay() || S.cut) return;
  const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code);
  if (n < 0) return;
  const mine = S.last?.p.find(p => p.s === S.slot);
  net.send({ type: 'avatar', avatar: AVATAR_IDS[n], outfit: mine?.o, build: myBuild() });
});

// ------------------------------------------------------------------ ending
function startEnding(m) {
  S.ending = m; S.screen = 'ending';
  if (document.pointerLockElement) document.exitPointerLock();
  show('hud', false); show('death', false); show('cut', false); closeOverlays();
  const E = ENDINGS[m.choice];
  show('ending'); show('endText'); show('endStats', false); show('credits', false);
  $('endText').innerHTML = `<h2 class="stencil">${esc(E.title)}</h2>` + E.lines.map((l, i) => `<p style="animation-delay:${1.5 + i * 4}s">${esc(l)}</p>`).join('');
  E.lines.forEach((l, i) => setTimeout(() => audio.speak('STEWARD', l), 1500 + i * 4000));
  audio.play('warp');
  setTimeout(() => {
    show('endText', false); show('endStats');
    const fmt = s => `${Math.floor(s / 60)}m ${s % 60}s`;
    $('endStats').innerHTML = `<h2 class="stencil">The five who came back</h2>
      <p class="muted">Time in the Relic ${fmt(m.time)}. Lost Records ${m.records}/3. Team wipes ${m.wipes}.</p>
      <table><tr><th>Bearer</th><th>Avatar</th><th>Marks left</th><th>Damage</th><th>Creatures</th><th>Revives</th><th>Falls</th></tr>
      ${m.players.map(p => `<tr><td>${esc(p.name)}${p.human ? '' : ' (AI)'}</td><td>${AVATARS[p.avatar].name}</td><td>${p.lives}</td><td>${p.dmg}</td><td>${p.kills}</td><td>${p.revives}</td><td>${p.deaths}</td></tr>`).join('')}</table>
      <p class="muted small">Finishing unlocked the Relic outfit for every human bearer.</p>`;
  }, 1500 + E.lines.length * 4000 + 2500);
  setTimeout(() => {
    show('endStats', false); show('credits');
    const names = m.players.map(p => `<p>${esc(p.name)} as ${AVATARS[p.avatar].name}</p>`).join('');
    $('credits').innerHTML = `<div class="roll"><h1 class="stencil" style="font-size:72px">The Fifth Relic</h1>
      <h3>The bearers</h3>${names}<h3>Ending reached</h3><p>${esc(E.title)}</p>
      <h3>Design, code, world, creatures, music and sound</h3><p>Procedurally generated for this project</p>
      <h3>Built with</h3><p>three.js (MIT), ws (MIT), Node.js</p><h3>Typefaces</h3><p>Big Shoulders Stencil, Instrument Sans (SIL Open Font License)</p>
      <h3>Inspired by the cooperative spirit of trapped-in-a-game adventures</h3><p>All characters, places and words are original</p>
      <h3 style="margin-top:30vh">&nbsp;</h3><p style="font-style:italic;max-width:560px;margin:0 auto">${esc(ENDINGS.postCredits)}</p>
      <p style="margin-top:40px"><button id="btnEndMenu" class="primary" style="pointer-events:auto">Return to the menu</button></p></div>`;
    $('btnEndMenu').onclick = () => { sessionStorage.removeItem('fr.resume'); location.reload(); };
  }, 1500 + E.lines.length * 4000 + 14000);
}

frame();
// Boot: title waits for a key/click (audio needs a user gesture).
$('pressKey').textContent = 'Click or press any key to begin'; show('pressKey');
