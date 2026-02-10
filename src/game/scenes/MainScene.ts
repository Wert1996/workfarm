import Phaser from 'phaser';
import {
  GRID_WIDTH,
  GRID_HEIGHT,
  COLORS,
  gridToScreen,
  getRandomPosition,
  getNearbyPosition,
} from '../config';
import { Agent, AgentState } from '../../types';
import { AgentManager, TaskManager, ClaudeCodeBridge, eventBus } from '../../control';

interface AgentSprite extends Phaser.GameObjects.Container {
  agentId: string;
  colorIndex: number;
  gridX: number;
  gridY: number;
  sprite: Phaser.GameObjects.Sprite;
  nameText: Phaser.GameObjects.Text;
  taskIndicator: Phaser.GameObjects.Sprite | null;
  isMoving: boolean;
}

export class MainScene extends Phaser.Scene {
  private agentManager!: AgentManager;
  private taskManager!: TaskManager;
  private claudeBridge!: ClaudeCodeBridge;

  private agentSprites: Map<string, AgentSprite> = new Map();
  private selectionRing: Phaser.GameObjects.Sprite | null = null;
  private selectedAgentId: string | null = null;

  private furniture: Phaser.GameObjects.Group | null = null;

  constructor() {
    super({ key: 'MainScene' });
  }

  async create(): Promise<void> {
    // Initialize managers
    this.agentManager = new AgentManager();
    this.taskManager = new TaskManager();

    await this.agentManager.initialize();
    await this.taskManager.initialize();

    this.claudeBridge = new ClaudeCodeBridge(this.agentManager, this.taskManager);
    await this.claudeBridge.initialize();

    // Store for UI scene
    this.registry.set('agentManager', this.agentManager);
    this.registry.set('taskManager', this.taskManager);
    this.registry.set('claudeBridge', this.claudeBridge);

    // Build the workspace
    this.createFloor();
    this.createFurniture();

    // Selection ring
    this.selectionRing = this.add.sprite(0, 0, 'selection_ring');
    this.selectionRing.setVisible(false);
    this.selectionRing.setDepth(5000);

    // Spawn agents
    this.spawnExistingAgents();

    // Event listeners
    this.setupEventListeners();

    // Input
    this.setupInput();

    // Start UI
    this.scene.launch('UIScene');

    // Agent wandering timer
    this.time.addEvent({
      delay: 3000,
      callback: this.wanderAgents,
      callbackScope: this,
      loop: true,
    });

    // Animation updates
    this.time.addEvent({
      delay: 100,
      callback: this.updateAnimations,
      callbackScope: this,
      loop: true,
    });

    // Hide loading
    const loading = document.getElementById('loading');
    if (loading) loading.classList.add('hidden');
  }

