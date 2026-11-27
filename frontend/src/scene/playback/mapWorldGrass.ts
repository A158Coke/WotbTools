import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type * as THREE from 'three'
import { mapStaticUrl } from '../replaySource.js'
import { assetProvider } from '../assetProvider.js'
import { buildGrassMeshes, extractGrassPrototypes, parseGrassBin, type GrassDoc } from './mapGrass.js'
import type { ParsedGltf } from '../sceneryAssembly.js'
import { errorMessage } from './mapWorldLoadState.js'
import type { MapWorldDeps } from './mapWorldLoadState.js'

type GrassLayer = ReturnType<typeof buildGrassMeshes>
export function loadMapGrass(deps: MapWorldDeps, ctx: {
  grassBudget: number; resolvedKey: string | null; stale: () => boolean; scene: THREE.Scene; sampleHeight: (x: number, z: number) => number
  hasHeightField: () => boolean; publish: (layer: GrassLayer, prototype: THREE.Object3D) => void
  noteAsset: (key: string, status: string, detail: unknown, options: { optional: boolean }) => void
}) {
  const { grassBudget, resolvedKey, stale, scene, sampleHeight, hasHeightField, publish, noteAsset } = ctx
  const DEBUG = deps.debug
    const grassStage = (s: string) => { if (DEBUG) window.__grassStage = s; };
    try {
      grassStage('start');
      const gdocUrl = mapStaticUrl('grass', undefined, resolvedKey);
      const gbinUrl = mapStaticUrl('grassbin', undefined, resolvedKey);
      const gprotoUrl = mapStaticUrl('grassproto', undefined, resolvedKey);
      grassStage('urls=' + Boolean(gdocUrl) + '/' + Boolean(gbinUrl) + '/' + Boolean(gprotoUrl));
      if (gdocUrl && gbinUrl && gprotoUrl) return (async () => {
        const [dresp, bresp] = await Promise.all([
          assetProvider.fetch(gdocUrl), assetProvider.fetch(gbinUrl),
        ]);
        if (stale()) return;
        grassStage('fetch=' + dresp.status + '/' + bresp.status);
        if (dresp.ok && bresp.ok) {
          const gdoc = (await dresp.json()) as GrassDoc | null;
          const gbin = await bresp.arrayBuffer();
          if (stale()) return;
          const instances = gdoc ? parseGrassBin(gdoc, gbin) : null;
          grassStage('parsed=' + (gdoc ? 'doc' : 'nodoc') + ':' + (instances ? instances.length : 'null'));
          if (gdoc && instances && instances.length) {
            const protoGltf = await new Promise<ParsedGltf | null>((res) => {
              new GLTFLoader().load(gprotoUrl, (g) => res(g), undefined, () => res(null));
            });
            if (stale()) {
              if (protoGltf?.scene) deps.disposeObject3D(protoGltf.scene);
              return;
            }
            grassStage('gltf=' + Boolean(protoGltf && protoGltf.scene));
            if (protoGltf && protoGltf.scene) {
              const { geometries, albedo } = extractGrassPrototypes(protoGltf.scene);
              grassStage('geoms=' + geometries.length + ' albedo=' + Boolean(albedo));
              if (geometries.length) {
                const heightAtProbe = (cx: number, cy: number) => sampleHeight(-cx, cy);
                const built = buildGrassMeshes(gdoc, instances, geometries, {
                  albedo,
                  maxInstances: grassBudget,
                  heightAt: heightAtProbe,
                });
                scene.add(built.group);
                publish(built, protoGltf.scene);
                if (DEBUG) {
                  window.__grass = {
                    instances: instances.length, meshes: built.group.children.length,
                    variations: geometries.length,
                    prototypeVerts: geometries.map((g) => g.getAttribute('position')?.count ?? 0),
                    prototypeTris: geometries.map((g) => Math.floor((g.getIndex()?.count ?? 0) / 3)),
                    colorSample: [Math.round(instances[0].r * 255), Math.round(instances[0].g * 255),
                                  Math.round(instances[0].b * 255)],
                    firstInstanceScene: (() => {
                      const i0 = instances[0];
                      return [-i0.x, heightAtProbe(i0.x, i0.y), i0.y];
                    })(),
                    groupAttached: built.group.parent !== null,
                    heightField: hasHeightField(),
                    ySamples: [sampleHeight(-300, -300), sampleHeight(0, 0), sampleHeight(300, 300)],
                  };
                }
              } else {
                deps.disposeObject3D(protoGltf.scene);
              }
            }
          }
        } else {
          noteAsset('grass', `http-${dresp.status}/${bresp.status}`, '无草层数据', { optional: true });
        }
      })().catch(handleError)
    } catch (e) {
      handleError(e)
    }
    return undefined
    function handleError(e: unknown) {
      grassStage('error=' + errorMessage(e));
      console.warn('草层加载失败（已跳过）:', e);
      noteAsset('grass', 'failed', errorMessage(e), { optional: true });
    }
}
