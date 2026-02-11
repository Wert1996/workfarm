import Phaser from 'phaser';
import { Agent, Task, AgentSession, SessionMessage } from '../../types';
import { AgentManager, TaskManager, ClaudeCodeBridge, eventBus } from '../../control';

export class UIScene extends Phaser.Scene {
  private agentManager!: AgentManager;
  private taskManager!: TaskManager;
  private claudeBridge!: ClaudeCodeBridge;

  private selectedAgentId: string | null = null;
  private domContainer: HTMLDivElement | null = null;

  constructor() {
    super({ key: 'UIScene' });
  }

  create(): void {
    this.agentManager = this.registry.get('agentManager');
    this.taskManager = this.registry.get('taskManager');
    this.claudeBridge = this.registry.get('claudeBridge');

    this.createDOMUI();
    this.setupEventListeners();
  }

  private createDOMUI(): void {
    this.domContainer = document.createElement('div');
    this.domContainer.id = 'ui-container';
    this.domContainer.innerHTML = `
      <style>
        #ui-container {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          font-family: 'Georgia', serif;
          color: #ffeaa7;
        }
        #ui-container * {
          box-sizing: border-box;
        }
        .pointer-events {
          pointer-events: auto;
        }

        /* Top Bar */
        #top-bar {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 60px;
          background: linear-gradient(180deg, rgba(45,52,54,0.95) 0%, rgba(45,52,54,0.8) 100%);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 24px;
          border-bottom: 2px solid #6c5ce755;
        }
        #top-bar h1 {
          font-size: 24px;
          margin: 0;
          color: #ffeaa7;
          text-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        .top-bar-buttons {
          display: flex;
          gap: 12px;
        }
        .btn {
          background: linear-gradient(180deg, #6c5ce7 0%, #5b4cdb 100%);
          border: none;
          color: white;
          padding: 10px 20px;
          border-radius: 8px;
          cursor: pointer;
          font-family: 'Georgia', serif;
          font-size: 14px;
          transition: all 0.2s;
          box-shadow: 0 2px 8px rgba(108,92,231,0.3);
        }
        .btn:hover {
          background: linear-gradient(180deg, #7c6cf7 0%, #6c5ce7 100%);
          transform: translateY(-1px);
        }
        .btn-secondary {
          background: linear-gradient(180deg, #636e72 0%, #535c5f 100%);
          box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }
        .btn-secondary:hover {
          background: linear-gradient(180deg, #737e82 0%, #636e72 100%);
        }

        /* Task Bar */
        #task-bar {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          background: linear-gradient(0deg, rgba(45,52,54,0.98) 0%, rgba(45,52,54,0.9) 100%);
          border-top: 2px solid #6c5ce755;
          padding: 16px 24px;
          max-height: 180px;
          overflow-y: auto;
        }
        #task-bar h3 {
          margin: 0 0 12px 0;
          font-size: 14px;
          color: #b2bec3;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        .task-list {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }
        .task-card {
          background: #3d4449;
          border-radius: 8px;
          padding: 12px 16px;
          min-width: 200px;
          max-width: 280px;
          cursor: pointer;
          transition: all 0.2s;
          border: 2px solid transparent;
        }
        .task-card:hover {
          background: #454d52;
          border-color: #6c5ce755;
        }
        .task-card.in-progress {
          border-left: 4px solid #00b894;
        }
        .task-card.pending {
          border-left: 4px solid #fdcb6e;
        }
        .task-card .task-desc {
          font-size: 13px;
          margin-bottom: 8px;
          color: #dfe6e9;
        }
        .task-card .task-meta {
          font-size: 11px;
          color: #b2bec3;
        }
        .empty-state {
          color: #636e72;
          font-style: italic;
        }

        /* Agent Panel */
        #agent-panel {
          position: absolute;
          right: 20px;
          top: 80px;
          width: 320px;
          background: rgba(45,52,54,0.98);
          border-radius: 12px;
          border: 2px solid #6c5ce7;
          padding: 20px;
          display: none;
          max-height: calc(100vh - 280px);
          overflow-y: auto;
          transition: width 0.2s ease;
        }
        #agent-panel.visible {
          display: block;
        }
        #agent-panel.has-session {
          width: 520px;
        }
        #agent-panel h2 {
          margin: 0 0 16px 0;
          font-size: 20px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .close-btn {
          background: none;
          border: none;
          color: #b2bec3;
          font-size: 24px;
          cursor: pointer;
          padding: 0;
          line-height: 1;
        }
        .close-btn:hover {
          color: #ffeaa7;
        }
        .panel-section {
          margin-bottom: 20px;
        }
        .panel-section label {
          display: block;
          font-size: 11px;
          color: #b2bec3;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 8px;
        }
        .panel-section input, .panel-section select, .panel-section textarea {
          width: 100%;
          background: #3d4449;
          border: 1px solid #636e72;
          color: #dfe6e9;
          padding: 10px 12px;
          border-radius: 6px;
          font-family: 'Georgia', serif;
          font-size: 14px;
        }
        .panel-section input:focus, .panel-section select:focus, .panel-section textarea:focus {
          outline: none;
          border-color: #6c5ce7;
        }
        .panel-section textarea {
          resize: none;
          height: 80px;
        }
        .token-budget {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .token-budget input[type="range"] {
          flex: 1;
          -webkit-appearance: none;
          height: 6px;
          background: #3d4449;
          border-radius: 3px;
          border: none;
          padding: 0;
        }
        .token-budget input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 18px;
          height: 18px;
          background: #6c5ce7;
          border-radius: 50%;
          cursor: pointer;
        }
        .token-budget .budget-value {
          min-width: 60px;
          text-align: right;
          font-size: 14px;
          color: #00b894;
        }
        .stats-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .stat-item {
          background: #3d4449;
          padding: 10px;
          border-radius: 6px;
          text-align: center;
        }
        .stat-item .value {
          font-size: 18px;
          color: #00b894;
        }
        .stat-item .label {
          font-size: 10px;
          color: #b2bec3;
          text-transform: uppercase;
        }
        .btn-danger {
          background: linear-gradient(180deg, #d63031 0%, #c0392b 100%);
          margin-top: 12px;
        }
        .btn-danger:hover {
          background: linear-gradient(180deg, #e84142 0%, #d63031 100%);
        }
        .btn-success {
          background: linear-gradient(180deg, #00b894 0%, #00a085 100%);
        }
        .btn-success:hover {
          background: linear-gradient(180deg, #00cba4 0%, #00b894 100%);
        }

        /* Session Transcript */
        .session-transcript {
          background: #2d3436;
          border-radius: 6px;
          padding: 12px;
          max-height: calc(100vh - 450px);
          overflow-y: auto;
          font-size: 12px;
          font-family: monospace;
          scroll-behavior: smooth;
        }
        .session-msg {
          margin-bottom: 8px;
          padding: 6px 8px;
          border-radius: 4px;
          word-wrap: break-word;
          overflow-wrap: break-word;
        }
        .session-msg.thinking {
          border-left: 3px solid #a29bfe;
          color: #a29bfe;
          font-style: italic;
          background: rgba(162, 155, 254, 0.05);
        }
        .session-msg.tool_use {
          border-left: 3px solid #00b894;
          color: #00cec9;
          background: rgba(0, 184, 148, 0.05);
        }
        .session-msg.tool_result {
          color: #636e72;
          background: rgba(0, 184, 148, 0.03);
          max-height: 200px;
          overflow-y: auto;
          font-size: 11px;
        }
        .session-msg.assistant {
          color: #dfe6e9;
        }
        .session-msg.user {
          border-left: 3px solid #fdcb6e;
          color: #ffeaa7;
          background: rgba(253, 203, 110, 0.05);
        }
        .session-msg.system {
          color: #636e72;
          text-align: center;
          font-size: 11px;
        }
        .session-status {
          display: inline-block;
          padding: 3px 8px;
          border-radius: 4px;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 8px;
        }
        .session-status.active { background: #00b894; color: white; }
        .session-status.starting { background: #fdcb6e; color: #2d3436; }
        .session-status.completed { background: #636e72; color: white; }
        .session-status.error { background: #d63031; color: white; }
        .session-status.waiting_input { background: #6c5ce7; color: white; }

        .session-input-bar {
          display: flex;
          gap: 8px;
          margin-top: 8px;
        }
        .session-input-bar input {
          flex: 1;
          background: #3d4449;
          border: 1px solid #636e72;
          color: #dfe6e9;
          padding: 8px 12px;
          border-radius: 6px;
          font-family: 'Georgia', serif;
          font-size: 13px;
        }
        .session-input-bar input:focus {
          outline: none;
          border-color: #6c5ce7;
        }
        .session-input-bar button {
          padding: 8px 16px;
          font-size: 13px;
        }

        /* Task Detail Panel */
        #task-panel {
          position: absolute;
          right: 20px;
          top: 80px;
          width: 360px;
          background: rgba(45,52,54,0.98);
          border-radius: 12px;
          border: 2px solid #00b894;
          padding: 20px;
          display: none;
          max-height: calc(100vh - 280px);
          overflow-y: auto;
        }
        #task-panel.visible {
          display: block;
        }
        .task-status {
          display: inline-block;
          padding: 4px 10px;
          border-radius: 4px;
          font-size: 11px;
          text-transform: uppercase;
          margin-bottom: 12px;
        }
        .task-status.pending { background: #fdcb6e; color: #2d3436; }
        .task-status.in_progress { background: #00b894; color: white; }
        .task-status.completed { background: #636e72; color: white; }
        .task-status.failed { background: #d63031; color: white; }
        .task-logs {
          background: #2d3436;
          border-radius: 6px;
          padding: 12px;
          max-height: 150px;
          overflow-y: auto;
          font-size: 12px;
          font-family: monospace;
        }
        .task-logs .log-entry {
          margin-bottom: 6px;
          color: #b2bec3;
        }
        .task-logs .log-entry .time {
          color: #636e72;
        }
        .result-box {
          background: #2d3436;
          border-radius: 6px;
          padding: 12px;
          font-size: 13px;
          white-space: pre-wrap;
          max-height: 200px;
          overflow-y: auto;
        }
      </style>

      <!-- Top Bar -->
      <div id="top-bar" class="pointer-events">
        <h1>Work Farm</h1>
        <div class="top-bar-buttons">
          <button class="btn btn-secondary" id="btn-select-dir">Select Project</button>
          <button class="btn" id="btn-hire">+ Hire Agent</button>
        </div>
      </div>

      <!-- Task Bar -->
      <div id="task-bar" class="pointer-events">
        <h3>Active Tasks</h3>
        <div class="task-list" id="task-list"></div>
      </div>

      <!-- Agent Panel -->
      <div id="agent-panel" class="pointer-events">
        <h2>
          <span id="agent-name">Agent</span>
          <button class="close-btn" id="close-agent-panel">&times;</button>
        </h2>
        <div id="agent-content"></div>
      </div>

      <!-- Task Detail Panel -->
      <div id="task-panel" class="pointer-events">
        <h2>
          <span>Task Details</span>
          <button class="close-btn" id="close-task-panel">&times;</button>
        </h2>
        <div id="task-content"></div>
      </div>
    `;

    document.body.appendChild(this.domContainer);

    // Event handlers
    document.getElementById('btn-hire')?.addEventListener('click', () => this.hireAgent());
    document.getElementById('btn-select-dir')?.addEventListener('click', () => this.selectDirectory());
    document.getElementById('close-agent-panel')?.addEventListener('click', () => this.hideAgentPanel());
    document.getElementById('close-task-panel')?.addEventListener('click', () => this.hideTaskPanel());

    this.updateTaskList();
  }

