import './style.css';
import { GameScene } from './game/GameScene';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('App container not found');
}

app.innerHTML = `
  <div id="game-container" style="width: 100vw; height: 100vh; position: fixed; top: 0; left: 0;"></div>
`;

const gameContainer = document.querySelector<HTMLDivElement>('#game-container');
if (!gameContainer) {
  throw new Error('Game container not found');
}

const game = new GameScene(gameContainer);

// 点击画布重新锁定鼠标
gameContainer.addEventListener('click', () => {
  if (!document.pointerLockElement) {
    document.body.requestPointerLock();
  }
});

// 启动游戏（显示主菜单，等待玩家点击"开始游戏"）
game.init().catch(console.error);
