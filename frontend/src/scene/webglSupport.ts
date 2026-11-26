
export const WEBGL_STATUS = Object.freeze({
  OK: 'ok',
  WEBGL1_ONLY: 'webgl1-only',
  UNAVAILABLE: 'unavailable',
} as const)

export type WebGLSupportStatus = (typeof WEBGL_STATUS)[keyof typeof WEBGL_STATUS]

export interface WebGLSupport {
  supported: boolean
  status: WebGLSupportStatus
  version: 0 | 1 | 2
}

interface GlContext {
  getExtension(name: string): { loseContext?(): void } | null
}

interface GlCanvas {
  getContext(name: string): GlContext | null
}

export interface GlProbeDocument {
  createElement(tag: string): GlCanvas
}

function tryContext(canvas: GlCanvas, name: string): GlContext | null {
  try {
    return canvas.getContext(name) || null
  } catch {
    return null
  }
}

function release(gl: GlContext): void {
  try {
    const ext = gl.getExtension?.('WEBGL_lose_context')
    ext?.loseContext?.()
  } catch {
    // 释放失败不影响结论
  }
}

export function detectWebGL(doc: GlProbeDocument | null | undefined = typeof document === 'undefined' ? null : document): WebGLSupport {
  const unavailable: WebGLSupport = { supported: false, status: WEBGL_STATUS.UNAVAILABLE, version: 0 }
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
  const gl1 = tryContext(canvas, 'webgl') || tryContext(canvas, 'experimental-webgl')
  if (gl1) {
    release(gl1)
    return { supported: false, status: WEBGL_STATUS.WEBGL1_ONLY, version: 1 }
  }
  return unavailable
}
