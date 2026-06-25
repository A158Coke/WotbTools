export const THEME_KEY = 'wotbtools-theme'

const THEME_COOKIE = new RegExp('(?:^|;\\s*)' + THEME_KEY + '=([^;]+)')

export function readTheme() {
  // cookie 优先（跨子域名共享），localStorage 回退（本地开发）
  const m = document.cookie.match(THEME_COOKIE)
  return m ? m[1] : localStorage.getItem(THEME_KEY)
}

export function saveTheme(value) {
  document.cookie = THEME_KEY + '=' + value + '; path=/; domain=.wotbtools.com; max-age=31536000; SameSite=Lax'
  try { localStorage.setItem(THEME_KEY, value) } catch (_) { /* quota / private mode */ }
}

export function resolveTheme(saved) {
  if (!saved || saved === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return saved
}

export function applyTheme(value) {
  document.documentElement.setAttribute('data-theme', resolveTheme(value))
}
