import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDependencyGraph,
  linearChain,
  runDag,
} from '../../lib/workflow/scheduler';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('workflow/scheduler — buildDependencyGraph', () => {
  it('detects a 2-node cycle', () => {
    assert.equal(buildDependencyGraph([[1], [0]]).hasCycle, true);
  });

  it('treats a chain as acyclic with correct indegrees', () => {
    const g = buildDependencyGraph([[], [0], [1]]);
    assert.equal(g.hasCycle, false);
    assert.deepEqual(g.indegree, [0, 1, 1]);
    assert.deepEqual(g.dependents[0], [1]);
  });

  it('drops out-of-range, self, duplicate and non-integer edges', () => {
    const g = buildDependencyGraph([[0, 5, 1, 1, 2.5], []]);
    // node 0: self(0) dropped, 5 out-of-range dropped, 1 kept once, 2.5 dropped
    assert.deepEqual(g.dependsOn[0], [1]);
    assert.equal(g.hasCycle, false);
  });

  it('linearChain produces a strict i->i-1 chain', () => {
    assert.deepEqual(linearChain(3), [[], [0], [1]]);
  });
});

describe('workflow/scheduler — runDag', () => {
  it('respects topological order and runs independent steps in parallel', async () => {
    // diamond: 0 -> {1,2} -> 3
    const graph = buildDependencyGraph([[], [0], [0], [1, 2]]);
    const startOrder: number[] = [];
    let concurrent = 0;
    let maxConcurrent = 0;
    const res = await runDag({
      graph,
      maxConcurrency: 3,
      haltOnFailure: true,
      run: async (idx) => {
        startOrder.push(idx);
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await delay(10);
        concurrent--;
        return true;
      },
    });
    assert.equal(startOrder[0], 0, 'root runs first');
    assert.equal(startOrder[3], 3, 'sink runs last');
    assert.equal(maxConcurrent, 2, 'the two middle steps overlap');
    assert.equal(res.passedCount, 4);
    assert.ok(res.outcome.every((o) => o === 'passed'));
  });

  it('never exceeds the concurrency cap', async () => {
    const graph = buildDependencyGraph([[], [], [], []]); // 4 independent
    let concurrent = 0;
    let maxConcurrent = 0;
    await runDag({
      graph,
      maxConcurrency: 2,
      haltOnFailure: false,
      run: async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await delay(10);
        concurrent--;
        return true;
      },
    });
    assert.equal(maxConcurrent, 2);
  });

  it('skips dependents transitively while independent branches continue (non-halt)', async () => {
    // 0 -> 1 -> 2 ; 3 independent. Step 1 fails.
    const graph = buildDependencyGraph([[], [0], [1], []]);
    const ran: number[] = [];
    const skipped: number[] = [];
    const res = await runDag({
      graph,
      maxConcurrency: 3,
      haltOnFailure: false,
      run: async (idx) => {
        ran.push(idx);
        await delay(5);
        return idx !== 1;
      },
      onSkip: (idx) => skipped.push(idx),
    });
    assert.equal(res.outcome[0], 'passed');
    assert.equal(res.outcome[1], 'failed');
    assert.equal(res.outcome[2], 'skipped');
    assert.equal(res.outcome[3], 'passed');
    assert.ok(!ran.includes(2), 'skipped step never executes');
    assert.deepEqual(skipped, [2]);
  });

  it('halt-on-failure stops launching new steps', async () => {
    const graph = buildDependencyGraph([[], [], [], []]);
    const ran: number[] = [];
    const res = await runDag({
      graph,
      maxConcurrency: 1,
      haltOnFailure: true,
      run: async (idx) => {
        ran.push(idx);
        await delay(5);
        return idx !== 0; // first step fails
      },
    });
    assert.deepEqual(ran, [0], 'only the first step ran before halt');
    assert.equal(res.outcome.filter((o) => o === 'skipped').length, 3);
  });

  it('treats a rejecting run() as a failure (defensive)', async () => {
    const graph = buildDependencyGraph([[], [0]]);
    const res = await runDag({
      graph,
      maxConcurrency: 2,
      haltOnFailure: true,
      run: async (idx) => {
        if (idx === 0) throw new Error('boom');
        return true;
      },
    });
    assert.equal(res.outcome[0], 'failed');
    assert.equal(res.outcome[1], 'skipped');
  });

  it('a linearChain graph forces strictly serial execution', async () => {
    const graph = buildDependencyGraph(linearChain(4));
    const order: number[] = [];
    let concurrent = 0;
    let maxConcurrent = 0;
    await runDag({
      graph,
      maxConcurrency: 5, // generous cap, but the chain forbids overlap
      haltOnFailure: true,
      run: async (idx) => {
        order.push(idx);
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await delay(3);
        concurrent--;
        return true;
      },
    });
    assert.deepEqual(order, [0, 1, 2, 3]);
    assert.equal(maxConcurrent, 1);
  });
});
