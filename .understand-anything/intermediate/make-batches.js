const data = JSON.parse(require('fs').readFileSync('.understand-anything/intermediate/scan-result.json', 'utf8'));

// Filter out 资料 directory (external plugin reference materials)
const allFiles = data.files.filter(f => !f.path.startsWith('资料/'));
console.log('Files after excluding 资料:', allFiles.length);

const codeFiles = allFiles.filter(f => f.fileCategory === 'code');
const nonCodeFiles = allFiles.filter(f => f.fileCategory !== 'code');

const batches = [];
let batchIndex = 0;

// Non-code files: keep configs and key docs (not all 178 docs)
const configFiles = nonCodeFiles.filter(f => f.fileCategory === 'config');
const docFiles = nonCodeFiles.filter(f => f.fileCategory === 'docs');
const infraFiles = nonCodeFiles.filter(f => f.fileCategory === 'infra');
const markupFiles = nonCodeFiles.filter(f => f.fileCategory === 'markup');
const dataFiles = nonCodeFiles.filter(f => f.fileCategory === 'data');
const scriptFiles = nonCodeFiles.filter(f => f.fileCategory === 'script');

function addBatch(files, type) {
  if (files.length === 0) return;
  for (let i = 0; i < files.length; i += 25) {
    batches.push({ batchIndex: batchIndex++, files: files.slice(i, i+25), type });
  }
}

addBatch(configFiles, 'config');
addBatch(infraFiles, 'infra');
addBatch(markupFiles, 'markup');
addBatch(dataFiles, 'data');
addBatch(scriptFiles, 'script');

// For docs, only keep top-level and key architecture docs, skip deep nested docs
const keyDocs = docFiles.filter(f =>
  !f.path.includes('/') ||
  f.path.startsWith('docs/CLAUDE') ||
  f.path.startsWith('docs/ARCHITECTURE') ||
  f.path.startsWith('ARCHITECTURE') ||
  f.path.startsWith('CLAUDE') ||
  f.path.startsWith('AGENTS') ||
  f.path.startsWith('RELEASE') ||
  f.path.startsWith('CHANGELOG') ||
  f.path.startsWith('README')
);
const otherDocs = docFiles.filter(f => !keyDocs.includes(f));
addBatch(keyDocs, 'docs-key');
// Keep remaining docs in one batch (they're less critical for code understanding)
if (otherDocs.length > 0) addBatch(otherDocs.slice(0, 25), 'docs-other');

// Code files: batch by directory grouping
const dirGroups = {};
for (const f of codeFiles) {
  const parts = f.path.split('/');
  const groupKey = parts.length > 2 ? parts.slice(0, 2).join('/') : (parts[0] || '.');
  if (!dirGroups[groupKey]) dirGroups[groupKey] = [];
  dirGroups[groupKey].push(f);
}

for (const [group, files] of Object.entries(dirGroups)) {
  for (let i = 0; i < files.length; i += 25) {
    batches.push({ batchIndex: batchIndex++, files: files.slice(i, i+25), type: 'code-' + group });
  }
}

console.log('Total batches:', batches.length);
for (const b of batches) {
  console.log('Batch', b.batchIndex, '(' + b.type + '):', b.files.length, 'files');
}

// Save batch plan
require('fs').writeFileSync('.understand-anything/intermediate/batch-plan.json', JSON.stringify({
  project: { name: data.name, description: data.description, languages: data.languages, frameworks: data.frameworks },
  batches,
  importMap: data.importMap,
  allFiles
}, null, 2));

console.log('Batch plan saved.');
