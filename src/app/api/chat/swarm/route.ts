import { NextRequest, NextResponse } from 'next/server';
import type { SwarmConfig, SwarmStats } from '@/types';
import { runAutonomousLoop } from '@/lib/swarm/autonomous-loop';
import { runHierarchicalLoop, type LoopCallbacks as HierarchicalCallbacks } from '@/lib/swarm/hierarchical-loop';
import { acquireSessionLock, releaseSessionLock, setSessionRuntimeStatus, getSetting } from '@/lib/db';
// Ensure runtimes are registered (side-effect import triggers registration)
import '@/lib/runtime';
import crypto from 'crypto';
import { resolveSwarmModel, getSwarmModelOptions } from '@/lib/swarm/swarm-model-resolver';
import type { SwarmModelResolution } from '@/lib/swarm/swarm-model-resolver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Send a Feishu notification when a swarm completes/fails.
 * Reuses the project's existing Feishu outbound infrastructure.
 */
async function sendSwarmNotification(
  objective: string,
  status: 'completed' | 'failed' | 'stopped',
  duration: number,
  iterations: number,
  stats: SwarmStats | undefined,
  error?: string,
): Promise<void> {
  const durationSec = Math.round(duration / 1000);
  const toolSummary = stats?.tools.reduce<Record<string, number>>((acc, t) => {
    acc[t.name] = (acc[t.name] || 0) + 1;
    return acc;
  }, {}) || {};
  const toolList = Object.entries(toolSummary).map(([k, v]) => `${k}(${v})`).join(', ');
  const skillList = stats?.skills.map(s => s.name).join(', ') || 'none';

  const emoji = status === 'completed' ? '✅' : status === 'stopped' ? '⏸️' : '❌';
  const statusText = status === 'completed' ? '执行完成' : status === 'stopped' ? '已中止' : '执行失败';

  let text = `${emoji} **Swarm ${statusText}**\n\n`;
  text += `目标: ${objective.slice(0, 100)}${objective.length > 100 ? '...' : ''}\n`;
  text += `耗时: ${durationSec}秒 | 迭代: ${iterations}\n`;
  if (toolList) text += `工具: ${toolList}\n`;
  text += `Skills: ${skillList}\n`;
  if (error) text += `\n错误: ${error}`;

  // Always send in-app notification
  try {
    const { sendNotification } = await import('@/lib/notification-manager');
    await sendNotification({
      title: `Swarm ${statusText}`,
      body: text,
      priority: status === 'failed' ? 'urgent' : 'normal',
    });
  } catch (err) {
    console.error('[swarm] In-app notification failed:', err);
  }

  // Send Feishu notification if configured with a target chat ID.
  // Note: FeishuConfig is primarily for inbound bridge. Outbound notifications
  // require bridge_feishu_notify_chat_id to be set in settings.
  try {
    const { loadFeishuConfig } = await import('@/lib/channels/feishu/config');
    const feishuConfig = loadFeishuConfig();
    if (!feishuConfig?.appId || !feishuConfig?.appSecret) return;

    const notifyChatId = process.env.FEISHU_NOTIFY_CHAT_ID || getSetting('bridge_feishu_notify_chat_id');
    if (!notifyChatId) return; // no outbound target configured

    const lark = await import('@larksuiteoapi/node-sdk');
    const client = new lark.Client({
      appId: feishuConfig.appId,
      appSecret: feishuConfig.appSecret,
    });

    const content = JSON.stringify({
      zh_cn: { content: [[{ tag: 'md', text }]] },
    });
    await client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: notifyChatId, content, msg_type: 'post' },
    });
  } catch (err) {
    // Feishu not configured or send failed — already sent in-app notification
    console.error('[swarm] Feishu notification failed:', err);
  }
}

// ─── POST handler ─────────────────────────────────────────────────────────────

/** Module-level map: sessionId -> { stopped, abortController, interventionQueue, stats, objective } for controlling running swarms */
const ACTIVE_SWARMS = new Map<string, {
  stopped: boolean;
  abortController: AbortController;
  interventionQueue: string[];
  stats?: SwarmStats;
  objective?: string;
}>();

/**
 * POST /api/chat/swarm — Start a Swarm session
 *
 * For autonomous topology, this runs the autonomous loop and streams
 * SSE events with progress updates. Other topologies return a placeholder.
 */
