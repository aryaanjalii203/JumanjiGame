// All narrative text. Original writing for THE FIFTH RELIC.
// Speakers: STEWARD (the Relic's looping guide voice, speaks in rhyme), CURATOR (Dr. Elias Marrow), LOG (recordings), TEAM.

export const CUTSCENES = {
  // Played client-side before the lobby (not server-synced).
  prologue: {
    dur: 34, lines: [
      [1, 'LOG', 'Kestrel Station, field recording. Day... I have stopped counting days.'],
      [6, 'LOG', 'It answers when you hold it. Five lights. It wants five hands.'],
      [11, 'LOG', 'If anyone finds this — do not let it count you.'],
      [17, '', '(something mechanical turns beneath the floorboards)'],
      [24, '', 'A palm-sized device sits in the dust. Four of its five lights are dark.'],
      [29, '', 'The fifth flickers on.'],
    ],
  },
  transport: {
    dur: 9, lines: [
      [0.5, 'STEWARD', 'Five hands found, the count is true —'],
      [3.5, 'STEWARD', 'the Relic wakes, and wakes for you.'],
    ],
  },
  reveal: {
    dur: 16, lines: [
      [0.5, 'STEWARD', 'Welcome, bearers, to the world within.'],
      [4, 'STEWARD', 'Three marks you carry. Spend them thin, and the game will not let you back in.'],
      [9, 'STEWARD', 'The Curator took the key from the Heart. Return it, and the way home will start.'],
      [13.5, 'TEAM', 'Is that... my arm? Since when do I have tattoos?'],
    ],
  },
  camp: {
    dur: 14, lines: [
      [0.5, 'LOG', 'Marrow, expedition log. Okafor and Lindqvist left at dawn. They will not get far.'],
      [5.5, 'LOG', 'The Relic is only unstable because they keep LEAVING. Five hands. It needs five.'],
      [10.5, 'STEWARD', 'Across the gap the temple waits; two hands, two wheels, will raise the gates.'],
    ],
  },
  temple: {
    dur: 10, lines: [
      [0.5, 'STEWARD', 'Three stones that wish for weight; a wall of signs that sets them straight.'],
      [5.5, 'STEWARD', 'Read the mural, turn the stone. No bearer solves this door alone.'],
    ],
  },
  colossus: {
    dur: 13, lines: [
      [0.5, '', 'The hollow rises. Ribs of stone. A light where a heart should be.'],
      [5, 'CURATOR', 'You took my key. You will not take my door.'],
      [9, 'STEWARD', 'Four plates to shatter, two chains to pull; break the hollow, the way is full.'],
    ],
  },
  falseexit: {
    dur: 18, lines: [
      [0.5, 'STEWARD', 'The way is ope— the way is— the way—'],
      [3.5, 'CURATOR', 'Thirty-seven years I have been building that door. Did you think it was for you?'],
      [9, 'CURATOR', 'The Relic needs five bearers to stay whole. You are five. I am one, and I am tired.'],
      [14, 'CURATOR', 'Stay. Hold it together. And I will finally go home.'],
    ],
  },
  curator: {
    dur: 12, lines: [
      [0.5, 'CURATOR', 'It chose you. Do you understand? It never once chose me.'],
      [5.5, 'CURATOR', 'Then I will take it from you.'],
      [9, 'STEWARD', 'His creatures shield him while they stand. Cut them down, then make your stand.'],
    ],
  },
  choice: {
    dur: 16, lines: [
      [0.5, 'CURATOR', 'Thirty-seven years... I thought it was a season.'],
      [5, 'STEWARD', 'Three altars wait. Restore the Heart, and let the world go on its part;'],
      [10, 'STEWARD', 'break the Heart and end the game; or free the world — if you know its name.'],
    ],
  },
};

export const MISSION_TEXT = [
  { title: 'Prologue', sub: 'The Fifth Relic' },
  { title: 'Lost in the Wilds', sub: 'Mission 1' },
  { title: 'The Broken Bridge', sub: 'Mission 2' },
  { title: 'The Forgotten Temple', sub: 'Mission 3' },
  { title: 'The Hollow Colossus', sub: 'Mission 4' },
  { title: 'The World Beneath the World', sub: 'Mission 5' },
  { title: 'The Last Choice', sub: 'Mission 6' },
];

