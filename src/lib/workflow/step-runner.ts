/**
 * workflow/step-runner.ts — run one step across a model ladder with verification.
 *
 * This is the heart of the feature. For a single step it walks the model ladder
 * (cheap → strong). Each rung is one "attempt":
 *   1. persist the attempt (provider + model) so the UI can show which model ran,
 *   2. run a constrained agent loop (the worker) on that model, streaming its
 *      sub-events to the parent as tagged progress,
 *   3. verify the output (LLM judge and/or command),
 *   4. on pass → done; on fail → feed the verifier feedback into the next rung's
 *      retry prompt and escalate to a stronger model.
 *
 * If the whole ladder fails verification, the step is marked failed.
 */

import { runAgentLoop } from '../agent-loop';
import { assembleTools } from '../agent-tools';
import type { PermissionMode } from '../permission-checker';
import { verifyStep } from './verifier';
import {
  createWorkflowStepAttempt,
  updateWorkflowStepAttempt,
  updateWorkflowStep,
} from '../db';
import type { EmitSSE, LadderRung, StepRunResult } from './types';
import type {
  WorkflowStepRecord,
  WorkflowAttemptEvent,
  WorkflowVerifyEvent,
  WorkflowStepEvent,
} from '@/types';

/** Tools a step worker must never have — they would recurse into more workflows/subagents. */
const WORKER_EXCLUDED_TOOLS = ['Workflow', 'Agent'];

export interface RunStepOptions {
  workflowId: string;
  step: WorkflowStepRecord;
  goal: string;
  /** Per-step ladder (override already applied by the engine). */
  ladder: LadderRung[];
  /** Strongest rung — used as the LLM judge for verification. */
  verifierRung: LadderRung;
  workingDirectory: string;
  permissionMode?: string;
  /** Parent session id — worker inherits permission context. */
  sessionId: string;
  providerId?: string;
  sessionProviderId?: string;
  emitSSE: EmitSSE;
  abortSignal?: AbortSignal;
  maxAttempts: number;
  /** Concise summary of prior completed steps, for continuity. */
  priorContext?: string;
}

