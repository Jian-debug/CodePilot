import { NextRequest, NextResponse } from 'next/server';
import type { ErrorResponse, SuccessResponse } from '@/types';
import { readBlocklist, invalidatePluginCache } from '@/lib/plugin-discovery';
import fs from 'fs';
import path from 'path';
import os from 'os';

function getBlocklistPath(): string {
  return path.join(os.homedir(), '.claude', 'plugins', 'blocklist.json');
}

function readBlocklistFile() {
  const filePath = getBlocklistPath();
  if (!fs.existsSync(filePath)) {
    return { plugins: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return { plugins: [] };
  }
}

function writeBlocklistFile(data: { plugins: Array<{ plugin: string }> }) {
  const filePath = getBlocklistPath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

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

export async function POST(
  request: NextRequest,
): Promise<NextResponse<SuccessResponse | ErrorResponse>> {
  try {
    const body = await request.json();
    const { plugin } = body as { plugin: string };

    if (!plugin || typeof plugin !== 'string') {
      return NextResponse.json(
        { error: 'plugin key is required' },
        { status: 400 },
      );
    }

    const data = readBlocklistFile();
    if (!data.plugins.some((entry: { plugin: string }) => entry.plugin === plugin)) {
      data.plugins.push({ plugin });
      writeBlocklistFile(data);
    }

    invalidatePluginCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to add to blocklist' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<SuccessResponse | ErrorResponse>> {
  try {
    const { id } = await params;
    const pluginKey = decodeURIComponent(id);

    const data = readBlocklistFile();
    data.plugins = data.plugins.filter((entry: { plugin: string }) => entry.plugin !== pluginKey);
    writeBlocklistFile(data);

    invalidatePluginCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to remove from blocklist' },
      { status: 500 },
    );
  }
}
