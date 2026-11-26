import type { InjectionKey, Ref } from 'vue'

export interface ShellChrome {
  readonly immersive: Readonly<Ref<boolean>>
  request(owner: symbol, on: boolean): void
  readonly navHosted: Readonly<Ref<boolean>>
  hostNav(owner: symbol, on: boolean): void
}

export type OpenNavDrawer = (opener?: HTMLElement | null) => void
export const OPEN_NAV_DRAWER_KEY: InjectionKey<OpenNavDrawer> = Symbol('wotbtools.open-nav-drawer')

export const SHELL_CHROME_KEY: InjectionKey<ShellChrome> = Symbol('wotbtools.shell-chrome')