export async function POST(request: NextRequest) {
  try {
    const body: {
      sessionId: string;
      objective: string;
      config: SwarmConfig;
      modelId?: string;  // optional user-selected model override
    } = await request.json();

    const { sessionId, objective, config, modelId } = body;

    if (!sessionId || !objective || !config) {
      return NextResponse.json(
        { error: 'sessionId, objective, and config are required' },
        { status: 400 },
      );
    }

    // Prevent concurrent chat requests on this session
    const lockId = crypto.randomBytes(8).toString('hex');
    const lockAcquired = acquireSessionLock(sessionId, lockId, `swarm-${process.pid}`, 600);
    if (!lockAcquired) {
      return NextResponse.json(
        { error: 'Session is busy processing another request', code: 'SESSION_BUSY' },
        { status: 409 },
      );
    }
    setSessionRuntimeStatus(sessionId, 'running');

    // Resolve the model: user-selected > auto-match to active provider
    const resolved = resolveSwarmModel(modelId);
    if (!resolved) {
      try { releaseSessionLock(sessionId, lockId); } catch { /* best effort */ }
      setSessionRuntimeStatus(sessionId, 'idle');
      return NextResponse.json(
        { error: 'No provider configured. Please set up an AI provider in Settings.' },
        { status: 500 },
      );
    }

    // For autonomous topology, run the loop and stream SSE
    if (config.topology === 'autonomous') {
      return runAutonomousSSE(sessionId, objective, config, lockId, resolved);
    }

    // For hierarchical topology, run the planner-coder loop with SSE
    if (config.topology === 'hierarchical') {
      return runHierarchicalSSE(sessionId, objective, config, lockId, resolved);
    }

    // Release lock immediately for unsupported topologies (placeholder)
    try { releaseSessionLock(sessionId, lockId); } catch { /* best effort */ }
    setSessionRuntimeStatus(sessionId, 'idle');

    return NextResponse.json({
      message: `Topology '${config.topology}' not yet implemented. Only 'autonomous' is supported in v1.`,
      swarmSession: {
        sessionId,
        active: false,
        config,
        currentIteration: 0,
        startedAt: Date.now(),
      },
    });
  } catch (error) {
    console.error('[swarm] Failed to start swarm:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start swarm' },
      { status: 500 },
    );
  }
}

