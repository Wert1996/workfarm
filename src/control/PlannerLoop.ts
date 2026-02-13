import { v4 as uuidv4 } from 'uuid';
import { AgentGoal, PlanStep } from '../types';
import { GoalManager } from './GoalManager';
import { AgentManager } from './AgentManager';
import { TaskManager } from './TaskManager';
import { ClaudeCodeBridge } from './ClaudeCodeBridge';
import { PreferenceManager } from './PreferenceManager';
import { eventBus } from './EventBus';

const NEEDS_INPUT_MARKER = '[NEEDS_INPUT]:';
const USED_PREFERENCE_REGEX = /\[Used preference:\s*([^\]]+)\]/g;

export class PlannerLoop {
  private goalManager: GoalManager;
  private agentManager: AgentManager;
  private taskManager: TaskManager;
  private bridge: ClaudeCodeBridge;
  private preferenceManager: PreferenceManager | null = null;
  private activeGoals: Set<string> = new Set();
  private stepTaskMap: Map<string, { goalId: string; stepId: string }> = new Map();
  private eventCleanups: (() => void)[] = [];

  constructor(
    goalManager: GoalManager,
    agentManager: AgentManager,
    taskManager: TaskManager,
    bridge: ClaudeCodeBridge
  ) {
    this.goalManager = goalManager;
    this.agentManager = agentManager;
    this.taskManager = taskManager;
    this.bridge = bridge;
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
          // Don't continue — wait for user reply
          return;
        }

        // Track [Used preference: key] markers
        this.trackPreferenceUsage(goalId, result);

