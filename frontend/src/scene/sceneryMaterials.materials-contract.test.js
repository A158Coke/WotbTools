

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
const mapAssetsSrc = readSrc(resolve(here, 'playback/mapAssets.ts'), 'utf8')
const matSrc = ['sceneryMaterials.ts', 'sceneryLightingMaterials.ts', 'sceneryWaterMaterials.ts', 'scenerySurfaceMaterials.ts'].map(path => readSrc(resolve(here, path), 'utf8')).join('\n')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const asmSrc = readSrc(resolve(here, 'sceneryAssembly.ts'), 'utf8')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const stripComments = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
const mapWorldSrc = stripComments(readSrc(resolve(here, 'playback/mapWorld.ts')))
const matDisposeSrc = stripComments(readSrc(resolve(here, 'materialDispose.ts')))

describe('场景 GLB 材质管线（对齐上游的渲染实现）', () => {

  it('材质实例按 key 去重：convMat 经 cachedSceneryMat，键含 alphaTest/transparent', () => {
    expect(asmSrc).toMatch(/const convMat = \(m: GltfSceneMaterial, isCard: boolean\) => cachedSceneryMat\(/)
    const key = asmSrc.slice(asmSrc.indexOf('const convMat = (m: GltfSceneMaterial, isCard: boolean) => cachedSceneryMat('))
    expect(key.slice(0, 900)).toMatch(/m\.alphaTest \?\? 0/)
    expect(key.slice(0, 900)).toMatch(/!!m\.transparent/)
    expect(key.slice(0, 900)).toMatch(/m\.map \? m\.map\.uuid : ''/)
    expect(mapAssetsSrc).toMatch(/from '\.\.\/sceneryAssembly\.js'/)
    expect(src).not.toMatch(/const convMat = \(m, isCard\)/)
  })



  it('disposeObject3D 经 collectMaterialTextures 回收纹理（含 ShaderMaterial uniforms）', () => {
    expect(src).toMatch(/import \{ ?(?:collectMaterialTextures, )?disposeObject3D(?:, collectMaterialTextures)? \} from '(?:\.\/|\.\.\/)materialDispose\.js'/)
    const at = matDisposeSrc.indexOf('export function disposeObject3D')
    expect(at).toBeGreaterThan(-1)
    expect(matDisposeSrc.slice(at, at + 900)).toMatch(/collectMaterialTextures\(m, texs\)/)
  })



  it('材质缓存随会话释放（勿复用已 dispose 实例）', () => {
    const at = mapWorldSrc.indexOf('function dispose()')
    expect(at).toBeGreaterThan(-1)
    expect(mapWorldSrc.slice(at, at + 1200)).toMatch(/clearSceneryMatCache\(\);/)
    expect(src).toMatch(/mapWorld\.dispose\(\);/)
  })



  it('真混合层（extras.blendLayer）保留软 alpha：不被伪透明分流削成硬边卡片', () => {
    const bakeSrcBlend = readSrc(resolve(here, '..', '..', 'scripts', 'bake-ground-overhead.mjs'), 'utf8');
    expect(bakeSrcBlend).toMatch(/from '\/src\/scene\/sceneryAssembly\.js'/);
    expect(bakeSrcBlend).toMatch(/assembleSceneryMaterials\(gltf, \{/);
    expect(bakeSrcBlend).not.toMatch(/!blendLayer && !softAlpha/);
  });



  it('动画混合层：双采样器（albedo 走 UV0+位移 / 掩码走 UV1）+ 回放时钟驱动', () => {
    const matStart = matSrc.indexOf('export function makeBlendLayerMaterial');
    const fn = matSrc.slice(matStart, matSrc.indexOf('export function', matStart + 10));
    expect(fn).toMatch(/attribute vec2 uv1;/);
    expect(fn).toMatch(/vUv1 = uv1;/);
    expect(fn).toMatch(/fract\(uShiftRate \* uTime\)/);
    expect(fn).toMatch(/float a = texture2D\(mask, vUv1\)\.a;/);
    expect(fn).toMatch(/transparent: true,/)
    expect(fn).toMatch(/depthWrite: false,/)
    expect(fn).toMatch(/USE_INSTANCING/)
    expect(src).toMatch(/for \(const mm of animLayerMats\) mm\.uniforms\.uTime\.value = secs;/)
    expect(src).toMatch(/const secs = T \/ 1000;/)
  })



  it('自定义材质的 varying 必须在顶点着色器里被赋值（"只声明不写"会让整材质链接失败）', () => {
    const shaders = [...matSrc.matchAll(/vertexShader:\s*`([^`]*)`/g)].map((m) => m[1]);
    expect(shaders.length).toBeGreaterThanOrEqual(4);
    for (const sh of shaders) {
      const decls = [...sh.matchAll(/varying\s+\w+\s+(\w+)\s*;/g)].map((m) => m[1]);
      expect(decls.length).toBeGreaterThan(0);
      for (const name of decls) {
        expect(sh.includes(name + ' =')).toBe(true);
      }
    }
    const pairs = [...matSrc.matchAll(/vertexShader:\s*`([^`]*)`[\s\S]{0,200}?fragmentShader:\s*`([^`]*)`/g)];
    expect(pairs.length).toBeGreaterThanOrEqual(4);
    for (const [, vs, fs] of pairs) {
      const vNames = new Set([...vs.matchAll(/varying\s+\w+\s+(\w+)\s*;/g)].map((m) => m[1]));
      const fNames = [...fs.matchAll(/varying\s+\w+\s+(\w+)\s*;/g)].map((m) => m[1]);
      for (const name of fNames) expect(vNames.has(name)).toBe(true);
    }
  })



  it('环境反射（ENVIRONMENT_MAPPING）：遮罩×菲涅尔×天空立方图，含高光项', () => {
    const at = matSrc.indexOf('export function makeLightmappedMaterial');
    const fn = matSrc.slice(at, matSrc.indexOf('export function', at + 10));
    expect(fn).toMatch(/R = reflect\(V, N\);/);
    expect(fn).toMatch(/F = uEnvFresnel \+ \(1\.0 - uEnvFresnel\) \* pow\(1\.0 - NdotV, 5\.0\);/);
    expect(fn).toMatch(/vec3 envMult = F \* \(uEnvBrighten \/ 3\.0\);/);
    expect(fn).toMatch(/float maskScaled = min\(envMaskValue \* uEnvMaskMul, 1\.0\);/);
    expect(fn).toMatch(/vec3 lightenLM = clamp\(lm \* uEnvMultLM, 0\.0, 1\.0\);/);
    expect(fn).toMatch(/float glossPower = pow\(5000\.0, uEnvGloss \* envMaskValue\);/);
    expect(fn).toMatch(/color = mix\(color, color \* uEnvAddDiffuse \+ refl, min\(envMaskValue \* uEnvLerp, 1\.0\)\)/);
    expect(fn).toMatch(/\+ specular \* maskScaled;/);
    expect(fn).toMatch(/vWorldN = normalize\(mat3\(im\) \* normal\);/);
    expect(fn).toMatch(/0\.5 - asin\(clamp\(d\.y, -1\.0, 1\.0\)\) \* 0\.3183098861837907/);
    expect(fn).toMatch(/#ifdef ENV_REFLECTION/);
    expect(fn).not.toMatch(/#if ENV_REFLECTION/);
  })



  it('水面（MEDIUM 档）：双层滚动法线 + UDN + 菲涅尔 alpha + 逐图立方图', () => {
    const at = matSrc.indexOf('export function makeWaterMaterial');
    const fn = matSrc.slice(at, matSrc.indexOf('export function', at + 10));
    expect(fn).toMatch(/vec2 uv1 = vec2\(vUv\.x \+ vUv\.y, vUv\.y - vUv\.x\) \* uN1Scale \+ fract\(uShift1 \* uTime\);/);
    expect(fn).toMatch(/normalize\(n0 \+ n1 - vec3\(1\.0\)\)/);
    expect(fn).toMatch(/cotangentFrame\(normalize\(vWorldN\), vWorldP, vUv\)/);
    expect(fn).toMatch(/float fresnel = uFresnelBias \+ \(1\.0 - uFresnelBias\) \* pow\(1\.0 - lambertFactor, uFresnelPow\);/);
    expect(fn).toMatch(/R\.y = abs\(R\.y\);/);
    expect(fn).toMatch(/transparent: true,/);
    expect(fn).toMatch(/depthWrite: true,/);
    expect(fn).not.toMatch(/albedoTex|decalTex|uReflectance\b|uDecalTint/);
    expect(fn).toMatch(/pow\(5000\.0, uGlossiness\)/);
    expect(fn).toMatch(/uSunSpecColor \* specTerm \* \(NdotL \* uSpecularity \* F\)/);
    expect(asmSrc).toMatch(/cachedSceneryMat\(\s*\['W', m\.uuid/)
    expect(asmSrc).toMatch(/makeWaterMaterial\(m, \{/)
    expect(asmSrc).toMatch(/coast: waterCoast, wro: ud\.water,/)
    expect(asmSrc).toMatch(/u\.uTime && !\(mm\.userData && mm\.userData\.water\)/)
    expect(src).toMatch(/for \(const mm of animLayerMats\) mm\.uniforms\.uTime\.value = secs;/);
  })



  it('烘焙光照图：albedo × lightmap(UV1×逐实例变换) × 2、不受光、镂空保留', () => {
    const at = matSrc.indexOf('export function makeLightmappedMaterial');
    const fn = matSrc.slice(at, matSrc.indexOf('export function', at + 10));
    expect(fn).toMatch(/attribute vec2 uv1;/);
    expect(fn).toMatch(/attribute vec4 aLm;/);
    expect(fn).toMatch(/vLmUv = uv1 \* aLm\.xy \+ aLm\.zw;/);
    expect(fn).toMatch(/vec3 color = c\.rgb \* uTint \* lm \* 2\.0;/);
    expect(fn).toMatch(/gl_FragColor = vec4\(color, 1\.0\);/);
    expect(fn).not.toMatch(/lambert|MeshBasic|lights/i);
    expect(fn).toMatch(/USE_INSTANCING/);
    expect(fn).toMatch(/if \(uAlphaCut > 0\.0 && c\.a < uAlphaCut\) discard;/);
    const instSrc = readSrc(resolve(here, 'sceneryInstancing.ts'), 'utf8')
    expect(instSrc).toMatch(/lm: \(mesh\.userData && Array\.isArray\(mesh\.userData\.lm\)\) \? mesh\.userData\.lm : null,/)
    expect(instSrc).toMatch(/new THREE\.InstancedBufferAttribute\(arr, 4\)/)
    expect(instSrc).toMatch(/g\.setAttribute\(name, batch\.geometry\.attributes\[name\]\)/)
    expect(instSrc).not.toMatch(/batch\.geometry\.clone/)
  })



  it('细节层（B1）：uv0×scale 采样 ×2 乘入，位置在环境反射之后；两条路径都接线', () => {
    const at = matSrc.indexOf('export function makeLightmappedMaterial');
    const fn = matSrc.slice(at, matSrc.indexOf('export function', at + 10));
    expect(fn).toMatch(/vDetailUv = uv \* uDetailScale;/);
    expect(fn).toMatch(/color \*= texture2D\(uDetailTex, vDetailUv\)\.rgb \* 2\.0;/);
    expect(fn).toMatch(/#ifdef MATERIAL_DETAIL/);
    expect(fn.lastIndexOf('#ifdef MATERIAL_DETAIL'))
      .toBeGreaterThan(fn.indexOf('#ifdef ENV_REFLECTION'));
    expect(fn.indexOf('uDetailTex, vDetailUv).rgb * 2.0;'))
      .toBeLessThan(fn.indexOf('gl_FragColor = vec4(color, 1.0);'));
    const pat = matSrc.indexOf('export function patchSceneryDetail');
    const pfn = matSrc.slice(pat, matSrc.indexOf('export function', pat + 10));
    expect(pfn).toMatch(/diffuseColor\.rgb \*= texture2D\(uDetailTex, vDetailUv\)\.rgb \* 2\.0;/);
    expect(pfn).toMatch(/\|scenery-detail/);
    const bake = readSrc(resolve(here, '../../scripts/bake-ground-overhead.mjs'), 'utf8')
    expect(bake).toMatch(/assembleSceneryMaterials\(gltf, \{/);
    expect(bake).not.toMatch(/const convMat = \(m, isCard\)/);
    expect(bake).not.toMatch(/const detailTexOf = \(\) => null;/);
  })
})