  private setupEventListeners(): void {
    const mainScene = this.scene.get('MainScene');

    mainScene.events.on('agent_selected', (agentId: string) => {
      this.selectedAgentId = agentId;
      this.showAgentPanel(agentId);
      this.hideTaskPanel();
    });

    mainScene.events.on('agent_deselected', () => {
      this.selectedAgentId = null;
      this.hideAgentPanel();
    });

    eventBus.on('task_created', () => this.updateTaskList());
    eventBus.on('task_started', () => this.updateTaskList());
    eventBus.on('task_completed', () => this.updateTaskList());
    eventBus.on('task_failed', () => this.updateTaskList());
    eventBus.on('agent_hired', () => this.updateTaskList());
    eventBus.on('agent_fired', () => this.updateTaskList());

    // Session events
    eventBus.on('session_message', (event) => {
      const { sessionId, message } = event.data;
      this.appendSessionMessage(sessionId, message);
    });

    eventBus.on('session_status_changed', (event) => {
      const { sessionId, status } = event.data;
      this.updateSessionStatus(sessionId, status);
    });

    eventBus.on('session_ended', () => {
      // Refresh the agent panel if one is shown
      if (this.selectedAgentId) {
        this.showAgentPanel(this.selectedAgentId);
      }
    });
  }