  private createFloor(): void {
    // Create checkered wooden floor
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const { x: screenX, y: screenY } = gridToScreen(x, y);
        const isAlt = (x + y) % 2 === 0;

        // Rug in center area
        const isRug = x >= 4 && x <= 7 && y >= 4 && y <= 7;

        let texture = isAlt ? 'tile_floor_alt' : 'tile_floor';
        if (isRug) texture = 'tile_rug';

        const tile = this.add.sprite(screenX, screenY, texture);
        tile.setOrigin(0.5, 0.5);
        tile.setDepth(y * GRID_WIDTH + x);
      }
    }

    // Add subtle ambient light overlay in center
    const lightGlow = this.add.graphics();
    const centerScreen = gridToScreen(GRID_WIDTH / 2, GRID_HEIGHT / 2);
    lightGlow.fillStyle(0xffeaa7, 0.05);
    lightGlow.fillCircle(centerScreen.x, centerScreen.y, 200);
    lightGlow.setDepth(GRID_WIDTH * GRID_HEIGHT + 1);
  }

  private createFurniture(): void {
    this.furniture = this.add.group();

    // Place some desks around the edges
    const deskPositions = [
      { x: 2, y: 2 },
      { x: 9, y: 2 },
      { x: 2, y: 9 },
      { x: 9, y: 9 },
    ];

    deskPositions.forEach((pos) => {
      const { x: screenX, y: screenY } = gridToScreen(pos.x, pos.y);
      const desk = this.add.sprite(screenX, screenY - 10, 'furniture_desk');
      desk.setDepth(pos.y * GRID_WIDTH + pos.x + 50);
      this.furniture!.add(desk);

      // Chair near desk
      const chair = this.add.sprite(screenX + 30, screenY + 10, 'furniture_chair');
      chair.setDepth(pos.y * GRID_WIDTH + pos.x + 51);
      this.furniture!.add(chair);
    });

    // Plants in corners
    const plantPositions = [
      { x: 1, y: 1 },
      { x: 10, y: 1 },
      { x: 1, y: 10 },
      { x: 10, y: 10 },
    ];

    plantPositions.forEach((pos) => {
      const { x: screenX, y: screenY } = gridToScreen(pos.x, pos.y);
      const plant = this.add.sprite(screenX, screenY - 20, 'furniture_plant');
      plant.setDepth(pos.y * GRID_WIDTH + pos.x + 50);
      this.furniture!.add(plant);
    });

    // Lamps
    const lampPositions = [
      { x: 5, y: 1 },
      { x: 6, y: 10 },
    ];

    lampPositions.forEach((pos) => {
      const { x: screenX, y: screenY } = gridToScreen(pos.x, pos.y);
      const lamp = this.add.sprite(screenX, screenY - 20, 'deco_lamp');
      lamp.setDepth(pos.y * GRID_WIDTH + pos.x + 50);
      this.furniture!.add(lamp);
    });

    // Bookshelf
    const shelfPos = gridToScreen(0, 5);
    const shelf = this.add.sprite(shelfPos.x - 20, shelfPos.y - 30, 'deco_bookshelf');
    shelf.setDepth(5 * GRID_WIDTH + 50);
    this.furniture!.add(shelf);
  }

  private spawnExistingAgents(): void {
    const agents = this.agentManager.getAllAgents();
    agents.forEach((agent) => this.createAgentSprite(agent));
  }

  private createAgentSprite(agent: Agent): AgentSprite {
    const { x: screenX, y: screenY } = gridToScreen(agent.gridX, agent.gridY);

    const container = this.add.container(screenX, screenY - 16) as AgentSprite;

    // Find color index from agent color
    const colorIndex = COLORS.agentColors.indexOf(agent.color);
    const textureBase = `agent_${colorIndex >= 0 ? colorIndex : 0}`;

    const sprite = this.add.sprite(0, 0, textureBase);
    sprite.setOrigin(0.5, 1);

    const nameText = this.add.text(0, 4, agent.name, {
      fontSize: '11px',
      color: '#ffeaa7',
      fontFamily: 'Georgia, serif',
      backgroundColor: '#2d343699',
      padding: { x: 4, y: 2 },
    });
    nameText.setOrigin(0.5, 0);

    container.add([sprite, nameText]);

    // Task indicator
    let taskIndicator: Phaser.GameObjects.Sprite | null = null;
    if (agent.currentTaskId) {
      taskIndicator = this.add.sprite(14, -28, 'task_indicator');
      container.add(taskIndicator);
    }

    container.agentId = agent.id;
    container.colorIndex = colorIndex >= 0 ? colorIndex : 0;
    container.gridX = agent.gridX;
    container.gridY = agent.gridY;
    container.sprite = sprite;
    container.nameText = nameText;
    container.taskIndicator = taskIndicator;
    container.isMoving = false;

    container.setDepth(agent.gridY * GRID_WIDTH + agent.gridX + 100);

    // Interactive
    container.setInteractive(
      new Phaser.Geom.Rectangle(-16, -32, 32, 48),
      Phaser.Geom.Rectangle.Contains
    );

    container.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      pointer.event.stopPropagation();
      this.selectAgent(agent.id);
    });

    container.on('pointerover', () => {
      container.setScale(1.15);
      this.game.canvas.style.cursor = 'pointer';
    });

    container.on('pointerout', () => {
      container.setScale(1.0);
      this.game.canvas.style.cursor = 'default';
    });

    this.agentSprites.set(agent.id, container);
    return container;
  }

  private setupEventListeners(): void {
    eventBus.on('agent_state_changed', (event) => {
      const { agentId, newState } = event.data;
      this.updateAgentTexture(agentId, newState);
    });

    eventBus.on('agent_hired', (event) => {
      this.createAgentSprite(event.data.agent);
    });

    eventBus.on('agent_fired', (event) => {
      const sprite = this.agentSprites.get(event.data.agentId);
      if (sprite) {
        sprite.destroy();
        this.agentSprites.delete(event.data.agentId);
      }
      if (this.selectedAgentId === event.data.agentId) {
        this.deselectAgent();
      }
    });

    eventBus.on('task_assigned', (event) => {
      const { agentId } = event.data;
      const container = this.agentSprites.get(agentId);
      if (container && !container.taskIndicator) {
        container.taskIndicator = this.add.sprite(14, -28, 'task_indicator');
        container.add(container.taskIndicator);
      }
    });

    eventBus.on('task_completed', (event) => {
      const task = event.data.task;
      if (task.assignedAgentId) {
        const container = this.agentSprites.get(task.assignedAgentId);
        if (container?.taskIndicator) {
          container.taskIndicator.destroy();
          container.taskIndicator = null;
        }
      }
    });

    eventBus.on('task_failed', (event) => {
      const task = event.data.task;
      if (task.assignedAgentId) {
        const container = this.agentSprites.get(task.assignedAgentId);
        if (container?.taskIndicator) {
          container.taskIndicator.destroy();
          container.taskIndicator = null;
        }
      }
    });
  }

  private setupInput(): void {
    this.input.on('pointerdown', () => {
      // Clicking empty space deselects
      this.deselectAgent();
    });

    this.input.keyboard?.on('keydown-ESC', () => {
      this.deselectAgent();
    });
  }

  selectAgent(agentId: string): void {
    this.selectedAgentId = agentId;
    const sprite = this.agentSprites.get(agentId);

    if (sprite && this.selectionRing) {
      this.selectionRing.setPosition(sprite.x, sprite.y + 8);
      this.selectionRing.setVisible(true);
    }

    this.events.emit('agent_selected', agentId);
  }

  deselectAgent(): void {
    this.selectedAgentId = null;
    if (this.selectionRing) {
      this.selectionRing.setVisible(false);
    }
    this.events.emit('agent_deselected');
  }

  private updateAgentTexture(agentId: string, state: AgentState): void {
    const container = this.agentSprites.get(agentId);
    if (!container) return;

    let suffix = '';
    if (state === 'working') suffix = '_working';
    else if (state === 'thinking') suffix = '_thinking';

    container.sprite.setTexture(`agent_${container.colorIndex}${suffix}`);
  }

  private wanderAgents(): void {
    this.agentSprites.forEach((container, agentId) => {
      const agent = this.agentManager.getAgent(agentId);
      if (!agent) return;

      // Don't move if busy or already moving
      if (agent.state === 'working' || agent.state === 'thinking' || container.isMoving) {
        return;
      }

      // Random chance to move (50%)
      if (Math.random() > 0.5) return;

      const newPos = getNearbyPosition(container.gridX, container.gridY, 2);
      this.moveAgentTo(agentId, newPos.x, newPos.y);
    });
  }

  private moveAgentTo(agentId: string, newX: number, newY: number): void {
    const container = this.agentSprites.get(agentId);
    if (!container || container.isMoving) return;

    container.isMoving = true;
    this.agentManager.updateAgentState(agentId, 'walking');

    const { x: targetX, y: targetY } = gridToScreen(newX, newY);
    const distance = Math.abs(newX - container.gridX) + Math.abs(newY - container.gridY);
    const duration = 800 + distance * 200;

    this.tweens.add({
      targets: container,
      x: targetX,
      y: targetY - 16,
      duration,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        // Update depth during movement
        const currentDepth = container.y * 0.1 + 100;
        container.setDepth(currentDepth);
      },
      onComplete: () => {
        container.gridX = newX;
        container.gridY = newY;
        container.isMoving = false;
        container.setDepth(newY * GRID_WIDTH + newX + 100);

        this.agentManager.updateAgentPosition(agentId, newX, newY);
        this.agentManager.updateAgentState(agentId, 'idle');

        // Update selection ring
        if (this.selectedAgentId === agentId && this.selectionRing) {
          this.selectionRing.setPosition(container.x, container.y + 8);
        }
      },
    });

    // Add slight bounce/bob animation
    this.tweens.add({
      targets: container.sprite,
      y: { from: 0, to: -3 },
      duration: 150,
      yoyo: true,
      repeat: Math.floor(duration / 300),
      ease: 'Sine.easeInOut',
    });
  }

  private updateAnimations(): void {
    this.agentSprites.forEach((container, agentId) => {
      const agent = this.agentManager.getAgent(agentId);
      if (!agent || container.isMoving) return;

      // Idle bobbing
      if (agent.state === 'idle') {
        const bob = Math.sin(this.time.now / 800 + container.gridX) * 1.5;
        container.sprite.setY(bob);
      }

      // Working pulse
      if (agent.state === 'working') {
        const pulse = 1 + Math.sin(this.time.now / 200) * 0.03;
        container.sprite.setScale(pulse);
      }

      // Thinking sway
      if (agent.state === 'thinking') {
        const sway = Math.sin(this.time.now / 400) * 2;
        container.sprite.setX(sway);
      }
    });

    // Update selection ring position
    if (this.selectedAgentId && this.selectionRing?.visible) {
      const container = this.agentSprites.get(this.selectedAgentId);
      if (container) {
        this.selectionRing.setPosition(container.x, container.y + 8);
      }
    }
  }

  update(): void {
    // Update loop
  }
}
