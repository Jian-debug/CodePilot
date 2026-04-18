/**
 * TerminalReasonChip — renders a contextual end-of-turn status chip based on
 * `SDKResultMessage.terminal_reason` (SDK 0.2.111+).
 *
 * Phase 1 of agent-sdk-0-2-111-adoption: additive display layer. Does NOT
 * replace error-classifier.ts — errors without a result message continue to
 * flow through the existing classifier pipeline.
 *
 * Only renders for reasons that carry information users can act on or interpret.
 * Silent for `completed` (normal) and `aborted_*` (user-initiated).
 */

import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';

interface Props {
  reason: string | undefined;
}

type Tone = 'warning' | 'error' | 'info' | 'muted';

const TONE_BY_REASON: Record<string, Tone> = {
  max_turns: 'warning',
  prompt_too_long: 'error',
  blocking_limit: 'error',
  rapid_refill_breaker: 'error',
  image_error: 'error',
  model_error: 'error',
  stop_hook_prevented: 'muted',
  hook_stopped: 'muted',
  tool_deferred: 'info',
};

// Reasons that should render silently (no chip). Users either already know
// (they cancelled) or the turn completed normally.
const SILENT_REASONS = new Set(['completed', 'aborted_streaming', 'aborted_tools']);

// Whitelist of reasons we have explicit i18n labels for. Anything else
// (e.g. a future SDK value we haven't translated yet) renders under the
// 'unknown' key so the UI never leaks the raw reason string.
const KNOWN_REASONS = new Set([
  'max_turns',
  'prompt_too_long',
  'blocking_limit',
  'rapid_refill_breaker',
  'image_error',
  'model_error',
  'stop_hook_prevented',
  'hook_stopped',
  'tool_deferred',
]);

const TONE_CLASSES: Record<Tone, string> = {
  warning: 'bg-status-warning-muted text-status-warning-foreground border-status-warning-muted',
  error: 'bg-status-error-muted text-status-error-foreground border-status-error-muted',
  info: 'bg-status-info-muted text-status-info-foreground border-status-info-muted',
  muted: 'bg-muted text-muted-foreground border-border',
};

export function TerminalReasonChip({ reason }: Props) {
  const { t } = useTranslation();

  if (!reason || SILENT_REASONS.has(reason)) return null;

  // Use whitelist rather than `t(key) || t(fallback)` because translate()
  // returns the raw key when missing, so the `||` branch would never fire
  // and a new SDK reason would leak a "terminal.new_reason" string to the UI.
  const isKnown = KNOWN_REASONS.has(reason);
  const tone = TONE_BY_REASON[reason] ?? 'warning';
  const label = isKnown
    ? t(`terminal.${reason}` as TranslationKey)
    : t('terminal.unknown' as TranslationKey);

  return (
    <div className="mx-auto mt-2 flex w-full max-w-3xl justify-start px-4">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${TONE_CLASSES[tone]}`}
        data-terminal-reason={reason}
      >
        {label}
      </span>
    </div>
  );
}
