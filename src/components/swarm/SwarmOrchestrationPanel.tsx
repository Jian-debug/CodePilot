'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import type { SwarmState, SwarmAgent, SwarmTask, SwarmLogEntry, SwarmConfig, SwarmSummary, SwarmLogFilter } from '@/types';
import { getSwarmManager } from '@/lib/swarm/swarm-manager';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const STATUS_COLORS: Record<string, string> = {
  idle: 'text-muted-foreground bg-muted/50',
  planning: 'text-status-info-foreground bg-status-info-muted',
  running: 'text-primary bg-primary/15',
  reviewing: 'text-status-warning-foreground bg-status-warning-muted',
  completed: 'text-status-success-foreground bg-status-success-muted',
  failed: 'text-status-error-foreground bg-status-error-muted',
  stopped: 'text-muted-foreground bg-muted/50',
};

const TASK_STATUS_LABELS: Record<string, TranslationKey> = {
  queued: 'swarm.taskQueued',
  running: 'swarm.taskRunning',
  completed: 'swarm.taskCompleted',
  failed: 'swarm.taskFailed',
  waiting: 'swarm.taskWaiting',
};

const TASK_STATUS_CLASSES: Record<string, string> = {
  queued: 'text-muted-foreground bg-muted/50',
  running: 'text-primary bg-primary/15',
  completed: 'text-status-success-foreground bg-status-success-muted',
  failed: 'text-status-error-foreground bg-status-error-muted',
  waiting: 'text-muted-foreground bg-muted/50',
};

const AGENT_ICONS: Record<string, string> = {
  planner: '📋',
  coder: '💻',
  reviewer: '🔍',
  autonomous: '🤖',
};

const LOG_FILTERS: { id: SwarmLogFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'tool_call', label: '工具' },
  { id: 'error', label: '错误' },
];

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toTimeString().slice(0, 8); // HH:mm:ss
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

interface SwarmOrchestrationPanelProps {
  sessionId: string;
}

