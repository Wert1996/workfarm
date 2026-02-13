import * as fs from 'fs';
import * as path from 'path';
import { spawn, execSync, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { RuntimeAdapter } from './RuntimeAdapter';

export class NodeAdapter implements RuntimeAdapter {
  private dataDir: string;
  private agentsFile: string;
  private tasksFile: string;
  private goalsFile: string;
  private triggersFile: string;
  private memoryDir: string;
  private logsDir: string;
  private preferencesDir: string;
  private claudePath: string = 'claude';
  private workingDirectory: string;

  private sessionProcesses = new Map<string, ChildProcess>();
  private emitter = new EventEmitter();

  constructor(options: { dataDir?: string; workingDirectory?: string } = {}) {
    const home = process.env.HOME || process.env.USERPROFILE || '.';
    this.dataDir = options.dataDir || path.join(home, '.workfarm-data');
    this.workingDirectory = options.workingDirectory || process.cwd();
    this.agentsFile = path.join(this.dataDir, 'agents.json');
    this.tasksFile = path.join(this.dataDir, 'tasks.json');
    this.goalsFile = path.join(this.dataDir, 'goals.json');
    this.triggersFile = path.join(this.dataDir, 'triggers.json');
    this.memoryDir = path.join(this.dataDir, 'memory');
    this.logsDir = path.join(this.dataDir, 'logs');
    this.preferencesDir = path.join(this.dataDir, 'preferences');

    this.ensureDataDir();
    this.resolveClaudePath();
  }

  private ensureDataDir(): void {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(this.memoryDir, { recursive: true });
    fs.mkdirSync(this.logsDir, { recursive: true });
    fs.mkdirSync(this.preferencesDir, { recursive: true });
  }

  private resolveClaudePath(): void {
    try {
      this.claudePath = execSync('which claude', { encoding: 'utf-8', shell: '/bin/sh' }).trim();
    } catch {
      this.claudePath = 'claude';
    }
  }

  // --- Persistence ---

  async loadAgents(): Promise<any[]> {
    try {
      if (fs.existsSync(this.agentsFile)) {
        return JSON.parse(fs.readFileSync(this.agentsFile, 'utf-8'));
      }
      return [];
    } catch { return []; }
  }

  async saveAgents(agents: any[]): Promise<{ success: boolean; error?: string }> {
    try {
      fs.writeFileSync(this.agentsFile, JSON.stringify(agents, null, 2));
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async loadTasks(): Promise<any[]> {
    try {
      if (fs.existsSync(this.tasksFile)) {
        return JSON.parse(fs.readFileSync(this.tasksFile, 'utf-8'));
      }
      return [];
    } catch { return []; }
  }

  async saveTasks(tasks: any[]): Promise<{ success: boolean; error?: string }> {
    try {
      fs.writeFileSync(this.tasksFile, JSON.stringify(tasks, null, 2));
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async loadAgentMemory(agentId: string): Promise<{ conversations: any[]; context: any }> {
    try {
      const memoryFile = path.join(this.memoryDir, `${agentId}.json`);
      if (fs.existsSync(memoryFile)) {
        return JSON.parse(fs.readFileSync(memoryFile, 'utf-8'));
      }
      return { conversations: [], context: {} };
    } catch { return { conversations: [], context: {} }; }
  }

  async saveAgentMemory(agentId: string, memory: any): Promise<{ success: boolean; error?: string }> {
    try {
      const memoryFile = path.join(this.memoryDir, `${agentId}.json`);
      fs.writeFileSync(memoryFile, JSON.stringify(memory, null, 2));
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // --- Goals & Triggers ---

  async loadGoals(): Promise<any[]> {
    try {
      if (fs.existsSync(this.goalsFile)) {
        return JSON.parse(fs.readFileSync(this.goalsFile, 'utf-8'));
      }
      return [];
    } catch { return []; }
  }

  async saveGoals(goals: any[]): Promise<{ success: boolean; error?: string }> {
    try {
      fs.writeFileSync(this.goalsFile, JSON.stringify(goals, null, 2));
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async loadTriggers(): Promise<any[]> {
    try {
      if (fs.existsSync(this.triggersFile)) {
        return JSON.parse(fs.readFileSync(this.triggersFile, 'utf-8'));
      }
      return [];
    } catch { return []; }
  }

  async saveTriggers(triggers: any[]): Promise<{ success: boolean; error?: string }> {
    try {
      fs.writeFileSync(this.triggersFile, JSON.stringify(triggers, null, 2));
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // --- Preferences ---

  async loadPreferences(agentId: string): Promise<any[]> {
    try {
      const file = path.join(this.preferencesDir, `${agentId}.json`);
      if (fs.existsSync(file)) {
        return JSON.parse(fs.readFileSync(file, 'utf-8'));
      }
      return [];
    } catch { return []; }
  }

  async savePreferences(agentId: string, preferences: any[]): Promise<{ success: boolean; error?: string }> {
    try {
      const file = path.join(this.preferencesDir, `${agentId}.json`);
      fs.writeFileSync(file, JSON.stringify(preferences, null, 2));
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // --- Observability logs ---

  async appendLog(agentId: string, event: any): Promise<void> {
    const logFile = path.join(this.logsDir, `${agentId}.jsonl`);
    fs.appendFileSync(logFile, JSON.stringify(event) + '\n');
  }

  async readLogs(agentId: string, opts?: { since?: number; until?: number }): Promise<any[]> {
    const logFile = path.join(this.logsDir, `${agentId}.jsonl`);
    try {
      if (!fs.existsSync(logFile)) return [];
      const lines = fs.readFileSync(logFile, 'utf-8').split('\n').filter(l => l.trim());
      let events = lines.map(l => JSON.parse(l));
      if (opts?.since) events = events.filter(e => e.timestamp >= opts.since!);
      if (opts?.until) events = events.filter(e => e.timestamp <= opts.until!);
      return events;
    } catch { return []; }
  }

  // --- Session lifecycle ---

  async startSession(options: {
    sessionId: string;
    prompt: string;
    workingDirectory: string;
    systemPrompt?: string;
    allowedTools?: string[];
    maxTurns?: number;
  }): Promise<{ success: boolean; sessionId: string }> {
    const { sessionId, prompt, workingDirectory, systemPrompt, allowedTools, maxTurns } = options;

    const args = [
      '--print', '--verbose',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--session-id', sessionId,
    ];

    if (systemPrompt) {
      args.push('--append-system-prompt', systemPrompt);
    }
    if (allowedTools && allowedTools.length > 0) {
      args.push('--allowedTools', allowedTools.join(','));
    }
    if (maxTurns && maxTurns > 0) {
      args.push('--max-turns', String(maxTurns));
    }
    args.push('--', prompt);

    this.spawnSessionProcess(sessionId, args, workingDirectory);
    return { success: true, sessionId };
  }

  async sendToSession(options: {
    sessionId: string;
    message: string;
    workingDirectory: string;
    allowedTools?: string[];
  }): Promise<{ success: boolean }> {
    const { sessionId, message, workingDirectory, allowedTools } = options;

    // Kill existing process for this session if still running
    const existing = this.sessionProcesses.get(sessionId);
    if (existing) {
      existing.kill('SIGTERM');
      this.sessionProcesses.delete(sessionId);
    }

    const args = [
      '--print', '--verbose',
      '--resume', sessionId,
      '--output-format', 'stream-json',
      '--include-partial-messages',
    ];

    if (allowedTools && allowedTools.length > 0) {
      args.push('--allowedTools', allowedTools.join(','));
    }
    args.push('--', message);

    this.spawnSessionProcess(sessionId, args, workingDirectory);
    return { success: true };
  }

  async stopSession(sessionId: string): Promise<{ success: boolean; error?: string }> {
    const proc = this.sessionProcesses.get(sessionId);
    if (proc) {
      proc.kill('SIGTERM');
      this.sessionProcesses.delete(sessionId);
      return { success: true };
    }
    return { success: false, error: 'No session process found' };
  }

  onSessionEvent(callback: (data: { sessionId: string; event: any }) => void): () => void {
    this.emitter.on('session-event', callback);
    return () => { this.emitter.off('session-event', callback); };
  }

  // --- Legacy Claude Code ---

  async claudeCodeCancel(_agentId: string): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Legacy cancel not supported in TUI mode' };
  }

  onClaudeCodeProgress(callback: (data: { agentId: string; chunk: string; type: 'stdout' | 'stderr' }) => void): () => void {
    this.emitter.on('claude-progress', callback);
    return () => { this.emitter.off('claude-progress', callback); };
  }

  // --- Skills ---

  async ensureSkills(workingDirectory: string): Promise<{ success: boolean; skillContent?: string; error?: string }> {
    try {
      // Look for SKILL.md relative to the project root
      const candidates = [
        path.join(workingDirectory, '.claude', 'skills', 'find-skills', 'SKILL.md'),
        path.join(__dirname, '..', '..', '.claude', 'skills', 'find-skills', 'SKILL.md'),
      ];

      let skillSource: string | null = null;
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          skillSource = candidate;
          break;
        }
      }

      if (!skillSource) {
        return { success: false, error: 'Skill source not found' };
      }

      const skillContent = fs.readFileSync(skillSource, 'utf-8');
      const targetDir = path.join(workingDirectory, '.claude', 'skills', 'find-skills');
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, 'SKILL.md'), skillContent);
      return { success: true, skillContent };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // --- File System / Environment ---

  async getWorkingDirectory(): Promise<string> {
    return this.workingDirectory;
  }

  async selectDirectory(): Promise<string | null> {
    // TUI sets directory via constructor or CLI arg; no dialog available.
    return null;
  }

  // --- Process management (ported from electron/main.ts) ---

  private spawnSessionProcess(sessionId: string, args: string[], workingDirectory: string): void {
    const claude = spawn(this.claudePath, args, {
      cwd: workingDirectory,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.sessionProcesses.set(sessionId, claude);

    let lineBuffer = '';
    let hasErrored = false;

    const isSuperseded = () => this.sessionProcesses.get(sessionId) !== claude;

    claude.stdout!.on('data', (data: Buffer) => {
      if (isSuperseded()) return;
      lineBuffer += data.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed);
          this.emitter.emit('session-event', { sessionId, event });
        } catch {
          this.emitter.emit('session-event', {
            sessionId,
            event: { type: 'system', content: trimmed },
          });
        }
      }
    });

    claude.stderr!.on('data', (data: Buffer) => {
      if (isSuperseded()) return;
      this.emitter.emit('session-event', {
        sessionId,
        event: { type: 'system', subtype: 'stderr', content: data.toString() },
      });
    });

    claude.on('close', (code: number | null) => {
      if (isSuperseded()) return;
      if (hasErrored) return;

      // Flush remaining buffer
      if (lineBuffer.trim()) {
        try {
          const event = JSON.parse(lineBuffer.trim());
          this.emitter.emit('session-event', { sessionId, event });
        } catch {
          // ignore
        }
      }

      this.sessionProcesses.delete(sessionId);
      const subtype = (code !== null && code !== 0) ? 'error' : 'close';
      this.emitter.emit('session-event', {
        sessionId,
        event: { type: 'result', subtype, exitCode: code },
      });
    });

    claude.on('error', (error: Error) => {
      if (isSuperseded()) return;
      hasErrored = true;
      this.sessionProcesses.delete(sessionId);
      this.emitter.emit('session-event', {
        sessionId,
        event: { type: 'result', subtype: 'error', error: error.message },
      });
    });
  }

  // --- Lifecycle ---

  destroy(): void {
    this.sessionProcesses.forEach((proc) => proc.kill('SIGTERM'));
    this.sessionProcesses.clear();
    this.emitter.removeAllListeners();
  }
}
