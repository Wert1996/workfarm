import { AgentTrigger } from '../types';
import { GoalManager } from './GoalManager';
import { AdversaryAgent } from './AdversaryAgent';
import { eventBus } from './EventBus';

export class TriggerScheduler {
  private goalManager!: GoalManager;
  private adversary!: AdversaryAgent;
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private started = false;

  start(goalManager: GoalManager, adversary: AdversaryAgent): void {
    this.goalManager = goalManager;
    this.adversary = adversary;
    this.started = true;

    // Set up timers for all existing enabled triggers
    const triggers = goalManager.getAllTriggers();
    for (const trigger of triggers) {
      if (trigger.enabled && trigger.type === 'interval' && trigger.intervalMs) {
        this.scheduleInterval(trigger);
      }
    }
  }

  stop(): void {
    this.started = false;
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
  }

  addTrigger(trigger: AgentTrigger): void {
    this.goalManager.addTrigger(trigger);
    if (this.started && trigger.enabled && trigger.type === 'interval' && trigger.intervalMs) {
      this.scheduleInterval(trigger);
    }
  }

  removeTrigger(triggerId: string): void {
    const timer = this.timers.get(triggerId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(triggerId);
    }
    this.goalManager.removeTrigger(triggerId);
  }

  private scheduleInterval(trigger: AgentTrigger): void {
    // Clear existing timer if any
    const existing = this.timers.get(trigger.id);
    if (existing) clearInterval(existing);

    const timer = setInterval(() => {
      this.fireTrigger(trigger);
    }, trigger.intervalMs!);

    this.timers.set(trigger.id, timer);

    // Update nextFireAt
    trigger.nextFireAt = Date.now() + trigger.intervalMs!;
  }

  private async fireTrigger(trigger: AgentTrigger): Promise<void> {
    const goal = this.goalManager.getGoal(trigger.goalId);
    if (!goal || goal.status === 'paused' || goal.status === 'completed' || goal.status === 'failed') {
      return;
    }

    // Skip if already executing
    if (this.adversary.isGoalActive(trigger.goalId)) {
      return;
    }

    trigger.lastFiredAt = Date.now();
    if (trigger.intervalMs) {
      trigger.nextFireAt = Date.now() + trigger.intervalMs;
    }

    eventBus.emit('trigger_fired', {
      triggerId: trigger.id,
      agentId: trigger.agentId,
      goalId: trigger.goalId,
      type: trigger.type,
    });

    await this.adversary.wake(trigger.goalId);
  }

  async fireManual(triggerId: string): Promise<void> {
    const trigger = this.goalManager.getTrigger(triggerId);
    if (trigger && trigger.type === 'manual') {
      await this.fireTrigger(trigger);
    }
  }
}
