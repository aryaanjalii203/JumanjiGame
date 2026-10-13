import * as THREE from 'three';
import { createNetwork } from './net.js';
import './style.css';

const $ = id => document.getElementById(id);
const AVATARS = [
  {name:'TITAN', role:'EXPEDITION LEADER', ability:'Q · BULWARK — absorb incoming damage briefly', speed:4.2, health:130, color:0x6f806e, abilityName:'Bulwark'},
  {name:'WRAITH', role:'SCOUT', ability:'Q · VEIL — brief camouflage and speed burst', speed:6.4, health:78, color:0x778e9b, abilityName:'Veil'},
  {name:'CIRCUIT', role:'TACTICAL ENGINEER', ability:'Q · DECOY — distract nearby creatures', speed:4.9, health:95, color:0xc4a96d, abilityName:'Decoy'},
  {name:'ORACLE', role:'SURVIVAL SPECIALIST', ability:'Q · FIELD MEDIC — restore health to nearby allies', speed:4.6, health:100, color:0x779d78, abilityName:'Field Medic'},
  {name:'PHANTOM', role:'RANGED OPERATIVE', ability:'Q · PHASE STEP — evade and reposition quickly', speed:5.3, health:88, color:0x9380a5, abilityName:'Phase Step'}
];
let avatar = AVATARS[0], started=false, paused=false, lives=3, health=100, stamina=100, invuln=0, abilityTimer=0, attackTimer=0, jumpVelocity=0, onGround=true;
let glyphs=[false,false,false], bossHealth=600, bossActive=false, complete=false, lastNet=0, toastTimer=0, yaw=0, pitch=.23, mouseDown=false;
const keys = new Set();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x718c76);
scene.fog = new THREE.FogExp2(0x718c76, 0.018);
const camera = new THREE.PerspectiveCamera(65, innerWidth/innerHeight, .1, 350);
const renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance' });
renderer.setSize(innerWidth,innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio,1.75)); renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap; renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.15;
$('game').appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xc8e5cf,0x18231a,2.0));
const sun = new THREE.DirectionalLight(0xffe2b4,3.0); sun.position.set(-25,45,20); sun.castShadow=true; sun.shadow.mapSize.set(1024,1024); scene.add(sun);
const fill = new THREE.PointLight(0x77b9a1,28,55); fill.position.set(0,9,-8); scene.add(fill);
const mat=(color,roughness=.82,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
const mats={ground:mat(0x324b32),leaf:mat(0x234b34),leaf2:mat(0x426a3d),bark:mat(0x493b2a),stone:mat(0x646c5b),darkStone:mat(0x26372e),gold:mat(0xb8d58a,.38,.5),water:mat(0x244f4b,.24,.25),skin:mat(0xb98b68),cloth:mat(0x556f61),eye:mat(0xe6f0d9,.25)};
function mesh(geo,material,x,y,z,parent=scene){const o=new THREE.Mesh(geo,material);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o}
const ground=mesh(new THREE.PlaneGeometry(220,220),mats.ground,0,-.15,0);ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;
const water=mesh(new THREE.PlaneGeometry(23,60),mats.water,18,-.04,-28);water.rotation.x=-Math.PI/2;
function tree(x,z,s=1){const g=new THREE.Group();g.position.set(x,0,z);scene.add(g);mesh(new THREE.CylinderGeometry(.32*s,.58*s,5*s,8),mats.bark,0,2.5*s,0,g);for(let i=0;i<4;i++){const crown=mesh(new THREE.IcosahedronGeometry((2.1-i*.18)*s,1),i%2?mats.leaf:mats.leaf2,(Math.random()-.5)*2*s,(4.5+i*.55)*s,(Math.random()-.5)*2*s,g);crown.scale.set(1,.8,1.1)}}
for(let i=0;i<100;i++){let x=(Math.random()-.5)*150,z=(Math.random()-.5)*150;if(Math.hypot(x,z)>13)tree(x,z,.65+Math.random()*1.5)}
for(let i=0;i<18;i++){const rock=mesh(new THREE.DodecahedronGeometry(.7+Math.random()*1.4,0),mats.stone,(Math.random()-.5)*50,.25,(Math.random()-.5)*50);rock.scale.y=.5+Math.random()}
function ruin(x,z,s=1){const group=new THREE.Group();group.position.set(x,0,z);scene.add(group);for(let i=0;i<4;i++){mesh(new THREE.BoxGeometry(.75*s,4*s,.8*s),mats.stone,(i%2?1:-1)*3*s,2*s,(i<2?-2:2)*s,group)}mesh(new THREE.BoxGeometry(7*s,.8*s,1*s),mats.darkStone,0,4.1*s,-2*s,group);mesh(new THREE.BoxGeometry(7*s,.8*s,1*s),mats.stone,0,4.1*s,2*s,group);for(let i=0;i<3;i++){const glyph=mesh(new THREE.TorusGeometry(.35*s,.07*s,6,16),mats.gold,(i-1)*1.5*s,2.1*s,-2.46*s,group);glyph.rotation.x=Math.PI/2}}
ruin(0,-13,1.2);ruin(-22,-35,1.8);ruin(30,-46,2.2);
for(let i=0;i<8;i++){const vine=mesh(new THREE.CylinderGeometry(.035,.025,6+Math.random()*8,5),mat(0x3d6242), (Math.random()-.5)*42,4,(Math.random()-.5)*50);vine.rotation.z=(Math.random()-.5)*.5}
const player = new THREE.Group();scene.add(player);player.position.set(0,0,6);
function buildHumanoid(parent,color,scale=1){
  const g=new THREE.Group();g.scale.setScalar(scale);parent.add(g);
  const skin=mat(0x9c7255), shirt=mat(color), pants=mat(0x26352d), boots=mat(0x1b211c), hair=mat(0x241d18), gear=mat(0x6e765f,.7,.15);
  const torso=mesh(new THREE.CapsuleGeometry(.38,.72,5,9),shirt,0,1.42,0,g);torso.scale.set(1,.93,.7);
  mesh(new THREE.SphereGeometry(.29,16,12),skin,0,2.18,0,g);
  mesh(new THREE.SphereGeometry(.3,12,8,0,Math.PI*2,0,Math.PI*.48),hair,0,2.32,-.015,g);
  const eyeMat=mat(0xe4dfc8,.35);mesh(new THREE.SphereGeometry(.045,8,6),eyeMat,-.105,2.2,-.26,g);mesh(new THREE.SphereGeometry(.045,8,6),eyeMat,.105,2.2,-.26,g);
  const limbs=[];
  for(const side of [-1,1]){
    const arm=new THREE.Group();arm.position.set(side*.47,1.77,0);g.add(arm);mesh(new THREE.CapsuleGeometry(.13,.48,4,8),shirt,0,-.28,0,arm);limbs.push(arm);
    const leg=new THREE.Group();leg.position.set(side*.2,.85,0);g.add(leg);mesh(new THREE.CapsuleGeometry(.16,.53,4,8),pants,0,-.22,0,leg);mesh(new THREE.BoxGeometry(.22,.14,.35),boots,0,-.5,-.06,leg);limbs.push(leg);
  }
  mesh(new THREE.BoxGeometry(.92,.15,.5),gear,0,1.75,.02,g);
  mesh(new THREE.BoxGeometry(.24,.4,.15),gear,.25,1.35,.31,g);
  return {group:g,limbs};
}
const human=buildHumanoid(player,avatar.color);
const remotePlayers=new Map(), enemies=[];
function makeCreature(type,x,z,scale=1){
 const group=new THREE.Group();group.position.set(x,0,z);scene.add(group);
 const body=mesh(new THREE.IcosahedronGeometry(type==='colossus'?1.7:.65,1),mat(type==='colossus'?0x4a4941:type==='razorback'?0x625447:0x354c3b,.7,.12),0,type==='colossus'?2.0:.75,0,group);
 body.scale.set(type==='colossus'?1.2:1.35,type==='colossus'?1.35:.75,type==='colossus'?1.1:1.7);
 const head=mesh(new THREE.SphereGeometry(type==='colossus'?.68:.36,12,10),mat(type==='colossus'?0x625b4d:0x485943),0,type==='colossus'?3.1:1.02,-.72,group);
 const eye=mat(0xe8b06a,.25,.1);mesh(new THREE.SphereGeometry(.09,8,6),eye,-.2,type==='colossus'?3.17:1.08,-1.02,group);mesh(new THREE.SphereGeometry(.09,8,6),eye,.2,type==='colossus'?3.17:1.08,-1.02,group);
 const legs=[];for(const sx of [-1,1])for(const sz of [-1,1]){const leg=mesh(new THREE.CapsuleGeometry(type==='colossus'?.22:.13,type==='colossus'?1:.42,4,7),mat(0x373c31),sx*(type==='colossus'?.95:.4),type==='colossus'?.7:.35,sz*(type==='colossus'?.65:.48),group);legs.push(leg)}
 const e={type,group,body,health:type==='colossus'?600:40,maxHealth:type==='colossus'?600:40,state:'patrol',timer:0,attack:0,scale};enemies.push(e);return e;
}
makeCreature('razorback',-7,-4);makeCreature('razorback',8,-20);makeCreature('canopy',-12,-27);const boss=makeCreature('colossus',0,-45,1);boss.group.visible=false;
function toast(msg){$('toast').textContent=msg;$('toast').style.opacity=1;toastTimer=2.5}
function updateAvatarHud(){$('avatarName').innerHTML=`${avatar.name} <small>${avatar.role}</small>`;$('avatarAbility').textContent=avatar.ability;$('healthText').textContent=`VITALS ${Math.round(health/avatar.health*100)}%`;$('healthFill').style.width=`${Math.max(0,health/avatar.health*100)}%`;$('staminaText').textContent=`STAMINA ${Math.round(stamina)}%`;$('staminaFill').style.width=`${stamina}%`;$('lives').innerHTML=[0,1,2].map(i=>`<b class="${i>=lives?'lost':''}">◆</b>`).join('')}
function setAvatar(next){avatar=next;human.group.traverse(o=>{if(o.isMesh && o.material && o.material.color && o.material.color.getHex()===humanColor) o.material.color.setHex(next.color)});updateAvatarHud();toast(`${avatar.name} LOADOUT ACTIVE`)}
let humanColor=avatar.color;
const network=createNetwork(state=>syncRoom(state),msg=>{ $('connection').textContent=msg; toast(msg); });
function syncRoom(state){
 if(!state)return;
 for(const [id,p] of Object.entries(state.players||{})){
   if(id===networkId())continue;
   if(!remotePlayers.has(id)){const g=new THREE.Group();scene.add(g);const a=AVATARS.find(v=>v.name===p.avatar)||AVATARS[0];const model=buildHumanoid(g,a.color);remotePlayers.set(id,{group:g,model,data:p})}
   const r=remotePlayers.get(id);r.data=p;r.group.position.set(p.position.x,p.position.y,p.position.z);r.group.rotation.y=p.rotation||0;
 }
 for(const [id,r] of remotePlayers){if(!state.players[id]){scene.remove(r.group);remotePlayers.delete(id)}}
 if(state.objective){glyphs=state.objective.glyphs||glyphs;bossHealth=state.objective.bossHealth??bossHealth;complete=state.objective.complete??complete;refreshMission()}
 $('teamCount').textContent=`${Object.keys(state.players||{}).length} / 05`;
 $('teamList').innerHTML=Object.values(state.players||{}).map(p=>`<div class="team-player"><span>${p.name}${p.id===networkId()?' · YOU':''}</span><span class="role">${p.avatar}</span></div>`).join('') || '<div class="team-player">SOLO SIGNAL <span class="role">AI FILL</span></div>';
}
function networkId(){return window.__relicSocketId||''}
function refreshMission(){
 document.querySelectorAll('[data-glyph]').forEach((el,i)=>{el.classList.toggle('active',!!glyphs[i]);el.textContent=glyphs[i]?'✦':'◇'});
 const count=glyphs.filter(Boolean).length;
 $('progressFill').style.width=`${complete?100:count/3*65}%`;
 $('missionTitle').textContent=complete?'12 / RETURN TO REALITY':bossActive?'08 / THE HOLLOW COLOSSUS':'01 / LOST IN THE WILDS';
 $('objective').textContent=complete?'Expedition complete. A new signal remains below the mountain.':bossActive?'Defeat the Colossus. Aim for its glowing core after its ground slam.':count<3?`Find the relic console and activate its glyphs (${count}/3).`:'The guardian is awake. Survive and strike when its core is exposed.';
 $('bossBar').style.display=bossActive&&!complete?'block':'none';$('bossFill').style.width=`${bossHealth/600*100}%`;$('bossPct').textContent=`${Math.round(bossHealth/600*100)}%`;
}
function damagePlayer(d){if(invuln>0||complete)return;health-=d;invuln=1.2;if(health<=0){lives--;if(lives<=0){lives=0;health=0;toast('ALL LIFE MARKS LOST · TEAM RESCUE REQUIRED');setTimeout(()=>{lives=2;health=avatar.health*.65;player.position.set(0,0,6);toast('RECOVERY CHECKPOINT RESTORED');updateAvatarHud()},3500)}else{toast('LIFE LOST · RECOVERING AT CHECKPOINT');health=avatar.health*.65;player.position.set(0,0,6)}}updateAvatarHud()}
function interact(){
 if(complete)return;
 if(bossActive){if(bossHealth<=0)return;bossHealth-=45;boss.body.material.emissive=new THREE.Color(0x5b3b12);toast('CORE STRIKE · KEEP MOVING');if(bossHealth<=0){bossHealth=0;complete=true;toast('THE RELIC IS STABLE');$('ending').style.display='block';network.sendObjective({glyphs,bossHealth,complete})}else network.sendObjective({glyphs,bossHealth,complete});refreshMission();return}
 const nearest=player.position.distanceTo(new THREE.Vector3(0,0,-13));
 if(nearest<9){const idx=glyphs.findIndex(v=>!v);if(idx>=0){glyphs[idx]=true;toast(`GLYPH ${idx+1} RESTORED · ${3-glyphs.filter(Boolean).length} REMAIN`);network.sendObjective({glyphs,bossHealth,complete});if(glyphs.every(Boolean)){bossActive=true;boss.group.visible=true;boss.group.position.set(0,0,-36);toast('WARNING · THE HOLLOW COLOSSUS AWAKENS');}refreshMission()}else toast('ALL GLYPHS RESTORED · MOVE TO THE GUARDIAN');}
 else toast('MOVE CLOSER TO THE RELIC CONSOLE');
}
function ability(){
 if(abilityTimer>0)return;abilityTimer=8;
 if(avatar.name==='ORACLE'){health=Math.min(avatar.health,health+35);toast('FIELD MEDIC · VITALS RESTORED')}
 else if(avatar.name==='TITAN'){invuln=3;toast('BULWARK · DAMAGE RESISTANCE ACTIVE')}
 else if(avatar.name==='WRAITH'){player.userData.veil=3;toast('VEIL · PREDATORS LOSE YOUR TRAIL')}
 else if(avatar.name==='CIRCUIT'){enemies.forEach(e=>{if(e.type!=='colossus')e.state='investigate';e.timer=5});toast('DECOY DEPLOYED · THREAT DIVERTED')}
 else{player.userData.phase=1.2;player.position.x+=Math.sin(yaw)*4;player.position.z+=Math.cos(yaw)*4;toast('PHASE STEP · REPOSITIONED')}
 updateAvatarHud();
}
function attack(){
 if(attackTimer>0)return;attackTimer=.55;
 let nearest=null,dist=4;
 for(const e of enemies){if(!e.group.visible||e.health<=0)continue;const d=player.position.distanceTo(e.group.position);if(d<dist){dist=d;nearest=e}}
 if(nearest){nearest.health-=avatar.name==='TITAN'?28:avatar.name==='PHANTOM'?22:18;nearest.body.material.emissive=new THREE.Color(0x392d17);toast(nearest.type==='colossus'?'CORE DAMAGED':'CREATURE HIT');if(nearest.type==='colossus'&&nearest.health<=0){bossHealth=0;complete=true;$('ending').style.display='block';network.sendObjective({glyphs,bossHealth,complete});refreshMission()}else if(nearest.type!=='colossus'&&nearest.health<=0){nearest.group.visible=false;toast('THREAT NEUTRALIZED')} }
 else toast('NO TARGET IN RANGE · MOVE CLOSER');
}
function handleKey(e,down){const k=e.key.toLowerCase();if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(k))e.preventDefault();if(down)keys.add(k);else keys.delete(k);if(!down)return;if(k==='e')interact();if(k==='q')ability();if(['1','2','3','4','5'].includes(k)){const next=AVATARS[Number(k)-1];if(next&&next.name!==avatar.name){avatar=next;human.group.traverse(o=>{if(o.isMesh&&o.material&&o.material.color&&o.material.color.getHex()===humanColor)o.material.color.setHex(next.color)});humanColor=next.color;health=Math.min(health,avatar.health);updateAvatarHud();toast(`${avatar.name} LOADOUT ACTIVE`);}}if(k==='h'){health=Math.min(avatar.health,health+25);updateAvatarHud();toast('FIELD SUPPLY USED')}if(k==='escape')paused=!paused}
addEventListener('keydown',e=>handleKey(e,true));addEventListener('keyup',e=>handleKey(e,false));
renderer.domElement.addEventListener('mousedown',e=>{mouseDown=true;if(e.button===0&&started)attack()});addEventListener('mouseup',()=>mouseDown=false);
addEventListener('mousemove',e=>{if(mouseDown&&started){yaw-=e.movementX*.003;pitch=Math.max(-.05,Math.min(.65,pitch+e.movementY*.002))}});
$('start').onclick=()=>{started=true;$('intro').style.display='none';toast('EXPEDITION LINK ESTABLISHED · FIND THE CONSOLE');};
$('again').onclick=()=>{glyphs=[false,false,false];bossHealth=600;bossActive=false;complete=false;lives=3;health=avatar.health;player.position.set(0,0,6);boss.group.visible=false;$('ending').style.display='none';refreshMission();updateAvatarHud();toast('NEW EXPEDITION INITIALIZED')};
$('join').onclick=()=>{const room=$('room').value||'WILDS5';network.connect(room,avatar.name);toast(`JOINING ROOM ${room.toUpperCase()}`)};
function animateHumanoid(model,moving,t){model.limbs.forEach((limb,i)=>{limb.rotation.x=moving?Math.sin(t*10+(i%2)*Math.PI)*.55:Math.sin(t*1.8+i)*.025});}
const clock=new THREE.Clock();
function tick(){
 requestAnimationFrame(tick);const dt=Math.min(clock.getDelta(),.04),t=clock.elapsedTime;
 if(toastTimer>0){toastTimer-=dt;if(toastTimer<=0)$('toast').style.opacity=0}
 invuln=Math.max(0,invuln-dt);abilityTimer=Math.max(0,abilityTimer-dt);attackTimer=Math.max(0,attackTimer-dt);
 if(started&&!paused&&!complete){
  let x=0,z=0; if(keys.has('w')||keys.has('arrowup'))z-=1;if(keys.has('s')||keys.has('arrowdown'))z+=1;if(keys.has('a')||keys.has('arrowleft'))x-=1;if(keys.has('d')||keys.has('arrowright'))x+=1;
  const moving=x!==0||z!==0;const sprint=keys.has('shift')&&stamina>0;const speed=avatar.speed*(sprint?1.5:1);
  if(moving){const len=Math.hypot(x,z);x/=len;z/=len;const angle=Math.atan2(x,z)+yaw;player.position.x+=Math.sin(angle)*speed*dt;player.position.z+=Math.cos(angle)*speed*dt;player.rotation.y=angle;stamina=Math.max(0,stamina-(sprint?30:0)*dt)}else stamina=Math.min(100,stamina+18*dt);
  if(keys.has(' ')&&onGround){jumpVelocity=6.2;onGround=false}player.position.y+=jumpVelocity*dt;jumpVelocity-=17*dt;if(player.position.y<=0){player.position.y=0;jumpVelocity=0;onGround=true}
  player.position.x=THREE.MathUtils.clamp(player.position.x,-75,75);player.position.z=THREE.MathUtils.clamp(player.position.z,-85,70);
  animateHumanoid(human,moving,t);
  for(const e of enemies){if(!e.group.visible||e.health<=0)continue;e.attack-=dt;e.timer-=dt;const d=e.group.position.distanceTo(player.position);if(e.type==='colossus'&&!bossActive)continue;
   if(e.type!=='colossus'){if(d<13)e.state='chase';else if(d<22)e.state='investigate';else e.state='patrol';}
   if(e.state==='chase'&&d>2.1){const dir=player.position.clone().sub(e.group.position).normalize();e.group.position.addScaledVector(dir,(e.type==='colossus'?1.8:2.5)*dt);e.group.rotation.y=Math.atan2(dir.x,dir.z)}
   if(e.type==='colossus'){e.group.position.x=Math.sin(t*.6)*1.2;if(d<4&&e.attack<=0){e.attack=2.2;damagePlayer(18);toast('GROUND SLAM · DODGE THE SHOCKWAVE')}}
   else if(d<1.7&&e.attack<=0){e.attack=1.6;damagePlayer(avatar.name==='TITAN'?7:12);toast('PREDATOR STRIKE · CREATE DISTANCE')}
  }
  if(player.position.distanceTo(new THREE.Vector3(0,0,-13))<8&&!glyphs.every(Boolean))$('threatText').textContent='Relic console signal detected — press E';
  else if(bossActive)$('threatText').textContent='Colossus core unstable — strike with left click';
  else $('threatText').textContent='Predator movement detected in the canopy';
  const target=new THREE.Vector3(player.position.x,player.position.y+1.5,player.position.z);const offset=new THREE.Vector3(Math.sin(yaw)*Math.cos(pitch)*8,3.2+pitch*4,Math.cos(yaw)*Math.cos(pitch)*8);camera.position.lerp(target.clone().add(offset),1-Math.pow(.001,dt));camera.lookAt(target);
  if(t-lastNet>.08){network.sendPosition({x:player.position.x,y:player.position.y,z:player.position.z},player.rotation.y,health,lives,avatar.name);lastNet=t}
  updateAvatarHud();
 }
 // Ambient movement and breathing
 human.group.position.y=player.position.y+Math.sin(t*2.2)*.015;
 for(const [id,r] of remotePlayers)animateHumanoid(r.model,false,t);
 renderer.render(scene,camera);
}
$('connection').textContent='LOCAL SESSION · NOT CONNECTED';refreshMission();updateAvatarHud();tick();
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
