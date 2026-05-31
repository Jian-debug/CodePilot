/**
 * workflow/planner.ts — decompose a goal into structured, verifiable steps.
 *
 * Uses the native auxiliary LLM call (generateTextFromProvider → createModel +
 * streamText) to produce a JSON step list. Parsing is defensive: code fences
 * are stripped, and any failure falls back to a single step wrapping the whole
 * goal so the workflow always runs (never silently no-ops).
 */

import { generateTextFromProvider } from '../text-generator';
import type { PlannedStep } from './types';
import type { WorkflowVerifyStrategy, WorkflowStepComplexity } from '@/types';

/** Defensive upper bound on plan size (the prompt asks for 2-6 steps). */
const MAX_STEPS = 24;

const PLANNER_SYSTEM = `You are a planning module for an autonomous coding workflow.
Decompose the user's goal into an ordered list of concrete, independently-verifiable steps.

Rules:
- Prefer 2-6 steps. Only emit 1 step if the goal is genuinely atomic.
- Each step must be doable by a coding agent with file/shell access.
- "acceptanceCriteria" must be objective and checkable (what proves this step is done correctly).
- "dependsOn" lists the 0-based indices of earlier steps that must finish first.
- "verifyStrategy": "llm" (judge output against criteria — default), "command" (run a shell
  command and check exit code), "both", or "none". Use "command"/"both" only when there is a
  concrete test/build/lint command worth running; put it in "verifyCommand".
- "complexity": "low" | "medium" | "high" — your honest estimate of how hard the step is.
  "low" = trivial/mechanical (rename, add a field, simple wiring); "medium" = standard feature
  work; "high" = tricky, cross-cutting, algorithmic, or ambiguous. This selects which model the
  step starts on (low starts on a cheap fast model, high starts on the strongest), so be accurate.

Parallelism & safety (IMPORTANT):
- Steps with NO dependency relationship may run AT THE SAME TIME (in parallel).
- Therefore "dependsOn" is also a safety mechanism: if two steps would read or write the SAME
  files (or otherwise conflict), you MUST add a dependsOn edge so they run in order — never leave
  a write/write or write/read conflict between two steps that lack a dependency between them.
- Keep genuinely independent steps independent (empty or disjoint dependsOn) so they can fan out.
- Do not create dependency cycles.

Respond with ONLY a JSON array, no prose, no code fences. Schema per element:
{ "title": string, "instructions": string, "acceptanceCriteria": string,
  "dependsOn": number[], "verifyStrategy": "llm"|"command"|"both"|"none", "verifyCommand": string,
  "complexity": "low"|"medium"|"high" }`;

export interface PlanWorkflowOptions {
  goal: string;
  providerId: string;
  model: string;
  abortSignal?: AbortSignal;
}

export async function planWorkflow(opts: PlanWorkflowOptions): Promise<PlannedStep[]> {
  const prompt = `Goal:\n${opts.goal}\n\nProduce the JSON step array now.`;

  let raw = '';
  try {
    raw = await generateTextFromProvider({
      providerId: opts.providerId,
      model: opts.model,
      system: PLANNER_SYSTEM,
      prompt,
      maxTokens: 2048,
      abortSignal: opts.abortSignal,
    });
  } catch (err) {
    console.warn('[workflow/planner] generation failed, falling back to single step:', err);
    return [singleStepFallback(opts.goal)];
  }

  const parsed = parseSteps(raw);
  if (!parsed || parsed.length === 0) {
    console.warn('[workflow/planner] could not parse a step array, falling back to single step');
    return [singleStepFallback(opts.goal)];
  }
  // Defensive cap: a pathological plan with dozens of steps would spawn an
  // unbounded number of (expensive) agent runs. The prompt asks for 2-6 steps;
  // anything past MAX_STEPS is almost certainly degenerate, so truncate. Any
  // dependsOn edges pointing beyond the cap are dropped later by the scheduler.
  if (parsed.length > MAX_STEPS) {
    console.warn(`[workflow/planner] plan had ${parsed.length} steps; truncating to ${MAX_STEPS}`);
    return parsed.slice(0, MAX_STEPS);
  }
  return parsed;
}

function singleStepFallback(goal: string): PlannedStep {
  return {
    title: 'Complete the task',
    instructions: goal,
    acceptanceCriteria: 'The task described in the goal is fully and correctly completed.',
    dependsOn: [],
    verifyStrategy: 'llm',
    verifyCommand: '',
    complexity: 'medium',
  };
}

/** Strip code fences and parse the first JSON array found. */
function parseSteps(raw: string): PlannedStep[] | null {
  let text = raw.trim();
  // Strip ```json ... ``` or ``` ... ``` fences.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  // Find the outermost JSON array.
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  const jsonSlice = text.slice(start, end + 1);

  let arr: unknown;
  try {
    arr = JSON.parse(jsonSlice);
  } catch {
    return null;
  }
  if (!Array.isArray(arr)) return null;

  const steps: PlannedStep[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const title = typeof o.title === 'string' ? o.title.trim() : '';
    const instructions = typeof o.instructions === 'string' ? o.instructions.trim() : '';
    if (!instructions) continue; // a step with no instructions is useless
    steps.push({
      title: title || instructions.slice(0, 60),
      instructions,
      acceptanceCriteria:
        typeof o.acceptanceCriteria === 'string' && o.acceptanceCriteria.trim()
          ? o.acceptanceCriteria.trim()
          : 'The step is completed correctly and consistently with the overall goal.',
      dependsOn: normalizeDependsOn(o.dependsOn),
      verifyStrategy: normalizeStrategy(o.verifyStrategy),
      verifyCommand: typeof o.verifyCommand === 'string' ? o.verifyCommand.trim() : '',
      complexity: normalizeComplexity(o.complexity),
    });
  }
  return steps.length > 0 ? steps : null;
}

function normalizeDependsOn(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0);
}

function normalizeStrategy(value: unknown): WorkflowVerifyStrategy {
  if (value === 'command' || value === 'both' || value === 'none' || value === 'llm') return value;
  return 'llm';
}

function normalizeComplexity(value: unknown): WorkflowStepComplexity {
  if (value === 'medium' || value === 'high' || value === 'low') return value;
  return 'low';
}
