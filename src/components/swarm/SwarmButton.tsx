'use client';

import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { SwarmTopology, SwarmConfig } from '@/types';
import { cn } from '@/lib/utils';
import { Sparkle } from '@/components/ui/icon';
import { getSwarmHistory, type SwarmHistoryEntry } from '@/lib/swarm/swarm-history';

const TOPOLOGIES: { id: SwarmTopology; titleKey: TranslationKey; descKey: TranslationKey }[] = [
  { id: 'hierarchical', titleKey: 'swarm.topologyHierarchical' as TranslationKey, descKey: 'swarm.topologyHierarchicalDesc' as TranslationKey },
  { id: 'sequential', titleKey: 'swarm.topologySequential' as TranslationKey, descKey: 'swarm.topologySequentialDesc' as TranslationKey },
  { id: 'autonomous', titleKey: 'swarm.topologyAutonomous' as TranslationKey, descKey: 'swarm.topologyAutonomousDesc' as TranslationKey },
];

interface ModelOption {
  modelId: string;
  upstreamModelId: string;
  displayName: string;
  isRecommended: boolean;
}

interface SwarmButtonProps {
  sessionId: string;
  objective: string;
  onStartSwarm: (objective: string, config: SwarmConfig, modelId?: string) => void;
  disabled?: boolean;
}

