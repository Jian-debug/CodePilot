/**
 * workflow/verifier.ts — decide whether a step's output is acceptable.
 *
 * Two mechanisms (set per step by the planner):
 *   - 'llm'  (default): an LLM judge scores the worker output against the
 *     step's acceptance criteria and returns pass/fail + actionable feedback.
 *   - 'command': run a shell command (test/build/lint) and check the exit code.
 *   - 'both': command must pass first, then the LLM judge.
 *   - 'none': always pass (use for trivially-correct or unverifiable steps).
 *
 * Failure policy:
 *   - An explicit negative verdict (judge says "fail" / command exits non-zero)
 *     fails the attempt → the engine escalates to a stronger model.
 *   - A verifier *infrastructure* failure (judge call throws, JSON unparseable)
 *     fails OPEN with a warning — verifier plumbing problems must not punish an
 *     otherwise-fine worker by burning the whole model ladder.
 */

import { exec } from 'child_process';
import { generateTextFromProvider } from '../text-generator';
import type { VerifyResult } from './types';
import type { WorkflowVerifyStrategy } from '@/types';

const COMMAND_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 4000;

export interface VerifyStepOptions {
  goal: string;
  stepTitle: string;
  instructions: string;
  acceptanceCriteria: string;
  /** The worker attempt's output text. */
  output: string;
  strategy: WorkflowVerifyStrategy;
  /** Shell command for command/both strategies. */
  command?: string;
  workingDirectory: string;
  /** Verifier model (engine passes the strongest available rung). */
  providerId: string;
  model: string;
  abortSignal?: AbortSignal;
}

export async function verifyStep(opts: VerifyStepOptions): Promise<VerifyResult> {
  if (opts.strategy === 'none') {
    return { passed: true, feedback: '', via: 'none' };
  }

  // Command gate (for 'command' and 'both').
  if (opts.strategy === 'command' || opts.strategy === 'both') {
    const cmd = (opts.command || '').trim();
    if (cmd) {
      const cmdResult = await runCommandVerify(cmd, opts.workingDirectory, opts.abortSignal);
      if (opts.strategy === 'command') return cmdResult;
      // 'both': if the command failed, stop here — no point asking the judge.
      if (!cmdResult.passed) return cmdResult;
    } else if (opts.strategy === 'command') {
      // command strategy but no command — nothing objective to check, pass open.
      return { passed: true, feedback: 'No verify command provided; skipped.', via: 'command' };
    }
  }

  // LLM judge (default and the second gate of 'both').
  return runLlmVerify(opts);
}

// ── Command verification ────────────────────────────────────────

function runCommandVerify(
  command: string,
  cwd: string,
  abortSignal?: AbortSignal,
): Promise<VerifyResult> {
  return new Promise((resolve) => {
    const child = exec(
      command,
      { cwd, timeout: COMMAND_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const combined = truncate(`${stdout || ''}${stderr ? `\n${stderr}` : ''}`.trim());
        if (!error) {
          resolve({
            passed: true,
            feedback: combined ? `Command passed.\n${combined}` : 'Command passed (exit 0).',
            via: 'command',
          });
        } else {
          const code = typeof (error as { code?: number }).code === 'number'
            ? (error as { code?: number }).code
            : 'non-zero';
          resolve({
            passed: false,
            feedback: `Command failed (exit ${code}). Fix the issues below and retry:\n${combined || error.message}`,
            via: 'command',
          });
        }
      },
    );
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => {
        try { child.kill(); } catch { /* already exited */ }
      });
    }
  });
}

// ── LLM judge ───────────────────────────────────────────────────

const JUDGE_SYSTEM = `You are a strict but fair verification module for an autonomous coding workflow.
Given a step's instructions, its acceptance criteria, and the worker's output, decide whether the
step was completed correctly.

Respond with ONLY a JSON object, no prose, no code fences:
{ "passed": boolean, "score": number (0-100), "feedback": string }

- "passed": true only if the acceptance criteria are genuinely met.
- "feedback": if not passed, give specific, actionable guidance the next attempt can follow to fix
  the gaps. If passed, briefly note why. Never leave feedback empty.`;

async function runLlmVerify(opts: VerifyStepOptions): Promise<VerifyResult> {
  const prompt = `Overall goal:\n${opts.goal}\n\nStep: ${opts.stepTitle}\nInstructions:\n${opts.instructions}\n\nAcceptance criteria:\n${opts.acceptanceCriteria}\n\nWorker output:\n${truncate(opts.output)}\n\nJudge this step now. Return the JSON verdict.`;

  let raw = '';
  try {
    raw = await generateTextFromProvider({
      providerId: opts.providerId,
      model: opts.model,
      system: JUDGE_SYSTEM,
      prompt,
      maxTokens: 1024,
      abortSignal: opts.abortSignal,
    });
  } catch (err) {
    // Infrastructure failure → fail OPEN (don't punish the worker).
    console.warn('[workflow/verifier] judge call failed, passing open:', err);
    return {
      passed: true,
      feedback: 'Verifier unavailable; accepted without LLM judging.',
      via: 'llm',
    };
  }

  const verdict = parseVerdict(raw);
  if (!verdict) {
    console.warn('[workflow/verifier] could not parse judge verdict, passing open');
    return {
      passed: true,
      feedback: 'Verifier returned an unparseable verdict; accepted.',
      via: 'llm',
    };
  }
  return { ...verdict, via: 'llm' };
}

function parseVerdict(raw: string): Omit<VerifyResult, 'via'> | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.passed !== 'boolean') return null;
  return {
    passed: o.passed,
    feedback: typeof o.feedback === 'string' ? o.feedback : '',
    score: typeof o.score === 'number' ? o.score : undefined,
  };
}

function truncate(s: string): string {
  if (s.length <= MAX_OUTPUT_CHARS) return s;
  return s.slice(0, MAX_OUTPUT_CHARS) + `\n…[truncated ${s.length - MAX_OUTPUT_CHARS} chars]`;
}
