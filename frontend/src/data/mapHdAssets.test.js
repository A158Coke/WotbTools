import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(here, '..', '..')
const repoRoot = path.resolve(frontendRoot, '..')
const manifestPath = path.join(frontendRoot, 'src/assets/maps-hd/manifest.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

function absoluteRepoPath(repoRelative) {
  return path.join(repoRoot, repoRelative)
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

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

describe('HD Playback basemap asset contract', () => {
  it('has exactly one deterministic HD entry for every registered map', () => {
    expect(manifest.schemaVersion).toBe(2)
    expect(manifest.expectedMapCount).toBe(29)
    expect(manifest.entries).toHaveLength(29)
    const sources = manifest.entries.map(entry => entry.source)
    const enhanced = manifest.entries.map(entry => entry.enhanced)
    expect(new Set(sources).size).toBe(29)
    expect(new Set(enhanced).size).toBe(29)
  })

  it('preserves hashes, exact 2x frame dimensions, aspect ratio and delivery budget', () => {
    const { maxEnhancedBytes, maxGrowthRatio } = manifest.deliveryBudget
    expect(maxEnhancedBytes).toBe(5 * 1024 * 1024)
    expect(maxGrowthRatio).toBe(4)

    for (const entry of manifest.entries) {
      const source = absoluteRepoPath(entry.source)
      const enhanced = absoluteRepoPath(entry.enhanced)
      expect(fs.existsSync(source), entry.source).toBe(true)
      expect(fs.existsSync(enhanced), entry.enhanced).toBe(true)
      expect(entry.sourceOfTruth, entry.source).toBe('ORIGINAL_ONLY')
      expect(entry.geometryTransform, entry.enhanced).toBe('NONE')
      expect(sha256(source), entry.source).toBe(entry.sourceSha256)
      expect(sha256(enhanced), entry.enhanced).toBe(entry.enhancedSha256)

      const sourceDimensions = readWebpDimensions(source)
      const enhancedDimensions = readWebpDimensions(enhanced)
      expect([sourceDimensions.width, sourceDimensions.height], entry.source).toEqual(entry.sourcePixels)
      expect([enhancedDimensions.width, enhancedDimensions.height], entry.enhanced).toEqual(entry.enhancedPixels)
      expect(enhancedDimensions.width, entry.enhanced).toBe(sourceDimensions.width * 2)
      expect(enhancedDimensions.height, entry.enhanced).toBe(sourceDimensions.height * 2)
      expect(enhancedDimensions.width * sourceDimensions.height, entry.enhanced)
        .toBe(enhancedDimensions.height * sourceDimensions.width)

      const sourceBytes = fs.statSync(source).size
      const enhancedBytes = fs.statSync(enhanced).size
      expect(enhancedBytes, `${entry.enhanced} exceeds single-map delivery budget`).toBeLessThanOrEqual(maxEnhancedBytes)
      expect(enhancedBytes / sourceBytes, `${entry.enhanced} exceeds growth budget`).toBeLessThanOrEqual(maxGrowthRatio)
    }
  })

  it('keeps mapImages HD imports in exact manifest coverage', () => {
    const mapImages = fs.readFileSync(path.join(frontendRoot, 'src/data/mapImages.js'), 'utf8')
    const imported = [...mapImages.matchAll(/from ['"]\.\.\/assets\/maps-hd\/([^'"]+\.webp)['"]/g)]
      .map(match => match[1])
      .sort()
    const expected = manifest.entries
      .map(entry => path.basename(entry.enhanced))
      .sort()
    expect(imported).toEqual(expected)
  })
})