        this.goalManager.updatePlanStep(goalId, stepId, {
          status: 'completed',
          result,
          completedAt: Date.now(),
        });
      } else {
        this.goalManager.updatePlanStep(goalId, stepId, {
          status: 'failed',
          result: `Error: ${result}`,
          completedAt: Date.now(),
        });
      }

      this.evaluateAndContinue(goalId);
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

  async wake(goalId: string): Promise<void> {
    const goal = this.goalManager.getGoal(goalId);
    if (!goal) {
      console.log(`[PlannerLoop] Goal ${goalId} not found`);
      return;
    }

    if (goal.status === 'paused') {
      this.goalManager.resumeGoal(goalId);
    }

    if (goal.status !== 'active') {
      console.log(`[PlannerLoop] Goal ${goalId} is ${goal.status}, not active`);
      return;
    }

    if (this.activeGoals.has(goalId)) {
      console.log(`[PlannerLoop] Goal ${goalId} is already executing`);
      return;
    }

    const agent = this.agentManager.getAgent(goal.agentId);
    if (!agent) {
      console.log(`[PlannerLoop] Agent ${goal.agentId} not found`);
      return;
    }

    if (this.bridge.isExecuting(goal.agentId)) {
      console.log(`[PlannerLoop] Agent ${agent.name} is busy`);
      return;
    }

    this.activeGoals.add(goalId);

    // Check for blocked step first (waiting for reply)
    const blockedStep = this.goalManager.getBlockedStep(goalId);
    if (blockedStep) {
      console.log(`[PlannerLoop] Goal has blocked step waiting for reply`);
      this.activeGoals.delete(goalId);
      return;
    }

    const plan = this.goalManager.getCurrentPlan(goalId);
    const nextStep = plan ? this.goalManager.getNextPendingStep(goalId) : undefined;

    if (!plan || !nextStep) {
      await this.planGoal(goalId);
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

  /**
   * Handle a user reply to a blocked step's question.
   */
  async reply(goalId: string, answer: string): Promise<void> {
    const goal = this.goalManager.getGoal(goalId);
    if (!goal) return;

    const blockedStep = this.goalManager.getBlockedStep(goalId);
    if (!blockedStep) {
      console.log(`[PlannerLoop] No blocked step found for goal ${goalId}`);
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

    // Create a new task to continue the step with the answer
    const prompt = [
      this.bridge.buildGoalPrompt(agent, goal, plan, blockedStep, this.getPreferenceContext(goal.agentId)),
      `\nYou previously asked: "${blockedStep.question}"`,
      `The user answered: "${answer}"`,
      `\nContinue with step ${blockedStep.order + 1} using this information.`,
    ].join('\n');

    const task = this.taskManager.createTask(`[Step ${blockedStep.order + 1} resumed] ${blockedStep.description}`);
    this.taskManager.assignAgent(task.id, agent.id);
    this.agentManager.assignTask(agent.id, task.id);

    this.goalManager.updatePlanStep(goalId, blockedStep.id, { taskId: task.id });
    this.stepTaskMap.set(task.id, { goalId, stepId: blockedStep.id });

    const result = await this.bridge.executeTask(agent.id, task.id, goal.maxTurnsPerStep);
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

    const agent = this.agentManager.getAgent(agentId);
    if (!agent) return;

    const extractionPrompt = this.preferenceManager.buildExtractionPrompt(agentId, {
      userMessage: userAnswer,
      agentMessage: agentQuestion,
      context,
    });

    // Create a lightweight extraction task
    const task = this.taskManager.createTask(`[Extract preferences] ${context.substring(0, 40)}`);
    this.taskManager.assignAgent(task.id, agentId);

    // Listen for completion to parse results
    const unsub = eventBus.on('session_ended', (event) => {
      if (event.data.taskId !== task.id) return;
      unsub();

      const t = this.taskManager.getTask(task.id);
      const result = t?.result || '';
      const extracted = this.preferenceManager!.parseAndStoreExtraction(
        agentId,
        result,
        `Reply to: ${agentQuestion.substring(0, 60)}`
      );
      if (extracted.length > 0) {
        console.log(`[PlannerLoop] Extracted ${extracted.length} preference(s) from reply`);
      }
    });

    // Don't use agentManager.assignTask here — the agent might be doing other work
    // Use a low maxTurns since this is just extraction
    await this.bridge.executeTask(agentId, task.id, 3).catch(() => {
      unsub();
    });
  }

  private async planGoal(goalId: string): Promise<void> {
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
    let previousResults: { step: string; result: string }[] | undefined;
    let cycleNumber: number | undefined;
    if (existingPlan) {
      const completed = existingPlan.steps.filter(s => s.status === 'completed' && s.result);
      if (completed.length > 0) {
        previousResults = completed.map(s => ({
          step: s.description,
          result: s.result!,
        }));
      }
      cycleNumber = existingPlan.version;
    }

    const prompt = this.bridge.buildPlanningPrompt(
      agent,
      goal,
      previousResults,
      this.getPreferenceContext(goal.agentId),
      cycleNumber
    );
    const planTask = this.taskManager.createTask(`[Plan] ${goal.description}`);
    this.taskManager.assignAgent(planTask.id, agent.id);
    this.agentManager.assignTask(agent.id, planTask.id);

    const planningGoalId = goalId;

    const unsub = eventBus.on('session_ended', async (event) => {
      if (event.data.taskId !== planTask.id) return;
      unsub();

      const task = this.taskManager.getTask(planTask.id);
      const result = task?.result || '';

      const plan = this.parsePlanFromResult(result);
      if (plan && plan.steps.length > 0) {
        this.goalManager.setPlan(planningGoalId, plan.steps, plan.reasoning, {
          recurring: plan.recurring,
          intervalMinutes: plan.intervalMinutes,
          cycleGoal: plan.cycleGoal,
          completionCriteria: plan.completionCriteria,
        });
        console.log(`[PlannerLoop] Plan created: ${plan.steps.length} steps, recurring=${plan.recurring}`);
        await this.executeNextStep(planningGoalId);
      } else {
        console.log(`[PlannerLoop] Failed to parse plan from result`);
        this.goalManager.updateGoal(planningGoalId, { status: 'failed' });
        this.activeGoals.delete(planningGoalId);
      }
    });

    const result = await this.bridge.executeTask(agent.id, planTask.id, goal.maxTurnsPerStep);
    if (!result.success) {
      unsub();
      console.log(`[PlannerLoop] Failed to start planning: ${result.error}`);
      this.activeGoals.delete(goalId);
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
            reasoning: parsed.reasoning || 'Plan generated by agent',
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
            reasoning: 'Plan generated by agent',
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
          // Recurring goal — cycle complete, wait for next trigger
          console.log(`[PlannerLoop] Cycle complete for recurring goal: ${goal.description}`);
          console.log(`[PlannerLoop] Will re-plan on next wake/trigger`);
          // Don't mark completed — leave as active so triggers can wake it
          this.activeGoals.delete(goalId);
        } else {
          this.goalManager.updateGoal(goalId, { status: 'completed' });
          console.log(`[PlannerLoop] Goal completed: ${goal.description}`);
          this.activeGoals.delete(goalId);
        }
      } else {
        console.log(`[PlannerLoop] Some steps failed, re-planning...`);
        await this.planGoal(goalId);
      }
      return;
    }

    this.goalManager.updatePlanStep(goalId, step.id, { status: 'in_progress' });

    const prompt = this.bridge.buildGoalPrompt(agent, goal, plan, step, this.getPreferenceContext(goal.agentId));
    const task = this.taskManager.createTask(`[Step ${step.order + 1}] ${step.description}`);
    this.taskManager.assignAgent(task.id, agent.id);
    this.agentManager.assignTask(agent.id, task.id);

    this.goalManager.updatePlanStep(goalId, step.id, { taskId: task.id });
    this.stepTaskMap.set(task.id, { goalId, stepId: step.id });

    const result = await this.bridge.executeTask(agent.id, task.id, goal.maxTurnsPerStep);
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

      // If there's a blocked step, wait for reply
      if (blocked.length > 0) {
        this.activeGoals.delete(goalId);
        return;
      }

      if (failed.length === 0 && completed.length === plan.steps.length) {
        if (plan.recurring) {
          console.log(`[PlannerLoop] Cycle complete for recurring goal: ${goal.description}`);
          this.activeGoals.delete(goalId);
        } else {
          this.goalManager.updateGoal(goalId, { status: 'completed' });
          console.log(`[PlannerLoop] Goal completed: ${goal.description}`);
          this.activeGoals.delete(goalId);
        }
      } else if (failed.length > 0 && completed.length + failed.length === plan.steps.length) {
        console.log(`[PlannerLoop] ${failed.length} steps failed, re-planning...`);
        await this.planGoal(goalId);
      } else {
        this.activeGoals.delete(goalId);
      }
    }
  }

  isGoalActive(goalId: string): boolean {
    return this.activeGoals.has(goalId);
  }
}
