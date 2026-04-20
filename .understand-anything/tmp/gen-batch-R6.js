const fs = require('fs');

const extractResults = JSON.parse(fs.readFileSync('D:/project/common/AI/CodePilot/.understand-anything/tmp/ua-file-extract-results-R6.json', 'utf8'));
const inputData = JSON.parse(fs.readFileSync('D:/project/common/AI/CodePilot/.understand-anything/tmp/ua-file-analyzer-input-R6.json', 'utf8'));
const batchImportData = inputData.batchImportData;

const nodes = [];
const edges = [];

function getComplexity(nonEmptyLines, funcCount, classCount) {
  if (nonEmptyLines > 200 || funcCount > 10 || classCount > 2) return 'complex';
  if (nonEmptyLines >= 50 || funcCount >= 3) return 'moderate';
  return 'simple';
}

const fileMeta = {
  'agent-loop.ts': { summary: 'Core agent execution loop that manages the AI assistant lifecycle, tool invocation, and message streaming via Server-Sent Events.', tags: ['agent', 'execution', 'streaming', 'core'] },
  'agent-registry.ts': { summary: 'Registry for managing agent definitions, providing lookup and enumeration of available AI agents.', tags: ['registry', 'agent', 'lookup'] },
  'agent-sdk-agents.ts': { summary: 'Agent SDK integration layer mapping external agent definitions into the CodePilot agent system.', tags: ['sdk', 'agent', 'integration'] },
  'agent-sdk-capabilities.ts': { summary: 'Defines and maps agent SDK capabilities to CodePilot tool definitions, enabling dynamic tool discovery.', tags: ['sdk', 'capabilities', 'tool-mapping'] },
  'agent-system-prompt.ts': { summary: 'Constructs system prompts for AI agents, embedding workspace context, rules, and tool definitions.', tags: ['prompt', 'system', 'agent-config'] },
  'agent-tools.ts': { summary: 'Assembles and manages the tool set available to agents, including MCP tools and built-in capabilities.', tags: ['tools', 'assembly', 'agent-config'] },
  'ai-provider.ts': { summary: 'Unified AI provider abstraction layer supporting Anthropic, OpenAI, Google, and other model providers with provider-agnostic interfaces.', tags: ['provider', 'multi-model', 'abstraction'] },
  'assistant-workspace.ts': { summary: 'Manages assistant workspace state including session tracking, working directory, and workspace lifecycle.', tags: ['workspace', 'session', 'lifecycle'] },
  'bash-validator.ts': { summary: 'Validates Bash commands for safety before execution, checking for dangerous patterns and syntax.', tags: ['validation', 'security', 'bash'] },
  'bg-notify-parser.ts': { summary: 'Parses background notification payloads from the notification manager.', tags: ['parsing', 'notification', 'background'] },
  'bridge/CLAUDE.md': { summary: 'Documentation for the bridge module explaining channel adapter architecture and integration patterns.', tags: ['documentation', 'bridge', 'architecture'] },
  'discord-adapter.ts': { summary: 'Discord channel adapter implementing message send/receive, media handling, and bot interaction via Discord.js.', tags: ['discord', 'adapter', 'messaging'] },
  'feishu-adapter.ts': { summary: 'Feishu (Lark) channel adapter delegating to the channels/feishu module for message routing.', tags: ['feishu', 'adapter', 'messaging'] },
  'index.ts': { summary: 'Barrel file re-exporting all channel adapter implementations for centralized imports.', tags: ['barrel', 'exports', 'adapter'] },
  'qq-adapter.ts': { summary: 'QQ (Tencent) channel adapter implementing bot messaging via QQ Open Platform API with group and private message support.', tags: ['qq', 'adapter', 'messaging'] },
  'qq-api.ts': { summary: 'QQ Open Platform API client providing HTTP wrappers for sending messages, managing groups, and handling media.', tags: ['qq', 'api-client', 'http'] },
  'telegram-adapter.ts': { summary: 'Telegram channel adapter with full bot lifecycle, message handling, inline keyboards, media management, and group support.', tags: ['telegram', 'adapter', 'messaging'] },
  'telegram-media.ts': { summary: 'Telegram media handling utilities for downloading, uploading, and converting media files between formats.', tags: ['telegram', 'media', 'file-handling'] },
  'telegram-utils.ts': { summary: 'Telegram-specific utility functions for message parsing, user identification, and chat type detection.', tags: ['telegram', 'utility', 'helpers'] },
  'weixin-adapter.ts': { summary: 'WeChat (Weixin) channel adapter supporting official account messages, session management, and media handling.', tags: ['weixin', 'adapter', 'messaging'] },
  'weixin-api.ts': { summary: 'WeChat API client providing HTTP wrappers for custom replies, media upload/download, and template messages.', tags: ['weixin', 'api-client', 'http'] },
  'weixin-auth.ts': { summary: 'WeChat authentication and signature verification for request validation and token management.', tags: ['weixin', 'auth', 'security'] },
  'weixin-ids.ts': { summary: 'WeChat user and conversation ID mapping utilities for consistent identity resolution.', tags: ['weixin', 'identity', 'mapping'] },
  'weixin-media.ts': { summary: 'WeChat media download and upload utilities handling temporary and permanent media resources.', tags: ['weixin', 'media', 'file-handling'] },
  'weixin-session-guard.ts': { summary: 'WeChat session guard preventing duplicate concurrent sessions for the same user.', tags: ['weixin', 'session', 'concurrency'] },
  'weixin-types.ts': { summary: 'TypeScript type definitions for WeChat API messages, events, and response structures.', tags: ['weixin', 'types', 'definitions'] },
  'bridge-manager.ts': { summary: 'Central bridge manager orchestrating channel adapters, conversation lifecycle, permission management, and message delivery across all connected platforms.', tags: ['bridge', 'orchestration', 'lifecycle'] },
  'channel-adapter.ts': { summary: 'Abstract base interface and types for channel adapters, defining the contract all platform adapters must implement.', tags: ['interface', 'adapter', 'contract'] },
  'channel-router.ts': { summary: 'Routes incoming messages to the appropriate channel adapter based on platform and configuration.', tags: ['routing', 'dispatcher', 'messaging'] },
  'conversation-engine.ts': { summary: 'Core conversation engine managing dialog state, turn tracking, and multi-turn AI interactions across channels.', tags: ['conversation', 'engine', 'dialog'] },
  'delivery-layer.ts': { summary: 'Message delivery layer handling message queuing, rate limiting, and platform-specific formatting for outbound messages.', tags: ['delivery', 'messaging', 'queue'] },
  'feishu-app-registration.ts': { summary: 'Feishu app registration and webhook management for setting up bot callbacks and event subscriptions.', tags: ['feishu', 'registration', 'webhook'] },
  'permission-broker.ts': { summary: 'Permission broker managing access control for bridge operations, handling user-level and channel-level permissions.', tags: ['permissions', 'security', 'access-control'] },
  'rate-limiter.ts': { summary: 'Rate limiter implementation for controlling message frequency per user and per channel.', tags: ['rate-limiting', 'security', 'throttling'] },
  'validators.ts': { summary: 'Input validators for bridge messages, checking payload integrity, size limits, and content safety.', tags: ['validation', 'security', 'input-checking'] },
  'types.ts': { summary: 'Core type definitions for the bridge module including message structures, channel metadata, and event types.', tags: ['types', 'definitions', 'bridge'] },
  'buddy.ts': { summary: 'Buddy companion system managing virtual pet lifecycle, state persistence, feeding, and mood tracking.', tags: ['buddy', 'pet', 'gamification'] },
  'builtin-mcp-bridge.ts': { summary: 'MCP bridge for built-in tools, exposing core functionality as Model Context Protocol tools.', tags: ['mcp', 'bridge', 'builtin'] },
  'ask-user-question.ts': { summary: 'Built-in MCP tool for asking users questions with structured response options.', tags: ['tool', 'interaction', 'question'] },
  'cli-tools.ts': { summary: 'CLI tools catalog management providing tool registration, search, and context-aware filtering for the MCP server.', tags: ['cli', 'catalog', 'tool-management'] },
  'dashboard.ts': { summary: 'Dashboard widget management built-in tool for pinning, updating, and removing dashboard widgets.', tags: ['dashboard', 'widget', 'tool'] },
  'media.ts': { summary: 'Media import built-in tool for saving images, videos, and audio to the CodePilot media library.', tags: ['media', 'import', 'tool'] },
  'memory-search.ts': { summary: 'Memory search built-in tool enabling semantic search across persistent project memories.', tags: ['memory', 'search', 'tool'] },
  'notification.ts': { summary: 'Notification built-in tool for sending system, toast, and Telegram notifications to users.', tags: ['notification', 'alert', 'tool'] },
  'session-search.ts': { summary: 'Session search built-in tool for querying past conversation sessions and their content.', tags: ['session', 'search', 'tool'] },
  'widget-guidelines.ts': { summary: 'Widget design guidelines built-in tool providing best practices for dashboard widget development.', tags: ['widget', 'guidelines', 'tool'] },
  'channel-plugin-adapter.ts': { summary: 'Channel plugin adapter wrapping channel implementations for the plugin system integration.', tags: ['channel', 'plugin', 'adapter'] },
  'card-controller.ts': { summary: 'Feishu interactive card controller for creating, updating, and managing rich message cards.', tags: ['feishu', 'card', 'interactive'] },
  'config.ts': { summary: 'Feishu channel configuration utilities for app credentials, webhook URLs, and environment settings.', tags: ['feishu', 'configuration', 'setup'] },
  'gateway.ts': { summary: 'Feishu API gateway providing authenticated HTTP client for Lark open platform endpoints.', tags: ['feishu', 'gateway', 'api'] },
  'identity.ts': { summary: 'Feishu user identity resolution and mapping utilities.', tags: ['feishu', 'identity', 'user'] },
  'inbound.ts': { summary: 'Feishu inbound message parser processing webhook payloads and converting to internal message format.', tags: ['feishu', 'inbound', 'parsing'] },
  'message-actions.ts': { summary: 'Feishu message action handlers for card button clicks, form submissions, and interactive elements.', tags: ['feishu', 'actions', 'interactive'] },
  'outbound.ts': { summary: 'Feishu outbound message formatter converting internal messages to Feishu API format with card support.', tags: ['feishu', 'outbound', 'formatting'] },
  'policy.ts': { summary: 'Feishu channel policy rules for rate limiting, message size, and content restrictions.', tags: ['feishu', 'policy', 'rules'] },
  'resource-downloader.ts': { summary: 'Feishu resource downloader for fetching files, images, and media from Feishu servers.', tags: ['feishu', 'download', 'media'] },
  'channels/types.ts': { summary: 'Core channel type definitions including message formats, channel metadata, and adapter interfaces.', tags: ['types', 'channel', 'definitions'] },
  'checkin-processor.ts': { summary: 'Daily check-in processor handling user check-ins, streak tracking, and reward distribution.', tags: ['checkin', 'daily', 'gamification'] },
  'claude-client.ts': { summary: 'Full-featured Claude API client implementing message streaming, tool use, caching, error recovery, and session management for Anthropic models.', tags: ['claude', 'api-client', 'streaming'] },
  'claude-code-compat-model.ts': { summary: 'Claude Code compatibility model adapter translating between Claude Code protocol and standard AI SDK interfaces.', tags: ['compat', 'claude-code', 'adapter'] },
  'request-builder.ts': { summary: 'Request builder for Claude Code compatibility layer, constructing API request payloads from internal state.', tags: ['compat', 'request', 'builder'] },
  'sse-parser.ts': { summary: 'Server-Sent Events parser for Claude Code streaming responses.', tags: ['compat', 'sse', 'parsing'] },
  'claude-home-shadow.ts': { summary: 'Shadow home manager creating isolated workspace environments with file synchronization and project mirroring.', tags: ['workspace', 'isolation', 'sync'] },
  'claude-model-options.ts': { summary: 'Claude model option sanitization and validation for configuration parameters.', tags: ['model', 'configuration', 'validation'] },
  'claude-session-parser.ts': { summary: 'Claude session state parser extracting conversation history, tool results, and context from session files.', tags: ['session', 'parsing', 'context'] },
  'claude-settings.ts': { summary: 'Claude settings management for loading, saving, and validating configuration from project and user scopes.', tags: ['settings', 'configuration', 'persistence'] },
  'cli-tools-catalog.ts': { summary: 'CLI tools catalog system providing registration, versioning, description generation, and agent compatibility assessment for command-line tools.', tags: ['cli', 'catalog', 'tool-management'] },
  'cli-tools-context.ts': { summary: 'CLI tools context provider injecting relevant tool documentation into agent prompts.', tags: ['cli', 'context', 'injection'] },
  'cli-tools-detect.ts': { summary: 'Auto-detection of installed CLI tools on the system PATH, identifying binaries and extracting metadata.', tags: ['cli', 'detection', 'system'] },
  'cli-tools-mcp.ts': { summary: 'MCP server implementation for CLI tools, exposing installed commands as callable model tools with dry-run support.', tags: ['mcp', 'cli', 'server'] },
  'command-icons.ts': { summary: 'Icon mapping for application commands providing visual identifiers for UI display.', tags: ['constants', 'icons', 'ui'] },
  'commands.ts': { summary: 'Command constant definitions for application slash commands and their metadata.', tags: ['constants', 'commands', 'slash'] },
  'image-agent-prompt.ts': { summary: 'Default prompt template for image generation agents.', tags: ['constants', 'image', 'prompt'] },
  'context-assembler.ts': { summary: 'Context assembler building the full prompt context from workspace files, memories, rules, and tool definitions.', tags: ['context', 'assembly', 'prompt'] },
  'context-compressor.ts': { summary: 'Context compression system reducing token usage through summarization, pruning, and prioritization of conversation history.', tags: ['context', 'compression', 'optimization'] },
  'context-estimator.ts': { summary: 'Token usage estimator calculating approximate context window consumption for messages and tool definitions.', tags: ['context', 'estimation', 'tokens'] },
  'context-pruner.ts': { summary: 'Context pruner selectively removing stale tool results and old messages to stay within token limits.', tags: ['context', 'pruning', 'cleanup'] },
  'conversation-registry.ts': { summary: 'Conversation registry tracking active sessions and preventing duplicate conversations per user.', tags: ['registry', 'conversation', 'tracking'] },
  'dashboard-cli-reader.ts': { summary: 'Dashboard CLI command reader executing shell commands for CLI-sourced dashboard widgets.', tags: ['dashboard', 'cli', 'execution'] },
  'dashboard-export.ts': { summary: 'Dashboard widget export utilities for serializing widget state and generating shareable configurations.', tags: ['dashboard', 'export', 'serialization'] },
  'dashboard-file-reader.ts': { summary: 'Dashboard file reader parsing and extracting data from file-sourced widget definitions.', tags: ['dashboard', 'file', 'parsing'] },
  'dashboard-mcp.ts': { summary: 'Dashboard MCP server exposing widget CRUD operations and data refresh as Model Context Protocol tools.', tags: ['dashboard', 'mcp', 'server'] },
  'dashboard-store.ts': { summary: 'Dashboard widget persistent store managing widget state, data contracts, and metadata in SQLite.', tags: ['dashboard', 'storage', 'sqlite'] },
  'db.ts': { summary: 'Core database layer providing SQLite schema definitions, migration management, and data access functions for sessions, messages, check-ins, buddy state, and workspace data.', tags: ['database', 'sqlite', 'schema'] },
  'error-classifier.ts': { summary: 'Error classification system categorizing runtime errors into actionable types with recovery suggestions and severity levels.', tags: ['error', 'classification', 'recovery'] },
  'file-checkpoint.ts': { summary: 'File checkpoint system creating snapshots of working directory state for agent rollback and recovery.', tags: ['checkpoint', 'file', 'recovery'] },
  'file-utils.ts': { summary: 'Basic file system utility functions for common read/write operations.', tags: ['utility', 'file', 'helpers'] },
  'files.ts': { summary: 'File management module providing path resolution, file watching, and workspace file operations.', tags: ['file', 'management', 'workspace'] },
  'service.ts': { summary: 'Git service wrapper providing repository operations including status, diff, commit history, and branch management.', tags: ['git', 'service', 'vcs'] },
  'heartbeat.ts': { summary: 'Heartbeat system maintaining connection liveness and periodic status reporting for long-running agent sessions.', tags: ['heartbeat', 'liveness', 'monitoring'] },
  // markdown renderers
  'discord.ts': { summary: 'Discord-specific markdown renderer converting markdown IR to Discord-compatible message format.', tags: ['markdown', 'discord', 'rendering'] },
  'feishu.ts': { summary: 'Feishu-specific markdown renderer with rich text card support and interactive element rendering.', tags: ['markdown', 'feishu', 'rendering'] },
  'ir.ts': { summary: 'Markdown intermediate representation (IR) parser converting markdown AST into a platform-agnostic structured format.', tags: ['markdown', 'ir', 'parsing'] },
  'render.ts': { summary: 'Universal markdown renderer orchestrating IR-to-platform conversion with renderer selection and fallback logic.', tags: ['markdown', 'rendering', 'orchestration'] },
  'telegram.ts': { summary: 'Telegram-specific markdown renderer supporting HTML mode and markdown v2 with proper entity handling.', tags: ['markdown', 'telegram', 'rendering'] },
};

