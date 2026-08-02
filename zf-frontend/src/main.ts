import './style.css';
import { GameScene } from './game/GameScene';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('App container not found');
}

app.innerHTML = `
  <div id="game-container" style="width: 100vw; height: 100vh; position: fixed; top: 0; left: 0;"></div>
  <div id="ui-overlay" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 10;">
    <div id="crosshair" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 4px; height: 4px; background: rgba(255, 255, 255, 0.8); border-radius: 50%;"></div>
    <div id="instructions" style="position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); color: white; font-family: sans-serif; text-align: center; background: rgba(0,0,0,0.5); padding: 10px 20px; border-radius: 5px;">
      <p>WASD移动 | 空格跳跃 | Shift冲刺 | Ctrl蹲下 | 鼠标控制视角 | 点击锁定鼠标</p>
    </div>
  </div>
`;

const gameContainer = document.querySelector<HTMLDivElement>('#game-container');
if (!gameContainer) {
  throw new Error('Game container not found');
}

const game = new GameScene(gameContainer);

async function startGame() {
  await game.init();

  try {
    const playerId = 'player_' + Math.random().toString(36).substring(2, 8);
    await game.connectToServer('ws://localhost:8080', playerId);
    console.log('Connected to server as', playerId);
  } catch (error) {
    console.warn('Failed to connect to server, running in offline mode', error);
  }
}

startGame().catch(console.error);
