'use client';

import { useState, useCallback } from 'react';
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

const TOPOLOGIES: { id: SwarmTopology; titleKey: TranslationKey; descKey: TranslationKey }[] = [
  { id: 'hierarchical', titleKey: 'swarm.topologyHierarchical' as TranslationKey, descKey: 'swarm.topologyHierarchicalDesc' as TranslationKey },
  { id: 'sequential', titleKey: 'swarm.topologySequential' as TranslationKey, descKey: 'swarm.topologySequentialDesc' as TranslationKey },
  { id: 'autonomous', titleKey: 'swarm.topologyAutonomous' as TranslationKey, descKey: 'swarm.topologyAutonomousDesc' as TranslationKey },
];

interface SwarmButtonProps {
  sessionId: string;
  onStartSwarm: (config: SwarmConfig) => void;
  disabled?: boolean;
}

export function SwarmButton({ sessionId, onStartSwarm, disabled }: SwarmButtonProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [topology, setTopology] = useState<SwarmTopology>('hierarchical');
  const [qualityCheck, setQualityCheck] = useState(true);
  const [maxIterations, setMaxIterations] = useState(5);
  const [autoRetry, setAutoRetry] = useState(true);

  const handleStart = useCallback(() => {
    onStartSwarm({
      topology,
      qualityCheck,
      maxIterations,
      autoRetry,
    });
    setOpen(false);
  }, [topology, qualityCheck, maxIterations, autoRetry, onStartSwarm]);

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
              <div className="flex items-center justify-between">
                <span className="text-sm">{t('swarm.qualityCheck' as TranslationKey)}</span>
                <button
                  type="button"
                  onClick={() => setQualityCheck(!qualityCheck)}
                  className={cn(
                    'relative h-5 w-9 rounded-full transition-colors',
                    qualityCheck ? 'bg-primary' : 'bg-muted',
                  )}
                >
                  <div
                    className={cn(
                      'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                      qualityCheck ? 'translate-x-4' : 'translate-x-0.5',
                    )}
                  />
                </button>
              </div>
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

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t('swarm.cancel' as TranslationKey)}
            </Button>
            <Button onClick={handleStart}>
              {t('swarm.start' as TranslationKey)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
