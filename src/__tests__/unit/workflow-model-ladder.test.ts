import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startRungForComplexity, rungForAttempt } from '../../lib/workflow/model-ladder';
import type { LadderRung } from '../../lib/workflow/types';

const ladder3: LadderRung[] = [
  { providerId: '', model: 'haiku', role: 'small' },
  { providerId: '', model: 'sonnet', role: 'sonnet' },
  { providerId: '', model: 'opus', role: 'opus' },
];

describe('workflow/model-ladder — startRungForComplexity', () => {
  it('low keeps the full ladder (cheapest first)', () => {
    assert.deepEqual(
      startRungForComplexity(ladder3, 'low').map((r) => r.model),
      ['haiku', 'sonnet', 'opus'],
    );
  });

  it('medium drops the cheapest rung', () => {
    assert.deepEqual(
      startRungForComplexity(ladder3, 'medium').map((r) => r.model),
      ['sonnet', 'opus'],
    );
  });

  it('high starts at the strongest rung', () => {
    assert.deepEqual(
      startRungForComplexity(ladder3, 'high').map((r) => r.model),
      ['opus'],
    );
  });

  it('never trims below one rung for short ladders', () => {
    const single: LadderRung[] = [{ providerId: '', model: 'sonnet', role: 'session' }];
    assert.deepEqual(startRungForComplexity(single, 'high'), single);
    const two: LadderRung[] = [
      { providerId: '', model: 'sonnet', role: 'sonnet' },
      { providerId: '', model: 'opus', role: 'opus' },
    ];
    assert.deepEqual(startRungForComplexity(two, 'high').map((r) => r.model), ['opus']);
    assert.deepEqual(startRungForComplexity(two, 'medium').map((r) => r.model), ['opus']);
  });

  it('does not mutate the input ladder', () => {
    const copy = ladder3.slice();
    startRungForComplexity(ladder3, 'high');
    assert.deepEqual(ladder3, copy);
  });
});

describe('workflow/model-ladder — rungForAttempt', () => {
  it('walks the ladder cheap→strong, then repeats the strongest rung', () => {
    // ladder length 3, but 5 attempts (2 extra retries) → opus repeats
    const seq = [0, 1, 2, 3, 4].map((i) => rungForAttempt(ladder3, i).model);
    assert.deepEqual(seq, ['haiku', 'sonnet', 'opus', 'opus', 'opus']);
  });

  it('repeats the only rung for a single-rung ladder (hard-step retries)', () => {
    const single: LadderRung[] = [{ providerId: '', model: 'opus', role: 'opus' }];
    assert.deepEqual([0, 1].map((i) => rungForAttempt(single, i).model), ['opus', 'opus']);
  });

  it('throws on an empty ladder (defensive)', () => {
    assert.throws(() => rungForAttempt([], 0));
  });
});
