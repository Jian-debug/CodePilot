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
        status: 'idle',
        toolCallCount: 0,
      }];
  }
}

class SwarmManager {
  private state: SwarmState | null = null;
  private listeners = new Set<(state: SwarmState) => void>();
  private abortController: AbortController | null = null;

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

  /**
   * Start the autonomous loop by calling the API and consuming the SSE stream.
   * Updates local state in real-time as events arrive.
   */
  async startFromAPI(sessionId: string, objective: string, config: SwarmConfig): Promise<void> {
    // Initialize local state
    this.start(sessionId, config);

    this.abortController = new AbortController();

    try {
      const response = await fetch('/api/chat/swarm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, objective, config }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API returned ${response.status}: ${errText}`);
      }

      // Consume SSE stream
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            this.handleSSEEvent(event);
          } catch { /* skip malformed */ }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.stop('User stopped');
      } else {
        this.stop(error instanceof Error ? error.message : 'Unknown error');
      }
    }
  }

  private handleSSEEvent(event: { type: string; data: unknown }): void {
    if (!this.state) return;

    switch (event.type) {
      case 'init': {
        const d = event.data as { swarmSessionId: string; startedAt: number };
        this.state = { ...this.state, startedAt: d.startedAt };
        this.notify();
        break;
      }
      case 'agent_status': {
        const d = event.data as { agentId: string; status: SwarmAgentStatus; currentWork?: string; progress?: number };
        this.updateAgentStatus(d.agentId, d.status, d.currentWork, d.progress);
        break;
      }
      case 'task_update': {
        const d = event.data as { taskId: string; status: SwarmTaskStatus };
        this.updateTaskStatus(d.taskId, d.status);
        break;
      }
      case 'log': {
        const d = event.data as Omit<SwarmLogEntry, 'id' | 'timestamp'>;
        this.addLog(d);
        break;
      }
      case 'iteration': {
        const d = event.data as { current: number; max: number };
        this.state = { ...this.state, currentIteration: d.current };
        this.notify();
        break;
      }
      case 'tool_call': {
        const d = event.data as { agentId: string; toolName?: string };
        this.incrementToolCall(d.agentId);
        if (d.toolName) {
          this.addLog({ agentId: d.agentId, message: `Tool call: ${d.toolName}`, type: 'tool_call' });
        }
        break;
      }
      case 'permission_request': {
        // Log permission requests so the user can see them in the comm log
        const d = event.data as { toolName?: string };
        if (d.toolName) {
          this.addLog({ agentId: 'autonomous', message: `Permission needed: ${d.toolName}`, type: 'error' });
        }
        break;
      }
      case 'done': {
        const d = event.data as { error?: string };
        this.stop(d.error);
        break;
      }
    }
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
    this.abort(); // Also abort any in-flight fetch
    this.state = {
      ...this.state,
      active: false,
      completedAt: Date.now(),
      ...(error ? { error } : {}),
    };
    this.notify();
  }

  /** Abort any in-flight API request */
  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  reset(): void {
    this.abort();
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
