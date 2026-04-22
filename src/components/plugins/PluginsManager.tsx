'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { IconComponent, PluginInfo } from '@/types';
import {
  MagnifyingGlass,
  Plug,
  CaretDown,
  CaretUp,
  Lightning,
  Terminal,
  GameController,
  Lock,
  ArrowRight,
  Info,
  X,
  SpinnerGap,
  Storefront,
  DownloadSimple,
  Clock,
  Bell,
  Folder,
  Code,
  Book,
  Gear,
  File,
  Desktop,
  Copy,
  ArrowSquareOut,
} from '@/components/ui/icon';

interface PluginSkillsInfo {
  name: string;
  description: string;
}

interface PluginCommandsInfo {
  name: string;
  description: string;
}

interface PluginAgentsInfo {
  name: string;
  description: string;
}

interface PluginDetailData extends PluginInfo {
  skills: PluginSkillsInfo[];
  commands: PluginCommandsInfo[];
  agents: PluginAgentsInfo[];
  /** Full directory scan including hooks, scripts, etc. */
  directories: Array<{ name: string; count: number; items: string[] }>;
}

interface MarketplacePlugin {
  id: string;
  name: string;
  description: string;
  author?: string;
  installed: boolean;
}

function parsePluginId(id: string): { name: string; marketplace: string } {
  const atIdx = id.lastIndexOf('@');
  return {
    name: id.slice(0, atIdx),
    marketplace: id.slice(atIdx + 1),
  };
}

