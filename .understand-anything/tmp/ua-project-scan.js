const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = process.argv[2];
const OUTPUT_PATH = process.argv[3];

if (!PROJECT_ROOT || !fs.existsSync(PROJECT_ROOT)) {
  process.stderr.write('Error: project root not accessible: ' + (PROJECT_ROOT || '(not provided)') + '\n');
  process.exit(1);
}

// --- Step 1: File Discovery ---
function discoverFiles(root) {
  try {
    const result = execSync('git ls-files', { cwd: root, encoding: 'utf-8' });
    if (result.trim()) {
      return result.trim().split('\n').map(f => f.replace(/\r/g, '')).map(f => {
        // git quotes paths with special chars and uses octal escapes inside
        if (f.startsWith('"') && f.endsWith('"')) {
          f = f.slice(1, -1);
          // decode octal escapes (UTF-8 bytes) like \350\265\204 -> proper unicode
          // convert to percent-encoded hex then decode
          f = f.replace(/\\([0-7]{3})/g, (_, oct) => {
            const byte = parseInt(oct, 8);
            return '%' + byte.toString(16).padStart(2, '0');
          });
          f = decodeURIComponent(f);
        }
        // normalize path separators
        return f.replace(/\\/g, '/');
      }).filter(f => f.length > 0);
    }
  } catch (e) {
    // fall back to recursive listing
  }

  // fallback
  const files = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        walk(full);
      } else {
        files.push(rel);
      }
    }
  }
  walk(root);
  return files;
}

// --- Step 2: Exclusion Filtering ---
const DEP_DIRS = ['node_modules', '.git', 'vendor', 'venv', '.venv', '__pycache__'];
const BUILD_DIRS = ['dist', 'build', 'out', 'coverage', '.next', '.cache', '.turbo', 'target', 'obj'];
const BINARIES_EXT = new Set(['.png','.jpg','.jpeg','.gif','.svg','.ico','.woff','.woff2','.ttf','.eot','.mp3','.mp4','.pdf','.zip','.tar','.gz']);
const GENERATED_PATTERNS = ['.min.js', '.min.css', '.map', '.generated.'];
const IDE_DIRS = ['.idea', '.vscode'];
const MISC_EXCLUDE = new Set(['LICENSE', '.gitignore', '.editorconfig', '.prettierrc']);
const MISC_EXCLUDE_PREFIXES = ['.eslintrc'];
const MISC_EXCLUDE_EXT = ['.log'];

function shouldExclude(filePath) {
  const segments = filePath.split('/');
  const baseName = segments[segments.length - 1];
  const lowerBase = baseName.toLowerCase();

  // Check directory segments
  for (const seg of segments) {
    if (DEP_DIRS.includes(seg)) return true;
    if (IDE_DIRS.includes(seg)) return true;
    // Build dirs: match full segment only
    if (BUILD_DIRS.includes(seg)) return true;
  }

  // Lock files
  if (lowerBase.endsWith('.lock') || lowerBase === 'package-lock.json' || lowerBase === 'yarn.lock' || lowerBase === 'pnpm-lock.yaml') return true;

  // Binary/asset files
  const dotIdx = baseName.lastIndexOf('.');
  if (dotIdx > 0) {
    const ext = baseName.substring(dotIdx).toLowerCase();
    if (BINARIES_EXT.has(ext)) return true;
    // Generated files
    for (const pat of GENERATED_PATTERNS) {
      if (lowerBase.includes(pat)) {
        // exception: .d.ts should not be excluded
        if (pat === '.min.js' && lowerBase.endsWith('.d.ts')) continue;
        if (pat === '.map' && lowerBase.endsWith('.d.ts')) continue;
        if (pat === '.generated.' && lowerBase.endsWith('.d.ts')) continue;
        return true;
      }
    }
    // .log files
    if (MISC_EXCLUDE_EXT.includes(ext)) return true;
  }

  // Misc non-source
  if (MISC_EXCLUDE.has(baseName)) return true;
  for (const p of MISC_EXCLUDE_PREFIXES) {
    if (baseName.startsWith(p)) return true;
  }

  return false;
}

const allFiles = discoverFiles(PROJECT_ROOT);
const filteredFiles = allFiles.filter(f => !shouldExclude(f));

