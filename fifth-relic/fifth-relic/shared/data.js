// Shared game data: avatars, creatures, difficulty. Imported by server and client.

export const MAX_SLOTS = 5;
export const TICK_HZ = 20;
export const START_LIVES = 3;

export const AVATARS = {
  titan: {
    name: 'TITAN', role: 'Expedition leader: heavy combat and protecting the team',
    color: 0xc8752f, hp: 170, speed: 5.6, noise: 1.6, radius: 0.75, scale: 1.3,
    attack: { kind: 'melee', dmg: 32, range: 3.0, arc: 1.4, cd: 0.9, stamina: 18 },
    q: { name: 'Bulwark', cd: 14, dur: 5, desc: '−70% damage for 5s and taunts nearby creatures onto you.' },
    e: { name: 'Heave', cd: 6, desc: 'Lift heavy objects (fallen logs) and break cracked barriers.' },
    passive: 'Can carry the Relic without slowing.',
    weakness: ['Slowest mover', 'Loud: creatures detect you from 1.6× range', 'Heavy swings drain stamina'],
    lore: 'A demolition foreman who held three collapsing mines together with nothing but sheer stubbornness.',
  },
  wraith: {
    name: 'WRAITH', role: 'Scout: stealth, agility and exploration',
    color: 0x4fb3a4, hp: 85, speed: 8.8, noise: 0.5, radius: 0.5, scale: 0.95,
    attack: { kind: 'melee', dmg: 16, range: 2.4, arc: 1.2, cd: 0.45, stamina: 6 },
    q: { name: 'Mark', cd: 12, dur: 10, desc: 'Reveal creatures within 30m for 10s. Marked targets take +25% damage.' },
    e: { name: 'Dash', cd: 4, desc: 'A long, untouchable dash.' },
    passive: 'Silent takedown: ×3 damage on creatures that have not noticed you.',
    weakness: ['Lowest health', 'Half damage against armor'],
    lore: 'A courier who never once used the same route twice.',
  },
  circuit: {
    name: 'CIRCUIT', role: 'Tactical engineer: gadgets, decoys and mechanisms',
    color: 0xe0c23a, hp: 105, speed: 6.6, noise: 1.0, radius: 0.55, scale: 1.0,
    attack: { kind: 'melee', dmg: 10, range: 2.6, arc: 1.3, cd: 0.6, stamina: 6 },
    q: { name: 'Decoy', cd: 16, dur: 6, desc: 'Drop a humming decoy that every nearby creature attacks for 6s.' },
    e: { name: 'Overload', cd: 18, dur: 8, desc: 'Armor and weak points within 25m take ×3 damage for 8s.' },
    passive: 'Repairs mechanisms twice as fast.',
    weakness: ['Weakest direct damage', 'Longest cooldowns'],
    lore: 'Rebuilt a ferry engine with a bread knife and a stubborn mood.',
  },
  oracle: {
    name: 'ORACLE', role: 'Survival specialist: healing, tracking and support',
    color: 0x8fbf4a, hp: 110, speed: 6.6, noise: 0.8, radius: 0.55, scale: 1.0,
    attack: { kind: 'melee', dmg: 14, range: 2.8, arc: 1.3, cd: 0.6, stamina: 6 },
    q: { name: 'Mend', cd: 15, desc: 'Heal every teammate within 10m for 45.' },
    e: { name: 'Track', cd: 10, dur: 10, desc: 'Reveal creature positions and learn how each one hunts.' },
    passive: 'Revives twice as fast. Finds extra herbs.',
    weakness: ['Moderate damage', 'Carries only 2 herbs'],
    lore: 'Read storms in the bark of trees before anyone believed it could be done.',
  },
  phantom: {
    name: 'PHANTOM', role: 'Operative: ranged attacks, deception and escapes',
    color: 0x8a6fd1, hp: 90, speed: 7.0, noise: 0.9, radius: 0.5, scale: 1.0,
    attack: { kind: 'ranged', dmg: 26, range: 42, cd: 0.55, ammo: 12 },
    q: { name: 'Veil', cd: 14, dur: 6, desc: 'Become invisible for 6s. Attacking breaks it.' },
    e: { name: 'Smoke', cd: 20, dur: 3, desc: 'Teammates within 9m cannot be targeted for 3s — an emergency escape.' },
    passive: 'Refills ammunition at supply caches.',
    weakness: ['12 shots between caches', 'Takes +30% damage when 3+ enemies are near'],
    lore: 'Nobody agrees on what Phantom looks like. Phantom prefers it that way.',
  },
};
export const AVATAR_IDS = Object.keys(AVATARS);
export const OUTFITS = ['expedition', 'nightfall', 'relic'];  // 'relic' unlocked by finishing the campaign

export const CREATURES = {
  razorback: { name: 'Razorback', hp: 95, speed: 6.6, chargeSpeed: 15, dmg: 20, sight: 20, hearing: 14, radius: 0.8,
    hint: 'Pack hunters. They pick off whoever strays alone and back off from tight groups. Wounded ones flee.' },
  stalker: { name: 'Canopy Stalker', hp: 120, speed: 7.8, dmg: 28, sight: 14, hearing: 10, radius: 0.7,
    hint: 'Waits in the canopy above lone travellers. A rustle and a shadow come first — dodge. It flees when ganged up on.' },
  guardian: { name: 'Stone Guardian', hp: 220, speed: 3.8, dmg: 30, sight: 16, hearing: 12, radius: 1.1, armor: 0.8,
    hint: 'Armored from the front. Strike the glowing back, or Overload its armor.' },
  colossus: { name: 'The Hollow Colossus', hp: 900, dmg: 30, radius: 4.5,
    hint: 'Break the four leg plates. Then hold BOTH chain anchors together to drag it to its knees.' },
  curator: { name: 'The Curator', hp: 760, dmg: 26, radius: 1.5,
    hint: 'Shielded while his creatures stand. His beam is drawn on the ground before it fires.' },
};

export const DIFFICULTY = {
  story:      { name: 'Story',      enemyDmg: 0.55, herbChance: 0.6,  hints: 2 },
  adventurer: { name: 'Adventurer', enemyDmg: 1.0,  herbChance: 0.35, hints: 1 },
  relentless: { name: 'Relentless', enemyDmg: 1.45, herbChance: 0.2,  hints: 0 },
};

export const GLYPHS = ['◐', '△', '✦', '◇', '☾', '⌘'];
