// Rigged, animated human characters (skinned meshes + skeletal animation).
// Two bodies share one Mixamo-standard skeleton, so a single set of animations (idle, walk, run, crouch)
// drives both. Avatar identity comes from tint, size and gear attached to bones.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { AVATARS } from '/shared/data.js';

const clamp01 = v => Math.max(0, Math.min(1, v));
const BONE = n => `mixamorig${n}`;   // GLTFLoader strips the ':' from "mixamorig:Hips"

export class HumanLibrary {
  constructor() { this.ready = false; this.bodies = {}; this.clips = {}; }

  async load(base = '/assets/humans/') {
    const loader = new GLTFLoader();
    const get = f => new Promise((res, rej) => loader.load(base + f, res, undefined, rej));
    const [man, woman] = await Promise.all([get('man.glb'), get('woman.glb')]);
    const skinned = root => { let m = null; root.traverse(o => { if (!m && o.isSkinnedMesh) m = o; }); return m; };
    const byName = n => man.animations.find(a => a.name.toLowerCase() === n);
    const src = { idle: byName('idle'), walk: byName('walk'), run: byName('run') };
    // Only rotations drive the body; the server owns where a character actually is.
    const rotOnly = clip => { const c = clip.clone(); c.tracks = c.tracks.filter(t => t.name.endsWith('.quaternion')); return c; };
    this.clips.m = {}; this.clips.f = {};
    for (const [k, clip] of Object.entries(src)) this.clips.m[k] = rotOnly(clip);
    // The woman's skeleton rests differently, so retarget in world space (handles different bone rolls).
    // The two source files face opposite ways (man -Z, woman +Z). The game's forward is +Z, so turn the man
    // around first; that also puts both rigs in the same world frame for retargeting.
    man.scene.rotation.y = Math.PI; man.scene.updateMatrixWorld(true);
    const wMesh = skinned(woman.scene), mMesh = skinned(man.scene);
    const restoreM = snapshot(man.scene), restoreW = snapshot(woman.scene);
    for (const [k, clip] of Object.entries(src)) { restoreM(); restoreW(); this.clips.f[k] = retargetWorld(man.scene, mMesh, woman.scene, wMesh, clip, restoreM); }
    restoreM(); restoreW();
    this.bodies.m = man.scene; this.bodies.f = woman.scene;
    for (const b of Object.values(this.bodies)) {
      b.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(b);
      b.userData.height = box.max.y - box.min.y;
    }
    this.ready = true;
  }

