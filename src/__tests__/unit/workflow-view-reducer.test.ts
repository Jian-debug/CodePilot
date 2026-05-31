import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyWorkflowPlan,
  applyWorkflowStep,
  applyWorkflowAttempt,
  applyWorkflowVerify,
  deriveWorkflowStatus,
  buildWorkflowViewFromRecords,
} from '../../lib/workflow-view-reducer';
import type {
  WorkflowPlanEvent,
  WorkflowStepRecord,
  WorkflowStepAttemptRecord,
  WorkflowRecord,
  WorkflowViewState,
} from '../../types';

const WF = 'wf1';

function seedPlan(): WorkflowPlanEvent {
  return {
    workflowId: WF,
    goal: 'Migrate the app',
    steps: [
      { id: 's0', idx: 0, title: 'Step A', dependsOn: [], verifyStrategy: 'llm', complexity: 'high' },
      { id: 's1', idx: 1, title: 'Step B', dependsOn: [], verifyStrategy: 'llm', complexity: 'low' },
      { id: 's2', idx: 2, title: 'Step C', dependsOn: [0, 1], verifyStrategy: 'both', complexity: 'medium' },
    ],
  };
}

describe('workflow-view-reducer — deriveWorkflowStatus', () => {
  it('derives planning / running / completed / failed', () => {
    assert.equal(deriveWorkflowStatus([]), 'planning');
    assert.equal(
      deriveWorkflowStatus([{ status: 'running' } as never, { status: 'pending' } as never]),
      'running',
    );
    assert.equal(
      deriveWorkflowStatus([{ status: 'passed' } as never, { status: 'skipped' } as never]),
      'completed',
    );
    assert.equal(
      deriveWorkflowStatus([{ status: 'passed' } as never, { status: 'failed' } as never]),
      'failed',
    );
  });
});

describe('workflow-view-reducer — live SSE folding', () => {
  it('seeds steps (sorted, pending) from the plan', () => {
    const wf = applyWorkflowPlan(null, seedPlan());
    assert.equal(wf.goal, 'Migrate the app');
    assert.equal(wf.steps.length, 3);
    assert.deepEqual(wf.steps.map((s) => s.idx), [0, 1, 2]);
    assert.ok(wf.steps.every((s) => s.status === 'pending'));
    assert.deepEqual(wf.steps[2].dependsOn, [0, 1]);
    assert.deepEqual(wf.steps.map((s) => s.complexity), ['high', 'low', 'medium']);
  });

  it('folds attempt + verify, recording escalation and verdict', () => {
    let wf: WorkflowViewState | null = applyWorkflowPlan(null, seedPlan());
    wf = applyWorkflowStep(wf, { workflowId: WF, stepId: 's0', idx: 0, title: 'Step A', status: 'running' });
    wf = applyWorkflowAttempt(wf, { workflowId: WF, stepId: 's0', attemptId: 'a1', attemptNo: 1, providerId: '', model: 'haiku', role: 'small', status: 'running' });
    wf = applyWorkflowVerify(wf, { workflowId: WF, stepId: 's0', attemptId: 'a1', attemptNo: 1, passed: false, via: 'llm', feedback: 'needs work' });
    wf = applyWorkflowAttempt(wf, { workflowId: WF, stepId: 's0', attemptId: 'a2', attemptNo: 2, providerId: '', model: 'opus', role: 'opus', status: 'running' });
    wf = applyWorkflowVerify(wf, { workflowId: WF, stepId: 's0', attemptId: 'a2', attemptNo: 2, passed: true, via: 'both', feedback: 'good', score: 95 });
    wf = applyWorkflowStep(wf, { workflowId: WF, stepId: 's0', idx: 0, title: 'Step A', status: 'passed' });

    const stepA = wf!.steps[0];
    assert.equal(stepA.status, 'passed');
    assert.equal(stepA.attempts.length, 2, 'escalation: two attempts');
    assert.equal(stepA.attempts[0].passed, false);
    assert.equal(stepA.attempts[0].feedback, 'needs work');
    assert.equal(stepA.attempts[1].passed, true);
    assert.equal(stepA.attempts[1].model, 'opus');
    assert.equal(stepA.attempts[1].score, 95);
    assert.equal(stepA.attempts[1].via, 'both');
  });

  it('derives failed when a step fails', () => {
    let wf: WorkflowViewState | null = applyWorkflowPlan(null, seedPlan());
    wf = applyWorkflowStep(wf, { workflowId: WF, stepId: 's2', idx: 2, title: 'Step C', status: 'failed' });
    assert.equal(wf!.status, 'failed');
  });

  it('ignores events for a different workflow id', () => {
    const wf = applyWorkflowPlan(null, seedPlan());
    const after = applyWorkflowStep(wf, { workflowId: 'other', stepId: 's0', idx: 0, title: 'Step A', status: 'passed' });
    assert.equal(after, wf, 'returns the same state untouched');
  });
});

describe('workflow-view-reducer — DB reload path', () => {
  it('reconstructs the same shape from persisted records', () => {
    const workflow = {
      id: WF, session_id: 'sess1', goal: 'Migrate the app', status: 'failed',
      created_at: '2026-05-31 10:00:00',
    } as unknown as WorkflowRecord;
    const steps = [
      { id: 's0', idx: 0, title: 'Step A', depends_on: '[]', verify_strategy: 'llm', complexity: 'high', status: 'passed' },
      { id: 's1', idx: 1, title: 'Step B', depends_on: '[]', verify_strategy: 'llm', complexity: 'low', status: 'passed' },
      { id: 's2', idx: 2, title: 'Step C', depends_on: '[0,1]', verify_strategy: 'both', complexity: 'medium', status: 'failed' },
      { id: 's3', idx: 3, title: 'Step D', depends_on: '[2]', verify_strategy: 'llm', complexity: 'low', status: 'skipped' },
    ] as unknown as WorkflowStepRecord[];
    const attemptsByStep: Record<string, WorkflowStepAttemptRecord[]> = {
      s0: [
        { id: 'a1', attempt_no: 1, provider_id: '', model: 'haiku', role: 'small', status: 'failed', verdict: 'failed', feedback: 'x' },
        { id: 'a2', attempt_no: 2, provider_id: '', model: 'opus', role: 'opus', status: 'passed', verdict: 'passed', feedback: 'ok' },
      ] as unknown as WorkflowStepAttemptRecord[],
      s1: [{ id: 'b1', attempt_no: 1, provider_id: '', model: 'haiku', role: 'small', status: 'passed', verdict: 'passed', feedback: '' }] as unknown as WorkflowStepAttemptRecord[],
      s2: [{ id: 'c1', attempt_no: 1, provider_id: '', model: 'opus', role: 'opus', status: 'failed', verdict: 'failed', feedback: 'tests fail' }] as unknown as WorkflowStepAttemptRecord[],
      s3: [],
    };

    const wf = buildWorkflowViewFromRecords(workflow, steps, attemptsByStep);
    assert.equal(wf.workflowId, WF);
    assert.equal(wf.status, 'failed');
    assert.deepEqual(wf.steps.map((s) => s.idx), [0, 1, 2, 3]);
    assert.equal(wf.steps[0].attempts.length, 2);
    assert.equal(wf.steps[0].attempts[1].passed, true);
    assert.deepEqual(wf.steps[2].dependsOn, [0, 1]);
    assert.equal(wf.steps[3].status, 'skipped');
    assert.equal(wf.steps[0].complexity, 'high');
    assert.ok(Number.isFinite(wf.startedAt));
  });
});
