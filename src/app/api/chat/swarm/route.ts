import { NextResponse } from 'next/server';
import type { SwarmConfig, SwarmState } from '@/types';

/** POST /api/chat/swarm — Start a new Swarm session */
export async function POST(req: Request) {
  try {
    const body: {
      sessionId: string;
      objective: string;
      config: SwarmConfig;
    } = await req.json();

    const { sessionId, objective, config } = body;

    if (!sessionId || !objective || !config) {
      return NextResponse.json(
        { error: 'sessionId, objective, and config are required' },
        { status: 400 },
      );
    }

    // For v1, we simply acknowledge the swarm session.
    // The actual agent execution happens through the normal chat endpoint.
    // The SwarmOrchestrationPanel manages the state client-side.
    // In future phases, this endpoint will:
    // 1. Spawn Planner agent via SDK query()
    // 2. Generate task pipeline
    // 3. Dispatch worker agents
    // 4. Run reviewer loop

    const swarmSession: Omit<SwarmState, 'agents' | 'tasks' | 'logs'> = {
      sessionId,
      active: true,
      config,
      currentIteration: 1,
      startedAt: Date.now(),
    };

    return NextResponse.json({
      swarmSession,
      message: 'Swarm session initialized',
    });
  } catch (error) {
    console.error('[swarm] Failed to start swarm:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start swarm' },
      { status: 500 },
    );
  }
}

/** GET /api/chat/swarm — Get current swarm state */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('sessionId');

  if (!sessionId) {
    return NextResponse.json(
      { error: 'sessionId is required' },
      { status: 400 },
    );
  }

  // v1: swarm state is managed client-side via SwarmManager
  return NextResponse.json({ active: false });
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

    // v1: acknowledge stop — actual cleanup is client-side
    return NextResponse.json({ message: 'Swarm session stopped' });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to stop swarm' },
      { status: 500 },
    );
  }
}
