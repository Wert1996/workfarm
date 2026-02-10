import { contextBridge, ipcRenderer } from 'electron';

// Type definitions for the API exposed to renderer
export interface WorkFarmAPI {
  // Persistence
  loadAgents: () => Promise<any[]>;
  saveAgents: (agents: any[]) => Promise<{ success: boolean; error?: string }>;
  loadTasks: () => Promise<any[]>;
  saveTasks: (tasks: any[]) => Promise<{ success: boolean; error?: string }>;

  // Agent memory
  loadAgentMemory: (agentId: string) => Promise<{ conversations: any[]; context: any }>;
  saveAgentMemory: (agentId: string, memory: any) => Promise<{ success: boolean; error?: string }>;

  // Claude Code integration
  claudeCodeExecute: (options: {
    agentId: string;
    prompt: string;
    workingDirectory: string;
    thinkingBudget?: 'low' | 'medium' | 'high';
  }) => Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    parsed?: any;
    error?: string;
  }>;
  claudeCodeCancel: (agentId: string) => Promise<{ success: boolean; error?: string }>;

  // Progress listener
  onClaudeCodeProgress: (callback: (data: {
    agentId: string;
    chunk: string;
    type: 'stdout' | 'stderr';
  }) => void) => () => void;

  // File system
  getWorkingDirectory: () => Promise<string>;
  selectDirectory: () => Promise<string | null>;
}

const api: WorkFarmAPI = {
  // Persistence
  loadAgents: () => ipcRenderer.invoke('load-agents'),
  saveAgents: (agents) => ipcRenderer.invoke('save-agents', agents),
  loadTasks: () => ipcRenderer.invoke('load-tasks'),
  saveTasks: (tasks) => ipcRenderer.invoke('save-tasks', tasks),

  // Agent memory
  loadAgentMemory: (agentId) => ipcRenderer.invoke('load-agent-memory', agentId),
  saveAgentMemory: (agentId, memory) => ipcRenderer.invoke('save-agent-memory', agentId, memory),

  // Claude Code integration
  claudeCodeExecute: (options) => ipcRenderer.invoke('claude-code-execute', options),
  claudeCodeCancel: (agentId) => ipcRenderer.invoke('claude-code-cancel', agentId),

  // Progress listener with cleanup
  onClaudeCodeProgress: (callback) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('claude-code-progress', handler);
    return () => ipcRenderer.removeListener('claude-code-progress', handler);
  },

  // File system
  getWorkingDirectory: () => ipcRenderer.invoke('get-working-directory'),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
};

contextBridge.exposeInMainWorld('workfarm', api);

// Add type declaration for window
declare global {
  interface Window {
    workfarm: WorkFarmAPI;
  }
}
