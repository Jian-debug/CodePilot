/**
 * runtime-selection.test.ts — Tests for runtime selection and OAuth status.
 *
 * - OAuth status: inlined (real getOAuthStatus reads host DB, non-deterministic)
 * - Runtime selection: inlined because registry.ts depends on runtime
 *   registration side effects that conflict with isolated unit tests.
 *   The inlined logic is documented as a mirror of registry.ts and
 *   should be updated when the source changes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Suite 1: predictNativeRuntime (inlined — registry.ts has side effects) ──
// Mirrors registry.ts predictNativeRuntime() — update if source changes.

function predictNativeRuntime(
  providerId: string | undefined,
  cliEnabled: boolean,
  agentRuntime: string,
  sdkAvailable: boolean,
): boolean {
  if (providerId === 'openai-oauth') return true;
  if (!cliEnabled) return true;
  if (agentRuntime === 'native') return true;
  if (agentRuntime === 'claude-code-sdk') return false;
  // auto: prefer SDK if available
  if (sdkAvailable) return false;
  return true;
}

describe('predictNativeRuntime (mirrors registry.ts)', () => {
  it('openai-oauth → always native', () => {
    assert.equal(predictNativeRuntime('openai-oauth', true, 'auto', true), true);
  });
  it('cli disabled → always native', () => {
    assert.equal(predictNativeRuntime(undefined, false, 'auto', true), true);
  });
  it('setting=native → native', () => {
    assert.equal(predictNativeRuntime(undefined, true, 'native', true), true);
  });
  it('setting=claude-code-sdk → not native', () => {
    assert.equal(predictNativeRuntime(undefined, true, 'claude-code-sdk', true), false);
  });
  it('auto + SDK available → not native (prefers SDK)', () => {
    assert.equal(predictNativeRuntime(undefined, true, 'auto', true), false);
  });
  it('auto + SDK unavailable → native', () => {
    assert.equal(predictNativeRuntime(undefined, true, 'auto', false), true);
  });
});

// ── Suite 2: resolveRuntime auto semantics (inlined) ──

function resolveRuntime(
  cliDisabled: boolean,
  overrideId: string | undefined,
  settingId: string | undefined,
  sdkAvailable: boolean,
): string {
  if (cliDisabled) return 'native';
  if (overrideId && overrideId !== 'auto') return overrideId;
  if (settingId && settingId !== 'auto') return settingId;
  if (sdkAvailable) return 'claude-code-sdk';
  return 'native';
}

describe('resolveRuntime (mirrors registry.ts)', () => {
  it('cli disabled → native regardless', () => {
    assert.equal(resolveRuntime(true, 'claude-code-sdk', 'claude-code-sdk', true), 'native');
  });
  it('explicit override takes precedence', () => {
    assert.equal(resolveRuntime(false, 'native', 'claude-code-sdk', true), 'native');
  });
  it('setting takes precedence over auto', () => {
    assert.equal(resolveRuntime(false, undefined, 'native', true), 'native');
  });
  it('auto + SDK available → sdk', () => {
    assert.equal(resolveRuntime(false, undefined, undefined, true), 'claude-code-sdk');
  });
  it('auto + SDK unavailable → native', () => {
    assert.equal(resolveRuntime(false, undefined, undefined, false), 'native');
  });
  it('auto override still goes to auto detection', () => {
    assert.equal(resolveRuntime(false, 'auto', undefined, true), 'claude-code-sdk');
  });
});

// ── Suite 3: OpenAI OAuth status (inlined — real impl reads host DB) ──

describe('OpenAI OAuth status (inlined logic)', () => {
  // All OAuth status tests are inlined because the real getOAuthStatus()
  // reads from the host machine's DB — test results would depend on
  // whether the developer has logged into OpenAI, making it non-deterministic.

  function deriveOAuthStatus(
    accessToken: string | null,
    expiresAt: number,
    refreshToken: string | null,
  ): { authenticated: boolean; needsRefresh?: boolean } {
    if (!accessToken) return { authenticated: false };
    const REFRESH_BUFFER_MS = 5 * 60 * 1000;
    if (expiresAt && Date.now() > expiresAt && !refreshToken) {
      return { authenticated: false };
    }
    const needsRefresh = expiresAt > 0 && Date.now() > expiresAt - REFRESH_BUFFER_MS;
    return { authenticated: true, needsRefresh };
  }

  it('valid token → authenticated', () => {
    const r = deriveOAuthStatus('tok', Date.now() + 3600_000, null);
    assert.equal(r.authenticated, true);
    assert.equal(r.needsRefresh, false);
  });

  it('expired + no refresh → not authenticated', () => {
    const r = deriveOAuthStatus('tok', Date.now() - 1000, null);
    assert.equal(r.authenticated, false);
  });

  it('expired + has refresh → authenticated + needsRefresh', () => {
    const r = deriveOAuthStatus('tok', Date.now() - 1000, 'ref');
    assert.equal(r.authenticated, true);
    assert.equal(r.needsRefresh, true);
  });

  it('near expiry (within 5min buffer) → needsRefresh', () => {
    const r = deriveOAuthStatus('tok', Date.now() + 60_000, 'ref');
    assert.equal(r.authenticated, true);
    assert.equal(r.needsRefresh, true);
  });

  it('expiresAt=0 → no expiry check', () => {
    const r = deriveOAuthStatus('tok', 0, null);
    assert.equal(r.authenticated, true);
    assert.equal(r.needsRefresh, false);
  });
});
