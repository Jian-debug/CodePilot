/**
 * Plugin Discovery Layer — scans marketplace and external plugin directories,
 * reads plugin manifests, and provides enable/disable state that reads and writes
 * the official Claude `enabledPlugins` config.
 *
 * Enable state resolution reads user + project + local settings layers to match
 * the SDK's own `settingSources: ['user', 'project', 'local']` resolution.
 *
 * Write strategy:
 *   - Default target: user-level ~/.claude/settings.json (matches `claude plugin enable/disable`).
 *   - When a higher-priority layer (project or local) would override the user-level write
 *     and prevent the desired state from taking effect, the write is escalated to the
 *     local layer (.claude/settings.local.json in cwd) which has highest priority and
 *     is gitignored. This requires a cwd parameter.
 *
 * Plugin loading into SDK sessions is handled by the SDK itself —
 * CodePilot does NOT explicitly inject plugins via queryOptions.plugins.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import type { PluginInfo } from '@/types';

// ==========================================
// Types
// ==========================================

interface PluginManifest {
  name: string;
  version?: string;
  description?: string;
  author?: { name: string; url?: string };
  commands?: unknown;
  skills?: unknown;
  agents?: unknown;
}

interface BlocklistEntry {
  plugin: string; // "name@marketplace"
}

interface Blocklist {
  plugins: BlocklistEntry[];
}

interface PluginDirectoryEntry {
  name: string;
  count: number;
  items: string[];
}

interface DiscoveredPlugin {
  name: string;
  description: string;
  author?: { name: string; url?: string };
  path: string;
  marketplace: string;
  location: 'plugins' | 'external_plugins' | 'cache';
  hasCommands: boolean;
  hasSkills: boolean;
  hasAgents: boolean;
  hasHooks: boolean;
  skillCount: number;
  commandCount: number;
  agentCount: number;
  hookCount: number;
  skillNames: string[];
  commandNames: string[];
  agentNames: string[];
  hookNames: string[];
  directories: PluginDirectoryEntry[];
  version?: string;
  lastUpdated?: string;
  installedAt?: string;
  scope?: 'user' | 'project';
}

/**
 * Read installed_plugins.json — the authoritative record of installed plugins.
 * Format: { "marketplace-name": { source: { source, repo? }, installLocation, lastUpdated } }
 */
interface InstalledPluginEntry {
  source: { source: string; repo?: string; path?: string };
  installLocation: string;
  lastUpdated?: string;
}

interface KnownPluginVersionEntry {
  scope: 'user' | 'project';
  projectPath?: string;
  installPath: string;
  version: string;
  installedAt: string;
  lastUpdated: string;
  gitCommitSha: string;
}

interface KnownMarketplacesData {
  version: number;
  plugins: Record<string, KnownPluginVersionEntry[]>;
}

function readInstalledPlugins(): Record<string, InstalledPluginEntry> {
  const installedPath = path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json');
  return readJsonFile(installedPath) as Record<string, InstalledPluginEntry>;
}

function readKnownMarketplaces(): KnownMarketplacesData {
  const kmPath = path.join(os.homedir(), '.claude', 'plugins', 'known_marketplaces.json');
  return readJsonFile(kmPath) as unknown as KnownMarketplacesData;
}

/**
 * Extract version from a cache install path like:
 *   ~/.claude/plugins/cache/{market}/{plugin}/{version}/
 * Falls back to checking installed_plugins.json for the marketplace entry.
 */
