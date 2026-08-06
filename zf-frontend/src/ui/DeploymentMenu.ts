import { SOLDIER_CLASSES, SoldierClassId, type SoldierClassDefinition } from '../player/SoldierClass';
import { applyThemeRoot, UI_THEME } from './theme';
import { FocusManager } from './focusManager';

export class DeploymentMenu {
  readonly container: HTMLElement;
  private selectedClass = SoldierClassId.ASSAULT;
  onDeploy: ((definition: SoldierClassDefinition) => void) | null = null;
  private focusManager: FocusManager | null = null;

  constructor() {
    applyThemeRoot();
    this.container = document.createElement('div');
    this.container.id = 'deployment-menu';
    this.container.style.cssText = `
      position:fixed;inset:0;display:none;align-items:center;justify-content:center;
      background:linear-gradient(120deg,rgba(8,12,18,.96),rgba(25,31,38,.92));
      color:white;font-family:${UI_THEME.fontFamily};z-index:1100;
    `;
    document.body.appendChild(this.container);
    this.render();
  }

  show(): void {
    this.render();
    this.container.style.display = 'flex';
    this.focusManager?.focusFirst();
  }

  hide(): void {
    this.container.style.display = 'none';
  }

  dispose(): void {
    this.focusManager?.dispose();
    this.focusManager = null;
    this.container.remove();
  }

  getSelectedClass(): SoldierClassDefinition {
    return SOLDIER_CLASSES[this.selectedClass];
  }

  private render(): void {
    const definitions = Object.values(SOLDIER_CLASSES);
    this.container.innerHTML = `
      <section style="width:min(980px,92vw)">
        <header style="margin-bottom:24px"><div style="color:#d8ad43;letter-spacing:.18em">征服模式</div><h1 style="margin:8px 0">选择兵种并部署</h1></header>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px">
          ${definitions.map((definition) => this.classCard(definition)).join('')}
        </div>
        <div id="class-detail" style="margin-top:20px;padding:18px;border-left:4px solid #d8ad43;background:rgba(255,255,255,.07)"></div>
        <button id="deploy-button" style="margin-top:20px;padding:14px 36px;background:#d8ad43;border:0;font-weight:bold;cursor:pointer">部署</button>
      </section>
    `;
    this.container.querySelectorAll<HTMLElement>('[data-class]').forEach((card) => {
      card.addEventListener('click', () => {
        this.selectedClass = card.dataset.class as SoldierClassId;
        this.render();
      });
    });
    this.container.querySelector('#deploy-button')?.addEventListener('click', () => {
      this.onDeploy?.(this.getSelectedClass());
    });
    const detail = this.container.querySelector('#class-detail');
    const selected = this.getSelectedClass();
    if (detail) {
      detail.innerHTML = `<strong>${selected.name}</strong> · ${selected.role}<br>主武器：${selected.primaryWeapon}<br>装备：${selected.equipment.join(' / ')} · 被动：${selected.passive}`;
    }
    // 动态重绘后重建焦点导航（旧元素已全部替换）
    this.focusManager?.dispose();
    this.focusManager = new FocusManager(this.container);
  }

  private classCard(definition: SoldierClassDefinition): string {
    const selected = definition.id === this.selectedClass;
    return `<button data-class="${definition.id}" style="text-align:left;padding:18px;min-height:150px;color:white;cursor:pointer;border:${selected ? '2px solid #d8ad43' : '1px solid #59616b'};background:${selected ? 'rgba(216,173,67,.2)' : 'rgba(255,255,255,.05)'}">
      <strong style="font-size:18px">${definition.name}</strong><p>${definition.role}</p><small>${definition.primaryWeapon}</small>
    </button>`;
  }
}
