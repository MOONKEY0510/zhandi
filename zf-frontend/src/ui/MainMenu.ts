import * as THREE from 'three';

export class MainMenu {
  container: HTMLElement;
  elements: {
    title: HTMLElement | null;
    playButton: HTMLElement | null;
    settingsButton: HTMLElement | null;
    quitButton: HTMLElement | null;
    version: HTMLElement | null;
  } = {
    title: null,
    playButton: null,
    settingsButton: null,
    quitButton: null,
    version: null,
  };

  onPlay: (() => void) | null = null;
  onSettings: (() => void) | null = null;
  onQuit: (() => void) | null = null;

  constructor() {
    this.container = this.createMainMenu();
  }

  private createMainMenu(): HTMLElement {
    const container = document.createElement('div');
    container.id = 'main-menu';
    container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(135deg, rgba(20, 20, 30, 0.95), rgba(40, 40, 60, 0.95));
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      font-family: 'Arial', sans-serif;
      color: white;
    `;

    container.innerHTML = `
      <h1 id="title" style="font-size: 72px; margin-bottom: 10px; text-shadow: 0 0 20px rgba(255, 204, 0, 0.5);">ZHANDI</h1>
      <p style="font-size: 18px; color: rgba(255, 255, 255, 0.7); margin-bottom: 60px;">Tactical FPS</p>

      <div style="display: flex; flex-direction: column; gap: 15px; width: 300px;">
        <button id="play-button" style="
          padding: 15px 40px;
          font-size: 20px;
          background: linear-gradient(135deg, #ffcc00, #ff9900);
          border: none;
          border-radius: 5px;
          color: #1a1a1a;
          font-weight: bold;
          cursor: pointer;
          transition: all 0.3s;
        ">开始游戏</button>

        <button id="settings-button" style="
          padding: 15px 40px;
          font-size: 18px;
          background: transparent;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-radius: 5px;
          color: white;
          cursor: pointer;
          transition: all 0.3s;
        ">设置</button>

        <button id="quit-button" style="
          padding: 15px 40px;
          font-size: 18px;
          background: transparent;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-radius: 5px;
          color: white;
          cursor: pointer;
          transition: all 0.3s;
        ">退出</button>
      </div>

      <p id="version" style="position: absolute; bottom: 20px; font-size: 14px; color: rgba(255, 255, 255, 0.5);">v1.0.0</p>
    `;

    document.body.appendChild(container);

    this.elements.title = container.querySelector('#title');
    this.elements.playButton = container.querySelector('#play-button');
    this.elements.settingsButton = container.querySelector('#settings-button');
    this.elements.quitButton = container.querySelector('#quit-button');
    this.elements.version = container.querySelector('#version');

    this.setupEventListeners();

    return container;
  }

  private setupEventListeners(): void {
    if (this.elements.playButton) {
      this.elements.playButton.addEventListener('click', () => {
        this.onPlay?.();
      });
    }

    if (this.elements.settingsButton) {
      this.elements.settingsButton.addEventListener('click', () => {
        this.onSettings?.();
      });
    }

    if (this.elements.quitButton) {
      this.elements.quitButton.addEventListener('click', () => {
        this.onQuit?.();
      });
    }
  }

  show(): void {
    this.container.style.display = 'flex';
  }

  hide(): void {
    this.container.style.display = 'none';
  }

  dispose(): void {
    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}
