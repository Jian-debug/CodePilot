/**
 * workflow/engine.ts — orchestrate a dynamic workflow (P3, parallel fan-out).
 *
 * Flow: plan → persist steps → schedule steps over their dependency DAG (model
 * ladder + verify per step, see step-runner) → merge. Emits workflow_* SSE
 * events (consumed by the P2 UI) plus human-readable `status` mirrors.
 *
 * P1 ran steps serially by idx. P3 runs independent steps (no dependency path
 * between them) concurrently, bounded by `maxConcurrency`, while always
 * respecting `dependsOn`. Parallel-safety comes from the graph itself — the
 * planner adds a dependency edge between steps that touch the same files, so
 * conflicting work is serialized; only truly independent work fans out. A
 * cyclic plan falls back to safe serial execution.
 */

import {
  createWorkflow,
  updateWorkflowStatus,
  createWorkflowStep,
  updateWorkflowStep,
  type CreateWorkflowStepInput,
} from '../db';
import { buildModelLadder, strongestRung, startRungForComplexity } from './model-ladder';
import { planWorkflow } from './planner';
import { runStep } from './step-runner';
import { buildDependencyGraph, linearChain, runDag, type DependencyGraph } from './scheduler';
import type { EmitSSE, LadderRung, PlannedStep, RunWorkflowOptions } from './types';
import type { WorkflowPlanEvent, WorkflowStepEvent, WorkflowStepRecord } from '@/types';

const MAX_PRIOR_CONTEXT_CHARS = 1500;
const DEFAULT_MAX_CONCURRENCY = 3;
const DEFAULT_TOP_RUNG_RETRIES = 1;

