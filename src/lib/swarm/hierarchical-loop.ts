import { streamClaude } from '@/lib/claude-client';
import { addMessage, getSession } from '@/lib/db';
import type { SwarmConfig, SwarmLogEntry, SwarmAgentStatus, SwarmTaskStatus, SwarmStats, SwarmToolStat, SwarmSkillStat, SwarmExternalStat } from '@/types';

/** Tool names that indicate a Skill invocation (provider-agnostic) */
const SKILL_TOOL_NAMES = ['Skill', 'skill', 'use_skill', 'useSkill', 'invoke_skill'];

/** Tool names that indicate an external capability call */
const EXTERNAL_TOOL_NAMES = ['Bash', 'bash', 'mcp', 'mcp_tool', 'http', 'fetch', 'curl', 'web_fetch', 'browser'];

export interface LoopCallbacks {
  onAgentStatus: (agentId: string, status: SwarmAgentStatus, work?: string, progress?: number) => void;
  onTaskUpdate: (taskId: string, status: SwarmTaskStatus) => void;
  onLog: (entry: Omit<SwarmLogEntry, 'id' | 'timestamp'>) => void;
  onIteration: (iteration: number) => void;
  onToolCall: (agentId: string, toolName: string) => void;
  onComplete: (error?: string, stats?: SwarmStats) => void;
  shouldStop: () => boolean;
  getInterventions?: () => string[];
}

interface SubTask {
  id: string;
  title: string;
  description: string;
}

/**
 * Hierarchical two-phase execution:
 * Phase 1 — Planner: analyze objective, output JSON subtask list
 * Phase 2 — Coder: execute each subtask via streamClaude
 */
