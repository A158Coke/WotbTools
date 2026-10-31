// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { toRaw } from 'vue'
import FileDrop from './FileDrop.vue'

const i18n = vi.hoisted(() => ({
  t: vi.fn((key, values) => values ? `${key}:${Object.values(values).join(',')}` : key)
}))

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: i18n.t, locale: { value: 'en' } }) }))

function makeFiles(count, size = 1024) {
  return Array.from({ length: count }, (_, i) =>
    new File([new Uint8Array(size)], `replay-${i}.wotbreplay`, { type: 'application/octet-stream' }))
}

function mountUploader(files = [], loading = false, options = {}) {
  return {
    wrapper: mount(FileDrop, {
      props: {
        files,
        loading,
        ...(options.purpose ? { purpose: options.purpose, imageSingle: options.imageSingle, imageLabel: options.imageLabel, imageHint: options.imageHint } : {})
      },
      global: {
        mocks: { $t: i18n.t },
        provide: {
          isAuthenticated: options.isAuthenticated || (() => true),
          login: vi.fn()
        }
      }
    })
  }
}

describe('FileDrop single cover selection', () => {
  it('replaces the previous cover with a raw File and uses the caller copy', async () => {
    const previous = new File(['old'], 'old.png', { type: 'image/png' })
    const next = new File(['new'], 'new.jpg', { type: 'image/jpeg' })
    const { wrapper } = mountUploader([previous], false, { purpose: 'image', imageSingle: true, imageLabel: 'Choose cover', imageHint: 'One cover' })
    expect(wrapper.get('input[type=file]').attributes('multiple')).toBeUndefined()
    expect(wrapper.text()).toContain('One cover')
    await pickFiles(wrapper, [next], 'tournament-image-input')
    expect(wrapper.emitted('update:files')?.at(-1)?.[0]).toEqual([next])
    wrapper.unmount()
  })
  it('rejects a multiple-file drop without changing the existing cover', async () => {
    const { wrapper } = mountUploader([], false, { purpose: 'image', imageSingle: true })
    await wrapper.get('.uploadwrap').trigger('drop', { dataTransfer: { files: [new File(['a'], 'a.png', { type: 'image/png' }), new File(['b'], 'b.png', { type: 'image/png' })] } })
    expect(wrapper.emitted('update:files')).toBeUndefined()
    expect(wrapper.text()).toContain('tournament.imageInvalid')
    wrapper.unmount()
  })
})

function pickFiles(wrapper, files, testId = 'select-files-input') {
  const input = wrapper.get(`[data-testid="${testId}"]`)
  Object.defineProperty(input.element, 'files', { value: files, configurable: true })
  return input.trigger('change')
}

function pickerButton(wrapper, labelKey) {
  const btn = wrapper.findAll('button').find(b => b.text().includes(labelKey))
  if (!btn) throw new Error(`picker button not found: ${labelKey}`)
  return btn
}

/** 点击真实按钮 → 断言目标隐藏 input 的 native click() 被调用（不 mock whole input，不触发 change）。 */
async function expectNativePickerClick(wrapper, labelKey, testId) {
  const input = wrapper.get(`[data-testid="${testId}"]`).element
  const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => {})
  await pickerButton(wrapper, labelKey).trigger('click')
  expect(clickSpy).toHaveBeenCalledOnce()
  clickSpy.mockRestore()
}

