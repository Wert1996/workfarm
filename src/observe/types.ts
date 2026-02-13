export interface ObservabilityEvent {
  timestamp: number;
  agentId?: string;
  goalId?: string;
  taskId?: string;
  type: string;
  data: any;
}
