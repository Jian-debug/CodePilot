import type { SwarmState, SwarmConfig, SwarmTopology, SwarmAgent, SwarmTask, SwarmLogEntry, SwarmAgentStatus, SwarmTaskStatus, SwarmSummary, AgentRole } from '@/types';
import { saveSwarmHistory } from './swarm-history';

const DEFAULT_AGENTS: AgentRole[] = [
  { id: 'planner', name: 'Planner', description: 'Task decomposition & planning' },
  { id: 'coder', name: 'Coder', description: 'Coding & tool execution' },
  { id: 'reviewer', name: 'Reviewer', description: 'Code review & quality check' },
];

export function defaultAgentsForTopology(topology: SwarmTopology): SwarmAgent[] {
  switch (topology) {
    case 'hierarchical':
      return [
        { role: DEFAULT_AGENTS[0], status: 'running', toolCallCount: 0 },
        { role: DEFAULT_AGENTS[1], status: 'idle', toolCallCount: 0 },
      ];
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
    default: {
      const _exhaustive: never = topology;
      throw new Error(`Unknown topology: ${topology}`);
    }
  }
}

class SwarmManager {
  private state: SwarmState | null = null;
  private listeners = new Set<(state: SwarmState) => void>();
  private abortController: AbortController | null = null;
  private logBuffer: Omit<SwarmLogEntry, 'id' | 'timestamp'>[] = [];
  private rafHandle: number | null = null;
  private toolCallDetails: Array<{ toolName: string }> = [];
  private resolvedModel: string = '';

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
    this.toolCallDetails = [];
    this.logBuffer = [];
    this.resolvedModel = '';
    this.notify();
    return this.state;
  }

  async startFromAPI(sessionId: string, objective: string, config: SwarmConfig, modelId?: string): Promise<void> {
    // Abort any in-progress session before starting a new one
    this.abort();
    this.start(sessionId, config);
    this.resolvedModel = modelId || '';
    this.abortController = new AbortController();

    try {
      const response = await fetch('/api/chat/swarm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, objective, config, modelId }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API returned ${response.status}: ${errText}`);
      }

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
        buffer = lines.pop() || '';

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
        this.bufferLog(d);
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
          this.toolCallDetails.push({ toolName: d.toolName });
          this.bufferLog({ agentId: d.agentId, message: `Tool call: ${d.toolName}`, type: 'tool_call' });
        }
        break;
      }
      case 'permission_request': {
        const d = event.data as { toolName?: string };
        if (d.toolName) {
          this.bufferLog({ agentId: 'autonomous', message: `Permission needed: ${d.toolName}`, type: 'error' });
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

  private bufferLog(entry: Omit<SwarmLogEntry, 'id' | 'timestamp'>): void {
    this.logBuffer.push(entry);
    if (this.rafHandle === null) {
      this.rafHandle = requestAnimationFrame(() => {
        this.flushLogBuffer();
      });
    }
  }

  private flushLogBuffer(): void {
    this.rafHandle = null;
    if (!this.state || this.logBuffer.length === 0) return;
    const newLogs = this.logBuffer.map(entry => ({
      ...entry,
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
    }));
    this.state = {
      ...this.state,
      logs: [...this.state.logs, ...newLogs],
    };
    this.logBuffer = [];
    this.notify();
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
    const existing = this.state.tasks.find(t => t.id === taskId);
    if (!existing) {
      // Auto-create task (hierarchical topology sends events before manager knows)
      this.state = {
        ...this.state,
        tasks: [...this.state.tasks, { id: taskId, title: taskId, status, agentId: '' }],
      };
    } else {
      this.state = {
        ...this.state,
        tasks: this.state.tasks.map(t => t.id === taskId ? { ...t, status } : t),
      };
    }
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

    // Cancel pending RAF before computing final state
    if (this.rafHandle) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }

    const duration = Date.now() - (this.state.startedAt || 0);
    const toolCalls: Record<string, number> = {};
    for (const { toolName } of this.toolCallDetails) {
      toolCalls[toolName] = (toolCalls[toolName] || 0) + 1;
    }

    const status: SwarmSummary['status'] = error === 'User stopped' ? 'stopped' : error ? 'failed' : 'completed';
    const summary: SwarmSummary = {
      status,
      duration,
      iterations: this.state.currentIteration,
      toolCalls,
      totalToolCalls: this.toolCallDetails.length,
      message: error,
    };

    if (this.logBuffer.length > 0) {
      const newLogs = this.logBuffer.map(entry => ({
        ...entry,
        id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
      }));
      this.state = {
        ...this.state,
        active: false,
        completedAt: Date.now(),
        error,
        summary,
        logs: [...this.state.logs, ...newLogs],
      };
      this.logBuffer = [];
    } else {
      this.state = {
        ...this.state,
        active: false,
        completedAt: Date.now(),
        error,
        summary,
      };
    }

    saveSwarmHistory(
      this.state.sessionId,
      this.state.config,
      summary,
      this.resolvedModel || this.state.config.topology,
    );

    if (typeof window !== 'undefined' && status === 'completed') {
      window.dispatchEvent(new CustomEvent('swarm:completed', {
        detail: { sessionId: this.state.sessionId },
      }));
    }

    this.notify();
  }

  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  reset(): void {
    this.abort();
    if (this.rafHandle) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    // Discard buffer on reset rather than flushing
    this.logBuffer = [];
    this.toolCallDetails = [];
    this.resolvedModel = '';
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
