import { describe, it, expect } from 'vitest'
import { playbackSceneSource } from './__tests__/sceneSource.ts'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const here = dirname(fileURLToPath(import.meta.url))
const readSrc = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const src = playbackSceneSource()
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const rendererSrc = readSrc(resolve(here, 'playback/renderer.ts'), 'utf8')
const mapAssetsSrc = readSrc(resolve(here, 'playback/mapAssets.ts'), 'utf8')
const matSrc = ['sceneryMaterials.ts', 'sceneryLightingMaterials.ts', 'sceneryWaterMaterials.ts', 'scenerySurfaceMaterials.ts'].map(path => readSrc(resolve(here, path), 'utf8')).join('\n')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const asmSrc = readSrc(resolve(here, 'sceneryAssembly.ts'), 'utf8')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const gpSrc = readSrc(resolve(here, 'groundPass.js'), 'utf8')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const stripComments = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
const mapWorldSrc = stripComments(readSrc(resolve(here, 'playback/mapWorld.ts')))
const mapLoaderSrc = stripComments(readSrc(resolve(here, 'playback/mapWorldLoader.ts')))
const vehSrc = stripComments(readSrc(resolve(here, 'playback/vehicleRuntime.ts')))
const vehiclePoseSrc = stripComments(readSrc(resolve(here, 'playback/vehicleModelPose.ts')))
const lblSrc = stripComments(readSrc(resolve(here, 'playback/labelsRuntime.ts')))

