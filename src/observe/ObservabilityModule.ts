import { RuntimeAdapter } from '../control/RuntimeAdapter';
import { eventBus } from '../control/EventBus';
import { GameEvent } from '../types';
import { ObservabilityEvent } from './types';

export class ObservabilityModule {
  private runtime: RuntimeAdapter;
  private unsubscribe: (() => void) | null = null;

  constructor(runtime: RuntimeAdapter) {
    this.runtime = runtime;
  }

  start(): void {
    this.unsubscribe = eventBus.onAll((event: GameEvent) => {
      this.handleEvent(event);
    });
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  private handleEvent(event: GameEvent): void {
    const obsEvent: ObservabilityEvent = {
      timestamp: event.timestamp,
      type: event.type,
      data: event.data,
    };

    // Extract agentId, goalId, taskId from event data when available
    if (event.data) {
      if (event.data.agentId) obsEvent.agentId = event.data.agentId;
      if (event.data.agent?.id) obsEvent.agentId = obsEvent.agentId || event.data.agent.id;
      if (event.data.goalId) obsEvent.goalId = event.data.goalId;
      if (event.data.taskId) obsEvent.taskId = event.data.taskId;
      if (event.data.task?.id) obsEvent.taskId = obsEvent.taskId || event.data.task.id;
    }

    // Write to agent-specific log file if we have an agentId
    const agentId = obsEvent.agentId;
    if (agentId) {
      this.runtime.appendLog(agentId, obsEvent).catch((err) => {
        console.error('[Observability] Failed to append log:', err);
      });
    }
  }

  async getEvents(
    agentId: string,
    opts?: { since?: number; until?: number; types?: string[] }
  ): Promise<ObservabilityEvent[]> {
    let events = await this.runtime.readLogs(agentId, {
      since: opts?.since,
      until: opts?.until,
    });
    if (opts?.types && opts.types.length > 0) {
      events = events.filter((e: ObservabilityEvent) => opts.types!.includes(e.type));
    }
    return events;
  }

  async getAgentSummary(agentId: string, count: number = 20): Promise<string> {
    const events = await this.runtime.readLogs(agentId);
    const recent = events.slice(-count);
    if (recent.length === 0) return 'No activity recorded.';

    const lines = recent.map((e: ObservabilityEvent) => {
      const time = new Date(e.timestamp).toISOString().substring(11, 19);
      const detail = this.summarizeEvent(e);
      return `[${time}] ${e.type}: ${detail}`;
    });
    return lines.join('\n');
  }

  private summarizeEvent(event: ObservabilityEvent): string {
    const d = event.data;
    switch (event.type) {
      case 'goal_created':
        return d.description || 'New goal';
      case 'goal_updated':
        return `status=${d.status || 'unknown'}`;
      case 'goal_paused':
        return 'Goal paused';
      case 'goal_resumed':
        return 'Goal resumed';
      case 'plan_created':
        return `${d.steps?.length || 0} steps planned`;
      case 'step_started':
        return d.description || 'Step started';
      case 'step_completed':
        return d.result?.substring(0, 80) || 'Step done';
      case 'step_failed':
        return d.error?.substring(0, 80) || 'Step failed';
      case 'task_completed':
        return d.task?.description?.substring(0, 80) || 'Task done';
      case 'task_failed':
        return d.error?.substring(0, 80) || 'Task failed';
      case 'trigger_fired':
        return `trigger=${d.triggerId || 'unknown'}`;
      case 'conversation_started':
        return d.message?.substring(0, 80) || 'Conversation';
      case 'session_message':
        return d.message?.content?.substring(0, 60) || 'message';
      default:
        return JSON.stringify(d).substring(0, 80);
    }
  }
}
