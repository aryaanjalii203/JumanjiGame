// Three.js world renderer. All models are procedural low-poly primitives (original, no external assets).
import * as THREE from 'three';
import { WORLD, baseHeight, groundHeight, inRavine, RAVINE, BRIDGE, LOG, ARENA, HEART, POINTS, rng, regionAt, pathX } from '/shared/world.js';
import { AVATARS, GLYPHS } from '/shared/data.js';

const lerp = (a, b, k) => a + (b - a) * k;
const C = (hex) => new THREE.Color(hex);
const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...o });

const REGION_LOOK = {
  wilds:  { sky: 0x1f3a33, fog: 0x2a4639, density: 0.022, rain: 1, wind: 0.6, sun: 0.55 },
  ravine: { sky: 0x2b4542, fog: 0x34504a, density: 0.016, rain: 0.45, wind: 1, sun: 0.75 },
  ruins:  { sky: 0x3b3a30, fog: 0x4a4636, density: 0.014, rain: 0.1, wind: 0.3, sun: 0.9 },
  peaks:  { sky: 0x2a2526, fog: 0x3a3030, density: 0.018, rain: 0, wind: 0.9, sun: 0.6, ash: 1 },
  heart:  { sky: 0x140f22, fog: 0x1f1733, density: 0.02, rain: 0, wind: 0.2, sun: 0.35, motes: 1 },
};

