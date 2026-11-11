/**
 * ShowcaseHero 紧凑横幅 computed-style 门禁（真实浏览器，不是源码正则 / inline CSS 变量断言）。
 *
 * 锁定的 invariant（2026-11-10 PR #941 review F1）：
 * - 桌面 compact 分区主视觉使用 section-scrim + compactPosition（replay 50% / techtree 58%）；
 * - 手机断点（width < 768px）compact 恢复 portrait 分区遮罩 + mobilePosition——
 *   桌面 compact 覆盖规则与手机规则同优先级、靠媒体查询内更晚声明获胜，这里用 computed style 证明；
 * - Replay compact 桌面高度放宽到 clamp(132px, 20vw, 384px)，矮窗口（height < 700px）回退默认密度；
 * - 非 Replay compact（techtree / admin）保持 132px 密度；
 * - Full 档统一响应式高度：桌面 1440 用 clamp(240px, 20vw, 384px) 保主体完整带（与 Replay 同族），
 *   矮桌面窗口（height < 700px）回退内容密度，手机断点不参与（portrait 焦点可见带已足够）；
 * - 冬季 portrait 遮罩实际生效（浅色 rgba(238 243 248 / …)，非深色主题遮罩）；
 * - 无 section 的普通 ShowcaseHero 不注入分区遮罩层。
 */
import assert from 'node:assert/strict'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'

// 冬季竖屏分区遮罩已几乎全撤：两处停靠点（.15 → 0，Chrome computed style 归一化为 rgba(...)）。
// 完整 backgroundImage 逐一比对完整 opacity——旧遮罩（.97/.86/.24）不含这两个停靠点，
// 负向可捕获泛白回归；标题可读性由手机断点的浅色文字 + 深色描边承担（无玻璃底板）。
const WINTER_PORTRAIT_STOPS = ['rgba(238, 243, 248, 0.15)', 'rgba(238, 243, 248, 0)']
const WINTER_TITLE_COLOR = 'rgb(242, 247, 251)'

// sRGB 逐通道线性化后的相对亮度（WCAG）。
function relativeLuminance([r, g, b]) {
  const rel = c => (c /= 255) <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  return 0.2126 * rel(r) + 0.7152 * rel(g) + 0.0722 * rel(b)
}

// 纯背景像素中对比度 ≥ 4.5:1 的面积占比（浅色文字对不利亮背景的确定性检查）。
function backgroundContrastFraction(raw, channels, textLum) {
  let pass = 0
  let total = 0
  for (let i = 0; i < raw.length; i += channels) {
    const bgLum = relativeLuminance([raw[i], raw[i + 1], raw[i + 2]])
    if ((Math.max(bgLum, textLum) + 0.05) / (Math.min(bgLum, textLum) + 0.05) >= 4.5) pass += 1
    total += 1
  }
  return total ? pass / total : 0
}

// 负向自检：11% 黑 + 89% 白的背景（浅色文字）必须不达标——防止检查退化成
// 只看最暗分位的漏检。此断言在每次运行时确定性执行。
{
  const white = [255, 255, 255]
  const black = [0, 0, 0]
  const mixed = []
  for (let i = 0; i < 1000; i++) mixed.push(...(i % 9 === 0 ? black : white))
  const fraction = backgroundContrastFraction(mixed, 3, relativeLuminance([216, 230, 244]))
  assert.ok(fraction < 0.9, `contrast self-test must reject a mostly-white background: ${(fraction * 100).toFixed(1)}%`)
  const dark = []
  for (let i = 0; i < 3000; i++) dark.push(...[10, 14, 20])
  assert.equal(backgroundContrastFraction(dark, 3, relativeLuminance([216, 230, 244])), 1, 'contrast self-test must accept a uniformly dark background')
}

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

