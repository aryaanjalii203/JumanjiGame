# The Fifth Relic

A cinematic cooperative survival adventure for five players. Five bearers are pulled into a world built by an ancient device, take on avatars with real strengths and weaknesses, carry three life marks each, and must work together through creatures, puzzles, a giant boss and a final choice to get home.

Browser client (three.js) + authoritative Node.js server (WebSockets). Everything — models, music, sound — is generated procedurally from code; there are no third-party art or audio assets.

This is a **playable vertical slice of the full design**: one connected world, six missions, three endings. See `docs/BLUEPRINT.md` for the full design and `docs/TEST_REPORT.md` for exactly what is tested and what isn't.

## Quick start (clean machine)

1. Install [Node.js 18 or newer](https://nodejs.org).
2. In this folder:
   ```
   npm install
   npm start
   ```
3. Open http://localhost:8080 in Chrome, Edge or Firefox. Click once (browsers need a click before playing sound), watch or skip the prologue, enter a name, and **Create a session**.
   In the lobby, pick an avatar and choose your character's body (woman or man) — it applies to whichever avatar you play and is remembered on that browser.
4. Friends open the same address and **Join** with the 6-character code. Empty slots are filled by AI companions when the host starts, so you can play alone.

## Playing with friends

- **Same network (LAN):** start the server on one computer and share `http://<that computer's local IP>:8080`. Allow Node through the firewall when asked.
- **Over the internet:** host on any small VPS (1 vCPU / 512 MB is plenty for a few sessions). Put it behind a reverse proxy that supports WebSocket upgrades and HTTPS, for example Caddy:
  ```
  relic.example.com {
    reverse_proxy localhost:8080
  }
  ```
  The client automatically uses `wss://` when served over HTTPS. Port-forwarding 8080 on a home router also works for quick sessions.
- Nothing needs credentials or API keys.

### Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP + WebSocket port |
| `FR_DATA` | `data/saves.json` | Where session checkpoints and player profiles are saved |
| `FR_DEBUG` | off | `1` enables `/debug/warp?code=XXXXXX&mission=N` for testing. Never enable on a public server. |

`/healthz` returns server status, live session count and traffic counters.

## Controls

| Action | Keyboard and mouse | Gamepad |
|---|---|---|
| Move / look | WASD / mouse (click the game to capture the mouse) | Left stick / right stick |
| Sprint / crouch / jump | Shift / C / Space | L3 / R3 / A |
| Attack | Left click | RT |
| Avatar abilities | Q / E | LB / RB |
| Dodge (brief invulnerability) | V | B |
| Interact, hold to revive or crank | F | X |
| Eat a healing herb | H | D-pad down |
| Ping a spot / danger ping | G / Alt+G | D-pad up |
| Map and team | Hold Tab | |
| Journal / chat / pause | J / Enter / Esc | Start (pause) |
| Vote to skip a cutscene | K | Y |
| Switch avatar (at a camp, out of combat) | 1 to 5 | |

## How the game works

**Avatars.** TITAN (heavy, protects, lifts logs and breaks cracked walls; slow and loud), WRAITH (fast scout, triple-damage silent takedowns, marks threats; fragile, weak against armor), CIRCUIT (decoys, repairs twice as fast, Overload triples damage to armor; weak hits, long cooldowns), ORACLE (team heals, tracking that teaches creature behavior, fast revives; carries fewer herbs), PHANTOM (ranged, invisibility, a smoke escape for the team; 12 shots between supply caches, takes extra damage when surrounded). No avatar is required to progress; each has puzzles or fights it makes easier.

**Lives.** Everyone has three marks. At zero health you go down and teammates can revive you (hold F) without losing a mark. Bleed out or fall into the ravine and you lose a mark and respawn at the checkpoint. With no marks left you spectate until a teammate gives you one of theirs at a Life Shrine, or the team reaches the next checkpoint. If all five are out, the mission restarts with everyone on one mark.

**Campaign.** Prologue → Lost in the Wilds → The Broken Bridge → The Forgotten Temple → The Hollow Colossus → The World Beneath the World (the false exit) → The Last Choice → ending and credits. Three endings, each reached through play: carry and defend the Relic, break its three fracture nodes, or — if you found all three hidden Lost Records — strike the resonance stones in the order the records teach.

**Difficulty.** Story (gentler damage, latched pressure plates, full puzzle hints), Adventurer (as designed), Relentless (heavier hits, fewer herbs, no hints).

**Saving.** Progress is saved at the start of each mission and when Lost Records are found. Rejoin a saved session from the menu (or enter its code) after a server restart. Finishing the campaign unlocks the Relic outfit for every human player's profile.

## Project layout

```
client/            browser game: index.html, style.css, main.js (screens, input, prediction, HUD, cutscenes),
                   render.js (procedural three.js world and models), audio.js (synthesized audio), net.js
server/            index.js (HTTP + WebSocket server), session.js (authoritative simulation, lobby, lives),
                   creatures.js (creature AI), bosses.js, missions.js (mission graph), ai.js (companions), saves.js
shared/            world.js (deterministic world, terrain, collision, movement), data.js (avatars, creatures,
                   difficulty), story.js (all dialogue and text) — used by both server and client
tests/             acceptance.test.js (tests A–L), autoplay.js / autoplay.test.js (organic playthroughs),
                   browser_e2e.py (five real browsers), harness.js (headless network client)
docs/              RESEARCH.md, BLUEPRINT.md, TEST_REPORT.md
```

## Architecture notes

- The server owns all gameplay state: positions, health, lives, inventory, cooldowns, damage, objectives, rewards. Clients send only intent (a movement direction, "attack", "interact"), which is clamped, rate-limited and de-duplicated by sequence number.
- The simulation ticks at 20 Hz and broadcasts a snapshot every tick. Clients interpolate remote entities 100 ms behind and predict their own movement with the same shared movement code, then reconcile with the server.
- If a player's connection drops, an AI companion takes over their slot. The same browser tab rejoins automatically with a reconnect token (a page reload in that tab also resumes); anyone who doesn't come back within two minutes is replaced by AI permanently. If the host leaves, host duties move to the next human. The server is authoritative, so no session state lives on a player's machine.

## Testing

```
npm test            # acceptance tests A–L + three full autoplay campaigns (about 30 s)
npm run test:e2e    # five separate Chromium browsers play together through the real UI
                    # (needs: pip install playwright && python3 -m playwright install chromium)
npm run autoplay    # watch a no-teleport playthrough print mission timings
```

## Licensing

Game code: MIT (see `LICENSE`). Third-party: three.js (MIT), ws (MIT). Typefaces loaded from Google Fonts: Big Shoulders Stencil Display and Instrument Sans (SIL Open Font License 1.1); the game falls back to system fonts offline. All characters, names, dialogue, creatures and places are original. The project draws on the general idea of a cooperative trapped-in-a-game adventure; it uses no names, scenes, dialogue or designs from any film.
