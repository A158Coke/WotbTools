import type { Material, Object3D, Texture } from 'three'

interface TexturedValue {
  isTexture?: unknown
}

function duckProps(src: unknown): Record<string, TexturedValue | undefined> {
  return src as Record<string, TexturedValue | undefined>
}

export function collectMaterialTextures(m: Material, out: Set<Texture> = new Set()): Set<Texture> {
  const props = duckProps(m)
  for (const k in props) {
    const v = props[k]
    if (v && v.isTexture) out.add(v as Texture)
  }
  const uniforms = (m as { uniforms?: Record<string, { value?: unknown }> }).uniforms
  if (uniforms) {
    for (const k in uniforms) {
      const v = uniforms[k]?.value as TexturedValue | undefined
      if (v && v.isTexture) out.add(v as Texture)
    }
  }
  return out
}

interface DisposableObject extends Object3D {
  isInstancedMesh?: boolean
  dispose?(): void
  geometry?: { dispose(): void } | null
  material?: Material | Material[] | null
}

export function disposeObject3D(root: Object3D, shared: unknown = null): void {
  const geos = new Set<{ dispose(): void }>(), mats = new Set<Material>(), texs = new Set<Texture>();
  void shared;
  root.traverse((o) => {
    const obj = o as DisposableObject;
    if (obj.isInstancedMesh) obj.dispose?.();
    if (obj.geometry) geos.add(obj.geometry);
    const ms: Material[] = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
    for (const m of ms) {
      mats.add(m);
      collectMaterialTextures(m, texs);
    }
  });
  for (const t of texs) t.dispose();
  for (const m of mats) m.dispose();
  for (const g of geos) g.dispose();
}
