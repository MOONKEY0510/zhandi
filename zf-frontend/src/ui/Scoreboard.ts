import { applyThemeRoot, UI_THEME } from './theme';

export interface PlayerScore {
  id: string;
  name: string;
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  ping: number;
  team: string;
}

export class Scoreboard {
  container: HTMLElement;
  elements: {
    playerList: HTMLElement | null;
    teamAScore: HTMLElement | null;
    teamBScore: HTMLElement | null;
  } = {
    playerList: null,
    teamAScore: null,
    teamBScore: null,
  };

  players: PlayerScore[] = [];
  isVisible: boolean = false;

  constructor() {
    applyThemeRoot();
    this.container = this.createScoreboard();
  }

  private createScoreboard(): HTMLElement {
    const container = document.createElement('div');
    container.id = 'scoreboard';
    container.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(20, 20, 30, 0.95);
      border: 2px solid rgba(255, 255, 255, 0.2);
      border-radius: 10px;
      padding: 20px;
      width: 600px;
      max-height: 400px;
      overflow-y: auto;
      z-index: 100;
      font-family: ${UI_THEME.fontFamily};
      color: white;
      display: none;
    `;

    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.2);">
        <div>
          <h3 style="margin: 0; color: #ff4444;">德军</h3>
          <div id="team-a-score" style="font-size: 24px; font-weight: bold;">0</div>
        </div>
        <div style="text-align: center;">
          <h2 style="margin: 0; font-size: 28px;">计分板</h2>
          <p style="margin: 5px 0 0; color: rgba(255, 255, 255, 0.5);">按 Tab 关闭</p>
        </div>
        <div style="text-align: right;">
          <h3 style="margin: 0; color: #4488ff;">苏军</h3>
          <div id="team-b-score" style="font-size: 24px; font-weight: bold;">0</div>
        </div>
      </div>

      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.2);">
            <th style="text-align: left; padding: 8px;">玩家</th>
            <th style="text-align: center; padding: 8px;">击杀</th>
            <th style="text-align: center; padding: 8px;">死亡</th>
            <th style="text-align: center; padding: 8px;">助攻</th>
            <th style="text-align: center; padding: 8px;">分数</th>
            <th style="text-align: center; padding: 8px;">延迟</th>
          </tr>
        </thead>
        <tbody id="player-list"></tbody>
      </table>
    `;

    document.body.appendChild(container);

    this.elements.playerList = container.querySelector('#player-list');
    this.elements.teamAScore = container.querySelector('#team-a-score');
    this.elements.teamBScore = container.querySelector('#team-b-score');

    return container;
  }

  updatePlayers(players: PlayerScore[]): void {
    this.players = players;
    this.render();
  }

  addPlayer(player: PlayerScore): void {
    const existingIndex = this.players.findIndex(p => p.id === player.id);
    if (existingIndex >= 0) {
      this.players[existingIndex] = player;
    } else {
      this.players.push(player);
    }
    this.render();
  }

  removePlayer(id: string): void {
    this.players = this.players.filter(p => p.id !== id);
    this.render();
  }

  updateScore(id: string, kills: number, deaths: number, assists: number, score: number): void {
    const player = this.players.find(p => p.id === id);
    if (player) {
      player.kills = kills;
      player.deaths = deaths;
      player.assists = assists;
      player.score = score;
      this.render();
    }
  }

  private render(): void {
    if (!this.elements.playerList) return;

    this.players.sort((a, b) => b.score - a.score);

    let teamAScore = 0;
    let teamBScore = 0;

    this.elements.playerList.innerHTML = this.players.map(player => {
      const teamColor = player.team === 'A' ? '#ff4444' : '#4488ff';
      if (player.team === 'A') {
        teamAScore += player.kills;
      } else {
        teamBScore += player.kills;
      }

      return `
        <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
          <td style="padding: 8px; display: flex; align-items: center; gap: 8px;">
            <div style="width: 8px; height: 8px; border-radius: 50%; background: ${teamColor};"></div>
            ${player.name}
          </td>
          <td style="text-align: center; padding: 8px;">${player.kills}</td>
          <td style="text-align: center; padding: 8px;">${player.deaths}</td>
          <td style="text-align: center; padding: 8px;">${player.assists}</td>
          <td style="text-align: center; padding: 8px; font-weight: bold;">${player.score}</td>
          <td style="text-align: center; padding: 8px; color: ${player.ping < 50 ? '#44ff44' : player.ping < 100 ? '#ffff44' : '#ff4444'};">${player.ping}ms</td>
        </tr>
      `;
    }).join('');

    if (this.elements.teamAScore) {
      this.elements.teamAScore.textContent = teamAScore.toString();
    }
    if (this.elements.teamBScore) {
      this.elements.teamBScore.textContent = teamBScore.toString();
    }
  }

  show(): void {
    this.isVisible = true;
    this.container.style.display = 'block';
  }

  hide(): void {
    this.isVisible = false;
    this.container.style.display = 'none';
  }

  toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  dispose(): void {
    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}
