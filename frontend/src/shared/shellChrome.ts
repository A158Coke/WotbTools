import type { InjectionKey, Ref } from 'vue'

/**
 * App shell chrome (drawer-shell top bar) visibility contract. AppShell owns the state and the
 * `--header-block` / `--header-h` collapse; a feature that needs the whole viewport height (phone
 * landscape Replay Workspace) requests immersion through its own owner token and releases it when
 * the need ends. The shell stays immersive while at least one owner is requesting it.
 */
export interface ShellChrome {
  readonly immersive: Readonly<Ref<boolean>>
  request(owner: symbol, on: boolean): void
  /**
   * 沉浸态的菜单入口（design-language §9「强制横屏」：无顶栏，保留菜单）默认是外壳左上的悬浮按钮；
   * 场景自己的控制条能放下这个入口时由它承载（如回放传输条），外壳就不再叠一个悬浮按钮。
   */
  readonly navHosted: Readonly<Ref<boolean>>
  hostNav(owner: symbol, on: boolean): void
}

/** 打开左侧导航抽屉（AppShell 拥有抽屉）；参数是关闭后焦点要回到的元素。 */
export type OpenNavDrawer = (opener?: HTMLElement | null) => void
export const OPEN_NAV_DRAWER_KEY: InjectionKey<OpenNavDrawer> = Symbol('wotbtools.open-nav-drawer')

export const SHELL_CHROME_KEY: InjectionKey<ShellChrome> = Symbol('wotbtools.shell-chrome')