  build(id, outfit = 'expedition', build = 'm') {
    const A = AVATARS[id];
    const src = this.bodies[build === 'f' ? 'f' : 'm'];
    const model = SkeletonUtils.clone(src);
    const height = 1.78 * (build === 'f' ? 0.96 : 1) * A.scale;
    model.scale.setScalar(height / src.userData.height);
    const g = new THREE.Group(); g.add(model);

    // Tint the body toward the avatar colour while keeping the textures readable.
    const tint = new THREE.Color(A.color);
    if (outfit === 'nightfall') tint.multiplyScalar(0.45);
    const mats = [];
    model.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.frustumCulled = false;
      const m = o.material.clone();
      m.color = new THREE.Color(1, 1, 1).lerp(tint, outfit === 'nightfall' ? 0.7 : 0.45);
      if (outfit === 'relic') { m.emissive = new THREE.Color(0x1a5a46); m.emissiveIntensity = 0.6; }
      o.material = m; mats.push(m);
    });

    const bones = {};
    model.traverse(o => { if (o.isBone) bones[o.name] = o; });
    const bone = n => bones[BONE(n)];

    // Animation.
    const mixer = new THREE.AnimationMixer(model);
    const clips = this.clips[build === 'f' ? 'f' : 'm'];
    const act = name => { const a = mixer.clipAction(clips[name]); a.play(); a.setEffectiveWeight(0); return a; };
    const actions = { idle: act('idle'), walk: act('walk'), run: act('run') };
    actions.idle.setEffectiveWeight(1);
    // Small per-character offsets so the team doesn't move in perfect lockstep.
    for (const a of Object.values(actions)) a.time = Math.random() * a.getClip().duration;

    // Gear attached to bones, sized in world units regardless of the rig's internal scale.
    model.updateMatrixWorld(true);
    const attach = (boneName, obj) => {
      const b = bone(boneName); if (!b) return;
      const s = new THREE.Vector3(); b.getWorldScale(s);
      obj.scale.multiplyScalar(1 / s.x * g.scale.x);
      b.add(obj);
    };
    const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, flatShading: true, ...o });
    const dark = mat(new THREE.Color(A.color).multiplyScalar(0.35)), metal = mat(0x9aa3a6, { metalness: 0.6, roughness: 0.4 });
    const mesh = (geo, m, x = 0, y = 0, z = 0) => { const k = new THREE.Mesh(geo, m); k.position.set(x, y, z); k.castShadow = true; return k; };
    const hand = new THREE.Group();
    if (id === 'titan') {
      hand.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 6), dark, 0, 0.1, 0));
      hand.add(mesh(new THREE.BoxGeometry(0.32, 0.22, 0.22), metal, 0, 0.6, 0));
      attach('Spine2', mesh(new THREE.BoxGeometry(0.62, 0.12, 0.3), dark, 0, 0.12, 0));
    } else if (id === 'wraith') {
      hand.add(mesh(new THREE.BoxGeometry(0.03, 0.55, 0.08), metal, 0, 0.3, 0));
      attach('Head', mesh(new THREE.ConeGeometry(0.17, 0.32, 8), dark, 0, 0.2, -0.03));
    } else if (id === 'circuit') {
      hand.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 6), metal, 0, 0.2, 0));
      const pack = mesh(new THREE.BoxGeometry(0.36, 0.42, 0.2), dark, 0, 0.05, -0.2);
      const ant = mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.45, 4), metal, 0.12, 0.4, 0); pack.add(ant);
      ant.add(mesh(new THREE.SphereGeometry(0.03), new THREE.MeshBasicMaterial({ color: 0xf2a33a }), 0, 0.24, 0));
      attach('Spine2', pack);
    } else if (id === 'oracle') {
      hand.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.7, 6), mat(0x5b4026), 0, 0.2, 0));
      hand.add(mesh(new THREE.OctahedronGeometry(0.07), new THREE.MeshBasicMaterial({ color: 0x9ff07f }), 0, 1.07, 0));
      const hat = new THREE.Group();
      hat.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 14), dark, 0, 0.19, 0));
      hat.add(mesh(new THREE.ConeGeometry(0.13, 0.18, 10), dark, 0, 0.28, 0));
      attach('Head', hat);
    } else if (id === 'phantom') {
      hand.add(mesh(new THREE.BoxGeometry(0.06, 0.08, 0.85), dark, 0, 0.08, 0.3));
      hand.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 6), metal, 0, 0.08, 0.85).rotateX(Math.PI / 2));
    }
    attach('RightHand', hand);
    // Three life marks glowing on the left forearm.
    const marks = [0, 1, 2].map(i => { const m = mesh(new THREE.BoxGeometry(0.025, 0.05, 0.025), new THREE.MeshBasicMaterial({ color: 0x7ff0c4 }), 0.045, 0.06 + i * 0.06, 0); attach('LeftForeArm', m); return m; });

    g.userData = { human: true, mixer, actions, bone, mats, marks, swing: 0, speed: 0, model };
    return g;
  }
}

// World-space retargeting: each target bone gets the same *world* rotation change, relative to its own
// rest pose, as the matching source bone. Robust to different bone rolls and armature orientations.
// Remember every node's local transform so a body can be put back exactly as loaded.
// (Skeleton.pose() would ignore a scaled/rotated armature and wreck the woman's rig.)
function snapshot(root) {
  const saved = [];
  root.traverse(o => saved.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]));
  return () => { for (const [o, p, q, s] of saved) { o.position.copy(p); o.quaternion.copy(q); o.scale.copy(s); } root.updateMatrixWorld(true); };
}

