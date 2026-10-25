const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCommand } = require('../src/commands');
const data = require('../cases/trophy-at-table-nine.json');

test('commands are case-insensitive and ignore extra words', () => {
  assert.deepEqual(parseCommand('!SEARCH 2 please', data), { type: 'search', value: 2 });
  assert.deepEqual(parseCommand('!c e2', data), { type: 'contradict', value: 'E2' });
  assert.deepEqual(parseCommand('!ask d', data), { type: 'ask', value: 'D' });
});

test('unknown and invalid commands are ignored', () => {
  assert.equal(parseCommand('!search 99', data), null);
  assert.equal(parseCommand('!accuse Z', data), null);
  assert.equal(parseCommand('not a command', data), null);
});

test('valid values are derived from a case with four locations and five suspects', () => {
  const custom = { locations: Array.from({ length: 4 }, (_, i) => ({ id: i + 1, evidence: { id: `CLUE${i + 1}` } })), suspects: { A: {}, B: {}, C: {}, D: {}, E: {} } };
  assert.deepEqual(parseCommand('!search 4', custom), { type: 'search', value: 4 });
  assert.deepEqual(parseCommand('!ask e', custom), { type: 'ask', value: 'E' });
  assert.deepEqual(parseCommand('!accuse E', custom), { type: 'accuse', value: 'E' });
  assert.deepEqual(parseCommand('!contradict clue4', custom), { type: 'contradict', value: 'CLUE4' });
  assert.equal(parseCommand('!search 5', custom), null);
});
