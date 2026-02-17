import { v4 as uuidv4 } from 'uuid';
import { AgentSession, SessionMessage, SessionStatus, SessionMessageType } from '../types';
import { RuntimeAdapter } from './RuntimeAdapter';
import { eventBus } from './EventBus';

export class SessionManager {
  private runtime: RuntimeAdapter;
  private sessions: Map<string, AgentSession> = new Map();
  private agentSessionMap: Map<string, string> = new Map(); // agentId -> sessionId
  private eventCleanup: (() => void) | null = null;

  constructor(runtime: RuntimeAdapter) {
    this.runtime = runtime;
    this.setupEventListener();
  }

  private setupEventListener(): void {
    this.eventCleanup = this.runtime.onSessionEvent((data) => {
      this.handleStreamEvent(data.sessionId, data.event);
    });
  }

  destroy(): void {
    if (this.eventCleanup) {
      this.eventCleanup();
      this.eventCleanup = null;
    }
  }

  async startSession(
    agentId: string,
    taskId: string,
    prompt: string,
    workingDir: string,
    systemPrompt?: string,
    allowedTools?: string[],
    maxTurns?: number,
    additionalDirs?: string[]
  ): Promise<string> {
    const sessionId = uuidv4();

    const session: AgentSession = {
      id: sessionId,
      agentId,
      taskId,
      status: 'starting',
      messages: [],
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    this.sessions.set(sessionId, session);
    this.agentSessionMap.set(agentId, sessionId);

    eventBus.emit('session_created', { sessionId, agentId, taskId });

    await this.runtime.startSession({
      sessionId,
      prompt,
      workingDirectory: workingDir,
      systemPrompt,
      allowedTools,
      maxTurns,
      agentId,
      additionalDirs,
    });

    session.status = 'active';
    eventBus.emit('session_status_changed', { sessionId, status: 'active' });

    return sessionId;
  }

  async sendMessage(sessionId: string, message: string, workingDir: string, allowedTools?: string[]): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Add user message to session
    const userMsg: SessionMessage = {
      id: uuidv4(),
      timestamp: Date.now(),
      type: 'user',
      content: message,
    };
    session.messages.push(userMsg);
    session.lastActivityAt = Date.now();
    session.status = 'active';

    eventBus.emit('session_message', { sessionId, message: userMsg });
    eventBus.emit('session_status_changed', { sessionId, status: 'active' });

    await this.runtime.sendToSession({
      sessionId,
      message,
      workingDirectory: workingDir,
      allowedTools,
      agentId: session.agentId,
    });
  }

  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    await this.runtime.stopSession(sessionId);
    this.endSession(sessionId, 'error');
  }

  private handleStreamEvent(sessionId: string, event: any): void {
    // Debug: uncomment to trace raw stream events
    // console.log('[SessionManager] event received:', sessionId.substring(0, 8), event.type, event.subtype || '');
    const session = this.sessions.get(sessionId);
    if (!session) {
      // Silently ignore — LLM-only sessions (adversary) bypass SessionManager
      return;
    }

    session.lastActivityAt = Date.now();

    // Handle the result event (session ended)
    // CLI sends subtype 'success' or 'error'; process close handler sends 'close' or 'error'
    if (event.type === 'result') {
      const isEnd = event.subtype === 'close' || event.subtype === 'success' || event.subtype === 'error';
      if (isEnd) {
        // Extract result text only if no assistant messages were already streamed
        // (the 'assistant' event delivers the same content during streaming).
        if (event.result) {
          const hasAssistantMessages = session.messages.some(m => m.type === 'assistant');
          if (!hasAssistantMessages) {
            const msg = this.createMessage('assistant', typeof event.result === 'string' ? event.result : JSON.stringify(event.result));
            session.messages.push(msg);
            eventBus.emit('session_message', { sessionId, message: msg, agentId: session.agentId });
          }
        }

        // Check for permission denials before ending session
        if (event.permission_denials && event.permission_denials.length > 0) {
          const denials = event.permission_denials.map((d: any) => ({
            toolName: d.tool_name || d.toolName || 'unknown',
            toolInput: d.tool_input || d.toolInput || {},
          }));
          // Deduplicate by tool name — only prompt once per unique tool
          const seenTools = new Set<string>();
          const uniqueDenials = denials.filter((d: any) => {
            const lower = d.toolName.toLowerCase();
            if (seenTools.has(lower)) return false;
            seenTools.add(lower);
            return true;
          });
          session.pendingPermissions = uniqueDenials;
          session.status = 'waiting_input';
          eventBus.emit('session_status_changed', { sessionId, status: 'waiting_input' });
          for (const denial of uniqueDenials) {
            eventBus.emit('permission_requested', {
              sessionId,
              agentId: session.agentId,
              taskId: session.taskId,
              toolName: denial.toolName,
              toolInput: denial.toolInput,
            });
          }
          return; // Don't end the session — wait for user decision
        }

        // Don't end the session if it's paused waiting for permission approval —
        // the process-close event arrives after the permission_denials result,
        // and would otherwise tear down the session while the user is deciding.
        if (session.status === 'waiting_input') return;

        const finalStatus: SessionStatus = event.subtype === 'error' ? 'error' : 'completed';
        this.endSession(sessionId, finalStatus);
        return;
      }
    }

    // Parse stream-json events into SessionMessages
    const msg = this.parseStreamEvent(event);
    if (msg) {
      session.messages.push(msg);
      eventBus.emit('session_message', { sessionId, message: msg, agentId: session.agentId });
    }
  }

  private parseStreamEvent(event: any): SessionMessage | null {
    // Claude stream-json event types:
    // - { type: "assistant", message: { ... } } — assistant text blocks
    // - { type: "content_block_start", content_block: { type: "thinking" | "text" | "tool_use", ... } }
    // - { type: "content_block_delta", delta: { ... } }
    // - { type: "content_block_stop" }
    // - { type: "message_start" }, { type: "message_delta" }, { type: "message_stop" }
    // Also handle simplified events from --output-format stream-json

    if (event.type === 'assistant' && event.message) {
      // Full assistant message with content blocks
      const content = this.extractContentFromMessage(event.message);
      if (content) {
        return this.createMessage('assistant', content);
      }
      return null;
    }

    if (event.type === 'content_block_start' && event.content_block) {
      const block = event.content_block;
      if (block.type === 'thinking' && block.thinking) {
        return this.createMessage('thinking', block.thinking);
      }
      if (block.type === 'tool_use') {
        return this.createMessage('tool_use', block.name || 'tool', { toolName: block.name, toolId: block.id, input: block.input });
      }
      if (block.type === 'text' && block.text) {
        return this.createMessage('assistant', block.text);
      }
    }

    if (event.type === 'content_block_delta' && event.delta) {
      const delta = event.delta;
      if (delta.type === 'thinking_delta' && delta.thinking) {
        return this.createMessage('thinking', delta.thinking);
      }
      if (delta.type === 'text_delta' && delta.text) {
        return this.createMessage('assistant', delta.text);
      }
      if (delta.type === 'input_json_delta' && delta.partial_json) {
        return null; // Skip partial JSON deltas to avoid noise
      }
    }

    if (event.type === 'tool_result' || (event.type === 'system' && event.subtype === 'tool_result')) {
      const content = event.content || event.output || '';
      return this.createMessage('tool_result', typeof content === 'string' ? content : JSON.stringify(content));
    }

    if (event.type === 'system') {
      return this.createMessage('system', event.content || '');
    }

    return null;
  }

  private extractContentFromMessage(message: any): string {
    if (!message.content) return '';
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
      return message.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n');
    }
    return '';
  }

  private createMessage(type: SessionMessageType, content: string, metadata?: Record<string, any>): SessionMessage {
    return {
      id: uuidv4(),
      timestamp: Date.now(),
      type,
      content,
      metadata,
    };
  }

  private endSession(sessionId: string, status: SessionStatus): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Prevent double-ending (both 'error' and 'close' events can fire)
    if (session.status === 'completed' || session.status === 'error') return;

    session.status = status;
    session.lastActivityAt = Date.now();

    // Clean up agent mapping
    this.agentSessionMap.delete(session.agentId);

    eventBus.emit('session_status_changed', { sessionId, status });
    eventBus.emit('session_ended', {
      sessionId,
      agentId: session.agentId,
      taskId: session.taskId,
      status,
    });
  }

  /**
   * Remove one tool from pendingPermissions (case-insensitive).
   * Returns the actual tool name from the pending permission, and whether all are now approved.
   */
  approvePermission(sessionId: string, toolName: string): { resolved: string; allApproved: boolean } {
    const session = this.sessions.get(sessionId);
    if (!session?.pendingPermissions) return { resolved: toolName, allApproved: true };

    const lower = toolName.toLowerCase();
    const match = session.pendingPermissions.find((p) => p.toolName.toLowerCase() === lower);
    const resolved = match?.toolName || toolName;

    session.pendingPermissions = session.pendingPermissions.filter(
      (p) => p.toolName.toLowerCase() !== lower
    );
    return { resolved, allApproved: session.pendingPermissions.length === 0 };
  }

  async resumeSession(sessionId: string, allowedTools: string[], workingDir: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = 'active';
    session.pendingPermissions = undefined;
    session.lastActivityAt = Date.now();

    // Re-register agent mapping in case it was cleared
    this.agentSessionMap.set(session.agentId, sessionId);

    eventBus.emit('session_status_changed', { sessionId, status: 'active' });

    await this.runtime.sendToSession({
      sessionId,
      message: 'Permission granted. Continue your task.',
      workingDirectory: workingDir,
      allowedTools,
      agentId: session.agentId,
    });
  }

  denyPermission(sessionId: string): void {
    this.endSession(sessionId, 'completed');
  }

  getSession(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  getActiveSessionForAgent(agentId: string): AgentSession | undefined {
    const sessionId = this.agentSessionMap.get(agentId);
    if (!sessionId) return undefined;
    const session = this.sessions.get(sessionId);
    if (session && (session.status === 'active' || session.status === 'starting' || session.status === 'waiting_input')) {
      return session;
    }
    return undefined;
  }

  getAllSessions(): AgentSession[] {
    return Array.from(this.sessions.values());
  }
}
