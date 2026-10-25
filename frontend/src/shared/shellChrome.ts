import type { InjectionKey, Ref } from 'vue'

/**
 * App shell chrome (top bar / bottom tab bar) visibility contract. AppShell owns the state and the
 * `--header-h` / `--tabbar-h` collapse; a feature that needs the whole viewport height (phone
 * landscape Replay Workspace) requests immersion through its own owner token and releases it when
 * the need ends. The shell stays immersive while at least one owner is requesting it.
 */
export interface ShellChrome {
  readonly immersive: Readonly<Ref<boolean>>
  request(owner: symbol, on: boolean): void
}

export const SHELL_CHROME_KEY: InjectionKey<ShellChrome> = Symbol('wotbtools.shell-chrome')