/** Human-readable label for a plugin source */
function sourceLabel(marketplace: string): string {
  if (marketplace === 'external') return 'External';
  return marketplace
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Format ISO date to relative time string (e.g. "2 天前") */
function formatRelativeTime(isoDate?: string): string {
  if (!isoDate) return '';
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay} 天前`;
  const diffMon = Math.floor(diffDay / 30);
  return `${diffMon} 个月前`;
}

/** Directory key → display label and icon */
const DIR_META: Record<string, { label: string; icon: IconComponent }> = {
  skills: { label: 'Skills', icon: Lightning },
  commands: { label: 'Commands', icon: Terminal },
  agents: { label: 'Agents', icon: GameController },
  hooks: { label: 'Hooks', icon: Bell },
  scripts: { label: 'Scripts', icon: Code },
  modes: { label: 'Modes', icon: Folder },
  docs: { label: 'Docs', icon: Book },
  packages: { label: 'Packages', icon: Folder },
  ui: { label: 'UI', icon: Desktop },
  tests: { label: 'Tests', icon: Gear },
};

type ViewTab = 'installed' | 'marketplace';

export function PluginsManager() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewTab, setViewTab] = useState<ViewTab>('installed');
  const [search, setSearch] = useState('');
  const [blocklist, setBlocklist] = useState<Set<string>>(new Set());
  const [showBlocklist, setShowBlocklist] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Marketplace state
  const [marketplaceResults, setMarketplaceResults] = useState<MarketplacePlugin[]>([]);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceSearch, setMarketplaceSearch] = useState('');
  const [selectedMarketPlugin, setSelectedMarketPlugin] = useState<MarketplacePlugin | null>(null);
  const [installLog, setInstallLog] = useState<string>('');
  const [installing, setInstalling] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Detail panel
  const [selectedPlugin, setSelectedPlugin] = useState<PluginDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // File preview dialog
  const [filePreview, setFilePreview] = useState<{ path: string; name: string; content: string; isMarkdown: boolean; directory?: boolean; children?: { name: string; isDirectory: boolean }[] } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const handleOpenFile = useCallback(async (dirName: string, itemName: string) => {
    setPreviewLoading(true);
    try {
      const filePath = `${dirName}/${itemName}`;
      const pluginKey = `${selectedPlugin?.name}@${selectedPlugin?.marketplace}`;
      const res = await fetch(`/api/plugins/${encodeURIComponent(pluginKey)}/file?path=${encodeURIComponent(filePath)}`);
      if (!res.ok) throw new Error('Failed to load file');
      const data = await res.json();
      setFilePreview({ path: data.path, name: data.name, content: data.content, isMarkdown: data.isMarkdown, directory: data.directory, children: data.children });
    } catch (e) {
      console.error('Failed to load file:', e);
    } finally {
      setPreviewLoading(false);
    }
  }, [selectedPlugin]);

  const fetchPlugins = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins');
      if (res.ok) {
        const data = await res.json();
        setPlugins(data.plugins || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchBlocklist = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/blocklist');
      if (res.ok) {
        const data = await res.json();
        setBlocklist(new Set(data.blocked || []));
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchPlugins();
    fetchBlocklist();
  }, [fetchPlugins, fetchBlocklist]);

  // Marketplace search
  useEffect(() => {
    if (viewTab !== 'marketplace') return;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setMarketplaceResults([...uniquePlugins.values()].map((p) => ({
        id: `${p.name}@${p.marketplace}`,
        name: p.name,
        description: p.description,
        author: p.author?.name,
        installed: true,
      })));
    }, 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [marketplaceSearch, viewTab, plugins]);

  const fetchPluginDetail = useCallback(async (plugin: PluginInfo) => {
    setDetailLoading(true);
    try {
      const encodedId = encodeURIComponent(`${plugin.name}@${plugin.marketplace}`);
      const res = await fetch(`/api/plugins/${encodedId}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedPlugin({
          ...data.plugin,
          skills: data.plugin.skills || [],
          commands: data.plugin.commands || [],
          agents: data.plugin.agents || [],
        });
      }
    } catch {
      // ignore
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleToggle = useCallback(async (plugin: PluginInfo, enabled: boolean) => {
    const id = `${plugin.name}@${plugin.marketplace}`;
    setActionLoading(id);
    try {
      const encodedId = encodeURIComponent(id);
      const res = await fetch(`/api/plugins/${encodedId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        setPlugins((prev) =>
          prev.map((p) =>
            p.name === plugin.name && p.marketplace === plugin.marketplace
              ? { ...p, enabled }
              : p
          )
        );
        if (selectedPlugin?.name === plugin.name && selectedPlugin?.marketplace === plugin.marketplace) {
          setSelectedPlugin((prev) => prev ? { ...prev, enabled } : null);
        }
      }
    } catch {
      // ignore
    } finally {
      setActionLoading(null);
    }
  }, [selectedPlugin]);

  const handleBlock = useCallback(async (plugin: PluginInfo) => {
    const pluginKey = `${plugin.name}@${plugin.marketplace}`;
    setActionLoading(pluginKey);
    try {
      const res = await fetch('/api/plugins/blocklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plugin: pluginKey }),
      });
      if (res.ok) {
        setBlocklist((prev) => new Set(prev).add(pluginKey));
        setPlugins((prev) =>
          prev.map((p) =>
            p.name === plugin.name && p.marketplace === plugin.marketplace
              ? { ...p, blocked: true, enabled: false }
              : p
          )
        );
      }
    } catch {
      // ignore
    } finally {
      setActionLoading(null);
    }
  }, []);

  const handleUnblock = useCallback(async (pluginKey: string) => {
    setActionLoading(pluginKey);
    try {
      const res = await fetch(`/api/plugins/blocklist/${encodeURIComponent(pluginKey)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setBlocklist((prev) => {
          const next = new Set(prev);
          next.delete(pluginKey);
          return next;
        });
        const { name, marketplace } = parsePluginId(pluginKey);
        setPlugins((prev) =>
          prev.map((p) =>
            p.name === name && p.marketplace === marketplace
              ? { ...p, blocked: false }
              : p
          )
        );
      }
    } catch {
      // ignore
    } finally {
      setActionLoading(null);
    }
  }, []);

  const handleInstall = useCallback(async (pluginName: string) => {
    setInstalling(true);
    setInstallLog('');
    try {
      const res = await fetch('/api/plugins/marketplace/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: pluginName, global: true }),
      });
      if (!res.ok) {
        const data = await res.json();
        setInstallLog(`Error: ${data.error || 'Install failed'}`);
        setInstalling(false);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (reader) {
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = JSON.parse(line.slice(6));
              setInstallLog((prev) => prev + data + '\n');
            }
            if (line.startsWith('event: done')) {
              setInstallLog((prev) => prev + 'Install completed!\n');
              fetchPlugins();
              setInstalling(false);
              return;
            }
            if (line.startsWith('event: error')) {
              setInstallLog((prev) => prev + line.slice(6) + '\n');
              setInstalling(false);
              return;
            }
          }
        }
      }
    } catch (err) {
      setInstallLog(`Error: ${err instanceof Error ? err.message : 'Install failed'}`);
    }
    setInstalling(false);
  }, [fetchPlugins]);

  const handleUninstall = useCallback(async (pluginName: string) => {
    setInstalling(true);
    setInstallLog('');
    try {
      const res = await fetch('/api/plugins/marketplace/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plugin: pluginName, global: true }),
      });
      if (!res.ok) {
        const data = await res.json();
        setInstallLog(`Error: ${data.error || 'Remove failed'}`);
        setInstalling(false);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (reader) {
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = JSON.parse(line.slice(6));
              setInstallLog((prev) => prev + data + '\n');
            }
            if (line.startsWith('event: done')) {
              setInstallLog((prev) => prev + 'Uninstall completed!\n');
              fetchPlugins();
              setInstalling(false);
              return;
            }
            if (line.startsWith('event: error')) {
              setInstallLog((prev) => prev + line.slice(6) + '\n');
              setInstalling(false);
              return;
            }
          }
        }
      }
    } catch (err) {
      setInstallLog(`Error: ${err instanceof Error ? err.message : 'Remove failed'}`);
    }
    setInstalling(false);
  }, [fetchPlugins]);

  // Deduplicate plugins by name@marketplace, then filter by search
  const uniquePlugins = plugins.reduce<Map<string, PluginInfo>>((map, p) => {
    const key = `${p.name}@${p.marketplace}`;
    const existing = map.get(key);
    if (!existing || p.skillCount > (existing.skillCount || 0)) {
      map.set(key, p);
    }
    return map;
  }, new Map());

  const filteredPlugins = [...uniquePlugins.values()].filter((p) => {
    return (
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase())
    );
  }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const pluginsCount = plugins.filter((p) => p.location === 'plugins').length;
  const externalCount = plugins.filter((p) => p.location === 'external_plugins').length;

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <span className="text-sm text-muted-foreground">Loading plugins...</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Fixed header */}
      <div className="shrink-0 border-b border-border/50 px-6 pt-4 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Plugins</h1>
            <p className="text-sm text-muted-foreground mt-1">{plugins.length} plugins installed</p>
          </div>
        </div>
        {/* Segmented control */}
        <div className="flex items-center bg-muted rounded-md p-0.5 mt-3 w-fit">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "px-3 py-1 text-xs font-medium rounded h-auto",
              viewTab === "installed"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => { setViewTab('installed'); setSelectedPlugin(null); }}
          >
            Installed ({plugins.length})
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "px-3 py-1 text-xs font-medium rounded h-auto",
              viewTab === "marketplace"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setViewTab('marketplace')}
          >
            <Storefront size={14} className="mr-1" />
            Marketplace
          </Button>
        </div>
      </div>

      {/* Marketplace view */}
      {viewTab === 'marketplace' ? (
        <div className="flex flex-1 min-h-0">
          {/* Left: search + results */}
          <div className="w-72 shrink-0 flex flex-col overflow-hidden border-r border-border/50">
            <div className="px-3 pt-3 pb-2">
              <div className="relative">
                <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search marketplace..."
                  value={marketplaceSearch}
                  onChange={(e) => setMarketplaceSearch(e.target.value)}
                  className="pl-8 h-8 text-sm"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0 p-2">
              {marketplaceResults.length === 0 && !marketplaceLoading ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                  <Storefront size={32} className="opacity-40" />
                  <p className="text-xs">No marketplace results</p>
                </div>
              ) : (
                marketplaceResults.map((mp) => (
                  <button
                    key={mp.id}
                    onClick={() => setSelectedMarketPlugin(mp)}
                    className={`w-full text-left px-3 py-2.5 rounded-md transition-colors hover:bg-accent/50 mb-1 ${
                      selectedMarketPlugin?.id === mp.id ? 'bg-accent' : ''
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <Plug size={13} className="text-muted-foreground shrink-0" />
                      <span className="text-sm font-medium truncate">{mp.name}</span>
                      {mp.installed && (
                        <Badge variant="outline" className="text-[10px] h-4 px-1 shrink-0">Installed</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{mp.description}</p>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Right: detail + install */}
          <div className="flex-1 min-w-0 overflow-hidden">
            {selectedMarketPlugin ? (
              <div className="flex flex-col h-full overflow-hidden">
                <div className="shrink-0 border-b border-border/50 px-6 pt-4 pb-3">
                  <div className="flex items-center gap-2">
                    <Plug size={18} className="text-muted-foreground" />
                    <h2 className="text-lg font-semibold">{selectedMarketPlugin.name}</h2>
                    {selectedMarketPlugin.installed && (
                      <Badge variant="outline">Installed</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{selectedMarketPlugin.description}</p>
                  <div className="flex items-center gap-2 mt-3">
                    {!selectedMarketPlugin.installed ? (
                      <Button
                        size="sm"
                        disabled={installing}
                        onClick={() => handleInstall(selectedMarketPlugin.name)}
                        className="gap-1"
                      >
                        <DownloadSimple size={14} />
                        Install
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={installing}
                        onClick={() => handleUninstall(selectedMarketPlugin.name)}
                        className="gap-1"
                      >
                        <X size={14} />
                        Uninstall
                      </Button>
                    )}
                  </div>
                  {installLog && (
                    <div className="mt-3 rounded-md bg-muted p-3 max-h-40 overflow-auto">
                      <pre className="text-xs font-mono whitespace-pre-wrap">{installLog}</pre>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
                <Storefront size={48} className="opacity-30" />
                <div className="text-center">
                  <p className="text-sm font-medium">Browse marketplace</p>
                  <p className="text-xs">Search and install plugins</p>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Installed plugins view */
        <div className="flex flex-1 min-h-0">
          {/* Left: grouped plugin list */}
          <div className="w-80 shrink-0 flex flex-col overflow-hidden border-r border-border/50">
            {/* Search and blocklist toggle */}
            <div className="shrink-0 px-4 pt-3 pb-2">
              <div className="flex items-center justify-between">
                <div className="relative flex-1 mr-2">
                  <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search plugins..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-8 h-8 text-sm"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`h-8 w-8 p-0 shrink-0 ${showBlocklist ? 'bg-accent' : ''}`}
                  onClick={() => setShowBlocklist(!showBlocklist)}
                  title="Blocklist"
                >
                  <Lock size={16} />
                </Button>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto min-h-0 p-2">
              {showBlocklist ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground px-2 py-1">Blocked Plugins</p>
                  {blocklist.size === 0 ? (
                    <div className="flex flex-col items-center py-8 text-muted-foreground gap-2">
                      <Lock size={24} className="opacity-40" />
                      <p className="text-xs">No blocked plugins</p>
                    </div>
                  ) : (
                    Array.from(blocklist).map((key) => {
                      const { name, marketplace } = parsePluginId(key);
                      return (
                        <div key={key} className="flex items-center justify-between px-3 py-2 rounded-md bg-accent/50">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{name}</p>
                            <p className="text-xs text-muted-foreground">{marketplace}</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={actionLoading === key}
                            onClick={() => handleUnblock(key)}
                            className="h-7 w-7 p-0 shrink-0"
                          >
                            <X size={14} />
                          </Button>
                        </div>
                      );
                    })
                  )}
                </div>
              ) : filteredPlugins.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                  <Plug size={32} className="opacity-40" />
                  <p className="text-xs">{plugins.length === 0 ? 'No plugins found' : 'No matching plugins'}</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredPlugins.map((plugin) => {
                    const id = `${plugin.name}@${plugin.marketplace}`;
                    const isLoading = actionLoading === id;
                    return (
                      <button
                        key={id}
                        onClick={() => fetchPluginDetail(plugin)}
                        className={`w-full text-left px-3 py-2.5 rounded-md transition-colors hover:bg-accent/50 ${
                          selectedPlugin?.name === plugin.name && selectedPlugin?.marketplace === plugin.marketplace
                            ? 'bg-accent'
                            : ''
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Plug size={13} className="text-muted-foreground shrink-0" />
                              <span className="text-sm font-medium truncate">{plugin.name}</span>
                              {plugin.version && (
                                <Badge variant="outline" className="text-[10px] h-4 px-1">v{plugin.version}</Badge>
                              )}
                              <Badge variant="outline" className="text-[10px] h-4 px-1">{sourceLabel(plugin.marketplace)}</Badge>
                              {plugin.blocked && (
                                <Badge variant="destructive" className="text-[10px] h-4 px-1">Blocked</Badge>
                              )}
                              {plugin.scope === 'project' && (
                                <Badge variant="outline" className="text-[10px] h-4 px-1">Project</Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{plugin.description}</p>
                            {/* Directory badges */}
                            {plugin.directories?.length > 0 && (
                              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                {plugin.directories.map((dir) => {
                                  const meta = DIR_META[dir.name];
                                  if (!meta) return null;
                                  const Icon = meta.icon;
                                  return (
                                    <Badge key={dir.name} variant="secondary" className="text-[10px] h-4 px-1 gap-0.5">
                                      <Icon size={9} />{dir.count} {meta.label}
                                    </Badge>
                                  );
                                })}
                              </div>
                            )}
                            {/* Item name tags */}
                            {plugin.directories?.some((d) => d.items?.length > 0) && (
                              <div className="flex items-center gap-1 mt-1 flex-wrap">
                                {plugin.directories.flatMap((dir) =>
                                  (dir.items || []).slice(0, 3).map((item) => (
                                    <span key={`${dir.name}-${item}`} className="text-[10px] px-1 py-0 rounded bg-muted/60 text-muted-foreground truncate max-w-[100px]" title={item}>
                                      {dir.name === 'commands' ? `/${item}` : item}
                                    </span>
                                  )),
                                )}
                                {plugin.directories.reduce((sum, d) => sum + (d.items?.length || 0), 0) > 9 && (
                                  <span className="text-[10px] text-muted-foreground">+more</span>
                                )}
                              </div>
                            )}
                            {/* Last updated & installed time */}
                            {(plugin.lastUpdated || plugin.installedAt) && (
                              <div className="flex items-center gap-2 mt-1 text-muted-foreground">
                                {plugin.installedAt && (
                                  <span className="text-[10px] flex items-center gap-0.5" title={`安装于 ${plugin.installedAt}`}>
                                    <DownloadSimple size={9} />{formatRelativeTime(plugin.installedAt)}
                                  </span>
                                )}
                                {plugin.lastUpdated && (
                                  <span className="text-[10px] flex items-center gap-0.5" title={`更新于 ${plugin.lastUpdated}`}>
                                    <Clock size={9} />{formatRelativeTime(plugin.lastUpdated)}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          {!plugin.blocked && (
                            <Switch
                              checked={plugin.enabled}
                              disabled={isLoading}
                              onClick={(e) => e.stopPropagation()}
                              onCheckedChange={(checked) => handleToggle(plugin, checked)}
                            />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right: detail panel */}
          <div className="flex-1 min-w-0 overflow-hidden">
            {detailLoading ? (
              <div className="flex h-full items-center justify-center">
                <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
              </div>
            ) : selectedPlugin ? (
              <PluginDetailView
                plugin={selectedPlugin}
                onClose={() => setSelectedPlugin(null)}
                onToggle={handleToggle}
                onBlock={handleBlock}
                onOpenFile={handleOpenFile}
                actionLoading={actionLoading}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
                <Plug size={48} className="opacity-30" />
                <div className="text-center">
                  <p className="text-sm font-medium">No plugin selected</p>
                  <p className="text-xs">Select a plugin from the list to view details</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* File preview dialog */}
      <Dialog open={!!filePreview || previewLoading} onOpenChange={(open) => { if (!open) setFilePreview(null); }}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <File size={16} className="text-muted-foreground" />
              {filePreview?.name || 'Loading...'}
            </DialogTitle>
            {filePreview && (
              <DialogDescription className="font-mono text-xs truncate">
                {filePreview.path}
                {filePreview.directory && ' (directory)'}
              </DialogDescription>
            )}
          </DialogHeader>
          {previewLoading && !filePreview ? (
            <div className="flex items-center justify-center py-12">
              <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
              <span className="ml-2 text-xs text-muted-foreground">Loading file...</span>
            </div>
          ) : filePreview ? (
            <div className="overflow-hidden">
              {/* Directory file list */}
              {filePreview.directory && filePreview.children && filePreview.children.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3 pb-2">
                  {filePreview.children.map((child) => (
                    <Badge key={child.name} variant={child.isDirectory ? 'secondary' : 'outline'} className="text-[10px]">
                      {child.isDirectory ? '📁' : '📄'} {child.name}
                    </Badge>
                  ))}
                </div>
              )}
              {/* File content */}
              {filePreview.content ? (
                <pre className="text-xs font-mono whitespace-pre-wrap overflow-auto max-h-[50vh] leading-relaxed">{filePreview.content}</pre>
              ) : (
                <div className="py-12 text-center text-sm text-muted-foreground">No readable files found in this directory</div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PluginDetailView({
  plugin,
  onClose,
  onToggle,
  onBlock,
  onOpenFile,
  actionLoading,
}: {
  plugin: PluginDetailData;
  onClose: () => void;
  onToggle: (plugin: PluginInfo, enabled: boolean) => void;
  onBlock: (plugin: PluginInfo) => void;
  onOpenFile: (dirName: string, itemName: string) => void;
  actionLoading: string | null;
}) {
  const [expanded, setExpanded] = useState<string | null>('skills');
  const isLoading = actionLoading === `${plugin.name}@${plugin.marketplace}`;

  // Compute total stats from directories
  const totalItems = (plugin.directories || []).reduce((sum, d) => sum + d.count, 0);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border/50 px-6 pt-4 pb-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Plug size={18} className="text-muted-foreground" />
              <h2 className="text-lg font-semibold">{plugin.name}</h2>
              {plugin.version && (
                <Badge variant="outline" className="text-xs">v{plugin.version}</Badge>
              )}
              {plugin.scope === 'project' && (
                <Badge variant="outline" className="text-xs">Project</Badge>
              )}
              {plugin.blocked && (
                <Badge variant="destructive">Blocked</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1">{plugin.description}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Badge variant="outline">{sourceLabel(plugin.marketplace)}</Badge>
              {plugin.installedAt && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <DownloadSimple size={11} />{formatRelativeTime(plugin.installedAt)}安装
                </span>
              )}
              {plugin.lastUpdated && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock size={11} />{formatRelativeTime(plugin.lastUpdated)}更新
                </span>
              )}
              {!plugin.blocked && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{plugin.enabled ? '已启用' : '已禁用'}</span>
                  <Switch checked={plugin.enabled} disabled={isLoading} onCheckedChange={(checked) => onToggle(plugin, checked)} />
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {!plugin.blocked && (
              <Button
                variant="ghost"
                size="sm"
                disabled={actionLoading === `${plugin.name}@${plugin.marketplace}`}
                onClick={() => onBlock(plugin)}
                className="h-8 gap-1 text-xs text-destructive hover:text-destructive"
              >
                <Lock size={14} />
                Block
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
              <X size={16} />
            </Button>
          </div>
        </div>

        {/* Stats summary */}
        {totalItems > 0 && (
          <div className="flex gap-3 mt-3 flex-wrap">
            {(plugin.directories || []).map((dir) => {
              const meta = DIR_META[dir.name];
              if (!meta || dir.count === 0) return null;
              const Icon = meta.icon;
              return (
                <div key={dir.name} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/50 text-xs">
                  <Icon size={13} className="text-muted-foreground" />
                  <span className="font-medium">{dir.count}</span>
                  <span className="text-muted-foreground">{meta.label}</span>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-xs text-muted-foreground font-mono mt-3 truncate">{plugin.path}</p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0 p-6">
        <div className="space-y-4">
          {/* Dynamic directory sections */}
          {plugin.directories?.map((dir) => {
            const meta = DIR_META[dir.name];
            if (!meta) return null;
            const dirItems = dir.name === 'skills'
              ? plugin.skills
              : dir.name === 'commands'
                ? plugin.commands
                : dir.name === 'agents'
                  ? plugin.agents
                  : (dir.items || []).map((name) => ({ name, description: '' }));
            return (
              <PluginSection
                key={dir.name}
                title={meta.label}
                icon={meta.icon}
                items={dirItems}
                expanded={expanded === dir.name}
                onToggle={() => setExpanded(expanded === dir.name ? null : dir.name)}
                onOpenItem={(itemName) => onOpenFile(dir.name, itemName)}
              />
            );
          })}

          {(!plugin.directories || plugin.directories.length === 0) && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <Info size={24} className="opacity-40" />
              <p className="text-xs">No content directories found</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PluginSection({
  title,
  icon: Icon,
  items,
  expanded,
  onToggle,
  onOpenItem,
}: {
  title: string;
  icon: React.ElementType;
  items: { name: string; description: string }[];
  expanded: boolean;
  onToggle: () => void;
  onOpenItem?: (name: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader
        className="flex flex-row items-center justify-between space-y-0 py-3 cursor-pointer hover:bg-accent/50"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2">
          <Icon size={16} className="text-muted-foreground" />
          <CardTitle className="text-sm">{title}</CardTitle>
          <Badge variant="outline" className="text-xs">{items.length}</Badge>
        </div>
        {expanded ? <CaretUp size={16} /> : <CaretDown size={16} />}
      </CardHeader>
      {expanded && (
        <CardContent className="pt-0 pb-3">
          <div className="space-y-2">
            {items.map((item) => (
              <button
                key={item.name}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenItem?.(item.name);
                }}
                className="w-full flex items-start gap-2 px-3 py-2 rounded-md bg-muted/50 hover:bg-muted transition-colors text-left"
              >
                <ArrowRight size={12} className="text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{item.name}</p>
                  {item.description && (
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
