/**
 * workflow/scheduler.ts — DAG utilities for parallel step fan-out (P3).
 *
 * The planner already emits a `dependsOn` graph (0-based step indices). P1 ran
 * steps serially by idx and ignored it; P3 schedules independent steps to run
 * concurrently while respecting dependencies. This module is the pure graph
 * layer (no DB, no async, no SSE): it sanitizes the raw `dependsOn` edges,
 * builds indegree/dependents adjacency, and detects cycles so the engine can
 * fall back to a safe serial order.
 *
 * Parallel-safety is achieved through the graph, not locks: only steps with no
 * (transitive) dependency between them ever run at the same time, and the
 * planner is instructed to add a dependsOn edge between any two steps that touch
 * the same files (see planner.ts). The engine additionally caps concurrency.
 */

export interface DependencyGraph {
  /** Number of nodes (steps), indexed 0..size-1 by step idx. */
  size: number;
  /** Sanitized dependencies per node: in-range, integer, de-duped, no self-edge. */
  dependsOn: number[][];
  /** Reverse edges — dependents[i] = indices of steps that depend on i. */
  dependents: number[][];
  /** Unmet-dependency count per node (number of edges into it). */
  indegree: number[];
  /** True when the sanitized graph still contains a cycle (engine → serial fallback). */
  hasCycle: boolean;
}

/**
 * Build a sanitized dependency graph from raw planner edges. Invalid edges
 * (out-of-range indices, self-references, non-integers, duplicates) are dropped
 * defensively so a sloppy plan can never wedge the scheduler.
 */
export function buildDependencyGraph(rawDeps: number[][]): DependencyGraph {
  const size = rawDeps.length;
  const dependsOn: number[][] = [];

  for (let i = 0; i < size; i++) {
    const seen = new Set<number>();
    const clean: number[] = [];
    for (const d of rawDeps[i] ?? []) {
      if (!Number.isInteger(d)) continue; // garbage
      if (d < 0 || d >= size) continue; // out of range
      if (d === i) continue; // self-dependency
      if (seen.has(d)) continue; // duplicate
      seen.add(d);
      clean.push(d);
    }
    dependsOn.push(clean);
  }

  const dependents: number[][] = Array.from({ length: size }, () => []);
  const indegree = new Array<number>(size).fill(0);
  for (let i = 0; i < size; i++) {
    for (const d of dependsOn[i]) {
      dependents[d].push(i);
      indegree[i]++;
    }
  }

  return {
    size,
    dependsOn,
    dependents,
    indegree,
    hasCycle: detectCycle(size, dependents, indegree),
  };
}

/**
 * Cycle detection via Kahn's algorithm: repeatedly remove indegree-0 nodes; if
 * fewer than `size` nodes are processed, a cycle remains. Operates on a copy so
 * the caller's indegree array is untouched.
 */
function detectCycle(size: number, dependents: number[][], indegree: number[]): boolean {
  const deg = indegree.slice();
  const queue: number[] = [];
  for (let i = 0; i < size; i++) if (deg[i] === 0) queue.push(i);

  let processed = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    processed++;
    for (const m of dependents[node]) {
      deg[m]--;
      if (deg[m] === 0) queue.push(m);
    }
  }
  return processed < size;
}

/**
 * Linearize a graph into a strict chain (step i depends on i-1). Used as the
 * engine's serial fallback when the planner emits a cyclic graph — reproduces
 * the safe P1 behaviour (one step at a time, in idx order) without special-casing.
 */
export function linearChain(size: number): number[][] {
  const deps: number[][] = [];
  for (let i = 0; i < size; i++) deps.push(i === 0 ? [] : [i - 1]);
  return deps;
}

// ── DAG execution (bounded-concurrency scheduler) ───────────────

export type StepOutcome = 'pending' | 'passed' | 'failed' | 'skipped';

export interface RunDagOptions {
  graph: DependencyGraph;
  /** Max steps in flight at once (>= 1). */
  maxConcurrency: number;
  /** When true, the first failure stops launching new steps (in-flight finish). */
  haltOnFailure: boolean;
  /**
   * Execute one step; resolves with whether it passed. Should not reject — a
   * rejection is treated defensively as a failure. A step only starts once all
   * its dependencies have passed.
   */
  run: (idx: number) => Promise<boolean>;
  /** Notified when a step is skipped (a dependency failed/was skipped, or halted). */
  onSkip?: (idx: number) => void;
  /** Polled before launching each step; returning true halts further launches. */
  isAborted?: () => boolean;
}

export interface RunDagResult {
  /** Final outcome per node, indexed by idx. No node remains 'pending'. */
  outcome: StepOutcome[];
  passedCount: number;
}

/**
 * Run a dependency graph with bounded concurrency. Independent steps (no
 * dependency path between them) run in parallel up to `maxConcurrency`; a step
 * starts only after every dependency has passed. A failed/skipped step never
 * satisfies a dependency, so its dependents are skipped transitively. The
 * scheduler is pure orchestration — all side effects live in `run`/`onSkip`.
 */
export async function runDag(opts: RunDagOptions): Promise<RunDagResult> {
  const { graph, run } = opts;
  const n = graph.size;
  const maxConcurrency = Math.max(1, opts.maxConcurrency);
  const indegree = graph.indegree.slice();
  const outcome: StepOutcome[] = new Array(n).fill('pending');
  const started = new Array<boolean>(n).fill(false);
  const ready: number[] = [];
  for (let i = 0; i < n; i++) if (indegree[i] === 0) ready.push(i);
  ready.sort((a, b) => a - b);

  let passedCount = 0;
  let halted = false;
  let running = 0;

  const markSkipped = (idx: number): void => {
    if (outcome[idx] !== 'pending') return;
    outcome[idx] = 'skipped';
    opts.onSkip?.(idx);
  };

  /** Transitively skip every not-yet-started dependent of a failed/skipped step. */
  const skipDependents = (idx: number): void => {
    const stack = [...graph.dependents[idx]];
    while (stack.length > 0) {
      const d = stack.pop()!;
      if (started[d] || outcome[d] !== 'pending') continue;
      markSkipped(d);
      stack.push(...graph.dependents[d]);
    }
  };

  const handleResult = (idx: number, passed: boolean): void => {
    if (passed) {
      outcome[idx] = 'passed';
      passedCount++;
      for (const dep of graph.dependents[idx]) {
        if (indegree[dep] > 0) indegree[dep]--;
        if (indegree[dep] === 0 && outcome[dep] === 'pending') ready.push(dep);
      }
      ready.sort((a, b) => a - b);
    } else {
      outcome[idx] = 'failed';
      if (opts.haltOnFailure) halted = true; // stop launching; in-flight finish
      else skipDependents(idx);
    }
  };

  await new Promise<void>((resolve) => {
    const pump = (): void => {
      if (opts.isAborted?.()) halted = true;

      while (!halted && running < maxConcurrency && ready.length > 0) {
        const idx = ready.shift()!;
        if (outcome[idx] !== 'pending') continue; // already skipped
        started[idx] = true;
        running++;
        void run(idx)
          .then((passed) => handleResult(idx, passed))
          .catch(() => handleResult(idx, false)) // run shouldn't reject; be safe
          .finally(() => {
            running--;
            pump();
          });
      }

      if (running === 0 && (halted || ready.length === 0)) {
        // Anything still pending is blocked by a failed/skipped dep or was halted.
        for (let i = 0; i < n; i++) if (outcome[i] === 'pending') markSkipped(i);
        resolve();
      }
    };
    pump();
  });

  return { outcome, passedCount };
}
