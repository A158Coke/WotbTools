import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { mapImages } from './mapImages'

const here = path.dirname(fileURLToPath(import.meta.url))
const assetsRoot = path.resolve(here, '../assets/maps')
const semanticsRoot = path.resolve(here, '../../../common/map-semantics')

function readWebpDimensions(file) {
  const data = fs.readFileSync(file)
  if (data.length < 20 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error(`Not a WebP file: ${file}`)
  }
  let offset = 12
  while (offset + 8 <= data.length) {
    const type = data.toString('ascii', offset, offset + 4)
    const size = data.readUInt32LE(offset + 4)
    const start = offset + 8
    if (start + size > data.length) throw new Error(`Truncated WebP chunk ${type}: ${file}`)
    if (type === 'VP8X') {
      if (size < 10) throw new Error(`Invalid VP8X frame header: ${file}`)
      const width = 1 + data.readUIntLE(start + 4, 3)
      const height = 1 + data.readUIntLE(start + 7, 3)
      return { width, height }
    }
    if (type === 'VP8 ') {
      if (size < 10 || data[start + 3] !== 0x9d || data[start + 4] !== 0x01 || data[start + 5] !== 0x2a) {
        throw new Error(`Invalid VP8 frame header: ${file}`)
      }
      return {
        width: data.readUInt16LE(start + 6) & 0x3fff,
        height: data.readUInt16LE(start + 8) & 0x3fff,
      }
    }
    if (type === 'VP8L') {
      if (size < 5 || data[start] !== 0x2f) throw new Error(`Invalid VP8L frame header: ${file}`)
      const b1 = data[start + 1]
      const b2 = data[start + 2]
      const b3 = data[start + 3]
      const b4 = data[start + 4]
      return {
        width: 1 + b1 + ((b2 & 0x3f) << 8),
        height: 1 + ((b2 & 0xc0) >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
      }
    }
    offset = start + size + (size % 2)
  }
  throw new Error(`No image dimensions found in WebP: ${file}`)
}

describe('2D Local basemap asset contract', () => {
  it('registers every canonical WebP exactly once and decodes its dimensions', () => {
    const images = Object.values(mapImages)
    const files = images.map(image => {
      expect(image.src).toContain('/assets/maps/')
      const file = path.basename(image.src.split('?')[0])
      const dimensions = readWebpDimensions(path.join(assetsRoot, file))
      expect(dimensions.width, file).toBeGreaterThan(0)
      expect(dimensions.height, file).toBeGreaterThan(0)
      expect(image.width, file).toBeGreaterThan(0)
      expect(image.height, file).toBeGreaterThan(0)
      return file
    })
    expect(images).toHaveLength(29)
    expect(new Set(files).size).toBe(images.length)
    expect(files.sort()).toEqual(fs.readdirSync(assetsRoot).filter(file => file.endsWith('.webp')).sort())
  })

  it('keeps registered map codes and render bounds aligned with semantic world bounds', () => {
    const semantics = fs.readdirSync(semanticsRoot)
      .filter(file => file.endsWith('.semantic.json'))
      .map(file => JSON.parse(fs.readFileSync(path.join(semanticsRoot, file), 'utf8')))
    for (const [mapCode, image] of Object.entries(mapImages)) {
      const semantic = semantics.find(item => item.mapCodes.includes(mapCode))
      expect(semantic, mapCode).toBeDefined()
      const { xMin, xMax, yMin, yMax } = semantic.coordinateSystem.worldBounds
      expect([xMin, xMax, yMin, yMax].every(Number.isFinite), mapCode).toBe(true)
      expect(xMax, mapCode).toBeGreaterThan(xMin)
      expect(yMax, mapCode).toBeGreaterThan(yMin)
      expect(image.coordinateBounds, mapCode).toEqual({ xMin, xMax, yMin, yMax })
    }
  })
})
