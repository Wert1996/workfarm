import { v4 as uuidv4 } from 'uuid';
import { AgentGoal, AgentPlan, PlanStep, AgentTrigger } from '../types';
import { RuntimeAdapter } from './RuntimeAdapter';
import { eventBus } from './EventBus';

export class GoalManager {
  private runtime: RuntimeAdapter;
  private goals: Map<string, AgentGoal> = new Map();
  private plans: Map<string, AgentPlan> = new Map(); // goalId -> plan
  private triggers: Map<string, AgentTrigger> = new Map();

  constructor(runtime: RuntimeAdapter) {
    this.runtime = runtime;
  }

  async initialize(): Promise<void> {
    const savedGoals = await this.runtime.loadGoals();
    for (const item of savedGoals) {
      if (item._type === 'plan') {
        this.plans.set(item.goalId, item);
      } else {
        this.goals.set(item.id, item);
      }
    }

    const savedTriggers = await this.runtime.loadTriggers();
    for (const trigger of savedTriggers) {
      this.triggers.set(trigger.id, trigger);
    }
  }

  async save(): Promise<void> {
    const goals = Array.from(this.goals.values());
    const plans = Array.from(this.plans.values()).map(p => ({ ...p, _type: 'plan' }));
    await this.runtime.saveGoals([...goals, ...plans]);
    await this.runtime.saveTriggers(Array.from(this.triggers.values()));
  }

  // --- Goal CRUD ---

  createGoal(
    agentId: string,
    description: string,
    opts?: { systemPrompt?: string; constraints?: string[]; maxTurnsPerStep?: number }
  ): AgentGoal {
    const goal: AgentGoal = {
      id: uuidv4(),
      agentId,
      description,
      systemPrompt: opts?.systemPrompt,
      constraints: opts?.constraints || [],
      status: 'active',
      maxTurnsPerStep: opts?.maxTurnsPerStep || 10,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.goals.set(goal.id, goal);
    eventBus.emit('goal_created', { goalId: goal.id, agentId, description });
    this.save();
    return goal;
  }

  updateGoal(goalId: string, updates: Partial<Pick<AgentGoal, 'description' | 'systemPrompt' | 'constraints' | 'status' | 'maxTurnsPerStep'>>): AgentGoal | undefined {
    const goal = this.goals.get(goalId);
    if (!goal) return undefined;

    Object.assign(goal, updates, { updatedAt: Date.now() });
    eventBus.emit('goal_updated', { goalId, agentId: goal.agentId, ...updates });
    this.save();
    return goal;
  }

  pauseGoal(goalId: string): AgentGoal | undefined {
    const goal = this.goals.get(goalId);
    if (!goal || goal.status !== 'active') return undefined;

    goal.status = 'paused';
    goal.updatedAt = Date.now();
    eventBus.emit('goal_paused', { goalId, agentId: goal.agentId });
    this.save();
    return goal;
  }

  resumeGoal(goalId: string): AgentGoal | undefined {
    const goal = this.goals.get(goalId);
    if (!goal || goal.status !== 'paused') return undefined;

    goal.status = 'active';
    goal.updatedAt = Date.now();
    eventBus.emit('goal_resumed', { goalId, agentId: goal.agentId });
    this.save();
    return goal;
  }

  getGoal(goalId: string): AgentGoal | undefined {
    return this.goals.get(goalId);
  }

  getGoalsForAgent(agentId: string): AgentGoal[] {
    return Array.from(this.goals.values()).filter(g => g.agentId === agentId);
  }

  getActiveGoal(agentId: string): AgentGoal | undefined {
    return Array.from(this.goals.values()).find(
      g => g.agentId === agentId && g.status === 'active'
    );
  }

  getAllGoals(): AgentGoal[] {
    return Array.from(this.goals.values());
  }

  // --- Plan management ---

  setPlan(
    goalId: string,
    steps: { description: string }[],
    reasoning: string,
    lifecycle?: { recurring?: boolean; intervalMinutes?: number | null; cycleGoal?: string | null; completionCriteria?: string | null }
  ): AgentPlan | undefined {
    const goal = this.goals.get(goalId);
    if (!goal) return undefined;

    const existing = this.plans.get(goalId);
    const version = existing ? existing.version + 1 : 1;

    const plan: AgentPlan = {
      id: uuidv4(),
      goalId,
      agentId: goal.agentId,
      steps: steps.map((s, i) => ({
        id: uuidv4(),
        goalId,
        description: s.description,
        status: 'pending' as const,
        taskId: null,
        result: null,
        question: null,
        order: i,
        createdAt: Date.now(),
        completedAt: null,
      })),
      version,
      reasoning,
      recurring: lifecycle?.recurring || false,
      intervalMinutes: lifecycle?.intervalMinutes || null,
      cycleGoal: lifecycle?.cycleGoal || null,
      completionCriteria: lifecycle?.completionCriteria || null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.plans.set(goalId, plan);
    eventBus.emit('plan_created', {
      goalId,
      agentId: goal.agentId,
      planId: plan.id,
      steps: plan.steps.length,
      version,
    });
    this.save();
    return plan;
  }

  getCurrentPlan(goalId: string): AgentPlan | undefined {
    return this.plans.get(goalId);
  }

  updatePlanStep(
    goalId: string,
    stepId: string,
    updates: Partial<Pick<PlanStep, 'status' | 'taskId' | 'result' | 'completedAt' | 'question'>>
  ): PlanStep | undefined {
    const plan = this.plans.get(goalId);
    if (!plan) return undefined;

    const step = plan.steps.find(s => s.id === stepId);
    if (!step) return undefined;

    Object.assign(step, updates);
    plan.updatedAt = Date.now();

    if (updates.status === 'in_progress') {
      eventBus.emit('step_started', { goalId, stepId, description: step.description, agentId: plan.agentId });
    } else if (updates.status === 'completed') {
      eventBus.emit('step_completed', { goalId, stepId, result: updates.result, agentId: plan.agentId });
    } else if (updates.status === 'failed') {
      eventBus.emit('step_failed', { goalId, stepId, error: updates.result, agentId: plan.agentId });
    }

    this.save();
    return step;
  }

  getNextPendingStep(goalId: string): PlanStep | undefined {
    const plan = this.plans.get(goalId);
    if (!plan) return undefined;
    return plan.steps
      .sort((a, b) => a.order - b.order)
      .find(s => s.status === 'pending');
  }

  getBlockedStep(goalId: string): PlanStep | undefined {
    const plan = this.plans.get(goalId);
    if (!plan) return undefined;
    return plan.steps.find(s => s.status === 'blocked');
  }

  // --- Trigger management ---

  addTrigger(trigger: AgentTrigger): void {
    this.triggers.set(trigger.id, trigger);
    this.save();
  }

  removeTrigger(triggerId: string): boolean {
    const deleted = this.triggers.delete(triggerId);
    if (deleted) this.save();
    return deleted;
  }

  getTrigger(triggerId: string): AgentTrigger | undefined {
    return this.triggers.get(triggerId);
  }

  getTriggersForGoal(goalId: string): AgentTrigger[] {
    return Array.from(this.triggers.values()).filter(t => t.goalId === goalId);
  }

  getTriggersForAgent(agentId: string): AgentTrigger[] {
    return Array.from(this.triggers.values()).filter(t => t.agentId === agentId);
  }

  getAllTriggers(): AgentTrigger[] {
    return Array.from(this.triggers.values());
  }
}