export async function runStep(opts: RunStepOptions): Promise<StepRunResult> {
  const { step, ladder, emitSSE } = opts;

  emitStepEvent(emitSSE, {
    workflowId: opts.workflowId,
    stepId: step.id,
    idx: step.idx,
    title: step.title,
    status: 'running',
  });
  updateWorkflowStep(step.id, { status: 'running' });

  const rungCount = Math.min(opts.maxAttempts, ladder.length) || ladder.length;
  let feedback = '';
  let lastOutput = '';

  for (let i = 0; i < rungCount; i++) {
    const rung = ladder[i];
    const attemptNo = i + 1;

    if (opts.abortSignal?.aborted) break;

    // Persist the attempt up-front so the UI shows "trying model X".
    const attempt = createWorkflowStepAttempt(step.id, {
      attemptNo,
      providerId: rung.providerId,
      model: rung.model,
      role: rung.role,
    });

    emitAttemptEvent(emitSSE, {
      workflowId: opts.workflowId,
      stepId: step.id,
      attemptId: attempt.id,
      attemptNo,
      providerId: rung.providerId,
      model: rung.model,
      role: rung.role,
      status: 'running',
    });
    mirror(emitSSE, `[workflow] Step ${step.idx + 1} "${step.title}" — attempt ${attemptNo} with ${rung.model} (${rung.role})`);

    // ── Worker ──
    let worker: { text: string; inputTokens: number; outputTokens: number };
    try {
      worker = await runWorker({
        stepTitle: step.title,
        instructions: buildWorkerPrompt(step.instructions, opts.priorContext, feedback),
        rung,
        workingDirectory: opts.workingDirectory,
        permissionMode: opts.permissionMode,
        sessionId: opts.sessionId,
        providerId: opts.providerId,
        sessionProviderId: opts.sessionProviderId,
        emitSSE,
        abortSignal: opts.abortSignal,
        stepIdx: step.idx,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateWorkflowStepAttempt(attempt.id, { status: 'error', feedback: msg, ended: true });
      emitVerifyEvent(emitSSE, {
        workflowId: opts.workflowId,
        stepId: step.id,
        attemptId: attempt.id,
        attemptNo,
        passed: false,
        via: 'none',
        feedback: `Worker error: ${msg}`,
      });
      feedback = `Previous attempt errored: ${msg}`;
      continue; // escalate to next rung
    }

    lastOutput = worker.text;

    // ── Verify ──
    const verdict = await verifyStep({
      goal: opts.goal,
      stepTitle: step.title,
      instructions: step.instructions,
      acceptanceCriteria: step.acceptance_criteria,
      output: worker.text,
      strategy: step.verify_strategy,
      command: step.verify_command,
      workingDirectory: opts.workingDirectory,
      providerId: opts.verifierRung.providerId,
      model: opts.verifierRung.model,
      abortSignal: opts.abortSignal,
    });

    emitVerifyEvent(emitSSE, {
      workflowId: opts.workflowId,
      stepId: step.id,
      attemptId: attempt.id,
      attemptNo,
      passed: verdict.passed,
      via: verdict.via,
      feedback: verdict.feedback,
      score: verdict.score,
    });
    mirror(
      emitSSE,
      `[workflow] Step ${step.idx + 1} verify (${verdict.via}): ${verdict.passed ? 'PASSED' : 'FAILED'}${verdict.score != null ? ` (score ${verdict.score})` : ''}`,
    );

    updateWorkflowStepAttempt(attempt.id, {
      status: verdict.passed ? 'passed' : 'failed',
      verdict: verdict.passed ? 'passed' : 'failed',
      feedback: verdict.feedback,
      output: worker.text,
      inputTokens: worker.inputTokens,
      outputTokens: worker.outputTokens,
      ended: true,
    });

    if (verdict.passed) {
      updateWorkflowStep(step.id, { status: 'passed', result: worker.text });
      emitStepEvent(emitSSE, {
        workflowId: opts.workflowId,
        stepId: step.id,
        idx: step.idx,
        title: step.title,
        status: 'passed',
      });
      return {
        stepId: step.id,
        passed: true,
        output: worker.text,
        acceptedModel: rung.model,
        attempts: attemptNo,
      };
    }

    // Failed verification → carry feedback into the next (stronger) rung.
    feedback = verdict.feedback || 'The previous attempt did not meet the acceptance criteria.';
  }

  // Ladder exhausted.
  updateWorkflowStep(step.id, { status: 'failed', result: lastOutput });
  emitStepEvent(emitSSE, {
    workflowId: opts.workflowId,
    stepId: step.id,
    idx: step.idx,
    title: step.title,
    status: 'failed',
  });
  return { stepId: step.id, passed: false, output: lastOutput, attempts: rungCount };
}

// ── Worker (constrained agent loop) ─────────────────────────────

interface RunWorkerOptions {
  stepTitle: string;
  instructions: string;
  rung: LadderRung;
  workingDirectory: string;
  permissionMode?: string;
  sessionId: string;
  providerId?: string;
  sessionProviderId?: string;
  emitSSE: EmitSSE;
  abortSignal?: AbortSignal;
  stepIdx: number;
}

async function runWorker(
  opts: RunWorkerOptions,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  // Build tools, forwarding permission requests to the parent stream, then strip
  // Workflow/Agent so a step worker can't recursively spawn more workflows.
  const permissionContext = {
    sessionId: opts.sessionId,
    permissionMode: (opts.permissionMode || 'acceptEdits') as PermissionMode,
    emitSSE: opts.emitSSE,
    abortSignal: opts.abortSignal,
  };
  const { tools: assembled } = assembleTools({
    workingDirectory: opts.workingDirectory,
    providerId: opts.providerId,
    sessionProviderId: opts.sessionProviderId,
    model: opts.rung.model,
    permissionContext,
  });
  const tools = { ...assembled };
  for (const name of WORKER_EXCLUDED_TOOLS) delete tools[name];

  const systemPrompt =
    `You are executing one step of a larger workflow. Focus only on this step.\n` +
    `Working directory: ${opts.workingDirectory}\n` +
    `When the step is complete, briefly summarize what you did and why it satisfies the step.`;

  const ac = new AbortController();
  if (opts.abortSignal) {
    if (opts.abortSignal.aborted) ac.abort();
    else opts.abortSignal.addEventListener('abort', () => ac.abort());
  }

  const stream = runAgentLoop({
    prompt: opts.instructions,
    sessionId: `wf-${opts.sessionId}-${opts.stepIdx}-${Date.now()}`,
    providerId: opts.providerId,
    sessionProviderId: opts.sessionProviderId,
    model: opts.rung.model,
    systemPrompt,
    workingDirectory: opts.workingDirectory,
    tools,
    maxSteps: 30,
    permissionMode: opts.permissionMode,
    abortController: ac,
  });

  const reader = stream.getReader();
  const textParts: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      for (const line of value.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        let event: { type?: string; data?: string };
        try {
          event = JSON.parse(line.slice(6));
        } catch {
          continue;
        }
        switch (event.type) {
          case 'text':
            if (event.data) textParts.push(event.data);
            break;
          case 'permission_request':
            // Forward so the client can approve the worker's tool calls.
            opts.emitSSE({ type: 'permission_request', data: event.data ?? '' });
            break;
          case 'tool_use':
            forwardToolUse(opts.emitSSE, opts.stepIdx, event.data);
            break;
          case 'tool_result':
            forwardToolResult(opts.emitSSE, event.data);
            break;
          case 'result':
            try {
              const r = JSON.parse(event.data ?? '{}');
              if (r.usage) {
                inputTokens += r.usage.input_tokens || 0;
                outputTokens += r.usage.output_tokens || 0;
              }
            } catch {
              /* ignore malformed result */
            }
            break;
          default:
            break;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return {
    text: textParts.join('') || '(worker produced no text output)',
    inputTokens,
    outputTokens,
  };
}

function buildWorkerPrompt(instructions: string, priorContext?: string, feedback?: string): string {
  let prompt = instructions;
  if (priorContext && priorContext.trim()) {
    prompt = `Context from earlier completed steps:\n${priorContext}\n\n---\n\nYour step:\n${instructions}`;
  }
  if (feedback && feedback.trim()) {
    prompt += `\n\n---\n\nA previous attempt with a weaker model failed verification. Address this feedback:\n${feedback}`;
  }
  return prompt;
}

// ── Progress forwarding (mirrors sub-agent's tool_output convention) ──

function forwardToolUse(emitSSE: EmitSSE, stepIdx: number, data?: string): void {
  try {
    const tool = JSON.parse(data ?? '{}');
    emitSSE({ type: 'tool_output', data: `  [step ${stepIdx + 1}] > ${summarizeTool(tool.name, tool.input)}` });
  } catch {
    /* skip malformed */
  }
}

function forwardToolResult(emitSSE: EmitSSE, data?: string): void {
  try {
    const res = JSON.parse(data ?? '{}');
    emitSSE({ type: 'tool_output', data: `  [${res.is_error ? 'x' : '+'}] done` });
  } catch {
    /* skip malformed */
  }
}

function summarizeTool(name: string, input: unknown): string {
  const inp = (input as Record<string, unknown>) || {};
  const lower = (name || '').toLowerCase();
  if (['bash', 'execute', 'run', 'shell'].includes(lower)) {
    const cmd = (inp.command || inp.cmd || '') as string;
    return cmd ? (cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd) : 'bash';
  }
  const filePath = (inp.file_path || inp.path || inp.filePath || '') as string;
  if (filePath) return `${name} ${filePath}`;
  return name || 'tool';
}

// ── SSE helpers (structured event + human-readable mirror) ──────

function emitStepEvent(emitSSE: EmitSSE, payload: WorkflowStepEvent): void {
  emitSSE({ type: 'workflow_step', data: JSON.stringify(payload) });
}

function emitAttemptEvent(emitSSE: EmitSSE, payload: WorkflowAttemptEvent): void {
  emitSSE({ type: 'workflow_attempt', data: JSON.stringify(payload) });
}

function emitVerifyEvent(emitSSE: EmitSSE, payload: WorkflowVerifyEvent): void {
  emitSSE({ type: 'workflow_verify', data: JSON.stringify(payload) });
}

/** Human-readable mirror via `status` so the current UI shows progress pre-P2. */
function mirror(emitSSE: EmitSSE, message: string): void {
  emitSSE({ type: 'status', data: JSON.stringify({ subtype: 'workflow_progress', message }) });
}
