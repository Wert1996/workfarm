import { v4 as uuidv4 } from 'uuid';
import { AgentGoal, AgentPlan, PlanStep } from '../types';
import { ILLMClient } from './LLMClient';
import { GoalManager } from './GoalManager';
import { AgentManager } from './AgentManager';
import { TaskManager } from './TaskManager';
import { ClaudeCodeBridge } from './ClaudeCodeBridge';
import { PreferenceManager } from './PreferenceManager';
import { eventBus } from './EventBus';

const NEEDS_INPUT_MARKER = '[NEEDS_INPUT]:';
const USED_PREFERENCE_REGEX = /\[Used preference:\s*([^\]]+)\]/g;

export class AdversaryAgent {
  private llm: ILLMClient;
  private goalManager: GoalManager;
  private agentManager: AgentManager;
  private taskManager: TaskManager;
  private bridge: ClaudeCodeBridge;
  private preferenceManager: PreferenceManager | null = null;
  private activeGoals: Set<string> = new Set();
  private stepTaskMap: Map<string, { goalId: string; stepId: string }> = new Map();
  private retryMap: Map<string, number> = new Map(); // stepId -> retryCount
  private eventCleanups: (() => void)[] = [];

  constructor(
    llm: ILLMClient,
    goalManager: GoalManager,
    agentManager: AgentManager,
    taskManager: TaskManager,
    bridge: ClaudeCodeBridge,
    preferenceManager?: PreferenceManager
  ) {
    this.llm = llm;
    this.goalManager = goalManager;
    this.agentManager = agentManager;
    this.taskManager = taskManager;
    this.bridge = bridge;
    this.preferenceManager = preferenceManager || null;
    this.setupListeners();
  }

  setPreferenceManager(pm: PreferenceManager): void {
    this.preferenceManager = pm;
  }

  private setupListeners(): void {
    const unsub = eventBus.on('session_ended', (event) => {
      const { taskId, status } = event.data;
      const mapping = this.stepTaskMap.get(taskId);
      if (!mapping) return;

      const { goalId, stepId } = mapping;
      this.stepTaskMap.delete(taskId);

      const task = this.taskManager.getTask(taskId);
      const result = task?.result || (status === 'completed' ? 'Completed' : 'Failed');

      if (status === 'completed') {
        // Check for [NEEDS_INPUT] marker
        const needsInput = this.extractNeedsInput(result);
        if (needsInput) {
          this.goalManager.updatePlanStep(goalId, stepId, {
            status: 'blocked',
            question: needsInput,
            result,
          });
          const goal = this.goalManager.getGoal(goalId);
          eventBus.emit('question_raised', {
            agentId: goal?.agentId,
            goalId,
            stepId,
            question: needsInput,
          });
          return;
        }

        // Track [Used preference: key] markers
        this.trackPreferenceUsage(goalId, result);

        // Evaluate the result via adversary LLM
        this.evaluateStepResult(goalId, stepId, result);
      } else {
        this.goalManager.updatePlanStep(goalId, stepId, {
          status: 'failed',
          result: `Error: ${result}`,
          completedAt: Date.now(),
        });
        this.evaluateAndContinue(goalId);
      }
    });
    this.eventCleanups.push(unsub);
  }

  destroy(): void {
    for (const cleanup of this.eventCleanups) {
      cleanup();
    }
    this.eventCleanups = [];
  }

  private extractNeedsInput(result: string): string | null {
    const idx = result.lastIndexOf(NEEDS_INPUT_MARKER);
    if (idx < 0) return null;
    return result.substring(idx + NEEDS_INPUT_MARKER.length).trim();
  }

  private trackPreferenceUsage(goalId: string, result: string): void {
    if (!this.preferenceManager) return;
    const goal = this.goalManager.getGoal(goalId);
    if (!goal) return;

    let match;
    USED_PREFERENCE_REGEX.lastIndex = 0;
    while ((match = USED_PREFERENCE_REGEX.exec(result)) !== null) {
      this.preferenceManager.incrementUsage(goal.agentId, match[1].trim());
    }
  }

  // ── Public API (same surface as PlannerLoop) ──

