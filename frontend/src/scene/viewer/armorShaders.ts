// 装甲查看器穿透材质族（2026-10-24 自 tankViewer 闭包出仓，#741；
// 代码与搬移前逐字一致，仅去一层闭包缩进并加 export）。
// 覆盖：PBR 穿透热力图主材质（penetrationMaterial，逐行对齐 BlitzKit
// PrimaryArmorSceneComponent fragment.glsl）、外部模块/履带等效层（externalMaterial、
// moduleStateMaterial）、间隙甲双通道（spacedMaterial 厚度累计 / spacedStateMaterial
// 最近层跳弹-续飞状态）与跳弹续飞共享 uniforms（rcUniforms——同一对象引用注入全部
// 材质，grid 侧单点更新全体生效；数据面机制在 armorCollisionPack.js）。
// 消费方 tankViewer 经导入使用；材质语义/通道口径的注释随代码原样保留。
import * as THREE from 'three'
import type { Plane, Side, ShaderMaterial } from 'three'
import { RC_GLSL_CONST, RC_GLSL_FUNCS } from '../armorCollisionPack.js'
import { PBR_FRAG, PBR_VERT } from './armorPrimaryShader.js'
export { PBR_FRAG, PBR_VERT }

const EXTERNAL_VERT = `
    #include <clipping_planes_pars_vertex>
    void main() {
      #include <begin_vertex>
      #include <project_vertex>
      #include <clipping_planes_vertex>
    }
`;
const EXTERNAL_FRAG = `
    uniform float thickness;
    uniform float penetration;
    #include <clipping_planes_pars_fragment>
    void main() {
      #include <clipping_planes_fragment>
      gl_FragColor = vec4(thickness / penetration, 0.0, thickness / penetration, 1.0);
    }
`;
/** 辅助 RT 的深度占位：内建材质在 ?logdepth 渲染器下写对数深度，与 spaced 标准深度不同域。 */
export function standardDepthMaterial(side: Side = THREE.FrontSide): ShaderMaterial {
    return new THREE.ShaderMaterial({
        vertexShader: EXTERNAL_VERT, fragmentShader: DEPTH_ONLY_FRAG,
        colorWrite: false, depthTest: true, depthWrite: true, side, clipping: true,
    });
}
/**
 * 厚度通道 RT 的深度纹理（带 stencil 附件）：DepthStencilFormat 是 stencil 去重的
 * 硬前提——three 对自带 depthTexture 的 target 只按纹理格式挂 DEPTH(_STENCIL)_ATTACHMENT，
 * DepthFormat + stencilBuffer:true 不会创建 stencil 附件（测试恒通过 = 去重失效）。
 * 首建与 resize 重建（tankViewer.syncPenetrationRT / armorHighlight.ensureTargets）
 * 必须共用本工厂，避免重建路径退回 DepthFormat。
 */
