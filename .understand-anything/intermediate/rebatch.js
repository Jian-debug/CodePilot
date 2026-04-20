const fs = require('fs');
const path = require('path');

const existingFiles = JSON.parse(fs.readFileSync('.understand-anything/intermediate/existing-files.json', 'utf8'));
const importMap = JSON.parse(fs.readFileSync('.understand-anything/intermediate/batch-plan.json', 'utf8')).importMap;

// Get already-completed batch indices from batch-plan
const plan = JSON.parse(fs.readFileSync('.understand-anything/intermediate/batch-plan.json', 'utf8'));
const completedIndices = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
const completedPaths = new Set();
for (const b of plan.batches) {
  if (completedIndices.has(b.batchIndex)) {
    for (const f of b.files) completedPaths.add(f.path);
  }
}

// Filter out already-processed files
const remainingFiles = existingFiles.filter(f => !completedPaths.has(f.path));
console.log('Remaining files to analyze:', remainingFiles.length);

// Group by directory for batching
const codeFiles = remainingFiles.filter(f => f.fileCategory === 'code');
const nonCodeFiles = remainingFiles.filter(f => f.fileCategory !== 'code');

const batches = [];
let batchIndex = 0;

// Non-code: config files
const configFiles = nonCodeFiles.filter(f => f.fileCategory === 'config');
if (configFiles.length > 0) {
  for (let i = 0; i < configFiles.length; i += 25) {
    batches.push({ batchIndex: batchIndex++, files: configFiles.slice(i, i+25) });
  }
}

// Code files: group by directory
const dirGroups = {};
for (const f of codeFiles) {
  const parts = f.path.split('/');
  const groupKey = parts.length > 2 ? parts.slice(0, 2).join('/') : (parts[0] || '.');
  if (!dirGroups[groupKey]) dirGroups[groupKey] = [];
  dirGroups[groupKey].push(f);
}

// Sort groups by size (smaller first)
const sortedGroups = Object.entries(dirGroups).sort((a, b) => a[1].length - b[1].length);

for (const [group, files] of sortedGroups) {
  for (let i = 0; i < files.length; i += 25) {
    batches.push({ batchIndex: batchIndex++, files: files.slice(i, i+25), type: group });
  }
}

console.log('New batches to create:', batches.length);
for (const b of batches) {
  console.log('Batch', b.batchIndex, '(' + (b.type || 'config') + '):', b.files.length, 'files');
}

// Prepare input files for each batch
const PROJECT_ROOT = 'D:/project/common/AI/CodePilot';
fs.mkdirSync(path.join(PROJECT_ROOT, '.understand-anything/tmp'), { recursive: true });

for (const batch of batches) {
  const batchImportData = {};
  for (const f of batch.files) {
    batchImportData[f.path] = importMap[f.path] || [];
  }

  const input = {
    projectRoot: PROJECT_ROOT,
    batchFiles: batch.files.map(f => ({
      path: f.path,
      sizeLines: f.sizeLines,
      fileCategory: f.fileCategory
    })),
    batchImportData
  };

  const inputPath = path.join(PROJECT_ROOT, '.understand-anything/tmp', `ua-file-analyzer-input-${batch.batchIndex}.json`);
  fs.writeFileSync(inputPath, JSON.stringify(input, null, 2));
}

// Save the new batch plan
fs.writeFileSync('.understand-anything/intermediate/batch-plan-remaining.json', JSON.stringify({
  project: plan.project,
  batches,
  importMap
}, null, 2));

console.log('Done. Batch plan saved.');