const glyphTex = new Map();
export function glyphTexture(i, color = '#7ff0c4') {
  const key = `${i}${color}`;
  if (glyphTex.has(key)) return glyphTex.get(key);
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = color; g.font = '92px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = color; g.shadowBlur = 16; g.fillText(GLYPHS[i] ?? '?', 64, 70);
  const t = new THREE.CanvasTexture(cv); glyphTex.set(key, t); return t;
}
function textSprite(text, { color = '#e8dfc8', size = 44, w = 256, scale = 1.6, bg = null, depth = false, screen = false } = {}) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = 64;
  const g = cv.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 8, w, 48); }
  g.font = `600 ${size}px "Instrument Sans", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.75)'; g.strokeText(text, w / 2, 34); g.fillStyle = color; g.fillText(text, w / 2, 34);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true }));
  sp.scale.set(scale * w / 64, scale, 1); sp.renderOrder = 10; sp.material.depthTest = !!depth;
  if (screen) { sp.material.sizeAttenuation = false; sp.scale.set(0.042 * w / 64, 0.042, 1); }
  return sp;
}

export class World3D {
  constructor(canvas, settings) {
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = !!settings.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 420);
    this.look = { ...REGION_LOOK.wilds };
    this.scene.background = C(this.look.sky);
    this.scene.fog = new THREE.FogExp2(this.look.fog, this.look.density);
    this.hemi = new THREE.HemisphereLight(0xbfe8d0, 0x22301f, 0.9); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffe7c2, 1.4);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 150 });
    this.scene.add(this.sun, this.sun.target);
    this.players = new Map(); this.creatures = new Map(); this.objects = new Map();
    this.tels = []; this.fx = []; this.pings = []; this.telSeen = new Map();
    this.boss = null; this.t = 0; this.flash = 0; this.shake = 0;
    this.buildStatic();
    this.buildWeather();
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ static world
  buildStatic() {
    const S = this.scene;
    // Terrain with vertex colours by region; the ravine is carved into it.
    const W = 124, L = 560, geo = new THREE.PlaneGeometry(W, L, 124, 280);
    geo.rotateX(-Math.PI / 2); geo.translate(0, 0, 268);
    const pos = geo.attributes.position, cols = [];
    const R = rng(7);
    const col = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      let y = baseHeight(x, z);
      if (inRavine(x, z)) y = -38 + Math.min(4, Math.min(z - RAVINE.z0, RAVINE.z1 - z)) * 0;
      if (Math.abs(x) > 54) y += (Math.abs(x) - 54) * 6;   // cliff walls
      pos.setY(i, y);
      const n = R() * 0.08;
      if (inRavine(x, z) || (Math.abs(z - RAVINE.z0) < 1.5 || Math.abs(z - RAVINE.z1) < 1.5)) col.setRGB(0.28 + n, 0.22 + n, 0.17, THREE.SRGBColorSpace);
      else if (z > 452) col.setRGB(0.12 + n, 0.09, 0.18 + n, THREE.SRGBColorSpace);
      else if (Math.hypot(x - ARENA.x, z - ARENA.z) < ARENA.r + 6) col.setRGB(0.2 + n, 0.18 + n, 0.17 + n, THREE.SRGBColorSpace);
      else if (z > 255 && z < 345 && Math.abs(x) < 44) col.setRGB(0.45 + n, 0.42 + n, 0.34 + n, THREE.SRGBColorSpace);
      else if (Math.abs(x - pathX(z)) < 2.6 && z < 255) col.setRGB(0.36 + n, 0.27 + n, 0.16, THREE.SRGBColorSpace);
      else if (Math.abs(x) > 52) col.setRGB(0.22, 0.25 + n, 0.2, THREE.SRGBColorSpace);
      else col.setRGB(0.13 + n * 0.5, 0.3 + n, 0.12 + n * 0.4, THREE.SRGBColorSpace);
      cols.push(col.r, col.g, col.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
    terrain.receiveShadow = true; S.add(terrain);
    // River at the bottom of the ravine.
    const river = new THREE.Mesh(new THREE.PlaneGeometry(W, RAVINE.z1 - RAVINE.z0), new THREE.MeshStandardMaterial({ color: 0x1f4f5a, roughness: 0.2, metalness: 0.3, emissive: 0x081e22 }));
    river.rotation.x = -Math.PI / 2; river.position.set(0, -33, (RAVINE.z0 + RAVINE.z1) / 2); S.add(river);
    // Mist in the ravine.
    const mist = new THREE.Mesh(new THREE.PlaneGeometry(W, 22), new THREE.MeshBasicMaterial({ color: 0x9fc4bb, transparent: true, opacity: 0.18, depthWrite: false }));
    mist.rotation.x = -Math.PI / 2; mist.position.set(0, -8, 175); S.add(mist);

    // Trees (instanced).
    const trees = WORLD.trees;
    const trunkG = new THREE.CylinderGeometry(0.35, 0.6, 1, 6); trunkG.translate(0, 0.5, 0);
    const trunk = new THREE.InstancedMesh(trunkG, mat(0x4a3423), trees.length);
    const broadG = new THREE.IcosahedronGeometry(1, 0);
    const broad = new THREE.InstancedMesh(broadG, mat(0x2f6b3a), trees.length * 2);
    const palmG = new THREE.ConeGeometry(1, 0.6, 7);
    const palm = new THREE.InstancedMesh(palmG, mat(0x4f8a3c), trees.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    let nb = 0, np = 0;
    trees.forEach((t, i) => {
      const y = baseHeight(t.x, t.z);
      const rr = t.canopy ? 1.5 : t.r;
      m4.compose(v.set(t.x, y, t.z), q.identity(), sc.set(rr * 1.4, t.h, rr * 1.4)); trunk.setMatrixAt(i, m4);
      if (t.kind === 'palm') {
        e.set(0, i, 0); q.setFromEuler(e);
        m4.compose(v.set(t.x, y + t.h, t.z), q, sc.set(t.h * 0.35, t.h * 0.12, t.h * 0.35)); palm.setMatrixAt(np++, m4);
      } else {
        const s = t.canopy ? 7 : t.h * 0.32;
        e.set(i, i * 2, 0); q.setFromEuler(e);
        m4.compose(v.set(t.x, y + t.h, t.z), q, sc.set(s, s * 0.7, s)); broad.setMatrixAt(nb++, m4);
        m4.compose(v.set(t.x + s * 0.4, y + t.h - s * 0.4, t.z - s * 0.3), q, sc.set(s * 0.7, s * 0.5, s * 0.7)); broad.setMatrixAt(nb++, m4);
      }
    });
    broad.count = nb; palm.count = np;
    for (const m of [trunk, broad, palm]) { m.castShadow = true; S.add(m); }
    // Ground cover (ferns).
    const R2 = rng(42), fernG = new THREE.ConeGeometry(0.5, 0.9, 5); fernG.translate(0, 0.45, 0);
    const ferns = new THREE.InstancedMesh(fernG, mat(0x3c7a3a), 1800); let nf = 0;
    for (let i = 0; i < 4000 && nf < 1800; i++) {
      const x = (R2() * 2 - 1) * 52, z = R2() * 250;
      if (inRavine(x, z) || Math.abs(x - pathX(z)) < 2.5) continue;
      m4.compose(v.set(x, baseHeight(x, z), z), q.identity(), sc.setScalar(0.6 + R2() * 1.2)); ferns.setMatrixAt(nf++, m4);
    }
    ferns.count = nf; S.add(ferns);
    // Rocks and arena columns.
    const rockG = new THREE.DodecahedronGeometry(1, 0);
    const rocks = WORLD.circles.filter(c => c.rock && !c.big);
    const rockM = new THREE.InstancedMesh(rockG, mat(0x6b6a5e), rocks.length);
    rocks.forEach((c, i) => { m4.compose(v.set(c.x, baseHeight(c.x, c.z) + c.top * 0.4, c.z), q.setFromEuler(e.set(i, i, 0)), sc.set(c.r, c.top, c.r)); rockM.setMatrixAt(i, m4); });
    rockM.castShadow = rockM.receiveShadow = true; S.add(rockM);
    const cols2 = WORLD.circles.filter(c => c.big);
    const colM = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1.15, 1, 6), mat(0x2c2627), cols2.length);
    cols2.forEach((c, i) => { const h = 10 + (i * 7 % 9); m4.compose(v.set(c.x, h / 2 - 1, c.z), q.setFromEuler(e.set(0, i, 0)), sc.set(c.r, h, c.r)); colM.setMatrixAt(i, m4); });
    colM.castShadow = true; S.add(colM);
    // Temple pillars bases.
    for (const p of POINTS.pillars) { const m = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 5, 8), mat(0x8a8470)); m.position.set(p.x, 2.5, p.z); m.castShadow = true; S.add(m); }

    // Boxes (walls, gates, station).
    const DECO = {
      station: [0x5c6a68, 4.2], crate: [0x6d5a3a, null], ruin: [0x6f6a58, 3], temple: [0x8a8470, 7.5], gate: [0x6a5f48, 6.5],
      cracked: [0x7a7462, 7], ledge: [0x6b6a5e, null], lab: [0x4d5557, 5], heart: [0x231a33, 11], void: [0x0b0b10, 38],
    };
    this.gates = new Map();
    for (const b of WORLD.boxes) {
      const [color, hh] = DECO[b.deco] || [0x777777, 4];
      const h = b.top === Infinity ? hh : b.top;
      const m = new THREE.Mesh(new THREE.BoxGeometry(b.x1 - b.x0, h, b.z1 - b.z0), mat(color, b.deco === 'heart' ? { emissive: 0x1a0f2e } : {}));
      const gy = b.deco === 'heart' || b.deco === 'lab' || b.deco === 'void' ? 0 : baseHeight((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
      m.position.set((b.x0 + b.x1) / 2, gy + h / 2, (b.z0 + b.z1) / 2);
      m.castShadow = m.receiveShadow = true; S.add(m);
      if (b.deco === 'gate' || b.deco === 'cracked') {
        if (b.deco === 'gate') { const gl = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: glyphTexture(b.id === 'heartDoor' ? 5 : 2, '#f2a33a'), transparent: true })); gl.position.set(0, 0.5, -(b.z1 - b.z0) / 2 - 0.02); gl.rotation.y = Math.PI; m.add(gl); }
        if (b.deco === 'cracked') { for (let k = 0; k < 4; k++) { const cr = new THREE.Mesh(new THREE.BoxGeometry(0.1, 4 + k, 0.15), mat(0x2a261e)); cr.position.set(-(b.x1 - b.x0) / 2 - 0.02, 0, -3 + k * 2); cr.rotation.x = k * 0.5 - 0.7; m.add(cr); } }
        this.gates.set(b.id, { mesh: m, baseY: m.position.y, h });
      }
      if (b.deco === 'heart') { const strip = new THREE.Mesh(new THREE.BoxGeometry(b.x1 - b.x0 + 0.05, 0.15, b.z1 - b.z0 + 0.05), new THREE.MeshBasicMaterial({ color: 0x9a6bff })); strip.position.y = -h / 2 + 2.5; m.add(strip); }
    }
    // Mural (clue) wall face.
    // Bridge: hinged at the far edge; lowers as the winches turn.
    this.bridge = new THREE.Group(); this.bridge.position.set(0, 0.3, RAVINE.z1);
    const deck = new THREE.Group();
    for (let i = 0; i < 20; i++) { const pl = new THREE.Mesh(new THREE.BoxGeometry(BRIDGE.x1 - BRIDGE.x0, 0.2, 0.85), mat(i % 3 ? 0x7a5a36 : 0x6a4c2c)); pl.position.set(0, 0, -0.5 - i); pl.castShadow = true; deck.add(pl); }
    for (const sx of [-1, 1]) { const rope = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 20), mat(0xc9b48a)); rope.position.set(sx * 3, 1, -10); deck.add(rope); }
    this.bridge.add(deck); S.add(this.bridge); this.bridgeK = 0;
    // Broken stub on the near side.
    for (const z of [RAVINE.z0 - 0.5]) { const st = new THREE.Mesh(new THREE.BoxGeometry(6, 0.3, 1), mat(0x6a4c2c)); st.position.set(0, 0.2, z); S.add(st); }
    // Fallen log.
    this.log = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 23, 9), mat(0x5a4027));
    this.log.castShadow = true; S.add(this.log); this.logK = 0;
    // Winch housings near each winch are added as objects. Cradle, relic plinth etc. likewise.
    // Floating heart crystal (always visible in Region E).
    const heartGem = new THREE.Mesh(new THREE.OctahedronGeometry(2.5, 0), new THREE.MeshStandardMaterial({ color: 0x9a6bff, emissive: 0x5b2fd0, flatShading: true }));
    heartGem.position.set(HEART.x, 16, HEART.z); S.add(heartGem); this.heartGem = heartGem;
    const hl = new THREE.PointLight(0x9a6bff, 40, 60); hl.position.set(HEART.x, 10, HEART.z); S.add(hl);
    // Waypoint beacon.
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 60, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0x7ff0c4, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
    this.beacon.visible = false; S.add(this.beacon);
  }

  buildWeather() {
    const n = 3500, g = new THREE.BufferGeometry(), p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { p[i * 3] = (Math.random() - 0.5) * 70; p[i * 3 + 1] = Math.random() * 30; p[i * 3 + 2] = (Math.random() - 0.5) * 70; }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.rain = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xaed4e6, size: 0.09, transparent: true, opacity: 0.6, depthWrite: false }));
    this.scene.add(this.rain);
    const g2 = new THREE.BufferGeometry(), p2 = new Float32Array(600 * 3);
    for (let i = 0; i < 600; i++) { p2[i * 3] = (Math.random() - 0.5) * 60; p2[i * 3 + 1] = Math.random() * 20; p2[i * 3 + 2] = (Math.random() - 0.5) * 60; }
    g2.setAttribute('position', new THREE.BufferAttribute(p2, 3));
    this.motes = new THREE.Points(g2, new THREE.PointsMaterial({ color: 0xc9b8ff, size: 0.18, transparent: true, opacity: 0, depthWrite: false }));
    this.scene.add(this.motes);
    this.nextLightning = 8;
  }

  // ------------------------------------------------------------------ models
  makeAvatar(id, outfit = 'expedition', build = 'm') {
    const fem = build === 'f';
    const A = AVATARS[id];
    let main = C(A.color), dark = C(A.color).multiplyScalar(0.45);
    if (outfit === 'nightfall') { main = C(A.color).multiplyScalar(0.4); dark = C(0x15181a); }
    const glowColor = outfit === 'relic' ? 0x7ff0c4 : 0x000000;
    const mMain = mat(main, { emissive: glowColor, emissiveIntensity: outfit === 'relic' ? 0.25 : 0 });
    const mDark = mat(dark), mSkin = mat(0xb08868), mMetal = mat(0x9aa3a6, { metalness: 0.6, roughness: 0.4 });
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const box = (w, h, d, m, x, y, z, parent = body) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; parent.add(b); return b; };
    const limb = (w, h, m, x, y) => { const piv = new THREE.Group(); piv.position.set(x, y, 0); body.add(piv); box(w, h, w, m, 0, -h / 2, 0, piv); return piv; };
    const wide = { titan: 1.5, wraith: 0.9, circuit: 1.05, oracle: 1.05, phantom: 1 }[id];
    const legL = limb(0.32 * wide, 0.95, mDark, -0.22 * wide, 0.95), legR = limb(0.32 * wide, 0.95, mDark, 0.22 * wide, 0.95);
    const torso = box(0.75 * wide * (fem ? 0.84 : 1), 0.9, 0.45 * wide * (fem ? 0.9 : 1), mMain, 0, 1.4, 0);
    const head = box(fem ? 0.38 : 0.42, fem ? 0.4 : 0.42, fem ? 0.38 : 0.42, mSkin, 0, 2.08, 0);
    if (fem) {
      // Feminine build: hips, shoulder-length hair and a ponytail.
      const mHair = mat(outfit === 'nightfall' ? 0x15100c : 0x3a2416);
      box(0.72 * wide, 0.28, 0.46 * wide, mDark, 0, 0.98, 0);
      box(0.44, 0.12, 0.44, mHair, 0, 2.32, 0);
      box(0.44, 0.5, 0.12, mHair, 0, 2.02, -0.21);
      box(0.08, 0.36, 0.38, mHair, -0.21, 2.1, -0.02); box(0.08, 0.36, 0.38, mHair, 0.21, 2.1, -0.02);
      const tail = box(0.14, 0.5, 0.14, mHair, 0, 1.85, -0.33); tail.rotation.x = 0.25;
    }
    const armL = limb(0.24 * wide, 0.85, mMain, -0.52 * wide, 1.8), armR = limb(0.24 * wide, 0.85, mMain, 0.52 * wide, 1.8);
    let weapon;
    if (id === 'titan') {
      box(0.5, 0.25, 0.6, mDark, -0.75, 1.88, 0); box(0.5, 0.25, 0.6, mDark, 0.75, 1.88, 0);
      weapon = new THREE.Group(); box(0.12, 1.5, 0.12, mDark, 0, -0.5, 0.2, weapon); box(0.55, 0.4, 0.4, mMetal, 0, -1.2, 0.2, weapon);
    } else if (id === 'wraith') {
      const hood = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.6, 6), mDark); hood.position.set(0, 2.32, -0.03); body.add(hood);
      box(0.6, 0.12, 0.5, mDark, 0, 1.82, 0);
      weapon = new THREE.Group(); box(0.05, 0.7, 0.12, mMetal, 0, -0.9, 0.25, weapon);
      const b2 = box(0.05, 0.7, 0.12, mMetal, 0, -0.9, 0.25, new THREE.Group()); armL.add(b2.parent);
    } else if (id === 'circuit') {
      box(0.55, 0.6, 0.35, mDark, 0, 1.45, -0.4);
      const ant = box(0.04, 0.8, 0.04, mMetal, 0.2, 2.1, -0.45); const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07), new THREE.MeshBasicMaterial({ color: 0xf2a33a })); tip.position.y = 0.42; ant.add(tip);
      const gog = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.04, 6, 10), mMetal); gog.position.set(-0.1, 2.12, 0.22); body.add(gog); const gog2 = gog.clone(); gog2.position.x = 0.1; body.add(gog2);
      weapon = new THREE.Group(); box(0.08, 0.6, 0.08, mMetal, 0, -0.85, 0.15, weapon); box(0.25, 0.1, 0.1, mMetal, 0, -1.15, 0.15, weapon);
    } else if (id === 'oracle') {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 10), mDark); brim.position.y = 2.32; body.add(brim);
      const crown = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.35, 8), mDark); crown.position.y = 2.5; body.add(crown);
      box(0.3, 0.35, 0.15, mDark, -0.4, 1.2, 0.25);
      weapon = new THREE.Group(); box(0.07, 2.2, 0.07, mat(0x5b4026), 0, -0.6, 0.2, weapon);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.14), new THREE.MeshBasicMaterial({ color: 0x9ff07f })); gem.position.set(0, 0.55, 0.2); weapon.add(gem);
    } else {
      const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.62, 1.1, 8, 1, true), mDark); coat.position.y = 0.75; body.add(coat);
      box(0.3, 0.2, 0.05, mat(0xd9d4c7), 0, 2.08, 0.22);
      weapon = new THREE.Group(); box(0.08, 0.1, 1.2, mDark, 0, -0.75, 0.45, weapon); box(0.05, 0.05, 0.5, mMetal, 0, -0.72, 1.2, weapon);
    }
    armR.add(weapon);
    // Life marks on the forearm: three glowing notches.
    const marks = [0, 1, 2].map(i => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.05), new THREE.MeshBasicMaterial({ color: 0x7ff0c4 })); m.position.set(-0.13 * wide, -0.4 - i * 0.13, 0.09); armL.add(m); return m; });
    const sc = A.scale; g.scale.setScalar(sc);
    g.userData = { legL, legR, armL, armR, body, torso, head, marks, phase: 0, swing: 0, mats: [mMain, mDark, mSkin, mMetal] };
    return g;
  }

  makeCreature(type) {
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const legs = [];
    const box = (w, h, d, m, x, y, z, p = body) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; p.add(b); return b; };
    const eye = new THREE.MeshBasicMaterial({ color: 0xff4a2a });
    if (type === 'razorback') {
      const hide = mat(0x5a3324), dark = mat(0x2a1a14), tusk = mat(0xe9e0c8);
      box(1.0, 0.8, 1.7, hide, 0, 0.95, 0); box(0.7, 0.6, 0.6, hide, 0, 0.95, 1.05);
      for (const sx of [-0.2, 0.2]) { const t = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.45, 5), tusk); t.position.set(sx, 0.8, 1.4); t.rotation.x = 1.9; body.add(t); box(0.08, 0.08, 0.05, eye, sx * 1.2, 1.1, 1.36); }
      for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.45, 4), dark); s.position.set(0, 1.45, 0.6 - i * 0.3); body.add(s); }
      for (const [x, z] of [[-0.35, 0.55], [0.35, 0.55], [-0.35, -0.55], [0.35, -0.55]]) { const p = new THREE.Group(); p.position.set(x, 0.6, z); body.add(p); box(0.2, 0.6, 0.2, dark, 0, -0.3, 0, p); legs.push(p); }
    } else if (type === 'stalker') {
      const fur = mat(0x2a1f38), spot = mat(0x4b3a64);
      box(0.7, 0.6, 2.0, fur, 0, 1.2, 0); box(0.55, 0.5, 0.6, fur, 0, 1.45, 1.2);
      for (const sx of [-0.15, 0.15]) box(0.1, 0.06, 0.05, new THREE.MeshBasicMaterial({ color: 0x5ff0d0 }), sx, 1.55, 1.51);
      for (let i = 0; i < 4; i++) box(0.2, 0.05, 0.25, spot, (i % 2 - 0.5) * 0.4, 1.51, 0.6 - i * 0.4);
      const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 1.8, 5), fur); tail.position.set(0, 1.5, -1.6); tail.rotation.x = -0.9; body.add(tail);
      for (const [x, z] of [[-0.3, 0.7], [0.3, 0.7], [-0.3, -0.7], [0.3, -0.7]]) { const p = new THREE.Group(); p.position.set(x, 0.95, z); body.add(p); box(0.14, 0.95, 0.14, fur, 0, -0.47, 0, p); legs.push(p); }
    } else if (type === 'guardian') {
      const stone = mat(0x77736a), moss = mat(0x3f5f34);
      box(1.6, 1.6, 1.1, stone, 0, 2.0, 0); box(0.7, 0.6, 0.7, stone, 0, 3.1, 0.1); box(1.7, 0.25, 1.15, moss, 0, 2.85, 0);
      box(0.25, 0.1, 0.05, new THREE.MeshBasicMaterial({ color: 0xf2a33a }), 0, 3.15, 0.46);
      const rune = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ map: glyphTexture(1, '#f2a33a'), transparent: true }));
      rune.position.set(0, 2.1, -0.56); rune.rotation.y = Math.PI; body.add(rune);   // the weak point is visibly on the back
      for (const sx of [-1, 1]) { const p = new THREE.Group(); p.position.set(sx * 1.05, 2.6, 0); body.add(p); box(0.55, 1.6, 0.55, stone, 0, -0.8, 0, p); legs.push(p); }
      for (const sx of [-1, 1]) { const p = new THREE.Group(); p.position.set(sx * 0.45, 1.2, 0); body.add(p); box(0.5, 1.2, 0.5, stone, 0, -0.6, 0, p); legs.push(p); }
    }
    const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), new THREE.MeshBasicMaterial({ color: 0xe4573d }));
    marker.position.y = 3.6; marker.visible = false; g.add(marker);
    const hp = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.12), new THREE.MeshBasicMaterial({ color: 0xe4573d, depthTest: false }));
    hp.position.y = type === 'guardian' ? 4 : 2.4; hp.renderOrder = 9; hp.visible = false; g.add(hp);
    g.userData = { body, legs, marker, hp, phase: Math.random() * 6 };
    return g;
  }

  makeObject(o) {
    const g = new THREE.Group();
    const add = (m, x = 0, y = 0, z = 0) => { m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
    const glow = (color) => new THREE.MeshBasicMaterial({ color });
    switch (o.k) {
      case 'herb': add(new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.6, 5), mat(0x7fd06a, { emissive: 0x2a6a20 })), 0, 0.3); add(new THREE.Mesh(new THREE.SphereGeometry(0.12), glow(0xd9ff8a)), 0, 0.7); break;
      case 'cache': add(new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 0.9), mat(0x6d5a3a)), 0, 0.4); add(textSprite('supplies', { size: 30, scale: 0.6, color: '#f2a33a' }), 0, 1.3); break;
      case 'record': add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.12), mat(0x3a4a44, { emissive: 0x1a5a48 })), 0, 0.9); add(new THREE.PointLight(0x7ff0c4, 6, 6), 0, 1.4); break;
      case 'shrine': add(new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 1.2, 6), mat(0x7a7462)), 0, 0.6); add(new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 6), glow(0x7ff0c4)), 0, 1.6); add(new THREE.PointLight(0x7ff0c4, 8, 8), 0, 2); break;
      case 'campfire': for (let i = 0; i < 5; i++) { const l = add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.2), mat(0x4a3423))); l.rotation.set(1.2, i * 1.25, 0); l.position.y = 0.2; }
        g.userData.flame = add(new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 6), glow(0xf2a33a)), 0, 0.6); g.userData.light = add(new THREE.PointLight(0xffa040, 18, 14), 0, 1.5);
        { const tent = add(new THREE.Mesh(new THREE.ConeGeometry(1.8, 2.2, 4), mat(0x8a7a52)), -4, 1.1, 3); tent.rotation.y = 0.8; } break;
      case 'marker': case 'camp': { const t = add(new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.6, 4), mat(0x7a6c48)), 0, 1.3); t.rotation.y = 0.4; break; }
      case 'fragment': add(new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.5), new THREE.MeshStandardMaterial({ color: 0xe8dfc8, side: THREE.DoubleSide, emissive: 0x403a28 })), 0, 0.9).rotation.x = -0.6; add(new THREE.PointLight(0xf2e3b0, 5, 5), 0, 1.5); break;
      case 'winch': { add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 1.0), mat(0x5c4a32)), 0, 0.5); const drum = add(new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.4, 10), mat(0x8a7a5a)), 0, 1.4); drum.rotation.z = Math.PI / 2;
        const handle = add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.1), mat(0x9aa3a6)), 0.8, 1.4); g.userData.drum = drum; g.userData.handle = handle;
        g.userData.spark = add(new THREE.Mesh(new THREE.SphereGeometry(0.15), glow(0xe4573d)), 0, 2.2); break; }
      case 'log': break;   // rendered by the world (animated crossing)
      case 'plate': case 'anchor': {
        add(new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.8, 0.2, 16), mat(0x7a7462)), 0, 0.1);
        g.userData.lit = add(new THREE.Mesh(new THREE.CircleGeometry(1.3, 20), glow(0x3a4a40)), 0, 0.22); g.userData.lit.rotation.x = -Math.PI / 2;
        if (o.k === 'anchor') { add(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 3, 8), mat(0x4a4a4a, { metalness: 0.6 })), 0, 1.5); g.userData.chain = true; }
        break;
      }
      case 'mural': { const m = add(new THREE.Mesh(new THREE.PlaneGeometry(9, 3), new THREE.MeshStandardMaterial({ color: 0xbdb39a })), 0, 3.4); m.rotation.y = Math.PI; g.userData.mural = m; break; }
      case 'pillar': { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glyphTexture(0), transparent: true })); sp.scale.setScalar(1.6); add(sp, 0, 5.8, 1.6); g.userData.glyph = sp; g.userData.g = -1;
        g.userData.ring = add(new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.08, 6, 24), glow(0x7ff0c4)), 0, 5.2, 1.6); g.userData.ring.rotation.x = Math.PI / 2; break; }
      case 'key': g.userData.spin = add(new THREE.Mesh(new THREE.TorusKnotGeometry(0.3, 0.08, 40, 6), new THREE.MeshStandardMaterial({ color: 0xf2c94a, metalness: 0.8, roughness: 0.3, emissive: 0x6a4a10 })), 0, 1.6);
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 1, 6), mat(0x8a8470)), 0, 0.5); add(new THREE.PointLight(0xf2c94a, 12, 10), 0, 2.5); break;
      case 'cracked': break;
      case 'portal': { const ring = add(new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.3, 10, 40), glow(0x7ff0c4)), 0, 3); g.userData.spin = ring;
        const disc = add(new THREE.Mesh(new THREE.CircleGeometry(2.4, 32), new THREE.MeshBasicMaterial({ color: 0xbffff0, transparent: true, opacity: 0.45, side: THREE.DoubleSide })), 0, 3); disc.userData.pulse = true; g.userData.disc = disc;
        add(new THREE.PointLight(0x7ff0c4, 30, 20), 0, 3); break; }
      case 'terminal': add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, 0.8), mat(0x6a6f66)), 0, 0.7); g.userData.screen = add(new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), glow(0x2a6a4a)), 0, 1.05, 0.41); break;
      case 'altar': { const c = { restore: 0x7ff0c4, destroy: 0xe4573d, separate: 0xd79cff }[o.choice] || 0xffffff;
        add(new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 1.4), mat(0x2b2238)), 0, 0.6); g.userData.flame = add(new THREE.Mesh(new THREE.OctahedronGeometry(0.45), glow(c)), 0, 1.9); add(new THREE.PointLight(c, 14, 10), 0, 2.4); break; }
      case 'relic': g.userData.spin = add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.25, 0.9), new THREE.MeshStandardMaterial({ color: 0x3a3048, emissive: 0x9a6bff, emissiveIntensity: 0.5, metalness: 0.5 })), 0, 1.4);
        for (let i = 0; i < 5; i++) add(new THREE.Mesh(new THREE.SphereGeometry(0.05), glow(0x7ff0c4)), -0.2 + i * 0.1, 1.55, 0.3); add(new THREE.PointLight(0x9a6bff, 14, 12), 0, 2); break;
      case 'cradle': add(new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 0.8, 10), mat(0x2b2238, { emissive: 0x24104a })), 0, 0.4); g.userData.chan = add(new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.1, 30, 1, true), new THREE.MeshBasicMaterial({ color: 0x7ff0c4, transparent: true, opacity: 0, side: THREE.DoubleSide })), 0, 1); break;
      case 'node': g.userData.crys = add(new THREE.Mesh(new THREE.OctahedronGeometry(1.2, 0), new THREE.MeshStandardMaterial({ color: 0xd79cff, emissive: 0x5b2fd0, flatShading: true, transparent: true })), 0, 2.2);
        g.userData.shield = add(new THREE.Mesh(new THREE.SphereGeometry(1.9, 16, 12), new THREE.MeshBasicMaterial({ color: 0x9a6bff, transparent: true, opacity: 0.25, depthWrite: false })), 0, 2.2); break;
      case 'stone': add(new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.1, 2.2, 7), mat(0x50456a)), 0, 1.1); { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glyphTexture(o.g ?? 0, '#d79cff'), transparent: true })); sp.scale.setScalar(1.3); add(sp, 0, 3); } break;
      case 'decoy': add(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 0.6, 8), mat(0xe0c23a, { emissive: 0x6a5a10 })), 0, 0.3); g.userData.spin = add(new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 6, 20), glow(0xf2a33a)), 0, 0.8); break;
      default: add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mat(0xffffff)), 0, 0.5);
    }
    return g;
  }

  makeColossus() {
    const g = new THREE.Group(), stone = mat(0x4b4542), dark = mat(0x2a2524), plateM = mat(0x8a7a5a, { metalness: 0.3 });
    const legs = [], plates = [];
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.4, 8, 7), stone); leg.position.set(Math.cos(a) * 3.4, 4, Math.sin(a) * 3.4); leg.castShadow = true; g.add(leg); legs.push(leg);
      const pl = new THREE.Mesh(new THREE.BoxGeometry(1.8, 3, 0.5), plateM); pl.position.set(Math.cos(a) * 4.3, 3, Math.sin(a) * 4.3); pl.lookAt(Math.cos(a) * 10, 3, Math.sin(a) * 10); g.add(pl); plates.push(pl);
    }
    const torso = new THREE.Group(); torso.position.y = 9; g.add(torso);
    const chest = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 5), stone); chest.castShadow = true; torso.add(chest);
    for (let i = 0; i < 5; i++) { const rib = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.25, 5, 10, Math.PI), dark); rib.position.set(-2 + i, -1.5, 2.3); rib.rotation.y = Math.PI / 2; torso.add(rib); }
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3, 1), new THREE.MeshBasicMaterial({ color: 0xf2a33a })); core.position.set(0, -1.2, 1.4); torso.add(core);
    const head = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2, 2.4), stone); head.position.set(0, 3, 1.2); torso.add(head);
    for (const sx of [-0.6, 0.6]) { const e = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.1), new THREE.MeshBasicMaterial({ color: 0xff6a3a })); e.position.set(sx, 3.2, 2.45); torso.add(e); }
    const light = new THREE.PointLight(0xf2a33a, 30, 25); light.position.set(0, -1, 3); torso.add(light);
    g.userData = { legs, plates, torso, core, light };
    this.chains = [0, 1].map(() => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x9aa3a6 })); this.scene.add(l); return l; });
    return g;
  }

  makeCurator() {
    const g = new THREE.Group();
    const robe = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.6, 8), mat(0x2d1f45, { emissive: 0x1a0f2e })); robe.position.y = 1.6; g.add(robe);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 8), mat(0xd8d0c0)); head.position.y = 3.1; g.add(head);
    const mask = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.3), new THREE.MeshBasicMaterial({ color: 0xd79cff })); mask.position.set(0, 3.12, 0.37); g.add(mask);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.05, 6, 30), new THREE.MeshBasicMaterial({ color: 0xd79cff })); halo.position.y = 3.6; halo.rotation.x = Math.PI / 2; g.add(halo);
    const shield = new THREE.Mesh(new THREE.SphereGeometry(2.4, 20, 14), new THREE.MeshBasicMaterial({ color: 0x9a6bff, transparent: true, opacity: 0.22, depthWrite: false })); shield.position.y = 1.8; g.add(shield);
    g.userData = { halo, shield };
    return g;
  }

  // ------------------------------------------------------------------ per-frame sync
  sync(view, dt, me) {
    this.t += dt;
    const S = this.scene;
    // Players.
    const seenP = new Set();
    for (const p of view.players) {
      seenP.add(p.s);
      let e = this.players.get(p.s);
      if (!e || e.avatar !== p.a || e.outfit !== p.o || e.build !== p.g) {
        if (e) S.remove(e.g);
        const g = this.makeAvatar(p.a, p.o, p.g); S.add(g);
        const tag = textSprite(p.n, { size: 34, color: p.s === me ? '#7ff0c4' : '#e8dfc8', depth: true, screen: true }); tag.position.y = 2.9; g.add(tag);
        e = { g, avatar: p.a, outfit: p.o, build: p.g, tag, name: p.n, last: { x: p.x, z: p.z } };
        this.players.set(p.s, e);
      }
      if (e.name !== p.n) { e.g.remove(e.tag); e.tag = textSprite(p.n, { size: 34, depth: true, screen: true }); e.tag.position.y = 2.9; e.g.add(e.tag); e.name = p.n; }
      this.poseAvatar(e, p, dt, p.s === me);
    }
    for (const [s, e] of this.players) if (!seenP.has(s)) { S.remove(e.g); this.players.delete(s); }
    // Creatures.
    const seenC = new Set();
    for (const c of view.creatures) {
      seenC.add(c.i);
      let e = this.creatures.get(c.i);
      if (!e) { const g = this.makeCreature(c.k); S.add(g); e = { g, type: c.k, last: { x: c.x, z: c.z } }; this.creatures.set(c.i, e); }
      this.poseCreature(e, c, dt);
    }
    for (const [i, e] of this.creatures) if (!seenC.has(i)) { S.remove(e.g); this.creatures.delete(i); }
    // Objects.
    const seenO = new Set();
    for (const o of view.objects) {
      seenO.add(o.i);
      let e = this.objects.get(o.i);
      if (!e) { const g = this.makeObject(o); S.add(g); e = { g, kind: o.k }; this.objects.set(o.i, e); }
      this.poseObject(e, o, view, dt);
    }
    for (const [i, e] of this.objects) if (!seenO.has(i)) { S.remove(e.g); this.objects.delete(i); }
    // Dynamic world: gates, bridge, log.
    const open = new Set(view.dyn?.open || []);
    for (const [id, gte] of this.gates) {
      const target = open.has(id) ? gte.baseY - gte.h - 0.5 : gte.baseY;
      gte.mesh.position.y = lerp(gte.mesh.position.y, target, Math.min(1, dt * 1.5));
      gte.mesh.visible = gte.mesh.position.y > gte.baseY - gte.h - 0.3;
    }
    const bk = view.dyn?.bridge ? 1 : Math.min(1, (view.dyn?.bridgeP || 0) / 6);
    this.bridgeK = lerp(this.bridgeK, bk, Math.min(1, dt * 3));
    this.bridge.rotation.x = -(1 - this.bridgeK) * (Math.PI / 2 - 0.05);
    this.logK = lerp(this.logK, view.dyn?.log ? 1 : 0, Math.min(1, dt * 2));
    const lx = (LOG.x0 + LOG.x1) / 2;
    this.log.position.set(lerp(lx + 2, lx, this.logK), lerp(baseHeight(lx, 159) + 1, 0.0, this.logK), lerp(158.5, 175, this.logK));
    this.log.rotation.set(Math.PI / 2 * this.logK, 0, Math.PI / 2 * (1 - this.logK));
    // Boss.
    this.syncBoss(view.boss, dt);
    // Telegraphs.
    this.syncTelegraphs(view, dt);
    // Waypoint beacon.
    if (view.wp) { this.beacon.visible = true; this.beacon.position.set(view.wp.x, groundHeight(view.wp.x, view.wp.z, { open: new Set(), bridge: true, log: true }) + 30, view.wp.z); this.beacon.material.opacity = 0.12 + Math.sin(this.t * 2) * 0.05; }
    else this.beacon.visible = false;
    // Pings.
    for (const p of this.pings) { p.life -= dt; p.m.position.y += dt * 0.3; p.m.material.opacity = Math.min(1, p.life); if (p.life <= 0) S.remove(p.m); }
    this.pings = this.pings.filter(p => p.life > 0);
    this.heartGem.rotation.y += dt * 0.4; this.heartGem.position.y = 16 + Math.sin(this.t) * 0.6;
    this.updateFx(dt);
  }

  poseAvatar(e, p, dt, isMe) {
    const g = e.g, u = g.userData;
    const visible = p.st !== 'dead' && p.st !== 'out';
    g.visible = visible;
    if (!visible) return;
    const speed = Math.hypot(p.x - e.last.x, p.z - e.last.z) / Math.max(dt, 1e-3);
    e.last = { x: p.x, z: p.z };
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.yaw;
    u.phase += dt * Math.min(speed, 14) * 1.6;
    const sw = Math.min(1, speed / 5) * 0.7;
    u.legL.rotation.x = Math.sin(u.phase) * sw; u.legR.rotation.x = -Math.sin(u.phase) * sw;
    u.armL.rotation.x = -Math.sin(u.phase) * sw * 0.8;
    u.swing = Math.max(0, u.swing - dt * 4);
    u.armR.rotation.x = p.carry ? -1.2 : (u.swing > 0 ? -2.4 * Math.sin(u.swing * Math.PI) : Math.sin(u.phase) * sw * 0.8);
    if (p.carry) u.armL.rotation.x = -1.2;
    const downed = p.st === 'downed';
    u.body.rotation.x = lerp(u.body.rotation.x, downed ? -Math.PI / 2 : 0, Math.min(1, dt * 6));
    u.body.position.y = lerp(u.body.position.y, downed ? 0.3 : 0, Math.min(1, dt * 6));
    u.body.scale.y = lerp(u.body.scale.y, p.cr ? 0.72 : 1, Math.min(1, dt * 10));
    u.marks.forEach((m, i) => { m.material.color.setHex(i < p.l ? 0x7ff0c4 : 0x2d3d35); });
    const veil = p.fx?.veil > 0;
    for (const m of u.mats) { m.transparent = veil; m.opacity = veil ? (isMe ? 0.3 : 0.12) : 1; }
    const inv = (p.fx?.invuln > 0 || p.fx?.dodge > 0) && Math.floor(this.t * 12) % 2 === 0;
    for (const m of u.mats) m.emissive?.setHex(p.fx?.bulwark > 0 ? 0x5a3a10 : inv ? 0x303030 : (p.o === 'relic' && m === u.mats[0] ? 0x2a6a50 : 0));
    e.tag.visible = !isMe && this.camera.position.distanceTo(g.position) > 3;
  }

  poseCreature(e, c, dt) {
    const g = e.g, u = g.userData;
    const speed = Math.hypot(c.x - e.last.x, c.z - e.last.z) / Math.max(dt, 1e-3);
    e.last = { x: c.x, z: c.z };
    g.position.set(c.x, c.y, c.z);
    let dy = c.yaw - g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); g.rotation.y += dy * Math.min(1, dt * 12);
    u.phase += dt * Math.min(speed, 16) * 1.4;
    u.legs.forEach((l, i) => { l.rotation.x = Math.sin(u.phase + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * Math.min(0.8, speed / 6); });
    const dead = c.st === 'dead';
    u.body.rotation.z = lerp(u.body.rotation.z, dead ? Math.PI / 2 : 0, Math.min(1, dt * 5));
    u.body.rotation.x = c.st === 'windup' || c.st === 'slam' || c.st === 'swipe' ? -0.25 : c.st === 'rustle' ? 0.3 : 0;
    u.body.position.y = dead ? Math.max(-0.5, u.body.position.y - dt) : 0;
    // Hidden stalkers are invisible unless revealed by Mark/Track (then ghosted).
    const hidden = c.hid === 1;
    g.visible = !hidden;
    g.traverse(o => { if (o.material && o !== u.marker && o !== u.hp) { o.material.transparent = c.st === 'perch'; o.material.opacity = c.st === 'perch' ? 0.35 : 1; } });
    u.marker.visible = c.mk === 1 && !dead; u.marker.rotation.y += dt * 3;
    u.hp.visible = c.hp < c.mhp && !dead; u.hp.scale.x = Math.max(0.01, c.hp / c.mhp); u.hp.quaternion.copy(this.camera.quaternion);
    if (c.ov) u.body.children.forEach(ch => ch.material?.emissive?.setHex(Math.sin(this.t * 10) > 0 ? 0x5a4a00 : 0));
  }

  poseObject(e, o, view, dt) {
    const g = e.g, u = g.userData;
    const y = o.k === 'record' && o.y ? o.y : groundHeight(o.x, o.z, { open: new Set(), bridge: true, log: true });
    g.position.set(o.x, y, o.z);
    if (u.spin) u.spin.rotation.y += dt * 2;
    if (u.flame) u.flame.scale.y = 1 + Math.sin(this.t * 13 + o.i) * 0.15;
    if (u.light && o.k === 'campfire') u.light.intensity = 16 + Math.sin(this.t * 17) * 3;
    if (o.k === 'winch') { u.spark.visible = !!o.broken; if (o.busy) u.drum.rotation.x += dt * 4; u.handle.rotation.x = u.drum.rotation.x; }
    if (u.lit) u.lit.material.color.setHex(o.on ? 0x7ff0c4 : 0x3a4a40);
    if (u.chain && view.boss?.type === 'colossus') {
      const ch = this.chains?.[o.x < 0 ? 0 : 1]; const t = this.boss?.g.userData.torso;
      if (ch && t) { const wp = new THREE.Vector3(); t.getWorldPosition(wp); ch.geometry.setFromPoints([new THREE.Vector3(o.x, y + 3, o.z), wp]); ch.visible = true; ch.material.color.setHex(o.on ? 0x7ff0c4 : 0x9aa3a6); }
    }
    if (o.k === 'pillar') {
      if (u.g !== o.g) { u.glyph.material.map = glyphTexture(o.g, '#f2e3b0'); u.glyph.material.needsUpdate = true; u.g = o.g; }
      u.ring.visible = o.ok === 1;
    }
    if (o.k === 'mural' && !u.drawn && o.glyphs) {
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 170; const g2 = cv.getContext('2d');
      g2.fillStyle = '#b9ae92'; g2.fillRect(0, 0, 512, 170); g2.strokeStyle = '#6b6248'; g2.lineWidth = 6; g2.strokeRect(6, 6, 500, 158);
      g2.fillStyle = '#3a3222'; g2.font = '96px serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle';
      o.glyphs.forEach((gi, i) => g2.fillText(GLYPHS[gi], 74 + i * 121, 92));
      u.mural.material.map = new THREE.CanvasTexture(cv); u.mural.material.needsUpdate = true; u.drawn = true;
    }
    if (o.k === 'terminal') u.screen.material.color.setHex(o.read ? 0x7ff0c4 : (Math.sin(this.t * 3 + o.i) > 0 ? 0x2a6a4a : 0x1a4a34));
    if (o.k === 'node') { u.shield.visible = !o.open && !o.broken; u.crys.visible = !o.broken; u.crys.rotation.y += dt; }
    if (o.k === 'relic' && o.carrier != null) g.visible = true;
    if (o.k === 'portal') u.disc.material.opacity = 0.35 + Math.sin(this.t * 4) * 0.15;
    if (o.k === 'altar' && o.locked) u.flame.material.color.setHex(0x3a2f48);
  }

  syncBoss(b, dt) {
    if (!b) { if (this.boss) { this.scene.remove(this.boss.g); this.boss = null; this.chains?.forEach(c => c.visible = false); } return; }
    if (!this.boss || this.boss.type !== b.type) {
      if (this.boss) this.scene.remove(this.boss.g);
      const g = b.type === 'colossus' ? this.makeColossus() : this.makeCurator();
      this.scene.add(g); this.boss = { g, type: b.type };
    }
    const g = this.boss.g, u = g.userData;
    g.position.x = lerp(g.position.x, b.x, Math.min(1, dt * 8)); g.position.z = lerp(g.position.z, b.z, Math.min(1, dt * 8));
    let dy = b.yaw - g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); g.rotation.y += dy * Math.min(1, dt * 5);
    if (b.type === 'colossus') {
      g.position.y = 0;
      u.plates.forEach((p, i) => { p.visible = b.plates[i] > 0; });
      const knelt = b.knelt > 0 || b.hp <= 0;
      u.torso.position.y = lerp(u.torso.position.y, knelt ? 3.6 : 9 + Math.sin(this.t * 1.5) * 0.15, Math.min(1, dt * 3));
      u.legs.forEach(l => { l.scale.y = lerp(l.scale.y, knelt ? 0.35 : 1, Math.min(1, dt * 3)); l.position.y = 4 * l.scale.y; });
      u.core.material.color.setHex(b.hp <= 0 ? 0x333333 : knelt ? 0xfff2a0 : b.phase === 3 ? 0xe4573d : 0xf2a33a);
      u.core.scale.setScalar(knelt ? 1.4 + Math.sin(this.t * 8) * 0.1 : 1);
      u.light.intensity = b.hp <= 0 ? 0 : knelt ? 60 : 25;
      if (b.hp <= 0) u.torso.rotation.z = lerp(u.torso.rotation.z, 0.5, dt);
    } else {
      g.position.y = 0.6 + Math.sin(this.t * 2) * 0.3;
      u.halo.rotation.z += dt * 2; u.shield.visible = !!b.shield;
      u.shield.material.opacity = 0.18 + Math.sin(this.t * 5) * 0.06;
    }
  }

  syncTelegraphs(view, dt) {
    const want = [];
    for (const c of view.creatures) if (c.tel && c.tel.kind !== 'alert') {
      const key = `c${c.i}${c.tel.kind}${Math.round(c.tel.x)}${Math.round(c.tel.z)}`;
      if (!this.telSeen.has(key)) this.telSeen.set(key, this.t);
      const dur = c.k === 'guardian' ? 0.95 : c.k === 'stalker' ? 0.8 : 0.65;
      want.push({ ...c.tel, k: c.tel.kind, p: Math.min(1, (this.t - this.telSeen.get(key)) / dur) });
    }
    for (const t of view.boss?.tels || []) want.push(t);
    if (this.telSeen.size > 200) this.telSeen.clear();
    while (this.tels.length < want.length) {
      const g = new THREE.Group();
      const edge = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 48), new THREE.MeshBasicMaterial({ color: 0xf2a33a, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
      const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: 0xe4573d, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
      const cone = new THREE.Mesh(new THREE.CircleGeometry(1, 32, 0, Math.PI), new THREE.MeshBasicMaterial({ color: 0xe4573d, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
      const line = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xe4573d, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide }));
      for (const m of [edge, fill, cone, line]) { m.rotation.x = -Math.PI / 2; m.renderOrder = 5; g.add(m); }
      this.scene.add(g); this.tels.push({ g, edge, fill, cone, line });
    }
    const hc = this.settings.contrast;
    this.tels.forEach((T, i) => {
      const t = want[i];
      T.g.visible = !!t;
      if (!t) return;
      const y = groundHeight(t.x, t.z, { open: new Set(), bridge: true, log: true }) + 0.08;
      T.edge.material.color.setHex(hc ? 0xffffff : 0xf2a33a);
      T.fill.material.color.setHex(hc ? 0xff00aa : 0xe4573d);
      T.edge.visible = T.fill.visible = t.k === 'ring'; T.cone.visible = t.k === 'cone'; T.line.visible = t.k === 'line';
      if (t.k === 'ring') {
        T.g.position.set(t.x, y, t.z); T.g.rotation.set(0, 0, 0);
        T.edge.scale.setScalar(t.r); T.fill.scale.setScalar(Math.max(0.01, t.r * t.p));
      } else if (t.k === 'cone') {
        T.g.position.set(t.x, y, t.z); T.g.rotation.set(0, t.yaw - Math.PI / 2, 0);
        T.cone.scale.setScalar(t.r); T.cone.material.opacity = 0.2 + 0.35 * t.p;
      } else if (t.k === 'line') {
        const dx = t.tx - t.x, dz = t.tz - t.z, L = Math.hypot(dx, dz);
        T.g.position.set((t.x + t.tx) / 2, y, (t.z + t.tz) / 2); T.g.rotation.set(0, Math.atan2(dx, dz), 0);
        T.line.scale.set(t.w || 1.4, L, 1); T.line.material.opacity = 0.2 + 0.45 * t.p;
      }
    });
  }

  // ------------------------------------------------------------------ effects
  burst(x, y, z, color, n = 10, speed = 4, life = 0.6, size = 0.15) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshBasicMaterial({ color, transparent: true }));
      m.position.set(x, y, z); this.scene.add(m);
      this.fx.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * speed, Math.random() * speed, (Math.random() - 0.5) * speed), life, max: life, grav: 9 });
    }
  }
  wave(x, z, color, r = 6, life = 0.6) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, groundHeight(x, z, { open: new Set(), bridge: true, log: true }) + 0.2, z); this.scene.add(m);
    this.fx.push({ m, grow: r, life, max: life });
  }
  number(x, y, z, text, color) {
    const s = textSprite(text, { size: 40, color, screen: true }); s.scale.multiplyScalar(0.8); s.position.set(x + (Math.random() - 0.5), y, z); this.scene.add(s);
    this.fx.push({ m: s, v: new THREE.Vector3(0, 2, 0), life: 0.9, max: 0.9 });
  }
  tracer(x, z, tx, tz, color = 0xfff2c0, y = 1.5, life = 0.12) {
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, groundHeight(x, z, { open: new Set(), bridge: true, log: true }) + y, z), new THREE.Vector3(tx, groundHeight(tx, tz, { open: new Set(), bridge: true, log: true }) + y, tz)]), new THREE.LineBasicMaterial({ color, transparent: true }));
    this.scene.add(l); this.fx.push({ m: l, life, max: life });
  }
  smoke(x, z) {
    for (let i = 0; i < 18; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 6, 5), new THREE.MeshBasicMaterial({ color: 0x8a8f8a, transparent: true, opacity: 0.6, depthWrite: false }));
      m.position.set(x + (Math.random() - 0.5) * 8, 1 + Math.random() * 2, z + (Math.random() - 0.5) * 8); m.scale.setScalar(1.5 + Math.random() * 1.5);
      this.scene.add(m); this.fx.push({ m, v: new THREE.Vector3(0, 0.4, 0), life: 3.2, max: 3.2 });
    }
  }
  ping(x, z, danger) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.4, 4), new THREE.MeshBasicMaterial({ color: danger ? 0xe4573d : 0x7ff0c4, transparent: true }));
    m.rotation.x = Math.PI; m.position.set(x, groundHeight(x, z, { open: new Set(), bridge: true, log: true }) + 2.5, z);
    this.scene.add(m); this.pings.push({ m, life: 5 });
    this.wave(x, z, danger ? 0xe4573d : 0x7ff0c4, 3, 0.8);
  }
  updateFx(dt) {
    for (const f of this.fx) {
      f.life -= dt;
      if (f.v) { f.m.position.addScaledVector(f.v, dt); if (f.grav) f.v.y -= f.grav * dt; }
      if (f.grow) f.m.scale.setScalar(0.5 + f.grow * (1 - f.life / f.max));
      if (f.m.material) f.m.material.opacity = Math.max(0, f.life / f.max);
      if (f.life <= 0) { this.scene.remove(f.m); f.m.geometry?.dispose(); }
    }
    this.fx = this.fx.filter(f => f.life > 0);
  }

  // ------------------------------------------------------------------ environment + render
  environment(focus, dt, audio) {
    const reg = regionAt(focus.z).id;
    const L = REGION_LOOK[reg], k = Math.min(1, dt * 0.8);
    this.look.density = lerp(this.look.density, L.density, k);
    this.look.rain = lerp(this.look.rain ?? 0, L.rain, k);
    this.look.wind = lerp(this.look.wind ?? 0, L.wind, k);
    this.scene.fog.color.lerp(C(L.fog), k); this.scene.background.lerp(C(L.sky), k);
    this.scene.fog.density = this.look.density;
    this.sun.intensity = lerp(this.sun.intensity, L.sun * 1.5, k) + this.flash * 1.2;
    this.hemi.intensity = 0.7 + this.flash * 0.6;
    this.flash = Math.max(0, this.flash - dt * 3);
    this.sun.position.set(focus.x + 30, 60, focus.z - 20); this.sun.target.position.set(focus.x, 0, focus.z);
    // Rain follows the camera.
    const rp = this.rain.geometry.attributes.position;
    this.rain.visible = this.look.rain > 0.02;
    this.rain.material.opacity = 0.6 * this.look.rain;
    this.rain.material.color.setHex(L.ash ? 0x8a8080 : 0xaed4e6);
    const fall = L.ash ? 2 : 26;
    for (let i = 0; i < rp.count; i++) {
      let y = rp.getY(i) - fall * dt; if (y < 0) y += 30; rp.setY(i, y);
    }
    if (L.ash) { this.rain.visible = true; this.rain.material.opacity = 0.5; }
    rp.needsUpdate = true;
    this.rain.position.set(this.camera.position.x, focus.y - 2, this.camera.position.z);
    this.motes.material.opacity = lerp(this.motes.material.opacity, L.motes ? 0.8 : 0, k);
    this.motes.position.set(focus.x, focus.y, focus.z); this.motes.rotation.y += dt * 0.05;
    // Lightning in the storm.
    this.nextLightning -= dt;
    if (reg === 'wilds' && this.nextLightning <= 0) { this.nextLightning = 10 + Math.random() * 15; this.flash = 1; setTimeout(() => audio?.play('thunder', { vol: 0.8 }), 600 + Math.random() * 1200); }
    return { region: reg, rain: this.look.rain * (L.ash ? 0 : 1), wind: this.look.wind };
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
