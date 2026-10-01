/**
 * WebGL 预检（审计 3D-23）：创建 three.js 渲染器之前先确认浏览器能拿到 WebGL2 上下文。
 * three r163 起 WebGLRenderer 只支持 WebGL2，只有 WebGL1 的环境同样视为不支持——
 * 否则构造渲染器直接抛错，页面只剩一行原始英文报错。
 *
 * 纯函数 + 可注入 document：测试里传入假的 createElement 即可覆盖三种结果。
 */

export const WEBGL_STATUS = Object.freeze({
  OK: 'ok',
  /** 只有 WebGL1：显卡 / 驱动过旧，或浏览器禁用了 WebGL2 */
  WEBGL1_ONLY: 'webgl1-only',
  /** 完全拿不到 WebGL：硬件加速被关闭、黑名单驱动、无 GPU 的远程桌面等 */
  UNAVAILABLE: 'unavailable',
})

function tryContext(canvas, name) {
  try {
    return canvas.getContext(name) || null
  } catch {
    return null
  }
}

/** 预检用的上下文立刻释放：浏览器同时存活的 WebGL 上下文有上限（约 16 个） */
function release(gl) {
  try {
    gl.getExtension?.('WEBGL_lose_context')?.loseContext()
  } catch {
    // 释放失败不影响结论
  }
}

/**
 * @param {{ createElement?: (tag: string) => any } | null | undefined} doc
 * @returns {{ supported: boolean, status: string, version: 0 | 1 | 2 }}
 */
export function detectWebGL(doc = typeof document === 'undefined' ? null : document) {
  const unavailable = { supported: false, status: WEBGL_STATUS.UNAVAILABLE, version: 0 }
  if (!doc || typeof doc.createElement !== 'function') return unavailable
  let canvas
  try {
    canvas = doc.createElement('canvas')
  } catch {
    return unavailable
  }
  if (!canvas || typeof canvas.getContext !== 'function') return unavailable

  const gl2 = tryContext(canvas, 'webgl2')
  if (gl2) {
    release(gl2)
    return { supported: true, status: WEBGL_STATUS.OK, version: 2 }
  }
  // 同一 canvas 上 webgl2 失败后仍可再请求 webgl1（尚未绑定任何上下文类型）
  const gl1 = tryContext(canvas, 'webgl') || tryContext(canvas, 'experimental-webgl')
  if (gl1) {
    release(gl1)
    return { supported: false, status: WEBGL_STATUS.WEBGL1_ONLY, version: 1 }
  }
  return unavailable
}
