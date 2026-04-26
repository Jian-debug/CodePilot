'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import type { SwarmState, SwarmAgent, SwarmTask, SwarmLogEntry, SwarmConfig } from '@/types';
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

interface SwarmOrchestrationPanelProps {
  sessionId: string;
}

export function SwarmOrchestrationPanel({ sessionId }: SwarmOrchestrationPanelProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<SwarmState | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const manager = getSwarmManager();
    const unsubscribe = manager.subscribe((s) => {
      if (s.sessionId === sessionId) {
        setState(s);
      }
    });
    // Initial state
    const current = manager.getState();
    if (current && current.sessionId === sessionId) {
      setState(current);
    }
    return unsubscribe;
  }, [sessionId]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [state?.logs.length]);

  const handleStop = useCallback(() => {
    const manager = getSwarmManager();
    manager.stop();
  }, []);

  if (!state || !state.active) return null;

  const elapsed = state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0;
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

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
          <div className="mb-2 text-xs font-medium">{t('swarm.commLog' as TranslationKey)}</div>
          <div
            ref={logRef}
            className="max-h-28 overflow-y-auto rounded-lg border border-border/60 bg-[oklch(0.10_0.002_49)] p-3 font-mono text-[11px] leading-relaxed"
          >
            {state.logs.length === 0 ? (
              <div className="text-muted-foreground/50">{t('swarm.commLogEmpty' as TranslationKey)}</div>
            ) : (
              state.logs.map((log) => (
                <LogEntry key={log.id} entry={log} agents={state.agents} />
              ))
            )}
          </div>
        </div>
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