export function SwarmOrchestrationPanel({ sessionId }: SwarmOrchestrationPanelProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<SwarmState | null>(null);
  const [logFilter, setLogFilter] = useState<SwarmLogFilter>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [interventionInput, setInterventionInput] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const manager = getSwarmManager();
    const unsubscribe = manager.subscribe((s) => {
      if (s.sessionId === sessionId) {
        setState(s);
      }
    });
    const current = manager.getState();
    if (current && current.sessionId === sessionId) {
      setState(current);
    }
    return unsubscribe;
  }, [sessionId]);

  // Auto-scroll logs when new entries arrive (unless paused)
  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [state?.logs.length, autoScroll]);

  const handleStop = useCallback(async () => {
    try {
      await fetch('/api/chat/swarm', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
    } catch { /* best effort */ }
    const manager = getSwarmManager();
    manager.stop();
  }, [sessionId]);

  const handleIntervention = useCallback(async () => {
    if (!interventionInput.trim()) return;
    const msg = interventionInput.trim();
    const manager = getSwarmManager();
    // Local echo for immediate feedback
    manager.bufferLog({ agentId: 'user', message: `📝 ${msg}`, type: 'info' });
    setInterventionInput('');
    const ok = await manager.sendIntervention(sessionId, msg);
    if (!ok) {
      manager.bufferLog({ agentId: 'system', message: '干预发送失败，Swarm 可能已结束', type: 'error' });
    }
  }, [sessionId, interventionInput]);

  const handleClose = useCallback(() => {
    const manager = getSwarmManager();
    manager.reset();
    setState(null);
  }, []);

  // Show summary panel when completed
  if (!state?.active && state?.summary) {
    return (
      <SummaryPanel
        summary={state.summary}
        config={state.config}
        startedAt={state.startedAt}
        completedAt={state.completedAt}
        onClose={handleClose}
      />
    );
  }

  if (!state || !state.active) return null;

  const elapsed = state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0;
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  // Filter logs
  const filteredLogs = logFilter === 'all'
    ? state.logs
    : state.logs.filter(l => l.type === logFilter);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-3">
      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 animate-pulse rounded-full bg-status-success" />
              <span className="text-sm font-semibold">{t('swarm.running' as TranslationKey)}</span>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {t('swarm.topologyLabel' as TranslationKey)}: {state.config.topology}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-muted-foreground">
              {t('swarm.iteration' as TranslationKey)} {state.currentIteration}/{state.config.maxIterations}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {t('swarm.elapsed' as TranslationKey)} {minutes}:{String(seconds).padStart(2, '0')}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px] text-status-error-foreground hover:bg-status-error-muted"
              onClick={handleStop}
            >
              {t('swarm.stop' as TranslationKey)}
            </Button>
          </div>
        </div>

        {/* Agent cards */}
        <div className="grid grid-cols-3 gap-3 p-4">
          {state.agents.map((agent) => (
            <AgentCard key={agent.role.id} agent={agent} />
          ))}
        </div>

        {/* Task pipeline */}
        {state.tasks.length > 0 && (
          <div className="px-4 pb-3">
            <div className="mb-2 text-xs font-medium">{t('swarm.taskPipeline' as TranslationKey)}</div>
            <div className="rounded-lg border border-border/60 overflow-hidden">
              {state.tasks.map((task, i) => (
                <TaskRow key={task.id} task={task} isLast={i === state.tasks.length - 1} />
              ))}
            </div>
          </div>
        )}

        {/* Communication log */}
        <div className="px-4 pb-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">{t('swarm.commLog' as TranslationKey)}</span>
            <div className="flex gap-1">
              {LOG_FILTERS.map(f => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setLogFilter(f.id)}
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors',
                    logFilter === f.id
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div
            ref={logRef}
            onMouseEnter={() => setAutoScroll(false)}
            onMouseLeave={() => setAutoScroll(true)}
            className="max-h-40 overflow-y-auto rounded-lg border border-border/60 bg-[oklch(0.10_0.002_49)] p-3 font-mono text-[11px] leading-relaxed"
          >
            {filteredLogs.length === 0 ? (
              <div className="text-muted-foreground/50">{t('swarm.commLogEmpty' as TranslationKey)}</div>
            ) : (
              filteredLogs.map((log) => (
                <LogEntry key={log.id} entry={log} agents={state.agents} />
              ))
            )}
          </div>
        </div>

        {/* Intervention input */}
        <div className="border-t border-border/60 px-4 py-3">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">实时干预</div>
          <div className="flex gap-2">
            <input
              type="text"
              value={interventionInput}
              onChange={(e) => setInterventionInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleIntervention(); } }}
              placeholder="输入指令，Agent 将在下一轮响应..."
              className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono"
            />
            <Button
              size="sm"
              onClick={handleIntervention}
              disabled={!interventionInput.trim()}
              className="h-auto px-3 py-1.5 text-xs"
            >
              发送
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryPanel({
  summary,
  config,
  startedAt,
  completedAt,
  onClose,
}: {
  summary: SwarmSummary;
  config: SwarmConfig;
  startedAt?: number;
  completedAt?: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const statusIcon = summary.status === 'completed' ? '✅' : summary.status === 'failed' ? '❌' : '⏹️';
  const statusColor = summary.status === 'completed'
    ? 'text-status-success-foreground'
    : summary.status === 'failed'
    ? 'text-status-error-foreground'
    : 'text-muted-foreground';

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-3">
      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-lg">{statusIcon}</span>
            <span className={cn('text-sm font-semibold', statusColor)}>
              {summary.status === 'completed' ? 'Swarm 已完成' : summary.status === 'failed' ? 'Swarm 失败' : 'Swarm 已停止'}
            </span>
          </div>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={onClose}>
            关闭
          </Button>
        </div>
        <div className="grid grid-cols-4 gap-4 p-4 text-center">
          <div>
            <div className="text-[10px] text-muted-foreground">耗时</div>
            <div className="text-sm font-mono font-semibold">{formatDuration(summary.duration)}</div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">迭代</div>
            <div className="text-sm font-mono font-semibold">{summary.iterations}</div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">工具调用</div>
            <div className="text-sm font-mono font-semibold">{summary.totalToolCalls}</div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">拓扑</div>
            <div className="text-sm font-semibold">{config.topology}</div>
          </div>
        </div>
        {summary.totalToolCalls > 0 && (
          <div className="px-4 pb-3">
            <div className="mb-1 text-[10px] text-muted-foreground">工具明细</div>
            <div className="rounded-lg border border-border/60 p-2 font-mono text-[11px]">
              {Object.entries(summary.toolCalls).map(([name, count]) => (
                <div key={name} className="flex justify-between py-0.5">
                  <span>{name}</span>
                  <span className="text-muted-foreground">x{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {summary.message && (
          <div className="px-4 pb-3">
            <div className="rounded-lg border border-border/60 bg-muted/30 p-2 font-mono text-[11px] text-muted-foreground">
              {summary.message.slice(0, 200)}{summary.message.length > 200 ? '...' : ''}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AgentCard({ agent }: { agent: SwarmAgent }) {
  const { t } = useTranslation();

  const statusLabel = (status: string): string => {
    const map: Record<string, TranslationKey> = {
      idle: 'swarm.agentIdle',
      planning: 'swarm.agentPlanning',
      running: 'swarm.agentRunning',
      reviewing: 'swarm.agentReviewing',
      completed: 'swarm.agentCompleted',
      failed: 'swarm.agentFailed',
      stopped: 'swarm.agentStopped',
    };
    return t(map[status] || 'swarm.agentIdle');
  };

  return (
    <div
      className={cn(
        'rounded-lg border p-3 transition-all',
        agent.status === 'running' || agent.status === 'planning' || agent.status === 'reviewing'
          ? 'border-primary/40'
          : 'border-border/60',
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-sm">
            {AGENT_ICONS[agent.role.id] || '🤖'}
          </div>
          <span className="text-sm font-semibold">{agent.role.name}</span>
        </div>
        <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', STATUS_COLORS[agent.status] || STATUS_COLORS.idle)}>
          {statusLabel(agent.status)}
        </span>
      </div>
      {agent.currentWork && (
        <div className="mb-2 text-[11px] leading-relaxed text-muted-foreground">{agent.currentWork}</div>
      )}
      {agent.status === 'running' && agent.progress != null && (
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${agent.progress}%` }}
          />
        </div>
      )}
      {agent.toolCallCount > 0 && (
        <div className="mt-2 text-[10px] text-muted-foreground">
          {agent.toolCallCount} tool call{agent.toolCallCount > 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, isLast }: { task: SwarmTask; isLast: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        'flex items-center px-3 py-2',
        task.status === 'running' ? 'bg-primary/5' : '',
        !isLast && 'border-b border-border/60',
      )}
    >
      <div className={cn(
        'mr-2.5 h-1.5 w-1.5 shrink-0 rounded-full',
        task.status === 'completed' ? 'bg-status-success' :
        task.status === 'running' ? 'animate-pulse bg-primary' :
        'bg-muted-foreground/15',
      )} />
      <span className={cn(
        'flex-1 text-xs',
        task.status === 'queued' || task.status === 'waiting' ? 'text-muted-foreground' : 'font-medium',
      )}>
        {task.title}
      </span>
      <span className="mr-3 text-[10px] text-muted-foreground">{task.agentId}</span>
      <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', TASK_STATUS_CLASSES[task.status] || TASK_STATUS_CLASSES.queued)}>
        {t(TASK_STATUS_LABELS[task.status] || 'swarm.taskQueued')}
      </span>
    </div>
  );
}

function LogEntry({ entry, agents }: { entry: SwarmLogEntry; agents: SwarmAgent[] }) {
  const agent = agents.find(a => a.role.id === entry.agentId);
  const agentColor = agent ? getAgentColor(agent.role.id) : 'text-muted-foreground';

  const msgColor = () => {
    switch (entry.type) {
      case 'error': return 'text-status-error-foreground';
      case 'tool_result': return 'text-status-success-foreground';
      case 'tool_call': return 'text-muted-foreground';
      default: return 'text-muted-foreground';
    }
  };

  return (
    <div className="mb-0.5">
      <span className="text-muted-foreground/40">[{formatTime(entry.timestamp)}]</span>{' '}
      <span className={agentColor}>[{agent?.role.name || entry.agentId}]</span>{' '}
      <span className={msgColor()}>{entry.message}</span>
    </div>
  );
}

function getAgentColor(agentId: string): string {
  const map: Record<string, string> = {
    planner: 'text-status-info-foreground',
    coder: 'text-status-success-foreground',
    reviewer: 'text-status-warning-foreground',
    autonomous: 'text-primary',
  };
  return map[agentId] || 'text-muted-foreground';
}
