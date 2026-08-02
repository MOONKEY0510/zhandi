export interface HUDData {
  health: number;
  maxHealth: number;
  ammo: number;
  reserveAmmo: number;
  weaponName: string;
  killCount: number;
  deathCount: number;
  isReloading: boolean;
  reloadProgress: number;
  hitMarker: boolean;
  hitMarkerTime: number;
  damageIndicator: { x: number; y: number } | null;
  score: number;
  position: { x: number; y: number; z: number };
}

export class HUD {
  container: HTMLElement;
  elements: {
    healthBar: HTMLElement | null;
    healthText: HTMLElement | null;
    ammoText: HTMLElement | null;
    weaponName: HTMLElement | null;
    crosshair: HTMLElement | null;
    hitMarker: HTMLElement | null;
    killFeed: HTMLElement | null;
    scoreText: HTMLElement | null;
    minimap: HTMLElement | null;
    reloadBar: HTMLElement | null;
    damageVignette: HTMLElement | null;
  } = {
    healthBar: null,
    healthText: null,
    ammoText: null,
    weaponName: null,
    crosshair: null,
    hitMarker: null,
    killFeed: null,
    scoreText: null,
    minimap: null,
    reloadBar: null,
    damageVignette: null,
  };

  killMessages: { text: string; time: number }[] = [];

  constructor() {
    this.container = this.createHUD();
  }

