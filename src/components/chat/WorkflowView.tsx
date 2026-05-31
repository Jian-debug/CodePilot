/**
 * WorkflowView — observable panel for a dynamic workflow run (P2).
 *
 * Renders the WorkflowViewState aggregated by workflow-view-reducer.ts from the
 * workflow_plan / workflow_step / workflow_attempt / workflow_verify SSE events
 * (live) or persisted DB records (reload). The point of the panel is to make the
 * engine's per-step model-ladder *observable*: you can see a step fail on a
 * cheap model, escalate to a stronger one, and pass — with the verifier's
 * verdict and feedback for each attempt.
 *
 * Styling mirrors RateLimitBanner (status-* tokens, lucide icons, useTranslation).
 */

'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Circle,
  CircleDashed,
  ChevronDown,
  ChevronRight,
  ArrowUp,
  Workflow as WorkflowIcon,
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import type {
  WorkflowViewState,
  WorkflowViewStep,
  WorkflowViewAttempt,
  WorkflowStepStatus,
  WorkflowVerifyStrategy,
} from '@/types';

interface Props {
  workflow: WorkflowViewState;
  /** Whether the steps list starts expanded. Defaults to expanded while the
   *  workflow is still running so the user can watch progress. */
  defaultExpanded?: boolean;
}

export function WorkflowView({ workflow, defaultExpanded }: Props) {
  const { t } = useTranslation();
  const initiallyOpen = defaultExpanded ?? workflow.status !== 'completed';
  const [expanded, setExpanded] = useState(initiallyOpen);

  const total = workflow.steps.length;
  const passed = workflow.steps.filter((s) => s.status === 'passed').length;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-2" data-workflow-status={workflow.status}>
      <div className="overflow-hidden rounded-lg border border-border bg-muted/30">
        {/* Header */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
          aria-expanded={expanded}
        >
          <WorkflowIcon size={15} className="shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                {t('workflow.title')}
              </span>
              <StatusBadge status={workflow.status} />
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground" title={workflow.goal}>
              {workflow.goal}
            </p>
          </div>
          {total > 0 && (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {t('workflow.stepsProgress', { passed, total })}
            </span>
          )}
          {expanded ? (
            <ChevronDown size={15} className="shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight size={15} className="shrink-0 text-muted-foreground" />
          )}
        </button>

        {/* Steps */}
        {expanded && total > 0 && (
          <ol className="border-t border-border/60">
            {workflow.steps.map((step) => (
              <StepRow key={step.stepId} step={step} t={t} />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

// ── Step row ────────────────────────────────────────────────────

function StepRow({
  step,
  t,
}: {
  step: WorkflowViewStep;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  // An attempt ladder longer than one rung means the engine escalated models.
  const escalated = step.attempts.length > 1;

  return (
    <li className="border-b border-border/40 px-3 py-2 last:border-b-0">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0">
          <StepStatusIcon status={step.status} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm text-foreground">
              <span className="text-muted-foreground tabular-nums">{step.idx + 1}.</span> {step.title}
            </span>
            <VerifyTag strategy={step.verifyStrategy} t={t} />
          </div>

          {/* Attempt ladder — the observable model-fallback narrative */}
          {step.attempts.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {step.attempts.map((a) => (
                <AttemptRow key={a.attemptId} attempt={a} t={t} />
              ))}
            </ul>
          )}

          {escalated && (
            <div className="mt-1 flex items-center gap-1 text-[11px] text-status-warning">
              <ArrowUp size={11} className="shrink-0" />
              <span>{t('workflow.escalated')}</span>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

// ── Attempt row ─────────────────────────────────────────────────

function AttemptRow({
  attempt,
  t,
}: {
  attempt: WorkflowViewAttempt;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  const stateClass =
    attempt.status === 'passed'
      ? 'text-status-success'
      : attempt.status === 'failed' || attempt.status === 'error'
        ? 'text-status-error-foreground'
        : 'text-muted-foreground';

  return (
    <li className="rounded-md bg-background/60 px-2 py-1">
      <div className="flex items-center gap-1.5 text-xs">
        <span className="shrink-0">
          <AttemptStatusIcon status={attempt.status} />
        </span>
        <span className="text-muted-foreground">{t('workflow.attempt', { n: attempt.attemptNo })}</span>
        <span className="font-mono text-[11px] text-foreground">{attempt.model}</span>
        <span className="rounded bg-muted px-1 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {attempt.role}
        </span>
        {attempt.via && attempt.passed !== undefined && (
          <span className={`ml-auto shrink-0 ${stateClass}`}>
            {t('workflow.verifyVia', { via: t(verifyKey(attempt.via)) })}
            {attempt.score != null && ` · ${t('workflow.score', { score: attempt.score })}`}
          </span>
        )}
      </div>

      {/* Verifier feedback on a failed attempt — what the next rung must fix. */}
      {attempt.passed === false && attempt.feedback && (
        <p className="mt-1 line-clamp-3 border-l-2 border-status-error-border pl-2 text-[11px] text-muted-foreground">
          <span className="font-medium text-status-error-foreground">{t('workflow.feedback')}: </span>
          {attempt.feedback}
        </p>
      )}
    </li>
  );
}

// ── Small presentational helpers ────────────────────────────────

function StatusBadge({ status }: { status: WorkflowViewState['status'] }) {
  const { t } = useTranslation();
  const map: Record<WorkflowViewState['status'], { cls: string; key: TranslationKey }> = {
    planning: { cls: 'bg-muted text-muted-foreground', key: 'workflow.status.planning' },
    running: { cls: 'bg-status-info-muted text-status-info-foreground', key: 'workflow.status.running' },
    completed: { cls: 'bg-status-success-muted text-status-success-foreground', key: 'workflow.status.completed' },
    failed: { cls: 'bg-status-error-muted text-status-error-foreground', key: 'workflow.status.failed' },
  };
  const { cls, key } = map[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>
      {status === 'running' && <Loader2 size={9} className="animate-spin" />}
      {t(key)}
    </span>
  );
}

function StepStatusIcon({ status }: { status: WorkflowStepStatus }) {
  switch (status) {
    case 'passed':
      return <CheckCircle2 size={15} className="text-status-success" />;
    case 'failed':
      return <XCircle size={15} className="text-status-error-foreground" />;
    case 'running':
      return <Loader2 size={15} className="animate-spin text-status-info-foreground" />;
    case 'skipped':
      return <CircleDashed size={15} className="text-muted-foreground/60" />;
    case 'pending':
    default:
      return <Circle size={15} className="text-muted-foreground/50" />;
  }
}

function AttemptStatusIcon({ status }: { status: WorkflowViewAttempt['status'] }) {
  switch (status) {
    case 'passed':
      return <CheckCircle2 size={12} className="text-status-success" />;
    case 'failed':
    case 'error':
      return <XCircle size={12} className="text-status-error-foreground" />;
    case 'running':
    default:
      return <Loader2 size={12} className="animate-spin text-muted-foreground" />;
  }
}

function VerifyTag({
  strategy,
  t,
}: {
  strategy: WorkflowVerifyStrategy;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  if (strategy === 'none') return null;
  return (
    <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
      {t(verifyKey(strategy))}
    </span>
  );
}

function verifyKey(via: WorkflowVerifyStrategy): TranslationKey {
  switch (via) {
    case 'command':
      return 'workflow.verify.command';
    case 'both':
      return 'workflow.verify.both';
    case 'none':
      return 'workflow.verify.none';
    case 'llm':
    default:
      return 'workflow.verify.llm';
  }
}
