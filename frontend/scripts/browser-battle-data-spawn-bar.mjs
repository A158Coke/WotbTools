import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { createBattleDataFixture } from './browser-fixtures/battle-data.mjs'
import { verifyBattleFilters } from './browser-battle-data-filters.mjs'
import { Page } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
import { dirname } from 'node:path'
const SCREENSHOT_DIR = resolve(HERE, '../../tmp/battle-data-spawn-bar')

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
    uiProfile: document.documentElement.dataset.uiProfile ?? null,
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
    await page.goto(`${env.origin}/`)
    await page.evaluate(`localStorage.setItem(${JSON.stringify(THEME_KEY)}, ${JSON.stringify(theme)}); localStorage.setItem('wotb-lang', 'en')`)
    await page.goto(`${env.origin}/?view=admin-battle-data&ws-auth=1&ws-roles=wotbtools-admin&ws-auth-init=resolve-authenticated`)
    const state = await page.waitForValue(`(${spawnBarProbe.toString()})()`, probe => Boolean(probe?.first && probe.segWidths.length === 3), { label: `${theme}: spawn bar rendered` })
    check(failures, state.uiProfile === theme, `${theme}: page must render data-ui-profile=${theme} got ${state.uiProfile}`)
    const tokens = state.tokens
    check(failures, state.first.backgroundColor === hexToRgb(tokens.danger), `${theme}: first seg must be danger(${tokens.danger}) got ${state.first.backgroundColor}`)
    check(failures, state.draw.backgroundColor === hexToRgb(tokens.borderStrong), `${theme}: draw seg must be border-strong(${tokens.borderStrong}) got ${state.draw.backgroundColor}`)
    check(failures, state.second.backgroundColor === hexToRgb(tokens.info), `${theme}: second seg must be info(${tokens.info}) got ${state.second.backgroundColor}`)
    check(failures, state.bar.backgroundColor === hexToRgb(tokens.surface3), `${theme}: track must be surface-3(${tokens.surface3}) got ${state.bar.backgroundColor}`)
    check(failures, state.bar.borderColor === hexToRgb(tokens.borderStrong), `${theme}: border must be border-strong got ${state.bar.borderColor}`)
    check(failures, state.bar.borderWidth === '1px' && state.bar.borderStyle === 'solid', `${theme}: border must be 1px solid got ${state.bar.borderWidth} ${state.bar.borderStyle}`)
    const height = parseFloat(state.bar.height)
    check(failures, Math.abs(height - 12) <= 0.5, `${theme}: bar height must stay 12px got ${state.bar.height}`)
    const total = state.segWidths.reduce((sum, width) => sum + width, 0)
    const expected = [70 / 128, 5 / 128, 53 / 128]
    expected.forEach((share, index) => {
      const actual = state.segWidths[index] / state.barWidth
      check(failures, Math.abs(actual - share) < 0.01, `${theme}: seg ${index} width ${(actual * 100).toFixed(1)}% must be ${(share * 100).toFixed(1)}%`)
    })
    check(failures, Math.abs(total - (state.barWidth - 2)) < 1.5, `${theme}: three segments must fill the bar content box (${total.toFixed(1)} vs ${(state.barWidth - 2).toFixed(1)})`)
    check(failures, (state.ariaLabel || '').includes('North'), `${theme}: aria label must name the physical spawn side got ${state.ariaLabel}`)
    check(failures, state.overflowX === false, `${theme}: document must not gain horizontal overflow`)
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
    check(failures, state.uiProfile === 'winter', `ru winter: page must render data-ui-profile=winter got ${state.uiProfile}`)
    check(failures, state.overflowX === false, 'ru winter: document must not gain horizontal overflow')
    check(failures, state.first.backgroundColor === hexToRgb(state.tokens.danger), `ru winter: first seg must be danger(${state.tokens.danger}) got ${state.first.backgroundColor}`)
  } finally {
    await env.chrome.client.send('Target.closeTarget', { targetId })
  }
  return failures
}


const chromeBinary = findChrome()
const fixture = createBattleDataFixture()
const { server, origin } = await startFixtureServer({ middleware: fixture.middleware })
let chromeCdp = null
const results = []
try {
  chromeCdp = await launchChromeForCdp(chromeBinary, {
    extraArgs: ['--window-size=1440,900', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
  })
  const env = { origin, chrome: chromeCdp }
  for (const [theme, width] of [['summer', 1280], ['winter', 390], ['winter', 1280], ['summer', 390], ['spring', 900], ['autumn', 360]]) {
    const name = 'filters-' + theme + '-' + width
    try {
      await verifyBattleFilters(env, fixture, theme, width, SCREENSHOT_DIR)
      results.push({ name, failures: [] })
    } catch (error) { results.push({ name, failures: [error.message] }) }
  }
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
