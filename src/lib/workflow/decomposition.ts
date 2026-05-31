/**
 * workflow/decomposition.ts — bounded recursive decomposition (pure decision layer).
 *
 * When a hard step can't be done directly (it failed even after the strongest
 * model retried with feedback), the engine can break that one step into a
 * *sub-workflow* — "if the best model can't do it in one go, decompose it
 * further." To stay safe this is tightly gated:
 *   - only HIGH-complexity steps (the planner's own difficulty signal),
 *   - only on FAILURE (never speculatively — recursion costs a whole workflow),
 *   - only while under the depth cap (default 1 level; depth >= maxDepth can't recurse).
 *
 * This module is pure (no DB/LLM/SSE) so the gate is unit-testable; the engine
 * owns the actual recursive call.
 */

import type { WorkflowStepComplexity } from '@/types';

/** Default maximum recursion depth: the top-level run is depth 0, so 1 means a
 *  hard step may spawn one level of sub-workflow, whose steps cannot recurse. */
export const DEFAULT_MAX_DEPTH = 1;

export interface DecomposeDecisionInput {
  /** Did the step pass after exhausting its model ladder + retries? */
  passed: boolean;
  /** Planner-assessed difficulty of the step. */
  complexity: WorkflowStepComplexity;
  /** Recursion depth of the CURRENT workflow (top-level = 0). */
  depth: number;
  /** Maximum allowed depth (0 disables recursion entirely). */
  maxDepth: number;
}

/**
 * Decide whether a failed step should be retried as a sub-workflow. True only
 * for an unfinished, high-complexity step that is still under the depth cap.
 */
export function shouldDecomposeStep(input: DecomposeDecisionInput): boolean {
  if (input.passed) return false;
  if (input.complexity !== 'high') return false;
  if (input.maxDepth <= 0) return false;
  return input.depth < input.maxDepth;
}

/**
 * Build the sub-workflow goal for a step. Carries the step's own instructions
 * AND its acceptance criteria so the sub-planner decomposes toward satisfying
 * the *parent* step, not some looser interpretation.
 */
export function buildSubGoal(
  title: string,
  instructions: string,
  acceptanceCriteria: string,
): string {
  const criteria = acceptanceCriteria.trim()
    ? `\n\nThis is one step of a larger workflow that proved too complex to do directly. ` +
      `Break it down and complete it. It is only done when this is satisfied:\n${acceptanceCriteria.trim()}`
    : '';
  return `${title}\n\n${instructions}${criteria}`;
}
