/**
 * Battle Data 出生侧胜率分段条浏览器门禁（真实浏览器 computed style，不是源码正则）。
 *
 * 锁定的 invariant（物理出生侧语义，四季固定）：
 * - .spawn-seg.is-first = --color-danger（红，NORTH / WEST）；.is-draw = --color-border-strong（中性灰）；
 *   .is-second = --color-info（蓝，SOUTH / EAST）；不随主题 accent 漂移；
 * - .spawn-bar：track = --color-surface-3、1px --color-border-strong 实边框、条高 12px（--space-3）；
 * - 三段宽度比例与样本数一致（first 70 / draw 5 / second 53，共 128）；
 * - 文档与表格容器无横向溢出（中 / 英 / 俄三种 locale 下布局不变）。
 *
 * 复用 fixture-server.mjs（真实 Vite 应用 + auth stub），admin API 用确定性夹具；
 * 四季主题经 wotb-ui-profile 持久化 key 切换后重载，取真实层叠后的 computed style。
 */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
import { dirname } from 'node:path'
const SCREENSHOT_DIR = resolve(HERE, '../../tmp/battle-data-spawn-bar')

const stat = (mapKey, arenaBonusType, side, wins, draws, losses) => ({ mapKey, arenaBonusType, side, battles: wins + draws + losses, wins, draws, losses })
const summary = {
  asOf: '2026-11-10T00:00:00Z', totalBattles: 128, last24Hours: 128, last7Days: 128, last30Days: 128, windowBattles: 128,
  latestReceivedAt: '2026-11-10T00:00:00Z', distinctMaps: 1, distinctClientVersions: 1,
  modes: [{ key: 0, count: 128 }], winnerTeams: [{ key: 1, count: 70 }], schemaVersions: [{ key: 1, count: 128 }], daily: [],
  maps: [{ key: 'erlenberg', count: 128, latestReceivedAt: '2026-11-10T00:00:00Z' }], clientVersions: [],
  spawnStats: [stat('erlenberg', null, 'NORTH', 70, 5, 53), stat('erlenberg', null, 'SOUTH', 53, 5, 70)],
}
const battle = { id: '1', arenaId: '18446744073709551615', schemaVersion: 1, arenaBonusType: 1, mapId: 1, mapKey: 'erlenberg', clientVersion: '11.18', winnerTeam: 1, team1Spawn: 'NORTH', team2Spawn: 'SOUTH', receivedAt: '2026-11-10T00:00:00Z' }
const vehicles = Array.from({ length: 14 }, (_, i) => ({ team: i < 7 ? 1 : 2, spawn: i < 7 ? 'NORTH' : 'SOUTH', slot: i % 7, vehicleId: 10 + i }))

function adminMiddleware(request, response, next) {
  const path = request.url?.split('?')[0]
  if (request.method !== 'GET' || !path.startsWith('/api/admin/battle-data/')) { next(); return }
  response.setHeader('Content-Type', 'application/json')
  if (path === '/api/admin/battle-data/summary') response.end(JSON.stringify(summary))
  else if (path === '/api/admin/battle-data/battles') response.end(JSON.stringify({ items: [battle], nextCursor: null }))
  else response.end(JSON.stringify({ battle, vehicles }))
}

