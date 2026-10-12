# Test report — The Fifth Relic v0.1.0 (vertical slice)

Run on 12 Oct 2026, Linux VM (no GPU), Node 22, Chromium 141 with software WebGL (SwiftShader).
Commands: `npm test` (16 tests, ~30 s) and `python3 tests/browser_e2e.py` (12 checks, ~5 min on this VM).

## Summary

| Acceptance test | Result | How it was tested |
|---|---|---|
| A. Five-player session | **Pass** | 5 separate WebSocket clients: join by code (6th refused), pick distinct avatars, host-only start, move, attack a creature, shared objective completes for all. Browser run: 2 real browsers through the full UI + 3 protocol clients (see note 1). |
| B. Avatar abilities | **Pass** | Every Q/E ability and passive checked for its effect: Bulwark −70 % + taunt, silent takedown ×3, armor facing, Decoy redirect, Overload ×3, Mend, Veil drops aggro and breaks on attack, ammo limits, cooldowns enforced. |
| C. Lives and respawning | **Pass** | Downed → revive (no mark lost), bleed-out → −1 mark → checkpoint respawn, ravine fall, last mark → spectator, Life Shrine donation (and refusal at 1 mark), full team wipe → mission restart at 1 mark each. |
| D. Enemy AI | **Pass** | Razorback sight/hearing, crouch stealth, telegraphed charge, pack hesitation around groups, flee at low HP; Canopy Stalker ignores pairs, ambushes lone players with a telegraph, climbs away when focused. |
| E. Mission progression | **Pass** | Map can't be taken before shelter; later objectives refuse to complete early; camp/ravine don't advance without prerequisites. |
| F. Puzzles | **Pass** | One winch does nothing; broken winch repair (Circuit 2×); both winches lower the bridge; Titan log alternative; 2 of 3 plates insufficient; 5 players turning one pillar in the same tick produce exactly one turn; mural solution opens the gate; pillars lock once solved. |
| G. Multiplayer recovery | **Pass** | Socket dropped mid-game → AI covers the slot → resume token returns the same slot with lives, health and mission intact; bad token refused. Browser: auto-reconnect into the same slot, other clients see the drop and the return. |
| H. Final boss | **Pass** | Colossus core immune until plates break; one anchor doesn't kneel it, two do; core damage only while kneeling; phase 3 below 35 %; portal appears on death. Curator shielded while his wave lives. |
| I. Endings | **Pass** | Restore (incl. dropping the Relic on death and recovering it), Destroy (shielded nodes), Separate (locked without 3 records; wrong note resets) all reach the end screen. |
| J. Performance | **Partly measured** | Server only: 1.0 ms average tick (1.7 ms worst) with 5 clients and 19 creatures against a 50 ms budget; ~119 KB/s per client; 78 MB RSS. **Client frame rate and load time on real GPUs: not measured** (note 2). |
| K. Exploit prevention | **Pass** | Speed hacks clamped, duplicate/stale action packets ignored, malformed and oversized messages rejected, flooding rate-limited, client-sent hp/lives ignored, rewards granted once per profile, saves only at mission boundaries, Relic outfit locked until completion, avatar switching blocked away from camp/in combat, path traversal on the static server blocked (403, checked manually with curl). |
| L. Full campaign | **Pass** | (1) Scripted director run from a fresh start to credits through the real action handlers, collecting all three Lost Records and reaching the secret ending. (2) **No-teleport autoplay**: one autopilot player that only sends client-equivalent inputs plus four AI companions finished the campaign on Adventurer (Restore and Destroy) and Relentless (Restore), 5–7 minutes each, with real downs and deaths. |

## Update — playtest fixes (12 Oct 2026)

Reported by the player: arrow keys did nothing; characters moved like robots; people walked through each other and through trees. Found while replaying locally:

- **Arrow keys** now move like WASD (and no longer scroll the page).
- **Real people instead of block figures**: every character is now a rigged, skinned human (woman or man, chosen in the lobby) with motion-captured idle, walk and run that blend by actual speed, plus crouch, attack, carrying and downed poses layered on the skeleton. The two source models faced opposite directions; the man walked backwards and the woman's arms stuck up until both were put in the same frame before retargeting (checked visually in the lobby and in game).
- **No more walking through things**: the server now keeps players, companions, creatures and bosses apart (solid bodies), tree trunks are wider, and the camera no longer passes through trees and walls.
- **Creatures and companions attacked through walls**: line-of-sight is now checked.
- **Softlocks**: killed temple guardians could come back to life when the key was taken; the Curator's shield could stay up forever when one guard wandered into a corridor; the final defence could snowball into an unwinnable crowd. All fixed, with regression tests.
- The "Click here to play" banner sat on top of your own character; it now sits higher.

`npm test`: 20/20 on 7 of 8 runs; one run had a single failure that did not reproduce in seven reruns (the autoplay campaigns are randomised). Not re-tested on the live site: the browser connection to the player's Chrome was unavailable, so all checks ran on a local copy.

## Bugs found and fixed by these tests

- Mission objects lost their dynamic properties (a repaired winch kept its 4-second repair timer, so cranking silently stopped).
- Mission updates kept running after advancing, which would have crashed the server at the end of Missions 2, 3 and 5.
- A dropped Relic near a human was never picked up again by companions (softlock on Relentless).
- Companion carriers never took the Relic to the Cradle.
- Client opened two WebSockets when "Create" was clicked during connection.
- The lobby's 3D preview and its layout resized each other every frame on narrow windows.
- Colossus chain rendering crashed before the boss existed; terrain colours were washed out; HUD overlaps.
- Balance: the first version had zero downs across a whole run; creature health/damage, boss health, waves and companion reflexes were retuned.

## Notes

1. **Five real browsers.** The test supports `N_BROWSERS=5`, and five browsers did load, join one lobby and ready up on this VM, but five software-rendered WebGL browsers pushed the load average past 16 and the run timed out before gameplay. The passing run uses two real browsers plus three protocol-level clients — five separate network clients, but not five browser UIs. Run `N_BROWSERS=5 python3 tests/browser_e2e.py` on a machine with a GPU to confirm.
2. **Client performance** was only observed under software rendering, which says nothing about real hardware. Untested: frame rate, GPU memory, load time on a typical laptop.
3. **Internet play** was tested on localhost only. Latency is handled with client-side prediction and 100 ms interpolation, but no test injected real network delay or packet loss.
4. **Not tested at all:** gamepad input (no device), how the procedural audio and browser speech sound, mobile/touch, Firefox and Safari, a real server restart mid-campaign followed by "Continue" (the save/load code path is exercised in unit tests only), and difficulty balance with human players.

## Not implemented in this slice

- Missions from the full design: Teeth in the Dark (caves), The Basin Hunt, The Curator's Outpost (stealth fortress), the shifting labyrinth; Regions C (swamp) and D (mountains) as separate areas.
- Creatures: Mire Crawlers, Glasswing Swarms, the Ashen Matriarch, the Relic Warden.
- Swimming, climbing surfaces and sliding (jumping and mantling onto ledges work).
- Voice chat (text chat and pings work). Creatures reacting to weather and scent.
- Unlockable abilities and character progression beyond XP and the cosmetic Relic outfit.