  async wake(goalId: string): Promise<void> {
    const goal = this.goalManager.getGoal(goalId);
    if (!goal) {
      console.log(`[Adversary] Goal ${goalId} not found`);
      return;
    }

    if (goal.status === 'paused') {
      this.goalManager.resumeGoal(goalId);
    }

    if (goal.status !== 'active') {
      console.log(`[Adversary] Goal ${goalId} is ${goal.status}, not active`);
      return;
    }

    if (this.activeGoals.has(goalId)) {
      console.log(`[Adversary] Goal ${goalId} is already executing`);
      return;
    }

    const agent = this.agentManager.getAgent(goal.agentId);
    if (!agent) {
      console.log(`[Adversary] Agent ${goal.agentId} not found`);
      return;
    }

    if (this.bridge.isExecuting(goal.agentId)) {
      console.log(`[Adversary] Agent ${agent.name} is busy`);
      return;
    }

    this.activeGoals.add(goalId);

    // Check for blocked step first (waiting for reply)
    const blockedStep = this.goalManager.getBlockedStep(goalId);
    if (blockedStep) {
      console.log(`[Adversary] Goal has blocked step waiting for reply`);
      this.activeGoals.delete(goalId);
      return;
    }

    const plan = this.goalManager.getCurrentPlan(goalId);
    const nextStep = plan ? this.goalManager.getNextPendingStep(goalId) : undefined;

    if (!plan || !nextStep) {
      await this.generatePlan(goalId);
      return;
    }

    await this.executeNextStep(goalId);
  }

  pause(goalId: string): void {
    const goal = this.goalManager.getGoal(goalId);
    if (goal) {
      this.goalManager.pauseGoal(goalId);
      this.activeGoals.delete(goalId);
    }
  }

  async reply(goalId: string, answer: string): Promise<void> {
    const goal = this.goalManager.getGoal(goalId);
    if (!goal) return;

    const blockedStep = this.goalManager.getBlockedStep(goalId);
    if (!blockedStep) {
      console.log(`[Adversary] No blocked step found for goal ${goalId}`);
      return;
    }

    const agent = this.agentManager.getAgent(goal.agentId);
    if (!agent) return;

    const plan = this.goalManager.getCurrentPlan(goalId);
    if (!plan) return;

    // Trigger preference extraction from this interaction
    if (this.preferenceManager && blockedStep.question) {
      this.triggerPreferenceExtraction(
        goal.agentId,
        blockedStep.question,
        answer,
        `Step ${blockedStep.order + 1}: ${blockedStep.description}`
      );
    }

    // Resume the step with the user's answer
    this.goalManager.updatePlanStep(goalId, blockedStep.id, {
      status: 'in_progress',
      question: null,
    });

    this.activeGoals.add(goalId);

    // Craft a worker instruction that incorporates the user's answer
    const workerInstruction = [
      `You previously asked: "${blockedStep.question}"`,
      `The user answered: "${answer}"`,
      `\nContinue with step ${blockedStep.order + 1}: ${blockedStep.description}`,
      `Use the user's answer to proceed.`,
    ].join('\n');

    const prompt = this.buildWorkerPrompt(agent, goal, workerInstruction);

    const task = this.taskManager.createTask(`[Step ${blockedStep.order + 1} resumed] ${blockedStep.description}`);
    this.taskManager.assignAgent(task.id, agent.id);
    this.agentManager.assignTask(agent.id, task.id);

    this.goalManager.updatePlanStep(goalId, blockedStep.id, { taskId: task.id });
    this.stepTaskMap.set(task.id, { goalId, stepId: blockedStep.id });

    const result = await this.bridge.executeTask(agent.id, task.id, goal.maxTurnsPerStep, goal.workingDirectory);
    if (!result.success) {
      this.goalManager.updatePlanStep(goalId, blockedStep.id, {
        status: 'failed',
        result: `Failed to resume: ${result.error}`,
        completedAt: Date.now(),
      });
      this.stepTaskMap.delete(task.id);
      this.evaluateAndContinue(goalId);
    }
  }