/** 完整档 Hero 探针：额外取 description / stat 标签颜色（冬季手机端全档文字可读性门禁用）。 */
function fullHeroProbe() {
  const section = document.querySelector('.showcase-hero')
  const h1 = section?.querySelector('h1')
  const description = section?.querySelector('.showcase-hero-description')
  const statsLabel = section?.querySelector('.showcase-hero-stats span')
  if (!section || !h1) return null
  return {
    section: section.dataset.section ?? null,
    compact: section.classList.contains('is-compact'),
    titleColor: getComputedStyle(h1).color,
    descriptionColor: description ? getComputedStyle(description).color : null,
    descriptionShadow: description ? getComputedStyle(description).textShadow : null,
    statsLabelColor: statsLabel ? getComputedStyle(statsLabel).color : null,
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

  // Full 档统一响应式高度（Replay 同族 clamp 推广）：真实渲染断言，不是 CSS 字符串。
  // league-broadcasts 是纯标题页（内容只撑出 ~123px，可见带 19%，主体被裁成炮管碎片），
  // 是该策略的目标场景；hof 自带 stats/actions（内容 ~249px），验证 clamp 不压内容；
  // tournament-points 带说明 + 操作按钮，验证第三种完整档形态。
  const fullTextProbe = () => {
    const section = document.querySelector('.showcase-hero')
    if (!section) return null
    const pick = sel => {
      const el = section.querySelector(sel)
      return el ? Math.round(el.getBoundingClientRect().height) : null
    }
    return {
      kickerH: pick('.showcase-hero-kicker'),
      titleH: pick('h1'),
      descriptionH: pick('.showcase-hero-description'),
      textH: Math.round(section.querySelector('.showcase-hero-text')?.getBoundingClientRect().height ?? 0),
      contentH: Math.round(section.querySelector('.showcase-hero-content')?.getBoundingClientRect().height ?? 0),
    }
  }
  for (const [view, extraAuth] of [['league-broadcasts', ''], ['hof', ''], ['tournament-points', '']]) {
    const { targetId, page } = await openAppPage({ width: 1440, view, extraAuth })
    try {
      const probe = heroProbe
      const desktop = await page.probe(probe)
      assert.ok(!desktop.compact, `desktop full hero on ${view} must not be compact`)
      // 1440 下 20vw = 288px（clamp 上限 384 不命中）：主体完整带 ≈45%，与 Replay 验收值一致
      assert.ok(desktop.height >= 280 && desktop.height <= 400, `desktop full hero on ${view} must take the 20vw clamp height at 1440: ${desktop.height}`)
      assert.ok(desktop.titleBottom <= desktop.heroBottom, `desktop ${view} title must stay inside the banner`)
      // min-height 加高不得把 grid auto 行拉伸成空行（review P1）：kicker/标题/说明必须保持自然行高
      const text = await page.probe(fullTextProbe)
      assert.ok(text.kickerH === null || text.kickerH <= 30, `full hero kicker on ${view} must keep its natural row height (grid rows must not stretch): ${text.kickerH}`)
      assert.ok(text.titleH <= 90, `full hero title on ${view} must keep its natural row height (grid rows must not stretch): ${text.titleH}`)
      assert.ok(text.descriptionH === null || text.descriptionH <= 60, `full hero description on ${view} must keep its natural row height: ${text.descriptionH}`)
      assert.ok(text.textH <= text.contentH, `full hero text block on ${view} must fit inside the content grid`)
      // 矮桌面窗口回退内容密度：横幅不挤压首屏
      await page.emulate({ width: 1920, height: 540, touch: false })
      await page.waitForValue(`window.innerHeight`, v => v === 540, { timeout: 20_000, label: 'short window applied' })
      const short = await page.probe(probe)
      assert.ok(short.height <= 260, `full hero on ${view} must fall back to content height in short windows: ${short.height}`)
      assert.ok(short.titleBottom <= short.heroBottom, `short-window ${view} title must stay inside the banner`)
      // 手机断点不参与：portrait 焦点可见带已足够，横幅不白白吃首屏
      await page.emulate({ width: 390, height: 844, touch: true })
      await page.waitForValue(`window.innerWidth`, v => v === 390, { timeout: 20_000, label: 'mobile viewport applied' })
      const mobile = await page.probe(probe)
      assert.ok(mobile.height <= 280, `mobile full hero on ${view} must keep the portrait density: ${mobile.height}`)
      console.log(`[browser-showcase-hero] full-hero height ${view}: desktop=${desktop.height} short=${short.height} mobile=${mobile.height} kicker=${text.kickerH} title=${text.titleH} desc=${text.descriptionH} passed`)
    } catch (error) {
      console.error(await page.diagnose(heroProbe))
      throw error
    } finally { await chrome.client.send('Target.closeTarget', { targetId }) }
  }

  // 冬季手机端完整档 Hero（ContactPage 同构）：遮罩几乎全撤后 description / kicker / 标题
  // 必须切浅色，且文字区域的实测背景像素对比度 ≥ 4.5:1（不只查 computed color）。
  {
    const { targetId, page } = await openAppPage({ width: 390, height: 844, profile: 'winter', view: 'contact' })
    try {
      const hero = await page.probe(fullHeroProbe)
      assert.equal(hero.descriptionColor, 'rgb(216, 230, 244)', `winter full hero description must switch to light: ${hero.descriptionColor}`)
      // 阴影负向断言：撤掉 text-shadow（回归到无描边）时这里必然失败——
      // 亮区（补光灯/屏幕）的可读性兜底不允许被静默移除。
      assert.ok(hero.descriptionShadow.includes('rgba(4, 10, 18'), `winter full hero description must keep its dark text-shadow: ${hero.descriptionShadow}`)
      assert.equal(hero.titleColor, WINTER_TITLE_COLOR, `winter full hero title must switch to white: ${hero.titleColor}`)
      // 像素级验收：隐藏文字（含描边）后截取说明文字矩形 = 纯背景；逐像素 sRGB 线性化亮度
      // 与文字亮度逐一算对比度。双条件：中位数背景对比度 ≥ 4.5:1，且不达标（不利亮区）
      // 面积 ≤ 20%——11% 黑 + 89% 白的负向自检仍然必失败；照片中的小面积镜面高光
      // （补光灯/屏幕，实测 ~11%）由描述文字自带的深色描边兜底，不构成大面积失效。
      const rect = await page.evaluate(`(() => { const el = document.querySelector('.showcase-hero-description'); el.style.visibility = 'hidden'; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
      const { data } = await chrome.client.send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 2 } }, page.sessionId)
      await page.evaluate(`(() => { document.querySelector('.showcase-hero-description').style.visibility = '' })()`)
      const { default: sharp } = await import('sharp')
      const { info, data: raw } = await sharp(Buffer.from(data, 'base64')).raw().toBuffer({ resolveWithObject: true })
      const textLum = relativeLuminance([216, 230, 244])
      const lums = []
      for (let i = 0; i < raw.length; i += info.channels) lums.push(relativeLuminance([raw[i], raw[i + 1], raw[i + 2]]))
      lums.sort((a, b) => a - b)
      const medianLum = lums[Math.floor(lums.length / 2)]
      const medianRatio = (Math.max(medianLum, textLum) + 0.05) / (Math.min(medianLum, textLum) + 0.05)
      const passFraction = backgroundContrastFraction(raw, info.channels, textLum)
      assert.ok(medianRatio >= 4.5, `winter full hero description median background contrast must be >= 4.5:1: ${medianRatio.toFixed(2)}:1`)
      assert.ok(passFraction >= 0.8, `winter full hero description contrast must hold over >=80% of its area (unfavorable bright area <=20%): ${(passFraction * 100).toFixed(1)}%`)
      console.log(`[browser-showcase-hero] winter full hero (contact 390x844): description light + median ${medianRatio.toFixed(2)}:1 + ${(passFraction * 100).toFixed(1)}% area passed`)
    } finally { await chrome.client.send('Target.closeTarget', { targetId }) }
  }

  // 冬季手机端带统计数字的完整档 Hero（HoF 同构）：stat 标签类显式设了深色，
  // 必须被 <768px 断点的 :deep(span) inherit 覆盖为浅色。夹具环境无榜单数据时，
  // 复制 HoF / Hero 两个组件的真实 scope 属性合成同一结构，让两条 scoped 规则
  // 真实参与层叠后取 computed color（不是只查源码正则）。
  {
    const { targetId, page } = await openAppPage({ width: 390, height: 844, profile: 'winter', view: 'hof' })
    try {
      const hero = await page.probe(fullHeroProbe)
      let statsLabelColor = hero.statsLabelColor
      if (!statsLabelColor) {
        statsLabelColor = await page.evaluate(`(() => {
          const section = document.querySelector('.showcase-hero')
          const content = section?.querySelector('.showcase-hero-content')
          if (!content) return null
          const scopeName = root => [...root.querySelectorAll('*')].find(el => el.getAttributeNames().some(n => n.startsWith('data-v-')))?.getAttributeNames().find(n => n.startsWith('data-v-'))
          const pageScope = scopeName(document.querySelector('.app-main') ?? document.body)
          const heroScope = [...section.attributes].find(a => a.name.startsWith('data-v-'))?.name
          const stats = document.createElement('div')
          stats.className = 'showcase-hero-stats'
          if (heroScope) stats.setAttribute(heroScope, '')
          const span = document.createElement('span')
          span.className = 'lb-hero-stat-label'
          if (pageScope) span.setAttribute(pageScope, '')
          span.textContent = 'stats'
          stats.appendChild(span)
          content.appendChild(stats)
          return getComputedStyle(span).color
        })()`)
      }
      assert.notEqual(statsLabelColor, 'rgb(59, 84, 112)', `winter full hero stat label must not stay dark: ${statsLabelColor}`)
      assert.equal(statsLabelColor, 'rgb(216, 230, 244)', `winter full hero stat label must follow the light container color: ${statsLabelColor}`)
      console.log(`[browser-showcase-hero] winter full hero (hof 390x844): stat label color=${statsLabelColor} passed`)
    } finally { await chrome.client.send('Target.closeTarget', { targetId }) }
  }


  // 无 section 的普通 ShowcaseHero 由 ShowcaseHero.test.ts 覆盖（无公开非分区页面可直达）。

  console.log('[browser-showcase-hero] all scenarios passed')
} finally {
  if (chrome) await chrome.close()
  await server.close()
}
