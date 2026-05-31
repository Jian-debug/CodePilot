/**
 * workflow/types.ts — internal types for the dynamic workflow engine (P1).
 *
 * DB record types + SSE payload shapes live in @/types (alongside TaskItem /
 * MediaJob). This file holds engine-internal value types that never touch the
 * DB or the wire: model ladder rungs, planned steps, verification results, and
 * the runWorkflow options bag.
 */

import type { WorkflowVerifyStrategy, WorkflowStepComplexity } from '@/types';

/** SSE emit callback — same shape as ToolContext.emitSSE. */
export type EmitSSE = (event: { type: string; data: string }) => void;

/**
 * One rung of the per-step model ladder. The step runner walks these in order:
 * rung 0 is the cheapest/fastest model; the engine escalates to stronger rungs
 * only when verification fails ("model capability insufficient → switch up").
 */
export interface LadderRung {
  /** Provider ID to pass to createModel/runAgentLoop ('' = env/default). */
  providerId: string;
  /** Model ID (alias or upstream) to pass to runAgentLoop. */
  model: string;
  /** Capability role this rung represents (for telemetry + UI). */
  role: 'small' | 'default' | 'sonnet' | 'opus' | 'override' | 'session';
}

/** A step produced by the planner before persistence. */
export interface PlannedStep {
  title: string;
  instructions: string;
  /** Concrete, checkable acceptance criteria the verifier judges against. */
  acceptanceCriteria: string;
  /** idx values of earlier steps this step depends on (serial v1 ignores order beyond idx). */
  dependsOn: number[];
  verifyStrategy: WorkflowVerifyStrategy;
  /** Shell command for command/both verification (empty when not applicable). */
  verifyCommand: string;
  /** Planner-assessed difficulty; selects the starting rung on the model ladder. */
  complexity: WorkflowStepComplexity;
  /** Optional explicit model ladder override (model IDs) for this step. */
  modelOverride?: string[];
}

/** Result of verifying a single attempt's output. */
export interface VerifyResult {
  passed: boolean;
  /** Actionable feedback fed into the next attempt's retry prompt. */
  feedback: string;
  /** Which method produced this verdict. */
  via: WorkflowVerifyStrategy;
  /** Optional 0-100 quality score from the LLM judge. */
  score?: number;
}

/** Outcome of running one step (across all attempts in the ladder). */
export interface StepRunResult {
  stepId: string;
  passed: boolean;
  /** The output text of the passing (or last) attempt. */
  output: string;
  /** Model that produced the accepted output, if passed. */
  acceptedModel?: string;
  /** Number of attempts made. */
  attempts: number;
}

/** Options for runWorkflow(). */
export interface RunWorkflowOptions {
  goal: string;
  sessionId: string;
  workingDirectory: string;
  providerId?: string;
  sessionProviderId?: string;
  sessionModel?: string;
  permissionMode?: string;
  abortSignal?: AbortSignal;
  emitSSE: EmitSSE;
  /** Max attempts (ladder rungs) per step. Defaults to the ladder length. */
  maxAttemptsPerStep?: number;
  /** Whether a failed step halts the whole workflow (default true). */
  haltOnStepFailure?: boolean;
  /**
   * Max steps to run concurrently (P3 parallel fan-out). Defaults to 3. Set to
   * 1 to force serial execution. Independent steps (no dependency path between
   * them) run in parallel up to this cap; dependencies are always respected.
   */
  maxConcurrency?: number;
}
