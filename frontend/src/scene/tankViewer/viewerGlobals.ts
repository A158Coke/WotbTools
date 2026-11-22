// window 上残留的射击复现/调试全局清理（2026-11-22 自 tankViewer.js 模块级 helper 原样搬移）。
// 场景脚本把射击复现 / 调试状态挂在 window 上（__worldPan、__shotCtx…）。以前每次都在新窗口里打开，
// 现在同一标签页内反复进出，残留状态会让下一辆坦克的炮塔转不动、镜头被锁——初始化与销毁时统一清掉。
const VIEWER_GLOBAL_RE = /^__(world|shot|shooter|victim|hit|seg|move|launch|end|dbg|debug|autoRel|fireGun|update|armor)/
export function resetViewerGlobals() {
    if (typeof window === 'undefined') return
    for (const key of Object.keys(window)) {
        if (VIEWER_GLOBAL_RE.test(key)) {
            try { Reflect.deleteProperty(window, key) } catch (_) { Reflect.set(window, key, undefined) }
        }
    }
}