  async talk(agentId: string, message: string, activitySummary?: string): Promise<string> {
    const agent = this.agentManager.getAgent(agentId);
    if (!agent) return 'Agent not found.';

    const goal = this.goalManager.getActiveGoal(agentId);

    // Build system prompt with context for the adversary
    const contextParts: string[] = [];
    contextParts.push(`You are responding on behalf of ${agent.name}, an autonomous agent.`);
    contextParts.push(`The user is asking about progress or status. Answer helpfully and concisely.`);

    if (goal) {
      contextParts.push(`\nCurrent goal: ${goal.description}`);
      const plan = this.goalManager.getCurrentPlan(goal.id);
      if (plan) {
        contextParts.push(`Plan (v${plan.version}):`);
        for (const step of plan.steps) {
          contextParts.push(`  [${step.status}] Step ${step.order + 1}: ${step.description}`);
          if (step.result) contextParts.push(`    Result: ${step.result.substring(0, 150)}`);
        }
      }
    }

    if (activitySummary && activitySummary !== 'No activity recorded.') {
      contextParts.push(`\nRecent activity:\n${activitySummary}`);
    }

    const response = await this.llm.complete({
      systemPrompt: contextParts.join('\n'),
      prompt: message,
    });

    if (response.error) {
      return `Error talking to ${agent.name}: ${response.error}`;
    }
    return response.content || 'No response.';
  }

  isGoalActive(goalId: string): boolean {
    return this.activeGoals.has(goalId);
  }

  // ── Private: Plan Generation via LLM ──

  private async generatePlan(goalId: string): Promise<void> {
    const goal = this.goalManager.getGoal(goalId);
    if (!goal) {
      this.activeGoals.delete(goalId);
      return;
    }

    const agent = this.agentManager.getAgent(goal.agentId);
    if (!agent) {
      this.activeGoals.delete(goalId);
      return;
    }

    // Gather previous results if re-planning
    const existingPlan = this.goalManager.getCurrentPlan(goalId);
    let previousResultsStr = '';
    if (existingPlan) {
      const completed = existingPlan.steps.filter(s => s.status === 'completed' && s.result);
      if (completed.length > 0) {
        previousResultsStr = '\nPrevious results:\n' +
          completed.map(s => `- ${s.description}: ${s.result!.substring(0, 200)}`).join('\n');
      }
    }

    const preferenceContext = this.getPreferenceContext(goal.agentId);
    const workDir = goal.workingDirectory || this.bridge.getWorkingDirectory();
    const roots = this.bridge.getWorkspaceRoots();

    const planPrompt = [
      `You are an orchestrator managing an autonomous agent.`,
      ``,
      `Goal: "${goal.description}"`,
      `Agent: ${agent.name}`,
      `Constraints: ${goal.constraints.length > 0 ? goal.constraints.join(', ') : 'none'}`,
      `Working directory: ${workDir}`,
      roots.length > 0 ? `Workspace roots: ${roots.join(', ')}` : '',
      previousResultsStr,
      preferenceContext ? `\n${preferenceContext}` : '',
      ``,
      `Create a plan. Output ONLY valid JSON:`,
      `{`,
      `  "reasoning": "why this plan",`,
      `  "recurring": true/false,`,
      `  "interval_minutes": number or null,`,
      `  "cycle_goal": "..." or null,`,
      `  "completion_criteria": "..." or null,`,
      `  "steps": [{"description": "..."}]`,
      `}`,
      ``,
      `Set "recurring": true if this goal needs ongoing cycles.`,
      `Set "recurring": false if this is a one-time task.`,
      `Keep steps concrete and actionable. Output valid JSON only, no markdown fences.`,
    ].filter(l => l !== undefined).join('\n');

    console.log(`[Adversary] Generating plan for: ${goal.description}`);

    const response = await this.llm.complete({ prompt: planPrompt });
    if (response.error) {
      console.log(`[Adversary] Plan generation failed: ${response.error}`);
      this.goalManager.updateGoal(goalId, { status: 'failed' });
      this.activeGoals.delete(goalId);
      return;
    }

    const plan = this.parsePlanFromResult(response.content);
    if (plan && plan.steps.length > 0) {
      this.goalManager.setPlan(goalId, plan.steps, plan.reasoning, {
        recurring: plan.recurring,
        intervalMinutes: plan.intervalMinutes,
        cycleGoal: plan.cycleGoal,
        completionCriteria: plan.completionCriteria,
      });
      console.log(`[Adversary] Plan created: ${plan.steps.length} steps, recurring=${plan.recurring}`);
      await this.executeNextStep(goalId);
    } else {
      console.log(`[Adversary] Failed to parse plan from LLM response`);
      this.goalManager.updateGoal(goalId, { status: 'failed' });
      this.activeGoals.delete(goalId);
    }
  }

  // ── Private: Worker Instruction Crafting via LLM ──

