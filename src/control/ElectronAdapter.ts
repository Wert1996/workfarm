import { RuntimeAdapter } from './RuntimeAdapter';

// Type declaration for the preload bridge (defined in electron/preload.ts,
// which isn't in the renderer tsconfig scope).
declare global {
  interface Window {
    workfarm: RuntimeAdapter & {
      claudeCodeExecute: (options: any) => Promise<any>;
    };
  }
}

export class ElectronAdapter implements RuntimeAdapter {
  private get api() {
    return window.workfarm;
  }

  loadAgents() { return this.api.loadAgents(); }
  saveAgents(agents: any[]) { return this.api.saveAgents(agents); }
  loadTasks() { return this.api.loadTasks(); }
  saveTasks(tasks: any[]) { return this.api.saveTasks(tasks); }

  loadAgentMemory(agentId: string) { return this.api.loadAgentMemory(agentId); }
  saveAgentMemory(agentId: string, memory: any) { return this.api.saveAgentMemory(agentId, memory); }

  loadGoals() { return this.api.loadGoals(); }
  saveGoals(goals: any[]) { return this.api.saveGoals(goals); }
  loadTriggers() { return this.api.loadTriggers(); }
  saveTriggers(triggers: any[]) { return this.api.saveTriggers(triggers); }

  loadPreferences(agentId: string) { return this.api.loadPreferences(agentId); }
  savePreferences(agentId: string, preferences: any[]) { return this.api.savePreferences(agentId, preferences); }

  appendLog(agentId: string, event: any) { return this.api.appendLog(agentId, event); }
  readLogs(agentId: string, opts?: { since?: number; until?: number }) { return this.api.readLogs(agentId, opts); }

  startSession(options: Parameters<RuntimeAdapter['startSession']>[0]) { return this.api.startSession(options); }
  sendToSession(options: Parameters<RuntimeAdapter['sendToSession']>[0]) { return this.api.sendToSession(options); }
  stopSession(sessionId: string) { return this.api.stopSession(sessionId); }
  onSessionEvent(callback: Parameters<RuntimeAdapter['onSessionEvent']>[0]) { return this.api.onSessionEvent(callback); }

  claudeCodeCancel(agentId: string) { return this.api.claudeCodeCancel(agentId); }
  onClaudeCodeProgress(callback: Parameters<RuntimeAdapter['onClaudeCodeProgress']>[0]) { return this.api.onClaudeCodeProgress(callback); }

  loadConfig() { return this.api.loadConfig(); }
  saveConfig(config: Record<string, any>) { return this.api.saveConfig(config); }

  ensureSkills(workingDirectory: string) { return this.api.ensureSkills(workingDirectory); }
  getWorkingDirectory() { return this.api.getWorkingDirectory(); }
  selectDirectory() { return this.api.selectDirectory(); }
}
