import { streamClaude } from '@/lib/claude-client';
import { addMessage, getSession } from '@/lib/db';
import type { SwarmConfig, SwarmLogEntry, SwarmAgentStatus, SwarmTaskStatus } from '@/types';

export interface LoopCallbacks {
  onAgentStatus: (agentId: string, status: SwarmAgentStatus, work?: string, progress?: number) => void;
  onTaskUpdate: (taskId: string, status: SwarmTaskStatus) => void;
  onLog: (entry: Omit<SwarmLogEntry, 'id' | 'timestamp'>) => void;
  onIteration: (iteration: number) => void;
  onToolCall: (agentId: string, toolName: string) => void;
  onComplete: (error?: string) => void;
  shouldStop: () => boolean;
}

/**
 * Run an autonomous loop: single agent iterates on an objective
 * until satisfied or max iterations reached.
 *
 * Uses the existing streamClaude infrastructure (SDK query, MCP, permissions).
 * Each iteration: send prompt → collect response → check completion → repeat.
 */
export async function runAutonomousLoop(params: {
  sessionId: string;
  objective: string;
  config: SwarmConfig;
  modelOverride?: string;  // resolved model from active provider
  abortSignal?: AbortSignal;
  callbacks: LoopCallbacks;
}): Promise<void> {
  const { sessionId, objective, config, modelOverride, abortSignal, callbacks } = params;
  const { maxIterations, autoRetry } = config;

  const agentId = 'autonomous';

  // Build the system prompt for autonomous mode
  const systemPrompt = `You are working in autonomous mode. Your objective is:

<objective>
${objective}
</objective>

Work on this objective step by step. Use your tools to read and modify files as needed.
When you believe the objective is fully complete, end your response with the marker:
__SWARM_TASK_COMPLETE__

If you encounter errors, try to recover. You have up to ${maxIterations} iterations to complete the task.`;

  callbacks.onAgentStatus(agentId, 'running', 'Starting autonomous loop...', 0);
  callbacks.onLog({ agentId, message: `Initialized with objective: ${objective.slice(0, 80)}...`, type: 'info' });

  let iteration = 0;
  let taskComplete = false;
  let lastResponseText = '';

  // Local abort controller — linked to external abortSignal if provided
  const localAbort = new AbortController();
  if (abortSignal) {
    abortSignal.addEventListener('abort', () => localAbort.abort());
  }

  while (iteration < maxIterations && !taskComplete) {
    if (callbacks.shouldStop()) {
      callbacks.onComplete('User stopped the swarm');
      return;
    }

    iteration++;
    callbacks.onIteration(iteration);
    callbacks.onAgentStatus(agentId, 'running', `Iteration ${iteration}/${maxIterations}`, 0);
    callbacks.onLog({ agentId, message: `Starting iteration ${iteration}/${maxIterations}...`, type: 'info' });

    try {
      // Build the prompt for this iteration
      const prompt = iteration === 1
        ? objective
        : `Continue working on the objective. Previous response:\n\n${lastResponseText.slice(0, 3000)}\n\nProceed with the next steps. End with __SWARM_TASK_COMPLETE__ when done.`;

      // Get session info for streamClaude
      const session = getSession(sessionId);
      if (!session) {
        callbacks.onComplete('Session not found');
        return;
      }

      // Stream the response — use resolved model from active provider,
      // falling back to session model if no override was given
      const stream = streamClaude({
        prompt,
        sessionId,
        sdkSessionId: session.sdk_session_id || undefined,
        model: modelOverride || session.model || undefined,
        systemPrompt,
        workingDirectory: session.working_directory || undefined,
        abortController: localAbort,
        permissionMode: 'acceptEdits',
        bypassPermissions: true,
        autoTrigger: false,
      });

      // Read the stream and collect events
      const reader = stream.getReader();
      let textBuffer = '';
      let hasToolCalls = false;
      let hasError = false;

      try {
        while (true) {
          if (callbacks.shouldStop() || abortSignal?.aborted) {
            localAbort.abort();
            callbacks.onComplete('User stopped the swarm');
            return;
          }

          const { done, value } = await reader.read();
          if (done) break;

          const lines = value.split('\n');
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const event = JSON.parse(line.slice(6));
              switch (event.type) {
                case 'text':
                  textBuffer += event.data;
                  const progress = Math.min(90, Math.floor((textBuffer.length / 2000) * 90));
                  callbacks.onAgentStatus(agentId, 'running', `Writing response (${textBuffer.length} chars)`, progress);
                  break;
                case 'tool_use':
                  hasToolCalls = true;
                  try {
                    const toolData = JSON.parse(event.data);
                    callbacks.onToolCall(agentId, toolData.name);
                    callbacks.onLog({ agentId, message: `Calling ${toolData.name}...`, type: 'tool_call' });
                    callbacks.onAgentStatus(agentId, 'running', `Tool: ${toolData.name}`, undefined);
                  } catch { /* ignore parse errors */ }
                  break;
                case 'tool_result':
                  try {
                    const resultData = JSON.parse(event.data);
                    const isErr = resultData.is_error ? ' (error)' : '';
                    const content = typeof resultData.content === 'string'
                      ? resultData.content.slice(0, 100)
                      : '';
                    callbacks.onLog({ agentId, message: `Tool result${isErr}: ${content}`, type: 'tool_result' });
                  } catch { /* ignore */ }
                  break;
                case 'error':
                  callbacks.onLog({ agentId, message: `Error: ${event.data}`, type: 'error' });
                  break;
                case 'result':
                  try {
                    const resultData = JSON.parse(event.data);
                    if (resultData.is_error) {
                      hasError = true;
                      callbacks.onLog({ agentId, message: `Turn failed: ${resultData.subtype || 'unknown error'}`, type: 'error' });
                    }
                  } catch { /* ignore */ }
                  break;
              }
            } catch { /* ignore malformed events */ }
          }
        }
      } finally {
        reader.releaseLock();
      }

      lastResponseText = textBuffer;

      // Persist assistant message
      if (textBuffer.trim()) {
        addMessage(sessionId, 'assistant', textBuffer);
      }

      // Check for completion:
      // 1. Model explicitly marked complete
      // 2. Model produced text but no tool calls → it's done
      // 3. Model errored with no tool calls → retry or stop
      if (textBuffer.includes('__SWARM_TASK_COMPLETE__')) {
        taskComplete = true;
        callbacks.onLog({ agentId, message: 'Task marked complete by agent.', type: 'info' });
        break;
      }

      if (!hasToolCalls && textBuffer.trim().length > 20 && !hasError) {
        // Model responded with text but no tool calls — consider it done
        taskComplete = true;
        callbacks.onLog({ agentId, message: 'Agent completed (no tool calls needed).', type: 'info' });
        break;
      }

      if (hasError && !hasToolCalls) {
        // Turn failed and no work was done
        if (!autoRetry) {
          callbacks.onComplete('Agent turn failed with no tool calls');
          return;
        }
        callbacks.onLog({ agentId, message: 'Retrying after failed turn...', type: 'info' });
      }

      // Small delay between iterations to avoid rate limiting
      if (iteration < maxIterations && !taskComplete) {
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (error) {
      if (abortSignal?.aborted || localAbort.signal.aborted) {
        callbacks.onComplete('User stopped the swarm');
        return;
      }

      const errMsg = error instanceof Error ? error.message : String(error);
      callbacks.onLog({ agentId, message: `Iteration ${iteration} failed: ${errMsg}`, type: 'error' });

      if (!autoRetry) {
        callbacks.onComplete(`Iteration ${iteration} failed: ${errMsg}`);
        return;
      }

      // Rate-limit backoff between retries
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // Final status
  if (taskComplete) {
    callbacks.onAgentStatus(agentId, 'completed', 'Task completed successfully', 100);
    callbacks.onLog({ agentId, message: 'Swarm completed successfully.', type: 'info' });
  } else {
    callbacks.onAgentStatus(agentId, 'stopped', `Completed after ${iteration} iterations`, 100);
    callbacks.onLog({ agentId, message: `Swarm finished after ${iteration} iterations.`, type: 'info' });
  }

  callbacks.onComplete();
}