export const TUTORIAL = {
  move: 'WASD to move, mouse to look. SHIFT sprints, SPACE jumps, C crouches (quieter).',
  attack: 'Left click attacks. Q and E are your avatar abilities. V dodges through attacks.',
  heal: 'H eats a healing herb. Downed teammates can be revived — hold F next to them.',
  team: 'G pings where you are looking. Hold TAB for team status and the map. ENTER to chat.',
};

export const STEWARD_LINES = {
  shelter: 'The shelter stands, the storm is near; a torn map waits for those who steer.',
  map: 'A piece of the map, a piece of the way. Now something hungry has come to play.',
  pack: 'The pack has scattered, the trail runs north; the old camp waits — go forth, go forth.',
  bridgeUp: 'The bridge is down. Walk on, walk on.',
  logUp: 'A log for a bridge — crude, but strong.',
  gateA: 'Three hold the stones; the first gate parts.',
  gateB: 'The mural matched; the inner heart.',
  key: 'The key is yours. The hollow stirs.',
  terminals: 'Old voices sleep in old machines. Wake them, and learn what this place means.',
  doorOpen: 'The Heart is open. So is he.',
  dead: 'A mark is spent. The game goes on.',
  out: 'No marks remain. Your friends must carry you home.',
  wipe: 'All marks spent. Again, again — the game begins where it has been.',
  donate: 'A mark given is a mark that stays.',
};

// Lost Records: optional collectibles. Each teaches part of the resonance order (filled in per session).
export const RECORDS = [
  { title: 'Lindqvist — recording 4', text: 'The stones in the Heart sing when struck. Marrow says the order matters. I wrote the first two: {0}, then {1}.' },
  { title: 'Okafor — recording 9', text: 'If Elias ever reads this: the third and fourth are {2} and {3}. Strike them and the world can stand on its own.' },
  { title: 'Marrow — recording 1', text: 'I hid the last one where only someone willing to climb would find it: {4}. Then the Relic can let go of everyone.' },
];

export const TERMINALS = [
  { title: 'Station log — 03 Feb 1989', text: 'Device recovered from the temple floor. Five indicator lights. It responds to touch — and to group size.' },
  { title: 'Station log — 21 Mar 1989', text: 'Okafor and Lindqvist gone. Marrow alone with the Relic. Readings unstable since. He insists it "only needs more bearers".' },
  { title: 'Relic telemetry — continuous', text: 'Environmental output correlates with the CURRENT bearers, not the Curator. Every creature, every trap since your arrival was generated in response to YOU. It is not attacking. It is testing whether five people can hold together.' },
];

export const ENDINGS = {
  restore: {
    title: 'The Keeper',
    lines: [
      'The Heart takes the Relic back, and the jungle exhales.',
      'Marrow kneels at the Cradle. "Someone has to stay. Let it be the one who already knows the way."',
      'The five of you wake on the floor of Kestrel Station. The device is gone. Somewhere, the jungle is quiet.',
    ],
  },
  destroy: {
    title: 'The Last Light',
    lines: [
      'The fracture nodes split, and the world comes apart like wet paper.',
      'You run. Marrow runs with you — and outside, in the rain, he is an old man who left home young.',
      'The device lies in pieces on the station floor. None of its lights will ever turn on again.',
    ],
  },
  separate: {
    title: 'The World Without a Bearer',
    lines: [
      'Five notes, in the order three lost explorers left behind. The Relic lets go.',
      'The world does not fall. It breathes on its own. Marrow walks out of the jungle — into 1989, where he began.',
      'Years later, Kestrel Station reopens as a museum. Five brass plaques by the door carry your names.',
    ],
  },
  postCredits: 'On a shelf in the museum, the dark device clicks. A sixth light — one nobody knew it had — begins to glow.',
};