function runAutonomousSSE(
  sessionId: string,
  objective: string,
  config: SwarmConfig,
  lockId: string,
  resolvedModel: SwarmModelResolution,
): Response {
  const swarmSessionId = `swarm-${sessionId}-${Date.now()}`;

  // Create an abort controller shared between the SSE stream and the active swarm entry
  const abortController = new AbortController();
  ACTIVE_SWARMS.set(sessionId, { stopped: false, abortController, interventionQueue: [], objective });

  const stream = new ReadableStream<string>({
    async start(controller) {
      const enqueue = (type: string, data: unknown) => {
        controller.enqueue(`data: ${JSON.stringify({ type, data })}\n\n`);
      };

      // Send initial state
      const startedAt = Date.now();
      enqueue('init', {
        swarmSessionId,
        sessionId,
        topology: config.topology,
        maxIterations: config.maxIterations,
        startedAt,
      });

      // Track iterations for notification
      let iterationCount = 0;
      const initStartedAt = startedAt;

      try {
        await runAutonomousLoop({
          sessionId,
          objective,
          config,
          modelOverride: resolvedModel.upstreamModel,
          abortSignal: abortController.signal,
          callbacks: {
            onAgentStatus: (agentId, status, work, progress) => {
              enqueue('agent_status', { agentId, status, currentWork: work, progress });
            },
            onTaskUpdate: (taskId, status) => {
              enqueue('task_update', { taskId, status });
            },
            onLog: (entry) => {
              enqueue('log', entry);
            },
            onIteration: (iteration) => {
              iterationCount = iteration;
              enqueue('iteration', { current: iteration, max: config.maxIterations });
            },
            onToolCall: (agentId, toolName) => {
              enqueue('tool_call', { agentId, toolName });
            },
            onComplete: (error, stats) => {
              const entry = ACTIVE_SWARMS.get(sessionId);
              if (entry && stats) entry.stats = stats;
              // Send Feishu notification
              const status = (error === 'User stopped the swarm' || error === 'User stopped')
                ? 'stopped' as const
                : error ? 'failed' as const
                : 'completed' as const;
              const duration = Date.now() - (initStartedAt || Date.now());
              const iterations_count = entry ? 0 : 0; // tracked via SSE iteration events
              sendSwarmNotification(entry?.objective || objective, status, duration, iterations_count, stats, error).catch(() => {});
              enqueue('done', { error, stats });
              controller.close();
            },
            shouldStop: () => ACTIVE_SWARMS.get(sessionId)?.stopped ?? true,
            getInterventions: () => {
              const entry = ACTIVE_SWARMS.get(sessionId);
              if (!entry) return [];
              const msgs = [...entry.interventionQueue];
              entry.interventionQueue.length = 0;
              return msgs;
            },
          },
        });
      } finally {
        // Clean up
        ACTIVE_SWARMS.delete(sessionId);
        try { releaseSessionLock(sessionId, lockId); } catch { /* best effort */ }
        setSessionRuntimeStatus(sessionId, 'idle');
      }
    },

    cancel() {
      // Client disconnected — stop the swarm
      const entry = ACTIVE_SWARMS.get(sessionId);
      if (entry) {
        entry.stopped = true;
        entry.abortController.abort();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

function runHierarchicalSSE(
  sessionId: string,
  objective: string,
  config: SwarmConfig,
  lockId: string,
  resolvedModel: SwarmModelResolution,
): Response {
  const swarmSessionId = `swarm-${sessionId}-${Date.now()}`;
  const abortController = new AbortController();
  ACTIVE_SWARMS.set(sessionId, { stopped: false, abortController, interventionQueue: [], objective });

  const stream = new ReadableStream<string>({
    async start(controller) {
      const enqueue = (type: string, data: unknown) => {
        controller.enqueue(`data: ${JSON.stringify({ type, data })}\n\n`);
      };

      enqueue('init', {
        swarmSessionId,
        sessionId,
        topology: config.topology,
        maxIterations: config.maxIterations,
        startedAt: Date.now(),
      });

      let iterationCount = 0;
      const initStartedAt = Date.now();

      try {
        const callbacks: HierarchicalCallbacks = {
          onAgentStatus: (agentId, status, work, progress) => {
            enqueue('agent_status', { agentId, status, currentWork: work, progress });
          },
          onTaskUpdate: (taskId, status) => {
            enqueue('task_update', { taskId, status });
          },
          onLog: (entry) => {
            enqueue('log', entry);
          },
          onIteration: (iteration) => {
            iterationCount = iteration;
            enqueue('iteration', { current: iteration, max: config.maxIterations });
          },
          onToolCall: (agentId, toolName) => {
            enqueue('tool_call', { agentId, toolName });
          },
          onComplete: (error, stats) => {
            const entry = ACTIVE_SWARMS.get(sessionId);
            if (entry && stats) entry.stats = stats;
            const status = (error === 'User stopped the swarm' || error === 'User stopped')
              ? 'stopped' as const
              : error ? 'failed' as const
              : 'completed' as const;
            const duration = Date.now() - initStartedAt;
            sendSwarmNotification(entry?.objective || objective, status, duration, iterationCount, stats, error).catch(() => {});
            enqueue('done', { error, stats });
            controller.close();
          },
          shouldStop: () => ACTIVE_SWARMS.get(sessionId)?.stopped ?? true,
          getInterventions: () => {
            const entry = ACTIVE_SWARMS.get(sessionId);
            if (!entry) return [];
            const msgs = [...entry.interventionQueue];
            entry.interventionQueue.length = 0;
            return msgs;
          },
        };

        await runHierarchicalLoop({
          sessionId,
          objective,
          config,
          modelOverride: resolvedModel.upstreamModel,
          abortSignal: abortController.signal,
          callbacks,
        });
      } finally {
        ACTIVE_SWARMS.delete(sessionId);
        try { releaseSessionLock(sessionId, lockId); } catch { /* best effort */ }
        setSessionRuntimeStatus(sessionId, 'idle');
      }
    },

    cancel() {
      const entry = ACTIVE_SWARMS.get(sessionId);
      if (entry) {
        entry.stopped = true;
        entry.abortController.abort();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

/** DELETE /api/chat/swarm — Stop a running swarm */
export async function DELETE(req: Request) {
  try {
    const body: { sessionId: string } = await req.json();

    if (!body?.sessionId) {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400 },
      );
    }

    const entry = ACTIVE_SWARMS.get(body.sessionId);
    if (!entry) {
      return NextResponse.json(
        { error: 'No active swarm found for this session' },
        { status: 404 },
      );
    }

    entry.stopped = true;
    entry.abortController.abort();
    return NextResponse.json({ message: 'Swarm session stopped' });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to stop swarm' },
      { status: 500 },
    );
  }
}

/** POST /api/chat/swarm/intervene — Send an intervention message to a running swarm */
export async function PATCH(req: Request) {
  try {
    const body: { sessionId: string; message: string } = await req.json();

    if (!body?.sessionId || !body?.message) {
      return NextResponse.json(
        { error: 'sessionId and message are required' },
        { status: 400 },
      );
    }

    const entry = ACTIVE_SWARMS.get(body.sessionId);
    if (!entry || entry.stopped) {
      return NextResponse.json(
        { error: 'No active swarm running for this session' },
        { status: 404 },
      );
    }

    entry.interventionQueue.push(body.message);
    return NextResponse.json({ message: 'Intervention queued' });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to queue intervention' },
      { status: 500 },
    );
  }
}

