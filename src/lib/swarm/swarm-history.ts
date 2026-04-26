/**
 * Swarm execution history — persisted to localStorage.
 * Key format: swarm-history:{sessionId}
 * Stores last 10 executions per session.
 */

import type { SwarmSummary, SwarmConfig } from '@/types';

export interface SwarmHistoryEntry {
  timestamp: number;
  topology: string;
  model: string;
  iterations: number;
  status: 'completed' | 'failed' | 'stopped';
  duration: number;
  toolCalls: Record<string, number>;
  /** Full summary stored for future drill-down/auditability; flat fields above are for quick list rendering */
  summary: SwarmSummary;
}

const MAX_HISTORY = 10;

function storageKey(sessionId: string): string {
  return `swarm-history:${sessionId}`;
}

export function saveSwarmHistory(sessionId: string, config: SwarmConfig, summary: SwarmSummary, model: string): void {
  if (typeof window === 'undefined') return;
  try {
    const key = storageKey(sessionId);
    const existing: SwarmHistoryEntry[] = JSON.parse(localStorage.getItem(key) || '[]');
    const entry: SwarmHistoryEntry = {
      timestamp: Date.now(),
      topology: config.topology,
      model,
      iterations: summary.iterations,
      status: summary.status,
      duration: summary.duration,
      toolCalls: summary.toolCalls,
      summary,
    };
    existing.unshift(entry);
    localStorage.setItem(key, JSON.stringify(existing.slice(0, MAX_HISTORY)));
  } catch { /* quota exceeded or parse error */ }
}

export function getSwarmHistory(sessionId: string): SwarmHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const key = storageKey(sessionId);
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch {
    return [];
  }
}

export function clearSwarmHistory(sessionId: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(storageKey(sessionId));
  } catch { /* ignore */ }
}
