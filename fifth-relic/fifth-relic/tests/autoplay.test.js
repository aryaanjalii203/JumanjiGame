// Organic playtest: one autopilot "player" (client-equivalent inputs only, no teleporting) + four AI companions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoplay } from './autoplay.js';

for (const [difficulty, choice] of [['adventurer', 'restore'], ['adventurer', 'destroy'], ['relentless', 'restore']]) {
  test(`autoplay: ${difficulty}, ${choice} ending reached without teleporting`, () => {
    const r = autoplay({ difficulty, choice, maxMinutes: 45 });
    console.log('AUTOPLAY', difficulty, choice, JSON.stringify({ minutes: r.minutes, downs: r.downs, deaths: r.deaths, wipes: r.wipes, missions: r.missions }));
    assert.ok(r.finished, `stalled in mission ${r.endMission} at "${r.objective}"`);
    assert.equal(r.choice, choice);
  });
}
