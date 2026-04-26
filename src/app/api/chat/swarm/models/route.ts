import { NextResponse } from 'next/server';
import { getSwarmModelOptions } from '@/lib/swarm/swarm-model-resolver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/chat/swarm/models — List available models for the active provider */
export async function GET() {
  try {
    const options = getSwarmModelOptions();
    if (options.length === 0) {
      return NextResponse.json(
        { error: 'No provider configured. Please set up an AI provider in Settings.' },
        { status: 500 },
      );
    }
    return NextResponse.json({ models: options });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load models' },
      { status: 500 },
    );
  }
}