  private async craftWorkerInstruction(
    goal: AgentGoal,
    plan: AgentPlan,
    step: PlanStep
  ): Promise<string> {
    const agent = this.agentManager.getAgent(goal.agentId);
    const agentName = agent?.name || 'Worker';
    const workDir = goal.workingDirectory || this.bridge.getWorkingDirectory();
    const roots = this.bridge.getWorkspaceRoots();

    const craftPrompt = [
      `You are an orchestrator. Write a focused instruction for a worker agent.`,
      ``,
      `Goal: "${goal.description}"`,
      `Agent: ${agentName}`,
      `Working directory: ${workDir}`,
      roots.length > 0 ? `Workspace roots: ${roots.join(', ')}` : '',
      ``,
      `Full plan:`,
      ...plan.steps.map(s => {
        const status = s.status === 'completed' ? '[done]' : s.status === 'failed' ? '[fail]' : s.id === step.id ? '[current]' : '[pending]';
        const result = s.result ? ` — ${s.result.substring(0, 150)}` : '';
        return `  ${status} Step ${s.order + 1}: ${s.description}${result}`;
      }),
      ``,
      `Current step: Step ${step.order + 1}: ${step.description}`,
      ``,
      `Write a clear, detailed instruction for the worker to complete ONLY this step.`,
      `Include specific file paths, commands, or actions if known from previous step results.`,
      `The worker has full tool access (can read/write files, run commands, etc).`,
      `Output ONLY the instruction text, nothing else.`,
    ].filter(l => l !== undefined).join('\n');

    const response = await this.llm.complete({ prompt: craftPrompt });
    if (response.error || !response.content) {
      // Fallback to step description
      return step.description;
    }
    return response.content;
  }

  // ── Private: Step Evaluation via LLM ──

