# THE FIFTH RELIC — Playable Vertical Slice

An original browser-based third-person cooperative adventure starter. This is a playable foundation, not a finished AAA campaign.

## Requirements
- Node.js 20+
- npm
- Two or more browser windows for multiplayer testing (same machine is fine for a local smoke test)

## Run locally
```bash
npm install
npm run dev
```
Open the Vite URL (usually http://localhost:5173).

In a second terminal:
```bash
npm run server
```
The multiplayer server listens on `http://localhost:3001`. Open the game in two browser windows and use the same room code. The server synchronizes player positions and shared objective state.

## Controls
- WASD: move
- Arrow keys: also move
- Mouse: rotate camera (click/drag)
- Space: jump
- Shift: sprint
- E: interact with the relic console / puzzle
- Left click: attack
- Q: avatar ability
- H: heal (if a supply is available)
- Esc: pause

## Current vertical slice
- Third-person browser 3D scene with a jungle clearing, ruins, fog, lights, and a day/night mood
- Five original avatar roles with different stats and abilities
- Keyboard + arrow-key movement
- Basic jump, sprint, melee attack and ability input
- Two enemy types with patrol / investigate / chase / attack states
- Three-life HUD, damage, death and checkpoint respawn
- Shared relic-console puzzle / mission objective
- Boss encounter after the puzzle is completed
- Room code multiplayer with real WebSocket position and objective synchronization
- AI companions fill unused slots visually
- Original narrative text and ending trigger

## Important limitations (honest status)
- The human models in this starter are procedural stylized 3D characters, not photorealistic scanned actors. For realistic human anatomy, facial animation, clothing simulation, and believable locomotion, import properly licensed rigged GLB/FBX characters and motion-capture animations.
- Multiplayer is a basic server-relayed prototype, not a hardened authoritative production server. It does not yet provide host migration, voice chat, persistent accounts, anti-cheat hardening, or robust reconnect recovery.
- The campaign currently implements a compact vertical slice rather than all twelve missions.
- The server trusts some client-side movement and should not be exposed publicly without validation, rate limiting, authentication, and deployment security.
- No claim is made that five separate internet clients or the full campaign have passed QA. Test using separate browser windows / devices and inspect server logs.

## Structure
```
src/
  main.js          Three.js scene, controls, characters, enemies, mission logic and HUD
  style.css        cinematic UI
  net.js           Socket.IO client room synchronization
server/
  index.js         room/session server
```

## Realistic character upgrade path
Use original, commercially licensed human character assets with a compatible humanoid skeleton (GLB/GLTF), plus licensed motion-capture clips for idle, walk, run, jump, climb, hit, attack, death and revive. Keep asset licenses in `ASSET_LICENSES.md`. Do not hotlink unlicensed movie models or actors.
