const VIEWER_GLOBAL_RE = /^__(world|shot|shooter|victim|hit|seg|move|launch|end|dbg|debug|autoRel|fireGun|update|armor)/
export function resetViewerGlobals() {
    if (typeof window === 'undefined') return
    for (const key of Object.keys(window)) {
        if (VIEWER_GLOBAL_RE.test(key)) {
            try { Reflect.deleteProperty(window, key) } catch (_) { Reflect.set(window, key, undefined) }
        }
    }
}
