import type { MeshStandardMaterial } from 'three'
export type GltfSceneMaterial = MeshStandardMaterial & { alphaMode?: string }

export function duckProps(src: unknown): Record<string, { isTexture?: unknown } | undefined> {
  return src as Record<string, { isTexture?: unknown } | undefined>
}
