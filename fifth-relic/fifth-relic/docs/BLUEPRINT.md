# THE FIFTH RELIC — Design Blueprint (Phase 0, Steps 3–4)

## 1. Research summary
See `RESEARCH.md`. Principles carried over: complementary avatars with real weaknesses; three visible lives with a life-sacrifice mechanic; a game that knows it is a game (rhyming clues, a looping guide voice, level structure); a lost-time twist; an artifact objective reframed late; escalation wildlife → organized enemies → boss → team climax; an ending that reaches the real world. Nothing else (names, scenes, dialogue, designs) is used.

## 2. Story

**Premise.** In 1989 the five-person Kestrel Expedition found an ancient world-engine — a palm-sized device later called THE FIFTH RELIC — in a jungle research station. It builds a world from the minds of whoever holds it, and stays stable only with **five bearers**. Four of the expedition fled or died. Biologist **Dr. Elias Marrow** stayed, tried to bend the world alone, and became **THE CURATOR**: a man half-merged with the machine, believing only months have passed. (Logs reveal 37 years.)

**What players think.** The Curator stole the Relic's *Heart Key*; recover it and use the exit.
**Twist 1 (mid).** The "exit portal" is the Curator's trap. He doesn't want them out — he wants five new bearers to anchor the world so *he* can leave.
**Twist 2 (late, M5 logs).** The Curator didn't make the danger alone: the Relic has been reshaping the world in reaction to *this team*, testing whether five people can hold it together. The creatures escalate because the team does.
**Climax.** In the Heart chamber the Curator tries to seize the Relic. The team decides its fate — through gameplay.

## 3. Mission sequence

**Built in this vertical slice (one connected map, one continuous campaign):**

