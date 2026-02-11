import { v4 as uuidv4 } from 'uuid';
import { AgentSession, SessionMessage, SessionStatus, SessionMessageType } from '../types';
import { eventBus } from './EventBus';

export class SessionManager {
  private sessions: Map<string, AgentSession> = new Map();
  private agentSessionMap: Map<string, string> = new Map(); // agentId -> sessionId
  private eventCleanup: (() => void) | null = null;

  constructor() {
    this.setupEventListener();
  }

  private setupEventListener(): void {
    this.eventCleanup = window.workfarm.onSessionEvent((data) => {
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
    systemPrompt?: string
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

    await window.workfarm.startSession({
      sessionId,
      prompt,
      workingDirectory: workingDir,
      systemPrompt,
    });

    session.status = 'active';
    eventBus.emit('session_status_changed', { sessionId, status: 'active' });

    return sessionId;
  }

  async sendMessage(sessionId: string, message: string, workingDir: string): Promise<void> {
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

    await window.workfarm.sendToSession({
      sessionId,
      message,
      workingDirectory: workingDir,
    });
  }

  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    await window.workfarm.stopSession(sessionId);
    this.endSession(sessionId, 'error');
  }

  private handleStreamEvent(sessionId: string, event: any): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.lastActivityAt = Date.now();

    // Handle the result/close event (session ended)
    if (event.type === 'result') {
      if (event.subtype === 'close' || event.subtype === 'error') {
        const finalStatus: SessionStatus = event.subtype === 'error' ? 'error' : 'completed';
        // Extract result text if present
        if (event.result) {
          const msg = this.createMessage('assistant', typeof event.result === 'string' ? event.result : JSON.stringify(event.result));
          session.messages.push(msg);
          eventBus.emit('session_message', { sessionId, message: msg });
        }
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
