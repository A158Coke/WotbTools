import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { neutralizeDefaultMetalness, dropDuplicateGunMasks } from '../glbRig.js'
import { assetProvider } from '../assetProvider.js'
import type { GlbStaticData } from './glbParts.js'
import type { GlbCacheEntry, SuspensionJson, VehicleRuntimeDeps } from './vehicleRuntimeTypes.js'

export function createVehicleModelAssets(deps: VehicleRuntimeDeps) {
  let glbCache = new Map<number, Promise<GlbCacheEntry | null>>()

  async function loadGlb(tankId: number): Promise<GlbCacheEntry | null> {
    const cache = glbCache;
    if (cache.has(tankId)) return cache.get(tankId)!;
    const p = (async (): Promise<GlbCacheEntry | null> => {
      try {
        const [glbBytes, sd, susp] = await Promise.all([
          assetProvider.bytes(`/glb/${tankId}/model.glb`),
          assetProvider.json<GlbStaticData | null>(`/tank/${tankId}.json`).catch(() => null),
          assetProvider.json<SuspensionJson | null>(`/suspension/${tankId}.json`).catch(() => null),
        ]);
        const model = await new Promise<THREE.Object3D | null>((res) =>
          new GLTFLoader().parse(glbBytes.buffer as ArrayBuffer, '', (g) => res(g.scene), () => res(null)));
        if (!model) {
          console.warn('[playback] 坦克 GLB 解析返回空 tank_id=' + tankId)
          return null
        }
        model.scale.setScalar(1);
        neutralizeDefaultMetalness(model);
        dropDuplicateGunMasks(model);
        return { template: model, sd, susp };
      } catch (e) {
        console.warn('[playback] 坦克 GLB 加载失败 tank_id=' + tankId + ':', e)
        return null
      }
    })();
    cache.set(tankId, p);
    p.then((entry) => { if (!entry) cache.delete(tankId); }).catch(() => cache.delete(tankId));
    return p;
  }

  function disposeCache() {
    for (const p of glbCache.values()) {
      p.then((entry) => { if (entry && entry.template) deps.disposeObject3D(entry.template) }).catch(() => {})
    }
    glbCache = new Map()
  }
  return { loadGlb, disposeCache }
}
