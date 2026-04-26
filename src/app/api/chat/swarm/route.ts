import { NextRequest, NextResponse } from 'next/server';
import type { SwarmConfig } from '@/types';
import { runAutonomousLoop } from '@/lib/swarm/autonomous-loop';
import { runHierarchicalLoop, type LoopCallbacks as HierarchicalCallbacks } from '@/lib/swarm/hierarchical-loop';
import { acquireSessionLock, releaseSessionLock, setSessionRuntimeStatus } from '@/lib/db';
// Ensure runtimes are registered (side-effect import triggers registration)
import '@/lib/runtime';
import crypto from 'crypto';
import { resolveSwarmModel, getSwarmModelOptions } from '@/lib/swarm/swarm-model-resolver';
import type { SwarmModelResolution } from '@/lib/swarm/swarm-model-resolver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Module-level map: sessionId -> { stopped, abortController, interventionQueue } for controlling running swarms */
const ACTIVE_SWARMS = new Map<string, {
  stopped: boolean;
  abortController: AbortController;
  interventionQueue: string[];
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
  ACTIVE_SWARMS.set(sessionId, { stopped: false, abortController, interventionQueue: [] });

  const stream = new ReadableStream<string>({
    async start(controller) {
      const enqueue = (type: string, data: unknown) => {
        controller.enqueue(`data: ${JSON.stringify({ type, data })}\n\n`);
      };

      // Send initial state
      enqueue('init', {
        swarmSessionId,
        sessionId,
        topology: config.topology,
        maxIterations: config.maxIterations,
        startedAt: Date.now(),
      });

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
              enqueue('iteration', { current: iteration, max: config.maxIterations });
            },
            onToolCall: (agentId, toolName) => {
              enqueue('tool_call', { agentId, toolName });
            },
            onComplete: (error) => {
              enqueue('done', { error });
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
  ACTIVE_SWARMS.set(sessionId, { stopped: false, abortController, interventionQueue: [] });

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
            enqueue('iteration', { current: iteration, max: config.maxIterations });
          },
          onToolCall: (agentId, toolName) => {
            enqueue('tool_call', { agentId, toolName });
          },
          onComplete: (error) => {
            enqueue('done', { error });
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