export async function runWorkflow(opts: RunWorkflowOptions): Promise<string> {
  const { goal, sessionId, emitSSE } = opts;

  const workflow = createWorkflow(sessionId, goal);
  updateWorkflowStatus(workflow.id, 'planning');
  mirror(emitSSE, `[workflow] Planning: ${goal.length > 80 ? goal.slice(0, 77) + '...' : goal}`);

  // Goal-level ladder → choose planner (balanced) and verifier (strongest) rungs.
  const goalLadder = buildModelLadder({
    providerId: opts.providerId,
    sessionProviderId: opts.sessionProviderId,
    sessionModel: opts.sessionModel,
  });
  if (goalLadder.length === 0) {
    updateWorkflowStatus(workflow.id, 'failed', { result: 'No usable model could be resolved.' });
    mirror(emitSSE, '[workflow] Aborted: no usable model resolved.');
    return 'Workflow aborted: no usable model could be resolved for this session.';
  }
  const plannerRung = pickPlannerRung(goalLadder);
  const verifierRung = strongestRung(goalLadder) ?? plannerRung;

  // ── Plan ──
  let planned: PlannedStep[];
  try {
    planned = await planWorkflow({
      goal,
      providerId: plannerRung.providerId,
      model: plannerRung.model,
      abortSignal: opts.abortSignal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateWorkflowStatus(workflow.id, 'failed', { result: `Planning failed: ${msg}` });
    mirror(emitSSE, `[workflow] Planning failed: ${msg}`);
    return `Workflow planning failed: ${msg}`;
  }

  // Persist steps.
  const steps = planned.map((p, idx) =>
    createWorkflowStep(workflow.id, toStepInput(p, idx)),
  );

  // Emit the plan (structured + mirror).
  const planEvent: WorkflowPlanEvent = {
    workflowId: workflow.id,
    goal,
    steps: steps.map((s, idx) => ({
      id: s.id,
      idx: s.idx,
      title: s.title,
      dependsOn: planned[idx].dependsOn,
      verifyStrategy: s.verify_strategy,
      complexity: planned[idx].complexity,
    })),
  };
  emitSSE({ type: 'workflow_plan', data: JSON.stringify(planEvent) });
  mirror(emitSSE, `[workflow] Planned ${steps.length} step(s).`);

  updateWorkflowStatus(workflow.id, 'running');

  // ── Schedule steps over the dependency DAG ──
  const { sections, passedCount, failed } = await runScheduled({
    steps,
    planned,
    goal,
    goalLadder,
    verifierRung,
    opts,
    workflowId: workflow.id,
    emitSSE,
  });

  // ── Merge ──
  const merged = buildMergedResult(goal, steps.length, passedCount, sections, failed);
  updateWorkflowStatus(workflow.id, failed ? 'failed' : 'completed', { result: merged });
  mirror(
    emitSSE,
    `[workflow] ${failed ? 'Finished with failures' : 'Completed'}: ${passedCount}/${steps.length} steps passed.`,
  );

  return merged;
}

// ── Scheduler (P3 parallel fan-out) ─────────────────────────────

interface RunScheduledArgs {
  steps: WorkflowStepRecord[];
  planned: PlannedStep[];
  goal: string;
  goalLadder: LadderRung[];
  verifierRung: LadderRung;
  opts: RunWorkflowOptions;
  workflowId: string;
  emitSSE: EmitSSE;
}

interface ScheduledResult {
  /** Per-step output sections in idx order, for the merged result. */
  sections: string[];
  passedCount: number;
  /** True if any step failed/was skipped or the run was aborted. */
  failed: boolean;
}

/**
 * Run steps concurrently over their dependency graph. A step becomes "ready"
 * once all its dependencies have passed; up to `maxConcurrency` ready steps run
 * at once. A failed/skipped step never satisfies a dependency, so its dependents
 * are marked skipped (transitively). With haltOnStepFailure (default), the first
 * failure stops launching new steps; in-flight steps are allowed to finish.
 */
async function runScheduled(args: RunScheduledArgs): Promise<ScheduledResult> {
  const { steps, planned, goal, goalLadder, verifierRung, opts, workflowId, emitSSE } = args;
  const n = steps.length;
  const haltOnFailure = opts.haltOnStepFailure !== false; // default true
  const maxConcurrency = Math.max(1, opts.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY);

  // Build the DAG; a cyclic plan falls back to a safe serial chain.
  let graph: DependencyGraph = buildDependencyGraph(planned.map((p) => p.dependsOn));
  if (graph.hasCycle) {
    mirror(emitSSE, '[workflow] Plan has a dependency cycle — running steps serially.');
    graph = buildDependencyGraph(linearChain(n));
  }
  mirror(
    emitSSE,
    maxConcurrency > 1
      ? `[workflow] Scheduling ${n} step(s), up to ${maxConcurrency} in parallel.`
      : `[workflow] Scheduling ${n} step(s) serially.`,
  );

  const outputs = new Map<number, string>();

  // Execute one step: pick its ladder, run it, capture output. Returns whether
  // it passed. Never rejects (the scheduler treats a rejection as a failure,
  // but we persist/emit a clean failed status here for observability).
  const run = async (idx: number): Promise<boolean> => {
    const step = steps[idx];
    const override = planned[idx].modelOverride;
    const baseLadder: LadderRung[] =
      override && override.length > 0
        ? buildModelLadder({
            providerId: opts.providerId,
            sessionProviderId: opts.sessionProviderId,
            sessionModel: opts.sessionModel,
            override,
          })
        : goalLadder;
    // Per-step complexity selects the starting rung: a hard step skips the
    // cheap rungs (and their near-certain-to-fail attempts); an easy step
    // starts cheap and escalates only if it fails verification. An explicit
    // model override is taken as-is (the planner chose those models on purpose).
    const ladder =
      override && override.length > 0
        ? baseLadder
        : startRungForComplexity(baseLadder, planned[idx].complexity);

    try {
      const result = await runStep({
        workflowId,
        step,
        goal,
        ladder,
        verifierRung,
        workingDirectory: opts.workingDirectory,
        permissionMode: opts.permissionMode,
        sessionId: opts.sessionId,
        providerId: opts.providerId,
        sessionProviderId: opts.sessionProviderId,
        emitSSE,
        abortSignal: opts.abortSignal,
        maxAttempts: opts.maxAttemptsPerStep ?? ladder.length + (opts.topRungRetries ?? DEFAULT_TOP_RUNG_RETRIES),
        priorContext: buildDependencyContext(graph.dependsOn[idx], steps, outputs),
      });
      outputs.set(idx, result.output);
      return result.passed;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      outputs.set(idx, `(step crashed: ${msg})`);
      updateWorkflowStep(step.id, { status: 'failed', result: msg });
      emitStepStatus(emitSSE, workflowId, step, 'failed');
      return false;
    }
  };

  const { outcome, passedCount } = await runDag({
    graph,
    maxConcurrency,
    haltOnFailure,
    run,
    isAborted: () => Boolean(opts.abortSignal?.aborted),
    onSkip: (idx) => {
      updateWorkflowStep(steps[idx].id, { status: 'skipped' });
      emitStepStatus(emitSSE, workflowId, steps[idx], 'skipped');
    },
  });

  // Sections in idx order (stable), regardless of completion order.
  const sections: string[] = steps.map((step, i) => {
    if (outcome[i] === 'skipped') {
      return `### Step ${i + 1}: ${step.title}\n(skipped — a dependency did not pass)`;
    }
    return `### Step ${i + 1}: ${step.title}\n${outputs.get(i) ?? '(no output)'}`;
  });

  const failed = passedCount < n || Boolean(opts.abortSignal?.aborted);
  return { sections, passedCount, failed };
}

// ── Helpers ─────────────────────────────────────────────────────

function toStepInput(p: PlannedStep, idx: number): CreateWorkflowStepInput {
  return {
    idx,
    title: p.title,
    instructions: p.instructions,
    acceptanceCriteria: p.acceptanceCriteria,
    dependsOn: p.dependsOn,
    verifyStrategy: p.verifyStrategy,
    verifyCommand: p.verifyCommand,
    complexity: p.complexity,
  };
}

/** Prefer a balanced (default/sonnet) rung for planning; fall back to the last. */
function pickPlannerRung(ladder: LadderRung[]): LadderRung {
  const balanced = ladder.find((r) => r.role === 'default' || r.role === 'sonnet' || r.role === 'session');
  return balanced ?? ladder[ladder.length - 1] ?? ladder[0];
}

function buildDependencyContext(
  deps: number[],
  steps: WorkflowStepRecord[],
  outputs: Map<number, string>,
): string {
  if (deps.length === 0) return '';
  const parts: string[] = [];
  for (const d of [...deps].sort((a, b) => a - b)) {
    const out = outputs.get(d);
    if (out) parts.push(`### ${steps[d]?.title ?? `Step ${d + 1}`}\n${out}`);
  }
  if (parts.length === 0) return '';
  const joined = parts.join('\n\n');
  if (joined.length <= MAX_PRIOR_CONTEXT_CHARS) return joined;
  // Keep the tail (most relevant for continuity) when over budget.
  return '…[earlier dependency output truncated]\n' + joined.slice(joined.length - MAX_PRIOR_CONTEXT_CHARS);
}

function emitStepStatus(
  emitSSE: EmitSSE,
  workflowId: string,
  step: WorkflowStepRecord,
  status: WorkflowStepEvent['status'],
): void {
  const payload: WorkflowStepEvent = {
    workflowId,
    stepId: step.id,
    idx: step.idx,
    title: step.title,
    status,
  };
  emitSSE({ type: 'workflow_step', data: JSON.stringify(payload) });
}

function buildMergedResult(
  goal: string,
  total: number,
  passed: number,
  sections: string[],
  failed: boolean,
): string {
  const header = failed
    ? `Workflow finished with failures — ${passed}/${total} steps passed.`
    : `Workflow completed — all ${total} steps passed.`;
  return `${header}\n\nGoal: ${goal}\n\n${sections.join('\n\n')}`;
}

function mirror(emitSSE: EmitSSE, message: string): void {
  emitSSE({ type: 'status', data: JSON.stringify({ subtype: 'workflow_progress', message }) });
}
