/**
 * workflow-view-reducer.ts — fold dynamic-workflow events into a render-ready
 * WorkflowViewState (P2, client-side).
 *
 * Two entry points feed the WorkflowView panel:
 *   1. Live SSE — stream-session-manager calls applyWorkflow*() as the four
 *      workflow_* events arrive during a turn.
 *   2. Reload — buildWorkflowViewFromRecords() reconstructs the same shape from
 *      the persisted DB records when a session is re-opened.
 *
 * The reducer is pure (no React, no DB, no globals) so it's trivially testable
 * and shared by both paths. The engine emits no structured "workflow finished"
 * event, so the top-level status is *derived* from the steps — see
 * deriveWorkflowStatus.
 */

import type {
  WorkflowAttemptEvent,
  WorkflowPlanEvent,
  WorkflowStepEvent,
  WorkflowVerifyEvent,
  WorkflowViewAttempt,
  WorkflowViewState,
  WorkflowViewStep,
  WorkflowRecord,
  WorkflowStepRecord,
  WorkflowStepAttemptRecord,
  WorkflowAttemptStatus,
  WorkflowStepStatus,
} from '@/types';

/**
 * Derive the overall workflow status from its steps. Mirrors the engine's
 * default halt-on-failure behaviour:
 *   - any failed step → 'failed' (the engine stops; later steps stay pending)
 *   - every step passed → 'completed'
 *   - no steps yet → 'planning'
 *   - otherwise → 'running'
 */
export function deriveWorkflowStatus(
  steps: WorkflowViewStep[],
): WorkflowViewState['status'] {
  if (steps.length === 0) return 'planning';
  if (steps.some((s) => s.status === 'failed')) return 'failed';
  if (steps.every((s) => s.status === 'passed' || s.status === 'skipped')) return 'completed';
  return 'running';
}

/** `workflow_plan` — seed the state with the decomposed steps (all pending). */
export function applyWorkflowPlan(
  _prev: WorkflowViewState | null,
  event: WorkflowPlanEvent,
): WorkflowViewState {
  const steps: WorkflowViewStep[] = [...event.steps]
    .sort((a, b) => a.idx - b.idx)
    .map((s) => ({
      stepId: s.id,
      idx: s.idx,
      title: s.title,
      dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn : [],
      verifyStrategy: s.verifyStrategy,
      complexity: s.complexity ?? 'low',
      status: 'pending' as WorkflowStepStatus,
      attempts: [],
    }));

  return {
    workflowId: event.workflowId,
    goal: event.goal,
    status: deriveWorkflowStatus(steps),
    steps,
    startedAt: Date.now(),
  };
}

/** `workflow_step` — a step's lifecycle status changed. */
export function applyWorkflowStep(
  prev: WorkflowViewState | null,
  event: WorkflowStepEvent,
): WorkflowViewState | null {
  if (!prev || prev.workflowId !== event.workflowId) return prev;
  const steps = upsertStep(prev.steps, event);
  return { ...prev, steps, status: deriveWorkflowStatus(steps) };
}

/** `workflow_attempt` — a new attempt at a step started (or its status changed). */
export function applyWorkflowAttempt(
  prev: WorkflowViewState | null,
  event: WorkflowAttemptEvent,
): WorkflowViewState | null {
  if (!prev || prev.workflowId !== event.workflowId) return prev;
  const steps = prev.steps.map((step) => {
    if (step.stepId !== event.stepId) return step;
    const attempts = upsertAttempt(step.attempts, {
      attemptId: event.attemptId,
      attemptNo: event.attemptNo,
      providerId: event.providerId,
      model: event.model,
      role: event.role,
      status: event.status,
    });
    return { ...step, attempts };
  });
  return { ...prev, steps, status: deriveWorkflowStatus(steps) };
}

/** `workflow_verify` — verification verdict for a specific attempt. */
export function applyWorkflowVerify(
  prev: WorkflowViewState | null,
  event: WorkflowVerifyEvent,
): WorkflowViewState | null {
  if (!prev || prev.workflowId !== event.workflowId) return prev;
  const steps = prev.steps.map((step) => {
    if (step.stepId !== event.stepId) return step;
    const attempts = step.attempts.map((a) =>
      a.attemptId === event.attemptId
        ? {
            ...a,
            status: (event.passed ? 'passed' : 'failed') as WorkflowAttemptStatus,
            passed: event.passed,
            via: event.via,
            feedback: event.feedback,
            score: event.score,
          }
        : a,
    );
    return { ...step, attempts };
  });
  return { ...prev, steps, status: deriveWorkflowStatus(steps) };
}

