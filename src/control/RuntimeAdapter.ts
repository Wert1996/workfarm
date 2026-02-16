export interface RuntimeAdapter {
  // --- Persistence ---
  loadAgents(): Promise<any[]>;
  saveAgents(agents: any[]): Promise<{ success: boolean; error?: string }>;
  loadTasks(): Promise<any[]>;
  saveTasks(tasks: any[]): Promise<{ success: boolean; error?: string }>;

  // --- Agent Memory ---
  loadAgentMemory(agentId: string): Promise<{ conversations: any[]; context: any }>;
  saveAgentMemory(agentId: string, memory: any): Promise<{ success: boolean; error?: string }>;

  // --- Session lifecycle ---
  startSession(options: {
    sessionId: string;
    prompt: string;
    workingDirectory: string;
    systemPrompt?: string;
    allowedTools?: string[];
    maxTurns?: number;
    agentId?: string;
    additionalDirs?: string[];
  }): Promise<{ success: boolean; sessionId: string }>;

  sendToSession(options: {
    sessionId: string;
    message: string;
    workingDirectory: string;
    allowedTools?: string[];
    agentId?: string;
  }): Promise<{ success: boolean }>;

  stopSession(sessionId: string): Promise<{ success: boolean; error?: string }>;

  onSessionEvent(callback: (data: {
    sessionId: string;
    event: any;
  }) => void): () => void;

  // --- Legacy Claude Code ---
  claudeCodeCancel(agentId: string): Promise<{ success: boolean; error?: string }>;

  onClaudeCodeProgress(callback: (data: {
    agentId: string;
    chunk: string;
    type: 'stdout' | 'stderr';
  }) => void): () => void;

  // --- Skills ---
  ensureSkills(workingDirectory: string): Promise<{ success: boolean; skillContent?: string; error?: string }>;

  // --- Goals & Triggers ---
  loadGoals(): Promise<any[]>;
  saveGoals(goals: any[]): Promise<{ success: boolean; error?: string }>;
  loadTriggers(): Promise<any[]>;
  saveTriggers(triggers: any[]): Promise<{ success: boolean; error?: string }>;

  // --- Preferences ---
  loadPreferences(agentId: string): Promise<any[]>;
  savePreferences(agentId: string, preferences: any[]): Promise<{ success: boolean; error?: string }>;

  // --- Observability logs (append-only JSONL) ---
  appendLog(agentId: string, event: any): Promise<void>;
  readLogs(agentId: string, opts?: { since?: number; until?: number }): Promise<any[]>;

  // --- Config ---
  loadConfig(): Promise<Record<string, any>>;
  saveConfig(config: Record<string, any>): Promise<{ success: boolean; error?: string }>;

  // --- File System / Environment ---
  getWorkingDirectory(): Promise<string>;
  selectDirectory(): Promise<string | null>;
}
