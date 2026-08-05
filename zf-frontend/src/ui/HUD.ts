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
  hitMarkerHeadshot?: boolean;
  damageIndicator: { x: number; y: number } | null;
  score: number;
  position: { x: number; y: number; z: number };
  stamina?: number;
  equipmentCount?: number;
  equipmentName?: string;
  interactionPrompt?: string | null;
  damageDirection?: number | null; // 角度（弧度），null=无
  spawnProtection?: number; // 重生保护剩余秒数
  // 征服模式
  axisTickets?: number;
  alliesTickets?: number;
  playerTeam?: string;
  controlPoints?: { id: string; owner: string; progress: number }[];
}

/** 小地图 Canvas 重绘间隔 ms（阶段 9 P0 降频：10Hz，只在数据变化时写 Canvas） */
export const MINIMAP_REFRESH_MS = 100;

/**
 * 降频判定（阶段 9 P0：小地图/低频 UI 只在数据变化时写 DOM/Canvas）。
 * 距离上次重绘 ≥ interval 才重绘；初始（lastDraw ≤ 0，尚未绘制过）立即重绘。
 */
export function shouldRedrawMinimap(lastDrawMs: number, currentTimeMs: number, intervalMs = MINIMAP_REFRESH_MS): boolean {
  if (lastDrawMs <= 0) return true;
  return currentTimeMs - lastDrawMs >= intervalMs;
}

export class HUD {
  container: HTMLElement;
  private lastMinimapDraw = 0;
  private reloadBar: HTMLElement | null = null;
  private reloadProgress: HTMLElement | null = null;
  private crosshairTop: HTMLElement | null = null;
  private crosshairBottom: HTMLElement | null = null;
  private crosshairLeft: HTMLElement | null = null;
  private crosshairRight: HTMLElement | null = null;
  private lowAmmoWarning: HTMLElement | null = null;

  private elements: {
    healthBar: HTMLElement | null;
    healthText: HTMLElement | null;
    ammoText: HTMLElement | null;
    weaponName: HTMLElement | null;
    hitMarker: HTMLElement | null;
    killFeed: HTMLElement | null;
    scoreText: HTMLElement | null;
    minimap: HTMLCanvasElement | null;
    damageVignette: HTMLElement | null;
    staminaBar: HTMLElement | null;
    equipmentText: HTMLElement | null;
    interactionPrompt: HTMLElement | null;
    damageDirection: HTMLElement | null;
    spawnProtection: HTMLElement | null;
    headshotMarker: HTMLElement | null;
    axisTickets: HTMLElement | null;
    alliesTickets: HTMLElement | null;
    cpA: HTMLElement | null;
    cpB: HTMLElement | null;
    cpC: HTMLElement | null;
    vehicleHealthContainer: HTMLElement | null;
    vehicleHealthBar: HTMLElement | null;
    vehicleHealthName: HTMLElement | null;
  } = {
    healthBar: null,
    healthText: null,
    ammoText: null,
    weaponName: null,
    hitMarker: null,
    killFeed: null,
    scoreText: null,
    minimap: null,
    damageVignette: null,
    staminaBar: null,
    equipmentText: null,
    interactionPrompt: null,
    damageDirection: null,
    spawnProtection: null,
    headshotMarker: null,
    axisTickets: null,
    alliesTickets: null,
    cpA: null,
    cpB: null,
    cpC: null,
    vehicleHealthContainer: null,
    vehicleHealthBar: null,
    vehicleHealthName: null,
  };

  killMessages: { text: string; time: number }[] = [];
  private enemies: { x: number; z: number; isFriendly?: boolean }[] = [];
  private crosshairSpread = 0;
  private damageVignetteTimeout: number | null = null;

  // 阶段 9 P0：只在数据变化时写 DOM（避免每帧字符串分配 + 无效 DOM 写入）
  private lastHealthInt = -1;
  private lastHealthBarWidth = -1;
  private lastAmmoText = '';
  private lastAmmoLowColor: boolean | null = null;
  private lastWeaponName = '';
  private lastScoreText = '';
  private lastLowAmmoWarningVisible: boolean | null = null;
  private lastReloadBarVisible: boolean | null = null;
  private lastAxisTickets = -1;
  private lastAlliesTickets = -1;
  private lastControlPointsKey = '';
  /** 阶段 9：实际 DOM 写入次数（测试断言 + 性能观测：每帧 DOM 写入是否随数据去重） */
  domWriteCount = 0;