  private createHUD(): HTMLElement {
    const container = document.createElement('div');
    container.id = 'hud';
    container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 100;
      font-family: 'Arial', sans-serif;
      color: white;
    `;

    container.innerHTML = `
      <div id="crosshair" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);">
        <div style="position: relative; width: 24px; height: 24px;">
          <div style="position: absolute; top: 50%; left: 0; width: 8px; height: 2px; background: rgba(255,255,255,0.9); transform: translateY(-50%);"></div>
          <div style="position: absolute; top: 50%; right: 0; width: 8px; height: 2px; background: rgba(255,255,255,0.9); transform: translateY(-50%);"></div>
          <div style="position: absolute; left: 50%; top: 0; width: 2px; height: 8px; background: rgba(255,255,255,0.9); transform: translateX(-50%);"></div>
          <div style="position: absolute; left: 50%; bottom: 0; width: 2px; height: 8px; background: rgba(255,255,255,0.9); transform: translateX(-50%);"></div>
          <div id="hitmarker" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); opacity: 0; transition: opacity 0.1s;">
            <svg width="20" height="20" viewBox="0 0 20 20">
              <line x1="2" y1="2" x2="6" y2="6" stroke="white" stroke-width="2"/>
              <line x1="18" y1="2" x2="14" y2="6" stroke="white" stroke-width="2"/>
              <line x1="2" y1="18" x2="6" y2="14" stroke="white" stroke-width="2"/>
              <line x1="18" y1="18" x2="14" y2="14" stroke="white" stroke-width="2"/>
            </svg>
          </div>
        </div>
      </div>

      <div id="health-container" style="position: absolute; bottom: 40px; left: 40px; display: flex; align-items: center; gap: 15px;">
        <div id="health-icon" style="width: 40px; height: 40px; background: #cc0000; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px;">+</div>
        <div id="health-bar-bg" style="width: 200px; height: 20px; background: rgba(0,0,0,0.5); border: 2px solid rgba(255,255,255,0.3); border-radius: 3px; overflow: hidden; position: relative;">
          <div id="health-bar" style="height: 100%; background: linear-gradient(to right, #cc0000, #ff3333); width: 100%; transition: width 0.3s;"></div>
          <div id="health-segments" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; pointer-events: none;">
            <div style="flex: 1; border-right: 1px solid rgba(0,0,0,0.4);"></div>
            <div style="flex: 1; border-right: 1px solid rgba(0,0,0,0.4);"></div>
            <div style="flex: 1; border-right: 1px solid rgba(0,0,0,0.4);"></div>
            <div style="flex: 1;"></div>
          </div>
        </div>
        <div id="health-text" style="font-size: 28px; font-weight: bold; min-width: 60px; text-shadow: 2px 2px 4px rgba(0,0,0,0.8);">100</div>
      </div>

      <div id="ammo-container" style="position: absolute; bottom: 40px; right: 40px; text-align: right;">
        <div id="weapon-name" style="font-size: 16px; color: rgba(255,255,255,0.7); margin-bottom: 5px;">STG44</div>
        <div style="display: flex; align-items: baseline; justify-content: flex-end; gap: 8px;">
          <div id="ammo-text" style="font-size: 42px; font-weight: bold; text-shadow: 2px 2px 4px rgba(0,0,0,0.8);">30 / 120</div>
        </div>
        <div id="reload-bar" style="width: 150px; height: 4px; background: rgba(0,0,0,0.5); margin-top: 5px; margin-left: auto; opacity: 0;">
          <div id="reload-progress" style="height: 100%; background: #ffcc00; width: 0%; transition: width 0.05s;"></div>
        </div>
      </div>

      <div id="score-container" style="position: absolute; top: 20px; right: 20px; background: rgba(0,0,0,0.4); padding: 10px 15px; border-radius: 5px;">
        <div id="score-text" style="font-size: 18px;">K: 0 / D: 0</div>
      </div>

      <div id="kill-feed" style="position: absolute; top: 80px; right: 20px; min-width: 200px;"></div>

      <div id="minimap" style="position: absolute; top: 20px; left: 20px; width: 180px; height: 180px; background: rgba(0,0,0,0.5); border: 2px solid rgba(255,255,255,0.3); border-radius: 5px; overflow: hidden;">
        <canvas id="minimap-canvas" width="180" height="180" style="display: block;"></canvas>
      </div>

      <div id="damage-vignette" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; opacity: 0; background: radial-gradient(circle, transparent 50%, rgba(255,0,0,0.6) 100%); transition: opacity 0.3s;"></div>
    `;

    document.body.appendChild(container);

    this.elements.healthBar = container.querySelector('#health-bar');
    this.elements.healthText = container.querySelector('#health-text');
    this.elements.ammoText = container.querySelector('#ammo-text');
    this.elements.weaponName = container.querySelector('#weapon-name');
    this.elements.crosshair = container.querySelector('#crosshair');
    this.elements.hitMarker = container.querySelector('#hitmarker');
    this.elements.killFeed = container.querySelector('#kill-feed');
    this.elements.scoreText = container.querySelector('#score-text');
    this.elements.minimap = container.querySelector('#minimap-canvas');
    this.elements.reloadBar = container.querySelector('#reload-bar');
    this.elements.reloadBar = container.querySelector('#reload-bar');
    const reloadProgress = container.querySelector('#reload-progress');
    if (reloadProgress) this.elements.reloadBar = container.parentElement;
    this.elements.damageVignette = container.querySelector('#damage-vignette');

    return container;
  }

  update(data: HUDData, currentTime: number): void {
    if (this.elements.healthBar) {
      (this.elements.healthBar as HTMLElement).style.width = `${(data.health / data.maxHealth) * 100}%`;
    }
    if (this.elements.healthText) {
      this.elements.healthText.textContent = Math.ceil(data.health).toString();
    }
    if (this.elements.ammoText) {
      this.elements.ammoText.textContent = `${data.ammo} / ${data.reserveAmmo}`;
    }
    if (this.elements.weaponName) {
      this.elements.weaponName.textContent = data.weaponName;
    }
    if (this.elements.scoreText) {
      this.elements.scoreText.textContent = `K: ${data.killCount} / D: ${data.deathCount}`;
    }

    const reloadBar = this.container.querySelector('#reload-bar') as HTMLElement;
    const reloadProgress = this.container.querySelector('#reload-progress') as HTMLElement;
    if (reloadBar && reloadProgress) {
      if (data.isReloading) {
        reloadBar.style.opacity = '1';
        reloadProgress.style.width = `${data.reloadProgress * 100}%`;
      } else {
        reloadBar.style.opacity = '0';
      }
    }

    if (this.elements.hitMarker) {
      if (data.hitMarker && currentTime - data.hitMarkerTime < 100) {
        (this.elements.hitMarker as HTMLElement).style.opacity = '1';
      } else {
        (this.elements.hitMarker as HTMLElement).style.opacity = '0';
      }
    }

    if (this.elements.damageVignette) {
      if (data.damageIndicator) {
        (this.elements.damageVignette as HTMLElement).style.opacity = '0.6';
        setTimeout(() => {
          if (this.elements.damageVignette) {
            (this.elements.damageVignette as HTMLElement).style.opacity = '0';
          }
        }, 300);
      }
    }

    this.updateMinimap(data.position);
    this.updateKillFeed(currentTime);
  }

  private updateMinimap(playerPos: { x: number; y: number; z: number }): void {
    const canvas = this.elements.minimap as HTMLCanvasElement | null;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'rgba(40, 50, 40, 0.8)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const scale = 2;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    ctx.fillStyle = '#ffcc00';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(canvas.width, centerY);
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, canvas.height);
    ctx.stroke();
  }

  addKillMessage(message: string, currentTime: number): void {
    this.killMessages.push({ text: message, time: currentTime });

    if (this.killMessages.length > 5) {
      this.killMessages.shift();
    }

    this.renderKillFeed();
  }

  private updateKillFeed(currentTime: number): void {
    this.killMessages = this.killMessages.filter(
      msg => currentTime - msg.time < 5000
    );
    this.renderKillFeed();
  }

  private renderKillFeed(): void {
    if (!this.elements.killFeed) return;

    this.elements.killFeed.innerHTML = '';
    for (const msg of this.killMessages) {
      const div = document.createElement('div');
      div.style.cssText = `
        background: rgba(0,0,0,0.6);
        padding: 5px 10px;
        margin-bottom: 5px;
        border-left: 3px solid #ffcc00;
        font-size: 13px;
      `;
      div.textContent = msg.text;
      this.elements.killFeed.appendChild(div);
    }
  }

  showHitMarker(currentTime: number): void {
    if (this.elements.hitMarker) {
      (this.elements.hitMarker as HTMLElement).style.opacity = '1';
    }
  }

  showDamageIndicator(): void {
    if (this.elements.damageVignette) {
      (this.elements.damageVignette as HTMLElement).style.opacity = '0.6';
    }
  }

  dispose(): void {
    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}
