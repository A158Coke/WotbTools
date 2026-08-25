// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ImageDataUploader from './ImageDataUploader.vue'

async function selectFiles(wrapper, files) {
  const input = wrapper.find('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: files, configurable: true })
  await input.trigger('change')
  await flushPromises()
}

describe('ImageDataUploader', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads selected images into image data URLs', async () => {
    const wrapper = mount(ImageDataUploader)

    await selectFiles(wrapper, [new File(['image'], 'proof.png', {
      type: 'image/png',
      lastModified: 1,
    })])

    await vi.waitFor(() => expect(wrapper.emitted('selected')).toHaveLength(1))
    const [image] = wrapper.emitted('selected')[0][0]
    expect(image.name).toBe('proof.png')
    expect(image.data.startsWith('data:image/png')).toBe(true)
  })

  it('rejects non-image files before reading them', async () => {
    const wrapper = mount(ImageDataUploader)

    await selectFiles(wrapper, [new File(['text'], 'proof.txt', { type: 'text/plain' })])

    expect(wrapper.emitted('error')[0]).toEqual(['invalid-type'])
    expect(wrapper.emitted('selected')).toBeUndefined()
  })

  it('rejects over-limit images before creating FileReaders', async () => {
    let readerCount = 0
    class TrackingFileReader {
      constructor() {
        readerCount += 1
      }

      readAsDataURL() {}
    }
    vi.stubGlobal('FileReader', TrackingFileReader)
    const wrapper = mount(ImageDataUploader, { props: { multiple: true, maxFiles: 2 } })

    await selectFiles(wrapper, [
      new File(['one'], 'one.png', { type: 'image/png' }),
      new File(['two'], 'two.png', { type: 'image/png' }),
      new File(['three'], 'three.png', { type: 'image/png' }),
    ])

    expect(readerCount).toBe(0)
    expect(wrapper.emitted('error')[0]).toEqual(['too-many'])
    expect(wrapper.emitted('selected')).toBeUndefined()
  })

  it('skips existing images before creating FileReaders', async () => {
    let readerCount = 0
    class TrackingFileReader {
      constructor() {
        readerCount += 1
      }

      readAsDataURL() {}
    }
    vi.stubGlobal('FileReader', TrackingFileReader)
    const image = new File(['image'], 'proof.png', { type: 'image/png', lastModified: 1 })
    const key = [image.name, image.size, image.lastModified].join(':')
    const wrapper = mount(ImageDataUploader, { props: { multiple: true, maxFiles: 2, existingKeys: [key] } })

    await selectFiles(wrapper, [image])

    expect(readerCount).toBe(0)
    expect(wrapper.emitted('selected')[0]).toEqual([[], 1])
  })

  it('invalidates an older read when a later selection is invalid', async () => {
    const readers = []
    class DeferredFileReader {
      constructor() {
        this.onload = null
        this.onerror = null
        this.result = null
        readers.push(this)
      }

      readAsDataURL() {}
    }
    vi.stubGlobal('FileReader', DeferredFileReader)
    const wrapper = mount(ImageDataUploader)

    await selectFiles(wrapper, [new File(['image'], 'first.png', { type: 'image/png' })])
    await selectFiles(wrapper, [new File(['text'], 'second.txt', { type: 'text/plain' })])
    readers[0].result = 'data:image/png;base64,AAAA'
    readers[0].onload()
    await flushPromises()

    expect(wrapper.emitted('selected')).toBeUndefined()
    expect(wrapper.emitted('error')[0]).toEqual(['invalid-type'])
  })

  it('keeps only the latest valid selection when reads overlap', async () => {
    const readers = []
    class DeferredFileReader {
      constructor() {
        this.onload = null
        this.onerror = null
        this.result = null
        readers.push(this)
      }

      readAsDataURL() {}
    }
    vi.stubGlobal('FileReader', DeferredFileReader)
    const wrapper = mount(ImageDataUploader)

    await selectFiles(wrapper, [new File(['first'], 'first.png', { type: 'image/png' })])
    await selectFiles(wrapper, [new File(['second'], 'second.png', { type: 'image/png' })])
    readers[0].result = 'data:image/png;base64,AAAA'
    readers[0].onload()
    readers[1].result = 'data:image/png;base64,BBBB'
    readers[1].onload()
    await flushPromises()

    expect(wrapper.emitted('selected')).toHaveLength(1)
    expect(wrapper.emitted('selected')[0][0][0].name).toBe('second.png')
  })

  it('rejects a reader result that is not an image data URL', async () => {
    class InvalidDataFileReader {
      readAsDataURL() {
        this.result = 'data:application/octet-stream;base64,AAAA'
        this.onload()
      }
    }
    vi.stubGlobal('FileReader', InvalidDataFileReader)
    const wrapper = mount(ImageDataUploader)

    await selectFiles(wrapper, [new File(['image'], 'proof.png', { type: 'image/png' })])

    await vi.waitFor(() => expect(wrapper.emitted('error')).toHaveLength(1))
    expect(wrapper.emitted('error')[0]).toEqual(['invalid-data'])
    expect(wrapper.emitted('selected')).toBeUndefined()
  })
})
