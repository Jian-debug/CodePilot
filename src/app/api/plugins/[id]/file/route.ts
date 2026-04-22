import { NextRequest, NextResponse } from 'next/server';
import type { PluginInfo, ErrorResponse } from '@/types';
import { getPluginInfoList } from '@/lib/plugin-discovery';
import fs from 'fs';
import path from 'path';

function parsePluginId(rawId: string): { name: string; marketplace: string } | null {
  const decoded = decodeURIComponent(rawId);
  const atIdx = decoded.lastIndexOf('@');
  if (atIdx <= 0) return null;
  return {
    name: decoded.slice(0, atIdx),
    marketplace: decoded.slice(atIdx + 1),
  };
}

function findPlugin(plugins: PluginInfo[], name: string, marketplace: string): PluginInfo | undefined {
  return plugins.find((p) => p.name === name && p.marketplace === marketplace);
}

/** Sanitize a relative file path to prevent directory traversal. */
function sanitizeRelativePath(filePath: string): string {
  const cleaned = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
  if (cleaned.startsWith('..') || path.isAbsolute(cleaned)) {
    throw new Error('Invalid file path');
  }
  return cleaned;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<
  | { content: string; path: string; name: string; mimeType: string; isMarkdown: boolean; isCode: boolean }
  | ErrorResponse
>> {
  const { id } = await params;
  const parsed = parsePluginId(id);
  if (!parsed) {
    return NextResponse.json({ error: 'Invalid plugin ID format. Expected: name@marketplace' }, { status: 400 });
  }

  const cwd = _request.nextUrl.searchParams.get('cwd') || undefined;
  const filePath = _request.nextUrl.searchParams.get('path');
  if (!filePath) {
    return NextResponse.json({ error: 'Missing "path" query parameter' }, { status: 400 });
  }

  const plugins = getPluginInfoList(cwd);
  const plugin = findPlugin(plugins, parsed.name, parsed.marketplace);
  if (!plugin) {
    return NextResponse.json({ error: 'Plugin not found' }, { status: 404 });
  }

  let safePath: string;
  try {
    safePath = sanitizeRelativePath(filePath);
  } catch {
    return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
  }

  const fullPath = path.join(plugin.path, safePath);

  // Verify the resolved path is still within the plugin directory
  if (!fullPath.startsWith(plugin.path)) {
    return NextResponse.json({ error: 'Access denied: path outside plugin directory' }, { status: 403 });
  }

  if (!fs.existsSync(fullPath)) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const stat = fs.statSync(fullPath);

  // If directory, scan for readable files and return the first one's content
  if (stat.isDirectory()) {
    const children = fs.readdirSync(fullPath).map((name) => {
      const childStat = fs.statSync(path.join(fullPath, name));
      return { name, isDirectory: childStat.isDirectory() };
    });

    // Try to find and return the content of the first readable file
    const readableExts = ['.md', '.mdx', '.ts', '.tsx', '.js', '.jsx', '.py', '.json', '.yaml', '.yml', '.toml', '.txt', '.sh'];
    let fileContent = '';
    let firstFile = '';
    let isMarkdown = false;
    let isCode = false;

    for (const child of children) {
      if (child.isDirectory) continue;
      const ext = path.extname(child.name).toLowerCase();
      if (!readableExts.includes(ext)) continue;
      firstFile = child.name;
      fileContent = fs.readFileSync(path.join(fullPath, child.name), 'utf-8');
      isMarkdown = ext === '.md' || ext === '.mdx';
      isCode = !isMarkdown;
      break;
    }

    return NextResponse.json({
      content: fileContent,
      path: `${safePath}${firstFile ? '/' + firstFile : ''}`,
      name: path.basename(fullPath),
      mimeType: isMarkdown ? 'text/markdown' : isCode ? 'text/plain' : 'text/plain',
      isMarkdown,
      isCode,
      directory: true,
      children: children.map((c) => ({ name: c.name, isDirectory: c.isDirectory })),
    } as any);
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  const ext = path.extname(fullPath).toLowerCase();
  const isMarkdown = ext === '.md' || ext === '.mdx';
  const isCode = ['.ts', '.tsx', '.js', '.jsx', '.py', '.json', '.yaml', '.yml', '.toml', '.sh', '.bash'].includes(ext);

  return NextResponse.json({
    content,
    path: safePath,
    name: path.basename(fullPath),
    mimeType: isMarkdown ? 'text/markdown' : isCode ? `text/x-${ext.slice(1)}` : 'text/plain',
    isMarkdown,
    isCode,
  });
}
