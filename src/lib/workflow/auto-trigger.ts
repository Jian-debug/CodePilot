/**
 * workflow/auto-trigger.ts — decide when to nudge the model toward the Workflow
 * tool (P4, keyword + setting).
 *
 * P1–P3 made workflows reachable only when the model explicitly called the
 * Workflow tool. P4 closes the discoverability gap: when a turn's prompt looks
 * like a large, multi-step task AND the feature is enabled, the agent loop
 * appends WORKFLOW_SUGGESTION_PROMPT to the system prompt so the model is told
 * the tool exists and when to use it. This is a *suggestion*, not auto-exec —
 * the model still decides, and simple edits are explicitly left inline.
 *
 * Detection is intentionally conservative (a curated keyword set or strong
 * structural signals) since a false positive only adds a hint, but we still
 * avoid nudging on short questions.
 */

const SETTING_KEY = 'workflow_auto_suggest';

/** Strong signals that a request is a project-scale, multi-step task. */
const STRONG_KEYWORDS: RegExp[] = [
  /\brefactor\b/,
  /\bmigrat(?:e|ion|ing)\b/,
  /\brewrite\b/,
  /\bre-?architect\b/,
  /\bredesign\b/,
  /\boverhaul\b/,
  /\bscaffold\b/,
  /\bbootstrap\b/,
  /\bacross the (?:code\s?base|project|repo|repository|app|application)\b/,
  /\b(?:entire|whole) (?:code\s?base|project|repo|repository|app|application|system)\b/,
  /\bcode\s?base[-\s]?wide\b/,
  /\bmulti[-\s]?step\b/,
  /\bmultiple files\b/,
  /\bend[-\s]?to[-\s]?end\b/,
  /\bstep[-\s]?by[-\s]?step\b/,
];

/** Setting gate — defaults ON; only an explicit 'false' disables it. */
export function isWorkflowAutoSuggestEnabled(
  getSetting: (key: string) => string | undefined,
): boolean {
  return getSetting(SETTING_KEY) !== 'false';
}

/**
 * Heuristic: does this prompt look like a large, multi-step task worth routing
 * through the Workflow engine? Conservative by design.
 */
export function shouldSuggestWorkflow(prompt: string): boolean {
  const text = (prompt || '').trim();
  if (text.length < 24) return false; // too short to be a project-scale task

  const lower = text.toLowerCase();

  // Skip short, obvious questions ("how do I ...?", "what is ...?") — they want
  // an answer, not an autonomous multi-step run.
  const looksLikeQuestion =
    /^(?:how|what|why|when|who|which|where|is|are|does|do|can|could|should|would|explain|tell me)\b/.test(
      lower,
    ) && lower.includes('?');
  if (looksLikeQuestion && text.length < 160) return false;

  if (STRONG_KEYWORDS.some((re) => re.test(lower))) return true;

  // An enumerated plan with several items is a strong multi-step signal.
  const listItems = (text.match(/^\s*(?:\d+[.)]|[-*])\s+/gm) || []).length;
  if (listItems >= 3) return true;

  // Sequential phrasing ("first ... then ... after that ... finally").
  const sequenceMarkers = (lower.match(/\b(?:and then|then|after that|next,|finally)\b/g) || []).length;
  if (sequenceMarkers >= 3) return true;
  if (sequenceMarkers >= 2 && text.length > 120) return true;

  return false;
}

/** System-prompt snippet appended when a workflow is suggested for the turn. */
export const WORKFLOW_SUGGESTION_PROMPT =
  'This request looks like a large, multi-step task. You have a `Workflow` tool that ' +
  'decomposes such a goal into verifiable steps, runs each step (escalating to a stronger ' +
  'model and retrying if a step fails verification), executes independent steps in parallel, ' +
  'and streams progress for observation. For project-scale work (migrations, codebase-wide ' +
  'changes, multi-file features), prefer calling `Workflow({ goal })` once with a clear, ' +
  'self-contained goal instead of doing everything inline. For simple or single-file edits, ' +
  'do the work directly without the Workflow tool.';
