import Phaser from 'phaser';

// Isometric tile dimensions
export const TILE_WIDTH = 64;
export const TILE_HEIGHT = 32;

// Grid dimensions - single workspace
export const GRID_WIDTH = 16;
export const GRID_HEIGHT = 16;

// Warm, inviting color palette
export const COLORS = {
  // Floor
  floorLight: 0xdeb887,    // Burlywood - warm wood
  floorDark: 0xcd9a5e,     // Darker wood accent
  floorHighlight: 0xf5deb3, // Wheat - highlight

  // Walls/edges
  wallFront: 0x8b7355,
  wallSide: 0x6b5344,

  // Furniture
  desk: 0x8b4513,          // Saddle brown
  deskTop: 0xa0522d,       // Sienna
  plant: 0x228b22,         // Forest green
  plantPot: 0xcd853f,      // Peru
  chair: 0x4a4a4a,

  // Decorative
  rug: 0x8b2232,           // Deep crimson
  rugPattern: 0xc8a84e,    // Gold accent
  rugBorder: 0x6b1a28,     // Dark crimson border

  // Agents - vibrant colors
  agentColors: [
    0xff6b6b,  // Coral red
    0x4ecdc4,  // Teal
    0xffe66d,  // Yellow
    0x95e1d3,  // Mint
    0xf38181,  // Salmon
    0xaa96da,  // Lavender
    0xfcbad3,  // Pink
    0xa8d8ea,  // Sky blue
  ],

  // UI
  uiPrimary: 0x6c5ce7,
  uiSecondary: 0xa29bfe,
  uiBackground: 0x2d3436,
  uiPanel: 0x363940,
  uiText: 0xffeaa7,
  uiAccent: 0x00b894,
};

// Phaser game configuration
export const GAME_CONFIG: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: 1280,
  height: 800,
  backgroundColor: '#2d3436',
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [],
};

// Convert grid coordinates to screen coordinates (isometric)
export function gridToScreen(gridX: number, gridY: number): { x: number; y: number } {
  const offsetX = 640;
  const offsetY = 150;

  const screenX = offsetX + (gridX - gridY) * (TILE_WIDTH / 2);
  const screenY = offsetY + (gridX + gridY) * (TILE_HEIGHT / 2);

  return { x: screenX, y: screenY };
}

// Convert screen coordinates to grid coordinates
export function screenToGrid(screenX: number, screenY: number): { x: number; y: number } {
  const offsetX = 640;
  const offsetY = 150;

  const relX = screenX - offsetX;
  const relY = screenY - offsetY;

  const gridX = Math.floor((relX / (TILE_WIDTH / 2) + relY / (TILE_HEIGHT / 2)) / 2);
  const gridY = Math.floor((relY / (TILE_HEIGHT / 2) - relX / (TILE_WIDTH / 2)) / 2);

  return { x: gridX, y: gridY };
}

// Get random walkable position in the workspace
export function getRandomPosition(): { x: number; y: number } {
  // Keep agents away from edges
  const margin = 2;
  const x = margin + Math.floor(Math.random() * (GRID_WIDTH - margin * 2));
  const y = margin + Math.floor(Math.random() * (GRID_HEIGHT - margin * 2));
  return { x, y };
}

// Get a nearby random position for wandering
export function getNearbyPosition(currentX: number, currentY: number, maxDistance: number = 3): { x: number; y: number } {
  const margin = 1;
  let newX = currentX + Math.floor(Math.random() * (maxDistance * 2 + 1)) - maxDistance;
  let newY = currentY + Math.floor(Math.random() * (maxDistance * 2 + 1)) - maxDistance;

  // Clamp to valid area
  newX = Math.max(margin, Math.min(GRID_WIDTH - margin - 1, newX));
  newY = Math.max(margin, Math.min(GRID_HEIGHT - margin - 1, newY));

  return { x: newX, y: newY };
}
