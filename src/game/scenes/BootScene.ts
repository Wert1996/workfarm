import Phaser from 'phaser';
import { TILE_WIDTH, TILE_HEIGHT, COLORS } from '../config';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    // Loading bar
    const width = Number(this.game.config.width);
    const height = Number(this.game.config.height);

    const progressBar = this.add.graphics();
    const progressBox = this.add.graphics();
    progressBox.fillStyle(0x222222, 0.8);
    progressBox.fillRoundedRect(width / 2 - 160, height / 2 - 25, 320, 50, 10);

    const loadingText = this.add.text(width / 2, height / 2 - 50, 'Loading...', {
      fontSize: '20px',
      color: '#ffeaa7',
      fontFamily: 'Georgia, serif',
    });
    loadingText.setOrigin(0.5, 0.5);

    this.load.on('progress', (value: number) => {
      progressBar.clear();
      progressBar.fillStyle(COLORS.uiPrimary, 1);
      progressBar.fillRoundedRect(width / 2 - 150, height / 2 - 15, 300 * value, 30, 8);
    });

    this.load.on('complete', () => {
      progressBar.destroy();
      progressBox.destroy();
      loadingText.destroy();
    });
  }

  create(): void {
    this.generateFloorTiles();
    this.generateFurniture();
    this.generateAgentTextures();
    this.generateUITextures();
    this.generateDecorations();

    this.scene.start('MainScene');
  }

  private generateFloorTiles(): void {
    // Main wooden floor tile with grain pattern
    const g = this.make.graphics({ x: 0, y: 0 });

    // Base color
    g.fillStyle(COLORS.floorLight, 1);
    g.beginPath();
    g.moveTo(TILE_WIDTH / 2, 0);
    g.lineTo(TILE_WIDTH, TILE_HEIGHT / 2);
    g.lineTo(TILE_WIDTH / 2, TILE_HEIGHT);
    g.lineTo(0, TILE_HEIGHT / 2);
    g.closePath();
    g.fillPath();

    // Wood grain lines
    g.lineStyle(1, COLORS.floorDark, 0.3);
    for (let i = 0; i < 5; i++) {
      const offset = i * 6;
      g.beginPath();
      g.moveTo(TILE_WIDTH / 2 - 20 + offset, 4 + offset / 2);
      g.lineTo(TILE_WIDTH / 2 + 20 - offset, 4 + offset / 2);
      g.strokePath();
    }

    // Highlight edge (top-left)
    g.lineStyle(2, COLORS.floorHighlight, 0.5);
    g.beginPath();
    g.moveTo(TILE_WIDTH / 2, 1);
    g.lineTo(1, TILE_HEIGHT / 2);
    g.strokePath();

    // Shadow edge (bottom-right)
    g.lineStyle(2, COLORS.floorDark, 0.4);
    g.beginPath();
    g.moveTo(TILE_WIDTH - 1, TILE_HEIGHT / 2);
    g.lineTo(TILE_WIDTH / 2, TILE_HEIGHT - 1);
    g.strokePath();

    g.generateTexture('tile_floor', TILE_WIDTH, TILE_HEIGHT);
    g.destroy();

    // Alternate floor tile for checkerboard effect
    const g2 = this.make.graphics({ x: 0, y: 0 });
    g2.fillStyle(COLORS.floorDark, 1);
    g2.beginPath();
    g2.moveTo(TILE_WIDTH / 2, 0);
    g2.lineTo(TILE_WIDTH, TILE_HEIGHT / 2);
    g2.lineTo(TILE_WIDTH / 2, TILE_HEIGHT);
    g2.lineTo(0, TILE_HEIGHT / 2);
    g2.closePath();
    g2.fillPath();

    g2.lineStyle(2, COLORS.floorLight, 0.3);
    g2.beginPath();
    g2.moveTo(TILE_WIDTH / 2, 1);
    g2.lineTo(1, TILE_HEIGHT / 2);
    g2.strokePath();

    g2.generateTexture('tile_floor_alt', TILE_WIDTH, TILE_HEIGHT);
    g2.destroy();

    // Rug center tile - rich woven look
    const gRug = this.make.graphics({ x: 0, y: 0 });
    // Base fill
    gRug.fillStyle(COLORS.rug, 1);
    gRug.beginPath();
    gRug.moveTo(TILE_WIDTH / 2, 0);
    gRug.lineTo(TILE_WIDTH, TILE_HEIGHT / 2);
    gRug.lineTo(TILE_WIDTH / 2, TILE_HEIGHT);
    gRug.lineTo(0, TILE_HEIGHT / 2);
    gRug.closePath();
    gRug.fillPath();

    // Woven cross-hatch pattern
    gRug.lineStyle(1, COLORS.rugPattern, 0.35);
    for (let i = -3; i <= 3; i++) {
      gRug.beginPath();
      gRug.moveTo(TILE_WIDTH / 2 + i * 8 - 12, TILE_HEIGHT / 2 - 8);
      gRug.lineTo(TILE_WIDTH / 2 + i * 8 + 12, TILE_HEIGHT / 2 + 8);
      gRug.strokePath();
      gRug.beginPath();
      gRug.moveTo(TILE_WIDTH / 2 + i * 8 - 12, TILE_HEIGHT / 2 + 8);
      gRug.lineTo(TILE_WIDTH / 2 + i * 8 + 12, TILE_HEIGHT / 2 - 8);
      gRug.strokePath();
    }

    // Small diamond motif in center
    gRug.fillStyle(COLORS.rugPattern, 0.5);
    gRug.beginPath();
    gRug.moveTo(TILE_WIDTH / 2, TILE_HEIGHT / 2 - 4);
    gRug.lineTo(TILE_WIDTH / 2 + 5, TILE_HEIGHT / 2);
    gRug.lineTo(TILE_WIDTH / 2, TILE_HEIGHT / 2 + 4);
    gRug.lineTo(TILE_WIDTH / 2 - 5, TILE_HEIGHT / 2);
    gRug.closePath();
    gRug.fillPath();

    gRug.generateTexture('tile_rug', TILE_WIDTH, TILE_HEIGHT);
    gRug.destroy();

    // Rug border tile - has a decorative border stripe
    const gRugB = this.make.graphics({ x: 0, y: 0 });
    gRugB.fillStyle(COLORS.rug, 1);
    gRugB.beginPath();
    gRugB.moveTo(TILE_WIDTH / 2, 0);
    gRugB.lineTo(TILE_WIDTH, TILE_HEIGHT / 2);
    gRugB.lineTo(TILE_WIDTH / 2, TILE_HEIGHT);
    gRugB.lineTo(0, TILE_HEIGHT / 2);
    gRugB.closePath();
    gRugB.fillPath();

    // Inner border stripe (gold outline inset)
    gRugB.lineStyle(2, COLORS.rugPattern, 0.7);
    gRugB.beginPath();
    gRugB.moveTo(TILE_WIDTH / 2, 3);
    gRugB.lineTo(TILE_WIDTH - 3, TILE_HEIGHT / 2);
    gRugB.lineTo(TILE_WIDTH / 2, TILE_HEIGHT - 3);
    gRugB.lineTo(3, TILE_HEIGHT / 2);
    gRugB.closePath();
    gRugB.strokePath();

    // Outer dark border
    gRugB.lineStyle(2, COLORS.rugBorder, 0.8);
    gRugB.beginPath();
    gRugB.moveTo(TILE_WIDTH / 2, 0);
    gRugB.lineTo(TILE_WIDTH, TILE_HEIGHT / 2);
    gRugB.lineTo(TILE_WIDTH / 2, TILE_HEIGHT);
    gRugB.lineTo(0, TILE_HEIGHT / 2);
    gRugB.closePath();
    gRugB.strokePath();

    gRugB.generateTexture('tile_rug_border', TILE_WIDTH, TILE_HEIGHT);
    gRugB.destroy();
  }

  private generateFurniture(): void {
    // Desk (isometric box)
    const desk = this.make.graphics({ x: 0, y: 0 });
    const deskHeight = 20;

    // Top surface
    desk.fillStyle(COLORS.deskTop, 1);
    desk.beginPath();
    desk.moveTo(32, 0);
    desk.lineTo(64, 16);
    desk.lineTo(32, 32);
    desk.lineTo(0, 16);
    desk.closePath();
    desk.fillPath();

    // Front face
    desk.fillStyle(COLORS.desk, 1);
    desk.beginPath();
    desk.moveTo(0, 16);
    desk.lineTo(32, 32);
    desk.lineTo(32, 32 + deskHeight);
    desk.lineTo(0, 16 + deskHeight);
    desk.closePath();
    desk.fillPath();

    // Right face
    desk.fillStyle(0x7a3d12, 1);
    desk.beginPath();
    desk.moveTo(32, 32);
    desk.lineTo(64, 16);
    desk.lineTo(64, 16 + deskHeight);
    desk.lineTo(32, 32 + deskHeight);
    desk.closePath();
    desk.fillPath();

    desk.generateTexture('furniture_desk', 64, 52);
    desk.destroy();

    // Plant pot with plant
    const plant = this.make.graphics({ x: 0, y: 0 });

    // Pot
    plant.fillStyle(COLORS.plantPot, 1);
    plant.fillRoundedRect(8, 24, 16, 16, 2);
    plant.fillStyle(0xb8723d, 1);
    plant.fillRect(6, 22, 20, 4);

    // Leaves (simple circles/ellipses)
    plant.fillStyle(COLORS.plant, 1);
    plant.fillCircle(16, 14, 8);
    plant.fillCircle(10, 18, 6);
    plant.fillCircle(22, 18, 6);
    plant.fillCircle(16, 8, 5);

    // Darker leaves for depth
    plant.fillStyle(0x1a6b1a, 1);
    plant.fillCircle(14, 16, 4);
    plant.fillCircle(18, 12, 3);

    plant.generateTexture('furniture_plant', 32, 40);
    plant.destroy();

    // Chair (simple)
    const chair = this.make.graphics({ x: 0, y: 0 });
    chair.fillStyle(COLORS.chair, 1);

    // Seat
    chair.beginPath();
    chair.moveTo(16, 8);
    chair.lineTo(32, 16);
    chair.lineTo(16, 24);
    chair.lineTo(0, 16);
    chair.closePath();
    chair.fillPath();

    // Back
    chair.fillStyle(0x3a3a3a, 1);
    chair.fillRect(0, 4, 4, 14);

    // Legs
    chair.fillStyle(0x2a2a2a, 1);
    chair.fillRect(2, 22, 2, 10);
    chair.fillRect(28, 22, 2, 10);

    chair.generateTexture('furniture_chair', 32, 32);
    chair.destroy();
  }

  private generateAgentTextures(): void {
    // Generate agent sprites - cute little characters
    COLORS.agentColors.forEach((color, index) => {
      this.generateAgent(`agent_${index}`, color);
    });
  }

  private generateAgent(key: string, color: number): void {
    const g = this.make.graphics({ x: 0, y: 0 });
    const size = 32;

    // Shadow
    g.fillStyle(0x000000, 0.3);
    g.fillEllipse(size / 2, size - 4, 20, 8);

    // Body (rounded rectangle / pill shape)
    g.fillStyle(color, 1);
    g.fillRoundedRect(8, 8, 16, 18, 6);

    // Head highlight
    g.fillStyle(0xffffff, 0.3);
    g.fillCircle(14, 12, 4);

    // Eyes
    g.fillStyle(0xffffff, 1);
    g.fillCircle(12, 14, 3);
    g.fillCircle(20, 14, 3);

    // Pupils
    g.fillStyle(0x2d3436, 1);
    g.fillCircle(13, 14, 1.5);
    g.fillCircle(21, 14, 1.5);

    // Cute smile
    g.lineStyle(1.5, 0x2d3436, 1);
    g.beginPath();
    g.arc(16, 18, 3, 0.2, Math.PI - 0.2, false);
    g.strokePath();

    g.generateTexture(key, size, size);
    g.destroy();

    // Working state (with sparkles)
    const gWork = this.make.graphics({ x: 0, y: 0 });

    gWork.fillStyle(0x000000, 0.3);
    gWork.fillEllipse(size / 2, size - 4, 20, 8);

    gWork.fillStyle(color, 1);
    gWork.fillRoundedRect(8, 8, 16, 18, 6);

    gWork.fillStyle(0xffffff, 0.3);
    gWork.fillCircle(14, 12, 4);

    // Focused eyes (smaller)
    gWork.fillStyle(0xffffff, 1);
    gWork.fillCircle(12, 14, 2.5);
    gWork.fillCircle(20, 14, 2.5);

    gWork.fillStyle(0x2d3436, 1);
    gWork.fillCircle(12, 14, 1.5);
    gWork.fillCircle(20, 14, 1.5);

    // Determined expression
    gWork.lineStyle(1.5, 0x2d3436, 1);
    gWork.lineBetween(14, 18, 18, 18);

    // Sparkle (4-point star drawn manually)
    gWork.fillStyle(0xffeaa7, 1);
    // Vertical diamond
    gWork.fillTriangle(26, 2, 24, 6, 28, 6);
    gWork.fillTriangle(26, 10, 24, 6, 28, 6);
    // Horizontal diamond
    gWork.fillTriangle(22, 6, 26, 4, 26, 8);
    gWork.fillTriangle(30, 6, 26, 4, 26, 8);

    gWork.generateTexture(`${key}_working`, size, size);
    gWork.destroy();

    // Thinking state (with thought bubble)
    const gThink = this.make.graphics({ x: 0, y: 0 });

    gThink.fillStyle(0x000000, 0.3);
    gThink.fillEllipse(size / 2, size - 4, 20, 8);

    gThink.fillStyle(color, 1);
    gThink.fillRoundedRect(8, 8, 16, 18, 6);

    gThink.fillStyle(0xffffff, 0.3);
    gThink.fillCircle(14, 12, 4);

    // Looking up eyes
    gThink.fillStyle(0xffffff, 1);
    gThink.fillCircle(12, 13, 3);
    gThink.fillCircle(20, 13, 3);

    gThink.fillStyle(0x2d3436, 1);
    gThink.fillCircle(12, 12, 1.5);
    gThink.fillCircle(20, 12, 1.5);

    // Thinking mouth
    gThink.lineStyle(1.5, 0x2d3436, 1);
    gThink.fillCircle(16, 19, 1);

    // Thought bubbles
    gThink.fillStyle(0xffffff, 0.8);
    gThink.fillCircle(26, 10, 2);
    gThink.fillCircle(28, 5, 3);
    gThink.fillCircle(30, 0, 4);

    gThink.generateTexture(`${key}_thinking`, size, size);
    gThink.destroy();
  }

  private generateUITextures(): void {
    // Panel background
    const panel = this.make.graphics({ x: 0, y: 0 });
    panel.fillStyle(COLORS.uiPanel, 0.98);
    panel.fillRoundedRect(0, 0, 320, 400, 12);
    panel.lineStyle(2, COLORS.uiPrimary, 0.6);
    panel.strokeRoundedRect(1, 1, 318, 398, 12);
    panel.generateTexture('panel_bg', 320, 400);
    panel.destroy();

    // Button
    const btn = this.make.graphics({ x: 0, y: 0 });
    btn.fillStyle(COLORS.uiPrimary, 1);
    btn.fillRoundedRect(0, 0, 140, 40, 8);
    // Highlight
    btn.fillStyle(0xffffff, 0.1);
    btn.fillRoundedRect(2, 2, 136, 18, 6);
    btn.generateTexture('button', 140, 40);
    btn.destroy();

    // Button hover
    const btnHover = this.make.graphics({ x: 0, y: 0 });
    btnHover.fillStyle(COLORS.uiSecondary, 1);
    btnHover.fillRoundedRect(0, 0, 140, 40, 8);
    btnHover.fillStyle(0xffffff, 0.15);
    btnHover.fillRoundedRect(2, 2, 136, 18, 6);
    btnHover.generateTexture('button_hover', 140, 40);
    btnHover.destroy();

    // Selection ring
    const ring = this.make.graphics({ x: 0, y: 0 });
    ring.lineStyle(3, 0xffeaa7, 0.9);
    ring.strokeCircle(20, 20, 18);
    ring.generateTexture('selection_ring', 40, 40);
    ring.destroy();

    // Task indicator
    const taskInd = this.make.graphics({ x: 0, y: 0 });
    taskInd.fillStyle(COLORS.uiAccent, 1);
    taskInd.fillCircle(8, 8, 8);
    taskInd.fillStyle(0xffffff, 1);
    taskInd.fillRect(6, 4, 4, 5);
    taskInd.fillRect(6, 10, 4, 2);
    taskInd.generateTexture('task_indicator', 16, 16);
    taskInd.destroy();
  }

  private generateDecorations(): void {
    // Window with light coming through
    const window = this.make.graphics({ x: 0, y: 0 });

    // Frame
    window.fillStyle(0x5a4a3a, 1);
    window.fillRect(0, 0, 48, 64);

    // Glass (light blue gradient effect)
    window.fillStyle(0x87ceeb, 0.8);
    window.fillRect(4, 4, 40, 56);

    // Cross bars
    window.fillStyle(0x5a4a3a, 1);
    window.fillRect(22, 4, 4, 56);
    window.fillRect(4, 28, 40, 4);

    // Light reflection
    window.fillStyle(0xffffff, 0.3);
    window.fillRect(6, 6, 14, 20);

    window.generateTexture('deco_window', 48, 64);
    window.destroy();

    // Bookshelf
    const shelf = this.make.graphics({ x: 0, y: 0 });

    // Back
    shelf.fillStyle(0x6b4423, 1);
    shelf.fillRect(0, 0, 48, 56);

    // Shelves
    shelf.fillStyle(0x8b5a2b, 1);
    shelf.fillRect(0, 16, 48, 4);
    shelf.fillRect(0, 36, 48, 4);

    // Books (colorful)
    const bookColors = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf39c12, 0x9b59b6];
    bookColors.forEach((c, i) => {
      shelf.fillStyle(c, 1);
      shelf.fillRect(4 + i * 8, 4, 6, 12);
      shelf.fillRect(4 + i * 8, 24, 6, 12);
    });

    shelf.generateTexture('deco_bookshelf', 48, 56);
    shelf.destroy();

    // Lamp
    const lamp = this.make.graphics({ x: 0, y: 0 });

    // Base
    lamp.fillStyle(0x4a4a4a, 1);
    lamp.fillEllipse(16, 36, 12, 4);

    // Pole
    lamp.fillStyle(0x3a3a3a, 1);
    lamp.fillRect(14, 10, 4, 26);

    // Shade
    lamp.fillStyle(0xffeaa7, 1);
    lamp.beginPath();
    lamp.moveTo(16, 0);
    lamp.lineTo(28, 14);
    lamp.lineTo(4, 14);
    lamp.closePath();
    lamp.fillPath();

    // Light glow
    lamp.fillStyle(0xffeaa7, 0.3);
    lamp.fillCircle(16, 10, 16);

    lamp.generateTexture('deco_lamp', 32, 40);
    lamp.destroy();
  }
}
