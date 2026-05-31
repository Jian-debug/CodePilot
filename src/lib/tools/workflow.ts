/**
 * tools/workflow.ts — Workflow tool: run an observable dynamic workflow.
 *
 * Mirrors the Agent tool pattern. The primary agent calls Workflow({ goal })
 * for large/multi-step tasks; the engine decomposes the goal into steps, runs
 * each on a model ladder with verification (escalating to stronger models on
 * failure), streams workflow_* progress to the parent SSE stream, and returns
 * the merged result text.
 *
 * Auto-triggering (P4): the model still reaches workflows by calling this tool,
 * but the agent loop now appends a system-prompt suggestion to use it when a
 * turn looks like a large, multi-step task and `workflow_auto_suggest` is on
 * (see workflow/auto-trigger.ts). Fully automatic execution is still deferred.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { runWorkflow } from '../workflow/engine';
import { getSetting } from '../db';

/** Parse the workflow_max_concurrency setting → clamped 1..8, default 3. */
function resolveMaxConcurrency(): number {
  const raw = getSetting('workflow_max_concurrency');
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return 3;
  return Math.min(8, Math.max(1, n));
}

/** Parse the workflow_step_retries setting → clamped 0..3, default 1. */
function resolveTopRungRetries(): number {
  const raw = getSetting('workflow_step_retries');
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return 1;
  return Math.min(3, Math.max(0, n));
}

/** Parse the workflow_max_depth setting → clamped 0..2, default 1 (0 disables recursion). */
function resolveMaxDepth(): number {
  const raw = getSetting('workflow_max_depth');
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return 1;
  return Math.min(2, Math.max(0, n));
}

export function createWorkflowTool(ctx: {
  workingDirectory: string;
  providerId?: string;
  sessionProviderId?: string;
  parentModel?: string;
  permissionMode?: string;
  parentSessionId?: string;
  emitSSE?: (event: { type: string; data: string }) => void;
  abortSignal?: AbortSignal;
}) {
  return tool({
    description:
      'Run a dynamic workflow for a large, multi-step task. The workflow plans the work into ' +
      'verifiable steps, executes each step, verifies the result, and automatically retries with a ' +
      'stronger model if a step fails verification. Every step is streamed for observation. Use this ' +
      'for project-scale tasks (migrations, codebase-wide changes, multi-file features), NOT simple edits.',
    inputSchema: z.object({
      goal: z.string().describe('The overall goal to accomplish via the workflow.'),
    }),
    execute: async ({ goal }) => {
      const emitSSE = ctx.emitSSE ?? (() => {});
      if (!ctx.parentSessionId) {
        return 'Error: workflow requires a session context and cannot run here.';
      }
      try {
        return await runWorkflow({
          goal,
          sessionId: ctx.parentSessionId,
          workingDirectory: ctx.workingDirectory,
          providerId: ctx.providerId,
          sessionProviderId: ctx.sessionProviderId,
          sessionModel: ctx.parentModel,
          permissionMode: ctx.permissionMode,
          abortSignal: ctx.abortSignal,
          emitSSE,
          maxConcurrency: resolveMaxConcurrency(),
          topRungRetries: resolveTopRungRetries(),
          maxDepth: resolveMaxDepth(),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Workflow failed to run: ${msg}`;
      }
    },
  });
}
