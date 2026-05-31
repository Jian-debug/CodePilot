/**
 * workflow/model-ladder.ts — build the per-step capability ladder.
 *
 * The ladder is the ordered list of (provider, model) the step runner tries.
 * Rung 0 is the cheapest/fastest; the engine escalates to stronger rungs only
 * when verification fails — "if the model's capability is insufficient, switch
 * to a stronger model and retry".
 *
 * Source of rungs (in priority order):
 *   1. Per-step explicit `override` (model IDs) — becomes the whole ladder.
 *   2. Main provider's roleModels: small → default(or sonnet) → opus.
 *   3. Fallback (no role models / env mode): session model, then escalate to opus.
 *
 * sdkProxyOnly providers (Kimi / GLM / MiniMax single-model proxies) can't host
 * a reliable small→opus escalation on the native streamText path, so they
 * collapse to a single rung (the session/default model). This mirrors the
 * sdkProxyOnly handling in resolveAuxiliaryModel (provider-resolver.ts).
 */

import { resolveProvider } from '../provider-resolver';
import { findPresetForLegacy } from '../provider-catalog';
import type { LadderRung } from './types';
import type { WorkflowStepComplexity } from '@/types';

export interface BuildLadderOptions {
  providerId?: string;
  sessionProviderId?: string;
  sessionModel?: string;
  /** Explicit per-step model override — when present, this IS the ladder. */
  override?: string[];
}

export function buildModelLadder(opts: BuildLadderOptions): LadderRung[] {
  const main = resolveProvider({
    providerId: opts.providerId,
    sessionProviderId: opts.sessionProviderId,
    sessionModel: opts.sessionModel,
  });

  // createModel/runAgentLoop accept '' (env/default). For virtual providers
  // (e.g. 'openai-oauth') main.provider is undefined, so fall back to the
  // explicit/session id the caller passed.
  const providerId = main.provider?.id ?? (opts.providerId || opts.sessionProviderId || '');

  // 1. Per-step override — caller knows exactly which models to try.
  if (opts.override && opts.override.length > 0) {
    return dedupeRungs(
      opts.override.map((m) => ({ providerId, model: m, role: 'override' as const })),
    );
  }

  // Detect sdkProxyOnly for the main provider via its catalog preset.
  let isSdkProxyOnly = false;
  if (main.provider) {
    const preset = findPresetForLegacy(
      main.provider.base_url,
      main.provider.provider_type,
      main.protocol,
    );
    isSdkProxyOnly = preset?.sdkProxyOnly ?? false;
  }

  // sdkProxyOnly → single rung; escalation across proxy models is unreliable.
  if (isSdkProxyOnly) {
    const single =
      opts.sessionModel || main.model || main.roleModels.default || main.roleModels.sonnet || 'sonnet';
    return [{ providerId, model: single, role: 'session' }];
  }

  // 2. Capability escalation from roleModels: small → default(or sonnet) → opus.
  const role = main.roleModels;
  const rungs: LadderRung[] = [];
  if (role.small) rungs.push({ providerId, model: role.small, role: 'small' });
  const mid = role.default || role.sonnet;
  if (mid) rungs.push({ providerId, model: mid, role: role.default ? 'default' : 'sonnet' });
  if (role.opus) rungs.push({ providerId, model: role.opus, role: 'opus' });

  // 3. Fallback: provider exposes no role models (env mode / minimal config).
  //    Seed from the session model, then escalate to the strongest known alias.
  if (rungs.length === 0) {
    const seed = opts.sessionModel || main.model || 'sonnet';
    rungs.push({ providerId, model: seed, role: 'session' });
    if (seed !== 'opus') rungs.push({ providerId, model: 'opus', role: 'opus' });
  }

  return dedupeRungs(rungs);
}

/** Pick the strongest rung (last) for verification — a strong judge is desirable. */
export function strongestRung(ladder: LadderRung[]): LadderRung | undefined {
  return ladder[ladder.length - 1];
}

/**
 * The rung to use for attempt `i` (0-based). Walk the ladder cheap→strong; once
 * past the end, repeat the strongest rung. This lets a step retry on the best
 * model (with the verifier's feedback) after exhausting its distinct models,
 * instead of failing after a single strong attempt.
 */
export function rungForAttempt(ladder: LadderRung[], i: number): LadderRung {
  if (ladder.length === 0) throw new Error('rungForAttempt: empty ladder');
  return i < ladder.length ? ladder[i] : ladder[ladder.length - 1];
}

/**
 * Trim the lower (cheaper) rungs of a ladder based on a step's assessed
 * complexity, so a hard step starts at a capable model instead of wasting a
 * near-certain-to-fail cheap attempt + verification round. The ladder still
 * escalates upward from the chosen start, and at least one rung always remains:
 *   low    → full ladder (cheapest first)
 *   medium → drop the cheapest rung
 *   high   → start at the strongest rung
 */
export function startRungForComplexity(
  ladder: LadderRung[],
  complexity: WorkflowStepComplexity,
): LadderRung[] {
  if (ladder.length <= 1) return ladder;
  switch (complexity) {
    case 'high':
      return ladder.slice(ladder.length - 1);
    case 'medium':
      return ladder.slice(1);
    case 'low':
    default:
      return ladder;
  }
}

function dedupeRungs(rungs: LadderRung[]): LadderRung[] {
  const seen = new Set<string>();
  const out: LadderRung[] = [];
  for (const r of rungs) {
    const key = `${r.providerId}::${r.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