describe('FileDrop 回放上传面', () => {
  it('有回放后不再渲染上传卡或解析入口，只留 input', () => {
    const { wrapper } = mountUploader(makeFiles(34))
    expect(wrapper.find('[data-testid="file-uploader-empty"]').exists()).toBe(false)
    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(wrapper.text()).toBe('')
    expect(wrapper.find('[data-testid="select-files-input"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="select-folder-input"]').exists()).toBe(true)
  })

  it('0 个文件显示空态上传卡', () => {
    const { wrapper } = mountUploader([])
    expect(wrapper.text()).toContain('upload.drop_hint')
  })

  // ---- 共享 upload preflight（选择文件/文件夹/add/drop 同一 contract）----

  it('101 个文件 rejected：不更新 selection，显示数量上限', async () => {
    const { wrapper } = mountUploader([])
    const files = Array.from({ length: 101 }, (_, i) => ({
      name: `r${i}.wotbreplay`, size: 1024, lastModified: i
    }))
    await pickFiles(wrapper, files)
    expect(wrapper.emitted('update:files')).toBeUndefined()
    const err = wrapper.get('[data-testid="upload-validation-error"]')
    expect(err.text()).toContain('upload.reject_count:100,101')
  })

  it('exactly 20 MiB accepted → 更新 selection', async () => {
    const { wrapper } = mountUploader([])
    const files = [{ name: 'ok.wotbreplay', size: 20 * 1024 * 1024, lastModified: 1 }]
    await pickFiles(wrapper, files)
    const emitted = wrapper.emitted('update:files')
    expect(emitted).toBeTruthy()
    expect(emitted[0][0]).toEqual(files)
  })

  it('>20 MiB rejected：显示具体 filename + actual size，不更新 selection', async () => {
    const { wrapper } = mountUploader([])
    await pickFiles(wrapper, [
      { name: 'huge.wotbreplay', size: Math.floor(27.4 * 1024 * 1024), lastModified: 1 }
    ])
    expect(wrapper.emitted('update:files')).toBeUndefined()
    const err = wrapper.get('[data-testid="upload-validation-error"]')
    expect(err.text()).toContain('upload.reject_too_large_file:huge.wotbreplay,27.4 MB')
    expect(err.text()).toContain('upload.reject_size_hint')
  })

  it('54 files / 85 MiB + one 27.4 MiB → 拒绝（selection 不更新 → createProcessingJob 不会发生）', async () => {
    const files = [
      ...Array.from({ length: 54 }, (_, i) => ({
        name: `batch-${i}.wotbreplay`, size: Math.floor(85 * 1024 * 1024 / 54), lastModified: i
      })),
      { name: 'oversized.wotbreplay', size: Math.floor(27.4 * 1024 * 1024), lastModified: 999 }
    ]
    const { wrapper } = mountUploader([])
    await pickFiles(wrapper, files)
    expect(wrapper.emitted('update:files')).toBeUndefined()
    expect(wrapper.get('[data-testid="upload-validation-error"]').text())
      .toContain('upload.reject_too_large_file:oversized.wotbreplay,27.4 MB')
  })

  it('multiple oversized files 全部显示', async () => {
    const { wrapper } = mountUploader([])
    await pickFiles(wrapper, [
      { name: 'a.wotbreplay', size: 21 * 1024 * 1024, lastModified: 1 },
      { name: 'b.wotbreplay', size: 30 * 1024 * 1024, lastModified: 2 },
      { name: 'ok.wotbreplay', size: 1024, lastModified: 3 }
    ])
    const err = wrapper.get('[data-testid="upload-validation-error"]')
    expect(err.findAll('li').length).toBe(2)
    expect(err.text()).toContain('a.wotbreplay')
    expect(err.text()).toContain('b.wotbreplay')
  })

  it('existing valid selection + invalid add → 保留原 selection', async () => {
    const existing = [
      { name: 'keep-0.wotbreplay', size: 1024, lastModified: 1 },
      { name: 'keep-1.wotbreplay', size: 2048, lastModified: 2 }
    ]
    const { wrapper } = mountUploader(existing)
    await pickFiles(wrapper, [
      { name: 'huge.wotbreplay', size: 21 * 1024 * 1024, lastModified: 3 }
    ])
    expect(wrapper.emitted('update:files')).toBeUndefined()
    expect(wrapper.get('[data-testid="upload-validation-error"]').exists()).toBe(true)
  })

  it('追加：已有文件保持实例与位置，新文件排序后接在尾部', async () => {
    const z = new File(['z'], 'z.wotbreplay')
    const { wrapper } = mountUploader([z])
    const b = { name: 'b.wotbreplay', size: 1, lastModified: 2 }
    const a = { name: 'a.wotbreplay', size: 1, lastModified: 3 }
    await pickFiles(wrapper, [b, a])
    const [next] = wrapper.emitted('update:files')[0]
    expect(next.map(f => f.name)).toEqual(['z.wotbreplay', 'a.wotbreplay', 'b.wotbreplay'])
    expect(toRaw(next[0])).toBe(z)
  })

  it('首批选择按文件名排序', async () => {
    const { wrapper } = mountUploader([])
    await pickFiles(wrapper, [{ name: 'b.wotbreplay', size: 1, lastModified: 1 }, { name: 'a.wotbreplay', size: 1, lastModified: 2 }])
    expect(wrapper.emitted('update:files')[0][0].map(f => f.name)).toEqual(['a.wotbreplay', 'b.wotbreplay'])
  })

  it('重复添加同一文件：不触发 selection 变更，只提示已在列表', async () => {
    const listed = { name: 'a.wotbreplay', size: 1, lastModified: 1 }
    const { wrapper } = mountUploader([listed])
    await pickFiles(wrapper, [{ ...listed }])
    expect(wrapper.emitted('update:files')).toBeUndefined()
    expect(wrapper.get('[data-testid="upload-validation-error"]').text()).toContain('upload.already_listed')
  })

  it('drag/drop 走同一 validator', async () => {
    const { wrapper } = mountUploader([])
    await wrapper.get('section.uploadwrap').trigger('drop', {
      dataTransfer: {
        files: [{ name: 'huge.wotbreplay', size: 25 * 1024 * 1024, lastModified: 1 }]
      }
    })
    expect(wrapper.emitted('update:files')).toBeUndefined()
    expect(wrapper.get('[data-testid="upload-validation-error"]').text())
      .toContain('upload.reject_too_large_file:huge.wotbreplay,25.0 MB')
  })

  it('folder 只含非 .wotbreplay → 明确提示未找到回放', async () => {
    const { wrapper } = mountUploader([])
    await pickFiles(wrapper, [
      { name: 'notes.txt', size: 1024, lastModified: 1 }
    ], 'select-folder-input')
    expect(wrapper.emitted('update:files')).toBeUndefined()
    expect(wrapper.get('[data-testid="upload-validation-error"]').text())
      .toContain('upload.reject_no_replay')
  })

  it('folder: replay + .DS_Store → replay accepted，非回放忽略', async () => {
    const { wrapper } = mountUploader([])
    await pickFiles(wrapper, [
      { name: 'replay-a.wotbreplay', size: 1024, lastModified: 1 },
      { name: '.DS_Store', size: 6148, lastModified: 2 }
    ], 'select-folder-input')
    const emitted = wrapper.emitted('update:files')
    expect(emitted).toBeTruthy()
    expect(emitted[0][0].map(f => f.name)).toEqual(['replay-a.wotbreplay'])
    expect(wrapper.find('[data-testid="upload-validation-error"]').exists()).toBe(false)
  })

  it('folder: replay + png + txt → replay accepted，非回放不计 count/total', async () => {
    const { wrapper } = mountUploader([])
    await pickFiles(wrapper, [
      { name: 'shot.png', size: 30 * 1024 * 1024, lastModified: 1 },
      { name: 'readme.txt', size: 40 * 1024 * 1024, lastModified: 2 },
      { name: 'replay-a.wotbreplay', size: 1024, lastModified: 3 }
    ], 'select-folder-input')
    const emitted = wrapper.emitted('update:files')
    expect(emitted).toBeTruthy()
    expect(emitted[0][0].map(f => f.name)).toEqual(['replay-a.wotbreplay'])
    // 非回放 70MiB 不计入总量 → 单文件 1KiB 完全合法（无 total 超限提示）
    expect(wrapper.find('[data-testid="upload-validation-error"]').exists()).toBe(false)
  })

  it('drag/drop 混合文件 → replay accepted，其他文件忽略', async () => {
    const { wrapper } = mountUploader([])
    await wrapper.get('section.uploadwrap').trigger('drop', {
      dataTransfer: {
        files: [
          { name: 'notes.txt', size: 1024, lastModified: 1 },
          { name: 'replay-b.wotbreplay', size: 2048, lastModified: 2 }
        ]
      }
    })
    const emitted = wrapper.emitted('update:files')
    expect(emitted).toBeTruthy()
    expect(emitted[0][0].map(f => f.name)).toEqual(['replay-b.wotbreplay'])
  })

  it('101 replay + 50 non-replay → 拒绝且 count 显示当前 101', async () => {
    const { wrapper } = mountUploader([])
    const files = [
      ...Array.from({ length: 101 }, (_, i) => ({
        name: `r${i}.wotbreplay`, size: 1024, lastModified: i
      })),
      ...Array.from({ length: 50 }, (_, i) => ({
        name: `aux-${i}.txt`, size: 1024, lastModified: 1000 + i
      }))
    ]
    await pickFiles(wrapper, files)
    expect(wrapper.emitted('update:files')).toBeUndefined()
    expect(wrapper.get('[data-testid="upload-validation-error"]').text())
      .toContain('upload.reject_count:100,101')
  })

  it('total 超限显示实际大小（214.7 MB / 200.0 MB）', async () => {
    const { wrapper } = mountUploader([])
    const perFile = Math.floor(214.7 * 1024 * 1024 / 2)
    await pickFiles(wrapper, [
      { name: 'a.wotbreplay', size: perFile, lastModified: 1 },
      { name: 'b.wotbreplay', size: perFile, lastModified: 2 }
    ])
    expect(wrapper.emitted('update:files')).toBeUndefined()
    const err = wrapper.get('[data-testid="upload-validation-error"]')
    expect(err.text()).toContain('upload.reject_total:214.7 MB,200.0 MB')
  })

  it('非 .wotbreplay 与合法文件混合（选择文件入口）→ 过滤后 accepted', async () => {
    const { wrapper } = mountUploader([])
    await pickFiles(wrapper, [
      { name: 'a.txt', size: 10, lastModified: 1 },
      { name: 'b.wotbreplay', size: 1024, lastModified: 2 }
    ])
    const emitted = wrapper.emitted('update:files')
    expect(emitted).toBeTruthy()
    expect(emitted[0][0].map(f => f.name)).toEqual(['b.wotbreplay'])
  })

})

