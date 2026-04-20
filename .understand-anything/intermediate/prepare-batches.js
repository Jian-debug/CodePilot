// Prepare batch data for dispatch: write input files and generate dispatch prompts
const fs = require('fs');
const path = require('path');

const plan = JSON.parse(fs.readFileSync('.understand-anything/intermediate/batch-plan.json', 'utf8'));
const PROJECT_ROOT = 'D:/project/common/AI/CodePilot';
const SKILL_DIR = 'C:/Users/jian/.claude/plugins/cache/understand-anything/understand-anything/2.3.1/skills/understand';

// Ensure tmp dir exists
fs.mkdirSync(path.join(PROJECT_ROOT, '.understand-anything/tmp'), { recursive: true });

// Prepare batch input files for all batches
for (const batch of plan.batches) {
  const batchImportData = {};
  for (const f of batch.files) {
    batchImportData[f.path] = plan.importMap[f.path] || [];
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

console.log(`Prepared ${plan.batches.length} batch input files.`);

// Generate dispatch info
for (const batch of plan.batches) {
  const files = batch.files.map(f =>
    `${f.path} (${f.sizeLines} lines, fileCategory: ${f.fileCategory})`
  ).join('\n');

  console.log(`BATCH:${batch.batchIndex}:TYPE:${batch.type}:FILES:${batch.files.length}`);
}
