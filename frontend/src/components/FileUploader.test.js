// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import FileUploader from './FileUploader.vue'

const i18n = vi.hoisted(() => ({
  t: vi.fn((key, values) => values
    ? `${key}:${Object.values(values).join(',')}`
    : key)
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: i18n.t, locale: { value: 'en' } })
}))

function makeFiles(count, size = 1024) {
  return Array.from({ length: count }, (_, i) =>
    new File([new Uint8Array(size)], `replay-${i}.wotbreplay`, { type: 'application/octet-stream' }))
}

function mountUploader(files = [], loading = false) {
  return mount(FileUploader, {
    props: { files, loading, confirmRemove: false },
    global: { mocks: { $t: i18n.t } }
  })
}

describe('FileUploader 文件列表折叠（plan §17–§18/§65）', () => {
  it('34 个文件默认折叠：只显示 summary，不铺开 34 个 filename', () => {
    const wrapper = mountUploader(makeFiles(34))
    // 折叠时不应渲染每个 chip
    expect(wrapper.findAll('.chip').length).toBe(0)
    expect(wrapper.find('[data-testid="file-list"]').exists()).toBe(false)
    // summary 显示数量与总大小
    expect(wrapper.text()).toContain('upload.files_size:34,34.0 KB')
    // 展开按钮存在
    expect(wrapper.text()).toContain('upload.view_list:34')
  })

  it('点击「查看文件列表」展开，再点收起', async () => {
    const wrapper = mountUploader(makeFiles(3))
    expect(wrapper.findAll('.chip').length).toBe(0)
    await wrapper.findAll('button').find(b => b.text().includes('upload.view_list')).trigger('click')
    expect(wrapper.find('[data-testid="file-list"]').exists()).toBe(true)
    expect(wrapper.findAll('.chip').length).toBe(3)
    await wrapper.findAll('button').find(b => b.text().includes('upload.hide_list')).trigger('click')
    expect(wrapper.findAll('.chip').length).toBe(0)
  })

  it('长 filename 用 title 暴露完整名称（截断显示不丢全名）', async () => {
    const longName = '20260725_1600__CHRD-A158布丁_A178_SPHT_9034890123456789_abcdef.wotbreplay'
    const wrapper = mountUploader([new File(['x'], longName)])
    await wrapper.findAll('button').find(b => b.text().includes('upload.view_list')).trigger('click')
    const chip = wrapper.find('.chip')
    expect(chip.attributes('title')).toBe(longName)
  })

  it('0 个文件显示空态上传卡', () => {
    const wrapper = mountUploader([])
    expect(wrapper.text()).toContain('upload.drop_hint')
    expect(wrapper.text()).toContain('upload.select_files')
  })

  it('清空按钮触发 update:files []', async () => {
    const wrapper = mountUploader(makeFiles(2))
    const clearBtn = wrapper.findAll('button').find(b => b.text().includes('upload.clear'))
    await clearBtn.trigger('click')
    expect(wrapper.emitted('update:files')[0][0]).toEqual([])
  })

  it('解析按钮在 loading 时 disabled 且显示 processing', () => {
    const wrapper = mountUploader(makeFiles(1), true)
    const previewBtn = wrapper.findAll('button').find(b => b.text().includes('action.preview'))
    expect(previewBtn.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('action.processing')
  })
})