/** 页面内探针：token 值 + 第一条 spawn bar 的真实 computed style 与几何。 */
function spawnBarProbe() {
  const style = (selector, properties) => {
    const element = document.querySelector(selector)
    if (!element) return null
    const computed = getComputedStyle(element)
    return Object.fromEntries(properties.map(property => [property, computed[property]]))
  }
  const bar = document.querySelector('[data-testid=spawn-stats] .spawn-bar')
  const rects = bar ? [...bar.querySelectorAll('.spawn-seg')].map(segment => segment.getBoundingClientRect().width) : []
  return {
    tokens: {
      danger: getComputedStyle(document.documentElement).getPropertyValue('--color-danger').trim(),
      info: getComputedStyle(document.documentElement).getPropertyValue('--color-info').trim(),
      borderStrong: getComputedStyle(document.documentElement).getPropertyValue('--color-border-strong').trim(),
      surface3: getComputedStyle(document.documentElement).getPropertyValue('--color-surface-3').trim(),
    },
    first: style('.spawn-seg.is-first', ['backgroundColor']),
    draw: style('.spawn-seg.is-draw', ['backgroundColor']),
    second: style('.spawn-seg.is-second', ['backgroundColor']),
    bar: style('.spawn-bar', ['backgroundColor', 'borderColor', 'borderWidth', 'borderStyle', 'blockSize', 'height']),
    ariaLabel: bar?.getAttribute('aria-label') ?? null,
    segWidths: rects,
    barWidth: bar?.getBoundingClientRect().width ?? 0,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    lang: document.documentElement.lang,
  }
}

const hexToRgb = (hex) => {
  const value = hex.replace('#', '')
  return `rgb(${[0, 2, 4].map(offset => parseInt(value.slice(offset, offset + 2), 16)).join(', ')})`
}
const check = (failures, ok, message) => { if (!ok) failures.push(message) }
const THEME_KEY = 'wotb-ui-profile'

async function runTheme(env, theme) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  await page.enable()
  try {
    // 主题是启动时从 localStorage 投影到 <html data-ui-profile> 的：先种 key，再带 view 参数进入页面。
    await page.goto(`${env.origin}/`)
    await page.evaluate(`localStorage.setItem(${JSON.stringify(THEME_KEY)}, ${JSON.stringify(theme)}); localStorage.setItem('wotb-lang', 'en')`)
    await page.goto(`${env.origin}/?view=admin-battle-data&ws-auth=1&ws-roles=wotbtools-admin&ws-auth-init=resolve-authenticated`)
    const state = await page.waitForValue(`(${spawnBarProbe.toString()})()`, probe => Boolean(probe?.first && probe.segWidths.length === 3), { label: `${theme}: spawn bar rendered` })
    const tokens = state.tokens
    check(failures, state.first.backgroundColor === hexToRgb(tokens.danger), `${theme}: first seg must be danger(${tokens.danger}) got ${state.first.backgroundColor}`)
    check(failures, state.draw.backgroundColor === hexToRgb(tokens.borderStrong), `${theme}: draw seg must be border-strong(${tokens.borderStrong}) got ${state.draw.backgroundColor}`)
    check(failures, state.second.backgroundColor === hexToRgb(tokens.info), `${theme}: second seg must be info(${tokens.info}) got ${state.second.backgroundColor}`)
    check(failures, state.bar.backgroundColor === hexToRgb(tokens.surface3), `${theme}: track must be surface-3(${tokens.surface3}) got ${state.bar.backgroundColor}`)
    check(failures, state.bar.borderColor === hexToRgb(tokens.borderStrong), `${theme}: border must be border-strong got ${state.bar.borderColor}`)
    check(failures, state.bar.borderWidth === '1px' && state.bar.borderStyle === 'solid', `${theme}: border must be 1px solid got ${state.bar.borderWidth} ${state.bar.borderStyle}`)
    const height = parseFloat(state.bar.height)
    check(failures, Math.abs(height - 12) <= 0.5, `${theme}: bar height must stay 12px got ${state.bar.height}`)
    // 三段比例：70 / 5 / 53，共 128。
    const total = state.segWidths.reduce((sum, width) => sum + width, 0)
    const expected = [70 / 128, 5 / 128, 53 / 128]
    expected.forEach((share, index) => {
      const actual = state.segWidths[index] / state.barWidth
      check(failures, Math.abs(actual - share) < 0.01, `${theme}: seg ${index} width ${(actual * 100).toFixed(1)}% must be ${(share * 100).toFixed(1)}%`)
    })
    // border-box：三段填满的是内容盒（barWidth − 左右 1px 边框）。
    check(failures, Math.abs(total - (state.barWidth - 2)) < 1.5, `${theme}: three segments must fill the bar content box (${total.toFixed(1)} vs ${(state.barWidth - 2).toFixed(1)})`)
    check(failures, (state.ariaLabel || '').includes('North'), `${theme}: aria label must name the physical spawn side got ${state.ariaLabel}`)
    check(failures, state.overflowX === false, `${theme}: document must not gain horizontal overflow`)
    // 截图前把 spawn 表滚进视口，让分段条真实入镜。
    await page.evaluate('document.querySelector(\'[data-testid=spawn-stats] .spawn-bar\')?.scrollIntoView({ block: \'center\' })')
    await page.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    const { data } = await env.chrome.client.send('Page.captureScreenshot', { format: 'png' }, sessionId)
    await mkdir(SCREENSHOT_DIR, { recursive: true })
    const file = join(SCREENSHOT_DIR, `${theme}.png`)
    await writeFile(file, Buffer.from(data, 'base64'))
    console.log(`[browser-battle-data] screenshot ${file}`)
  } finally {
    await env.chrome.client.send('Target.closeTarget', { targetId })
  }
  return failures
}

