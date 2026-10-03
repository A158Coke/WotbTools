import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveWasmDevFile } from '../vite.config.js'

/**
 * `/wasm` dev middleware 的路径解算边界。
 *
 * dev server 可能被 `vite --host` / Remote Link / 容器端口 / LAN 暴露，`req.url` 是不可信输入；
 * 这里锁定的是「最终读取的文件一定位于 WASM 制品根内」——用**真实存在**的根外文件做诱饵，
 * 证明拒绝来自 containment 判定，而不是「恰好不存在」。
 */
function makeFixture() {
  const base = mkdtempSync(join(tmpdir(), 'wotb-wasm-dev-'))
  const root = join(base, 'common-wasm')
  mkdirSync(join(root, 'abc1234'), { recursive: true })
  writeFileSync(join(root, 'abc1234', 'wotb_replay_wasm.js'), '// agent wasm wrapper\n')
  // 根外的真实 .js 文件：containment 判定必须挡住它（而不是因为不存在才拒绝）。
  writeFileSync(join(base, 'outside.js'), '// outside the wasm root\n')
  writeFileSync(join(base, 'secret.txt'), 'not a module\n')
  // 以 .js 结尾的**目录**：不能被当成文件流出去。
  mkdirSync(join(root, 'box.js'))
  return { base, root }
}

const fixture = makeFixture()

function resolveIn(requestPath) {
  return resolveWasmDevFile(requestPath, fixture.root)
}

describe('resolveWasmDevFile · 正常路径', () => {
  it('解析 `<ref>/wotb_replay_wasm.js` 到制品根内文件', () => {
    const r = resolveIn('abc1234/wotb_replay_wasm.js')
    expect(r.ok).toBe(true)
    expect(r.file.endsWith(join('abc1234', 'wotb_replay_wasm.js')) || r.file.endsWith('abc1234/wotb_replay_wasm.js')).toBe(true)
  })

  it('忽略 query（production 静态伺服同款语义：`?import` 不影响取文件）', () => {
    const plain = resolveIn('abc1234/wotb_replay_wasm.js')
    const withQuery = resolveIn('abc1234/wotb_replay_wasm.js?import')
    expect(withQuery.ok).toBe(true)
    expect(withQuery.file).toBe(plain.file)
  })

  it('容忍前导斜杠', () => {
    expect(resolveIn('///abc1234/wotb_replay_wasm.js').ok).toBe(true)
  })
})

describe('resolveWasmDevFile · traversal 必须拒绝', () => {
  it('根外诱饵文件真实存在（否则本组测试不成证明）', () => {
    expect(existsSync(join(fixture.base, 'outside.js'))).toBe(true)
  })

  it.each([
    '../outside.js',
    '../../frontend/vite.config.js',
    '%2e%2e/outside.js',
    '%2e%2e%2foutside.js',
    '..%2Foutside.js',
    'abc1234/../../outside.js',
  ])('拒绝 %s', (requestPath) => {
    const r = resolveIn(requestPath)
    expect(r.ok).toBe(false)
    expect(r.status).toBe(403)
  })

  it('拒绝反斜杠拼接的越界（Win32 分隔符语义）', () => {
    // POSIX 下 `\` 是普通文件名字符，此时目标是「不存在」而不是越界；两种都必须是 ok:false。
    expect(resolveIn('..\\outside.js').ok).toBe(false)
  })
})

describe('resolveWasmDevFile · malformed URI', () => {
  it.each(['%E0%A4%A', '%', '%zz'])('拒绝并 fail closed：%s', (requestPath) => {
    expect(() => resolveIn(requestPath)).not.toThrow()
    const r = resolveIn(requestPath)
    expect(r.ok).toBe(false)
    expect(r.status).toBe(400)
  })
})

describe('resolveWasmDevFile · 目录与非 .js', () => {
  it('目录不能当文件输出', () => {
    const r = resolveIn('box.js')
    expect(r.ok).toBe(false)
    expect(r.status).toBe(404)
    expect(r.reason).toBe('not-a-file')
  })

  it('非 .js 不归本中间件管（调用方 next() 交回 Vite）', () => {
    expect(resolveIn('abc1234/wotb_replay_wasm.wasm')).toMatchObject({ ok: false, reason: 'not-js' })
    expect(resolveIn('abc1234/wotb_replay_wasm.js.map').reason).toBe('not-js')
    expect(resolveIn('../secret.txt').reason).toBe('not-js')
  })

  it('根内缺失的 .js → 404', () => {
    expect(resolveIn('abc1234/nope.js')).toMatchObject({ ok: false, status: 404, reason: 'missing' })
  })

  it('空 / 未定义请求路径不崩溃', () => {
    expect(resolveWasmDevFile(undefined, fixture.root).ok).toBe(false)
    expect(resolveWasmDevFile('', fixture.root).ok).toBe(false)
  })
})

describe('resolveWasmDevFile · symlink', () => {
  let symlinkOk = true
  try {
    symlinkSync(join(fixture.base, 'outside.js'), join(fixture.root, 'link-out.js'), 'file')
    symlinkSync(join(fixture.root, 'abc1234', 'wotb_replay_wasm.js'), join(fixture.root, 'link-in.js'), 'file')
  } catch {
    // Windows 非开发者模式不允许建 symlink；此时跳过（CI 在 Linux 上会真实执行）。
    symlinkOk = false
  }

  it.skipIf(!symlinkOk)('指向根外的 symlink 被拒绝（realpath containment）', () => {
    expect(resolveIn('link-out.js')).toMatchObject({ ok: false, status: 403, reason: 'symlink-escape' })
  })

  it.skipIf(!symlinkOk)('根内的 symlink 仍可服务（不误伤）', () => {
    expect(resolveIn('link-in.js').ok).toBe(true)
  })
})