function retargetWorld(srcRoot, srcMesh, tgtRoot, tgtMesh, clip, restoreSrc, fps = 30) {
  srcRoot.updateMatrixWorld(true); tgtRoot.updateMatrixWorld(true);
  const sb = {}; for (const b of srcMesh.skeleton.bones) sb[b.name] = b;
  const tBones = tgtMesh.skeleton.bones.slice();
  const depth = b => { let d = 0; for (let o = b; o.parent; o = o.parent) d++; return d; };
  tBones.sort((a, b) => depth(a) - depth(b));               // parents before children
  const restS = {}, restT = {}, localRestT = {}, parentRestW = {};
  for (const b of srcMesh.skeleton.bones) restS[b.name] = b.getWorldQuaternion(new THREE.Quaternion());
  for (const b of tBones) {
    restT[b.name] = b.getWorldQuaternion(new THREE.Quaternion());
    localRestT[b.name] = b.quaternion.clone();
    parentRestW[b.name] = b.parent.getWorldQuaternion(new THREE.Quaternion());
  }
  const mixer = new THREE.AnimationMixer(srcRoot);
  mixer.clipAction(clip).play();
  const n = Math.max(2, Math.round(clip.duration * fps) + 1);
  const times = new Float32Array(n), vals = {};
  for (const b of tBones) vals[b.name] = new Float32Array(n * 4);
  const ws = new THREE.Quaternion(), tmp = new THREE.Quaternion(), wt = {};
  for (let f = 0; f < n; f++) {
    const t = Math.min(clip.duration, f / fps); times[f] = t;
    mixer.setTime(t); srcRoot.updateMatrixWorld(true);
    for (const b of tBones) {
      const pw = wt[b.parent.name] || parentRestW[b.name];
      const s = sb[b.name];
      let w;
      if (s) { s.getWorldQuaternion(ws); w = ws.clone().multiply(tmp.copy(restS[b.name]).invert()).multiply(restT[b.name]); }
      else w = pw.clone().multiply(localRestT[b.name]);
      wt[b.name] = w;
      tmp.copy(pw).invert().multiply(w).normalize().toArray(vals[b.name], f * 4);
    }
  }
  mixer.stopAllAction(); mixer.uncacheRoot(srcRoot); restoreSrc();
  const tracks = tBones.map(b => new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, vals[b.name]));
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

// Rotate a bone about a world-space axis (independent of how the rig's local axes are oriented).
const _pq = new THREE.Quaternion(), _q = new THREE.Quaternion(), _ax = new THREE.Vector3();
function bend(bone, worldAxis, angle) {
  if (!bone || !bone.parent) return;
  bone.parent.getWorldQuaternion(_pq);
  _ax.copy(worldAxis).applyQuaternion(_pq.invert()).normalize();
  bone.quaternion.premultiply(_q.setFromAxisAngle(_ax, angle));
}

const _right = new THREE.Vector3();
// Drive the animation from gameplay state: smooth blend between idle, walk and run that matches
// actual ground speed, plus crouching, attacks, carrying and being downed.
export function animateHuman(g, s, dt) {
  const u = g.userData;
  _right.set(Math.cos(g.rotation.y), 0, -Math.sin(g.rotation.y));
  u.speed += (s.speed - u.speed) * Math.min(1, dt * 8);
  const v = s.crouch ? 0 : u.speed;
  const run = clamp01((v - 5) / 2.5), walk = clamp01(v / 1.2) * (1 - run), idle = 1 - clamp01(v / 1.2);
  const cw = s.crouch ? clamp01(u.speed / 1.2) : 0;   // crouch-walk reuses the walk cycle, slower and lower
  const total = run + walk + idle + cw || 1;
  u.actions.run.setEffectiveWeight(run / total).setEffectiveTimeScale(Math.max(0.7, Math.min(1.6, v / 6)));
  u.actions.walk.setEffectiveWeight((walk + cw) / total).setEffectiveTimeScale(s.crouch ? 0.7 : Math.max(0.6, Math.min(1.7, v / 2.2)));
  u.actions.idle.setEffectiveWeight((idle * (s.crouch ? 1 - cw : 1)) / total);
  u.mixer.update(dt);
  u.crouchK = (u.crouchK || 0) + ((s.crouch ? 1 : 0) - (u.crouchK || 0)) * Math.min(1, dt * 10);
  if (u.crouchK > 0.01) {
    u.model.position.y = -0.32 * u.crouchK * g.scale.y;
    bend(u.bone('Spine'), _right, 0.45 * u.crouchK);
    bend(u.bone('LeftUpLeg'), _right, -0.7 * u.crouchK); bend(u.bone('RightUpLeg'), _right, -0.7 * u.crouchK);
    bend(u.bone('LeftLeg'), _right, 1.2 * u.crouchK); bend(u.bone('RightLeg'), _right, 1.2 * u.crouchK);
  }
  // Additive gestures on top of the base animation.
  u.swing = Math.max(0, u.swing - dt * 4);
  if (s.carry) { bend(u.bone('RightArm'), _right, -1.1); bend(u.bone('LeftArm'), _right, -1.1); }
  else if (u.swing > 0) {
    const k = Math.sin(u.swing * Math.PI);
    bend(u.bone('RightArm'), _right, -1.9 * k);
    bend(u.bone('Spine1'), _right, 0.25 * k);
  }
  u.marks.forEach((m, i) => m.material.color.setHex(i < s.lives ? 0x7ff0c4 : 0x2d3d35));
}