// ---- native picker：真实按钮点击必须落到对应隐藏 input 的 click()（WS-07）----
// 回归：openPicker() 曾对 template ref 再取 .value（`input.value?.click()`），
// 实际对 file input 的 value 字符串调 click() → 生产环境 "P.click is not a function"。

describe('FileDrop native picker（真实按钮 → 隐藏 input.click）', () => {
  it('空态：Select files → select-files-input.click()', async () => {
    const { wrapper } = mountUploader([])
    await expectNativePickerClick(wrapper, 'upload.select_files', 'select-files-input')
  })

  it('空态：Select folder → select-folder-input.click()', async () => {
    const { wrapper } = mountUploader([])
    await expectNativePickerClick(wrapper, 'upload.select_folder', 'select-folder-input')
  })

  it('已有文件：工作台通过暴露的命令打开同一组 input', () => {
    const { wrapper } = mountUploader(makeFiles(2))
    const files = vi.spyOn(wrapper.get('[data-testid="select-files-input"]').element, 'click').mockImplementation(() => {})
    const folder = vi.spyOn(wrapper.get('[data-testid="select-folder-input"]').element, 'click').mockImplementation(() => {})
    wrapper.vm.chooseFiles()
    wrapper.vm.chooseFolder()
    expect(files).toHaveBeenCalledOnce()
    expect(folder).toHaveBeenCalledOnce()
    expect(wrapper.vm.folderAvailable).toBe(true)
  })

  it('select-files 支持 multiple，folder input 带 webkitdirectory', () => {
    const { wrapper } = mountUploader([])
    expect(wrapper.get('[data-testid="select-files-input"]').attributes('multiple')).toBeDefined()
    expect(wrapper.get('[data-testid="select-folder-input"]').attributes('webkitdirectory')).toBeDefined()
  })

})
