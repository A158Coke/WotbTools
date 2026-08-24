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
      props: { files, loading, confirmRemove: false },
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
})
