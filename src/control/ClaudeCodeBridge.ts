import { Agent, Task } from '../types';
import { AgentManager } from './AgentManager';
import { TaskManager } from './TaskManager';
import { SessionManager } from './SessionManager';
import { eventBus } from './EventBus';

interface ClaudeExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  parsed?: any;
  error?: string;
}

const FIND_SKILLS_SUMMARY = `You have access to the "find-skills" skill. When users ask about capabilities or how to do something, you can search for installable skills using: npx skills find [query]. Install with: npx skills add <package> -g -y. Browse at https://skills.sh/`;

export class ClaudeCodeBridge {
  private agentManager: AgentManager;
  private taskManager: TaskManager;
  private sessionManager: SessionManager;
  private workingDirectory: string = '';
  private activeExecutions: Map<string, boolean> = new Map();
  private progressCleanup: (() => void) | null = null;

  constructor(agentManager: AgentManager, taskManager: TaskManager) {
    this.agentManager = agentManager;
    this.taskManager = taskManager;
    this.sessionManager = new SessionManager();
    this.setupProgressListener();
    this.setupSessionListeners();
  }

  private setupProgressListener(): void {
    this.progressCleanup = window.workfarm.onClaudeCodeProgress((data) => {
      eventBus.emit('claude_progress', data);
    });
  }

  private setupSessionListeners(): void {
    eventBus.on('session_ended', (event) => {
      const { agentId, taskId, status } = event.data;
      const session = this.sessionManager.getSession(event.data.sessionId);

      if (status === 'completed') {
        // Extract result from session messages
        const assistantMessages = session?.messages
          .filter(m => m.type === 'assistant')
          .map(m => m.content) || [];
        const result = assistantMessages.join('\n') || 'Task completed';

        // Save to memory
        const task = this.taskManager.getTask(taskId);
        if (task) {
          this.agentManager.addConversation(agentId, 'user', task.description, taskId);
          this.agentManager.addConversation(agentId, 'assistant', result, taskId);
        }

        this.taskManager.completeTask(taskId, result);
        this.agentManager.incrementTasksCompleted(agentId);
        this.agentManager.unassignTask(agentId);
      } else if (status === 'error') {
        this.taskManager.failTask(taskId, 'Session ended with error');
        this.agentManager.unassignTask(agentId);
      }

      this.activeExecutions.delete(agentId);
      this.agentManager.save();
      this.taskManager.save();
    });
  }

  destroy(): void {
    if (this.progressCleanup) {
      this.progressCleanup();
      this.progressCleanup = null;
    }
    this.sessionManager.destroy();
  }

  async initialize(): Promise<void> {
    this.workingDirectory = await window.workfarm.getWorkingDirectory();

    // Clear any stale execution state from agents that were mid-task when app closed
    this.activeExecutions.clear();
    for (const agent of this.agentManager.getAllAgents()) {
      if (agent.state === 'working' || agent.state === 'thinking') {
        this.agentManager.updateAgentState(agent.id, 'idle');
      }
      if (agent.currentTaskId) {
        const task = this.taskManager.getTask(agent.currentTaskId);
        if (task && task.status === 'in_progress') {
          this.taskManager.failTask(agent.currentTaskId, 'Interrupted by app restart');
        }
        this.agentManager.unassignTask(agent.id);
      }
    }
  }

  setWorkingDirectory(dir: string): void {
    this.workingDirectory = dir;
  }

  async selectWorkingDirectory(): Promise<string | null> {
    const dir = await window.workfarm.selectDirectory();
    if (dir) {
      this.workingDirectory = dir;
      // Ensure skills are installed in the new project directory
      await this.ensureSkills();
    }
    return dir;
  }

  getWorkingDirectory(): string {
    return this.workingDirectory;
  }

  getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  private async ensureSkills(): Promise<void> {
    if (!this.workingDirectory) return;
    try {
      await window.workfarm.ensureSkills(this.workingDirectory);
    } catch (error) {
      console.error('Failed to ensure skills:', error);
    }
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

    console.log('[executeTask] agent:', agent?.name, 'task:', task?.id, 'activeExecutions:', this.activeExecutions.get(agentId));

    if (!agent || !task) {
      console.error('[executeTask] Agent or task not found');
      return { success: false, response: '', error: 'Agent or task not found' };
    }

    if (this.activeExecutions.get(agentId)) {
      console.error('[executeTask] Agent is busy — activeExecutions stuck');
      return { success: false, response: '', error: 'Agent is busy' };
    }

    this.activeExecutions.set(agentId, true);

    try {
      console.log('[executeTask] step 1: updating state');
      this.agentManager.updateAgentState(agentId, 'thinking');
      this.taskManager.startTask(taskId);
      this.taskManager.addLog(taskId, `${agent.name} started working`);

      console.log('[executeTask] step 2: ensuring skills, workingDir:', this.workingDirectory);
      // Ensure skills before starting
      await this.ensureSkills();

      console.log('[executeTask] step 3: building prompt');
      const prompt = this.buildPrompt(agent, task);

      console.log('[executeTask] step 4: starting session');
      // Start an interactive session instead of one-shot execution
      await this.sessionManager.startSession(
        agentId,
        taskId,
        prompt,
        this.workingDirectory,
        FIND_SKILLS_SUMMARY
      );

      console.log('[executeTask] step 5: session started');
      // Session completion is handled asynchronously via session_ended event
      return { success: true, response: 'Session started' };
    } catch (error) {
      console.error('[executeTask] caught error:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.taskManager.failTask(taskId, errorMsg);
      this.agentManager.unassignTask(agentId);
      this.activeExecutions.delete(agentId);
      return { success: false, response: '', error: errorMsg };
    }
  }

  async sendMessageToAgent(agentId: string, message: string): Promise<boolean> {
    const session = this.sessionManager.getActiveSessionForAgent(agentId);
    if (!session) return false;

    try {
      await this.sessionManager.sendMessage(session.id, message, this.workingDirectory);
      return true;
    } catch (error) {
      console.error('Failed to send message to agent:', error);
      return false;
    }
  }

  async cancelExecution(agentId: string): Promise<boolean> {
    // Try session-based cancellation first
    const session = this.sessionManager.getActiveSessionForAgent(agentId);
    if (session) {
      await this.sessionManager.stopSession(session.id);
      this.activeExecutions.delete(agentId);
      this.agentManager.updateAgentState(agentId, 'idle');
      return true;
    }

    // Fall back to legacy cancellation
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