export function createDepthStencilTexture(width: number, height: number): THREE.DepthTexture {
    const depth = new THREE.DepthTexture(width, height);
    depth.format = THREE.DepthStencilFormat;
    depth.type = THREE.UnsignedInt248Type;
    return depth;
}
export function externalMaterial(thickness: number, penetration: number | null | undefined, clip: Plane | null | undefined): ShaderMaterial {
    return new THREE.ShaderMaterial({
        vertexShader: EXTERNAL_VERT, fragmentShader: EXTERNAL_FRAG,
        depthWrite: false, depthTest: true,
        blending: THREE.AdditiveBlending,
        // 无裁切面时省略 clipping/clippingPlanes（与传 false/null 的默认值等价）
        ...(clip != null ? { clipping: true, clippingPlanes: [clip] } : {}),
        uniforms: { thickness: { value: thickness }, penetration: { value: penetration || 200 } },
    });
}
// 辅助 RT 恒写标准深度（spaced 距离按标准投影反算），不挂 logdepthbuf。
const SPACED_VERT = `
    varying highp vec3 vNormal;
    varying highp vec3 vViewPos;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vViewPos = mv.xyz;
      vNormal = normalMatrix * normal;
      gl_Position = projectionMatrix * mv;
    }
`;
const DEPTH_ONLY_FRAG = `
    #include <clipping_planes_pars_fragment>
    void main() {
      #include <clipping_planes_fragment>
      gl_FragColor = vec4(0.0);
    }
`;
// 厚度通道（RT0，additive，R 累计）：每块间隙板按 BlitzKit 独立计算
// finalNorm（2× 口径增强按本层厚度）与 finalThickness，写 R=finalThickness/penetration；
// G=间隙甲层标记；外部模块写 flat R/coverage、不写 G。
// 状态通道（RT1）只负责最近层的跳弹标志/续飞编码；外部模块写 A=1 抑制其后的
// 间隙板跳弹/续飞。PBR 直接累加 RT0.R，不再做“首层/最近层差额”修正。
const SPACED_FRAG = `
    precision highp float;
    varying highp vec3 vNormal;
    varying highp vec3 vViewPos;
    uniform float thickness;
    uniform float penetration;
    uniform float caliber;
    uniform float ricochet;
    uniform float normalization;
    void main() {
      highp vec3 viewDir = normalize(vViewPos);
      // 同一 flat vNormal 面法线；不要用 dFdx/dFdy(vViewPos)（移动端 mediump 导数会错乱）。
      // 视线方向用 highp：500 m 处 mediump length() 会在平方时溢出。
      highp vec3 nFace = normalize(vNormal);
      // BackSide clone（开放板出射面）：three 以翻转 gl.frontFace 实现 BackSide，
      // 被保留的背面片元在 GL 里是 front-facing（gl_FrontFacing == true）。必须按
      // FLIP_SIDED 显式翻回几何法线——否则入射角变成 π−θ、cos 落 1e-6 下界，
      // 等效厚度爆炸（20mm 背面屏会被算成 2e7mm）。
      #ifdef FLIP_SIDED
        nFace = -nFace;
      #endif
      // 双面材质（间隙甲）：背面命中把法线翻向相机来向，与点击链 classifyHit 同口径；
      // 正面命中不受影响。
      if (!gl_FrontFacing) nFace = -nFace;
      highp float angle = acos(clamp(dot(nFace, -viewDir), -1.0, 1.0));
      // RT1 只对最近的间隙板做跳弹判定；本 additive 通道只累计各层
      // normalized effective，后续高倾角间隙板不能被写成 R=1（CPU layerIndex>0 已抑制跳弹）。
      bool twoCal = caliber > thickness * 2.0 && thickness > 0.0;
      float finalNorm = twoCal
        ? (1.4 * normalization * caliber) / (2.0 * thickness)
        : normalization;
      // 与 resolveLayerGeometry 同一 1e-6 余弦下界，防掠射角 inf/负厚度。
      highp float finalThick = thickness / max(cos(max(0.0, angle - finalNorm)), 1e-6);
      gl_FragColor = vec4(finalThick / penetration, 1.0, 0.0, 1.0);
    }
`;
// 状态通道（RT1，NoBlending + depthWrite=true）：只有沿视线**最近**的间隙板能写入——
// 不可累加的跳弹标志/续飞编码与逐层 normalized R 累计分离。续飞就地执行，反射起点/
// 法线 = 本间隙板自身（不得复用其后主装甲）。输出：R = 首层跳弹标志；
// G = 续飞结果编码（0.0 = 无结果（紫）；(0.2,0.8) = 击穿概率带；1.0 = 被挡（红））。
const SPACED_STATE_FRAG = `
    precision highp float;
    varying highp vec3 vNormal;
    varying highp vec3 vViewPos;
    uniform float thickness;
    uniform float penetration;
    uniform float caliber;
    uniform float ricochet;
    uniform float normalization;
    ${RC_GLSL_CONST}
    ${RC_GLSL_FUNCS}
    void main() {
      highp vec3 viewDir = normalize(vViewPos);
      // 同一 flat vNormal 面法线；不要用 dFdx/dFdy(vViewPos)（移动端 mediump 导数会错乱）。
      // 视线方向用 highp：500 m 处 mediump length() 会在平方时溢出。
      highp vec3 nFace = normalize(vNormal);
      // 双面材质（间隙甲）：背面命中把法线翻向相机来向，与点击链 classifyHit 同口径；
      // 正面命中不受影响。
      if (!gl_FrontFacing) nFace = -nFace;
      highp float angle = acos(clamp(dot(nFace, -viewDir), -1.0, 1.0));
      bool threeCal = caliber > thickness * 3.0;
      bool ricocheted = !threeCal && angle >= ricochet;
      // R 通道已逐层写 normalized effective；状态通道不再需要 normalization 差额。
      float bCode = 0.0;
      highp float rcDiag = 0.0;
      if (ricocheted && rcMode >= 1) {
        highp mat3 vRotT = transpose(mat3(viewMatrix));
        highp vec3 wPosR = vRotT * (vViewPos - viewMatrix[3].xyz);
        highp vec3 incR = viewDir;
        highp vec3 nVR = nFace;
        highp vec3 rVR = incR - 2.0 * dot(incR, nVR) * nVR;
        highp vec3 reflR = normalize(vRotT * rVR);
        highp float contChance = 0.0;
        int contCls = rcContinue(wPosR, reflR, penetration * RC_RICO_MUL, contChance, rcDiag);
        if (contCls == 1) bCode = 0.2 + 0.6 * clamp(contChance, 0.0, 1.0);
        else if (contCls == 2) {
          // 名义被挡但概率为 1–99%：编码概率带（与卡片“可能击穿 p%”一致）；
          // 0%/100% 仍编码 1.0 = 硬红（卡片隐藏概率、显示 BLOCKED）。
          float p = clamp(contChance, 0.0, 1.0);
          float pct = floor(p * 100.0 + 0.5);
          bCode = (pct >= 1.0 && pct <= 99.0) ? 0.2 + 0.6 * p : 1.0;
        }
        // 防编译器消除 rcContinue 调用：out 参数副作用必须可能被观测
        if (rcDiag > 1e30) bCode = -1.0;
      }
      // A=0：本片元是间隙甲（不是外部模块）；模块状态材质写 A=1，PBR 据此抑制
      // 「模块在前」时其后间隙板的跳弹/续飞。
      gl_FragColor = vec4(ricocheted ? 1.0 : 0.0, bCode, rcDiag / 255.0, 0.0);
    }
`;
// 外部模块状态材质（RT1）：只把 A 置 1（= 最近覆盖层是外部模块），RGB 保留——
// 其后间隙板的跳弹/续飞状态不得被模块覆盖。RGB src=0/dst=1，A src=1/dst=0。
// 模块不是装甲层：它在前时抑制其后间隙板的跳弹/续飞。
const MODULE_STATE_FRAG = `
    #include <clipping_planes_pars_fragment>
    void main() {
      #include <clipping_planes_fragment>
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    }
`;
export function moduleStateMaterial(clip: Plane | null | undefined): ShaderMaterial {
    return new THREE.ShaderMaterial({
        vertexShader: EXTERNAL_VERT, fragmentShader: MODULE_STATE_FRAG,
        depthWrite: true, depthTest: true,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.ZeroFactor, blendDst: THREE.OneFactor,
        blendEquationAlpha: THREE.AddEquation,
        blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.ZeroFactor,
        ...(clip != null ? { clipping: true, clippingPlanes: [clip] } : {}),
    });
}

