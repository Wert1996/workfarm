// Portable agent constants extracted from game/config.ts
// so the control layer doesn't transitively depend on Phaser.

export const AGENT_COLORS = [
  0xff6b6b,  // Coral red
  0x4ecdc4,  // Teal
  0xffe66d,  // Yellow
  0x95e1d3,  // Mint
  0xf38181,  // Salmon
  0xaa96da,  // Lavender
  0xfcbad3,  // Pink
  0xa8d8ea,  // Sky blue
];

const GRID_WIDTH = 16;
const GRID_HEIGHT = 16;

export function getRandomPosition(): { x: number; y: number } {
  const margin = 2;
  const x = margin + Math.floor(Math.random() * (GRID_WIDTH - margin * 2));
  const y = margin + Math.floor(Math.random() * (GRID_HEIGHT - margin * 2));
  return { x, y };
}
