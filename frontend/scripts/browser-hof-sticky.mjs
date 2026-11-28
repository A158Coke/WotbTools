import assert from 'node:assert/strict'

// Measure at the document origin before either sticky box has moved.
export async function assertStickyPositions(page, selectors) {
  await page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })")
  await page.waitForValue('document.scrollingElement.scrollTop', y => y === 0)
  const { boxes, maxScroll } = await page.callWith(names => {
    const root = document.scrollingElement
    const boxes = names.map(selector => {
      const el = document.querySelector(selector)
      const style = getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      return { selector, position: style.position, naturalTop: rect.top, top: parseFloat(style.top),
        height: rect.height, parentBottom: el.parentElement.getBoundingClientRect().bottom }
    })
    return { boxes, maxScroll: root.scrollHeight - root.clientHeight }
  }, selectors)
  for (const box of boxes) {
    assert.equal(box.position, 'sticky', box.selector)
    assert.ok(box.naturalTop > box.top, box.selector + ' must start below its sticky inset')
  }
  const thresholds = boxes.map(box => box.naturalTop - box.top)
  // Scrolling past the natural tops also keeps the target identical when replaying the old inset.
  const target = Math.ceil(Math.max(...boxes.map(box => box.naturalTop), ...thresholds)) + 32
  const limit = Math.min(maxScroll, ...boxes.map(box => box.parentBottom - box.height - box.top))
  assert.ok(target + 1 < limit, 'insufficient room to pin before the parent ends: ' + JSON.stringify({ boxes, target, limit, maxScroll }))
  await page.callWith(y => window.scrollTo({ top: y, behavior: 'instant' }), target)
  const scrollTop = await page.waitForValue('document.scrollingElement.scrollTop', y => Math.abs(y - target) <= 1)
  const actual = await page.callWith(names => names.map(selector => {
    const el = document.querySelector(selector)
    const rect = el.getBoundingClientRect()
    return { top: rect.top, parentClearance: el.parentElement.getBoundingClientRect().bottom - rect.bottom }
  }), selectors)
  for (const [i, box] of boxes.entries()) {
    assert.ok(scrollTop > thresholds[i] && actual[i].parentClearance > 1, box.selector + ' must be pinned before its parent ends')
    assert.ok(Math.abs(actual[i].top - box.top) <= 1, box.selector + ' expected top ' + box.top + ', got ' + actual[i].top)
  }
  return { boxes, thresholds, maxScroll, target, scrollTop, actual }
}