/**
 * 每个 viewer 一份的穿透材质**运行态**：穿透分辨率 uniform、跳弹续飞共享 uniforms、
 * 空白占位纹理，以及把材质绑定到这些对象上的工厂。**不得提升为模块单例**——
 * 两个 viewer 生命周期重叠时，A 的更新/重建/清理会直接改到 B 正在使用的 uniforms。
 */
export function createArmorShaderContext() {
    const resUniform = { value: new THREE.Vector2(1, 1) };   // 共享分辨率（低清/全清 pass 每帧切换）

    const rcUniforms: Record<string, { value: unknown }> & {
        rcClipPlane: { value: THREE.Vector4 };
        rcClipEnabled: { value: boolean };
    } = {
        rcThickMul: { value: 1 },
        rcEnabled: { value: false },
        rcMode: { value: 0 },
        rcWorldTris: { value: null },
        rcTriRows: { value: 1 },
        rcGridCells: { value: null },
        rcGridEntries: { value: null },
        rcGridMin: { value: new THREE.Vector3(0, 0, 0) },
        rcCell: { value: 0.45 },
        rcGridDimsF: { value: new THREE.Vector3(1, 1, 1) },
        rcCellRows: { value: 1 },
        rcEntryRows: { value: 1 },
        rcEntryTotal: { value: 0 },
        // gun_mask 裁切面（世界系 xyz=normal, w=constant）：只过滤 gunBarrel 命中。
        rcClipPlane: { value: new THREE.Vector4() },
        rcClipEnabled: { value: false },
    };
    function penetrationMaterial(thickness: number): ShaderMaterial {
        return new THREE.ShaderMaterial({
            vertexShader: PBR_VERT, fragmentShader: PBR_FRAG,
            transparent: true, depthWrite: false,
            uniforms: {
                thickness: { value: thickness },
                penetration: { value: 200 },
                caliber: { value: 120 },
                ricochet: { value: 70.0 * Math.PI / 180 },
                normalization: { value: 0.0 },
                greenPenetration: { value: false },
                advancedHighlighting: { value: true },
                opaque: { value: false },
                isExplosive: { value: false },
                canSplash: { value: false },
                damage: { value: 0 },
                explosionRadius: { value: 0 },
                heActive: { value: false },
                heCenter: { value: new THREE.Vector3(0, 0, 0) },
                heatmapMask: { value: false },
                resolution: resUniform,
                metersPerUnit: { value: 1 },
                opacity: { value: 1 },
                spacedArmorBuffer: { value: emptySpacedTexture() },
                spacedArmorDepth: { value: null },
                spacedStateBuffer: { value: emptySpacedTexture() },
                spacedSatGuard: { value: 0 },
                spacedRect: { value: new THREE.Vector4(0, 0, 1, 1) },
                inverseProjectionMatrix: { value: null },
                rcThickMul: rcUniforms.rcThickMul,
                rcEnabled: rcUniforms.rcEnabled,
                rcMode: rcUniforms.rcMode,
                rcWorldTris: rcUniforms.rcWorldTris,
                rcTriRows: rcUniforms.rcTriRows,
                rcGridCells: rcUniforms.rcGridCells,
                rcGridEntries: rcUniforms.rcGridEntries,
                rcGridMin: rcUniforms.rcGridMin,
                rcCell: rcUniforms.rcCell,
                rcGridDimsF: rcUniforms.rcGridDimsF,
                rcCellRows: rcUniforms.rcCellRows,
                rcEntryRows: rcUniforms.rcEntryRows,
                rcEntryTotal: rcUniforms.rcEntryTotal,
                rcClipPlane: rcUniforms.rcClipPlane,
                rcClipEnabled: rcUniforms.rcClipEnabled,
            },
        });
    }
    /** 间隙板两通道共享 uniforms（与穿透材质同一对象引用共享续飞变量——单点更新全体生效）。 */
    function spacedCommonUniforms(thickness: number, penetration: number | null | undefined) {
        return {
            thickness: { value: thickness }, penetration: { value: penetration || 200 },
            caliber: { value: 120 }, ricochet: { value: 70 * Math.PI / 180 }, normalization: { value: 0 },
            rcThickMul: rcUniforms.rcThickMul,
            rcEnabled: rcUniforms.rcEnabled,
            rcMode: rcUniforms.rcMode,
            rcWorldTris: rcUniforms.rcWorldTris,
            rcTriRows: rcUniforms.rcTriRows,
            rcGridCells: rcUniforms.rcGridCells,
            rcGridEntries: rcUniforms.rcGridEntries,
            rcGridMin: rcUniforms.rcGridMin,
            rcCell: rcUniforms.rcCell,
            rcGridDimsF: rcUniforms.rcGridDimsF,
            rcCellRows: rcUniforms.rcCellRows,
            rcEntryRows: rcUniforms.rcEntryRows,
            rcEntryTotal: rcUniforms.rcEntryTotal,
            rcClipPlane: rcUniforms.rcClipPlane,
            rcClipEnabled: rcUniforms.rcClipEnabled,
        };
    }
    function spacedMaterial(thickness: number, penetration: number | null | undefined, side: Side): ShaderMaterial {
        return new THREE.ShaderMaterial({
            vertexShader: SPACED_VERT, fragmentShader: SPACED_FRAG,
            depthWrite: false, depthTest: true,
            blending: THREE.AdditiveBlending,
            // 面与 stencil 去重状态由调用方按几何拓扑 + 去重键决定：闭合网格 FrontSide 单 clone；
            // 开放网格拆 FrontSide（写本键 stencil 位）/ BackSide（测位）两 clone。
            side,
            uniforms: spacedCommonUniforms(thickness, penetration),
        });
    }
    function spacedStateMaterial(thickness: number, penetration: number | null | undefined): ShaderMaterial {
        return new THREE.ShaderMaterial({
            vertexShader: SPACED_VERT, fragmentShader: SPACED_STATE_FRAG,
            // 状态不可累加：最近板写入后，其余板深度测试失败（独占写入）
            depthWrite: true, depthTest: true, blending: THREE.NoBlending,
            side: THREE.DoubleSide,
            uniforms: spacedCommonUniforms(thickness, penetration),
        });
    }
    let _emptySpacedTex: THREE.DataTexture | null = null;
    function emptySpacedTexture(): THREE.DataTexture {
        if (!_emptySpacedTex) {
            const d = new Uint8Array([0, 0, 0, 0]);
            _emptySpacedTex = new THREE.DataTexture(d, 1, 1, THREE.RGBAFormat);
            _emptySpacedTex.needsUpdate = true;
        }
        return _emptySpacedTex;
    }

    /** 释放本 context 的占位纹理（材质由场景 traverse 释放；这里只收 context 私有资源） */
    function dispose(): void {
        if (_emptySpacedTex) { _emptySpacedTex.dispose(); _emptySpacedTex = null }
    }
    return {
        resUniform, rcUniforms, emptySpacedTexture,
        penetrationMaterial, spacedMaterial, spacedStateMaterial,
        externalMaterial, moduleStateMaterial, dispose,
    }
}
