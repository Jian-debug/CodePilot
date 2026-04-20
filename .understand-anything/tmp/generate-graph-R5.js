/**
 * Generate knowledge graph nodes and edges from structural extraction results.
 * Uses path patterns, function names, and metrics to infer summaries, tags, and complexity.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative } from 'node:path';

const results = JSON.parse(readFileSync(
  'D:/project/common/AI/CodePilot/.understand-anything/tmp/ua-file-extract-results-R5.json', 'utf8'
));

// ---------------------------------------------------------------------------
// Helper: infer API domain from path
// ---------------------------------------------------------------------------
function getApiDomain(filePath) {
  // Extract the domain segment after /api/ and before next /
  const m = filePath.match(/src\/app\/api\/([^/]+)/);
  return m ? m[1] : 'unknown';
}

// ---------------------------------------------------------------------------
// Helper: infer endpoint purpose from path
// ---------------------------------------------------------------------------
function getEndpointPurpose(filePath) {
  const parts = filePath.replace('src/app/api/', '').split('/');
  // The last segment before 'route.ts' is usually the action
  const lastIdx = parts.length - 1; // index of 'route.ts'
  const action = parts[lastIdx - 1]; // segment before route.ts
  const domain = parts[0];

  const purposeMap = {
    route: `${domain} main endpoint`,
    list: `list ${domain} resources`,
    detail: `${domain} detail view`,
    status: `${domain} status check`,
    describe: `${domain} description`,
    install: `${domain} install handler`,
    catalog: `${domain} catalog`,
    search: `${domain} search`,
    browse: `browse files`,
    open: `open file`,
    preview: `file preview`,
    serve: `serve file content`,
    suggest: `file path suggestions`,
    raw: `raw file content`,
    branches: `list git branches`,
    checkout: `git checkout`,
    commit: `git commit`,
    log: `git log`,
    push: `git push`,
    status: `status check`,
    worktrees: `git worktree management`,
    derive: `derive worktree`,
    'commit-detail': `detailed commit view`,
    generate: `generate content`,
    gallery: `media gallery`,
    favorite: `favorite toggle`,
    tags: `tag management`,
    jobs: `job management`,
    cancel: `cancel job`,
    pause: `pause job`,
    resume: `resume job`,
    start: `start job`,
    progress: `job progress`,
    'sync-context': `sync job context`,
    plan: `plan job`,
    items: `job items`,
    marketplace: `marketplace operations`,
    readme: `readme fetch`,
    remove: `remove item`,
    'set-default': `set default`,
    activate: `activate item`,
    models: `list models`,
    test: `test connection`,
    options: `get options`,
    import: `import data`,
    interrupt: `interrupt operation`,
    messages: `message management`,
    mode: `set mode`,
    model: `set model`,
    permission: `permission handling`,
    rewind: `rewind conversation`,
    sessions: `session management`,
    'by-cwd': `filter by cwd`,
    structured: `structured output`,
    account: `account management`,
    updates: `check for updates`,
    settings: `settings management`,
    bridge: `bridge management`,
    channels: `channel management`,
    register: `registration flow`,
    poll: `poll status`,
    cancel: `cancel operation`,
    doctor: `health diagnostics`,
    export: `export data`,
    repair: `repair operation`,
    files: `file operations`,
    git: `git operations`,
    health: `health check`,
    media: `media operations`,
    plugins: `plugin management`,
    mcp: `MCP server management`,
    reconnect: `reconnect MCP`,
    toggle: `toggle state`,
    providers: `provider management`,
    sdk: `SDK operations`,
    setup: `setup operations`,
    'recent-projects': `recent projects`,
    skills: `skill management`,
    tasks: `task management`,
    uploads: `file uploads`,
    usage: `usage statistics`,
    stats: `statistics`,
    workspace: `workspace operations`,
    checkin: `workspace checkin`,
    docs: `workspace docs`,
    'hook-triggered': `hook trigger`,
    index: `workspace index`,
    'latest-session': `latest session`,
    onboarding: `onboarding flow`,
    organize: `organize workspace`,
    session: `session operations`,
    discord: `Discord integration`,
    feishu: `Feishu integration`,
    qq: `QQ integration`,
    telegram: `Telegram integration`,
    weixin: `WeChat integration`,
    verify: `verify credentials`,
    login: `login flow`,
    wait: `wait for login`,
    accounts: `account management`,
    app: `app settings`,
    sentry: `Sentry configuration`,
    workspace: `workspace settings`,
    'app/updates': `app update checker`,
    'openai-oauth': `OpenAI OAuth flow`,
    callback: `OAuth callback`,
    'claude-auth': `Claude authentication`,
    'claude-sessions': `Claude session management`,
    'claude-status': `Claude status`,
    'claude-upgrade': `Claude upgrade`,
    'cli-tools': `CLI tool management`,
    custom: `custom CLI tools`,
    installed: `installed tools`,
    descriptions: `tool descriptions`,
    dashboard: `dashboard operations`,
    refresh: `refresh data`,
  };

  return purposeMap[action] || `${domain} ${action} endpoint`;
}

// ---------------------------------------------------------------------------
// Helper: determine HTTP methods exported
// ---------------------------------------------------------------------------
function getHttpMethods(result) {
  if (!result.exports) return [];
  return result.exports
    .filter(e => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(e.name))
    .map(e => e.name);
}

// ---------------------------------------------------------------------------
// Helper: get significant functions (10+ lines or exported)
// ---------------------------------------------------------------------------
function getSignificantFunctions(result) {
  if (!result.functions) return [];
  const exportedNames = new Set((result.exports || []).map(e => e.name));
  return result.functions.filter(fn => {
    const lineCount = fn.endLine - fn.startLine + 1;
    return lineCount >= 10 || exportedNames.has(fn.name);
  });
}

// ---------------------------------------------------------------------------
// Helper: determine complexity
// ---------------------------------------------------------------------------
function getComplexity(result) {
  const ne = result.nonEmptyLines || 0;
  const funcCount = result.functions?.length || 0;
  const maxFuncLines = result.functions
    ? Math.max(...result.functions.map(f => f.endLine - f.startLine + 1), 0)
    : 0;

  if (ne > 200 || funcCount > 5 || maxFuncLines > 200) return 'complex';
  if (ne > 50 || funcCount > 2 || maxFuncLines > 50) return 'moderate';
  return 'simple';
}

// ---------------------------------------------------------------------------
// Helper: generate summary for a file
// ---------------------------------------------------------------------------
function generateSummary(result) {
  const methods = getHttpMethods(result);
  const methodStr = methods.length > 0 ? ` Supports ${methods.join(', ')} methods.` : '';
  const funcCount = result.functions?.length || 0;
  const domain = getApiDomain(result.path);
  const purpose = getEndpointPurpose(result.path);
  const baseName = basename(result.path, '.ts');

  // Special handling for the chat/route.ts (very large file)
  if (result.path === 'src/app/api/chat/route.ts') {
    return 'Core chat API endpoint handling session creation, message streaming, context compression, and response collection. Implements the main conversation loop with lock management, token estimation, and server-side completion processing.';
  }

  // Special handling for large files
  if (result.nonEmptyLines > 200) {
    return `${capitalize(domain)} API endpoint handling ${purpose}. Complex handler with ${funcCount} functions managing the full request lifecycle.${methodStr}`;
  }

  const helperFuncs = (result.functions || [])
    .filter(f => f.name !== 'GET' && f.name !== 'POST' && f.name !== 'PUT' && f.name !== 'PATCH' && f.name !== 'DELETE')
    .map(f => f.name);

  let summary = `API endpoint for ${purpose}.${methodStr}`;
  if (helperFuncs.length > 0) {
    summary += ` Includes helper functions: ${helperFuncs.slice(0, 3).join(', ')}.`;
  }
  return summary;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Helper: generate tags
// ---------------------------------------------------------------------------
function generateTags(result) {
  const domain = getApiDomain(result.path);
  const methods = getHttpMethods(result);
  const tags = ['api-handler'];

  // Domain tag
  const domainTagMap = {
    chat: 'chat',
    bridge: 'bridge',
    git: 'git',
    files: 'file-system',
    media: 'media',
    plugins: 'plugins',
    providers: 'provider',
    settings: 'settings',
    skills: 'skills',
    'cli-tools': 'cli-tools',
    doctor: 'diagnostics',
    health: 'health-check',
    workspace: 'workspace',
    tasks: 'task-management',
    uploads: 'uploads',
    usage: 'usage',
    setup: 'setup',
    sdk: 'sdk',
    dashboard: 'dashboard',
    search: 'search',
    'claude-auth': 'auth',
    'claude-sessions': 'session',
    'claude-status': 'status',
    'claude-upgrade': 'upgrade',
    'openai-oauth': 'oauth',
  };
  if (domainTagMap[domain]) tags.push(domainTagMap[domain]);

  // Method-based tags
  if (methods.includes('POST')) tags.push('write');
  if (methods.includes('GET')) tags.push('read');
  if (methods.includes('PUT')) tags.push('update');
  if (methods.includes('DELETE')) tags.push('delete');

  // Path-based tags
  if (result.path.includes('[id]')) tags.push('dynamic-route');
  if (result.path.includes('marketplace')) tags.push('marketplace');
  if (result.path.includes('mcp')) tags.push('mcp');
  if (result.path.includes('verify')) tags.push('verification');
  if (result.path.includes('login')) tags.push('auth');
  if (result.path.includes('register')) tags.push('registration');
  if (result.path.includes('weixin')) tags.push('wechat');
  if (result.path.includes('telegram')) tags.push('telegram');
  if (result.path.includes('discord')) tags.push('discord');
  if (result.path.includes('feishu')) tags.push('feishu');
  if (result.path.includes('sessions')) tags.push('session-management');
  if (result.path.includes('messages')) tags.push('messaging');
  if (result.path.includes('jobs')) tags.push('job-queue');
  if (result.path.includes('tags')) tags.push('tagging');
  if (result.path.includes('interrupt')) tags.push('interrupt');
  if (result.path.includes('rewind')) tags.push('rewind');
  if (result.path.includes('permission')) tags.push('permissions');
  if (result.path.includes('favorite')) tags.push('favorites');
  if (result.path.includes('generate')) tags.push('generation');
  if (result.path.includes('gallery')) tags.push('gallery');
  if (result.path.includes('channels')) tags.push('channels');
  if (result.path.includes('catalog')) tags.push('catalog');
  if (result.path.includes('branches')) tags.push('git-branches');
  if (result.path.includes('checkout')) tags.push('git-checkout');
  if (result.path.includes('commit')) tags.push('git-commit');
  if (result.path.includes('push')) tags.push('git-push');
  if (result.path.includes('worktrees')) tags.push('worktrees');
  if (result.path.includes('preview')) tags.push('preview');
  if (result.path.includes('browse')) tags.push('browse');
  if (result.path.includes('suggest')) tags.push('autocomplete');
  if (result.path.includes('custom')) tags.push('customization');
  if (result.path.includes('installed')) tags.push('installed');
  if (result.path.includes('descriptions')) tags.push('descriptions');
  if (result.path.includes('repair')) tags.push('repair');
  if (result.path.includes('export')) tags.push('export');
  if (result.path.includes('callback')) tags.push('callback');
  if (result.path.includes('activate')) tags.push('activation');
  if (result.path.includes('models')) tags.push('model-listing');
  if (result.path.includes('test')) tags.push('testing');
  if (result.path.includes('options')) tags.push('options');
  if (result.path.includes('import')) tags.push('import');
  if (result.path.includes('mode')) tags.push('mode');
  if (result.path.includes('model')) tags.push('model');
  if (result.path.includes('structured')) tags.push('structured-output');
  if (result.path.includes('account')) tags.push('account');
  if (result.path.includes('updates')) tags.push('updates');
  if (result.path.includes('stats')) tags.push('statistics');
  if (result.path.includes('checkin')) tags.push('checkin');
  if (result.path.includes('docs')) tags.push('docs');
  if (result.path.includes('hook-triggered')) tags.push('hooks');
  if (result.path.includes('index')) tags.push('indexing');
  if (result.path.includes('latest-session')) tags.push('latest-session');
  if (result.path.includes('onboarding')) tags.push('onboarding');
  if (result.path.includes('organize')) tags.push('organization');
  if (result.path.includes('sentry')) tags.push('error-monitoring');
  if (result.path.includes('refresh')) tags.push('refresh');
  if (result.path.includes('describe')) tags.push('description');
  if (result.path.includes('install')) tags.push('installation');
  if (result.path.includes('reconnect')) tags.push('reconnect');
  if (result.path.includes('toggle')) tags.push('toggle');
  if (result.path.includes('cancel')) tags.push('cancellation');
  if (result.path.includes('pause')) tags.push('pause');
  if (result.path.includes('resume')) tags.push('resume');
  if (result.path.includes('start')) tags.push('start-action');
  if (result.path.includes('progress')) tags.push('progress-tracking');
  if (result.path.includes('sync-context')) tags.push('context-sync');
  if (result.path.includes('plan')) tags.push('planning');
  if (result.path.includes('items')) tags.push('items');
  if (result.path.includes('readme')) tags.push('readme');
  if (result.path.includes('remove')) tags.push('removal');
  if (result.path.includes('set-default')) tags.push('defaults');
  if (result.path.includes('recent-projects')) tags.push('recent-projects');

  // Fallback tags to ensure at least 3
  if (tags.length < 3) {
    const fallbacks = ['nextjs', 'rest-api', 'server-side'];
    for (const fb of fallbacks) {
      if (tags.length >= 3) break;
      if (!tags.includes(fb)) tags.push(fb);
    }
  }

  // Deduplicate and limit
  const unique = [...new Set(tags)];
  return unique.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Build nodes
// ---------------------------------------------------------------------------
const nodes = [];
const edges = [];

for (const result of results.results) {
  // File node
  const complexity = getComplexity(result);
  const summary = generateSummary(result);
  const tags = generateTags(result);

  nodes.push({
    id: `file:${result.path}`,
    type: 'file',
    name: basename(result.path),
    filePath: result.path,
    summary,
    tags,
    complexity,
  });

  // Function nodes
  const sigFuncs = getSignificantFunctions(result);
  for (const fn of sigFuncs) {
    const isHttpMethod = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(fn.name);
    const lineCount = fn.endLine - fn.startLine + 1;
    const exported = (result.exports || []).some(e => e.name === fn.name);

    const fnTags = [];
    if (isHttpMethod) fnTags.push('http-handler');
    if (exported) fnTags.push('exported');
    if (fn.name.includes('collect')) fnTags.push('streaming');
    if (fn.name.includes('compress')) fnTags.push('compression');
    if (fn.name.includes('compare')) fnTags.push('comparison');
    if (fn.name.includes('verify')) fnTags.push('verification');
    if (fn.name.includes('process')) fnTags.push('processing');
    if (lineCount > 100) fnTags.push('large-function');
    if (fn.name.includes('strip')) fnTags.push('sanitization');
    if (fn.name.includes('sanitize')) fnTags.push('sanitization');
    if (fn.name.includes('filter')) fnTags.push('filtering');
    if (fn.name.includes('detect')) fnTags.push('detection');
    if (fn.name.includes('parse')) fnTags.push('parsing');
    if (fn.name.includes('scan')) fnTags.push('scanning');
    if (fn.name.includes('resolve')) fnTags.push('resolution');
    if (fn.name.includes('fetch')) fnTags.push('fetching');
    if (fn.name.includes('map')) fnTags.push('mapping');
    if (fn.name.includes('flatten')) fnTags.push('flattening');
    if (fn.name.includes('score')) fnTags.push('scoring');
    if (fn.name.includes('restart')) fnTags.push('restart');
    if (fn.name.includes('count')) fnTags.push('counting');
    if (fn.name.includes('find')) fnTags.push('search');
    if (fn.name.includes('deduplicate')) fnTags.push('deduplication');
    if (fn.name.includes('refresh')) fnTags.push('refresh');
    if (fn.name.includes('extract')) fnTags.push('extraction');
    if (lineCount > 200) fnTags.push('complex');
    if (fn.name.includes('no') && fn.name.includes('Payload')) fnTags.push('response-builder');
    if (fn.name.includes('version') || fn.name.includes('Semver')) fnTags.push('versioning');
    if (fn.name.includes('detect') && fn.name.includes('Env')) fnTags.push('environment');
    if (fnTags.length === 0) fnTags.push('helper');

    // Fallback to ensure at least 3 tags
    if (fnTags.length < 3) {
      const fallbacks = ['api-function', 'server-side', 'typescript'];
      for (const fb of fallbacks) {
        if (fnTags.length >= 3) break;
        if (!fnTags.includes(fb)) fnTags.push(fb);
      }
    }

    nodes.push({
      id: `function:${result.path}:${fn.name}`,
      type: 'function',
      name: fn.name,
      filePath: result.path,
      lineRange: [fn.startLine, fn.endLine],
      summary: `${isHttpMethod ? `HTTP ${fn.name} handler` : `Helper function`} for ${result.path.replace('src/app/api/', '').replace('/route.ts', '')}. ${fn.params?.length ? `Accepts ${fn.params.length} parameter(s).` : ''} Spans ${lineCount} lines.`,
      tags: fnTags.slice(0, 5),
      complexity: lineCount > 200 ? 'complex' : lineCount > 50 ? 'moderate' : 'simple',
    });

    // Contains edge
    edges.push({
      source: `file:${result.path}`,
      target: `function:${result.path}:${fn.name}`,
      type: 'contains',
      direction: 'forward',
      weight: 1.0,
    });

    // Exports edge
    if (exported) {
      edges.push({
        source: `file:${result.path}`,
        target: `function:${result.path}:${fn.name}`,
        type: 'exports',
        direction: 'forward',
        weight: 0.8,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Build import edges between route files in the same batch
// ---------------------------------------------------------------------------
// Since batchImportData has empty arrays (no pre-resolved imports),
// we infer import relationships from call graph data.
// When a function in file A calls something that matches a function name
// in file B's exports, we create a depends_on edge.

// Build a map of function names to their files
const funcToFile = {};
for (const result of results.results) {
  for (const fn of (result.functions || [])) {
    if (!funcToFile[fn.name]) {
      funcToFile[fn.name] = new Set();
    }
    funcToFile[fn.name].add(result.path);
  }
}

// Analyze call graphs for cross-file dependencies
for (const result of results.results) {
  if (!result.callGraph) continue;

  const calleesByFile = {};
  for (const cg of result.callGraph) {
    const calleeName = cg.callee.split('.')[0];
    // Skip built-in/generic calls
    if (['JSON', 'Array', 'String', 'Number', 'Date', 'Math', 'Object', 'console',
         'Buffer', 'process', 'path', 'fs', 'crypto', 'Response', 'NextResponse',
         'AbortSignal', 'content', 'request', 'value', 'line', 'currentText',
         'cleanedBlocks', 'errCleanedBlocks', 'thinkingText', 'fullText',
         'historyAfterBoundary', 'rowsToKeep', 'rowsToCompress', 'savedMedia',
         'seenToolResultIds', 'contentBlocks', 'recentMsgs', 'historyMsgs',
         'estimate', 'files', 'fileMeta', 'f', 'b', 'controller', 'reader',
         'stream', 'streamForClient', 'releaseSessionLock', 'setSessionRuntimeStatus',
         'setTimeout', 'setInterval', 'clearInterval', 'import', 'fetch'].includes(calleeName)) {
      continue;
    }

    if (funcToFile[calleeName]) {
      for (const targetPath of funcToFile[calleeName]) {
        if (targetPath !== result.path) {
          if (!calleesByFile[targetPath]) calleesByFile[targetPath] = new Set();
          calleesByFile[targetPath].add(calleeName);
        }
      }
    }
  }

  // Create depends_on edges for cross-file calls
  for (const [targetPath, calledFuncs] of Object.entries(calleesByFile)) {
    // Only create edges to files within our batch
    const existsInBatch = results.results.some(r => r.path === targetPath);
    if (existsInBatch) {
      edges.push({
        source: `file:${result.path}`,
        target: `file:${targetPath}`,
        type: 'depends_on',
        direction: 'forward',
        weight: 0.6,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Deduplicate edges
// ---------------------------------------------------------------------------
const edgeSet = new Set();
const uniqueEdges = [];
for (const edge of edges) {
  const key = `${edge.source}|${edge.target}|${edge.type}`;
  if (!edgeSet.has(key)) {
    edgeSet.add(key);
    uniqueEdges.push(edge);
  }
}

// ---------------------------------------------------------------------------
// Write output
// ---------------------------------------------------------------------------
const output = {
  nodes,
  edges: uniqueEdges,
};

writeFileSync(
  'D:/project/common/AI/CodePilot/.understand-anything/intermediate/batch-R5.json',
  JSON.stringify(output, null, 2),
  'utf8'
);

// Stats
const nodeTypes = {};
for (const n of nodes) {
  nodeTypes[n.type] = (nodeTypes[n.type] || 0) + 1;
}
console.log(`Nodes: ${nodes.length} total`);
console.log('  By type:', JSON.stringify(nodeTypes));
console.log(`Edges: ${uniqueEdges.length} total`);
console.log(`Files skipped: ${results.filesSkipped?.length || 0}`);