/** 俄文 locale 下重开一次（冬季浅色主题）：确认长译名不破坏条形布局。 */
async function runRussianWinter(env) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  await page.enable()
  try {
    await page.goto(`${env.origin}/`)
    await page.evaluate(`localStorage.setItem(${JSON.stringify(THEME_KEY)}, 'winter'); localStorage.setItem('wotb-lang', 'ru')`)
    await page.goto(`${env.origin}/?view=admin-battle-data&ws-auth=1&ws-roles=wotbtools-admin&ws-auth-init=resolve-authenticated`)
    const state = await page.waitForValue(`(${spawnBarProbe.toString()})()`, probe => Boolean(probe?.first), { label: 'ru winter: spawn bar rendered' })
    check(failures, state.lang === 'ru', `ru winter: document lang must be ru got ${state.lang}`)
    check(failures, state.overflowX === false, 'ru winter: document must not gain horizontal overflow')
    check(failures, state.first.backgroundColor === state.tokens.danger.startsWith('#') ? hexToRgb(state.tokens.danger) : state.first.backgroundColor, 'ru winter: first seg mapping must not change')
  } finally {
    await env.chrome.client.send('Target.closeTarget', { targetId })
  }
  return failures
}

/* ------------------------------------------------------------------ main */

const chromeBinary = findChrome()
const { server, origin } = await startFixtureServer({ middleware: adminMiddleware })
let chromeCdp = null
const results = []
try {
  chromeCdp = await launchChromeForCdp(chromeBinary, {
    extraArgs: ['--window-size=1440,900', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
  })
  const env = { origin, chrome: chromeCdp }
  for (const theme of ['spring', 'summer', 'autumn', 'winter']) {
    try {
      results.push({ name: theme, failures: await runTheme(env, theme) })
    } catch (error) {
      results.push({ name: theme, failures: [error.message] })
    }
  }
  try {
    results.push({ name: 'winter-ru', failures: await runRussianWinter(env) })
  } catch (error) {
    results.push({ name: 'winter-ru', failures: [error.message] })
  }
} finally {
  if (chromeCdp) await chromeCdp.close()
  await server.close()
}

let failed = 0
for (const result of results) {
  if (result.failures.length === 0) {
    console.log(`[browser-battle-data] ${result.name} OK`)
    continue
  }
  failed += 1
  console.error(`[browser-battle-data] ${result.name} FAILED`)
  for (const failure of result.failures) console.error(`  - ${failure}`)
}
if (failed > 0) {
  process.exitCode = 1
  console.error(`[browser-battle-data] ${failed}/${results.length} scenarios failed`)
} else {
  console.log(`[browser-battle-data] all ${results.length} scenarios passed`)
}
