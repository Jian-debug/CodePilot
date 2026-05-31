import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldDecomposeStep,
  buildSubGoal,
  DEFAULT_MAX_DEPTH,
} from '../../lib/workflow/decomposition';

describe('workflow/decomposition — shouldDecomposeStep', () => {
  it('decomposes a failed high step under the depth cap', () => {
    assert.equal(
      shouldDecomposeStep({ passed: false, complexity: 'high', depth: 0, maxDepth: 1 }),
      true,
    );
  });

  it('never decomposes a step that passed', () => {
    assert.equal(
      shouldDecomposeStep({ passed: true, complexity: 'high', depth: 0, maxDepth: 1 }),
      false,
    );
  });

  it('only decomposes high-complexity steps', () => {
    for (const complexity of ['low', 'medium'] as const) {
      assert.equal(
        shouldDecomposeStep({ passed: false, complexity, depth: 0, maxDepth: 1 }),
        false,
        `complexity=${complexity} must not decompose`,
      );
    }
  });

  it('stops at the depth cap (no unbounded recursion)', () => {
    // At depth 1 with maxDepth 1, a sub-workflow step cannot recurse further.
    assert.equal(
      shouldDecomposeStep({ passed: false, complexity: 'high', depth: 1, maxDepth: 1 }),
      false,
    );
    // maxDepth 2 allows one more level.
    assert.equal(
      shouldDecomposeStep({ passed: false, complexity: 'high', depth: 1, maxDepth: 2 }),
      true,
    );
  });

  it('maxDepth 0 disables recursion entirely', () => {
    assert.equal(
      shouldDecomposeStep({ passed: false, complexity: 'high', depth: 0, maxDepth: 0 }),
      false,
    );
  });

  it('default max depth allows exactly one level', () => {
    assert.equal(DEFAULT_MAX_DEPTH, 1);
    assert.equal(
      shouldDecomposeStep({ passed: false, complexity: 'high', depth: 0, maxDepth: DEFAULT_MAX_DEPTH }),
      true,
    );
    assert.equal(
      shouldDecomposeStep({ passed: false, complexity: 'high', depth: DEFAULT_MAX_DEPTH, maxDepth: DEFAULT_MAX_DEPTH }),
      false,
    );
  });
});

describe('workflow/decomposition — buildSubGoal', () => {
  it('carries the step instructions and acceptance criteria into the sub-goal', () => {
    const g = buildSubGoal('Add auth', 'Implement JWT login', 'Login returns a valid token');
    assert.ok(g.includes('Add auth'));
    assert.ok(g.includes('Implement JWT login'));
    assert.ok(g.includes('Login returns a valid token'));
  });

  it('omits the criteria section when none is given', () => {
    const g = buildSubGoal('Title', 'Do it', '   ');
    assert.ok(g.includes('Title'));
    assert.ok(g.includes('Do it'));
    assert.ok(!g.includes('only done when'));
  });
});
