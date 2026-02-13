import { v4 as uuidv4 } from 'uuid';
import { Agent, AgentState, AgentMemory } from '../types';
import { AGENT_COLORS, getRandomPosition } from './agentConfig';
import { RuntimeAdapter } from './RuntimeAdapter';
import { eventBus } from './EventBus';

const BASELINE_TOOLS = ['Read', 'Glob', 'Grep'];

// Fun names for agents
const AGENT_NAMES = [
  'Alex', 'Sam', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Quinn',
  'Avery', 'Parker', 'Sage', 'River', 'Phoenix', 'Skyler', 'Dakota', 'Reese',
  'Finley', 'Emery', 'Rowan', 'Blair', 'Ellis', 'Arden', 'Jules', 'Kit',
];

export class AgentManager {
  private runtime: RuntimeAdapter;
  private agents: Map<string, Agent> = new Map();
  private agentMemories: Map<string, AgentMemory> = new Map();
  private usedNames: Set<string> = new Set();
  private colorIndex: number = 0;

  constructor(runtime: RuntimeAdapter) {
    this.runtime = runtime;
  }

  async initialize(): Promise<void> {
    const savedAgents = await this.runtime.loadAgents();
    for (const agent of savedAgents) {
      // Backfill approvedTools for agents loaded from disk that don't have it
      if (!agent.approvedTools) {
        agent.approvedTools = [...BASELINE_TOOLS];
      }
      // Backfill systemPrompt
      if (agent.systemPrompt === undefined) {
        agent.systemPrompt = undefined;
      }
      this.agents.set(agent.id, agent);
      this.usedNames.add(agent.name);
    }

    // Load memories
    for (const agent of this.agents.values()) {
      const memory = await this.runtime.loadAgentMemory(agent.id);
      this.agentMemories.set(agent.id, memory);
    }
  }

  async save(): Promise<void> {
    const agents = Array.from(this.agents.values());
    await this.runtime.saveAgents(agents);

    for (const [agentId, memory] of this.agentMemories) {
      await this.runtime.saveAgentMemory(agentId, memory);
    }
  }

  getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  getAllAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  private pickName(): string {
    // Find unused name
    for (const name of AGENT_NAMES) {
      if (!this.usedNames.has(name)) {
        this.usedNames.add(name);
        return name;
      }
    }
    // Generate numbered name if all used
    let counter = 1;
    while (this.usedNames.has(`Agent ${counter}`)) counter++;
    const name = `Agent ${counter}`;
    this.usedNames.add(name);
    return name;
  }

  private pickColor(): number {
    const color = AGENT_COLORS[this.colorIndex % AGENT_COLORS.length];
    this.colorIndex++;
    return color;
  }

  hireAgent(customName?: string): Agent {
    const pos = getRandomPosition();
    const agent: Agent = {
      id: uuidv4(),
      name: customName || this.pickName(),
      color: this.pickColor(),
      currentTaskId: null,
      state: 'idle',
      tokenBudget: 10000,  // Default budget
      tokensUsed: 0,
      hiredAt: Date.now(),
      tasksCompleted: 0,
      approvedTools: [...BASELINE_TOOLS],
      gridX: pos.x,
      gridY: pos.y,
    };

    this.agents.set(agent.id, agent);
    this.agentMemories.set(agent.id, {
      conversations: [],
      context: {},
    });

    eventBus.emit('agent_hired', { agent });
    this.save();

    return agent;
  }

  fireAgent(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    this.agents.delete(agentId);
    this.agentMemories.delete(agentId);
    this.usedNames.delete(agent.name);

    eventBus.emit('agent_fired', { agentId, agent });
    this.save();

    return true;
  }

  updateAgentState(agentId: string, state: AgentState): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    const oldState = agent.state;
    agent.state = state;

    eventBus.emit('agent_state_changed', {
      agentId,
      oldState,
      newState: state,
      agent,
    });
  }

  updateAgentPosition(agentId: string, gridX: number, gridY: number): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.gridX = gridX;
    agent.gridY = gridY;
  }

  setTokenBudget(agentId: string, budget: number): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.tokenBudget = Math.max(1000, Math.min(100000, budget));
    this.save();
  }

  addTokensUsed(agentId: string, tokens: number): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.tokensUsed += tokens;
  }

  assignTask(agentId: string, taskId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.currentTaskId = taskId;
    this.updateAgentState(agentId, 'working');
  }

  unassignTask(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.currentTaskId = null;
    this.updateAgentState(agentId, 'idle');
  }

  incrementTasksCompleted(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.tasksCompleted++;
  }

  setSystemPrompt(agentId: string, prompt: string | undefined): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.systemPrompt = prompt;
    this.save();
  }

  // Tool permission management
  addApprovedTool(agentId: string, toolName: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    if (!agent.approvedTools.includes(toolName)) {
      agent.approvedTools.push(toolName);
      this.save();
    }
  }

  removeApprovedTool(agentId: string, toolName: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    // Don't allow removing baseline tools
    if (BASELINE_TOOLS.includes(toolName)) return;
    agent.approvedTools = agent.approvedTools.filter(t => t !== toolName);
    this.save();
  }

  getApprovedTools(agentId: string): string[] {
    const agent = this.agents.get(agentId);
    return agent?.approvedTools || [...BASELINE_TOOLS];
  }

  // Memory management
  getAgentMemory(agentId: string): AgentMemory | undefined {
    return this.agentMemories.get(agentId);
  }

  addConversation(
    agentId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    taskId?: string
  ): void {
    const memory = this.agentMemories.get(agentId);
    if (!memory) return;

    memory.conversations.push({
      timestamp: Date.now(),
      role,
      content,
      taskId,
    });

    // Keep last 50 conversations
    if (memory.conversations.length > 50) {
      memory.conversations = memory.conversations.slice(-50);
    }
  }
}
