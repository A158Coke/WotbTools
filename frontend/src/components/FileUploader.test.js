// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import FileUploader from './FileUploader.vue'

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
    wrapper: mount(FileUploader, {
      props: {
        files,
        loading,
        confirmRemove: false,
        ...(options.showWorkspaceActions === undefined ? {} : { showWorkspaceActions: options.showWorkspaceActions })
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

function lastWorkspaceAction(wrapper) {
  const events = wrapper.emitted('workspace-action')
  return events ? events[events.length - 1][0] : null
}

function pickFiles(wrapper, files, testId = 'select-files-input') {
  const input = wrapper.get(`[data-testid="${testId}"]`)
  Object.defineProperty(input.element, 'files', { value: files, configurable: true })
  return input.trigger('change')
}

describe('FileUploader 文件列表与回放工作台', () => {
  it('34 个文件默认折叠：只显示 summary，不铺开 filename', () => {
    const { wrapper } = mountUploader(makeFiles(34))
    expect(wrapper.findAll('.chip').length).toBe(0)
    expect(wrapper.find('[data-testid="file-list"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('upload.files_size:34,34.0 KB')
  })

  it('点击查看文件列表可展开和收起', async () => {
    const { wrapper } = mountUploader(makeFiles(3))
    await wrapper.findAll('button').find(b => b.text().includes('upload.view_list')).trigger('click')
    expect(wrapper.findAll('.chip').length).toBe(3)
    await wrapper.findAll('button').find(b => b.text().includes('upload.hide_list')).trigger('click')
    expect(wrapper.findAll('.chip').length).toBe(0)
  })

  it('长 filename 用 title 暴露完整名称', async () => {
    const longName = '20260725_1600__CHRD-A158布丁_A178_SPHT_9034890123456789_abcdef.wotbreplay'
    const { wrapper } = mountUploader([new File(['x'], longName)])
    await wrapper.findAll('button').find(b => b.text().includes('upload.view_list')).trigger('click')
    expect(wrapper.find('.chip').attributes('title')).toBe(longName)
  })

  it('展开后可单独删除一个文件，并从真实 files 集合移除', async () => {
    const { wrapper } = mountUploader(makeFiles(3))
    await wrapper.findAll('button').find(b => b.text().includes('upload.view_list')).trigger('click')
    await wrapper.findAll('.chipx')[1].trigger('click')
    const emittedFiles = wrapper.emitted('update:files')[0][0]
    expect(emittedFiles.map(f => f.name)).toEqual(['replay-0.wotbreplay', 'replay-2.wotbreplay'])
  })

  it('单文件删除按钮在长文件名后仍可点击', async () => {
    const longName = `${'very-long-replay-name-'.repeat(12)}.wotbreplay`
    const { wrapper } = mountUploader([new File(['x'], longName)])
    await wrapper.findAll('button').find(b => b.text().includes('upload.view_list')).trigger('click')
    expect(wrapper.find('.chipx').exists()).toBe(true)
  })

  it('0 个文件显示空态上传卡', () => {
    const { wrapper } = mountUploader([])
    expect(wrapper.text()).toContain('upload.drop_hint')
  })

  it('清空按钮触发 update:files []', async () => {
    const { wrapper } = mountUploader(makeFiles(2))
    await wrapper.findAll('button').find(b => b.text().includes('upload.clear')).trigger('click')
    expect(wrapper.emitted('update:files')[0][0]).toEqual([])
  })

  it('解析按钮在 loading 时 disabled', () => {
    const { wrapper } = mountUploader(makeFiles(1), true)
    const previewBtn = wrapper.findAll('button').find(b => b.text().includes('action.preview'))
    expect(previewBtn.attributes('disabled')).toBeDefined()
  })

  it('allows the hidden Rating V2 page to reuse validation without exposing workspace actions', () => {
    const { wrapper } = mountUploader(makeFiles(1), false, { showWorkspaceActions: false })
    expect(wrapper.find('.replay-workspace-actions').exists()).toBe(false)
    expect(wrapper.find('[data-testid="direct-ai-btn"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="direct-playback-btn"]').exists()).toBe(false)
  })

  it('单文件无需先解析即可直接进入 AI 复盘（emit workspace-action 原地切换）', async () => {
    const files = makeFiles(1)
    const { wrapper } = mountUploader(files)
    await wrapper.find('[data-testid="direct-ai-btn"]').trigger('click')
    expect(lastWorkspaceAction(wrapper)).toEqual({ file: files[0], mode: 'ai' })
  })

  it('单文件无需先解析即可直接进入战局回放（emit workspace-action 原地切换）', async () => {
    const files = makeFiles(1)
    const { wrapper } = mountUploader(files)
    await wrapper.find('[data-testid="direct-playback-btn"]').trigger('click')
    expect(lastWorkspaceAction(wrapper)).toEqual({ file: files[0], mode: 'playback' })
  })

  it('多文件未明确选择时 AI/回放均不可执行', async () => {
    const files = makeFiles(3)
    const { wrapper } = mountUploader(files)
    const ai = wrapper.find('[data-testid="direct-ai-btn"]')
    const playback = wrapper.find('[data-testid="direct-playback-btn"]')
    expect(wrapper.find('.replay-action-file').element.value).toBe('')
    expect(ai.attributes('disabled')).toBeDefined()
    expect(playback.attributes('disabled')).toBeDefined()
    await ai.trigger('click')
    await playback.trigger('click')
    expect(wrapper.emitted('workspace-action')).toBeUndefined()
  })

  it('多文件必须通过选择器明确指定 AI/回放目标文件', async () => {
    const files = makeFiles(3)
    const { wrapper } = mountUploader(files)
    const select = wrapper.find('.replay-action-file')
    await select.setValue(`${files[2].name}:${files[2].size}:${files[2].lastModified}`)
    await wrapper.find('[data-testid="direct-ai-btn"]').trigger('click')
    expect(lastWorkspaceAction(wrapper)).toEqual({ file: files[2], mode: 'ai' })
  })

  it('已选择的多文件目标被移除后失效且不得 fallback 到第一场', async () => {
    const files = makeFiles(3)
    const { wrapper } = mountUploader(files)
    const select = wrapper.find('.replay-action-file')
    await select.setValue(`${files[2].name}:${files[2].size}:${files[2].lastModified}`)
    expect(wrapper.find('[data-testid="direct-ai-btn"]').attributes('disabled')).toBeUndefined()

    await wrapper.setProps({ files: files.slice(0, 2) })
    expect(wrapper.find('.replay-action-file').element.value).toBe('')
    expect(wrapper.find('[data-testid="direct-ai-btn"]').attributes('disabled')).toBeDefined()
    await wrapper.find('[data-testid="direct-ai-btn"]').trigger('click')
    expect(wrapper.emitted('workspace-action')).toBeUndefined()
  })

  // ---- BLOCKER 4：共享 upload preflight（选择文件/文件夹/add/drop 同一 contract）----

  it('file chip 显示 filename · size（1.8 MB）', async () => {
    const files = [
      { name: 'a.wotbreplay', size: Math.floor(1.8 * 1024 * 1024), lastModified: 1 },
      { name: 'b.wotbreplay', size: 5 * 1024 * 1024, lastModified: 2 }
    ]
    const { wrapper } = mountUploader(files)
    await wrapper.findAll('button').find(b => b.text().includes('upload.view_list')).trigger('click')
    const chips = wrapper.findAll('.chip')
    expect(chips[0].text()).toContain('a.wotbreplay')
    expect(chips[0].text()).toContain('1.8 MB')
    expect(chips[1].text()).toContain('5.0 MB')
  })

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
    ], 'add-files-input')
    expect(wrapper.emitted('update:files')).toBeUndefined()
    expect(wrapper.get('[data-testid="upload-validation-error"]').exists()).toBe(true)

    await wrapper.findAll('button').find(b => b.text().includes('upload.view_list')).trigger('click')
    const chips = wrapper.findAll('.chip')
    expect(chips.length).toBe(2)
    expect(chips.map(c => c.find('.chip-name').text())).toEqual(['keep-0.wotbreplay', 'keep-1.wotbreplay'])
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
