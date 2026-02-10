import { Agent, Task } from '../types';
import { AgentManager } from './AgentManager';
import { TaskManager } from './TaskManager';
import { eventBus } from './EventBus';

interface ClaudeExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  parsed?: any;
  error?: string;
}

export class ClaudeCodeBridge {
  private agentManager: AgentManager;
  private taskManager: TaskManager;
  private workingDirectory: string = '';
  private activeExecutions: Map<string, boolean> = new Map();
  private progressCleanup: (() => void) | null = null;

  constructor(agentManager: AgentManager, taskManager: TaskManager) {
    this.agentManager = agentManager;
    this.taskManager = taskManager;
    this.setupProgressListener();
  }

  private setupProgressListener(): void {
    this.progressCleanup = window.workfarm.onClaudeCodeProgress((data) => {
      eventBus.emit('claude_progress', data);
    });
  }

  destroy(): void {
    if (this.progressCleanup) {
      this.progressCleanup();
      this.progressCleanup = null;
    }
  }

  async initialize(): Promise<void> {
    this.workingDirectory = await window.workfarm.getWorkingDirectory();
  }

  setWorkingDirectory(dir: string): void {
    this.workingDirectory = dir;
  }

  async selectWorkingDirectory(): Promise<string | null> {
    const dir = await window.workfarm.selectDirectory();
    if (dir) {
      this.workingDirectory = dir;
    }
    return dir;
  }

  getWorkingDirectory(): string {
    return this.workingDirectory;
  }

  private buildPrompt(agent: Agent, task: Task): string {
    const memory = this.agentManager.getAgentMemory(agent.id);
    const parts: string[] = [];

    parts.push(`You are ${agent.name}, a helpful assistant working on tasks.`);
    parts.push(`\nTask: ${task.description}`);

    // Add recent context
    if (memory && memory.conversations.length > 0) {
      const recent = memory.conversations.slice(-3);
      parts.push(`\nRecent context:`);
      recent.forEach((c) => {
        parts.push(`[${c.role}]: ${c.content.substring(0, 200)}`);
      });
    }

    parts.push(`\nPlease complete this task. Be concise and effective.`);

    return parts.join('\n');
  }

  async executeTask(agentId: string, taskId: string): Promise<{
    success: boolean;
    response: string;
    error?: string;
  }> {
    const agent = this.agentManager.getAgent(agentId);
    const task = this.taskManager.getTask(taskId);

    if (!agent || !task) {
      return { success: false, response: '', error: 'Agent or task not found' };
    }

    if (this.activeExecutions.get(agentId)) {
      return { success: false, response: '', error: 'Agent is busy' };
    }

    this.activeExecutions.set(agentId, true);

    try {
      this.agentManager.updateAgentState(agentId, 'thinking');
      this.taskManager.startTask(taskId);
      this.taskManager.addLog(taskId, `${agent.name} started working`);

      const prompt = this.buildPrompt(agent, task);

      const result: ClaudeExecuteResult = await window.workfarm.claudeCodeExecute({
        agentId,
        prompt,
        workingDirectory: this.workingDirectory,
        thinkingBudget: 'medium',
      });

      if (result.exitCode === 0) {
        const response = result.parsed?.result || result.stdout || 'Task completed';

        // Save to memory
        this.agentManager.addConversation(agentId, 'user', task.description, taskId);
        this.agentManager.addConversation(agentId, 'assistant', response, taskId);

        // Update task
        this.taskManager.completeTask(taskId, response);
        this.agentManager.incrementTasksCompleted(agentId);
        this.agentManager.unassignTask(agentId);

        return { success: true, response };
      } else {
        const errorMsg = result.error || result.stderr || 'Unknown error';
        this.taskManager.failTask(taskId, errorMsg);
        this.agentManager.unassignTask(agentId);

        return { success: false, response: '', error: errorMsg };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.taskManager.failTask(taskId, errorMsg);
      this.agentManager.unassignTask(agentId);
      return { success: false, response: '', error: errorMsg };
    } finally {
      this.activeExecutions.delete(agentId);
      await this.agentManager.save();
      await this.taskManager.save();
    }
  }

  async cancelExecution(agentId: string): Promise<boolean> {
    const result = await window.workfarm.claudeCodeCancel(agentId);
    if (result.success) {
      this.activeExecutions.delete(agentId);
      this.agentManager.updateAgentState(agentId, 'idle');
    }
    return result.success;
  }

  isExecuting(agentId: string): boolean {
    return this.activeExecutions.get(agentId) || false;
  }
}