// Helper to get metadata for a file path
function getMetaForPath(filePath) {
  // Exact path match first
  const fileName = filePath.split('/').pop();

  // Use path-specific keys before falling back to filename-only
  const pathSpecific = {
    'src/lib/bridge/types.ts': { summary: 'Core type definitions for the bridge module including message structures, channel metadata, and event types.', tags: ['types', 'definitions', 'bridge'] },
    'src/lib/channels/types.ts': { summary: 'Core channel type definitions including message formats, channel metadata, and adapter interfaces.', tags: ['types', 'channel', 'definitions'] },
    'src/lib/channels/feishu/types.ts': { summary: 'TypeScript type definitions for Feishu API structures including messages, cards, and events.', tags: ['feishu', 'types', 'definitions'] },
    'src/lib/claude-code-compat/types.ts': { summary: 'Type definitions for the Claude Code compatibility layer.', tags: ['compat', 'types', 'definitions'] },
    'src/lib/bridge/adapters/index.ts': { summary: 'Barrel file re-exporting all channel adapter implementations for centralized imports.', tags: ['barrel', 'exports', 'adapter', 'entry-point'] },
    'src/lib/builtin-tools/index.ts': { summary: 'Built-in tools registry assembling all MCP tools and providing tool lookup and enumeration.', tags: ['registry', 'builtin', 'tool-assembly', 'entry-point'] },
    'src/lib/channels/feishu/index.ts': { summary: 'Feishu channel main module implementing full lifecycle management, message routing, and event handling.', tags: ['feishu', 'channel', 'lifecycle', 'entry-point'] },
    'src/lib/claude-code-compat/index.ts': { summary: 'Claude Code compatibility barrel file re-exporting core modules.', tags: ['barrel', 'compat', 'exports', 'entry-point'] },
    'src/lib/bridge/markdown/discord.ts': { summary: 'Discord-specific markdown renderer converting markdown IR to Discord-compatible message format.', tags: ['markdown', 'discord', 'rendering'] },
    'src/lib/bridge/markdown/feishu.ts': { summary: 'Feishu-specific markdown renderer with rich text card support and interactive element rendering.', tags: ['markdown', 'feishu', 'rendering'] },
    'src/lib/bridge/markdown/ir.ts': { summary: 'Markdown intermediate representation (IR) parser converting markdown AST into a platform-agnostic structured format.', tags: ['markdown', 'ir', 'parsing'] },
    'src/lib/bridge/markdown/render.ts': { summary: 'Universal markdown renderer orchestrating IR-to-platform conversion with renderer selection and fallback logic.', tags: ['markdown', 'rendering', 'orchestration'] },
    'src/lib/bridge/markdown/telegram.ts': { summary: 'Telegram-specific markdown renderer supporting HTML mode and markdown v2 with proper entity handling.', tags: ['markdown', 'telegram', 'rendering'] },
  };

  if (pathSpecific[filePath]) return pathSpecific[filePath];

  // Then check filename-only for uniquely-named files in specific subdirs
  for (const [key, val] of Object.entries(fileMeta)) {
    if (filePath.endsWith('/' + key) || filePath === key) return val;
  }
  return { summary: 'Source file in the CodePilot codebase.', tags: ['code'] };
}

