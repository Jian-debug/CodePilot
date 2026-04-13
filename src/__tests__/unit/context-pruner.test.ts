import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ModelMessage } from 'ai';

import {
  pruneOldToolResults,
  pruneOldToolResultsByBudget,
  estimateTokens,
  shouldAutoCompact,
} from '../../lib/context-pruner';

// ────────────────────────────────────────────────────────────────
// Test helpers — build minimal ModelMessage shapes
// ────────────────────────────────────────────────────────────────

function userMsg(text: string): ModelMessage {
  return { role: 'user', content: text } as ModelMessage;
}

function assistantMsg(text: string): ModelMessage {
  return { role: 'assistant', content: text } as ModelMessage;
}

function toolMsg(toolCallId: string, resultText: string): ModelMessage {
  return {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId,
        toolName: 'Read',
        output: { type: 'text', value: resultText },
      },
    ],
  } as ModelMessage;
}

// ────────────────────────────────────────────────────────────────
// pruneOldToolResults (legacy) — unchanged behavior
// ────────────────────────────────────────────────────────────────

describe('pruneOldToolResults (legacy 6-turn mode)', () => {
  it('returns messages as-is when under the 6-turn window', () => {
    const msgs = [
      userMsg('first'),
      assistantMsg('reply 1'),
      toolMsg('call1', 'result 1 body'),
    ];
    const result = pruneOldToolResults(msgs);
    assert.deepEqual(result, msgs);
  });

  it('replaces older tool-result content with the fixed marker', () => {
    // Build 8 messages so the 7th+8th are the "window"
    const msgs: ModelMessage[] = [];
    for (let i = 0; i < 10; i++) {
      msgs.push(toolMsg(`call${i}`, `result ${i} with a lot of body content`));
    }
    const result = pruneOldToolResults(msgs);
    assert.equal(result.length, msgs.length);

    // Messages at index 4+ should be untouched (last 6)
    // Messages at index 0..3 should have their tool-result output replaced
    const prunedContent = result[0].content as Array<{ output?: { value: string } }>;
    const output = prunedContent[0].output;
    assert.ok(output);
    assert.ok(output.value.includes('truncated'), `expected truncation marker, got ${output.value}`);

    // Last message (index 9) should keep its original body
    const keptContent = result[9].content as Array<{ output?: { value: string } }>;
    assert.equal(keptContent[0].output?.value, 'result 9 with a lot of body content');
  });

  it('leaves user messages unchanged even in the pruned window', () => {
    const msgs: ModelMessage[] = [
      userMsg('old 1'),
      userMsg('old 2'),
      userMsg('old 3'),
      userMsg('old 4'),
      userMsg('old 5'),
      userMsg('old 6'),
      userMsg('recent 1'),
      userMsg('recent 2'),
    ];
    const result = pruneOldToolResults(msgs);
    // All user messages preserved
    assert.deepEqual(result, msgs);
  });
});

// ────────────────────────────────────────────────────────────────
// pruneOldToolResultsByBudget — enhanced mode
// ────────────────────────────────────────────────────────────────

