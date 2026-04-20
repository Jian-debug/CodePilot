import { NextRequest, NextResponse } from 'next/server';
import type { PluginInfo, ErrorResponse, SuccessResponse } from '@/types';
import { getPluginInfoList, setPluginEnabled } from '@/lib/plugin-discovery';
import fs from 'fs';
import path from 'path';

/**
 * Plugin ID format: "name@marketplace" (URL-encoded in the path segment).
 * This matches the official Claude enabledPlugins key format.
 */
function parsePluginId(rawId: string): { name: string; marketplace: string } | null {
  const decoded = decodeURIComponent(rawId);
  const atIdx = decoded.lastIndexOf('@');
  if (atIdx <= 0) return null; // no @ or @ at start
  return {
    name: decoded.slice(0, atIdx),
    marketplace: decoded.slice(atIdx + 1),
  };
}

function findPlugin(plugins: PluginInfo[], name: string, marketplace: string): PluginInfo | undefined {
  return plugins.find((p) => p.name === name && p.marketplace === marketplace);
}

interface ContentItem {
  name: string;
  description: string;
}

function readContentItems(dir: string, subDir: string): ContentItem[] {
  const fullPath = path.join(dir, subDir);
  if (!fs.existsSync(fullPath)) return [];

  const items: ContentItem[] = [];
  try {
    const entries = fs.readdirSync(fullPath);
    for (const entry of entries) {
      const itemPath = path.join(fullPath, entry);
      if (!fs.statSync(itemPath).isDirectory()) continue;

      // Try to read description from skill/command/agent file
      const mdPath = path.join(itemPath, 'SKILL.md');
      const cmdPath = path.join(itemPath, 'CLAUDE.md');
      const agentPath = path.join(itemPath, 'agent.md');

      let description = '';
      const targetPath = fs.existsSync(mdPath) ? mdPath : fs.existsSync(cmdPath) ? cmdPath : fs.existsSync(agentPath) ? agentPath : null;
      if (targetPath) {
        const content = fs.readFileSync(targetPath, 'utf-8');
        // Extract first paragraph or description from frontmatter
        const descMatch = content.match(/description:\s*(.+)/);
        if (descMatch) {
          description = descMatch[1].trim();
        } else {
          const paraMatch = content.match(/^## .+\n\n(.+?)\n/);
          if (paraMatch) {
            description = paraMatch[1].trim().slice(0, 200);
          }
        }
      }

      items.push({ name: entry, description });
    }
  } catch {
    // ignore
  }
  return items;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<{ plugin: PluginInfo & { skills: ContentItem[]; commands: ContentItem[]; agents: ContentItem[] } } | ErrorResponse>> {
  const { id } = await params;
  const parsed = parsePluginId(id);

  if (!parsed) {
    return NextResponse.json(
      { error: 'Invalid plugin ID format. Expected: name@marketplace' },
      { status: 400 },
    );
  }

  // Accept optional cwd for project/local settings layer resolution
  const cwd = request.nextUrl.searchParams.get('cwd') || undefined;
  const plugins = getPluginInfoList(cwd);
  const plugin = findPlugin(plugins, parsed.name, parsed.marketplace);

  if (!plugin) {
    return NextResponse.json({ error: 'Plugin not found' }, { status: 404 });
  }

  // Read skills, commands, agents from plugin directory
  const skills = readContentItems(plugin.path, 'skills');
  const commands = readContentItems(plugin.path, 'commands');
  const agents = readContentItems(plugin.path, 'agents');

  return NextResponse.json({ plugin: { ...plugin, skills, commands, agents } });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<(SuccessResponse & { layer?: string; escalated?: boolean }) | ErrorResponse>> {
  try {
    const { id } = await params;
    const parsed = parsePluginId(id);

    if (!parsed) {
      return NextResponse.json(
        { error: 'Invalid plugin ID format. Expected: name@marketplace' },
        { status: 400 },
      );
    }

    const body = await request.json();
    const { enabled, cwd } = body as { enabled: boolean; cwd?: string };

    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'enabled must be a boolean' },
        { status: 400 },
      );
    }

    const plugins = getPluginInfoList(cwd);
    const plugin = findPlugin(plugins, parsed.name, parsed.marketplace);

    if (!plugin) {
      return NextResponse.json({ error: 'Plugin not found' }, { status: 404 });
    }

    if (plugin.blocked) {
      return NextResponse.json(
        { error: 'Plugin is blocked and cannot be enabled' },
        { status: 403 },
      );
    }

    const pluginKey = `${parsed.name}@${parsed.marketplace}`;
    const result = setPluginEnabled(pluginKey, enabled, cwd);
    return NextResponse.json({
      success: true,
      layer: result.layer,
      escalated: result.escalated,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update plugin' },
      { status: 500 },
    );
  }
}