describe('场景绘制与回放接线合同', () => {


  it('对数深度缓冲：默认开启 + ?logdepth=0 逃生开关 + 两自定义 ShaderMaterial 挂 logdepthbuf 块（#827 F3: Integration Contract（无注入点）+ shader-lint PK）', () => {
    expect(src).toMatch(/(?:let )?LOGDEPTH = boolPref\('pb_logdepth', 'logdepth', false\);/)
    expect(src).toMatch(/(?:let )?DYNRES = boolPref\('pb_dynres', 'dynres', true\);/)
    expect(rendererSrc).toMatch(/logarithmicDepthBuffer: LOGDEPTH/)
    const billboard = matSrc.slice(matSrc.indexOf('function makeBillboardMaterial'))
    expect(billboard).toMatch(/#include <common>/)
    expect(billboard).toMatch(/#include <logdepthbuf_pars_vertex>/)
    expect(billboard).toMatch(/#include <logdepthbuf_vertex>/)
    expect(billboard).toMatch(/#include <logdepthbuf_pars_fragment>/)
    expect(billboard).toMatch(/#include <logdepthbuf_fragment>/)
    const ground = gpSrc.slice(gpSrc.indexOf('export function groundShaderMaterial'), gpSrc.indexOf('export function', gpSrc.indexOf('export function groundShaderMaterial') + 10))
    expect(ground).toMatch(/#include <common>/)
    expect(ground).toMatch(/#include <logdepthbuf_pars_vertex>/)
    expect(ground).toMatch(/#include <logdepthbuf_vertex>/)
    expect(ground).toMatch(/#include <logdepthbuf_pars_fragment>/)
    expect(ground).toMatch(/#include <logdepthbuf_fragment>/)
  })



  it('天空穹：unlit + 无限远方向投影 + 不写深度/不参与雾（此前整节点隐藏）', () => {
    expect(src).not.toMatch(/o\.visible = false/);
    const bakeSkySrc = readSrc(resolve(here, '..', '..', 'scripts', 'bake-ground-overhead.mjs'))
    expect(bakeSkySrc).toMatch(/assembleSceneryMaterials\(gltf, \{[\s\S]{0,500}skyFlagsAvailable,/)
    expect(mapAssetsSrc).toMatch(/buildStandaloneLightmappedMeshes\(allEntries/)
    expect(bakeSkySrc).toMatch(/buildStandaloneLightmappedMeshes\(allEntries/)
    expect(bakeSkySrc).toMatch(/hasTransparentMaterial\(e\.material\)/)
    expect(bakeSkySrc).toMatch(/variantMappingIncomplete === true/)
    expect(bakeSkySrc).not.toMatch(/\/sky\/i\.test\(e\.name/)
    const bakeFlagAt = bakeSkySrc.indexOf('sceneHasSkyFlags(gltf.scene)')
    const bakePruneAt = bakeSkySrc.indexOf('pruneForeignVariantsDetailed(gltf.scene')
    expect(bakeFlagAt).toBeGreaterThan(-1)
    expect(bakePruneAt).toBeGreaterThan(bakeFlagAt)
    expect(bakeSkySrc).toMatch(/variantPrune\.failClosed[\s\S]{0,200}throw new Error/)
    const skyStart = matSrc.indexOf('export function makeSkyMaterial');
    const sky = matSrc.slice(skyStart, matSrc.indexOf('export function', skyStart + 10));
    expect(sky).toMatch(/vec4\(position, 0\.0\)/);
    expect(sky).toMatch(/gl_Position = vec4\(p\.xy, p\.w, p\.w\);/);
    expect(sky).toMatch(/depthWrite: false,/);
    expect(sky).toMatch(/fog: false,/);
    expect(sky).toMatch(/side: THREE\.DoubleSide,/);
    expect(sky).toMatch(/THREE\.NoColorSpace/);
    expect(sky).not.toMatch(/lambert/i);
    expect(sky).not.toMatch(/logdepthbuf/);
  });



  it('场景 GLB 贴图各向异性随画质档（此前场景侧漏设=默认 1，掠射角发糊闪烁）', () => {
    expect(mapAssetsSrc).toMatch(/const aniso = Math\.min\(Q\.anisotropy, ctx\.renderer\.capabilities\.getMaxAnisotropy\(\)\);/);
    expect(mapAssetsSrc).toMatch(/applyMaterialTextureAnisotropy\(gltf\.scene, aniso\)/);
  });



  it('场景材质用几何 authored 法线（不设 flatShading——旧行为把它整条丢掉）', () => {
    expect(src).not.toMatch(/flatShading/);
    const bakeSrcNormals = readSrc(resolve(here, '..', '..', 'scripts', 'bake-ground-overhead.mjs'), 'utf8')
      .replace(/\/\/[^\n]*/g, '');
    expect(bakeSrcNormals).not.toMatch(/flatShading/);
  });



  it('俯视烘焙页消费同一装配 SSOT：convMat/键指纹/分派只有一处实现（两侧无本地副本）', () => {
    const bakeSrc = readSrc(resolve(here, '..', '..', 'scripts', 'bake-ground-overhead.mjs'), 'utf8')
      .replace(/\/\/[^\n]*/g, '')
    expect(bakeSrc).toMatch(/from '\/src\/scene\/sceneryMaterials\.js'/)
    expect(bakeSrc).toMatch(/from '\/src\/scene\/sceneryAssembly\.js'/)
    expect(bakeSrc).toMatch(/resolveSceneryExtras\(gltf\)/)
    expect(bakeSrc).toMatch(/makeTexResolvers\(gltf, sceneryExtras\)/)
    expect(bakeSrc).toMatch(/assembleSceneryMaterials\(gltf, \{/)
    expect(bakeSrc).not.toMatch(/const convMat = \(m, isCard\)/)
    expect(bakeSrc).not.toMatch(/cachedSceneryMat\(/)
    expect(mapAssetsSrc).toMatch(/import \{ resolveSceneryExtras, makeTexResolvers, assembleSceneryMaterials \} from '\.\.\/sceneryAssembly\.js'/)
    expect(src).not.toMatch(/const convMat = \(m, isCard\)/)
    const order = ['if (ud.water && typeof ud.water === ', 'if (ud.blendByAngle) {',
      'if (ud.decal && groundLayers && o.geometry.attributes.uv1) {',
      'if (ud.lightmap !== undefined && ', 'const maskTex = ud.blendLayer ? maskTexOf(m) : null;',
      'if (uw) {', 'return convMat(m, isCard);']
    let prev = -1
    for (const anchor of order) {
      const at = asmSrc.indexOf(anchor)
      expect(at, anchor).toBeGreaterThan(prev)
      prev = at
    }
    expect(bakeSrc).toMatch(/from '\/src\/scene\/sceneryAssemblyRules\.js'/)
    expect(bakeSrc).toMatch(/const strictSurfaces = strictSurfacesOf\(gltf\.scene\)/)
    expect(bakeSrc).toMatch(/bakeDropNode\(nm, o\.material,/)
    expect(bakeSrc).not.toMatch(/\|water\|sea\|river\|lake/)
    expect(mapAssetsSrc).toMatch(/from '\.\.\/sceneryAssemblyRules\.js'/)
  })



describe('__hullGroup 挂点（车体 = 记录位姿；逐轮悬挂见下方「悬挂接线」组）', () => {
  it('底盘（chassis_track_*/chassis_wheel_*）与车体子树分离，挂点恒归单位；命名不符则回落整台刚体', () => {
    expect(vehSrc).not.toMatch(/terrainPitchRoll/)
    expect(vehSrc).not.toMatch(/clampHullAttitude/)
    expect(vehSrc).not.toMatch(/poseLocalBetween/)
    expect(vehSrc).toMatch(/const hullG = new THREE\.Group\(\); hullG\.name = '__hullGroup';/)
    expect(vehSrc).toMatch(/hullGroup: hullG,/)
  })
})



describe('悬挂接线（轮/带逐帧解算，客户端同构）', () => {
  it('悬挂逐帧解算宿主接线（#827 F3：无注入点）：markSeekSnap → tick → clearSnap、frameTiming 喂帧', () => {
    expect(src).toMatch(/vehicles\.markSeekSnap\(\);[\s\S]{0,160}tick\(\);/)
    expect(src).toMatch(/for \(const v of vehicles\.getVehicles\(\)\) vehicles\.applyPose\(v\);[\s\S]{0,80}vehicles\.clearSnap\(\);/)
    expect(src).toMatch(/vehicles\.frameTiming\(dt, false\);[\s\S]{0,80}tick\(\);/)
  })


  it('只动底盘节点（chassis_wheel_* / chassis_track_*）：轮数/链数不符即 fail-closed', () => {
    expect(vehiclePoseSrc).toMatch(/applyWheelSpin\(w\.node, w\.restPos, w\.restQuat, w\.pivot, w\.restPivotRot,/)
    expect(vehiclePoseSrc).toMatch(/node\.parent\.worldToLocal\(ctr\.clone\(\)\)/)
    expect(vehiclePoseSrc.replace('applyWheelSpin(w.node,', 'removedWheelSpin(w.node,')).not.toMatch(/applyWheelSpin\(w\.node, w\.restPos, w\.restQuat, w\.pivot, w\.restPivotRot,/)
  })

})



describe('播放时钟与速度档位（对齐上游的纯函数入口）', () => {
  it('推进走 advancePlaybackTime（NaN/负增量不污染时钟），终点钳制仍生效（#827 F3：宿主接线子句；纯函数行为见 playback/util.behavior.test.ts）', () => {
    expect(src).toMatch(/T = advancePlaybackTime\(T, END, dt \* 1000, SPEED\);/)
    expect(src).not.toMatch(/T \+= dt \* SPEED;/)
  })

  it('setSpeed 只接受档位表内的值（#827 F3: Integration Contract（无注入点）；宿主闭包函数无独立 owner）', () => {
    expect(src).toMatch(/function setSpeed\(s(?:: number)?\) \{\s+if \(!isPlaybackSpeed\(s\)\) return;\s+if \(SPEED !== s && perf\) perf\.interrupt\('speed-change'\);\s+SPEED = s;\s+store\.speed = s;/)
  })

  it('onResize 单画布取整尺寸 + 置脏重绘（#827 F3: Integration Contract（无注入点）；宿主闭包函数）', () => {
    const resize = src.slice(src.indexOf('function onResize'), src.indexOf('function onScenePointerDown'))
    expect(resize).toMatch(/const w = Math\.max\(1, Math\.round\(container\.clientWidth\)\);/)
    expect(resize).toMatch(/renderer\.setSize\(w, h\);/)
    expect(resize).toMatch(/invalidate\(\);/)
    expect(resize).not.toMatch(/labelRenderer/)
  })

  it('覆盖层并入主画布：不再有第二个 WebGL 上下文，也没有第二次 render', () => {
    expect(src).not.toMatch(/labelRenderer/)
    const rendererSrc = readSrc(resolve(here, 'playback/renderer.ts'), 'utf8')
    const ctor = [...(src.match(/new THREE\.WebGLRenderer\(/g) || []), ...(rendererSrc.match(/new THREE\.WebGLRenderer\(/g) || [])]
    expect(ctor.length).toBe(1)
    const animate = src.slice(src.indexOf('function animate()'))
    expect(animate).toMatch(/renderer\.render\(scene, camera\);/)
    expect(animate).not.toMatch(/autoClear/)
  })

  it('特效走对象池：到期归池而非 dispose，池只在会话结束时整体释放', () => {
    expect(src).toMatch(/battle\.dispose\(\);/)
  })

  it('装填条求值：关标签或 T 未变时跳过（暂停/关标签不再每车每帧全量求值）', () => {
    expect(lblSrc, '装填中 33ms').toMatch(/const LABEL_INTERVAL_RELOAD_MS = 33;/)
    expect(lblSrc, '空闲 100ms（原值）').toMatch(/const LABEL_INTERVAL_IDLE_MS = 100;/)
  })

  it('HUD 降频：store.time/seekFrac 不再每帧写，seek 时强制补一次（#827 F3: Integration Contract（无注入点））', () => {
    expect(src).toMatch(/(?:const )?HUD_INTERVAL_MS = 100;/)
    expect(src).toMatch(/function writeHud\(force = false\)/)
    expect(src).toMatch(/writeHud\(true\);/)
    const tick = src.slice(src.indexOf('function tick()'), src.indexOf('function writeHud'))
    expect(tick).not.toMatch(/store\.time = T;/)
  })

  it('资产加载走有限并发（地表贴图 / 坦克 GLB 都受上限约束）', () => {
    expect(mapLoaderSrc).toMatch(/await mapLimit\(need, ASSET_CONCURRENCY/)
    expect(mapLoaderSrc.replace('await mapLimit(need, ASSET_CONCURRENCY', '')).not.toMatch(/await mapLimit\(need, ASSET_CONCURRENCY/)
    expect(vehSrc).toMatch(/await mapLimit\(V\.filter\(v => v\.def\.tank_id > 0\), ASSET_CONCURRENCY/)
  })

  it('GLB 位姿零分配：poseFromYPR 支持 out 参数，poseGlb 用模块级 scratch', () => {
    expect(vehiclePoseSrc).toMatch(/v\.glb\.position\.copy\(pos\);/)
    expect(vehiclePoseSrc).toMatch(/poseGlbRig\(v, deps\.getT\(\), v\.group\.position\);\s*suspensionStep\(v\);/)
    const glb = vehiclePoseSrc.slice(vehiclePoseSrc.indexOf('function poseGlb'), vehiclePoseSrc.indexOf('function glbGunWorld'))
    expect(glb).not.toMatch(/terrainPitchRoll|clampHullAttitude|sampleHeight/)
    expect(glb).not.toMatch(/new THREE\.Matrix4\(\)/)
    expect(glb).not.toMatch(/new THREE\.Euler\(\)/)
    expect(glb).toMatch(/_mAcc\.copy\(mT\)\.multiply\(tn\.userData\.__bake as THREE\.Matrix4\)/)
  })

  it('按需渲染：脏帧判定覆盖播放/相机/特效/幽灵闪，跳帧时不跑更新与 render', () => {
    const animate = src.slice(src.indexOf('function animate()'))
    expect(animate).toMatch(/const busy = PLAYING/)
    expect(animate).toMatch(/\|\| cameraMoved/)
    expect(animate).toMatch(/\|\| frameDirty/)
    expect(animate).toMatch(/\|\| battle\.isActive\(\);/)
    expect(animate).toMatch(/if \(!busy\) \{(?:.|\n){0,600}?return;/)
    expect(animate.indexOf('frameDirty = false;')).toBeGreaterThan(animate.indexOf('if (!busy) {'))
  })
})
})
