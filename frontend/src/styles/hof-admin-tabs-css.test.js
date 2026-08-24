// CSS source contract guard: HoF admin tab strip must stay canonical in
// showcase-rankings.css.
//
// Regression: showcase-regressions.css loads LAST in main.js and used to
// override .hof-admin-tabs from position:sticky -> position:relative while the
// rankings' top:66px offset stayed, sliding the tab strip down under the
// filters (production "百场审核 tab invisible" bug; DOM tests stayed green).
// These are source-contract assertions (no browser infra) so that exact bug
// class cannot silently return while DOM tests keep passing.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

const rankings = read('./showcase-rankings.css')
const regressions = read('./showcase-regressions.css')
const mainJs = read('../main.js')

// Documentation comments must never satisfy/fail a contract assertion.
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

// Extracts the declaration body of the first rule whose selector contains the
// given selector fragment (media blocks passed in already contain the rule).
function ruleBody(css, selectorFragment) {
  const start = css.indexOf(selectorFragment)
  expect(start, 'selector ' + selectorFragment + ' must exist in the sheet').toBeGreaterThan(-1)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

// Returns the inner content of the first @media block whose query contains
// "media" (balanced-brace scan).
function mediaBlock(css, media) {
  const start = css.indexOf(media)
  expect(start, 'media query ' + media + ' must exist in the sheet').toBeGreaterThan(-1)
  const open = css.indexOf('{', start)
  let depth = 0
  let i = open
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) break
    }
  }
  return css.slice(open + 1, i)
}

// Stylesheets imported AFTER showcase-rankings.css in main.js: any rule for the
// tab strip element itself here would win the cascade over the canonical rule.
const stylesheetImports = [...mainJs.matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map((m) => m[1])
const rankingsIdx = stylesheetImports.findIndex((p) => p.endsWith('showcase-rankings.css'))
const laterSheets = stylesheetImports.slice(rankingsIdx + 1)

describe('HoF admin tab strip CSS contract', () => {
  it('keeps the canonical sticky tab strip in showcase-rankings.css (desktop)', () => {
    const body = ruleBody(stripComments(rankings), '.hof-admin-tabs')
    expect(body).toMatch(/position:\s*sticky/)
    expect(body).toMatch(/top:\s*66px/)
    expect(body).toMatch(/z-index:\s*22/)
  })

  it('keeps the tab strip sticky below the topbar on tablet (top 64px)', () => {
    const tablet = mediaBlock(rankings, '@media(max-width:1199px)')
    const body = ruleBody(tablet, '.hof-admin-tabs')
    expect(body).toMatch(/top:\s*64px/)
    // 仍为 sticky：tablet 只调偏移，不回到 relative/static。
    expect(body).not.toMatch(/position:\s*(relative|static)/)
  })

  it('flattens the tab strip to static on mobile (no sticky offset issues)', () => {
    const mobile = mediaBlock(rankings, '@media(max-width:767px)')
    const body = ruleBody(mobile, '.hof-admin-tabs')
    expect(body).toMatch(/position:\s*static/)
  })

  it('showcase-regressions.css (loaded last) must not reference the tab strip', () => {
    // Root cause: regressions.css used to set position:relative + z-index:5 on
    // the strip while rankings' top offset survived -> strip slid under filters.
    expect(stripComments(regressions)).not.toMatch(/\.hof-admin-tabs/)
  })

  it('main.js keeps showcase-regressions.css loaded after showcase-rankings.css', () => {
    expect(rankingsIdx).toBeGreaterThan(-1)
    const regSheet = stylesheetImports.find((p) => p.endsWith('showcase-regressions.css'))
    expect(laterSheets).toContain(regSheet)
  })

  it('no stylesheet loaded after showcase-rankings.css defines a rule for the strip element', () => {
    // The strip element itself must be styled only by its canonical sheet.
    // (Descendant selectors like ".hof-admin-tabs button" are allowed; a rule
    // whose selector ends at ".hof-admin-tabs {" would win the cascade.)
    expect(laterSheets.length).toBeGreaterThan(0)
    for (const sheet of laterSheets) {
      const css = stripComments(read('./' + sheet.split('/').pop()))
      expect(css, sheet + ' must not define a .hof-admin-tabs rule').not.toMatch(/\.hof-admin-tabs\s*\{/)
    }
  })
})
