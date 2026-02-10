import Phaser from 'phaser';
import { GAME_CONFIG } from './game/config';
import { BootScene } from './game/scenes/BootScene';
import { MainScene } from './game/scenes/MainScene';
import { UIScene } from './game/scenes/UIScene';

// Add fadeOut animation for toasts
const style = document.createElement('style');
style.textContent = `
  @keyframes fadeOut {
    0% { opacity: 1; }
    70% { opacity: 1; }
    100% { opacity: 0; }
  }
`;
document.head.appendChild(style);

// Create game with scenes
const config: Phaser.Types.Core.GameConfig = {
  ...GAME_CONFIG,
  scene: [BootScene, MainScene, UIScene],
};

// Initialize game
const game = new Phaser.Game(config);

// Handle window resize
window.addEventListener('resize', () => {
  game.scale.resize(window.innerWidth, window.innerHeight);
});

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  game.destroy(true);
});

// Export for debugging
(window as any).game = game;
