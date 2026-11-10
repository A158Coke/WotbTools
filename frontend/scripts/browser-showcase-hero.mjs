/**
 * ShowcaseHero 紧凑横幅 computed-style 门禁（真实浏览器，不是源码正则 / inline CSS 变量断言）。
 *
 * 锁定的 invariant（2026-11-10 PR #941 review F1）：
 * - 桌面 compact 分区主视觉使用 section-scrim + compactPosition（replay 50% / techtree 58%）；
 * - 手机断点（width < 768px）compact 恢复 portrait 分区遮罩 + mobilePosition——
 *   桌面 compact 覆盖规则与手机规则同优先级、靠媒体查询内更晚声明获胜，这里用 computed style 证明；
 * - Replay compact 桌面高度放宽到 clamp(132px, 20vw, 384px)，矮窗口（height < 700px）回退默认密度；
 * - 非 Replay compact（techtree / admin）保持 132px 密度；
 * - 冬季 portrait 遮罩实际生效（浅色 rgba(238 243 248 / …)，非深色主题遮罩）；
 * - 无 section 的普通 ShowcaseHero 不注入分区遮罩层。
 */
import assert from 'node:assert/strict'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'

// 冬季竖屏分区遮罩的三处停靠点（Chrome computed style 归一化为 rgba(...)）。
// 必须逐一断言完整 opacity：只查 RGB 的话旧遮罩（.97/.86/.24）与新遮罩（.84/.52/.10）都会命中。
// 冬季竖屏遮罩已几乎全撤（.15 → 0），标题可读性由 --theme-hero-text-veil 玻璃底板承担；
// 旧遮罩（.97/.86/.24）不含这两个停靠点，负向可捕获泛白回归。
const WINTER_PORTRAIT_STOPS = ['rgba(238, 243, 248, 0.15)', 'rgba(238, 243, 248, 0)']
const WINTER_TITLE_COLOR = 'rgb(242, 247, 251)'

/** 页面内探针：取紧凑横幅的 computed style 与几何（Page.probe 会序列化，不能引用模块作用域）。 */
function heroProbe() {
  const host = document.querySelector('.showcase-hero-host.is-compact-host') ?? document.querySelector('.showcase-hero-host')
  const section = host?.querySelector('.showcase-hero')
  const art = section?.querySelector('.showcase-hero-art')
  if (!section || !art) return null
  const cs = getComputedStyle(art)
  // backgroundImage 不做拆分：linear-gradient 内部的逗号会被顶层 split 打碎，
  // 遮罩断言必须基于完整 computed 值（多个停靠点逐一比对）。
  const positions = cs.backgroundPosition.split(',').map(s => s.trim())
  const rect = section.getBoundingClientRect()
  return {
    section: section.dataset.section ?? null,
    compact: section.classList.contains('is-compact'),
    height: Math.round(rect.height),
    width: Math.round(rect.width),
    backgroundImage: cs.backgroundImage,
    imagePosition: positions[1] ?? null,
    backgroundSize: cs.backgroundSize.split(',').map(s => s.trim())[1] ?? null,
    titleColor: getComputedStyle(section.querySelector('h1')).color,


    titleBottom: Math.round(section.querySelector('h1').getBoundingClientRect().bottom),
    heroBottom: Math.round(rect.bottom),
  }
}

/** 完整档 Hero 探针：额外取 description 颜色（冬季手机端全档文字可读性门禁用）。 */
function fullHeroProbe() {
  const section = document.querySelector('.showcase-hero')
  const h1 = section?.querySelector('h1')
  const description = section?.querySelector('.showcase-hero-description')
  if (!section || !h1) return null
  return {
    section: section.dataset.section ?? null,
    compact: section.classList.contains('is-compact'),
    titleColor: getComputedStyle(h1).color,
    descriptionColor: description ? getComputedStyle(description).color : null,
  }
}

function assertDesktopCompact(hero, { section, position }) {
  assert.equal(hero.section, section, `desktop ${section} must use its section hero`)
  assert.ok(hero.compact, `desktop ${section} must render compact`)
  assert.match(hero.backgroundImage, /linear-gradient/, `desktop ${section} scrim must be the section scrim gradient`)
  assert.equal(hero.imagePosition, position, `desktop ${section} compact focus must be ${position}`)
  assert.equal(hero.backgroundSize, 'cover', `desktop ${section} must keep cover (no distortion)`)
  assert.ok(hero.titleBottom <= hero.heroBottom, `desktop ${section} title must stay inside the banner`)
}