// ── DB-record reconstruction (reload path) ──────────────────────

/**
 * Rebuild the WorkflowViewState from persisted records — used when a session is
 * re-opened and the live snapshot is gone. `attemptsByStep` maps a step id to
 * its attempts (ordered by attempt_no).
 */
export function buildWorkflowViewFromRecords(
  workflow: WorkflowRecord,
  stepRecords: WorkflowStepRecord[],
  attemptsByStep: Record<string, WorkflowStepAttemptRecord[]>,
): WorkflowViewState {
  const steps: WorkflowViewStep[] = [...stepRecords]
    .sort((a, b) => a.idx - b.idx)
    .map((s) => ({
      stepId: s.id,
      idx: s.idx,
      title: s.title,
      dependsOn: parseDependsOn(s.depends_on),
      verifyStrategy: s.verify_strategy,
      complexity: s.complexity ?? 'low',
      status: s.status,
      attempts: (attemptsByStep[s.id] ?? [])
        .slice()
        .sort((a, b) => a.attempt_no - b.attempt_no)
        .map(recordToAttempt),
    }));

  return {
    workflowId: workflow.id,
    goal: workflow.goal,
    // Prefer the persisted top-level status; fall back to derivation for the
    // transient pending/planning states that aren't terminal.
    status: mapRecordStatus(workflow.status, steps),
    steps,
    startedAt: Date.parse(workflow.created_at.replace(' ', 'T')) || Date.now(),
  };
}

// ── helpers ─────────────────────────────────────────────────────

function upsertStep(
  steps: WorkflowViewStep[],
  event: WorkflowStepEvent,
): WorkflowViewStep[] {
  const idx = steps.findIndex((s) => s.stepId === event.stepId);
  if (idx >= 0) {
    const next = steps.slice();
    next[idx] = { ...next[idx], title: event.title, status: event.status };
    return next;
  }
  // Defensive: a step event arrived before the plan listed it.
  const synthesized: WorkflowViewStep = {
    stepId: event.stepId,
    idx: event.idx,
    title: event.title,
    dependsOn: [],
    verifyStrategy: 'llm',
    complexity: 'low',
    status: event.status,
    attempts: [],
  };
  return [...steps, synthesized].sort((a, b) => a.idx - b.idx);
}

function upsertAttempt(
  attempts: WorkflowViewAttempt[],
  next: WorkflowViewAttempt,
): WorkflowViewAttempt[] {
  const idx = attempts.findIndex((a) => a.attemptId === next.attemptId);
  if (idx >= 0) {
    const copy = attempts.slice();
    // Preserve any verdict fields already set by a verify event.
    copy[idx] = { ...copy[idx], ...next };
    return copy;
  }
  return [...attempts, next].sort((a, b) => a.attemptNo - b.attemptNo);
}

function recordToAttempt(r: WorkflowStepAttemptRecord): WorkflowViewAttempt {
  const passed =
    r.verdict === 'passed' ? true : r.verdict === 'failed' ? false : undefined;
  return {
    attemptId: r.id,
    attemptNo: r.attempt_no,
    providerId: r.provider_id,
    model: r.model,
    role: r.role,
    status: r.status,
    ...(passed !== undefined ? { passed } : {}),
    ...(r.feedback ? { feedback: r.feedback } : {}),
  };
}

function parseDependsOn(raw: string): number[] {
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((n) => typeof n === 'number') : [];
  } catch {
    return [];
  }
}

function mapRecordStatus(
  status: WorkflowRecord['status'],
  steps: WorkflowViewStep[],
): WorkflowViewState['status'] {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'failed':
    case 'cancelled':
      return 'failed';
    case 'planning':
    case 'pending':
      return 'planning';
    case 'running':
    default:
      return deriveWorkflowStatus(steps);
  }
}