// --- Step 3: Language Detection ---
const EXT_TO_LANG = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript',
  '.py': 'python', '.go': 'go', '.rs': 'rust',
  '.java': 'java', '.rb': 'ruby',
  '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.h': 'cpp', '.hpp': 'cpp',
  '.c': 'c', '.cs': 'csharp', '.swift': 'swift',
  '.kt': 'kotlin', '.php': 'php',
  '.vue': 'vue', '.svelte': 'svelte',
  '.sh': 'shell', '.bash': 'shell',
  '.md': 'markdown', '.rst': 'markdown',
  '.yaml': 'yaml', '.yml': 'yaml',
  '.json': 'json', '.toml': 'toml',
  '.sql': 'sql', '.graphql': 'graphql', '.gql': 'graphql',
  '.proto': 'protobuf',
  '.tf': 'terraform', '.tfvars': 'terraform',
  '.html': 'html', '.htm': 'html',
  '.css': 'css', '.scss': 'css', '.sass': 'css', '.less': 'css',
  '.xml': 'xml', '.cfg': 'config', '.ini': 'config', '.env': 'config',
  '.prisma': 'config', '.ps1': 'script', '.bat': 'script',
};

function detectLanguage(filePath) {
  const baseName = path.basename(filePath).toLowerCase();
  if (baseName === 'dockerfile') return 'dockerfile';
  if (baseName === 'makefile') return 'makefile';
  if (baseName === 'jenkinsfile') return 'jenkinsfile';
  const ext = path.extname(filePath).toLowerCase();
  return EXT_TO_LANG[ext] || null;
}

// --- Step 4: File Category ---
function detectCategory(filePath) {
  const baseName = path.basename(filePath).toLowerCase();
  const ext = path.extname(filePath).toLowerCase();
  const segments = filePath.split('/');

  // docs
  if (['.md', '.rst'].includes(ext)) return 'docs';
  if (ext === '.txt' && baseName !== 'license') return 'docs';

  // infra (check before config since some infra files are also config-like)
  if (baseName === 'dockerfile' || baseName.startsWith('docker-compose.') ||
      ext === '.tf' || ext === '.tfvars' || baseName === 'makefile' ||
      baseName === 'jenkinsfile' || baseName === 'procfile' || baseName === 'vagrantfile')
    return 'infra';
  if (filePath.startsWith('.github/workflows/') && (ext === '.yml' || ext === '.yaml')) return 'infra';
  if (baseName === '.gitlab-ci.yml') return 'infra';
  if (filePath.startsWith('.circleci/')) return 'infra';
  if (ext === '.k8s.yaml' || ext === '.k8s.yml') return 'infra';
  if (segments.includes('k8s') || segments.includes('kubernetes')) return 'infra';

  // data
  if (['.sql', '.graphql', '.gql', '.proto', '.prisma'].includes(ext)) return 'data';
  if (baseName.endsWith('.schema.json')) return 'data';
  if (ext === '.csv') return 'data';

  // script
  if (['.sh', '.bash', '.ps1', '.bat'].includes(ext)) return 'script';

  // markup
  if (['.html', '.htm', '.css', '.scss', '.sass', '.less'].includes(ext)) return 'markup';

  // config
  const CONFIG_BASES = new Set([
    'tsconfig.json', 'package.json', 'pyproject.toml', 'cargo.toml', 'go.mod',
    'tsconfig.build.json', 'tsconfig.node.json', 'jsconfig.json',
    '.npmrc', '.nvmrc', '.tool-versions', 'renovate.json',
    'postcss.config.mjs', 'postcss.config.js', 'tailwind.config.ts',
    'eslint.config.mjs', 'biome.json', 'lefthook.yml',
    'next.config.ts', 'next.config.mjs', 'vite.config.ts', 'vitest.config.ts',
    'playwright.config.ts', 'electron-builder.yml', 'electron-builder.json',
    'typedoc.json', 'turbo.json', 'lighthouserc.json',
  ]);
  if (CONFIG_BASES.has(baseName)) return 'config';
  if (['.yaml', '.yml', '.json', '.toml', '.xml', '.cfg', '.ini', '.env'].includes(ext)) return 'config';

  // code (everything else with an extension)
  if (['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.rb',
       '.cpp', '.cc', '.cxx', '.h', '.hpp', '.c', '.cs', '.swift', '.kt',
       '.php', '.vue', '.svelte', '.mjs', '.cjs', '.mts', '.cts', '.mts',
       '.d.ts'].includes(ext) || ['.d.ts'].includes(ext))
    return 'code';
  // .d.ts files
  if (baseName.endsWith('.d.ts')) return 'code';

  return 'docs'; // fallback
}

