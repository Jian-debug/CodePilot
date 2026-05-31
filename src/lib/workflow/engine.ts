/**
 * workflow/engine.ts — orchestrate a dynamic workflow (P1, serial).
 *
 * Flow: plan → persist steps → run each step serially (model ladder + verify,
 * see step-runner) → merge. Emits workflow_* SSE events (consumed by the P2 UI)
 * plus human-readable `status` mirrors so progress is visible in the current UI.
 *
 * v1 is intentionally serial: best observability, no file-conflict risk. Parallel
 * fan-out + Hermes-style parallel-safety land in P3.
 */

import {
  createWorkflow,
  updateWorkflowStatus,
  createWorkflowStep,
  type CreateWorkflowStepInput,
} from '../db';
import { buildModelLadder, strongestRung } from './model-ladder';
import { planWorkflow } from './planner';
import { runStep } from './step-runner';
import type { EmitSSE, LadderRung, PlannedStep, RunWorkflowOptions } from './types';
import type { WorkflowPlanEvent } from '@/types';

const MAX_PRIOR_CONTEXT_CHARS = 1500;

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
    })),
  };
  emitSSE({ type: 'workflow_plan', data: JSON.stringify(planEvent) });
  mirror(emitSSE, `[workflow] Planned ${steps.length} step(s).`);

  updateWorkflowStatus(workflow.id, 'running');

  // ── Run steps serially ──
  const sections: string[] = [];
  let passedCount = 0;
  let failed = false;
  const haltOnFailure = opts.haltOnStepFailure !== false; // default true

  for (let i = 0; i < steps.length; i++) {
    if (opts.abortSignal?.aborted) {
      failed = true;
      break;
    }
    const step = steps[i];
    const override = planned[i].modelOverride;
    const ladder: LadderRung[] =
      override && override.length > 0
        ? buildModelLadder({
            providerId: opts.providerId,
            sessionProviderId: opts.sessionProviderId,
            sessionModel: opts.sessionModel,
            override,
          })
        : goalLadder;

    const result = await runStep({
      workflowId: workflow.id,
      step,
      goal,
      ladder,
      verifierRung,
      workingDirectory: opts.workingDirectory,
      permissionMode: opts.permissionMode,
      sessionId,
      providerId: opts.providerId,
      sessionProviderId: opts.sessionProviderId,
      emitSSE,
      abortSignal: opts.abortSignal,
      maxAttempts: opts.maxAttemptsPerStep ?? ladder.length,
      priorContext: buildPriorContext(sections),
    });

    sections.push(`### Step ${i + 1}: ${step.title}\n${result.output}`);
    if (result.passed) passedCount++;
    else {
      failed = true;
      if (haltOnFailure) break;
    }
  }

  // ── Merge ──
  const merged = buildMergedResult(goal, steps.length, passedCount, sections, failed);
  updateWorkflowStatus(workflow.id, failed ? 'failed' : 'completed', { result: merged });
  mirror(
    emitSSE,
    `[workflow] ${failed ? 'Finished with failures' : 'Completed'}: ${passedCount}/${steps.length} steps passed.`,
  );

  return merged;
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
  };
}

/** Prefer a balanced (default/sonnet) rung for planning; fall back to the last. */
function pickPlannerRung(ladder: LadderRung[]): LadderRung {
  const balanced = ladder.find((r) => r.role === 'default' || r.role === 'sonnet' || r.role === 'session');
  return balanced ?? ladder[ladder.length - 1] ?? ladder[0];
}

function buildPriorContext(sections: string[]): string {
  if (sections.length === 0) return '';
  const joined = sections.join('\n\n');
  if (joined.length <= MAX_PRIOR_CONTEXT_CHARS) return joined;
  // Keep the tail (most recent steps) which is most relevant for continuity.
  return '…[earlier steps truncated]\n' + joined.slice(joined.length - MAX_PRIOR_CONTEXT_CHARS);
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
