'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/hooks/useTranslation';
import { Badge } from '@/components/ui/badge';
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from '@/components/ui/hover-card';

interface RuntimeBadgeProps {
  providerId?: string;
}

type RuntimeMode = 'auto' | 'native' | 'claude-code-sdk';

const LABELS: Record<RuntimeMode, { en: string; zh: string }> = {
  auto: { en: 'Agent: Auto', zh: 'Agent 引擎：自动' },
  native: { en: 'Agent: AI SDK', zh: 'Agent 引擎：AI SDK' },
  'claude-code-sdk': { en: 'Agent: Claude Code', zh: 'Agent 引擎：Claude Code' },
};

export function RuntimeBadge({ providerId }: RuntimeBadgeProps) {
  const [runtimeSetting, setRuntimeSetting] = useState<RuntimeMode>('auto');
  const router = useRouter();
  const { t } = useTranslation();
  const isZh = t('nav.chats') === '对话';

  // OpenAI models can't use Claude Code SDK — forced to AI SDK
  const isNonAnthropicProvider = providerId === 'openai-oauth';
  const effectiveRuntime: RuntimeMode = isNonAnthropicProvider ? 'native' : runtimeSetting;
  // Only flag as "overridden" when the user explicitly chose Claude Code
  // (not auto, since auto would fall back to AI SDK anyway if CLI is unavailable)
  const isOverridden = isNonAnthropicProvider && runtimeSetting === 'claude-code-sdk';

  useEffect(() => {
    const loadRuntime = () => {
      fetch('/api/settings/app')
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          const setting = data?.settings?.agent_runtime;
          if (setting && ['auto', 'native', 'claude-code-sdk'].includes(setting)) {
            setRuntimeSetting(setting as RuntimeMode);
          }
        })
        .catch(() => {});
    };
    loadRuntime();
    const handler = () => loadRuntime();
    window.addEventListener('provider-changed', handler);
    return () => window.removeEventListener('provider-changed', handler);
  }, []);

  const label = LABELS[effectiveRuntime];

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 py-0 cursor-pointer hover:bg-accent"
          onClick={() => router.push('/settings#cli')}
        >
          {isZh ? label.zh : label.en}
        </Badge>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="end" className="w-56 p-3 text-xs space-y-1.5">
        {isOverridden ? (
          <>
            <p>{isZh
              ? `当前使用 AI SDK 引擎（全局设置为 ${LABELS[runtimeSetting].zh}）`
              : `Using AI SDK engine (global setting: ${LABELS[runtimeSetting].en})`
            }</p>
            <p className="text-muted-foreground">
              {isZh
                ? 'OpenAI 模型不支持 Claude Code 引擎，已自动切换为 AI SDK'
                : 'OpenAI models are not compatible with Claude Code engine, automatically switched to AI SDK'}
            </p>
          </>
        ) : (
          <p className="text-muted-foreground">
            {effectiveRuntime === 'auto'
              ? (isZh ? '自动选择：有 Claude Code CLI 时用 Claude Code，否则用 AI SDK' : 'Auto: uses Claude Code when CLI is installed, otherwise AI SDK')
              : effectiveRuntime === 'native'
              ? (isZh ? 'AI SDK：内置多模型引擎，无需 CLI' : 'AI SDK: built-in multi-model engine, no CLI required')
              : (isZh ? 'Claude Code：通过 CLI 子进程驱动' : 'Claude Code: driven by CLI subprocess')
            }
          </p>
        )}
        <p className="text-muted-foreground">
          {isZh ? '点击前往设置' : 'Click to open settings'}
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}