// --- Step 5: Line Counting ---
function countLines(filePath) {
  try {
    const full = path.join(PROJECT_ROOT, filePath);
    const content = fs.readFileSync(full, 'utf-8');
    // Count newlines; add 1 if file doesn't end with newline
    const matches = content.match(/\n/g);
    const count = matches ? matches.length : 0;
    return content.length > 0 && !content.endsWith('\n') ? count + 1 : count;
  } catch (e) {
    return 0;
  }
}

// --- Step 6: Framework Detection ---
function detectFrameworks(files, root) {
  const frameworks = new Set();
  const knownNpmFrameworks = {
    'react': 'React', 'vue': 'Vue', 'svelte': 'Svelte', '@angular/core': 'Angular',
    'express': 'Express', 'fastify': 'Fastify', 'koa': 'Koa',
    'next': 'Next.js', 'nuxt': 'Nuxt', 'vite': 'Vite', 'vitest': 'Vitest',
    'jest': 'Jest', 'mocha': 'Mocha', 'tailwindcss': 'Tailwind CSS',
    'prisma': 'Prisma', 'typeorm': 'TypeORM', 'sequelize': 'Sequelize',
    'mongoose': 'Mongoose', 'redux': 'Redux', 'zustand': 'Zustand', 'mobx': 'MobX',
    '@ai-sdk/anthropic': 'AI SDK (Anthropic)', '@ai-sdk/openai': 'AI SDK (OpenAI)',
    '@ai-sdk/google': 'AI SDK (Google)', '@ai-sdk/bedrock': 'AI SDK (Bedrock)',
    'valtio': 'Valtio', 'motion': 'Motion', 'shiki': 'Shiki',
    'recharts': 'Recharts', 'radix-ui': 'Radix UI',
    'electron': 'Electron', 'better-sqlite3': 'SQLite',
  };

  // Read package.json files (root + workspaces)
  const pkgFiles = files.filter(f => f.endsWith('/package.json') || f === 'package.json');
  for (const pf of pkgFiles) {
    try {
      const full = path.join(root, pf);
      const pkg = JSON.parse(fs.readFileSync(full, 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const dep of Object.keys(deps)) {
        if (knownNpmFrameworks[dep]) {
          frameworks.add(knownNpmFrameworks[dep]);
        }
      }
    } catch (e) {}
  }

  // tsconfig.json -> TypeScript
  if (files.some(f => f === 'tsconfig.json' || f.endsWith('/tsconfig.json'))) {
    frameworks.add('TypeScript');
  }

  // Playwright
  if (files.some(f => f === 'playwright.config.ts' || f === 'playwright.config.js' || f.endsWith('/playwright.config.ts'))) {
    frameworks.add('Playwright');
  }

  // Infrastructure detection
  if (files.some(f => path.basename(f).toLowerCase() === 'dockerfile')) frameworks.add('Docker');
  if (files.some(f => path.basename(f).toLowerCase().startsWith('docker-compose.'))) frameworks.add('Docker Compose');
  if (files.some(f => path.extname(f) === '.tf')) frameworks.add('Terraform');
  if (files.some(f => f.startsWith('.github/workflows/') && (f.endsWith('.yml') || f.endsWith('.yaml')))) frameworks.add('GitHub Actions');
  if (files.some(f => path.basename(f) === '.gitlab-ci.yml')) frameworks.add('GitLab CI');
  if (files.some(f => path.basename(f) === 'Jenkinsfile')) frameworks.add('Jenkins');

  // eslint
  if (files.some(f => f === 'eslint.config.mjs' || f === 'eslint.config.js')) frameworks.add('ESLint');

  return Array.from(frameworks).sort();
}

// --- Step 7: Complexity ---
function estimateComplexity(count) {
  if (count <= 30) return 'small';
  if (count <= 150) return 'moderate';
  if (count <= 500) return 'large';
  return 'very-large';
}

// --- Step 8: Project Name ---
function detectProjectName(files, root) {
  // package.json
  for (const pf of files.filter(f => f === 'package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, pf), 'utf-8'));
      if (pkg.name) return pkg.name;
    } catch (e) {}
  }
  return path.basename(path.resolve(root));
}

// --- Step 9: Import Resolution ---
function resolveImports(files, root) {
  const fileSet = new Set(files);
  const importMap = {};

  // Extension resolution map for code files
  const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.py', '.go', '.rs', '.rb']);

  function tryResolve(importPath, importingFile) {
    const importDir = path.dirname(importingFile);
    let resolved = path.normalize(path.join(importDir, importPath)).replace(/\\/g, '/');

    // Direct match
    if (fileSet.has(resolved)) return resolved;

    // Try extensions
    const exts = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.py', '.go', '.rs', '.rb'];
    for (const ext of exts) {
      if (fileSet.has(resolved + ext)) return resolved + ext;
      // Also try .d.ts
      if (ext === '.ts' && fileSet.has(resolved + '.d.ts')) return resolved + '.d.ts';
    }

    // Try index files
    const indexVariants = ['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.mjs', 'index.cjs'];
    for (const idx of indexVariants) {
      if (fileSet.has(resolved + '/' + idx)) return resolved + '/' + idx;
    }

    return null;
  }

  function extractTSImports(content) {
    const imports = [];
    // import ... from '...'
    const importFromRegex = /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
    let m;
    while ((m = importFromRegex.exec(content)) !== null) {
      imports.push(m[1]);
    }
    // require('...')
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((m = requireRegex.exec(content)) !== null) {
      imports.push(m[1]);
    }
    // import('...') dynamic
    const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((m = dynamicImportRegex.exec(content)) !== null) {
      imports.push(m[1]);
    }
    return imports;
  }

  function extractPythonImports(content) {
    const imports = [];
    const regex = /from\s+(\.{1,2}(?:\.[a-zA-Z0-9_./]+)*)\s+import/g;
    let m;
    while ((m = regex.exec(content)) !== null) {
      // Convert Python relative import to file path
      const relPath = m[1].replace(/\./g, '/');
      imports.push(relPath);
    }
    return imports;
  }

  for (const filePath of files) {
    const category = detectCategory(filePath);
    if (category !== 'code') {
      importMap[filePath] = [];
      continue;
    }

    const lang = detectLanguage(filePath);
    if (!lang) {
      importMap[filePath] = [];
      continue;
    }

    let rawImports = [];
    try {
      const full = path.join(root, filePath);
      const content = fs.readFileSync(full, 'utf-8');

      if (['typescript', 'javascript'].includes(lang)) {
        rawImports = extractTSImports(content);
      } else if (lang === 'python') {
        rawImports = extractPythonImports(content);
      }
    } catch (e) {
      // file unreadable
    }

    // Filter to only relative imports and resolve
    const resolved = [];
    for (const imp of rawImports) {
      if (!imp.startsWith('.') && !imp.startsWith('/')) continue; // skip absolute/non-relative
      // Skip non-file imports (CSS, JSON sometimes, etc. - but keep JSON)
      const resolvedPath = tryResolve(imp, filePath);
      if (resolvedPath && !resolved.includes(resolvedPath)) {
        resolved.push(resolvedPath);
      }
    }

    importMap[filePath] = resolved;
  }

  return importMap;
}

// --- Build file entries ---
const fileEntries = filteredFiles.map(f => ({
  path: f,
  language: detectLanguage(f),
  sizeLines: countLines(f),
  fileCategory: detectCategory(f),
}));

fileEntries.sort((a, b) => a.path.localeCompare(b.path));

const languages = [...new Set(fileEntries.map(f => f.language).filter(Boolean))].sort();
const frameworks = detectFrameworks(filteredFiles, PROJECT_ROOT);
const projectName = detectProjectName(filteredFiles, PROJECT_ROOT);

// Read rawDescription and readmeHead
let rawDescription = '';
let readmeHead = '';

try {
  const pkgPath = path.join(PROJECT_ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  rawDescription = pkg.description || '';
} catch (e) {}

try {
  const readmePath = path.join(PROJECT_ROOT, 'README.md');
  const readme = fs.readFileSync(readmePath, 'utf-8');
  readmeHead = readme.split('\n').slice(0, 10).join('\n');
} catch (e) {}

const importMap = resolveImports(filteredFiles, PROJECT_ROOT);

const result = {
  scriptCompleted: true,
  name: projectName,
  rawDescription: rawDescription,
  readmeHead: readmeHead,
  languages: languages,
  frameworks: frameworks,
  files: fileEntries,
  totalFiles: fileEntries.length,
  filteredByIgnore: 0,
  estimatedComplexity: estimateComplexity(fileEntries.length),
  importMap: importMap,
};

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));
process.stdout.write('Scan complete: ' + fileEntries.length + ' files found\n');
process.exit(0);
