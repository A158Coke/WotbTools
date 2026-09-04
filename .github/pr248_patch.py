from pathlib import Path


test = Path('frontend/src/components/BattlePlayback.integration.test.js')
src = test.read_text(encoding='utf-8')
old = """    // §safeInsets-DOM：真实 controls 高度在 .pb-mobile-overlay-content（wrapper 是 inset:0）。
    const overlayEl = wrapper.find('.pb-mobile-overlay-content').element
    const scaleOf = () => {
"""
new = """    // §safeInsets-DOM：生产逻辑按 overlay wrapper bottom → content top 的真实占用区计算。
    // happy-dom 不做 CSS layout，因此这里显式提供与 transient bottom:8px 契约一致的 rect。
    const overlayWrapEl = wrapper.find('[data-test=\"pb-mobile-overlay\"]').element
    const overlayEl = wrapper.find('.pb-mobile-overlay-content').element
    Object.defineProperty(overlayWrapEl, 'getBoundingClientRect', {
      value: () => ({ top: 0, left: 0, right: 1200, bottom: 900, width: 1200, height: 900 }),
      configurable: true,
    })
    Object.defineProperty(overlayEl, 'getBoundingClientRect', {
      value: () => {
        const height = overlayEl.clientHeight || 0
        const bottom = 892
        return { top: bottom - height, left: 8, right: 1192, bottom, width: 1184, height }
      },
      configurable: true,
    })
    const scaleOf = () => {
"""
if src.count(old) != 1:
    raise SystemExit('safe inset integration fixture target did not match exactly once')
test.write_text(src.replace(old, new, 1), encoding='utf-8')

vue = Path('frontend/src/components/BattlePlayback.vue')
src = vue.read_text(encoding='utf-8')
old = """  // §safeInsets-DOM：只量取 .pb-mobile-overlay-content 的真实 rendered 高度（wrapper 是 inset:0，
  // 其 clientHeight 是整张地图高度，不能当 controls 高度）。transient mobile controls hidden
  // 时 contentHeight=0；显示/重排后 ResizeObserver 会触发重新 fit，避免地图被可见 controls 覆盖。
"""
new = """  // §safeInsets-DOM：wrapper 是 inset:0，不能把 wrapper.clientHeight 当 controls 高度。
  // transient controls 显示时按 wrapper bottom → content top 量取完整占用区（含 bottom/safe-area gap）；
  // hidden 时 contentHeight=0。内容重排由 ResizeObserver 触发重新 fit。
"""
if src.count(old) != 1:
    raise SystemExit('BattlePlayback safe inset comment target did not match exactly once')
vue.write_text(src.replace(old, new, 1), encoding='utf-8')

Path('.github/workflows/pr248-safe-inset-test-fixture-fix.yml').unlink()
Path('.github/pr248_patch.py').unlink()
