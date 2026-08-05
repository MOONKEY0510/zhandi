/**
 * Rapier WASM 延迟加载（阶段 9 P0：Rapier WASM 延迟加载；菜单不阻塞下载物理包）。
 *
 * 问题：生产代码静态 `import RAPIER from '@dimforge/rapier3d-compat'` 会把 rapier
 * JS 包装层打进主 bundle，且 WASM 只在 RAPIER.init() 时才下载——调用时机与游戏
 * 启动耦合。
 *
 * 方案：动态 `import()` 让 vite 把 rapier 拆成独立 chunk（首屏菜单不加载）；
 * `ensureRapierLoaded()` 在首次需要物理时（进入游戏世界）才拉取模块并 init WASM；
 * promise 单例去重并发调用；失败自动重置允许重试。测试可注入 fake loader。
 *
 * 注意：本文件不 import 任何 rapier 符号（连类型也不 import），保持纯加载器职责。
 */

export type RapierModule = typeof import('@dimforge/rapier3d-compat').default;

let rapierModule: RapierModule | null = null;
let loadPromise: Promise<RapierModule> | null = null;

type Loader = () => Promise<RapierModule>;

function defaultLoader(): Promise<RapierModule> {
  return import('@dimforge/rapier3d-compat');
}

/**
 * 确保 Rapier 已加载（动态拉取模块 + 初始化 WASM）。
 * 并发调用共享同一 promise；失败后重置，下次调用可重试。
 * loader 可注入（测试用 fake 模块，避免真实 WASM 环境）。
 */
export function ensureRapierLoaded(loader?: Loader): Promise<RapierModule> {
  if (rapierModule) return Promise.resolve(rapierModule);
  if (!loadPromise) {
    loadPromise = (async () => {
      const mod = await (loader ?? defaultLoader)();
      await mod.init();
      rapierModule = mod;
      return mod;
    })();
    loadPromise.catch(() => {
      loadPromise = null;
    });
  }
  return loadPromise;
}

/** 同步获取 Rapier 模块；未加载时抛错（防御误用，调用方应先 ensureRapierLoaded）。 */
export function getRapier(): RapierModule {
  if (!rapierModule) {
    throw new Error('Rapier 尚未加载：请先 await ensureRapierLoaded()');
  }
  return rapierModule;
}

export function isRapierLoaded(): boolean {
  return rapierModule !== null;
}

/** 仅测试用：清空缓存状态，便于隔离用例。 */
export function resetRapierLoaderForTest(): void {
  rapierModule = null;
  loadPromise = null;
}
