import type { SwarmState, SwarmConfig, SwarmTopology, SwarmAgent, SwarmTask, SwarmLogEntry, SwarmAgentStatus, SwarmTaskStatus, AgentRole } from '@/types';

const DEFAULT_AGENTS: AgentRole[] = [
  { id: 'planner', name: 'Planner', description: 'Task decomposition & planning' },
  { id: 'coder', name: 'Coder', description: 'Coding & tool execution' },
  { id: 'reviewer', name: 'Reviewer', description: 'Code review & quality check' },
];

export function defaultAgentsForTopology(topology: SwarmTopology): SwarmAgent[] {
  switch (topology) {
    case 'hierarchical':
      return DEFAULT_AGENTS.map(r => ({
        role: r,
        status: r.id === 'planner' ? 'running' : 'idle',
        toolCallCount: 0,
      }));
    case 'sequential':
      return DEFAULT_AGENTS.map(r => ({
        role: r,
        status: 'idle',
        toolCallCount: 0,
      }));
    case 'autonomous':
      return [{
        role: { id: 'autonomous', name: 'Autonomous', description: 'Self-iterating agent' },
        status: 'running',
        toolCallCount: 0,
      }];
  }
}

class SwarmManager {
  private state: SwarmState | null = null;
  private listeners = new Set<(state: SwarmState) => void>();

  getState(): SwarmState | null { return this.state; }

  start(sessionId: string, config: SwarmConfig): SwarmState {
    this.state = {
      sessionId,
      active: true,
      config,
      agents: defaultAgentsForTopology(config.topology),
      tasks: [],
      logs: [],
      currentIteration: 1,
      startedAt: Date.now(),
    };
    this.notify();
    return this.state;
  }

  updateAgentStatus(agentId: string, status: SwarmAgentStatus, currentWork?: string, progress?: number): void {
    if (!this.state) return;
    this.state = {
      ...this.state,
      agents: this.state.agents.map(a =>
        a.role.id === agentId ? { ...a, status, currentWork, progress } : a,
      ),
    };
    this.notify();
  }

  addTask(task: SwarmTask): void {
    if (!this.state) return;
    this.state = {
      ...this.state,
      tasks: [...this.state.tasks, task],
    };
    this.notify();
  }

  updateTaskStatus(taskId: string, status: SwarmTaskStatus): void {
    if (!this.state) return;
    this.state = {
      ...this.state,
      tasks: this.state.tasks.map(t => t.id === taskId ? { ...t, status } : t),
    };
    this.notify();
  }

  addLog(entry: Omit<SwarmLogEntry, 'id' | 'timestamp'>): void {
    if (!this.state) return;
    this.state = {
      ...this.state,
      logs: [...this.state.logs, { ...entry, id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, timestamp: Date.now() }],
    };
    this.notify();
  }

  incrementIteration(): void {
    if (!this.state) return;
    this.state = { ...this.state, currentIteration: this.state.currentIteration + 1 };
    this.notify();
  }

  incrementToolCall(agentId: string): void {
    if (!this.state) return;
    this.state = {
      ...this.state,
      agents: this.state.agents.map(a =>
        a.role.id === agentId ? { ...a, toolCallCount: a.toolCallCount + 1 } : a,
      ),
    };
    this.notify();
  }

  stop(error?: string): void {
    if (!this.state) return;
    this.state = {
      ...this.state,
      active: false,
      completedAt: Date.now(),
      ...(error ? { error } : {}),
    };
    this.notify();
  }

  reset(): void {
    this.state = null;
    this.notify();
  }

  subscribe(fn: (state: SwarmState) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private notify(): void {
    if (!this.state) return;
    for (const fn of this.listeners) {
      try { fn(this.state); } catch { /* ignore */ }
    }
  }
}

const GLOBAL_KEY = '__swarmManager__';

export function getSwarmManager(): SwarmManager {
  const globalThisAny = globalThis as Record<string, unknown>;
  if (!globalThisAny[GLOBAL_KEY]) {
    globalThisAny[GLOBAL_KEY] = new SwarmManager();
  }
  return globalThisAny[GLOBAL_KEY] as SwarmManager;
}
