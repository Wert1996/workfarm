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

// ============ Sessions ============

export type SessionStatus = 'starting' | 'active' | 'waiting_input' | 'completed' | 'error';

export type SessionMessageType = 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'thinking' | 'system';

export interface SessionMessage {
  id: string;
  timestamp: number;
  type: SessionMessageType;
  content: string;
  metadata?: Record<string, any>;
}

export interface AgentSession {
  id: string;
  agentId: string;
  taskId: string;
  status: SessionStatus;
  messages: SessionMessage[];
  startedAt: number;
  lastActivityAt: number;
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
  | 'claude_progress'
  | 'session_created'
  | 'session_message'
  | 'session_status_changed'
  | 'session_ended';

export interface GameEvent {
  type: GameEventType;
  timestamp: number;
  data: any;
}