  private async evaluateStepResult(goalId: string, stepId: string, result: string): Promise<void> {
    const goal = this.goalManager.getGoal(goalId);
    if (!goal) {
      this.activeGoals.delete(goalId);
      return;
    }

    const plan = this.goalManager.getCurrentPlan(goalId);
    if (!plan) {
      this.activeGoals.delete(goalId);
      return;
    }

    const step = plan.steps.find(s => s.id === stepId);
    if (!step) {
      this.activeGoals.delete(goalId);
      return;
    }

    const evalPrompt = [
      `You are evaluating a worker agent's output for step ${step.order + 1} of a plan.`,
      ``,
      `Goal: "${goal.description}"`,
      `Step: "${step.description}"`,
      `Worker output: "${result.substring(0, 2000)}"`,
      ``,
      `Judge the result. Output ONLY valid JSON:`,
      `{`,
      `  "verdict": "PASS" | "RETRY" | "ESCALATE",`,
      `  "reasoning": "why",`,
      `  "refined_instruction": "if RETRY, what to do differently",`,
      `  "escalation_question": "if ESCALATE, what to ask the user"`,
      `}`,
      ``,
      `Rules:`,
      `- PASS: Step is satisfactorily completed`,
      `- RETRY: Step partially done or has fixable issues (max 2 retries per step)`,
      `- ESCALATE: Needs human decision, unclear requirements, or repeated failures`,
    ].join('\n');

    const response = await this.llm.complete({ prompt: evalPrompt });

    // Parse verdict
    let verdict = 'PASS';
    let refinedInstruction = '';
    let escalationQuestion = '';

    if (response.content) {
      try {
        const jsonMatch = response.content.match(/\{[\s\S]*"verdict"[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          verdict = parsed.verdict || 'PASS';
          refinedInstruction = parsed.refined_instruction || '';
          escalationQuestion = parsed.escalation_question || '';
        }
      } catch {
        // Parse failed — default to PASS
      }
    }

    const retryCount = this.retryMap.get(stepId) || 0;

    if (verdict === 'PASS') {
      this.retryMap.delete(stepId);
      this.goalManager.updatePlanStep(goalId, stepId, {
        status: 'completed',
        result,
        completedAt: Date.now(),
      });
      this.evaluateAndContinue(goalId);
    } else if (verdict === 'RETRY' && retryCount < 2) {
      this.retryMap.set(stepId, retryCount + 1);
      console.log(`[Adversary] Retrying step ${step.order + 1} (attempt ${retryCount + 2}/3): ${refinedInstruction.substring(0, 100)}`);

      // Re-execute with refined instruction
      this.goalManager.updatePlanStep(goalId, stepId, { status: 'pending' });
      await this.executeStepWithInstruction(goalId, step, refinedInstruction || step.description);
    } else {
      // ESCALATE (or max retries exceeded)
      this.retryMap.delete(stepId);
      const question = escalationQuestion || `Step ${step.order + 1} "${step.description}" needs your input after ${retryCount + 1} attempt(s). How should we proceed?`;
      this.goalManager.updatePlanStep(goalId, stepId, {
        status: 'blocked',
        question,
        result,
      });
      eventBus.emit('question_raised', {
        agentId: goal.agentId,
        goalId,
        stepId,
        question,
      });
    }
  }

  // ── Private: Step Execution ──

  private async executeNextStep(goalId: string): Promise<void> {
    const goal = this.goalManager.getGoal(goalId);
    if (!goal || goal.status !== 'active') {
      this.activeGoals.delete(goalId);
      return;
    }

    const agent = this.agentManager.getAgent(goal.agentId);
    if (!agent) {
      this.activeGoals.delete(goalId);
      return;
    }

    const plan = this.goalManager.getCurrentPlan(goalId);
    if (!plan) {
      this.activeGoals.delete(goalId);
      return;
    }

    const step = this.goalManager.getNextPendingStep(goalId);
    if (!step) {
      // All steps done — check recurring
      const allCompleted = plan.steps.every(s => s.status === 'completed' || s.status === 'skipped');
      if (allCompleted) {
        if (plan.recurring) {
          console.log(`[Adversary] Cycle complete for recurring goal: ${goal.description}`);
          this.activeGoals.delete(goalId);
        } else {
          this.goalManager.updateGoal(goalId, { status: 'completed' });
          console.log(`[Adversary] Goal completed: ${goal.description}`);
          this.activeGoals.delete(goalId);
        }
      } else {
        console.log(`[Adversary] Some steps failed, re-planning...`);
        await this.generatePlan(goalId);
      }
      return;
    }

    // Craft worker instruction via adversary LLM
    console.log(`[Adversary] Crafting instruction for step ${step.order + 1}: ${step.description}`);
    const workerInstruction = await this.craftWorkerInstruction(goal, plan, step);

    await this.executeStepWithInstruction(goalId, step, workerInstruction);
  }

  private async executeStepWithInstruction(goalId: string, step: PlanStep, workerInstruction: string): Promise<void> {
    const goal = this.goalManager.getGoal(goalId);
    if (!goal) {
      this.activeGoals.delete(goalId);
      return;
    }

    const agent = this.agentManager.getAgent(goal.agentId);
    if (!agent) {
      this.activeGoals.delete(goalId);
      return;
    }

    this.goalManager.updatePlanStep(goalId, step.id, { status: 'in_progress' });

    const prompt = this.buildWorkerPrompt(agent, goal, workerInstruction);

    const task = this.taskManager.createTask(`[Step ${step.order + 1}] ${step.description}`);
    this.taskManager.assignAgent(task.id, agent.id);
    this.agentManager.assignTask(agent.id, task.id);

    this.goalManager.updatePlanStep(goalId, step.id, { taskId: task.id });
    this.stepTaskMap.set(task.id, { goalId, stepId: step.id });

    const result = await this.bridge.executeTask(agent.id, task.id, goal.maxTurnsPerStep, goal.workingDirectory);
    if (!result.success) {
      this.goalManager.updatePlanStep(goalId, step.id, {
        status: 'failed',
        result: `Failed to start: ${result.error}`,
        completedAt: Date.now(),
      });
      this.stepTaskMap.delete(task.id);
      this.evaluateAndContinue(goalId);
    }
  }

  private buildWorkerPrompt(agent: { name: string; systemPrompt?: string }, goal: AgentGoal, workerInstruction: string): string {
    const workDir = goal.workingDirectory || this.bridge.getWorkingDirectory();
    const roots = this.bridge.getWorkspaceRoots();
    const preferenceContext = this.getPreferenceContext(goal.agentId);

    const parts: string[] = [];
    parts.push(`<instruction>`);
    parts.push(`You are ${agent.name}, an autonomous agent.`);
    if (agent.systemPrompt) {
      parts.push(agent.systemPrompt);
    }
    parts.push(``);
    parts.push(`<worker_instruction>`);
    parts.push(workerInstruction);
    parts.push(`</worker_instruction>`);
    parts.push(``);
    parts.push(`Working directory: ${workDir}`);
    if (roots.length > 0) {
      parts.push(`Workspace roots: ${roots.join(', ')}`);
    }
    if (goal.constraints.length > 0) {
      parts.push(`Constraints: ${goal.constraints.join(', ')}`);
    }
    if (preferenceContext) {
      parts.push(`\n${preferenceContext}`);
    }
    parts.push(``);
    parts.push(`Complete the instruction above. Be concise.`);
    parts.push(`If you encounter genuine uncertainty, end with "[NEEDS_INPUT]: your question"`);
    parts.push(`</instruction>`);

    return parts.join('\n');
  }

  // ── Private: evaluate and continue ──

  private async evaluateAndContinue(goalId: string): Promise<void> {
    const goal = this.goalManager.getGoal(goalId);
    if (!goal || goal.status !== 'active') {
      this.activeGoals.delete(goalId);
      return;
    }

    const plan = this.goalManager.getCurrentPlan(goalId);
    if (!plan) {
      this.activeGoals.delete(goalId);
      return;
    }

    const nextStep = this.goalManager.getNextPendingStep(goalId);
    if (nextStep) {
      await this.executeNextStep(goalId);
    } else {
      const failed = plan.steps.filter(s => s.status === 'failed');
      const completed = plan.steps.filter(s => s.status === 'completed');
      const blocked = plan.steps.filter(s => s.status === 'blocked');

      if (blocked.length > 0) {
        this.activeGoals.delete(goalId);
        return;
      }

      if (failed.length === 0 && completed.length === plan.steps.length) {
        if (plan.recurring) {
          console.log(`[Adversary] Cycle complete for recurring goal: ${goal.description}`);
          this.activeGoals.delete(goalId);
        } else {
          this.goalManager.updateGoal(goalId, { status: 'completed' });
          console.log(`[Adversary] Goal completed: ${goal.description}`);
          this.activeGoals.delete(goalId);
        }
      } else if (failed.length > 0 && completed.length + failed.length === plan.steps.length) {
        console.log(`[Adversary] ${failed.length} steps failed, re-planning...`);
        await this.generatePlan(goalId);
      } else {
        this.activeGoals.delete(goalId);
      }
    }
  }

  // ── Private: Helpers ──

  private getPreferenceContext(agentId: string): string | undefined {
    return this.preferenceManager?.buildPreferenceContext(agentId) || undefined;
  }

  private async triggerPreferenceExtraction(
    agentId: string,
    agentQuestion: string,
    userAnswer: string,
    context: string
  ): Promise<void> {
    if (!this.preferenceManager) return;

    const extractionPrompt = this.preferenceManager.buildExtractionPrompt(agentId, {
      userMessage: userAnswer,
      agentMessage: agentQuestion,
      context,
    });

    // Use the adversary LLM for extraction (no tools needed)
    const response = await this.llm.complete({ prompt: extractionPrompt });
    if (response.content) {
      const extracted = this.preferenceManager.parseAndStoreExtraction(
        agentId,
        response.content,
        `Reply to: ${agentQuestion.substring(0, 60)}`
      );
      if (extracted.length > 0) {
        console.log(`[Adversary] Extracted ${extracted.length} preference(s) from reply`);
      }
    }
  }

  private parsePlanFromResult(result: string): {
    reasoning: string;
    steps: { description: string }[];
    recurring: boolean;
    intervalMinutes: number | null;
    cycleGoal: string | null;
    completionCriteria: string | null;
  } | null {
    try {
      const jsonMatch = result.match(/\{[\s\S]*"steps"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed.steps) && parsed.steps.length > 0) {
          return {
            reasoning: parsed.reasoning || 'Plan generated by adversary',
            steps: parsed.steps.map((s: any) => ({
              description: typeof s === 'string' ? s : s.description || String(s),
            })),
            recurring: parsed.recurring === true,
            intervalMinutes: typeof parsed.interval_minutes === 'number' ? parsed.interval_minutes : null,
            cycleGoal: parsed.cycle_goal || null,
            completionCriteria: parsed.completion_criteria || null,
          };
        }
      }

      const arrayMatch = result.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        const parsed = JSON.parse(arrayMatch[0]);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return {
            reasoning: 'Plan generated by adversary',
            steps: parsed.map((s: any) => ({
              description: typeof s === 'string' ? s : s.description || String(s),
            })),
            recurring: false,
            intervalMinutes: null,
            cycleGoal: null,
            completionCriteria: null,
          };
        }
      }
    } catch {
      // Parsing failed
    }
    return null;
  }
}