function extractVersionFromCache(pluginName: string, marketplace: string): { version?: string; lastUpdated?: string; scope?: string } {
  const cacheDir = path.join(os.homedir(), '.claude', 'plugins', 'cache');
  if (!fs.existsSync(cacheDir)) return {};

  // Try: cache/{marketplace}/{pluginName}/{version}/
  const pluginCacheDir = path.join(cacheDir, marketplace, pluginName);
  if (fs.existsSync(pluginCacheDir)) {
    try {
      const versions = fs.readdirSync(pluginCacheDir);
      for (const ver of versions) {
        const verDir = path.join(pluginCacheDir, ver);
        if (fs.statSync(verDir).isDirectory() && /^\d+\./.test(ver)) {
          return { version: ver };
        }
      }
    } catch { /* ignore */ }
  }

  // Also try: cache/{marketplace}/{version}/ (flat, no plugin sub-dir)
  const flatCacheDir = path.join(cacheDir, marketplace);
  if (fs.existsSync(flatCacheDir)) {
    try {
      const entries = fs.readdirSync(flatCacheDir);
      for (const entry of entries) {
        const entryDir = path.join(flatCacheDir, entry);
        if (!fs.statSync(entryDir).isDirectory()) continue;
        if (/^\d+\./.test(entry)) {
          return { version: entry };
        }
        // Check sub-entries for version
        try {
          const subEntries = fs.readdirSync(entryDir);
          for (const sub of subEntries) {
            const subDir = path.join(entryDir, sub);
            if (fs.statSync(subDir).isDirectory() && /^\d+\./.test(sub)) {
              return { version: sub };
            }
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  return {};
}

/** Enrich a DiscoveredPlugin with version and metadata from installed_plugins.json and known_marketplaces.json */
function enrichPluginMetadata(plugin: DiscoveredPlugin, installed: Record<string, InstalledPluginEntry>, known: KnownMarketplacesData): void {
  // Try to find matching entry in known_marketplaces.json
  // Keys are like "superpowers@superpowers-marketplace" or "claude-mem@thedotmack"
  const pluginKey = `${plugin.name}@${plugin.marketplace}`;
  const knownEntry = known.plugins?.[pluginKey];
  if (knownEntry && knownEntry.length > 0) {
    const latest = knownEntry[0]; // first entry is typically the latest
    plugin.version = latest.version;
    plugin.lastUpdated = latest.lastUpdated;
    plugin.installedAt = latest.installedAt;
    plugin.scope = latest.scope;
    return;
  }

  // Fallback: try to extract version from cache directory
  const verInfo = extractVersionFromCache(plugin.name, plugin.marketplace);
  if (verInfo.version) {
    plugin.version = verInfo.version;
  }

  // Try installed_plugins.json for lastUpdated
  const installedEntry = installed[plugin.marketplace];
  if (installedEntry?.lastUpdated) {
    plugin.lastUpdated = installedEntry.lastUpdated;
  }
}

/** Known plugin content directories and how to count them */
const PLUGIN_DIRS: Array<{ key: string; label: string; mode: 'subdirs' | 'files' | 'hooks' }> = [
  { key: 'skills', label: 'Skills', mode: 'subdirs' },
  { key: 'commands', label: 'Commands', mode: 'subdirs' },
  { key: 'agents', label: 'Agents', mode: 'subdirs' },
  { key: 'hooks', label: 'Hooks', mode: 'hooks' },
  { key: 'scripts', label: 'Scripts', mode: 'files' },
  { key: 'modes', label: 'Modes', mode: 'subdirs' },
  { key: 'docs', label: 'Docs', mode: 'subdirs' },
  { key: 'packages', label: 'Packages', mode: 'subdirs' },
  { key: 'ui', label: 'UI', mode: 'subdirs' },
  { key: 'tests', label: 'Tests', mode: 'subdirs' },
];

/** Scan all known content directories in a plugin */
function scanAllDirectories(pluginDir: string): PluginDirectoryEntry[] {
  const results: PluginDirectoryEntry[] = [];
  for (const { key, mode } of PLUGIN_DIRS) {
    const dirPath = path.join(pluginDir, key);
    if (!fs.existsSync(dirPath)) continue;
    const items: string[] = [];

    if (mode === 'subdirs') {
      try {
        const entries = fs.readdirSync(dirPath);
        items.push(...entries.filter((e) => fs.statSync(path.join(dirPath, e)).isDirectory()));
      } catch { /* ignore */ }
    } else if (mode === 'files') {
      try {
        const entries = fs.readdirSync(dirPath);
        items.push(...entries.filter((e) => fs.statSync(path.join(dirPath, e)).isFile() && !e.startsWith('.')));
      } catch { /* ignore */ }
    } else if (mode === 'hooks') {
      // Count event types from hooks.json + subdirectory names
      const hooksJsonPath = path.join(dirPath, 'hooks.json');
      if (fs.existsSync(hooksJsonPath)) {
        try {
          const raw = fs.readFileSync(hooksJsonPath, 'utf-8');
          const data = JSON.parse(raw);
          if (data.hooks && typeof data.hooks === 'object') {
            items.push(...Object.keys(data.hooks));
          }
        } catch { /* ignore */ }
      }
      try {
        const entries = fs.readdirSync(dirPath);
        for (const entry of entries) {
          if (entry === 'hooks.json' || entry.startsWith('hooks-') || entry.startsWith('.')) continue;
          const p = path.join(dirPath, entry);
          if (fs.statSync(p).isDirectory() && !items.includes(entry)) {
            items.push(entry);
          }
        }
      } catch { /* ignore */ }
    }

    if (items.length > 0) {
      results.push({ name: key, count: items.length, items });
    }
  }
  return results;
}

/** Extract counts/names from scanned directories for backward-compatible fields */
function extractDirInfo(dirs: PluginDirectoryEntry[], key: string): { count: number; names: string[] } {
  const entry = dirs.find((d) => d.name === key);
  return { count: entry?.count ?? 0, names: entry?.items ?? [] };
}

/**
 * enabledPlugins values can be:
 *   - boolean: simple enable/disable
 *   - string[]: version constraints (extended format)
 *
 * We treat any truthy non-false value as "enabled".
 */
type EnabledPluginsMap = Record<string, boolean | string[]>;

// ==========================================
// Cache (60s TTL)
// ==========================================

let cachedPlugins: DiscoveredPlugin[] | null = null;
let cachedBlocklist: Set<string> | null = null;
let cachedMergedEnabled: EnabledPluginsMap | null = null;
let cachedMergedCwd: string | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60_000;

function isCacheValid(): boolean {
  return cachedPlugins !== null && Date.now() - cacheTimestamp < CACHE_TTL;
}

function invalidateCache(): void {
  cachedPlugins = null;
  cachedBlocklist = null;
  cachedMergedEnabled = null;
  cachedMergedCwd = null;
  cacheTimestamp = 0;
}

// ==========================================
// Settings file I/O
// ==========================================

function readJsonFile(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

function writeJsonFile(filePath: string, data: Record<string, unknown>): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ==========================================
// enabledPlugins — multi-layer resolution
// ==========================================

function getUserSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

function getProjectSettingsPath(cwd: string): string {
  return path.join(cwd, '.claude', 'settings.json');
}

function getLocalSettingsPath(cwd: string): string {
  return path.join(cwd, '.claude', 'settings.local.json');
}

/**
 * Extract enabledPlugins from a settings object, preserving original value types.
 */
function extractEnabledPlugins(settings: Record<string, unknown>): EnabledPluginsMap {
  const raw = settings.enabledPlugins;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as EnabledPluginsMap;
  }
  return {};
}

/**
 * Merge enabledPlugins across all setting layers.
 * Resolution order (later wins): user → project → local.
 * This mirrors the SDK's own settingSources cascade.
 */
export function readMergedEnabledPlugins(cwd?: string): EnabledPluginsMap {
  const effectiveCwd = cwd || process.cwd();
  if (cachedMergedEnabled !== null && cachedMergedCwd === effectiveCwd && isCacheValid()) {
    return cachedMergedEnabled;
  }

  const userEnabled = extractEnabledPlugins(readJsonFile(getUserSettingsPath()));
  const projectEnabled = extractEnabledPlugins(readJsonFile(getProjectSettingsPath(effectiveCwd)));
  const localEnabled = extractEnabledPlugins(readJsonFile(getLocalSettingsPath(effectiveCwd)));

  // Later layers override earlier ones (same key)
  const merged: EnabledPluginsMap = { ...userEnabled, ...projectEnabled, ...localEnabled };

  cachedMergedEnabled = merged;
  cachedMergedCwd = effectiveCwd;
  return merged;
}

/**
 * Write a single enabledPlugins entry to a specific settings file.
 * Only touches the target key — preserves all other settings and other plugin entries.
 */
function writeEnabledPluginEntry(
  settingsPath: string,
  pluginKey: string,
  value: boolean | string[],
): void {
  const settings = readJsonFile(settingsPath);
  const current = extractEnabledPlugins(settings);
  current[pluginKey] = value;
  settings.enabledPlugins = current;
  writeJsonFile(settingsPath, settings);
  cachedMergedEnabled = null; // bust cache
}

// ==========================================
// Blocklist
// ==========================================

function getBlocklistPath(): string {
  return path.join(os.homedir(), '.claude', 'plugins', 'blocklist.json');
}

export function readBlocklist(): Set<string> {
  if (cachedBlocklist !== null && isCacheValid()) return cachedBlocklist;

  const blocklistPath = getBlocklistPath();
  const blocked = new Set<string>();

  if (fs.existsSync(blocklistPath)) {
    try {
      const raw = fs.readFileSync(blocklistPath, 'utf-8');
      const data = JSON.parse(raw) as Blocklist;
      if (Array.isArray(data.plugins)) {
        for (const entry of data.plugins) {
          if (entry.plugin) {
            blocked.add(entry.plugin);
          }
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  cachedBlocklist = blocked;
  return blocked;
}

// ==========================================
// Enable/disable resolution
// ==========================================

/**
 * Check if a value from enabledPlugins represents "enabled".
 * - `true` → enabled
 * - `string[]` (version constraints) → enabled (with constraints)
 * - `false` / absent → disabled
 */
function isEnabledValue(value: boolean | string[] | undefined): boolean {
  if (value === undefined || value === false) return false;
  if (value === true) return true;
  // string[] (version constraints) — treat as enabled
  if (Array.isArray(value)) return true;
  return false;
}

/**
 * Resolve whether a plugin is enabled.
 * Priority: blocklist (hard block) > merged enabledPlugins > default (not enabled).
 */
function isPluginEnabled(
  pluginKey: string,
  blocked: Set<string>,
  mergedEnabled: EnabledPluginsMap,
): boolean {
  if (blocked.has(pluginKey)) return false;
  return isEnabledValue(mergedEnabled[pluginKey]);
}

// ==========================================
// Plugin Discovery
// ==========================================

function readManifest(pluginDir: string): PluginManifest | null {
  const manifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');
  if (!fs.existsSync(manifestPath)) return null;

  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    return JSON.parse(raw) as PluginManifest;
  } catch {
    return null;
  }
}

/**
 * Scan marketplace and external plugin directories for installed plugins.
 */
export function discoverMarketplacePlugins(): DiscoveredPlugin[] {
  if (isCacheValid()) return cachedPlugins!;

  const plugins: DiscoveredPlugin[] = [];
  const claudeDir = path.join(os.homedir(), '.claude', 'plugins');

  // Load metadata sources for enrichment
  const installedPlugins = readInstalledPlugins();
  const knownMarketplaces = readKnownMarketplaces();

  // Scan marketplaces: ~/.claude/plugins/marketplaces/{mkt}/*/
  // Each marketplace directory contains plugin directories directly
  const marketplacesDir = path.join(claudeDir, 'marketplaces');
  if (fs.existsSync(marketplacesDir)) {
    try {
      const marketplaces = fs.readdirSync(marketplacesDir);
      for (const mkt of marketplaces) {
        const mktDir = path.join(marketplacesDir, mkt);
        if (!fs.statSync(mktDir).isDirectory()) continue;

        try {
          const pluginNames = fs.readdirSync(mktDir);
          for (const pluginName of pluginNames) {
            const pluginDir = path.join(mktDir, pluginName);
            if (!fs.statSync(pluginDir).isDirectory()) continue;

            const manifest = readManifest(pluginDir);
            // Skip if no manifest found
            if (!manifest) continue;

            const name = manifest.name || pluginName;
            const description = manifest.description || `Plugin: ${name}`;
            const directories = scanAllDirectories(pluginDir);
            const sc = extractDirInfo(directories, 'skills');
            const cc = extractDirInfo(directories, 'commands');
            const ac = extractDirInfo(directories, 'agents');
            const hc = extractDirInfo(directories, 'hooks');

            const plugin: DiscoveredPlugin = {
              name,
              description,
              author: manifest.author,
              path: path.resolve(pluginDir),
              marketplace: mkt,
              location: 'plugins',
              hasCommands: cc.count > 0,
              hasSkills: sc.count > 0,
              hasAgents: ac.count > 0,
              hasHooks: hc.count > 0,
              skillCount: sc.count, commandCount: cc.count, agentCount: ac.count, hookCount: hc.count,
              skillNames: sc.names, commandNames: cc.names, agentNames: ac.names, hookNames: hc.names,
              directories,
            };
            enrichPluginMetadata(plugin, installedPlugins, knownMarketplaces);
            plugins.push(plugin);
          }
        } catch {
          // ignore per-marketplace errors
        }
      }
    } catch {
      // ignore
    }
  }

  // Scan cache: ~/.claude/plugins/cache/{market}/{plugin}/{version}/
  // Use the latest version for each plugin+market combination
  const cacheDir = path.join(claudeDir, 'cache');
  if (fs.existsSync(cacheDir)) {
    try {
      const cacheMarkets = fs.readdirSync(cacheDir);
      // Track best version per "market/plugin" key
      const cachePlugins = new Map<string, { dir: string; version: string }>();
      for (const market of cacheMarkets) {
        const marketDir = path.join(cacheDir, market);
        if (!fs.statSync(marketDir).isDirectory()) continue;

        try {
          const pluginNames = fs.readdirSync(marketDir);
          for (const pluginName of pluginNames) {
            const pluginDir = path.join(marketDir, pluginName);
            if (!fs.statSync(pluginDir).isDirectory()) continue;

            // Find version subdirectories
            try {
              const versions = fs.readdirSync(pluginDir);
              for (const ver of versions) {
                const verDir = path.join(pluginDir, ver);
                if (!fs.statSync(verDir).isDirectory()) continue;
                // Accept version if it has a manifest OR has actual content directories
                const hasManifest = !!readManifest(verDir);
                const dirs = scanAllDirectories(verDir);
                const sc = extractDirInfo(dirs, 'skills');
                const cc = extractDirInfo(dirs, 'commands');
                const ac = extractDirInfo(dirs, 'agents');
                if (hasManifest || sc.count > 0 || cc.count > 0 || ac.count > 0) {
                  const key = `${market}/${pluginName}`;
                  const existing = cachePlugins.get(key);
                  if (!existing || ver > existing.version) {
                    cachePlugins.set(key, { dir: verDir, version: ver });
                  }
                }
              }
            } catch {
              // ignore
            }
          }
        } catch {
          // ignore per-market errors
        }
      }

      // Add cached plugins (only if not already found in marketplaces)
      const existingPaths = new Set(plugins.map((p) => p.path));
      for (const [key, { dir, version }] of cachePlugins) {
        const resolvedPath = path.resolve(dir);
        if (existingPaths.has(resolvedPath)) continue;

        const manifest = readManifest(dir);
        const name = manifest?.name || key.split('/')[1];
        const description = manifest?.description || `Plugin: ${name}`;
        const market = key.split('/')[0];
        const directories = scanAllDirectories(dir);
        const sc = extractDirInfo(directories, 'skills');
        const cc = extractDirInfo(directories, 'commands');
        const ac = extractDirInfo(directories, 'agents');
        const hc = extractDirInfo(directories, 'hooks');

        const plugin: DiscoveredPlugin = {
          name,
          description,
          author: manifest?.author,
          path: resolvedPath,
          marketplace: market,
          location: 'cache',
          hasCommands: cc.count > 0,
          hasSkills: sc.count > 0,
          hasAgents: ac.count > 0,
          hasHooks: hc.count > 0,
          skillCount: sc.count, commandCount: cc.count, agentCount: ac.count, hookCount: hc.count,
          skillNames: sc.names, commandNames: cc.names, agentNames: ac.names, hookNames: hc.names,
          directories,
          version,
        };
        enrichPluginMetadata(plugin, installedPlugins, knownMarketplaces);
        plugins.push(plugin);
      }
    } catch {
      // ignore cache scan errors
    }
  }

  // Scan external_plugins: ~/.claude/plugins/external_plugins/*/
  const externalDir = path.join(claudeDir, 'external_plugins');
  if (fs.existsSync(externalDir)) {
    try {
      const externalNames = fs.readdirSync(externalDir);
      for (const pluginName of externalNames) {
        const pluginDir = path.join(externalDir, pluginName);
        if (!fs.statSync(pluginDir).isDirectory()) continue;

        const manifest = readManifest(pluginDir);
        const name = manifest?.name || pluginName;
        const description = manifest?.description || `Plugin: ${name}`;
        const directories = scanAllDirectories(pluginDir);
        const sc = extractDirInfo(directories, 'skills');
        const cc = extractDirInfo(directories, 'commands');
        const ac = extractDirInfo(directories, 'agents');
        const hc = extractDirInfo(directories, 'hooks');

        const plugin: DiscoveredPlugin = {
          name,
          description,
          author: manifest?.author,
          path: path.resolve(pluginDir),
          marketplace: 'external',
          location: 'external_plugins',
          hasCommands: cc.count > 0,
          hasSkills: sc.count > 0,
          hasAgents: ac.count > 0,
          hasHooks: hc.count > 0,
          skillCount: sc.count, commandCount: cc.count, agentCount: ac.count, hookCount: hc.count,
          skillNames: sc.names, commandNames: cc.names, agentNames: ac.names, hookNames: hc.names,
          directories,
        };
        enrichPluginMetadata(plugin, installedPlugins, knownMarketplaces);
        plugins.push(plugin);
      }
    } catch {
      // ignore
    }
  }

  cachedPlugins = plugins;
  cacheTimestamp = Date.now();
  console.log(`[plugin-discovery] Found ${plugins.length} plugins`);
  return plugins;
}

// ==========================================
// Public API
// ==========================================

/**
 * Get full plugin info list for API responses.
 * Reads enabledPlugins from all settings layers to match SDK resolution.
 *
 * @param cwd - Working directory for project/local settings resolution.
 *              Defaults to process.cwd().
 */
export function getPluginInfoList(cwd?: string): PluginInfo[] {
  const plugins = discoverMarketplacePlugins();
  const blocked = readBlocklist();
  const mergedEnabled = readMergedEnabledPlugins(cwd);

  return plugins.map((plugin) => {
    const pluginKey = `${plugin.name}@${plugin.marketplace}`;
    const isBlocked = blocked.has(pluginKey);
    const enabled = isPluginEnabled(pluginKey, blocked, mergedEnabled);

    return {
      name: plugin.name,
      description: plugin.description,
      author: plugin.author,
      path: plugin.path,
      marketplace: plugin.marketplace,
      location: plugin.location,
      hasCommands: plugin.hasCommands,
      hasSkills: plugin.hasSkills,
      hasAgents: plugin.hasAgents,
      hasHooks: plugin.hasHooks,
      skillCount: plugin.skillCount,
      commandCount: plugin.commandCount,
      agentCount: plugin.agentCount,
      hookCount: plugin.hookCount,
      skillNames: plugin.skillNames,
      commandNames: plugin.commandNames,
      agentNames: plugin.agentNames,
      hookNames: plugin.hookNames,
      directories: plugin.directories,
      version: plugin.version,
      lastUpdated: plugin.lastUpdated,
      installedAt: plugin.installedAt,
      scope: plugin.scope,
      blocked: isBlocked,
      enabled,
    };
  });
}

/**
 * Determine the value to write for an enable/disable operation.
 * Preserves string[] (version constraints) when enabling — only writes `true`
 * if there's no existing constraint across any layer. Always writes `false` for disable.
 *
 * @param allLayers - all settings layers to search for existing constraints,
 *                    ordered from lowest to highest priority.
 */
function resolveWriteValue(
  pluginKey: string,
  enabled: boolean,
  allLayers: EnabledPluginsMap[],
): boolean | string[] {
  if (!enabled) return false;
  // Search all layers (highest priority first) for an existing string[] constraint
  for (let i = allLayers.length - 1; i >= 0; i--) {
    const existing = allLayers[i][pluginKey];
    if (Array.isArray(existing)) return existing;
  }
  return true;
}

export interface SetPluginResult {
  success: boolean;
  /** Which settings layer was written to */
  layer: 'user' | 'local';
  /** If the write was escalated to local because a higher layer overrides user */
  escalated: boolean;
}

/**
 * Set enabled state for a plugin.
 *
 * Default write target: user-level ~/.claude/settings.json.
 * If a higher-priority layer (project or local) would override the user-level
 * write, the write is escalated to the local layer (.claude/settings.local.json)
 * which has the highest priority and is gitignored.
 *
 * @param pluginKey - "name@marketplace"
 * @param enabled - desired state
 * @param cwd - working directory for project/local layer resolution.
 *              Required for correct escalation detection.
 */
export function setPluginEnabled(
  pluginKey: string,
  enabled: boolean,
  cwd?: string,
): SetPluginResult {
  const effectiveCwd = cwd || process.cwd();

  // Read each layer independently to detect overrides
  const userEnabled = extractEnabledPlugins(readJsonFile(getUserSettingsPath()));
  const projectEnabled = extractEnabledPlugins(readJsonFile(getProjectSettingsPath(effectiveCwd)));
  const localEnabled = extractEnabledPlugins(readJsonFile(getLocalSettingsPath(effectiveCwd)));

  const allLayers = [userEnabled, projectEnabled, localEnabled];

  // Check if writing to user-level would achieve the desired effective state.
  // Simulate: set the value at user level, then re-merge.
  const simulatedUser = { ...userEnabled };
  simulatedUser[pluginKey] = resolveWriteValue(pluginKey, enabled, allLayers);
  const simulatedMerged = { ...simulatedUser, ...projectEnabled, ...localEnabled };
  const simulatedEffective = isEnabledValue(simulatedMerged[pluginKey]);

  if (simulatedEffective === enabled) {
    // User-level write is sufficient — no higher layer overrides it
    writeEnabledPluginEntry(getUserSettingsPath(), pluginKey, simulatedUser[pluginKey]);
    invalidateCache();
    return { success: true, layer: 'user', escalated: false };
  }

  // A higher-priority layer overrides the user-level write.
  // Escalate to local layer (highest priority, gitignored).
  // Pass allLayers so constraints from any layer (including project) are preserved.
  const writeValue = resolveWriteValue(pluginKey, enabled, allLayers);
  writeEnabledPluginEntry(getLocalSettingsPath(effectiveCwd), pluginKey, writeValue);
  invalidateCache();
  return { success: true, layer: 'local', escalated: true };
}

/**
 * Force-refresh cache (e.g. after install/uninstall).
 */
export function invalidatePluginCache(): void {
  invalidateCache();
}