// Process each file
for (const result of extractResults.results) {
  const path = result.path;
  const parts = path.split('/');
  const fileName = parts[parts.length - 1];
  const fc = result.fileCategory;
  const ne = result.nonEmptyLines || 0;
  const funcCount = result.functions ? result.functions.length : 0;
  const classCount = result.classes ? result.classes.length : 0;
  const importCount = result.metrics ? result.metrics.importCount : 0;
  const exportCount = result.exports ? result.exports.length : 0;

  const meta = getMetaForPath(path);
  let nodeType = 'file';
  if (fc === 'config') nodeType = 'config';
  else if (fc === 'docs') nodeType = 'document';

  const complexity = getComplexity(ne, funcCount, classCount);

  let tags = [...meta.tags];
  if (exportCount > 3 && funcCount <= 2 && classCount === 0) tags.push('barrel');
  if (fileName === 'index.ts') tags.push('entry-point');

  // Ensure unique and 3-5 tags
  tags = [...new Set(tags)].slice(0, 5);
  while (tags.length < 3) tags.push('code');

  const nodeId = `${nodeType}:${path}`;
  nodes.push({
    id: nodeId,
    type: nodeType,
    name: fileName,
    filePath: path,
    summary: meta.summary,
    tags: tags,
    complexity: complexity
  });

  // Function nodes
  if (result.functions && result.functions.length > 0) {
    for (const fn of result.functions) {
      const lineCount = fn.endLine - fn.startLine + 1;
      const isExported = result.exports && result.exports.some(e => e.name === fn.name);
      if (lineCount >= 10 || isExported) {
        const fnId = `function:${path}:${fn.name}`;
        nodes.push({
          id: fnId,
          type: 'function',
          name: fn.name,
          filePath: path,
          lineRange: [fn.startLine, fn.endLine],
          summary: `${fn.name} function ${isExported ? '(exported) ' : ''}in ${fileName}.`,
          tags: isExported ? ['exported', 'function'] : ['function'],
          complexity: lineCount > 100 ? 'complex' : lineCount > 30 ? 'moderate' : 'simple'
        });
        edges.push({ source: nodeId, target: fnId, type: 'contains', direction: 'forward', weight: 1.0 });
        if (isExported) {
          edges.push({ source: nodeId, target: fnId, type: 'exports', direction: 'forward', weight: 0.8 });
        }
      }
    }
  }

  // Class nodes
  if (result.classes && result.classes.length > 0) {
    for (const cls of result.classes) {
      const lineCount = cls.endLine - cls.startLine + 1;
      const methodCount = cls.methods ? cls.methods.length : 0;
      const isExported = result.exports && result.exports.some(e => e.name === cls.name);
      if (methodCount >= 2 || lineCount >= 20 || isExported) {
        const clsId = `class:${path}:${cls.name}`;
        const methodDesc = cls.methods && cls.methods.length > 0 ? ' with methods: ' + cls.methods.slice(0, 5).join(', ') : '';
        nodes.push({
          id: clsId,
          type: 'class',
          name: cls.name,
          filePath: path,
          lineRange: [cls.startLine, cls.endLine],
          summary: `${cls.name} class ${isExported ? '(exported) ' : ''}in ${fileName}${methodDesc}.`,
          tags: isExported ? ['exported', 'class'] : ['class'],
          complexity: lineCount > 100 ? 'complex' : lineCount > 30 ? 'moderate' : 'simple'
        });
        edges.push({ source: nodeId, target: clsId, type: 'contains', direction: 'forward', weight: 1.0 });
        if (isExported) {
          edges.push({ source: nodeId, target: clsId, type: 'exports', direction: 'forward', weight: 0.8 });
        }
      }
    }
  }

  // Import edges
  if (batchImportData[path]) {
    for (const importPath of batchImportData[path]) {
      if (importPath !== path) {
        const targetFile = inputData.batchFiles.find(f => f.path === importPath);
        const targetFc = targetFile ? targetFile.fileCategory : 'code';
        let targetType = 'file';
        if (targetFc === 'config') targetType = 'config';
        else if (targetFc === 'docs') targetType = 'document';
        edges.push({
          source: nodeId,
          target: `${targetType}:${importPath}`,
          type: 'imports',
          direction: 'forward',
          weight: 0.7
        });
      }
    }
  }
}

