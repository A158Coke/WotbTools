/** Real Chrome gate: original-image geometry, ancestor clipping and text exclusion.
 * --baseline renders the exact origin/main component through Vite, without changing files.
 * Evidence: tmp/showcase-hero/{before,after}-matrix.json and matching screenshots.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'

const BASELINE = process.argv.includes('--baseline')
const PHASE = BASELINE ? 'before' : 'after'
const COMPARE_ONLY = process.argv.includes('--compare-only')
const SCREENSHOTS = !process.argv.includes('--geometry-only')
const DIR = 'tmp/showcase-hero'
const VIEWPORTS = [[1440, 900], [1920, 1080], [1920, 540], [390, 844], [844, 390]]
const PROFILES = ['spring', 'summer', 'autumn', 'winter']
// Routes, not image mappings. Assets and section IDs are imported from production SSOT below.
const ROUTES = [
  ['replay', true], ['agent-techtree', true], ['map-preview', true],
  ['agent-tankopedia', false], ['hof', false], ['hof', false, '&tab=hundred'],
  ['hof', false, '&tab=mark3'], ['league-broadcasts', false], ['tournament-points', false],
  ['admin-users', true], ['admin-battle-data', true], ['admin-ai-review-feedback', true],
  ['admin-site-feedback', true], ['hof-admin', true], ['tournament-points-admin', true],
  ['tournament-points-config', true], ['creators-config', true],
  ['history', false], ['technical-evolution', false], ['rating-docs', false],
  ['contact', false], ['more', false], ['recommendations', false], ['creators', false],
  ['sponsor', false], ['android', false],
]

// Executed in the real page. Keep helpers inside the serialized probe.
async function completenessProbe() {
  const section = document.querySelector('.showcase-hero')
  const art = section?.querySelector('.showcase-hero-art')
  if (!art) return null
  const rect = section.getBoundingClientRect()
  if (!rect.width || !rect.height) return { section: section.dataset.section, hidden: true }
  const layers = value => {
    let depth = 0, start = 0
    const parts = []
    for (let i = 0; i < value.length; i++) {
      if (value[i] === '(') depth++
      if (value[i] === ')') depth--
      if (value[i] === ',' && !depth) { parts.push(value.slice(start, i).trim()); start = i + 1 }
    }
    parts.push(value.slice(start).trim())
    return parts
  }
  const cs = getComputedStyle(art)
  const backgrounds = layers(cs.backgroundImage)
  const index = backgrounds.findIndex(v => v.startsWith('url('))
  if (index < 0) throw new Error('missing image layer')
  const url = backgrounds[index].match(/^url\(["']?(.*?)["']?\)$/)[1]
  const image = new Image()
  image.src = url
  await image.decode()
  const r = art.getBoundingClientRect()
  const sizes = layers(cs.backgroundSize), positions = layers(cs.backgroundPosition)
  const size = sizes[index % sizes.length], pos = positions[index % positions.length]
  // Background origin: padding-box by default. Our art is untransformed, without border/padding.
  const origin = layers(cs.backgroundOrigin)[index % layers(cs.backgroundOrigin).length]
  if (origin !== 'padding-box' || art.clientWidth !== art.offsetWidth || art.clientHeight !== art.offsetHeight || cs.transform !== 'none') throw new Error('unsupported background coordinate system')
  const nw = image.naturalWidth, nh = image.naturalHeight
  let rw, rh
  if (size === 'contain' || size === 'cover') {
    const scale = Math[size === 'contain' ? 'min' : 'max'](r.width / nw, r.height / nh)
    rw = nw * scale; rh = nh * scale
  } else {
    const parts = size.split(/\s+/)
    const length = (v, total) => v.endsWith('%') ? parseFloat(v) * total / 100 : v.endsWith('px') ? parseFloat(v) : v === 'auto' ? null : NaN
    rw = length(parts[0], r.width); rh = length(parts[1] ?? 'auto', r.height)
    if (rw === null && rh === null) { rw = nw; rh = nh }
    else if (rw === null) rw = rh * nw / nh
    else if (rh === null) rh = rw * nh / nw
    if (!Number.isFinite(rw + rh)) throw new Error(`unsupported background-size ${size}`)
  }
  const offset = (value, free) => value.endsWith('%') ? parseFloat(value) * free / 100 : value.endsWith('px') ? parseFloat(value) : NaN
  const [px, py] = pos.split(/\s+/)
  const left = r.left + offset(px, r.width - rw), top = r.top + offset(py, r.height - rh)
  if (!Number.isFinite(left + top)) throw new Error(`unsupported background-position ${pos}`)
  const rendered = { left, top, right: left + rw, bottom: top + rh, width: rw, height: rh }
  const visible = { left: Math.max(left, r.left), top: Math.max(top, r.top), right: Math.min(left + rw, r.right), bottom: Math.min(top + rh, r.bottom) }
  const clips = []
  const roundedClips = []
  // Scrollports clip the image if it cannot fit even after scrolling to the hero.
  // Do not count ordinary page scrolling below the viewport as loss of original content.
  for (let el = art.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    const style = getComputedStyle(el), box = el.getBoundingClientRect()
    const clipX = /hidden|clip|auto|scroll/.test(style.overflowX)
    const clipY = /hidden|clip|auto|scroll/.test(style.overflowY)
    if (clipX || clipY) {
      const bounds = { left: box.left + el.clientLeft, top: box.top + el.clientTop }
      bounds.right = bounds.left + el.clientWidth; bounds.bottom = bounds.top + el.clientHeight
      if (clipX) { visible.left = Math.max(visible.left, bounds.left); visible.right = Math.min(visible.right, bounds.right) }
      if (clipY) { visible.top = Math.max(visible.top, bounds.top); visible.bottom = Math.min(visible.bottom, bounds.bottom) }
      clips.push({ class: el.className, ...bounds, clipX, clipY })
      if (clipX && clipY) {
        const corners = [
          ['TopLeft', left, top, bounds.left, bounds.top, 1, 1],
          ['TopRight', left + rw, top, bounds.right, bounds.top, -1, 1],
          ['BottomLeft', left, top + rh, bounds.left, bounds.bottom, 1, -1],
          ['BottomRight', left + rw, top + rh, bounds.right, bounds.bottom, -1, -1],
        ]
        for (const [corner, x, y, edgeX, edgeY, sx, sy] of corners) {
          const values = style[`border${corner}Radius`].split(/\s+/)
          const length = (v, total) => parseFloat(v) * (v.endsWith('%') ? total / 100 : 1)
          const rx = Math.max(0, length(values[0], box.width) - parseFloat(style[sx === 1 ? 'borderLeftWidth' : 'borderRightWidth']))
          const ry = Math.max(0, length(values[1] ?? values[0], box.height) - parseFloat(style[sy === 1 ? 'borderTopWidth' : 'borderBottomWidth']))
          const dx = (x - edgeX) * sx, dy = (y - edgeY) * sy
          if (rx && ry && dx < rx && dy < ry && ((dx - rx) / rx) ** 2 + ((dy - ry) / ry) ** 2 > 1 + 1e-6) roundedClips.push({ class: el.className, corner })
        }
      }
    }
  }
  const area = box => Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top)
  const textOverlap = [...section.querySelectorAll('.showcase-hero-content h1, .showcase-hero-content p, .showcase-hero-stats, .showcase-hero-actions')].reduce((sum, el) => {
    const box = el.getBoundingClientRect()
    return sum + area({ left: Math.max(box.left, left), right: Math.min(box.right, left + rw), top: Math.max(box.top, top), bottom: Math.min(box.bottom, top + rh) })
  }, 0)
  const title = section.querySelector('h1'), titleBox = title.getBoundingClientRect()
  const color = value => value.match(/[\d.]+/g).slice(0, 3).map(Number)
  const lum = rgb => rgb.map(v => (v /= 255) <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0)
  const surface = getComputedStyle(section).getPropertyValue('--color-surface-1').trim()
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')
  ctx.fillStyle = surface; ctx.fillRect(0, 0, 1, 1)
  const bg = lum([...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3))
  const fg = lum(color(getComputedStyle(title).color))
  return {
    section: section.dataset.section, compact: section.classList.contains('is-compact'),
    width: rect.width, height: rect.height, artWidth: r.width, artHeight: r.height,
    naturalWidth: nw, naturalHeight: nh, size, position: pos,
    scaleX: rw / nw, scaleY: rh / nh, rendered,
    originalVisible: { x: (visible.left - left) / (rw / nw), y: (visible.top - top) / (rh / nh), width: Math.max(0, visible.right - visible.left) / (rw / nw), height: Math.max(0, visible.bottom - visible.top) / (rh / nh) },
    fraction: area(visible) / (rw * rh),
    edges: { left: visible.left <= left + .01, top: visible.top <= top + .01, right: visible.right >= left + rw - .01, bottom: visible.bottom >= top + rh - .01 },
    textOverlap, clips, roundedClips, titleFits: titleBox.left >= rect.left && titleBox.right <= rect.right && titleBox.bottom <= rect.bottom,
    titleColor: getComputedStyle(title).color, titleContrastOnSurface: (Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05),
    hScroll: document.scrollingElement.scrollWidth > innerWidth + 1 || (matchMedia('(pointer: coarse)').matches && innerWidth > visualViewport.width + 1),
    profile: document.documentElement.dataset.uiProfile,
    imageLayers: backgrounds.length,
  }
}
function assertGeometry(m, label) {
  assert.ok(m && !m.hidden, `${label}: expected visible hero`)
  assert.ok(m.fraction >= 1 - 1e-6, `${label}: original completeness ${m.fraction}`)
  for (const [edge, visible] of Object.entries(m.edges)) assert.ok(visible, `${label}: ${edge} edge clipped`)
  assert.deepEqual(m.roundedClips, [], `${label}: rounded ancestor clips image corners`)
  assert.ok(Math.abs(m.scaleX - m.scaleY) < 1e-8, `${label}: nonuniform scaling`)
}
function assertAfter(m, label) {
  assertGeometry(m, label)
  assert.equal(m.size, 'contain', `${label}: use contain`)
  assert.equal(m.textOverlap, 0, `${label}: text intersects image`)
  assert.equal(m.imageLayers, 1, `${label}: image must not be washed out by scrim`)
  assert.ok(m.titleFits, `${label}: title clipped`)
  assert.ok(!m.hScroll, `${label}: horizontal overflow`)
  assert.ok(m.titleContrastOnSurface >= 4.5, `${label}: title contrast ${m.titleContrastOnSurface}`)
}

mkdirSync(DIR, { recursive: true })
const source = BASELINE ? execFileSync('git', ['show', 'origin/main:frontend/src/components/ShowcaseHero.vue'], { encoding: 'utf8' }) : null
const { server, origin } = await startFixtureServer({ plugins: [{ name: 'hero-test-module', resolveId(id) { if (id === 'virtual:hero-test') return id }, load(id) { if (id === 'virtual:hero-test') return `export * as v from 'vue';export {default as Hero} from '/src/components/ShowcaseHero.vue';export {SECTION_HERO_IDS} from '/src/shared/sectionHeroes.ts'` } }, ...(source ? [{ name: 'showcase-baseline', enforce: 'pre', transform(code, id) {
  if (id.replaceAll('\\', '/').endsWith('/src/components/ShowcaseHero.vue')) return source
} }] : [])] })
let chrome
const results = []
try {
  console.log(`[showcase] ${PHASE} server ${origin}`)
  chrome = await launchChromeForCdp(findChrome())
  console.log('[showcase] Chrome connected')
  async function open(view, width, height, extra = '') {
    const { targetId, sessionId } = await chrome.openPage()
    const page = new Page(chrome.client, sessionId)
    await page.enable()
    await page.emulate({ width, height, touch: width < 1000 })
    await chrome.client.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('wotb-ui-profile','summer');localStorage.setItem('wotb-lang','zh')` }, sessionId)
    await chrome.client.send('Page.navigate', { url: `${origin}/?view=${view}&ws-auth=1&ws-roles=wotbtools-admin,tournament-admin,content-admin${extra}` }, sessionId)
    try { await page.waitForValue(`!!document.querySelector('.showcase-hero')`, Boolean, { timeout: 30000, label: `${view} hero` }) } catch (error) { console.error(await page.diagnose(() => document.body.innerText)); throw error }
    await page.evaluate('document.fonts.ready')
    return { page, targetId }
  }
  async function screenshot(page, name) {
    if (!SCREENSHOTS) return
    const rect = await page.evaluate(`(() => {const r=document.querySelector('.showcase-hero').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`)
    if (rect.width <= 0 || rect.height <= 0) return
    const { data } = await chrome.client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...rect, scale: 1 } }, page.sessionId)
    writeFileSync(`${DIR}/${PHASE}-${name}.png`, Buffer.from(data, 'base64'))
  }
  async function record(page, metadata) {
    await page.evaluate(`(async()=>{document.querySelector('.showcase-hero').scrollIntoView({block:'start',behavior:'instant'});await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)})()`)
    const m = await page.probe(completenessProbe)
    assert.ok(m, `${JSON.stringify(metadata)}: missing hero`)
    results.push({ ...metadata, ...m })
    if (!BASELINE) {
      if (m.hidden) assert.ok(metadata.kind === 'route' && metadata.viewport === '844x390' && ['replay', 'agent-techtree', 'map-preview'].includes(metadata.view), `unexpected hidden hero: ${JSON.stringify(metadata)}`)
      else assertAfter(m, JSON.stringify(metadata))
    }
    return m
  }
  // All real call sites, all requested viewports. Shared CSS has no profile-specific layout;
  // exhaustive profiles/sections/variants are tested separately with the real mounted component.
  for (const [view, compact, extra = ''] of (COMPARE_ONLY ? [] : ROUTES)) {
    const { page, targetId } = await open(view, 1440, 900, extra)
    try {
      for (const [width, height] of VIEWPORTS) {
        await page.emulate({ width, height, touch: width < 1000 })
        const m = await record(page, { kind: 'route', view, extra, viewport: `${width}x${height}` })
        if (!m.hidden) assert.equal(m.compact, compact, `${view}: variant`)
        await screenshot(page, `${view}${extra.replaceAll(/[^a-z0-9]/g, '-')}-${width}x${height}`)
      }
      console.log(`[showcase] ${PHASE} route ${view}${extra} passed`)
    } finally { await chrome.client.send('Target.closeTarget', { targetId }) }
  }
  // Compare only bounded alternatives on the same real route and data; no candidate CSS ships.
  if (!BASELINE) {
    const comparisons = []
    const { page, targetId } = await open('contact', 390, 844)
    try {
      for (const [width, height] of [[1440, 900], [390, 844]]) {
        await page.emulate({ width, height, touch: width < 1000 })
        for (const candidate of ['A', 'B', 'C']) {
          await page.evaluate(`(()=>{const hero=document.querySelector('.showcase-hero'),art=hero.querySelector('.showcase-hero-art'),content=hero.querySelector('.showcase-hero-content');window.__candidateOriginal ??= [hero.style.cssText,art.style.cssText,content.style.cssText];[hero,art,content].forEach((el,i)=>el.style.cssText=window.__candidateOriginal[i]);if(${JSON.stringify(candidate)}!=='C'){hero.style.display='block';Object.assign(art.style,{position:'absolute',inset:'0',margin:'0',backgroundPosition:'right center'});content.style.maxInlineSize='42rem';if(${JSON.stringify(candidate)}==='B')content.style.minBlockSize='320px'}})()`)
          const m = await page.probe(completenessProbe)
          comparisons.push({ candidate, viewport: `${width}x${height}`, ...m })
          await screenshot(page, `candidate-${candidate}-${width}x${height}`)
        }
      }
    } finally { await chrome.client.send('Target.closeTarget', { targetId }) }
    writeFileSync(`${DIR}/candidates.json`, JSON.stringify(comparisons, null, 2))
  }
  // Import the production mapping and actual SFC, rather than copying IDs or assets into tests.
  if (!COMPARE_ONLY) {
    const { page, targetId } = await open('contact', 1440, 900)
    try {
      const ids = await page.evaluate(`(async()=>{const {v,Hero,SECTION_HERO_IDS}=await import('/@id/virtual:hero-test');window.__heroFixture={v,Hero};document.querySelector('#app').__vue_app__.unmount();document.body.innerHTML='<main id="hero-matrix"></main>';return SECTION_HERO_IDS})()`)
      for (const profile of PROFILES) {
        await page.evaluate(`document.documentElement.dataset.uiProfile=${JSON.stringify(profile)};document.documentElement.dataset.theme=${JSON.stringify(profile === 'winter' ? 'light' : 'dark')}`)
        for (const compact of [false, true]) {
          for (const section of ids) {
            await page.evaluate(`(()=>{window.__heroApp?.unmount();const {v,Hero}=window.__heroFixture;window.__heroApp=v.createApp({render:()=>v.h(Hero,{section:${JSON.stringify(section)},compact:${compact},kicker:'WOTBTOOLS',title:'分区主视觉',description:'保持完整图片与清晰的信息层级'},{stats:()=>v.h('strong','10,483'),actions:()=>v.h('button','操作')})});window.__heroApp.mount('#hero-matrix')})()`)
            for (const [width, height] of VIEWPORTS) {
              await page.emulate({ width, height, touch: width < 1000 })
              const m = await record(page, { kind: 'component', viewport: `${width}x${height}`, profile, section, compact })
              if (!BASELINE && compact) assert.ok(m.height < height * .6, 'compact must leave workspace visible')
              await screenshot(page, `component-${section}-${compact ? 'compact' : 'full'}-${profile}-${width}x${height}`)
            }
          }
        }
        console.log(`[showcase] ${PHASE} all 11 sections / both variants / 5 viewports: ${profile} passed`)
      }
      if (!BASELINE) {
        await page.emulate({ width: 1440, height: 900, touch: false })
        await page.evaluate(`document.querySelector('.showcase-hero-art').style.backgroundSize='cover'`)
        const cover = await page.probe(completenessProbe)
        assert.throws(() => assertGeometry(cover, 'cover negative control'), /original completeness|edge clipped/)
        await page.evaluate(`document.querySelector('.showcase-hero-art').style.backgroundSize=''`)
        assertAfter(await page.probe(completenessProbe), 'restore contain')
        await page.evaluate(`document.querySelector('.showcase-hero-art').style.minHeight='132px';document.querySelector('.showcase-hero').style.maxHeight='40px'`)
        const clipped = await page.probe(completenessProbe)
        assert.throws(() => assertGeometry(clipped, 'ancestor negative control'), /original completeness|edge clipped/)
        await page.evaluate(`document.querySelector('.showcase-hero-art').style.minHeight='';document.querySelector('.showcase-hero').style.maxHeight=''`)
        await chrome.client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, page.sessionId)
        assertAfter(await page.probe(completenessProbe), 'reduced motion')
        console.log(`[showcase] cover rejected (${cover.fraction}); ancestor clipping rejected; reduced motion passed`)
      }
    } finally { await chrome.client.send('Target.closeTarget', { targetId }) }
  }
  console.log(`[showcase] ${PHASE}: ${results.length} measurements passed`)
} finally {
  if (!COMPARE_ONLY) writeFileSync(`${DIR}/${PHASE}-matrix.json`, JSON.stringify(results, null, 2))
  console.log('[showcase] closing Chrome')
  if (chrome) await chrome.close()
  console.log('[showcase] closing fixture server')
  await server.close()
  console.log('[showcase] cleanup complete')
}