  private async selectDirectory(): Promise<void> {
    const dir = await this.claudeBridge.selectWorkingDirectory();
    if (dir) {
      this.showNotification(`Project: ${dir.split('/').pop()}`);
    }
  }

  private hireAgent(): void {
    const agent = this.agentManager.hireAgent();
    this.showNotification(`${agent.name} joined the team!`);
  }

  private showAgentPanel(agentId: string): void {
    const agent = this.agentManager.getAgent(agentId);
    if (!agent) return;

    const panel = document.getElementById('agent-panel');
    const nameEl = document.getElementById('agent-name');
    const contentEl = document.getElementById('agent-content');

    if (!panel || !nameEl || !contentEl) return;

    nameEl.textContent = agent.name;

    const currentTask = agent.currentTaskId ? this.taskManager.getTask(agent.currentTaskId) : null;
    const sessionManager = this.claudeBridge.getSessionManager();
    const activeSession = sessionManager.getActiveSessionForAgent(agentId);

    // Widen panel when session is active
    if (activeSession) {
      panel.classList.add('has-session');
    } else {
      panel.classList.remove('has-session');
    }

    let sessionHtml = '';
    if (activeSession) {
      const messagesHtml = activeSession.messages
        .slice(-50) // Show last 50 messages
        .map(msg => this.renderSessionMessage(msg))
        .join('');

      sessionHtml = `
        <div class="panel-section">
          <label>Session <span class="session-status ${activeSession.status}">${activeSession.status}</span></label>
          <div class="session-transcript" id="session-transcript-${activeSession.id}">
            ${messagesHtml || '<div class="empty-state">Waiting for activity...</div>'}
          </div>
          <div class="session-input-bar">
            <input type="text" id="session-input-${activeSession.id}" placeholder="Send a message to ${agent.name}..." />
            <button class="btn btn-success" id="session-send-${activeSession.id}">Send</button>
          </div>
        </div>
      `;
    }

    // Check for completed session to show result
    const allSessions = sessionManager.getAllSessions().filter(
      s => s.agentId === agentId && s.status === 'completed'
    );
    const lastCompletedSession = allSessions.length > 0 ? allSessions[allSessions.length - 1] : null;

    let completedSessionHtml = '';
    if (!activeSession && lastCompletedSession && lastCompletedSession.messages.length > 0) {
      const recentMsgs = lastCompletedSession.messages.slice(-20).map(msg => this.renderSessionMessage(msg)).join('');
      completedSessionHtml = `
        <div class="panel-section">
          <label>Last Session <span class="session-status completed">completed</span></label>
          <div class="session-transcript" style="max-height: 150px;">
            ${recentMsgs}
          </div>
        </div>
      `;
    }

    contentEl.innerHTML = `
      <div class="panel-section">
        <label>Token Budget</label>
        <div class="token-budget">
          <input type="range" id="token-budget-slider" min="1000" max="50000" step="1000" value="${agent.tokenBudget}">
          <span class="budget-value" id="budget-value">${(agent.tokenBudget / 1000).toFixed(0)}k</span>
        </div>
      </div>

      <div class="panel-section">
        <div class="stats-grid">
          <div class="stat-item">
            <div class="value">${agent.tasksCompleted}</div>
            <div class="label">Tasks Done</div>
          </div>
          <div class="stat-item">
            <div class="value">${(agent.tokensUsed / 1000).toFixed(1)}k</div>
            <div class="label">Tokens Used</div>
          </div>
        </div>
      </div>

      <div class="panel-section">
        <label>Current Task</label>
        ${currentTask
          ? `<div style="background: #3d4449; padding: 10px; border-radius: 6px; font-size: 13px;">${currentTask.description}</div>`
          : `<div class="empty-state">No task assigned</div>`
        }
      </div>

      ${sessionHtml}
      ${completedSessionHtml}

      <div class="panel-section">
        <label>Assign New Task</label>
        <textarea id="new-task-input" placeholder="Describe what you want this agent to do..."></textarea>
        <button class="btn btn-success" id="btn-assign-task" style="width: 100%; margin-top: 8px;">
          ${currentTask ? 'Replace Task' : 'Assign Task'}
        </button>
      </div>

      <button class="btn btn-danger" id="btn-fire-agent" style="width: 100%;">Fire ${agent.name}</button>
    `;

    // Event handlers
    const slider = document.getElementById('token-budget-slider') as HTMLInputElement;
    const budgetValue = document.getElementById('budget-value');
    slider?.addEventListener('input', () => {
      const val = parseInt(slider.value);
      if (budgetValue) budgetValue.textContent = `${(val / 1000).toFixed(0)}k`;
      this.agentManager.setTokenBudget(agentId, val);
    });

    document.getElementById('btn-assign-task')?.addEventListener('click', () => {
      const input = document.getElementById('new-task-input') as HTMLTextAreaElement;
      const description = input?.value.trim();
      if (!description) return;

      // Create and assign task
      const task = this.taskManager.createTask(description);
      this.taskManager.assignAgent(task.id, agentId);
      this.agentManager.assignTask(agentId, task.id);

      // Execute the task — await so panel refreshes after session is created
      this.claudeBridge.executeTask(agentId, task.id).then((result) => {
        this.showAgentPanel(agentId);
        if (!result.success) {
          console.error('executeTask failed:', result.error);
          this.showNotification(`Task failed: ${result.error || 'Unknown error'}`);
        }
      }).catch((err) => {
        console.error('executeTask error:', err);
        this.showNotification(`Error: ${err.message || err}`);
      });

      input.value = '';
      this.updateTaskList();
    });

    // Session input handler
    if (activeSession) {
      const sendMessage = () => {
        const input = document.getElementById(`session-input-${activeSession.id}`) as HTMLInputElement;
        const msg = input?.value.trim();
        if (!msg) return;
        this.claudeBridge.sendMessageToAgent(agentId, msg);
        input.value = '';
      };

      document.getElementById(`session-send-${activeSession.id}`)?.addEventListener('click', sendMessage);
      document.getElementById(`session-input-${activeSession.id}`)?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendMessage();
      });

