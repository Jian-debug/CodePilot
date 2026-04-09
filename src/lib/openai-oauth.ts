/**
 * openai-oauth.ts — OpenAI PKCE OAuth + Token Exchange.
 *
 * Implements the Codex CLI OAuth flow for ChatGPT Plus/Pro users.
 * Based on CraftAgent's verified implementation.
 *
 * Flow: PKCE auth → code exchange → id_token → RFC 8693 token exchange → OpenAI API Key
 */

import { randomBytes, createHash } from 'node:crypto';

// ── OAuth Configuration ────────────────────────────────────────

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTH_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const SCOPES = 'openid profile email offline_access';
export const CALLBACK_PORT = 1455;

// ── Types ──────────────────────────────────────────────────────

export interface OAuthTokens {
  idToken: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // Unix ms
}

export interface PreparedFlow {
  authUrl: string;
  state: string;
  codeVerifier: string;
}

export interface JwtClaims {
  email?: string;
  chatgpt_account_id?: string;
  chatgpt_plan_type?: string;
  organizations?: Array<{ id: string }>;
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string;
    chatgpt_plan_type?: string;
  };
}

// ── PKCE ───────────────────────────────────────────────────────

function generateState(): string {
  return randomBytes(32).toString('hex');
}

function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}

// ── Prepare OAuth Flow ─────────────────────────────────────────

export function prepareOAuthFlow(): PreparedFlow {
  const state = generateState();
  const { codeVerifier, codeChallenge } = generatePKCE();

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    codex_cli_simplified_flow: 'true',
    id_token_add_organizations: 'true',
  });

  return {
    authUrl: `${AUTH_URL}?${params.toString()}`,
    state,
    codeVerifier,
  };
}

// ── Exchange Code for Tokens ───────────────────────────────────

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
): Promise<OAuthTokens> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier,
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    let msg: string;
    try {
      const j = JSON.parse(text);
      msg = j.error_description || j.error || text;
    } catch { msg = text; }
    throw new Error(`Token exchange failed: ${response.status} - ${msg}`);
  }

  const data = await response.json() as {
    id_token: string;
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  return {
    idToken: data.id_token,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  };
}

// ── Refresh Tokens ─────────────────────────────────────────────

export async function refreshTokens(refreshToken: string): Promise<OAuthTokens> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    let msg: string;
    try {
      const j = JSON.parse(text);
      msg = j.error_description || j.error || text;
    } catch { msg = text; }
    throw new Error(`Token refresh failed: ${response.status} - ${msg}`);
  }

  const data = await response.json() as {
    id_token: string;
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  return {
    idToken: data.id_token,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  };
}

// ── Parse JWT Claims (without verification) ────────────────────

export function parseIdTokenClaims(idToken: string): JwtClaims {
  try {
    const payload = idToken.split('.')[1];
    const decoded = Buffer.from(payload, 'base64url').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    return {};
  }
}

/**
 * Extract ChatGPT account ID from JWT claims.
 * Used as ChatGPT-Account-Id header for Codex API calls.
 */
export function extractAccountId(claims: JwtClaims): string | undefined {
  return (
    claims.chatgpt_account_id ||
    claims['https://api.openai.com/auth']?.chatgpt_account_id ||
    claims.organizations?.[0]?.id
  );
}

/**
 * Codex API endpoint — ChatGPT Plus/Pro users access OpenAI models through this.
 * Uses access_token as Bearer + ChatGPT-Account-Id header.
 */
export const CODEX_API_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';
