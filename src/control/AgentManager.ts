import { v4 as uuidv4 } from 'uuid';
import { Agent, AgentState, AgentMemory } from '../types';
import { COLORS, getRandomPosition } from '../game/config';
import { eventBus } from './EventBus';

// Fun names for agents
const AGENT_NAMES = [
  'Alex', 'Sam', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Quinn',
  'Avery', 'Parker', 'Sage', 'River', 'Phoenix', 'Skyler', 'Dakota', 'Reese',
  'Finley', 'Emery', 'Rowan', 'Blair', 'Ellis', 'Arden', 'Jules', 'Kit',
];

export class AgentManager {
  private agents: Map<string, Agent> = new Map();
  private agentMemories: Map<string, AgentMemory> = new Map();
  private usedNames: Set<string> = new Set();
  private colorIndex: number = 0;

  async initialize(): Promise<void> {
    const savedAgents = await window.workfarm.loadAgents();
    for (const agent of savedAgents) {
      this.agents.set(agent.id, agent);
      this.usedNames.add(agent.name);
    }

    // Load memories
    for (const agent of this.agents.values()) {
      const memory = await window.workfarm.loadAgentMemory(agent.id);
      this.agentMemories.set(agent.id, memory);
    }
  }

  async save(): Promise<void> {
    const agents = Array.from(this.agents.values());
    await window.workfarm.saveAgents(agents);

    for (const [agentId, memory] of this.agentMemories) {
      await window.workfarm.saveAgentMemory(agentId, memory);
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
    const color = COLORS.agentColors[this.colorIndex % COLORS.agentColors.length];
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
