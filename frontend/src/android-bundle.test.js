import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyAndroidUrlLayout } from '../scripts/build-android-bundle.mjs'
import { androidCsp } from '../vite.config.js'
const roots = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'android-url-')); roots.push(root)
  mkdirSync(join(root, 'assets')); mkdirSync(join(root, '.vite'))
  writeFileSync(join(root, 'index.html'), '<script src="/assets/entry.js"></script>')
  writeFileSync(join(root, 'assets/entry.js'), 'import("./lazy.js")')
  writeFileSync(join(root, 'assets/lazy.js'), 'export default 1')
  writeFileSync(join(root, '.vite/manifest.json'), JSON.stringify({ entry: { file: 'assets/entry.js', dynamicImports: ['lazy'] }, lazy: { file: 'assets/lazy.js' } }))
  return root
}
describe('APK root URL graph', () => {
  it('accepts root document plus lazy relative chunks', () => expect(() => verifyAndroidUrlLayout(fixture())).not.toThrow())
  it('rejects a missing lazy chunk and a remote document dependency', () => {
    const root = fixture(); rmSync(join(root, 'assets/lazy.js'))
    expect(() => verifyAndroidUrlLayout(root)).toThrow('missing bundle URL')
    writeFileSync(join(root, 'index.html'), '<script src="https://wotbtools.com/assets/entry.js"></script>')
    expect(() => verifyAndroidUrlLayout(root)).toThrow('non-local bundle dependency')
  })
  it('allows only bundled scripts and reviewed production connections', () => {
    const policy = androidCsp('<script>localStorage.getItem("profile")</script>')
    expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval' 'sha256-")
    expect(policy).toContain("connect-src 'self' blob: https://wotbtools.com")
    expect(policy).not.toContain('http:'); expect(policy).not.toContain('*')
  })
  // GLB 内嵌贴图由 GLTFLoader → ImageBitmapLoader 经 fetch(blob:) 读取：connect-src 缺 blob:
  // 时 3D 模型无贴图（坦克百科装甲查看器 / 3D 回放白模，2026-10-07 定位）。
  it('keeps blob: allowed for GLB embedded textures', () => {
    expect(androidCsp('<script></script>')).toContain("connect-src 'self' blob: https://wotbtools.com")
  })
})
