export interface AgentGoal {
  id: string;
  agentId: string;
  description: string;
  systemPrompt?: string;
  constraints: string[];
  status: 'active' | 'paused' | 'completed' | 'failed';
  maxTurnsPerStep: number;
  createdAt: number;
  updatedAt: number;
}

export interface PlanStep {
  id: string;
  goalId: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped' | 'blocked';
  taskId: string | null;
  result: string | null;
  question: string | null;
  order: number;
  createdAt: number;
  completedAt: number | null;
}

export interface AgentPlan {
  id: string;
  goalId: string;
  agentId: string;
  steps: PlanStep[];
  version: number;
  reasoning: string;
  recurring: boolean;
  intervalMinutes: number | null;
  cycleGoal: string | null;
  completionCriteria: string | null;
  createdAt: number;
  updatedAt: number;
}

export type TriggerType = 'manual' | 'interval';

export interface AgentTrigger {
  id: string;
  agentId: string;
  goalId: string;
  type: TriggerType;
  intervalMs?: number;
  enabled: boolean;
  lastFiredAt: number | null;
  nextFireAt: number | null;
  createdAt: number;
}

export interface AgentPreference {
  id: string;
  agentId: string;
  category: string;
  key: string;
  value: string;
  source: string;
  confidence: 'explicit' | 'inferred' | 'assumed';
  createdAt: number;
  usedCount: number;
  lastUsedAt: number | null;
}
