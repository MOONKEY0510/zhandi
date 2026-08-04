import * as THREE from 'three';

export enum WeatherType {
  CLEAR = 'clear',
  RAIN = 'rain',
  SNOW = 'snow',
  FOG = 'fog',
  SANDSTORM = 'sandstorm',
}

export interface WeatherConfig {
  type: WeatherType;
  particleCount: number;
  particleSize: number;
  fallSpeed: number;
  windStrength: number;
  fogColor: number;
  fogDensity: number;
  ambientIntensity: number;
  directionalIntensity: number;
}

const WEATHER_CONFIGS: Record<WeatherType, WeatherConfig> = {
  [WeatherType.CLEAR]: {
    type: WeatherType.CLEAR,
    particleCount: 0,
    particleSize: 0,
    fallSpeed: 0,
    windStrength: 0,
    fogColor: 0x87ceeb,
    fogDensity: 0.002,
    ambientIntensity: 0.6,
    directionalIntensity: 1.0,
  },
  [WeatherType.RAIN]: {
    type: WeatherType.RAIN,
    particleCount: 3000,
    particleSize: 0.03,
    fallSpeed: 30,
    windStrength: 2,
    fogColor: 0x555566,
    fogDensity: 0.015,
    ambientIntensity: 0.3,
    directionalIntensity: 0.4,
  },
  [WeatherType.SNOW]: {
    type: WeatherType.SNOW,
    particleCount: 2000,
    particleSize: 0.08,
    fallSpeed: 3,
    windStrength: 1,
    fogColor: 0xcccccc,
    fogDensity: 0.01,
    ambientIntensity: 0.5,
    directionalIntensity: 0.6,
  },
  [WeatherType.FOG]: {
    type: WeatherType.FOG,
    particleCount: 0,
    particleSize: 0,
    fallSpeed: 0,
    windStrength: 0,
    fogColor: 0x999999,
    fogDensity: 0.04,
    ambientIntensity: 0.4,
    directionalIntensity: 0.3,
  },
  [WeatherType.SANDSTORM]: {
    type: WeatherType.SANDSTORM,
    particleCount: 4000,
    particleSize: 0.05,
    fallSpeed: 0,
    windStrength: 15,
    fogColor: 0xc8a050,
    fogDensity: 0.03,
    ambientIntensity: 0.3,
    directionalIntensity: 0.5,
  },
};

export class WeatherSystem {
  private scene: THREE.Scene;
  private ambientLight: THREE.AmbientLight;
  private directionalLight: THREE.DirectionalLight;
  private currentWeather: WeatherType = WeatherType.CLEAR;
  /** 天气切换回调（接入层用于联动视觉基线/材质） */
  onWeatherChange?: (type: WeatherType) => void;
  private particles: THREE.Points | null = null;
  private particleVelocities: Float32Array = new Float32Array(0);
  private config: WeatherConfig = WEATHER_CONFIGS[WeatherType.CLEAR];

  // 昼夜循环
  private timeOfDay = 0.3; // 0=午夜, 0.25=日出, 0.5=正午, 0.75=日落
  private dayDuration = 300; // 一天 300 秒
  private isDayNightEnabled = false;

  // 天气自动切换
  private weatherChangeInterval = 60; // 每 60 秒可能切换天气
  private lastWeatherChange = 0;
  private isAutoWeatherEnabled = false;

  private bounds = 100;

  constructor(
    scene: THREE.Scene,
    ambientLight: THREE.AmbientLight,
    directionalLight: THREE.DirectionalLight
  ) {
    this.scene = scene;
    this.ambientLight = ambientLight;
    this.directionalLight = directionalLight;
    this.applyWeather(WeatherType.CLEAR);
  }

  setWeather(type: WeatherType): void {
    if (this.currentWeather === type) return;
    this.applyWeather(type);
  }

  private applyWeather(type: WeatherType): void {
    this.currentWeather = type;
    this.config = WEATHER_CONFIGS[type];
    this.onWeatherChange?.(type);

    // 清除旧粒子
    if (this.particles) {
      this.scene.remove(this.particles);
      this.particles.geometry.dispose();
      (this.particles.material as THREE.Material).dispose();
      this.particles = null;
    }

    // 雾
    this.scene.fog = new THREE.FogExp2(this.config.fogColor, this.config.fogDensity);
    this.scene.background = new THREE.Color(this.config.fogColor);

    // 光照
    this.ambientLight.intensity = this.config.ambientIntensity;
    this.directionalLight.intensity = this.config.directionalIntensity;

    // 创建粒子
    if (this.config.particleCount > 0) {
      this.createParticles();
    }
  }