// Non-code edges: document -> bridge files
const bridgeFiles = extractResults.results.filter(r => r.path.startsWith('src/lib/bridge/') && r.fileCategory === 'code');
for (const bf of bridgeFiles.slice(0, 10)) {
  edges.push({
    source: 'document:src/lib/bridge/CLAUDE.md',
    target: `file:${bf.path}`,
    type: 'documents',
    direction: 'forward',
    weight: 0.5
  });
}

// db.ts function nodes (limited to avoid explosion)
const dbResult = extractResults.results.find(r => r.path === 'src/lib/db.ts');
if (dbResult && dbResult.functions) {
  let dbFuncCount = 0;
  for (const fn of dbResult.functions) {
    if (dbFuncCount >= 50) break;
    const lineCount = fn.endLine - fn.startLine + 1;
    const isExported = dbResult.exports && dbResult.exports.some(e => e.name === fn.name);
    if ((lineCount >= 10 || isExported)) {
      dbFuncCount++;
      const fnId = `function:src/lib/db.ts:${fn.name}`;
      nodes.push({
        id: fnId,
        type: 'function',
        name: fn.name,
        filePath: 'src/lib/db.ts',
        lineRange: [fn.startLine, fn.endLine],
        summary: `Database function ${fn.name} ${isExported ? '(exported) ' : ''}for SQLite data access operations.`,
        tags: isExported ? ['exported', 'database', 'function'] : ['database', 'function'],
        complexity: lineCount > 100 ? 'complex' : lineCount > 30 ? 'moderate' : 'simple'
      });
      edges.push({ source: 'file:src/lib/db.ts', target: fnId, type: 'contains', direction: 'forward', weight: 1.0 });
      if (isExported) {
        edges.push({ source: 'file:src/lib/db.ts', target: fnId, type: 'exports', direction: 'forward', weight: 0.8 });
      }
    }
  }
}

// Verify integrity
const nodeIds = new Set(nodes.map(n => n.id));
const selfRefs = edges.filter(e => e.source === e.target);
const missingTargets = edges.filter(e => !nodeIds.has(e.target));
const missingSources = edges.filter(e => !nodeIds.has(e.source));

if (selfRefs.length > 0) console.log('WARNING: Self-referencing edges:', selfRefs.length);
if (missingTargets.length > 0) {
  console.log('WARNING: Missing target nodes:', missingTargets.length);
  console.log('Sample:', missingTargets.slice(0, 5).map(e => e.target));
}
if (missingSources.length > 0) {
  console.log('WARNING: Missing source nodes:', missingSources.length);
  console.log('Sample:', missingSources.slice(0, 5).map(e => e.source));
}

const output = { nodes, edges };
fs.writeFileSync('D:/project/common/AI/CodePilot/.understand-anything/intermediate/batch-R6.json', JSON.stringify(output, null, 2));
console.log('Written batch-R6.json with', nodes.length, 'nodes and', edges.length, 'edges');
console.log('Node types:', Object.entries(nodes.reduce((acc, n) => { acc[n.type] = (acc[n.type] || 0) + 1; return acc; }, {})));
