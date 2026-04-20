'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  MagnifyingGlass,
  Plug,
  Globe,
  FolderOpen,
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
} from '@/components/ui/icon';
import type { PluginInfo } from '@/types';

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

type ViewTab = 'installed' | 'marketplace';

export function PluginsManager() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewTab, setViewTab] = useState<ViewTab>('installed');
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'plugins' | 'external'>('all');
  const [selectedPlugin, setSelectedPlugin] = useState<PluginDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
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
      // For now, show installed plugins as marketplace results
      // In a full implementation, this would call an external marketplace API
      setMarketplaceResults(plugins.map((p) => ({
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

      // Read SSE stream
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

  const filtered = plugins.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase());
    if (sourceFilter === 'all') return matchesSearch;
    return matchesSearch && p.location === sourceFilter;
  });

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
            <p className="text-sm text-muted-foreground mt-1">Manage plugins containing skills, commands, and agents</p>
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
          {/* Left: plugin list */}
          <div className="w-80 shrink-0 flex flex-col overflow-hidden border-r border-border/50">
            {/* Search and filters */}
            <div className="shrink-0 px-4 pt-3 pb-2">
              <div className="flex items-center justify-between mb-2">
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
              <Tabs value={sourceFilter} onValueChange={(v) => setSourceFilter(v as typeof sourceFilter)}>
                <TabsList className="w-full">
                  <TabsTrigger value="all" className="flex-1 text-xs">All ({plugins.length})</TabsTrigger>
                  <TabsTrigger value="plugins" className="flex-1 text-xs">
                    <Globe size={12} className="mr-1" />Market ({pluginsCount})
                  </TabsTrigger>
                  <TabsTrigger value="external" className="flex-1 text-xs">
                    <FolderOpen size={12} className="mr-1" />External ({externalCount})
                  </TabsTrigger>
                </TabsList>
              </Tabs>
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
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                  <Plug size={32} className="opacity-40" />
                  <p className="text-xs">{plugins.length === 0 ? 'No plugins found' : 'No matching plugins'}</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {filtered.map((plugin) => {
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
                            <div className="flex items-center gap-1.5">
                              <Plug size={13} className="text-muted-foreground shrink-0" />
                              <span className="text-sm font-medium truncate">{plugin.name}</span>
                              {plugin.blocked && (
                                <Badge variant="destructive" className="text-[10px] h-4 px-1">Blocked</Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{plugin.description}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge variant="outline" className="text-[10px] h-4 px-1">
                                {plugin.marketplace === 'external' ? 'External' : plugin.marketplace}
                              </Badge>
                              {plugin.hasSkills && (
                                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                  <Lightning size={10} />Skills
                                </span>
                              )}
                              {plugin.hasCommands && (
                                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                  <Terminal size={10} />Commands
                                </span>
                              )}
                              {plugin.hasAgents && (
                                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                  <GameController size={10} />Agents
                                </span>
                              )}
                            </div>
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
              <PluginDetailView plugin={selectedPlugin} onClose={() => setSelectedPlugin(null)} onToggle={handleToggle} onBlock={handleBlock} actionLoading={actionLoading} />
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
    </div>
  );
}

function PluginDetailView({
  plugin,
  onClose,
  onToggle,
  onBlock,
  actionLoading,
}: {
  plugin: PluginDetailData;
  onClose: () => void;
  onToggle: (plugin: PluginInfo, enabled: boolean) => void;
  onBlock: (plugin: PluginInfo) => void;
  actionLoading: string | null;
}) {
  const [expanded, setExpanded] = useState<'skills' | 'commands' | 'agents' | null>('skills');
  const isLoading = actionLoading === `${plugin.name}@${plugin.marketplace}`;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border/50 px-6 pt-4 pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Plug size={18} className="text-muted-foreground" />
              <h2 className="text-lg font-semibold">{plugin.name}</h2>
              {plugin.blocked && (
                <Badge variant="destructive">Blocked</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1">{plugin.description}</p>
            <div className="flex items-center gap-2 mt-2">
              <Badge variant="outline">{plugin.marketplace === 'external' ? 'External' : plugin.marketplace}</Badge>
              {!plugin.blocked && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{plugin.enabled ? 'Enabled' : 'Disabled'}</span>
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
        <p className="text-xs text-muted-foreground font-mono mt-2 truncate">{plugin.path}</p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0 p-6">
        <div className="space-y-4">
          {/* Skills */}
          <PluginSection
            title="Skills"
            icon={Lightning}
            items={plugin.skills}
            expanded={expanded === 'skills'}
            onToggle={() => setExpanded(expanded === 'skills' ? null : 'skills')}
          />

          {/* Commands */}
          <PluginSection
            title="Commands"
            icon={Terminal}
            items={plugin.commands}
            expanded={expanded === 'commands'}
            onToggle={() => setExpanded(expanded === 'commands' ? null : 'commands')}
          />

          {/* Agents */}
          <PluginSection
            title="Agents"
            icon={GameController}
            items={plugin.agents}
            expanded={expanded === 'agents'}
            onToggle={() => setExpanded(expanded === 'agents' ? null : 'agents')}
          />

          {plugin.skills.length === 0 && plugin.commands.length === 0 && plugin.agents.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <Info size={24} className="opacity-40" />
              <p className="text-xs">No skills, commands, or agents found</p>
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
}: {
  title: string;
  icon: React.ElementType;
  items: { name: string; description: string }[];
  expanded: boolean;
  onToggle: () => void;
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
              <div key={item.name} className="flex items-start gap-2 px-3 py-2 rounded-md bg-muted/50">
                <ArrowRight size={12} className="text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{item.name}</p>
                  {item.description && (
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