function assertMobileCompact(hero, { section, position }) {
  assert.equal(hero.section, section, `mobile ${section} must use its section hero`)
  assert.ok(hero.compact, `mobile ${section} must render compact`)
  assert.equal(hero.imagePosition, position, `mobile ${section} must fall back to mobilePosition ${position}`)
  assert.equal(hero.backgroundSize, 'cover', `mobile ${section} must keep cover`)
}

const { server, origin } = await startFixtureServer()
let chrome
try {
  chrome = await launchChromeForCdp(findChrome())

  async function openAppPage({ width, height = 900, profile = 'summer', view, extraAuth = '' }) {
    const { targetId, sessionId } = await chrome.openPage()
    const page = new Page(chrome.client, sessionId)
    await page.enable()
    await page.emulate({ width, height, touch: width < 1200 })
    await chrome.client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `localStorage.setItem('wotb-ui-profile', ${JSON.stringify(profile)}); localStorage.setItem('wotb-lang', 'zh');`,
    }, sessionId)
    await chrome.client.send('Page.navigate', { url: `${origin}/?view=${view}${extraAuth}` }, sessionId)
    await page.waitForValue('document.readyState', value => value === 'complete', { timeout: 90_000, label: 'application modules loaded' })
    await page.waitForValue(`!!document.querySelector('[data-testid="showcase-hero"]')`, value => value === true, { timeout: 90_000, label: `showcase hero on ${view}` })
    return { targetId, page }
  }

  // 桌面：Replay 放宽、TechTree/Admin 保持默认密度、compactPosition 生效。
  for (const [view, extraAuth, section, position] of [
    ['replay', '', 'replay', '50% 50%'],
    ['agent-techtree', '', 'techtree', '50% 58%'],
    ['admin-users', '&ws-auth=1&ws-roles=wotbtools-admin', 'admin', '50% 45%'],
  ]) {
    const { targetId, page } = await openAppPage({ width: 1440, view, extraAuth })
    try {
      const hero = await page.probe(heroProbe)
      assertDesktopCompact(hero, { section, position })
      const [lo, hi] = section === 'replay' ? [240, 400] : [120, 140]
      assert.ok(hero.height >= lo && hero.height <= hi, `desktop ${section} hero height must stay ${lo}-${hi}px at 1440: ${hero.height}`)
      console.log(`[browser-showcase-hero] desktop ${section}: height=${hero.height} pos=${hero.imagePosition} scrim=${hero.backgroundImage.slice(0, 48)}… passed`)
    } catch (error) {
      console.error(await page.diagnose(heroProbe))
      throw error
    } finally { await chrome.client.send('Target.closeTarget', { targetId }) }
  }

  // 桌面 → 手机断点切换（同一场景先后断言，证明媒体查询层叠）：手机恢复 portrait 遮罩 + mobilePosition。
  for (const [view, extraAuth, section, mobilePosition, heightLo, heightHi] of [
    ['replay', '', 'replay', '45% 50%', 88, 112],
    ['agent-techtree', '', 'techtree', '42% 50%', 88, 112],
    ['admin-users', '&ws-auth=1&ws-roles=wotbtools-admin', 'admin', '40% 50%', 88, 112],
  ]) {
    const { targetId, page } = await openAppPage({ width: 1440, view, extraAuth })
    try {
      const desktop = await page.probe(heroProbe)
      assertDesktopCompact(desktop, { section, position: section === 'replay' ? '50% 50%' : section === 'techtree' ? '50% 58%' : '50% 45%' })
      await page.emulate({ width: 390, height: 844, touch: true })
      await page.waitForValue(`window.innerWidth`, value => value === 390, { timeout: 20_000, label: 'mobile viewport applied' })
      const mobile = await page.probe(heroProbe)
      assertMobileCompact(mobile, { section, position: mobilePosition })
      assert.ok(mobile.height >= heightLo && mobile.height <= heightHi, `mobile ${section} hero height must stay ${heightLo}-${heightHi}px: ${mobile.height}`)
      // 冬季 portrait 遮罩实际生效：两处停靠点（.15 → 0）逐一比对（完整 backgroundImage，不拆层）——
      // 旧遮罩 .97/.86/.24 不含这两个停靠点，负向可捕获泛白回归。
      await page.evaluate(`localStorage.setItem('wotb-ui-profile', 'winter'); document.documentElement.setAttribute('data-ui-profile', 'winter'); document.documentElement.setAttribute('data-theme', 'light')`)
      await page.waitForValue(`getComputedStyle(document.querySelector('.showcase-hero-art')).backgroundImage`, value => value.includes(WINTER_PORTRAIT_STOPS[0]), { timeout: 20_000, label: 'winter portrait scrim' })
      const winter = await page.probe(heroProbe)
      for (const stop of WINTER_PORTRAIT_STOPS) {
        assert.ok(winter.backgroundImage.includes(stop), `mobile ${section} winter portrait scrim must contain ${stop}: ${winter.backgroundImage}`)
      }
      assert.equal(winter.titleColor, WINTER_TITLE_COLOR, `mobile ${section} winter title must switch to white: ${winter.titleColor}`)
      console.log(`[browser-showcase-hero] breakpoint ${section}: desktop pos=${desktop.imagePosition} → mobile pos=${mobile.imagePosition} height=${mobile.height}, winter scrim stops ok passed`)
    } catch (error) {
      console.error(await page.diagnose(heroProbe))
      throw error
    } finally { await chrome.client.send('Target.closeTarget', { targetId }) }
  }

  // Replay 矮桌面窗口降级：height < 700px 回退默认密度，横幅不把工作区压到不可用。
  {
    const { targetId, page } = await openAppPage({ width: 1920, height: 540, view: 'replay' })
    try {
      const hero = await page.probe(heroProbe)
      assert.ok(hero.height >= 120 && hero.height <= 140, `replay hero must fall back to compact density in short windows: ${hero.height}`)
      assert.ok(hero.titleBottom <= hero.heroBottom, 'replay title must stay inside the degraded banner')
      console.log(`[browser-showcase-hero] short-window replay: height=${hero.height} at 1920x540 passed`)
    } finally { await chrome.client.send('Target.closeTarget', { targetId }) }
  }

  // 冬季手机端完整档 Hero（ContactPage 同构）：遮罩几乎全撤后 description / kicker / 标题
  // 必须切浅色，且文字区域的实测像素对比度 ≥ 4.5:1（不只查 computed color）。
  {
    const { targetId, page } = await openAppPage({ width: 390, height: 844, profile: 'winter', view: 'contact' })
    try {
      const hero = await page.probe(fullHeroProbe)
      assert.equal(hero.descriptionColor, 'rgb(216, 230, 244)', `winter full hero description must switch to light: ${hero.descriptionColor}`)
      assert.equal(hero.titleColor, WINTER_TITLE_COLOR, `winter full hero title must switch to white: ${hero.titleColor}`)
      // 像素级验收：截图说明文字矩形，取背景亮度 p90（排除字形墨水）计算对比度。
      const rect = await page.evaluate(`(() => { const el = document.querySelector('.showcase-hero-description'); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
      const { data } = await chrome.client.send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 2 } }, page.sessionId)
      const { default: sharp } = await import('sharp')
      const { info, data: raw } = await sharp(Buffer.from(data, 'base64')).raw().toBuffer({ resolveWithObject: true })
      const lums = []
      for (let i = 0; i < raw.length; i += info.channels) lums.push((0.2126 * raw[i] + 0.7152 * raw[i + 1] + 0.0722 * raw[i + 2]) / 255)
      lums.sort((a, b) => a - b)
      const rel = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
      const t = [216 / 255, 230 / 255, 244 / 255].map(rel)
      const textLum = 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2]
      const bgLum = rel(lums[Math.floor(lums.length * 0.1)]) // 浅字深底：背景取暗分位（排除字形亮墨水）
      const ratio = (Math.max(bgLum, textLum) + 0.05) / (Math.min(bgLum, textLum) + 0.05)
      assert.ok(ratio >= 4.5, `winter full hero description contrast must be >= 4.5:1: ${ratio.toFixed(2)}:1`)
      console.log(`[browser-showcase-hero] winter full hero (contact 390x844): description light + pixel contrast ${ratio.toFixed(2)}:1 passed`)
    } finally { await chrome.client.send('Target.closeTarget', { targetId }) }
  }


  // 无 section 的普通 ShowcaseHero 由 ShowcaseHero.test.ts 覆盖（无公开非分区页面可直达）。

  console.log('[browser-showcase-hero] all scenarios passed')
} finally {
  if (chrome) await chrome.close()
  await server.close()
}