| # | Mission | Content |
|---|---|---|
| 0 | Prologue | Storm-struck research station cinematic, title reveal, lobby, avatar select, transportation, per-avatar reveal |
| 1 | Lost in the Wilds | Movement/combat taught in-world by the guide voice; find shelter, recover map fragment, first Razorback pack; reach abandoned camp (Curator log #1). Checkpoint. |
| 2 | The Broken Bridge | Cross the ravine under Canopy Stalker ambush. Two valid strategies: crank **two winches at once** (one may need repair — Circuit does it 2× faster), **or** Titan lifts the fallen log. |
| 3 | The Forgotten Temple | Pressure-plate room (3 players at once) → rotating glyph pillars matching a mural clue. Optional hidden Lost Records (3) unlock the secret ending. Guardian pack defends. Recover the Heart Key. |
| 4 | The Hollow Colossus | Three-phase boss (see §5). |
| 5 | The False Exit / World Beneath | Exit portal opens → trap; logs reveal Marrow's past and Twist 2; Curator confrontation begins. |
| 6 | The Last Choice | Defeat the Curator's surge waves, then choose by doing: **Restore** (carry the Relic to the Cradle, defend a 30 s channel), **Destroy** (break 3 fracture nodes, each shielded until two players hold its plates), **Separate** (secret: requires all 3 Lost Records; strike 5 resonance stones in the order the records teach). |
| 7 | Return to Reality | Ending cinematic per choice + team stats, per-avatar fate, credits, post-credits sting. |

**Designed but not built yet** (spec mission numbers): 3 Teeth in the Dark (caves), 5 Basin Hunt + Ashen Matriarch, 6 Curator's Outpost (stealth fortress), 10 shifting labyrinth; full Regions B–D as separate areas; Mire Crawlers, Glasswing Swarms, Relic Warden. These slot between existing missions without replacing them.

## 4. Avatars (all non-mandatory; every ability server-validated)

| Avatar | HP / speed | Primary | Q | E | Passive / weakness |
|---|---|---|---|---|---|
| **TITAN** leader | 170 / 5.6 | Heavy melee 32 (stamina) | Bulwark: −70 % dmg 5 s + taunts nearby creatures | Heave: lift heavy objects / break cracked barriers | Loud (×1.6 detection), slow, heavy swings drain stamina |
| **WRAITH** scout | 85 / 8.8 | Blade 16; ×3 on unaware target (silent takedown) | Mark: reveal creatures 10 s, marked take +25 % | Dash (long, i-frames) | Quiet (×0.5); fragile; −50 % vs armor |
| **CIRCUIT** engineer | 105 / 6.6 | Arc tool 10 | Decoy: creatures target it 6 s | Overload: armor/weak points take ×3 for 8 s | Repairs 2× faster; weak damage, long cooldowns |
| **ORACLE** survivalist | 110 / 6.6 | Staff 14 | Mend: heal team 45 in radius | Track: reveal creatures + behavior hint | Revives 2× faster, finds extra herbs; holds only 6 ammo-equiv |
| **PHANTOM** operative | 90 / 7.0 | Ranged 26 (12 ammo, refill at caches) | Veil: invisible 6 s, breaks on attack | Smoke: teammates in radius untargetable 3 s (emergency escape) | Ammo-limited; takes +30 % dmg with 3+ enemies near |

Avatars are switchable only at camps/checkpoints outside combat.

## 5. Creatures and bosses

- **Razorbacks** (pack hunters): idle → patrol → investigate (noise) → chase → telegraphed charge → retreat below 30 % HP → death. Prefer isolated targets; hesitate and circle when the target has 2+ allies close.
- **Canopy Stalkers** (arboreal): perch in canopy, invisible until revealed or striking; ambush a *lone* player beneath (rustle + shadow telegraph 0.8 s), climb back, flee when focused by 2+ players or under 50 % HP.
- **Stone Guardians** (temple constructs): armored front (−80 %); weak point on the back; Overload strips armor.
- **The Hollow Colossus** (boss): P1 break four leg plates (stomp ring, sweep) → P2 two chain anchors held simultaneously drag it to its knees, core exposed 8 s; summons Razorbacks, throws rocks at the farthest player (ground marker) → P3 below 30 %: faster stomps, arena hazard rings.
- **The Curator** (final): projected avatar; surge waves, beam with telegraph, shield that drops when the Relic is contested.

## 6. Multiplayer & lives

- Node.js authoritative server (WebSocket). Server owns all health, lives, positions, inventory, cooldowns, damage, objectives. Clients send inputs only; the server clamps speed, rate-limits and dedupes actions by sequence number.
- Sessions with 6-character join codes, 5 slots, ready-up, host role migrates to the next human, AI companions fill empty or disconnected slots.
- Reconnect: a token in session storage reclaims the same slot within 120 s; the AI drives it meanwhile.
- Text chat, ping/danger markers, teammate status panel. Voice chat not in this slice.
- **Lives:** 3 marks. HP 0 → death sequence, −1 life, 4 s out, respawn at checkpoint, 2 s grace. 0 lives → spectator; rescued when a teammate activates the next checkpoint (returns with 1 life) or **donates one of their own lives at a Life Shrine**. All five out → team wipe: reload the last checkpoint, everyone at 1 life, mission sub-progress reset.
- Difficulty (Story / Adventurer / Relentless) scales enemy damage, herb drops, checkpoint generosity and puzzle hints.

## 7. Endings
Restore → world stabilizes, team wakes in the station, Marrow stays as its keeper. Destroy → world collapses behind them; Marrow returns, 37 years older. Separate → the world lives on without a bearer, the Relic goes dark, Marrow walks out in 1989 — and the station is later found rebuilt as a museum with five plaques. Post-credits: the device lights a **sixth** slot.

## 8. Technical plan
- `shared/` deterministic terrain, map layout, avatar + creature data (imported by server and client).
- `server/`: HTTP static + WS; `Session` (lobby, sim 20 Hz), `entities`, `creatures` (state machines), `missions` (objective graph with prerequisites), `puzzles`, `saves` (JSON file persistence: checkpoints, profiles, one-time rewards).
- `client/`: Three.js (procedural low-poly art, no third-party models), WebAudio procedural score/SFX, DOM UI.
- Tests: `node --test` with real WebSocket headless clients (5 separate connections) for acceptance tests; Playwright run with 5 real browser tabs.

## 9. Known gaps / assumptions
- No complete screenplay was used (see RESEARCH.md).
- Browser stack ≠ AAA graphics; stylized low-poly by design.
- Not yet: swimming, true climbing (jump/mantle on ledges only), voice chat, gamepad mapping beyond basic, missions listed as "not built".