export function SwarmButton({ sessionId, objective, onStartSwarm, disabled }: SwarmButtonProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'config' | 'history'>('config');
  const [topology, setTopology] = useState<SwarmTopology>('autonomous');
  const [qualityCheck, setQualityCheck] = useState(true);
  const [maxIterations, setMaxIterations] = useState(5);
  const [autoRetry, setAutoRetry] = useState(true);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [history, setHistory] = useState<SwarmHistoryEntry[]>([]);

  // Fetch available models and history when dialog opens
  useEffect(() => {
    if (!open) return;
    setActiveTab('config');
    setLoadingModels(true);
    fetch('/api/chat/swarm/models')
      .then(r => r.json())
      .then(data => {
        if (data.models) {
          setAvailableModels(data.models);
          const recommended = data.models.find((m: ModelOption) => m.isRecommended);
          setSelectedModel(recommended?.modelId || data.models[0]?.modelId || '');
        }
      })
      .catch(() => { /* provider not configured */ })
      .finally(() => setLoadingModels(false));
    // Load history
    setHistory(getSwarmHistory(sessionId));
  }, [open, sessionId]);

  const handleStart = useCallback(() => {
    onStartSwarm(objective, {
      topology,
      qualityCheck,
      maxIterations,
      autoRetry,
    }, selectedModel || undefined);
    setOpen(false);
  }, [objective, topology, qualityCheck, maxIterations, autoRetry, selectedModel, onStartSwarm]);

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => setOpen(true)}
            className={cn(
              'rounded-md px-2.5 h-7 text-xs font-medium border transition-all',
              'text-muted-foreground border-border/60 hover:text-foreground hover:border-foreground/30 hover:bg-accent/50',
            )}
          >
            <Sparkle size={12} />
            {t('composer.swarmMode' as TranslationKey)}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {t('composer.swarmModeTooltip' as TranslationKey)}
        </TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15">
                <Sparkle size={16} className="text-primary" />
              </div>
              <DialogTitle>{t('swarm.startTitle' as TranslationKey)}</DialogTitle>
            </div>
            <DialogDescription>
              {t('swarm.startDescription' as TranslationKey)}
            </DialogDescription>
          </DialogHeader>

          {/* Tab bar */}
          <div className="flex gap-1 border-b border-border/60 pb-0">
            {(['config', 'history'] as const).map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-px',
                  activeTab === tab
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {tab === 'config' ? '配置' : `历史 (${history.length})`}
              </button>
            ))}
          </div>

          {activeTab === 'config' && (
            <div className="space-y-5">
              {/* Topology selector */}
              <div>
                <label className="text-sm font-medium">{t('swarm.topology' as TranslationKey)}</label>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {TOPOLOGIES.map((topo) => (
                    <button
                      key={topo.id}
                      type="button"
                      onClick={() => setTopology(topo.id)}
                      className={cn(
                        'rounded-lg border p-3 text-left transition-all',
                        topology === topo.id
                          ? 'border-primary bg-primary/10'
                          : 'border-border/60 hover:border-foreground/30',
                      )}
                    >
                      <div className="text-xs font-medium">{t(topo.titleKey)}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">{t(topo.descKey)}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Model selector */}
              <div>
                <label className="text-sm font-medium">{t('swarm.model' as TranslationKey)}</label>
                <div className="mt-2 flex items-center gap-2">
                  {loadingModels ? (
                    <div className="h-9 w-full animate-pulse rounded-md bg-muted" />
                  ) : availableModels.length > 0 ? (
                    <select
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      {availableModels.map((m) => (
                        <option key={m.modelId} value={m.modelId}>
                          {m.displayName}{m.isRecommended ? ` (${t('swarm.recommended' as TranslationKey)})` : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {t('swarm.noModels' as TranslationKey)}
                    </span>
                  )}
                </div>
              </div>

              {/* Agent roles */}
              <div>
                <label className="text-sm font-medium">{t('swarm.agentRoles' as TranslationKey)}</label>
                <div className="mt-2 flex gap-2">
                  {[
                    { name: 'Planner', desc: t('swarm.plannerDesc' as TranslationKey) },
                    { name: 'Coder', desc: t('swarm.coderDesc' as TranslationKey) },
                    { name: 'Reviewer', desc: t('swarm.reviewerDesc' as TranslationKey) },
                  ].map((role) => (
                    <div
                      key={role.name}
                      className="flex-1 flex items-center gap-2 rounded-lg border border-border/60 p-2.5"
                    >
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15">
                        <div className="h-2 w-2 rounded-full bg-primary" />
                      </div>
                      <div>
                        <div className="text-xs font-medium">{role.name}</div>
                        <div className="text-[10px] text-muted-foreground">{role.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Settings */}
              <div className="space-y-3">
                {/* qualityCheck hidden — v1 has no Critic logic */}
                <div className="flex items-center justify-between">
                  <span className="text-sm">{t('swarm.maxIterations' as TranslationKey)}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">{maxIterations}</span>
                    <input
                      type="range"
                      min={1}
                      max={10}
                      value={maxIterations}
                      onChange={(e) => setMaxIterations(Number(e.target.value))}
                      className="w-20 accent-primary"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">{t('swarm.autoRetry' as TranslationKey)}</span>
                  <button
                    type="button"
                    onClick={() => setAutoRetry(!autoRetry)}
                    className={cn(
                      'relative h-5 w-9 rounded-full transition-colors',
                      autoRetry ? 'bg-primary' : 'bg-muted',
                    )}
                  >
                    <div
                      className={cn(
                        'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                        autoRetry ? 'translate-x-4' : 'translate-x-0.5',
                      )}
                    />
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {history.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  暂无执行历史
                </div>
              ) : (
                history.map((entry, i) => (
                  <HistoryRow key={i} entry={entry} />
                ))
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t('swarm.cancel' as TranslationKey)}
            </Button>
            {activeTab === 'config' && (
              <Button
                onClick={handleStart}
                disabled={availableModels.length === 0 && !loadingModels}
              >
                {t('swarm.start' as TranslationKey)}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function HistoryRow({ entry }: { entry: SwarmHistoryEntry }) {
  const statusIcon = entry.status === 'completed' ? '✅' : entry.status === 'failed' ? '❌' : '⏹️';
  const durationSec = Math.floor(entry.duration / 1000);
  const timeStr = `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`;
  const dateStr = new Date(entry.timestamp).toLocaleString('zh-CN');

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/60 p-3">
      <span className="text-base">{statusIcon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{entry.topology}</span>
          <span className="text-[10px] text-muted-foreground">{entry.model}</span>
        </div>
        <div className="text-[10px] text-muted-foreground">{dateStr}</div>
      </div>
      <div className="text-right">
        <div className="text-xs font-mono">{timeStr}</div>
        <div className="text-[10px] text-muted-foreground">{entry.iterations} 轮 · {entry.summary.totalToolCalls} 工具</div>
      </div>
    </div>
  );
}
