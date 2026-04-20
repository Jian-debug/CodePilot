import { NextRequest, NextResponse } from 'next/server';
import type { ErrorResponse } from '@/types';
import { readBlocklist } from '@/lib/plugin-discovery';

export async function GET(): Promise<NextResponse<{ blocked: string[] } | ErrorResponse>> {
  try {
    const blocked = readBlocklist();
    return NextResponse.json({ blocked: Array.from(blocked) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load blocklist' },
      { status: 500 },
    );
  }
}
