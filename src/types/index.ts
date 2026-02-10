// ============ Agent ============

export type AgentState = 'idle' | 'working' | 'thinking' | 'walking';

export interface Agent {
  id: string;
  name: string;
  color: number;  // Hex color for the agent sprite
  currentTaskId: string | null;
  state: AgentState;
  tokenBudget: number;  // Max tokens per task execution
  tokensUsed: number;   // Total tokens used lifetime
  hiredAt: number;
  tasksCompleted: number;
  // Position tracking for wandering
  gridX: number;
  gridY: number;
}

// ============ Task ============

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface Task {
  id: string;
  description: string;
  assignedAgentId: string | null;
  status: TaskStatus;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  result: string | null;
  tokensUsed: number;
  logs: TaskLog[];
}

export interface TaskLog {
  timestamp: number;
  message: string;
}

// ============ Agent Memory ============

export interface ConversationEntry {
  timestamp: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  taskId?: string;
}

export interface AgentMemory {
  conversations: ConversationEntry[];
  context: Record<string, any>;
}

// ============ Events ============

export type GameEventType =
  | 'agent_state_changed'
  | 'agent_moved'
  | 'agent_hired'
  | 'agent_fired'
  | 'task_created'
  | 'task_assigned'
  | 'task_started'
  | 'task_completed'
  | 'task_failed'
  | 'claude_progress';

export interface GameEvent {
  type: GameEventType;
  timestamp: number;
  data: any;
}
