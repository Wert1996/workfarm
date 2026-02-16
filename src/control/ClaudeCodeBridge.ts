import { Agent, Task, AgentGoal, AgentPlan, PlanStep } from '../types';
import { RuntimeAdapter } from './RuntimeAdapter';
import { AgentManager } from './AgentManager';
import { TaskManager } from './TaskManager';
import { SessionManager } from './SessionManager';
import { eventBus } from './EventBus';

const FIND_SKILLS_SUMMARY = `You have access to the "find-skills" skill. When users ask about capabilities or how to do something, you can search for installable skills using: npx skills find [query]. Install with: npx skills add <package> -g -y. Browse at https://skills.sh/`;

export class ClaudeCodeBridge {
  private runtime: RuntimeAdapter;
  private agentManager: AgentManager;
  private taskManager: TaskManager;
  private sessionManager: SessionManager;
  private workingDirectory: string = '';
  private workspaceRoots: string[] = [];
  private activeExecutions: Map<string, boolean> = new Map();
  private progressCleanup: (() => void) | null = null;

  constructor(runtime: RuntimeAdapter, agentManager: AgentManager, taskManager: TaskManager) {
    this.runtime = runtime;
    this.agentManager = agentManager;
    this.taskManager = taskManager;
    this.sessionManager = new SessionManager(runtime);
    this.setupProgressListener();
    this.setupSessionListeners();
  }

  private setupProgressListener(): void {
    this.progressCleanup = this.runtime.onClaudeCodeProgress((data) => {
      eventBus.emit('claude_progress', data);
    });
  }