  constructor() {
    this.container = this.createHUD();
  }

  private createHUD(): HTMLElement {
    const container = document.createElement('div');
    container.id = 'hud';
    container.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: 100;
      font-family: 'Arial', sans-serif; color: white;
    `;

    container.innerHTML = `
      <div id="crosshair" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);">
        <div style="position: relative; width: 30px; height: 30px;">
          <div id="cross-top" style="position: absolute; top: 50%; left: 50%; width: 2px; height: 8px; background: rgba(255,255,255,0.9); transform: translate(-50%, -100%) translateY(-4px); transition: transform 0.05s;"></div>
          <div id="cross-bottom" style="position: absolute; top: 50%; left: 50%; width: 2px; height: 8px; background: rgba(255,255,255,0.9); transform: translate(-50%, 0) translateY(4px); transition: transform 0.05s;"></div>
          <div id="cross-left" style="position: absolute; top: 50%; left: 50%; width: 8px; height: 2px; background: rgba(255,255,255,0.9); transform: translate(-100%, -50%) translateX(-4px); transition: transform 0.05s;"></div>
          <div id="cross-right" style="position: absolute; top: 50%; left: 50%; width: 8px; height: 2px; background: rgba(255,255,255,0.9); transform: translate(0, -50%) translateX(4px); transition: transform 0.05s;"></div>
          <div id="hitmarker" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); opacity: 0; transition: opacity 0.05s;">
            <svg width="24" height="24" viewBox="0 0 24 24">
              <line x1="3" y1="3" x2="7" y2="7" stroke="#ff4444" stroke-width="2.5"/>
              <line x1="21" y1="3" x2="17" y2="7" stroke="#ff4444" stroke-width="2.5"/>
              <line x1="3" y1="21" x2="7" y2="17" stroke="#ff4444" stroke-width="2.5"/>
              <line x1="21" y1="21" x2="17" y2="17" stroke="#ff4444" stroke-width="2.5"/>
            </svg>
          </div>
          <div id="headshot-marker" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); opacity: 0; transition: opacity 0.05s;">
            <svg width="30" height="30" viewBox="0 0 30 30">
              <line x1="4" y1="4" x2="11" y2="11" stroke="#ffcc00" stroke-width="3.5"/>
              <line x1="26" y1="4" x2="19" y2="11" stroke="#ffcc00" stroke-width="3.5"/>
              <line x1="4" y1="26" x2="11" y2="19" stroke="#ffcc00" stroke-width="3.5"/>
              <line x1="26" y1="26" x2="19" y2="19" stroke="#ffcc00" stroke-width="3.5"/>
            </svg>
          </div>
        </div>
      </div>

      <div id="health-container" style="position: absolute; bottom: 40px; left: 40px; display: flex; align-items: center; gap: 15px;">
        <div id="health-icon" style="width: 40px; height: 40px; background: #cc0000; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px;">+</div>
        <div id="health-bar-bg" style="width: 200px; height: 20px; background: rgba(0,0,0,0.5); border: 2px solid rgba(255,255,255,0.3); border-radius: 3px; overflow: hidden; position: relative;">
          <div id="health-bar" style="height: 100%; background: linear-gradient(to right, #cc0000, #ff3333); width: 100%; transition: width 0.3s;"></div>
          <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; pointer-events: none;">
            <div style="flex: 1; border-right: 1px solid rgba(0,0,0,0.4);"></div>
            <div style="flex: 1; border-right: 1px solid rgba(0,0,0,0.4);"></div>
            <div style="flex: 1; border-right: 1px solid rgba(0,0,0,0.4);"></div>
            <div style="flex: 1;"></div>
          </div>
        </div>
        <div id="health-text" style="font-size: 28px; font-weight: bold; min-width: 60px; text-shadow: 2px 2px 4px rgba(0,0,0,0.8);">100</div>
      </div>

      <div id="vehicle-health-container" style="position: absolute; bottom: 95px; left: 40px; opacity: 0; transition: opacity 0.2s;">
        <div id="vehicle-health-name" style="font-size: 14px; color: #ffcc66; margin-bottom: 4px; text-shadow: 1px 1px 2px rgba(0,0,0,0.8);">载具</div>
        <div style="width: 200px; height: 10px; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,204,102,0.5); border-radius: 2px; overflow: hidden;">
          <div id="vehicle-health-bar" style="height: 100%; background: linear-gradient(to right, #aa6600, #ffcc66); width: 100%; transition: width 0.15s;"></div>
        </div>
      </div>

      <div id="ammo-container" style="position: absolute; bottom: 40px; right: 40px; text-align: right;">
        <div id="weapon-name" style="font-size: 16px; color: rgba(255,255,255,0.7); margin-bottom: 5px;">STG44</div>
        <div style="display: flex; align-items: baseline; justify-content: flex-end; gap: 8px;">
          <div id="ammo-text" style="font-size: 42px; font-weight: bold; text-shadow: 2px 2px 4px rgba(0,0,0,0.8);">30 / 120</div>
        </div>
        <div id="reload-bar" style="width: 150px; height: 4px; background: rgba(0,0,0,0.5); margin-top: 5px; margin-left: auto; opacity: 0;">
          <div id="reload-progress" style="height: 100%; background: #ffcc00; width: 0%; transition: width 0.05s;"></div>
        </div>
        <div id="low-ammo" style="font-size: 14px; color: #ff6666; margin-top: 3px; opacity: 0; font-weight: bold;">弹药不足！按 R 换弹</div>
      </div>

      <div id="score-container" style="position: absolute; top: 20px; right: 20px; background: rgba(0,0,0,0.4); padding: 10px 15px; border-radius: 5px;">
        <div id="score-text" style="font-size: 18px;">K: 0 / D: 0</div>
      </div>

      <div id="conquest-container" style="position: absolute; top: 20px; left: 50%; transform: translateX(-50%); display: flex; gap: 20px; align-items: center;">
        <div id="axis-tickets" style="background: rgba(255,68,68,0.3); padding: 8px 15px; border-radius: 5px; border: 2px solid #ff4444; text-align: center;">
          <div style="font-size: 12px; color: #ff8888;">德军</div>
          <div id="axis-ticket-count" style="font-size: 24px; font-weight: bold; color: #ff4444;">200</div>
        </div>
        <div id="control-points" style="display: flex; gap: 10px;">
          <div id="cp-A" style="width: 30px; height: 30px; border-radius: 50%; background: rgba(100,100,100,0.5); border: 2px solid #888; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px;">A</div>
          <div id="cp-B" style="width: 30px; height: 30px; border-radius: 50%; background: rgba(100,100,100,0.5); border: 2px solid #888; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px;">B</div>
          <div id="cp-C" style="width: 30px; height: 30px; border-radius: 50%; background: rgba(100,100,100,0.5); border: 2px solid #888; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px;">C</div>
        </div>
        <div id="allies-tickets" style="background: rgba(68,136,255,0.3); padding: 8px 15px; border-radius: 5px; border: 2px solid #4488ff; text-align: center;">
          <div style="font-size: 12px; color: #88bbff;">苏军</div>
          <div id="allies-ticket-count" style="font-size: 24px; font-weight: bold; color: #4488ff;">200</div>
        </div>
      </div>

      <div id="kill-feed" style="position: absolute; top: 80px; right: 20px; min-width: 200px;"></div>

      <div id="minimap" style="position: absolute; top: 20px; left: 20px; width: 180px; height: 180px; background: rgba(0,0,0,0.5); border: 2px solid rgba(255,255,255,0.3); border-radius: 5px; overflow: hidden;">
        <canvas id="minimap-canvas" width="180" height="180" style="display: block;"></canvas>
      </div>

      <div id="stamina-container" style="position: absolute; bottom: 15px; left: 50%; transform: translateX(-50%); width: 200px; height: 4px; background: rgba(0,0,0,0.5); border-radius: 2px; overflow: hidden;">
        <div id="stamina-bar" style="height: 100%; background: linear-gradient(to right, #ffaa00, #ffff00); width: 100%; transition: width 0.1s;"></div>
      </div>

      <div id="equipment-container" style="position: absolute; bottom: 80px; right: 40px; text-align: right;">
        <div id="equipment-text" style="font-size: 14px; color: rgba(255,255,255,0.7);">手雷 x1</div>
      </div>

      <div id="interaction-prompt" style="position: absolute; bottom: 50%; left: 50%; transform: translate(-50%, 60px); background: rgba(0,0,0,0.7); padding: 8px 16px; border-radius: 5px; font-size: 16px; opacity: 0; transition: opacity 0.2s; pointer-events: none;"></div>

      <div id="spawn-protection" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -80px); background: rgba(0,100,255,0.6); padding: 10px 20px; border-radius: 5px; font-size: 18px; font-weight: bold; opacity: 0; transition: opacity 0.3s; pointer-events: none; border: 2px solid rgba(100,180,255,0.8);">重生保护中...</div>

      <div id="damage-direction" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 120px; height: 120px; pointer-events: none; opacity: 0; transition: opacity 0.3s;">
        <svg width="120" height="120" viewBox="0 0 120 120">
          <path id="damage-arrow" d="M60,10 L50,30 L70,30 Z" fill="rgba(255,0,0,0.8)" style="transform-origin: 60px 60px;"/>
        </svg>
      </div>

      <div id="damage-vignette" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; opacity: 0; background: radial-gradient(circle, transparent 50%, rgba(255,0,0,0.6) 100%); transition: opacity 0.3s;"></div>
    `;

    document.body.appendChild(container);

    this.elements.healthBar = container.querySelector('#health-bar');
    this.elements.healthText = container.querySelector('#health-text');
    this.elements.ammoText = container.querySelector('#ammo-text');
    this.elements.weaponName = container.querySelector('#weapon-name');
    this.elements.hitMarker = container.querySelector('#hitmarker');
    this.elements.headshotMarker = container.querySelector('#headshot-marker');
    this.elements.killFeed = container.querySelector('#kill-feed');
    this.elements.scoreText = container.querySelector('#score-text');
    this.elements.minimap = container.querySelector('#minimap-canvas') as HTMLCanvasElement;
    this.elements.damageVignette = container.querySelector('#damage-vignette');
    this.elements.staminaBar = container.querySelector('#stamina-bar');
    this.elements.equipmentText = container.querySelector('#equipment-text');
    this.elements.interactionPrompt = container.querySelector('#interaction-prompt');
    this.elements.damageDirection = container.querySelector('#damage-direction');
    this.elements.spawnProtection = container.querySelector('#spawn-protection');
    this.elements.axisTickets = container.querySelector('#axis-ticket-count');
    this.elements.alliesTickets = container.querySelector('#allies-ticket-count');
    this.elements.cpA = container.querySelector('#cp-A');
    this.elements.cpB = container.querySelector('#cp-B');
    this.elements.cpC = container.querySelector('#cp-C');
    this.elements.vehicleHealthContainer = container.querySelector('#vehicle-health-container');
    this.elements.vehicleHealthBar = container.querySelector('#vehicle-health-bar');
    this.elements.vehicleHealthName = container.querySelector('#vehicle-health-name');

    this.reloadBar = container.querySelector('#reload-bar');
    this.reloadProgress = container.querySelector('#reload-progress');
    this.crosshairTop = container.querySelector('#cross-top');
    this.crosshairBottom = container.querySelector('#cross-bottom');
    this.crosshairLeft = container.querySelector('#cross-left');
    this.crosshairRight = container.querySelector('#cross-right');
    this.lowAmmoWarning = container.querySelector('#low-ammo');

    return container;
  }

  update(data: HUDData, currentTime: number): void {
    // 血量（阶段 9：只在数据变化时写 DOM）
    const healthInt = Math.ceil(data.health);
    if (this.elements.healthBar) {
      const widthPct = (data.health / data.maxHealth) * 100;
      if (widthPct !== this.lastHealthBarWidth) {
        this.elements.healthBar.style.width = `${widthPct}%`;
        this.lastHealthBarWidth = widthPct;
        this.domWriteCount += 1;
      }
    }
    if (this.elements.healthText && healthInt !== this.lastHealthInt) {
      this.elements.healthText.textContent = healthInt.toString();
      this.lastHealthInt = healthInt;
      this.domWriteCount += 1;
    }

    // 弹药（含低弹量变色，只在值/状态变化时写）
    if (this.elements.ammoText) {
      const ammoText = `${data.ammo} / ${data.reserveAmmo}`;
      if (ammoText !== this.lastAmmoText) {
        this.elements.ammoText.textContent = ammoText;
        this.lastAmmoText = ammoText;
        this.domWriteCount += 1;
      }
      const lowAmmo = data.ammo <= 5;
      if (lowAmmo !== this.lastAmmoLowColor) {
        this.elements.ammoText.style.color = lowAmmo ? '#ff6666' : 'white';
        this.lastAmmoLowColor = lowAmmo;
        this.domWriteCount += 1;
      }
    }

    // 低弹量提示
    if (this.lowAmmoWarning) {
      const show = data.ammo <= 5 && !data.isReloading;
      if (show !== this.lastLowAmmoWarningVisible) {
        this.lowAmmoWarning.style.opacity = show ? '1' : '0';
        this.lastLowAmmoWarningVisible = show;
        this.domWriteCount += 1;
      }
    }

    if (this.elements.weaponName && data.weaponName !== this.lastWeaponName) {
      this.elements.weaponName.textContent = data.weaponName;
      this.lastWeaponName = data.weaponName;
      this.domWriteCount += 1;
    }
    if (this.elements.scoreText) {
      const scoreText = `K: ${data.killCount} / D: ${data.deathCount}`;
      if (scoreText !== this.lastScoreText) {
        this.elements.scoreText.textContent = scoreText;
        this.lastScoreText = scoreText;
        this.domWriteCount += 1;
      }
    }

    // 换弹进度条（显示/隐藏状态缓存；进度连续变化时照常写）
    if (this.reloadBar && this.reloadProgress) {
      if (data.isReloading) {
        if (!this.lastReloadBarVisible) {
          this.reloadBar.style.opacity = '1';
          this.lastReloadBarVisible = true;
          this.domWriteCount += 1;
        }
        this.reloadProgress.style.width = `${data.reloadProgress * 100}%`;
        this.domWriteCount += 1;
      } else if (this.lastReloadBarVisible) {
        this.reloadBar.style.opacity = '0';
        this.lastReloadBarVisible = false;
        this.domWriteCount += 1;
      }
    }

    // 命中标记（爆头显示金色大X）
    if (this.elements.hitMarker) {
      if (data.hitMarker && currentTime - data.hitMarkerTime < 150) {
        this.elements.hitMarker.style.opacity = '1';
      } else {
        this.elements.hitMarker.style.opacity = '0';
      }
    }
    if (this.elements.headshotMarker) {
      if (data.hitMarkerHeadshot && data.hitMarker && currentTime - data.hitMarkerTime < 250) {
        this.elements.headshotMarker.style.opacity = '1';
      } else {
        this.elements.headshotMarker.style.opacity = '0';
      }
    }

    // 伤害指示器
    if (this.elements.damageVignette) {
      if (data.damageIndicator) {
        this.elements.damageVignette.style.opacity = '0.6';
        if (this.damageVignetteTimeout) clearTimeout(this.damageVignetteTimeout);
        this.damageVignetteTimeout = window.setTimeout(() => {
          if (this.elements.damageVignette) {
            this.elements.damageVignette.style.opacity = '0';
          }
        }, 300);
      }
    }

    // 体力条
    if (this.elements.staminaBar && data.stamina !== undefined) {
      this.elements.staminaBar.style.width = `${data.stamina}%`;
      if (data.stamina < 20) {
        this.elements.staminaBar.style.background = '#ff3333';
      } else {
        this.elements.staminaBar.style.background = 'linear-gradient(to right, #ffaa00, #ffff00)';
      }
    }

    // 装备数量
    if (this.elements.equipmentText && data.equipmentName !== undefined && data.equipmentCount !== undefined) {
      this.elements.equipmentText.textContent = `${data.equipmentName} x${data.equipmentCount}`;
      this.elements.equipmentText.style.color = data.equipmentCount > 0 ? 'rgba(255,255,255,0.7)' : 'rgba(255,100,100,0.7)';
    }

    // 交互提示
    if (this.elements.interactionPrompt) {
      if (data.interactionPrompt) {
        this.elements.interactionPrompt.textContent = data.interactionPrompt;
        this.elements.interactionPrompt.style.opacity = '1';
      } else {
        this.elements.interactionPrompt.style.opacity = '0';
      }
    }

    // 重生保护提示
    if (this.elements.spawnProtection) {
      if (data.spawnProtection !== undefined && data.spawnProtection > 0) {
        this.elements.spawnProtection.textContent = `重生保护中... ${data.spawnProtection.toFixed(1)}s`;
        this.elements.spawnProtection.style.opacity = '1';
      } else {
        this.elements.spawnProtection.style.opacity = '0';
      }
    }

    // 方向伤害指示器
    if (this.elements.damageDirection) {
      if (data.damageDirection !== null && data.damageDirection !== undefined) {
        this.elements.damageDirection.style.opacity = '1';
        const arrow = this.elements.damageDirection.querySelector('#damage-arrow') as HTMLElement | null;
        if (arrow) {
          arrow.style.transform = `rotate(${data.damageDirection}rad)`;
        }
      } else {
        this.elements.damageDirection.style.opacity = '0';
      }
    }

    // 征服模式 UI（阶段 9：兵力值/控制点只在数据变化时写 DOM）
    if (data.axisTickets !== undefined && this.elements.axisTickets && data.axisTickets !== this.lastAxisTickets) {
      this.elements.axisTickets.textContent = data.axisTickets.toString();
      this.lastAxisTickets = data.axisTickets;
      this.domWriteCount += 1;
    }
    if (data.alliesTickets !== undefined && this.elements.alliesTickets && data.alliesTickets !== this.lastAlliesTickets) {
      this.elements.alliesTickets.textContent = data.alliesTickets.toString();
      this.lastAlliesTickets = data.alliesTickets;
      this.domWriteCount += 1;
    }
    if (data.controlPoints) {
      const key = data.controlPoints.map((cp) => `${cp.id}:${cp.owner}:${cp.progress.toFixed(2)}`).join('|');
      if (key !== this.lastControlPointsKey) {
        this.lastControlPointsKey = key;
        this.domWriteCount += 1;
        const cpElements = [this.elements.cpA, this.elements.cpB, this.elements.cpC];
        data.controlPoints.forEach((cp, i) => {
        const el = cpElements[i];
        if (!el) return;
        if (cp.owner === 'axis') {
          el.style.background = 'rgba(255,68,68,0.6)';
          el.style.borderColor = '#ff4444';
        } else if (cp.owner === 'allies') {
          el.style.background = 'rgba(68,136,255,0.6)';
          el.style.borderColor = '#4488ff';
        } else {
          el.style.background = 'rgba(100,100,100,0.5)';
          el.style.borderColor = '#888';
        }
        });
      }
    }

    // 准星扩散：移动/射击时扩大
    const targetSpread = data.isReloading ? 12 : 4;
    this.crosshairSpread += (targetSpread - this.crosshairSpread) * 0.15;
    this.updateCrosshairSpread();

    this.updateMinimap(data.position, currentTime);
    this.updateKillFeed(currentTime);
  }

  private updateCrosshairSpread(): void {
    const offset = this.crosshairSpread;
    if (this.crosshairTop) {
      this.crosshairTop.style.transform = `translate(-50%, -100%) translateY(-${offset}px)`;
    }
    if (this.crosshairBottom) {
      this.crosshairBottom.style.transform = `translate(-50%, 0) translateY(${offset}px)`;
    }
    if (this.crosshairLeft) {
      this.crosshairLeft.style.transform = `translate(-100%, -50%) translateX(-${offset}px)`;
    }
    if (this.crosshairRight) {
      this.crosshairRight.style.transform = `translate(0, -50%) translateX(${offset}px)`;
    }
  }

  updateMinimapEnemies(enemies: { x: number; z: number; isFriendly?: boolean }[]): void {
    this.enemies = enemies;
  }

  private updateMinimap(playerPos: { x: number; y: number; z: number }, currentTime: number): void {
    // 小地图降频（阶段 9 P0：只在数据变化时写 Canvas，默认 10Hz 重绘）
    if (!shouldRedrawMinimap(this.lastMinimapDraw, currentTime)) return;
    this.lastMinimapDraw = currentTime;
    const canvas = this.elements.minimap;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // 背景
    ctx.fillStyle = 'rgba(40, 50, 40, 0.8)';
    ctx.fillRect(0, 0, w, h);

    const scale = 1.5; // 世界坐标到小地图像素
    const centerX = w / 2;
    const centerY = h / 2;

    // 网格线
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(w, centerY);
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, h);
    ctx.stroke();

    // 玩家（黄色）
    ctx.fillStyle = '#ffcc00';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 4, 0, Math.PI * 2);
    ctx.fill();

    // 玩家视野方向
    ctx.strokeStyle = 'rgba(255, 204, 0, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX, centerY - 15);
    ctx.stroke();

    // 敌人（红色方块）和友军（蓝色圆点）
    for (const enemy of this.enemies) {
      const dx = (enemy.x - playerPos.x) * scale;
      const dz = (enemy.z - playerPos.z) * scale;
      const px = centerX + dx;
      const py = centerY + dz;

      // 只显示小地图范围内的
      if (px >= 0 && px < w && py >= 0 && py < h) {
        if (enemy.isFriendly) {
          // 友军 - 蓝色圆点
          ctx.fillStyle = '#4488ff';
          ctx.beginPath();
          ctx.arc(px, py, 3, 0, Math.PI * 2);
          ctx.fill();
          // 蓝色边框
          ctx.strokeStyle = '#88bbff';
          ctx.lineWidth = 1;
          ctx.stroke();
        } else {
          // 敌军 - 红色方块
          ctx.fillStyle = '#ff3333';
          ctx.fillRect(px - 3, py - 3, 6, 6);
          // 红色边框
          ctx.strokeStyle = '#ff6666';
          ctx.lineWidth = 1;
          ctx.strokeRect(px - 3, py - 3, 6, 6);
        }
      }
    }
  }

  addKillMessage(message: string, currentTime: number): void {
    this.killMessages.push({ text: message, time: currentTime });

    if (this.killMessages.length > 5) {
      this.killMessages.shift();
    }

    this.renderKillFeed();
  }

  /** 驾驶载具时显示载具血量条（health/maxHealth，name 如「吉普车」「坦克」） */
  setVehicleHealth(health: number, maxHealth: number, name: string): void {
    if (!this.elements.vehicleHealthContainer || !this.elements.vehicleHealthBar) return;
    this.elements.vehicleHealthContainer.style.opacity = '1';
    this.elements.vehicleHealthBar.style.width = `${Math.max(0, Math.min(100, (health / Math.max(1, maxHealth)) * 100))}%`;
    if (this.elements.vehicleHealthName) this.elements.vehicleHealthName.textContent = name;
  }

  /** 离开载具隐藏血量条 */
  hideVehicleHealth(): void {
    if (this.elements.vehicleHealthContainer) this.elements.vehicleHealthContainer.style.opacity = '0';
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

  showDamageIndicator(): void {
    if (this.elements.damageVignette) {
      this.elements.damageVignette.style.opacity = '0.6';
      if (this.damageVignetteTimeout) clearTimeout(this.damageVignetteTimeout);
      this.damageVignetteTimeout = window.setTimeout(() => {
        if (this.elements.damageVignette) {
          this.elements.damageVignette.style.opacity = '0';
        }
      }, 300);
    }
  }

  dispose(): void {
    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}