describe('pruneOldToolResultsByBudget (enhanced)', () => {
  it('returns messages unchanged when under budget', () => {
    const msgs = [userMsg('short'), assistantMsg('also short')];
    const result = pruneOldToolResultsByBudget(msgs, { tokenBudget: 10_000 });
    assert.deepEqual(result, msgs);
  });

  it('returns messages unchanged when protectFirstN + protectLastN >= length', () => {
    const msgs = [userMsg('a'), assistantMsg('b'), userMsg('c')];
    const result = pruneOldToolResultsByBudget(msgs, {
      protectFirstN: 2,
      protectLastN: 2,
      tokenBudget: 1,
    });
    assert.deepEqual(result, msgs);
  });

  it('protects head + tail, prunes middle tool results', () => {
    // Build: [protectFirstN=2] user0, assistant1, [middle] tool2, tool3, tool4, tool5, [protectLastN=2] tool6, assistant7
    const longBody = 'x'.repeat(5000); // inflate estimate so budget triggers
    const msgs: ModelMessage[] = [
      userMsg('head 0'),
      assistantMsg('head 1'),
      toolMsg('call2', longBody),
      toolMsg('call3', longBody),
      toolMsg('call4', longBody),
      toolMsg('call5', longBody),
      toolMsg('call6', longBody),
      assistantMsg('tail final'),
    ];

    const result = pruneOldToolResultsByBudget(msgs, {
      tokenBudget: 1_000, // force pruning
      protectFirstN: 2,
      protectLastN: 2,
    });

    assert.equal(result.length, msgs.length);

    // Head preserved verbatim
    assert.equal((result[0] as { content: string }).content, 'head 0');
    assert.equal((result[1] as { content: string }).content, 'head 1');

    // Middle (indices 2..5) pruned
    for (let i = 2; i < 6; i++) {
      const content = result[i].content as Array<{ output?: { value: string } }>;
      const output = content[0].output;
      assert.ok(output);
      assert.ok(
        output.value.length < 200,
        `middle msg ${i} should be short, got ${output.value.length} chars`,
      );
    }

    // Tail preserved verbatim (indices 6 and 7)
    const tailContent = result[6].content as Array<{ output?: { value: string } }>;
    assert.equal(tailContent[0].output?.value, longBody);
    assert.equal((result[7] as { content: string }).content, 'tail final');
  });

  it('keepToolCallSummary=true embeds the toolCallId in the marker', () => {
    const longBody = 'x'.repeat(10_000);
    const msgs: ModelMessage[] = [
      userMsg('head'),
      toolMsg('abc12345xyz', longBody),
      toolMsg('def67890abc', longBody),
      userMsg('tail'),
    ];

    const result = pruneOldToolResultsByBudget(msgs, {
      tokenBudget: 500,
      protectFirstN: 1,
      protectLastN: 1,
      keepToolCallSummary: true,
    });

    const pruned1 = result[1].content as Array<{ output?: { value: string } }>;
    assert.ok(pruned1[0].output?.value.includes('abc12345'));
  });

  it('keepToolCallSummary=false falls back to the generic marker', () => {
    const longBody = 'x'.repeat(10_000);
    const msgs: ModelMessage[] = [
      userMsg('head'),
      toolMsg('abc12345', longBody),
      userMsg('tail'),
    ];

    const result = pruneOldToolResultsByBudget(msgs, {
      tokenBudget: 100,
      protectFirstN: 1,
      protectLastN: 1,
      keepToolCallSummary: false,
    });

    const pruned = result[1].content as Array<{ output?: { value: string } }>;
    assert.ok(pruned[0].output?.value.includes('truncated'));
    assert.ok(!pruned[0].output?.value.includes('abc12345'));
  });

  it('empty message array returns empty', () => {
    const result = pruneOldToolResultsByBudget([], { tokenBudget: 1 });
    assert.deepEqual(result, []);
  });

  it('does not modify user or assistant text messages in the middle', () => {
    const msgs: ModelMessage[] = [
      userMsg('head'),
      userMsg('middle user — stays'),
      assistantMsg('middle assistant — stays'),
      userMsg('tail'),
    ];
    // Force pruning with a tiny budget
    const result = pruneOldToolResultsByBudget(msgs, {
      tokenBudget: 1,
      protectFirstN: 1,
      protectLastN: 1,
    });
    // Middle should be exactly the same objects
    assert.equal(result[1], msgs[1]);
    assert.equal(result[2], msgs[2]);
  });
});

// ────────────────────────────────────────────────────────────────
// estimateTokens
// ────────────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('returns 0 for empty message array', () => {
    assert.equal(estimateTokens([]), 0);
  });

  it('scales with content length', () => {
    const short = [userMsg('hi')];
    const long = [userMsg('x'.repeat(1000))];
    assert.ok(estimateTokens(long) > estimateTokens(short));
  });

  it('handles tool-result output objects', () => {
    const msgs = [toolMsg('c1', 'this is a tool result with some content')];
    const tokens = estimateTokens(msgs);
    assert.ok(tokens > 0);
  });
});

// ────────────────────────────────────────────────────────────────
// shouldAutoCompact (deprecated)
// ────────────────────────────────────────────────────────────────

describe('shouldAutoCompact (deprecated, kept for backwards-compat)', () => {
  it('returns false when messages are under 80% threshold', () => {
    const msgs = [userMsg('short')];
    assert.equal(shouldAutoCompact(msgs, 10_000), false);
  });

  it('returns true when estimated tokens exceed 80% of context window', () => {
    // 10_000 tokens threshold * 0.8 = 8_000. Need > 8_000 estimated.
    // Each char / 3.5 = tokens, so 8000 * 3.5 = 28_000 chars.
    const msgs = [userMsg('x'.repeat(30_000))];
    assert.equal(shouldAutoCompact(msgs, 10_000), true);
  });
});