  private setupSessionListeners(): void {
    // Listen for permission requests (UI handles the actual prompt)
    eventBus.on('permission_requested', () => {
      // No-op here; UIScene handles the user prompt.
      // The session is paused in waiting_input state.
    });

    eventBus.on('session_ended', (event) => {
      const { agentId, taskId, status } = event.data;
      const session = this.sessionManager.getSession(event.data.sessionId);

      // Skip cleanup if session is paused for permission approval
      if (session && session.status === 'waiting_input') return;

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
    this.workingDirectory = await this.runtime.getWorkingDirectory();

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
    const dir = await this.runtime.selectDirectory();
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

  setWorkspaceRoots(roots: string[]): void {
    this.workspaceRoots = roots;
  }

  getWorkspaceRoots(): string[] {
    return this.workspaceRoots;
  }

  getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  private async ensureSkills(): Promise<void> {
    if (!this.workingDirectory) return;
    try {
      await this.runtime.ensureSkills(this.workingDirectory);
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

  async executeTask(agentId: string, taskId: string, maxTurns?: number, workingDirectory?: string): Promise<{
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

      const effectiveDir = workingDirectory || this.workingDirectory;
      console.log('[executeTask] step 2: ensuring skills, workingDir:', effectiveDir);
      // Ensure skills before starting
      await this.ensureSkills();

      console.log('[executeTask] step 3: building prompt');
      const prompt = this.buildPrompt(agent, task);

      console.log('[executeTask] step 4: starting session');
      // Start an interactive session instead of one-shot execution
      const systemPrompt = agent.systemPrompt
        ? `${agent.systemPrompt}\n\n${FIND_SKILLS_SUMMARY}`
        : FIND_SKILLS_SUMMARY;
      await this.sessionManager.startSession(
        agentId,
        taskId,
        prompt,
        effectiveDir,
        systemPrompt,
        agent.approvedTools,
        maxTurns,
        this.workspaceRoots
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

  async approveToolPermission(agentId: string, toolName: string): Promise<void> {
    const session = this.sessionManager.getActiveSessionForAgent(agentId);
    if (session) {
      // Resolve the correctly-cased tool name from pending permissions
      const { resolved, allApproved } = this.sessionManager.approvePermission(session.id, toolName);
      this.agentManager.addApprovedTool(agentId, resolved);
      if (allApproved) {
        await this.sessionManager.resumeSession(
          session.id,
          this.agentManager.getApprovedTools(agentId),
          this.workingDirectory
        );
      }
    } else {
      // No active session — just store the tool for future use
      this.agentManager.addApprovedTool(agentId, toolName);
    }
  }

  denyToolPermission(agentId: string): void {
    const session = this.sessionManager.getActiveSessionForAgent(agentId);
    if (session) {
      this.sessionManager.denyPermission(session.id);
    }
    // Normal session_ended flow handles cleanup
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
    const result = await this.runtime.claudeCodeCancel(agentId);
    if (result.success) {
      this.activeExecutions.delete(agentId);
      this.agentManager.updateAgentState(agentId, 'idle');
    }
    return result.success;
  }

  isExecuting(agentId: string): boolean {
    return this.activeExecutions.get(agentId) || false;
  }

  // --- Goal-aware prompt builders ---

  buildGoalPrompt(agent: Agent, goal: AgentGoal, plan: AgentPlan, step: PlanStep, preferenceContext?: string): string {
    const parts: string[] = [];

    parts.push(`You are ${agent.name}, an autonomous agent managed by the workfarm system.`);
    parts.push(`You are NOT advising a human. You ARE the one doing the implementation.`);
    parts.push(`IMPORTANT: You are operating under a STRICT GOAL assigned by your manager. Do not infer, rename, or reinterpret the goal. Follow it exactly as stated.`);
    if (goal.systemPrompt) {
      parts.push(`\n${goal.systemPrompt}`);
    }

    parts.push(`\n=== YOUR ASSIGNED GOAL (do not modify) ===`);
    parts.push(`"${goal.description}"`);
    parts.push(`Working directory: ${goal.workingDirectory || this.workingDirectory}`);
    if (this.workspaceRoots.length > 0) {
      parts.push(`Workspace roots (you have access to these):\n${this.workspaceRoots.map(r => `  - ${r}`).join('\n')}`);
    }
    parts.push(`===========================================`);

    if (goal.constraints.length > 0) {
      parts.push(`\nConstraints:\n${goal.constraints.map(c => `- ${c}`).join('\n')}`);
    }

    if (preferenceContext) {
      parts.push(`\n${preferenceContext}`);
    }

    parts.push(`\nPlan (v${plan.version}):`);
    for (const s of plan.steps) {
      const marker = s.id === step.id ? '>>>' : '   ';
      const statusIcon = s.status === 'completed' ? '[done]' : s.status === 'failed' ? '[fail]' : s.status === 'in_progress' ? '[...]' : '[   ]';
      parts.push(`${marker} ${statusIcon} Step ${s.order + 1}: ${s.description}`);
      if (s.result && s.id !== step.id) {
        parts.push(`       Result: ${s.result.substring(0, 200)}`);
      }
    }

    parts.push(`\nYour current task: Step ${step.order + 1}: ${step.description}`);
    parts.push(`\nComplete this step. Be concise and effective. Stay within the scope of your assigned goal.`);
    parts.push(`\nBefore asking the user a question, check if your known preferences already answer it. If so, decide autonomously and note "[Used preference: <key>]" in your response.`);
    parts.push(`If you encounter genuine uncertainty, a judgment call, or conflicting approaches with no matching preference — do NOT guess. End your response with "[NEEDS_INPUT]: your question here" and stop working.`);

    return parts.join('\n');
  }

  buildPlanningPrompt(
    agent: Agent,
    goal: AgentGoal,
    previousResults?: { step: string; result: string }[],
    preferenceContext?: string,
    cycleNumber?: number
  ): string {
    const parts: string[] = [];

    parts.push(`You are ${agent.name}, a planning agent managed by the workfarm system.`);
    parts.push(`This is a PLANNING PHASE ONLY. Do NOT execute any part of the goal yet.`);
    parts.push(`You may read and research to understand what's needed, but your only output should be a JSON plan.`);
    parts.push(`IMPORTANT: You must plan EXACTLY for the goal below. Do not infer a different project name, rename the goal, or reinterpret what you're working on. The goal is authoritative.`);

    parts.push(`\n=== YOUR ASSIGNED GOAL (do not modify) ===`);
    parts.push(`"${goal.description}"`);
    parts.push(`Working directory: ${goal.workingDirectory || this.workingDirectory}`);
    if (this.workspaceRoots.length > 0) {
      parts.push(`Workspace roots (you have access to these):\n${this.workspaceRoots.map(r => `  - ${r}`).join('\n')}`);
    }
    parts.push(`===========================================`);

    if (goal.constraints.length > 0) {
      parts.push(`\nConstraints:\n${goal.constraints.map(c => `- ${c}`).join('\n')}`);
    }

    if (preferenceContext) {
      parts.push(`\n${preferenceContext}`);
    }

    if (previousResults && previousResults.length > 0) {
      parts.push(`\nPrevious results${cycleNumber ? ` (cycle ${cycleNumber})` : ''}:`);
      for (const pr of previousResults) {
        parts.push(`- ${pr.step}: ${pr.result.substring(0, 200)}`);
      }
    }

    parts.push(`\nYour job is to output a plan. After reading what you need, respond with ONLY a JSON object in this format:`);
    parts.push(`{`);
    parts.push(`  "reasoning": "why this plan",`);
    parts.push(`  "recurring": true/false,`);
    parts.push(`  "interval_minutes": number or null,`);
    parts.push(`  "cycle_goal": "what this cycle should accomplish" or null,`);
    parts.push(`  "completion_criteria": "when to stop cycling entirely" or null,`);
    parts.push(`  "steps": [{"description": "step description"}, ...]`);
    parts.push(`}`);
    parts.push(`\nSet "recurring": true if this goal needs ongoing cycles (monitoring, maintenance, continuous improvement).`);
    parts.push(`Set "recurring": false if this is a one-time task with a clear end state.`);
    parts.push(`If recurring, suggest an interval_minutes for how often to re-check, and completion_criteria for when to stop.`);
    parts.push(`\nKeep steps concrete and actionable. Output valid JSON only, no markdown fences.`);

    return parts.join('\n');
  }

  async startConversation(
    agentId: string,
    message: string,
    context: string
  ): Promise<{ success: boolean; error?: string }> {
    const agent = this.agentManager.getAgent(agentId);
    if (!agent) return { success: false, error: 'Agent not found' };

    // If agent has an active session, send to it
    const activeSession = this.sessionManager.getActiveSessionForAgent(agentId);
    if (activeSession) {
      try {
        await this.sessionManager.sendMessage(activeSession.id, message, this.workingDirectory);
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    // Start a new conversation session (no task)
    const conversationTaskId = 'conversation';
    const systemPrompt = agent.systemPrompt
      ? `${agent.systemPrompt}\n\n${context}`
      : context;

    eventBus.emit('conversation_started', { agentId, message });

    try {
      await this.sessionManager.startSession(
        agentId,
        conversationTaskId,
        message,
        this.workingDirectory,
        systemPrompt,
        agent.approvedTools,
        undefined,
        this.workspaceRoots
      );
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async continueConversation(agentId: string, message: string): Promise<{ success: boolean; error?: string }> {
    const session = this.sessionManager.getActiveSessionForAgent(agentId);
    if (!session) return { success: false, error: 'No active session for this agent' };

    try {
      await this.sessionManager.sendMessage(session.id, message, this.workingDirectory);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
}