      // Auto-scroll to bottom of transcript
      const transcript = document.getElementById(`session-transcript-${activeSession.id}`);
      if (transcript) {
        transcript.scrollTop = transcript.scrollHeight;
      }
    }

    document.getElementById('btn-fire-agent')?.addEventListener('click', () => {
      if (confirm(`Are you sure you want to fire ${agent.name}?`)) {
        // Stop active session if any
        if (activeSession) {
          this.claudeBridge.cancelExecution(agentId);
        }
        this.agentManager.fireAgent(agentId);
        this.hideAgentPanel();
      }
    });

    panel.classList.add('visible');
  }

  private stripAnsi(text: string): string {
    // Remove ANSI escape codes (color, cursor, etc.)
    return text.replace(/\x1b\[[0-9;]*[a-zA-Z]|\[[\d;]*m/g, '');
  }

  private renderSessionMessage(msg: SessionMessage): string {
    const content = this.escapeHtml(this.stripAnsi(msg.content));

    if (msg.type === 'tool_use') {
      const toolName = msg.metadata?.toolName || 'tool';
      return `<div class="session-msg tool_use">[${this.escapeHtml(toolName)}]</div>`;
    }

    if (msg.type === 'tool_result') {
      const shortContent = content.length > 500 ? content.substring(0, 500) + '...' : content;
      return `<div class="session-msg tool_result">${shortContent}</div>`;
    }

    return `<div class="session-msg ${msg.type}">${content}</div>`;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private appendSessionMessage(sessionId: string, message: SessionMessage): void {
    const transcript = document.getElementById(`session-transcript-${sessionId}`);
    if (!transcript) return;

    // Remove empty state if present
    const emptyState = transcript.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    const html = this.renderSessionMessage(message);
    transcript.insertAdjacentHTML('beforeend', html);

    // Auto-scroll
    transcript.scrollTop = transcript.scrollHeight;
  }

  private updateSessionStatus(sessionId: string, status: string): void {
    // Find and update any status badges in the DOM
    const statusEls = document.querySelectorAll('.session-status');
    statusEls.forEach(el => {
      // Update if this is the right session's status badge
      const parentSection = el.closest('.panel-section');
      if (parentSection?.querySelector(`#session-transcript-${sessionId}`)) {
        el.className = `session-status ${status}`;
        el.textContent = status;
      }
    });
  }

  private hideAgentPanel(): void {
    const panel = document.getElementById('agent-panel');
    panel?.classList.remove('visible');
    panel?.classList.remove('has-session');
  }

  private showTaskPanel(taskId: string): void {
    const task = this.taskManager.getTask(taskId);
    if (!task) return;

    this.hideAgentPanel();

    const panel = document.getElementById('task-panel');
    const contentEl = document.getElementById('task-content');

    if (!panel || !contentEl) return;

    const agent = task.assignedAgentId ? this.agentManager.getAgent(task.assignedAgentId) : null;

    contentEl.innerHTML = `
      <div class="task-status ${task.status}">${task.status.replace('_', ' ')}</div>

      <div class="panel-section">
        <label>Description</label>
        <div style="font-size: 14px; color: #dfe6e9;">${task.description}</div>
      </div>

      <div class="panel-section">
        <label>Assigned To</label>
        <div style="font-size: 14px;">${agent ? agent.name : '<span class="empty-state">Unassigned</span>'}</div>
      </div>

      <div class="panel-section">
        <label>Tokens Used</label>
        <div style="font-size: 14px; color: #00b894;">${task.tokensUsed.toLocaleString()}</div>
      </div>

      ${task.result ? `
        <div class="panel-section">
          <label>Result</label>
          <div class="result-box">${task.result}</div>
        </div>
      ` : ''}

      <div class="panel-section">
        <label>Logs</label>
        <div class="task-logs">
          ${task.logs.length > 0
            ? task.logs.slice(-10).reverse().map(log => `
                <div class="log-entry">
                  <span class="time">${new Date(log.timestamp).toLocaleTimeString()}</span>
                  ${log.message}
                </div>
              `).join('')
            : '<div class="empty-state">No logs yet</div>'
          }
        </div>
      </div>

      <button class="btn btn-danger" id="btn-delete-task" style="width: 100%;">Delete Task</button>
    `;

    document.getElementById('btn-delete-task')?.addEventListener('click', () => {
      if (confirm('Delete this task?')) {
        if (task.assignedAgentId) {
          this.agentManager.unassignTask(task.assignedAgentId);
        }
        this.taskManager.deleteTask(taskId);
        this.hideTaskPanel();
        this.updateTaskList();
      }
    });

    panel.classList.add('visible');
  }

  private hideTaskPanel(): void {
    document.getElementById('task-panel')?.classList.remove('visible');
  }

  private updateTaskList(): void {
    const listEl = document.getElementById('task-list');
    if (!listEl) return;

    const tasks = this.taskManager.getActiveTasks();

    if (tasks.length === 0) {
      listEl.innerHTML = '<div class="empty-state">No active tasks. Click on an agent to assign work.</div>';
      return;
    }

    listEl.innerHTML = tasks.map(task => {
      const agent = task.assignedAgentId ? this.agentManager.getAgent(task.assignedAgentId) : null;
      return `
        <div class="task-card ${task.status}" data-task-id="${task.id}">
          <div class="task-desc">${task.description.substring(0, 60)}${task.description.length > 60 ? '...' : ''}</div>
          <div class="task-meta">
            ${agent ? agent.name : 'Unassigned'}
            · ${task.status.replace('_', ' ')}
          </div>
        </div>
      `;
    }).join('');

    // Add click handlers
    listEl.querySelectorAll('.task-card').forEach(card => {
      card.addEventListener('click', () => {
        const taskId = (card as HTMLElement).dataset.taskId;
        if (taskId) this.showTaskPanel(taskId);
      });
    });
  }

  private showNotification(message: string): void {
    const notif = document.createElement('div');
    notif.style.cssText = `
      position: fixed;
      bottom: 200px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(180deg, #00b894 0%, #00a085 100%);
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      font-family: Georgia, serif;
      font-size: 14px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      animation: fadeInOut 2s forwards;
      z-index: 10000;
    `;
    notif.textContent = message;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes fadeInOut {
        0% { opacity: 0; transform: translateX(-50%) translateY(10px); }
        15% { opacity: 1; transform: translateX(-50%) translateY(0); }
        85% { opacity: 1; transform: translateX(-50%) translateY(0); }
        100% { opacity: 0; transform: translateX(-50%) translateY(-10px); }
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(notif);

    setTimeout(() => {
      notif.remove();
      style.remove();
    }, 2000);
  }

  shutdown(): void {
    this.domContainer?.remove();
  }
}
