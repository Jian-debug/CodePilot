#!/usr/bin/env node
// ua-arch-analyze.js -- Structural analysis script for architecture layer identification
// Reads assembled-graph.json and produces architecture layer assignments
// Usage: node ua-arch-analyze.js <assembled-graph.json> <output.json>

const fs = require('fs');

function main() {
  const inputFile = process.argv[2];
  const outputFile = process.argv[3];
  if (!inputFile || !outputFile) {
    process.stderr.write('Usage: node ua-arch-analyze.js <input.json> <output.json>\n');
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
  } catch (e) {
    process.stderr.write('Error reading input: ' + e.message + '\n');
    process.exit(1);
  }

  const { nodes, edges } = data;
  if (!nodes || !Array.isArray(nodes)) {
    process.stderr.write('Input must have a "nodes" array\n');
    process.exit(1);
  }

  const nodeMap = new Map();
  for (const n of nodes) nodeMap.set(n.id, n);

  // ---- Layer Assignment Logic ----
  // Based on the CodePilot project structure:
  // Electron desktop app with Next.js frontend, API routes, message bridge, etc.

  const layers = {};

  function assign(id, layerId) {
    if (!layers[layerId]) layers[layerId] = [];
    layers[layerId].push(id);
  }

  for (const n of nodes) {
    const fp = n.filePath || '';
    const name = n.name || '';
    const type = n.type || '';
    const id = n.id;

    // === ELECTRON LAYER ===
    if (fp.startsWith('electron/')) {
      if (type === 'function' || type === 'class') {
        // Assign to the file's layer
        const filePrefix = fp.split('/').slice(0, 2).join('/');
        assign(id, 'layer:electron');
      } else {
        assign(id, 'layer:electron');
      }
      continue;
    }

    // === CI/CD LAYER ===
    if (fp.startsWith('.github/')) {
      assign(id, 'layer:ci-cd');
      continue;
    }

    // === DOCUMENTATION LAYER (root-level docs) ===
    if (type === 'document' && (fp.startsWith('docs/') || !fp.includes('/'))) {
      assign(id, 'layer:documentation');
      continue;
    }

    // === SITE DOCUMENTATION ===
    if (fp.startsWith('apps/site/content/')) {
      assign(id, 'layer:site-docs');
      continue;
    }

    // === SITE CONFIG ===
    if (fp.startsWith('apps/site/') && type === 'config') {
      assign(id, 'layer:site-config');
      continue;
    }

    // === SITE COMPONENTS (UI) ===
    if (fp.startsWith('apps/site/components/') || fp.startsWith('apps/site/src/components/')) {
      assign(id, 'layer:site-ui');
      continue;
    }

    // === SITE APP/PAGES ===
    if (fp.startsWith('apps/site/app/') || fp.startsWith('apps/site/src/app/')) {
      if (fp.includes('/docs/')) {
        assign(id, 'layer:site-docs');
      } else {
        assign(id, 'layer:site-pages');
      }
      continue;
    }

    // === SITE LIB/UTILS ===
    if (fp.startsWith('apps/site/lib/') || fp.startsWith('apps/site/src/lib/')) {
      assign(id, 'layer:site-lib');
      continue;
    }

    // === SITE STYLES ===
    if (fp.startsWith('apps/site/styles/')) {
      assign(id, 'layer:site-ui');
      continue;
    }

    // === SITE MIDDLEWARE ===
    if (fp.startsWith('apps/site/') && fp.includes('middleware')) {
      assign(id, 'layer:site-middleware');
      continue;
    }

    // === PUBLIC ASSETS ===
    if (fp.startsWith('public/')) {
      assign(id, 'layer:assets');
      continue;
    }

    // === THEMES/CONFIG ===
    if (fp.startsWith('themes/')) {
      assign(id, 'layer:themes');
      continue;
    }

    // === SCRIPTS ===
    if (fp.startsWith('scripts/')) {
      assign(id, 'layer:scripts');
      continue;
    }

    // === API ROUTES ===
    if (fp.startsWith('src/app/api/')) {
      if (type === 'function' || type === 'class') {
        assign(id, 'layer:api-routes');
      } else {
        assign(id, 'layer:api-routes');
      }
      continue;
    }

    // === FRONTEND PAGES (src/app/chat, src/app/settings) ===
    if (fp.startsWith('src/app/')) {
      assign(id, 'layer:frontend-pages');
      continue;
    }

    // === I18N ===
    if (fp.startsWith('src/i18n/')) {
      assign(id, 'layer:i18n');
      continue;
    }

    // === TYPES ===
    if (fp.startsWith('src/types/')) {
      assign(id, 'layer:types');
      continue;
    }

    // === TESTS ===
    if (fp.startsWith('src/__tests__/')) {
      assign(id, 'layer:test');
      continue;
    }

    // === LIB: BRIDGE (message bridge adapters) ===
    if (fp.startsWith('src/lib/bridge/')) {
      assign(id, 'layer:bridge');
      continue;
    }

    // === LIB: CHANNELS (Feishu channel plugin) ===
    if (fp.startsWith('src/lib/channels/')) {
      assign(id, 'layer:channels');
      continue;
    }

    // === LIB: BUILTIN TOOLS ===
    if (fp.startsWith('src/lib/builtin-tools/')) {
      assign(id, 'layer:builtin-tools');
      continue;
    }

    // === LIB: CLAUDE CODE COMPAT ===
    if (fp.startsWith('src/lib/claude-code-compat/')) {
      assign(id, 'layer:claude-compat');
      continue;
    }

    // === LIB: DASHBOARD ===
    if (fp.startsWith('src/lib/dashboard')) {
      assign(id, 'layer:dashboard');
      continue;
    }

    // === LIB: GIT ===
    if (fp.startsWith('src/lib/git/')) {
      assign(id, 'layer:git-service');
      continue;
    }

    // === LIB: CONSTANTS ===
    if (fp.startsWith('src/lib/constants/')) {
      assign(id, 'layer:constants');
      continue;
    }

    // === LIB: CLI TOOLS ===
    if (fp.startsWith('src/lib/cli-tools')) {
      assign(id, 'layer:cli-tools');
      continue;
    }

    // === LIB: CONTEXT ===
    if (fp.startsWith('src/lib/context')) {
      assign(id, 'layer:context');
      continue;
    }

    // === REMAINING LIB: CORE SERVICE LAYER ===
    if (fp.startsWith('src/lib/')) {
      assign(id, 'layer:core-service');
      continue;
    }

    // === ROOT CONFIG ===
    if (type === 'config') {
      assign(id, 'layer:project-config');
      continue;
    }

    // Default: should not reach here
    assign(id, 'layer:core-service');
  }

  // ---- Layer Descriptions ----
  const descriptions = {
    'layer:electron': 'Electron desktop shell including main process, preload scripts, auto-updater, terminal manager, and window lifecycle management',
    'layer:api-routes': 'HTTP API route handlers for chat, media, git, settings, skills, plugins, providers, dashboard, doctor, CLI tools, bridge, SDK, and Claude integration endpoints',
    'layer:frontend-pages': 'React page components for the chat interface and settings UI within the Next.js app',
    'layer:core-service': 'Core backend services including agent loop, AI provider abstraction, Claude client, session parsing, context management, database layer (SQLite), file operations, store, utilities, assistant workspace, buddy system, heartbeat, and error handling',
    'layer:bridge': 'Message bridge system for cross-platform communication adapters (Telegram, Discord, Feishu, QQ, WeChat), markdown rendering, permission brokering, security validation, and conversation engine',
    'layer:channels': 'Feishu channel plugin implementation including gateway, card controller, inbound/outbound message handling, identity management, and resource downloading',
    'layer:builtin-tools': 'Built-in tool integrations including CLI tools, dashboard widgets, media generation, memory search, notification, session search, and widget guidelines',
    'layer:claude-compat': 'Claude Code compatibility layer including SSE parsing, request building, protocol translation, and type definitions for Claude Code protocol emulation',
    'layer:dashboard': 'Dashboard subsystem including CLI reader, file reader, MCP integration, store, and data export for persistent widget state',
    'layer:git-service': 'Git integration service providing branch listing, checkout, commit, push, status, and worktree management',
    'layer:constants': 'Application constants including command definitions, icon mappings, and system prompts for image generation agents',
    'layer:cli-tools': 'CLI tools catalog, detection, context analysis, and MCP bridge for registering external command-line tools',
    'layer:context': 'Context management including context assembler, compressor, estimator, and pruner for optimizing LLM context window usage',
    'layer:types': 'TypeScript type definitions and shared interfaces for the application domain model',
    'layer:i18n': 'Internationalization resources including locale files and language configuration for multi-language support',
    'layer:test': 'Unit tests, integration tests, and end-to-end Playwright test suites covering chat, settings, and core functionality',
    'layer:project-config': 'Root-level project configuration including TypeScript, ESLint, PostCSS, Next.js, Playwright, electron-builder, MCP, and component settings',
    'layer:ci-cd': 'CI/CD pipeline configuration including the end-to-end test workflow definition',
    'layer:documentation': 'Project documentation including READMEs (English, Chinese, Japanese), CHANGELOG, CLAUDE.md, AGENTS.md, ARCHITECTURE.md, and developer guides',
    'layer:site-config': 'Documentation site configuration including Next.js config, package.json, tsconfig, Tailwind, PostCSS, and shadcn/ui settings',
    'layer:site-ui': 'Documentation site UI components including home page components, docs components, layout wrappers, providers, and shadcn/ui primitives',
    'layer:site-pages': 'Documentation site app routes including the home page, not-found handler, and docs page routing via MDX content rendering',
    'layer:site-lib': 'Documentation site library utilities for MDX processing, content loading, and navigation logic',
    'layer:site-middleware': 'Documentation site middleware for internationalization routing and locale detection',
    'layer:site-docs': 'Documentation site content including MDX pages and navigation metadata for both English and Chinese documentation',
    'layer:themes': 'Syntax highlighting and editor theme definitions including default, GitHub, Nord, Tokyo Night, Kanagawa, and other color schemes',
    'layer:scripts': 'Build and packaging scripts including after-pack hook, after-sign codesigning, and Electron bundling',
    'layer:assets': 'Static public assets including SVG icon files served by the web frontend',
  };

  const output = {
    layers: layers,
    layerDescriptions: descriptions,
    totalNodes: nodes.length,
    totalLayers: Object.keys(layers).length,
  };

  // Verify all nodes are assigned
  let assignedCount = 0;
  for (const ids of Object.values(layers)) {
    assignedCount += ids.length;
  }
  if (assignedCount !== nodes.length) {
    process.stderr.write('WARNING: Assigned ' + assignedCount + ' but total is ' + nodes.length + '\n');
  }

  try {
    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  } catch (e) {
    process.stderr.write('Error writing output: ' + e.message + '\n');
    process.exit(1);
  }

  process.exit(0);
}

main();