  private createParticles(): void {
    const count = this.config.particleCount;
    const positions = new Float32Array(count * 3);
    this.particleVelocities = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      positions[i3] = (Math.random() - 0.5) * this.bounds * 2;
      positions[i3 + 1] = Math.random() * 50;
      positions[i3 + 2] = (Math.random() - 0.5) * this.bounds * 2;

      this.particleVelocities[i3] = (Math.random() - 0.5) * this.config.windStrength;
      this.particleVelocities[i3 + 1] = -this.config.fallSpeed * (0.8 + Math.random() * 0.4);
      this.particleVelocities[i3 + 2] = (Math.random() - 0.5) * this.config.windStrength;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    let color = 0xffffff;
    if (this.currentWeather === WeatherType.RAIN) color = 0xaaaaff;
    else if (this.currentWeather === WeatherType.SANDSTORM) color = 0xddaa55;

    const material = new THREE.PointsMaterial({
      color,
      size: this.config.particleSize,
      transparent: true,
      opacity: this.currentWeather === WeatherType.RAIN ? 0.6 : 0.8,
      blending: this.currentWeather === WeatherType.SANDSTORM ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    this.particles = new THREE.Points(geometry, material);
    this.scene.add(this.particles);
  }

  enableDayNightCycle(enabled: boolean): void {
    this.isDayNightEnabled = enabled;
  }

  enableAutoWeather(enabled: boolean): void {
    this.isAutoWeatherEnabled = enabled;
  }

  update(dt: number, currentTime: number, playerPos: THREE.Vector3): void {
    // 粒子更新
    if (this.particles && this.config.particleCount > 0) {
      const positions = this.particles.geometry.attributes.position.array as Float32Array;
      const count = this.config.particleCount;

      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        positions[i3] += this.particleVelocities[i3] * dt;
        positions[i3 + 1] += this.particleVelocities[i3 + 1] * dt;
        positions[i3 + 2] += this.particleVelocities[i3 + 2] * dt;

        // 回收粒子到顶部
        if (positions[i3 + 1] < 0) {
          positions[i3] = playerPos.x + (Math.random() - 0.5) * this.bounds;
          positions[i3 + 1] = 40 + Math.random() * 10;
          positions[i3 + 2] = playerPos.z + (Math.random() - 0.5) * this.bounds;
        }

        // 水平边界回收
        const dx = positions[i3] - playerPos.x;
        const dz = positions[i3 + 2] - playerPos.z;
        if (Math.abs(dx) > this.bounds) {
          positions[i3] = playerPos.x - Math.sign(dx) * this.bounds;
        }
        if (Math.abs(dz) > this.bounds) {
          positions[i3 + 2] = playerPos.z - Math.sign(dz) * this.bounds;
        }
      }

      this.particles.geometry.attributes.position.needsUpdate = true;
    }

    // 昼夜循环
    if (this.isDayNightEnabled) {
      this.timeOfDay += dt / this.dayDuration;
      if (this.timeOfDay >= 1) this.timeOfDay -= 1;
      this.updateDayNight();
    }

    // 自动天气切换
    if (this.isAutoWeatherEnabled && currentTime - this.lastWeatherChange > this.weatherChangeInterval * 1000) {
      this.lastWeatherChange = currentTime;
      const weathers = Object.values(WeatherType);
      this.setWeather(weathers[Math.floor(Math.random() * weathers.length)]);
    }
  }

  private updateDayNight(): void {
    // 太阳角度：0=地平线下, 0.25=日出, 0.5=正午, 0.75=日落
    const sunAngle = (this.timeOfDay - 0.25) * Math.PI * 2;
    const sunHeight = Math.sin(sunAngle);
    const sunX = Math.cos(sunAngle);

    this.directionalLight.position.set(sunX * 80, Math.max(5, sunHeight * 100), 50);

    // 日间/夜间光照强度
    const dayFactor = Math.max(0, Math.min(1, sunHeight * 1.5));
    this.directionalLight.intensity = this.config.directionalIntensity * dayFactor;
    this.ambientLight.intensity = this.config.ambientIntensity * (0.3 + dayFactor * 0.7);

    // 天空颜色：日出/日落偏橙，夜间偏深蓝
    const baseColor = new THREE.Color(this.config.fogColor);
    const nightColor = new THREE.Color(0x1a1a3a);
    const sunsetColor = new THREE.Color(0xff8844);

    let skyColor: THREE.Color;
    if (sunHeight < 0) {
      // 夜间
      skyColor = nightColor;
    } else if (sunHeight < 0.3) {
      // 日出/日落
      const t = sunHeight / 0.3;
      skyColor = sunsetColor.clone().lerp(baseColor, t);
    } else {
      skyColor = baseColor;
    }

    this.scene.background = skyColor;
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color = skyColor;
    }
  }

  getCurrentWeather(): WeatherType {
    return this.currentWeather;
  }

  getTimeOfDay(): number {
    return this.timeOfDay;
  }

  getTimeString(): string {
    const hours = Math.floor(this.timeOfDay * 24);
    const minutes = Math.floor((this.timeOfDay * 24 - hours) * 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }

  dispose(): void {
    if (this.particles) {
      this.scene.remove(this.particles);
      this.particles.geometry.dispose();
      (this.particles.material as THREE.Material).dispose();
    }
  }
}
