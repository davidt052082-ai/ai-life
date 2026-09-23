import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDate, calculateEstimatedHours, milestoneRelations } from '../src/task-management/scheduling.js';

test('estimates include both dates, weekends, leap days and DST boundaries', () => {
  for (const [start, end, expected] of [
    ['2026-09-22', '2026-09-22', 8], ['2026-09-20', '2026-09-22', 24],
    ['2026-09-30', '2026-10-02', 24], ['2024-02-28', '2024-03-01', 24],
    ['2026-03-07', '2026-03-09', 24], ['2026-10-31', '2026-11-02', 24]
  ]) assert.equal(calculateEstimatedHours(start, end), expected);
});
test('missing, reversed and impossible dates never produce negative or NaN hours', () => {
  for (const value of ['', null, undefined, '2026-02-29', '2026-04-31', 'invalid', 123]) {
    assert.equal(calendarDate(value), null);
    assert.equal(calculateEstimatedHours(value, '2026-09-22'), 0);
    assert.equal(calculateEstimatedHours('2026-09-22', value), 0);
  }
  assert.equal(calculateEstimatedHours('2026-09-23', '2026-09-22'), 0);
});
const milestone = (id) => ({ id, title: id, isMilestone: true });
const task = (id) => ({ id, title: id, isMilestone: false });
const dep = (predecessorId, successorId) => ({ predecessorId, successorId });
test('isolated milestones appear without inventing chronological dependencies', () => {
  const result = milestoneRelations([milestone('B'), task('T'), milestone('A')], []);
  assert.deepEqual(result.milestones.map((item) => item.id), ['A', 'B']);
  assert.deepEqual(result.edges, []);
});
test('milestone graph preserves direct and indirect links and stops at the next milestone', () => {
  const result = milestoneRelations([milestone('A'), task('T'), milestone('B'), milestone('C')],
    [dep('A', 'T'), dep('T', 'B'), dep('B', 'C')]);
  assert.deepEqual(result.edges, [
    { predecessorId: 'A', successorId: 'B', viaTaskIds: ['T'], indirect: true },
    { predecessorId: 'B', successorId: 'C', viaTaskIds: [], indirect: false }
  ]);
});
test('direct connections take precedence, duplicates and external records are ignored', () => {
  const result = milestoneRelations([milestone('A'), task('T'), milestone('B')],
    [dep('A', 'T'), dep('T', 'B'), dep('A', 'B'), dep('A', 'B'), dep('foreign', 'B'), dep('B', 'foreign')]);
  assert.deepEqual(result.edges, [{ predecessorId: 'A', successorId: 'B', viaTaskIds: [], indirect: false }]);
});
test('cycles and self-dependencies terminate and remain visible', () => {
  const result = milestoneRelations([milestone('A'), task('T'), task('U'), milestone('B')],
    [dep('A', 'T'), dep('T', 'U'), dep('U', 'T'), dep('U', 'B'), dep('B', 'A'), dep('A', 'A')]);
  assert.equal(result.edges.length, 3);
  assert.ok(result.edges.some((edge) => edge.predecessorId === 'A' && edge.successorId === 'A'));
  assert.ok(result.edges.some((edge) => edge.predecessorId === 'A' && edge.successorId === 'B' && edge.indirect));
  assert.ok(result.edges.some((edge) => edge.predecessorId === 'B' && edge.successorId === 'A'));
});