export async function runHierarchicalLoop(params: {
  sessionId: string;
  objective: string;
  config: SwarmConfig;
  modelOverride?: string;
  abortSignal?: AbortSignal;
  callbacks: LoopCallbacks;
}): Promise<void> {
  const { sessionId, objective, config, modelOverride, abortSignal, callbacks } = params;
  const { maxIterations } = config;

  callbacks.onAgentStatus('planner', 'running', 'Analyzing task...', 0);
  callbacks.onLog({ agentId: 'planner', message: 'Starting planning phase...', type: 'info' });

  const statsAccum = { tools: [] as SwarmToolStat[], skills: [] as SwarmSkillStat[], externals: [] as SwarmExternalStat[] };

  try {
    const session = getSession(sessionId);
    if (!session) {
      callbacks.onComplete('Session not found', { tools: [], skills: [], externals: [], agents: {} });
      return;
    }

    const planningPrompt = `Analyze the following objective and break it down into 2-5 concrete subtasks.

<objective>
${objective}
</objective>

Respond ONLY with a JSON array of subtasks in this format:
[{"id": "1", "title": "Short title", "description": "Detailed description"}, ...]`;

    const planResult = await runSingleTurn({
      sessionId,
      prompt: planningPrompt,
      modelOverride,
      session,
      callbacks,
      agentId: 'planner',
    });
    const subtasks = planResult.text;
    statsAccum.tools.push(...planResult.stats.tools);
    statsAccum.skills.push(...planResult.stats.skills);
    statsAccum.externals.push(...planResult.stats.externals);

    if (callbacks.shouldStop()) {
      callbacks.onComplete('User stopped', { ...statsAccum, agents: { planner: { iterations: 1, toolCalls: statsAccum.tools.length, skillCalls: statsAccum.skills.length, externalCalls: statsAccum.externals.length, statusHistory: [] } } });
      return;
    }

    // Parse subtasks from the response
    let parsedTasks: SubTask[] = [];
    try {
      const jsonMatch = subtasks.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        parsedTasks = JSON.parse(jsonMatch[0]);
      }
    } catch { /* parse failed, fall back to single task */ }

    if (parsedTasks.length === 0) {
      parsedTasks = [{ id: '1', title: 'Execute objective', description: objective }];
    }

    // Create task entries in state
    for (const task of parsedTasks) {
      callbacks.onTaskUpdate(`task-${task.id}`, 'queued');
    }

    callbacks.onAgentStatus('planner', 'completed', `Planned ${parsedTasks.length} subtasks`, 100);
    callbacks.onLog({ agentId: 'planner', message: `Created ${parsedTasks.length} subtasks`, type: 'info' });

    // Phase 2: Coder executes each subtask
    for (let i = 0; i < parsedTasks.length; i++) {
      if (callbacks.shouldStop()) {
        callbacks.onComplete('User stopped', { ...statsAccum, agents: {
          planner: { iterations: 1, toolCalls: statsAccum.tools.length, skillCalls: statsAccum.skills.length, externalCalls: statsAccum.externals.length, statusHistory: [] },
          coder: { iterations: i + 1, toolCalls: statsAccum.tools.length, skillCalls: statsAccum.skills.length, externalCalls: statsAccum.externals.length, statusHistory: [] },
        } });
        return;
      }

      const task = parsedTasks[i];
      callbacks.onTaskUpdate(`task-${task.id}`, 'running');
      callbacks.onAgentStatus('coder', 'running', `Working on: ${task.title}`, Math.floor((i / parsedTasks.length) * 100));
      callbacks.onLog({ agentId: 'coder', message: `Starting subtask: ${task.title}`, type: 'info' });

      const interventionContext = callbacks.getInterventions
        ? (() => {
            const interventions = callbacks.getInterventions!();
            if (interventions.length === 0) return '';
            for (const msg of interventions) {
              callbacks.onLog({ agentId: 'coder', message: `User intervention: ${msg.slice(0, 80)}${msg.length > 80 ? '...' : ''}`, type: 'info' });
            }
            return '\n\n<user_interventions>\n'
              + interventions.map(m => `<message>${m}</message>`).join('\n')
              + '\nIncorporate these instructions into your work.\n</user_interventions>\n';
          })()
        : '';

      const coderPrompt = `Execute the following subtask as part of the larger objective:

Overall objective: ${objective}

Current subtask (${i + 1}/${parsedTasks.length}):
Title: ${task.title}
Description: ${task.description}
${interventionContext}
Use your tools to complete this subtask. When done, respond with a brief summary.`;

      const coderResult = await runSingleTurn({
        sessionId,
        prompt: coderPrompt,
        modelOverride,
        session,
        callbacks,
        agentId: 'coder',
      });
      statsAccum.tools.push(...coderResult.stats.tools);
      statsAccum.skills.push(...coderResult.stats.skills);
      statsAccum.externals.push(...coderResult.stats.externals);

      callbacks.onTaskUpdate(`task-${task.id}`, 'completed');
      callbacks.onLog({ agentId: 'coder', message: `Completed: ${task.title}`, type: 'info' });
      callbacks.onIteration(i + 1);

      if (i + 1 >= maxIterations) break;
    }

    callbacks.onAgentStatus('coder', 'completed', 'All subtasks completed', 100);
    callbacks.onComplete(undefined, {
      tools: statsAccum.tools,
      skills: statsAccum.skills,
      externals: statsAccum.externals,
      agents: {
        planner: { iterations: 1, toolCalls: statsAccum.tools.length, skillCalls: statsAccum.skills.length, externalCalls: statsAccum.externals.length, statusHistory: [] },
        coder: { iterations: parsedTasks.length, toolCalls: statsAccum.tools.length, skillCalls: statsAccum.skills.length, externalCalls: statsAccum.externals.length, statusHistory: [] },
      },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    callbacks.onLog({ agentId: 'planner', message: `Error: ${errMsg}`, type: 'error' });
    callbacks.onComplete(errMsg, { ...statsAccum, agents: { planner: { iterations: 1, toolCalls: statsAccum.tools.length, skillCalls: statsAccum.skills.length, externalCalls: statsAccum.externals.length, statusHistory: [] } } });
  }
}

async function runSingleTurn(params: {
  sessionId: string;
  prompt: string;
  modelOverride?: string;
  session: ReturnType<typeof getSession>;
  callbacks: LoopCallbacks;
  agentId: string;
}): Promise<{ text: string; stats: SwarmStats }> {
  const { sessionId, prompt, modelOverride, session, callbacks, agentId } = params;

  const localAbort = new AbortController();
  const toolStats: SwarmToolStat[] = [];
  const skillStats: SwarmSkillStat[] = [];
  const externalStats: SwarmExternalStat[] = [];
  const activeToolStart = new Map<string, number>();

  const stream = streamClaude({
    prompt,
    sessionId,
    sdkSessionId: session?.sdk_session_id || undefined,
    model: modelOverride || session?.model || undefined,
    workingDirectory: session?.working_directory || undefined,
    abortController: localAbort,
    permissionMode: 'acceptEdits',
    bypassPermissions: true,
    autoTrigger: false,
  });

  const reader = stream.getReader();
  let textBuffer = '';

  try {
    while (true) {
      if (callbacks.shouldStop()) {
        localAbort.abort();
        break;
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
              break;
            case 'tool_use':
              try {
                const toolData = JSON.parse(event.data);
                callbacks.onToolCall(agentId, toolData.name);
                activeToolStart.set(`${toolData.name}_${Date.now()}`, Date.now());
              } catch { /* ignore */ }
              break;
            case 'tool_result':
              try {
                const resultData = JSON.parse(event.data);
                const toolName = resultData.tool_name || 'unknown';
                // Find and remove the matching start time
                let duration: number | undefined;
                for (const [key, startTime] of activeToolStart) {
                  if (key.startsWith(`${toolName}_`)) {
                    duration = Date.now() - startTime;
                    activeToolStart.delete(key);
                    break;
                  }
                }
                const content = typeof resultData.content === 'string'
                  ? resultData.content.slice(0, 100)
                  : '';
                const input = typeof resultData.input === 'string'
                  ? resultData.input.slice(0, 200)
                  : '';
                const success = !resultData.is_error;
                toolStats.push({
                  name: toolName, agentId, timestamp: Date.now(),
                  success, error: resultData.is_error ? content : undefined,
                  duration, input,
                });
                // Categorize
                if (SKILL_TOOL_NAMES.includes(toolName)) {
                  skillStats.push({
                    name: input.slice(0, 50) || toolName, agentId,
                    timestamp: Date.now(), result: content.slice(0, 100),
                  });
                } else if (EXTERNAL_TOOL_NAMES.some(n => n.toLowerCase() === toolName.toLowerCase())) {
                  externalStats.push({
                    type: ['Bash', 'bash'].includes(toolName) ? 'cli' : 'mcp',
                    name: toolName, agentId, timestamp: Date.now(),
                    success, input: input.slice(0, 150), output: content.slice(0, 150),
                  });
                }
              } catch { /* ignore */ }
              break;
            case 'error':
              callbacks.onLog({ agentId, message: `Error: ${event.data}`, type: 'error' });
              break;
          }
        } catch { /* ignore */ }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (textBuffer.trim()) {
    addMessage(sessionId, 'assistant', textBuffer);
  }

  return {
    text: textBuffer,
    stats: { tools: toolStats, skills: skillStats, externals: externalStats, agents: { [agentId]: { iterations: 1, toolCalls: toolStats.length, skillCalls: skillStats.length, externalCalls: externalStats.length, statusHistory: [] } } },
  };
}
