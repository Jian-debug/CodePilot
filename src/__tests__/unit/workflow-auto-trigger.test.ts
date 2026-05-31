import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldSuggestWorkflow,
  isWorkflowAutoSuggestEnabled,
} from '../../lib/workflow/auto-trigger';

describe('workflow/auto-trigger — shouldSuggestWorkflow', () => {
  it('suggests for large, multi-step tasks', () => {
    const yes = [
      'Refactor the authentication module to use JWT instead of sessions',
      'Migrate the whole codebase from JavaScript to TypeScript',
      'Please rewrite the payment service and update all its callers',
      'Scaffold a new REST API with auth, CRUD, and tests',
      'Make a codebase-wide change to the logging format',
      'Do an end-to-end implementation of the checkout flow',
      '1. Add a model\n2. Add a migration\n3. Wire the API\n4. Add tests',
      'First set up the database schema, then build the repository layer, after that add the service, and finally expose the endpoints.',
    ];
    for (const p of yes) assert.equal(shouldSuggestWorkflow(p), true, `should suggest: ${p}`);
  });

  it('stays quiet for simple requests, questions, and short prompts', () => {
    const no = [
      'Fix the typo in README',
      'What is the difference between let and const?',
      'How do I refactor a single function?',
      'Add a console.log to debug this',
      'rename foo to bar',
      '',
      'Explain how promises work in JavaScript',
    ];
    for (const p of no) assert.equal(shouldSuggestWorkflow(p), false, `should NOT suggest: ${p}`);
  });
});

describe('workflow/auto-trigger — isWorkflowAutoSuggestEnabled', () => {
  it('defaults on when unset, off only for explicit "false"', () => {
    assert.equal(isWorkflowAutoSuggestEnabled(() => undefined), true);
    assert.equal(isWorkflowAutoSuggestEnabled(() => ''), true);
    assert.equal(isWorkflowAutoSuggestEnabled(() => 'true'), true);
    assert.equal(isWorkflowAutoSuggestEnabled(() => 'false'), false);
  });
});
