import { NextRequest, NextResponse } from 'next/server';
import type { SwarmConfig } from '@/types';
import { runAutonomousLoop } from '@/lib/swarm/autonomous-loop';

const runtime = 'nodejs';
const dynamic = 'force-dynamic';

/**
 * POST /api/chat/swarm — Start a Swarm session
 *
 * For autonomous topology, this runs the autonomous loop and streams
 * SSE events with progress updates. Other topologies (hierarchical,
 * sequential) return a placeholder for now.
 */
export async function POST(request: NextRequest) {
  try {
    const body: {
      sessionId: string;
      objective: string;
      config: SwarmConfig;
    } = await request.json();

    const { sessionId, objective, config } = body;

    if (!sessionId || !objective || !config) {
      return NextResponse.json(
        { error: 'sessionId, objective, and config are required' },
        { status: 400 },
      );
    }

    // For autonomous topology, run the loop and stream SSE
    if (config.topology === 'autonomous') {
      return runAutonomousSSE(sessionId, objective, config);
    }

    // Other topologies: return placeholder
    return NextResponse.json({
      message: `Topology '${config.topology}' not yet implemented. Only 'autonomous' is supported in v1.`,
      swarmSession: {
        sessionId,
        active: true,
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
): Response {
  const swarmSessionId = `swarm-${sessionId}-${Date.now()}`;
  let stopped = false;

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

      await runAutonomousLoop({
        sessionId,
        objective,
        config,
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
          onToolCall: (agentId) => {
            enqueue('tool_call', { agentId });
          },
          onComplete: (error) => {
            enqueue('done', { error });
            controller.close();
          },
          shouldStop: () => stopped,
        },
      });
    },

    cancel() {
      stopped = true;
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
    const body: { swarmSessionId: string } = await req.json();

    if (!body?.swarmSessionId) {
      return NextResponse.json(
        { error: 'swarmSessionId is required' },
        { status: 400 },
      );
    }

    // The actual stop happens via AbortController in the SSE stream.
    // For v1, the stream cancel() handler sets `stopped = true`.
    return NextResponse.json({ message: 'Swarm session stop requested' });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to stop swarm' },
      { status: 500 },
    );
  }
}
