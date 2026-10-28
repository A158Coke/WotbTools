// 装甲查看器穿透材质族（2026-10-24 自 tankViewer 闭包出仓，current-plan.md Step B2；
// 代码与搬移前逐字一致，仅去一层闭包缩进并加 export）。
// 覆盖：PBR 穿透热力图主材质（penetrationMaterial，逐行对齐 BlitzKit
// PrimaryArmorSceneComponent fragment.glsl）、外部模块/履带等效层（externalMaterial、
// moduleStateMaterial）、间隙甲双通道（spacedMaterial 厚度累计 / spacedStateMaterial
// 最近层跳弹-续飞状态）与跳弹续飞共享 uniforms（rcUniforms——同一对象引用注入全部
// 材质，grid 侧单点更新全体生效；数据面机制在 armorCollisionPack.js）。
// 消费方 tankViewer 经导入使用；材质语义/通道口径的注释随代码原样保留。
import * as THREE from 'three'
import { RC_GLSL_CONST, RC_GLSL_FUNCS } from '../armorCollisionPack.js'

// ===== 实时穿透热力图（逐行对齐 BlitzKit PrimaryArmorSceneComponent fragment.glsl）=====
// fragment shader 逐像素计算击穿概率着色：绿=稳定击穿 红=稳定挡住 渐变=概率过渡；
// 跳弹(角度≥ricochet 且不满足三倍口径规则)→蓝紫高亮
export const PBR_VERT = `
    varying highp vec3 vNormal;
    varying highp vec3 vViewPos;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vViewPos = mv.xyz;
      vNormal = normalMatrix * normal;
      gl_Position = projectionMatrix * mv;
    }
`;
export const PBR_FRAG = `
    precision highp float;
    varying highp vec3 vNormal;
    varying highp vec3 vViewPos;
    uniform float thickness;
    uniform float penetration;
    uniform float caliber;
    uniform float ricochet;
    uniform float normalization;
    uniform float opacity;
    uniform bool isExplosive;   // HEAT 或 HE（BlitzKit isExplosive）
    uniform bool canSplash;     // 仅 HE（BlitzKit canSplash）
    uniform float damage;
    uniform float explosionRadius;
    // HE 溅射热力图：爆点（世界系）+ 每块板自身的局部伤害。
    // 颜色 = 该像素自己的 thickness+spacedThick 与到爆点距离算出的伤害。
    uniform bool heActive;
    uniform highp vec3 heCenter;
    uniform bool greenPenetration;
    uniform bool advancedHighlighting;
    uniform bool opaque;
    uniform vec2 resolution;
    uniform float metersPerUnit;   // 视空间单位 → 米（场景原生米制，恒为 1，保留 uniform 兼容热力图管线）
    uniform sampler2D spacedArmorBuffer;   // R=外部/间隙甲 thickness/penetration, alpha!=0 表示有覆盖
    uniform highp sampler2D spacedArmorDepth; // 深度（HE 溅射用）
    uniform sampler2D spacedStateBuffer;      // RT1 状态通道：R=首层跳弹标志, G=续飞结果编码
    uniform float spacedSatGuard;             // 8 位回退格式（无半浮点 RT）：R 饱和(>=1)时按整穿深保守处理；半浮点下恒 0
    uniform mat4 inverseProjectionMatrix;
    #include <clipping_planes_pars_fragment>
    float getDist(vec2 coord, float depth) {
      vec4 clip = vec4(coord * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
      vec4 eye = inverseProjectionMatrix * clip;
      return length(eye.xyz / eye.w);
    }
    vec3 getPenetrationColor(bool isThreeCalibersRule, bool couldHaveRicochet) {
      if (advancedHighlighting && couldHaveRicochet) {
        return vec3(0.0, 1.0, isThreeCalibersRule ? 1.0 : 0.0);
      }
      return vec3(0.0, 1.0, 0.0);
    }
    // Armor Inspector HE 伤害渐变：0 = 暗红/无伤害，1 = 绿（满溅射）。
    vec3 heDamageRamp(float t) {
      vec3 dark = vec3(0.20, 0.0, 0.0);
      vec3 red = vec3(0.90, 0.08, 0.0);
      vec3 orange = vec3(1.0, 0.45, 0.0);
      vec3 yellow = vec3(1.0, 0.90, 0.0);
      vec3 green = vec3(0.20, 0.90, 0.25);
      if (t < 0.25) return mix(dark, red, t / 0.25);
      if (t < 0.50) return mix(red, orange, (t - 0.25) / 0.25);
      if (t < 0.75) return mix(orange, yellow, (t - 0.50) / 0.25);
      return mix(yellow, green, (t - 0.75) / 0.25);
    }
    ${RC_GLSL_CONST}
    ${RC_GLSL_FUNCS}
    void main() {
      #include <clipping_planes_fragment>
      vec2 sc = gl_FragCoord.xy / resolution;
      vec4 spacedData = texture2D(spacedArmorBuffer, sc);
      vec4 spacedState = texture2D(spacedStateBuffer, sc);
      bool underSpaced = spacedData.a != 0.0;
      // RT1.A = 1：最近覆盖层是外部模块（moduleStateMaterial 写；间隙甲写 0）。
      // 模块在前时，其后间隙板不得跳弹/续飞（用户 2026-10-17）。
      bool moduleInFront = spacedState.a > 0.5;
      bool gapRicochet = underSpaced && spacedState.r > 0.5 && !moduleInFront;   // 首层跳弹标志（RT1，最近板独占）
      highp vec3 viewDir = normalize(vViewPos);
      // 装甲几何在加载时 toNonIndexed + computeVertexNormals ⇒ vNormal 已是逐面
      // 几何法线，与点击判定 hit.face.normal 同源。不得改用 dFdx/dFdy(vViewPos)：
      // 几何输入与运算全程 highp，避免法线/穿深先量化再提升精度；仍使用碰撞逐面
      // 法线，不改为屏幕导数。500 m 视空间 length() 在 mediump 下会溢出。
      highp vec3 nFace = normalize(vNormal);
      // 双面材质（间隙甲）：背面命中把法线翻向相机来向，与点击链 classifyHit 同口径；
      // 正面命中不受影响。
      if (!gl_FrontFacing) nFace = -nFace;
      highp float angle = acos(clamp(dot(nFace, -viewDir), -1.0, 1.0));

      highp mat3 vRotT = transpose(mat3(viewMatrix));
      highp vec3 wPosR = vRotT * (vViewPos - viewMatrix[3].xyz);
      highp vec3 incR = viewDir;
      highp vec3 nVR = nFace;
      highp vec3 rVR = incR - 2.0 * dot(incR, nVR) * nVR;
      highp vec3 reflR = normalize(vRotT * rVR);
      bool threeCal = caliber > thickness * 3.0;
      // 跳弹抑制：真实 3× 口径，或此前已有任何命中层（外部模块/间隙甲）。炮弹穿过
      // 外部模块后沿原方向继续，不再跳弹（用户 2026-10-17 裁示）。
      bool noRicochet = threeCal || underSpaced;
      bool mayRicochet = angle >= ricochet;
      float penChance = -1.0;
      float splashChance = 0.0;
      float heDamageNorm = 0.0;
      bool ricocheted = false;
      bool contPen = false;
      int contCls = 0;
      highp float contChance = 0.0;
      highp float rcDiag = 0.0;
      if (gapRicochet) {
        // 首层间隙板跳弹：炮弹不再接触本主装甲（与点击链同结果）。续飞已由**间隙板
        // 着色器**在其自身几何（真实起点/法线）上算毕并编码进 B——此处只解读，
        // 不得在本面重算（review 2026-10-13：两块板无平行约束）。
        //   0.0 = 无续飞结果 → 维持紫；(0.2,0.8) = 续飞击穿（概率带）；1.0 = 续飞被挡 → 红
        rcDiag = floor(spacedState.b * 255.0 + 0.5);
        float code = spacedState.g;
        if (code <= 0.0) {
          penChance = 0.0; ricocheted = true;
        } else if (code >= 1.0) {
          penChance = 0.0; ricocheted = false;
        } else {
          penChance = clamp((code - 0.2) / 0.6, 0.0, 1.0);
          ricocheted = false;
          contPen = true;
        }
      } else if (!noRicochet && mayRicochet) {
        penChance = 0.0; ricocheted = true;
        // 跳弹续飞（GPU 求交）：反射线在打包碰撞几何上做出射段判定，
        // 语义 = 点击判定跳弹后的 judgePenetration 二次判定（强制不跳弹）。
        // 仅动能弹可入本分支（爆炸弹 ricochet=90°）。v5.3 全分辨率逐像素：
        //   rcMode>=1 —— 网格 DDA 求交（与原热力图同精度、同帧计算）；
        //   rcMode=0 —— 关闭（维持紫）。
        // 注：入射侧无消耗可言——有覆盖(underSpaced)时 noRicochet 恒真进不了本分支，
        // 故续飞初始穿深恒为 penetration×0.75，与点击链首层跳弹精确一致。
        // 全分辨率逐像素续飞（v5.3）：网格 DDA + 取数预算把单像素求交压回
        // 原热力图量级，不再需要低清类通道中转（与原热力图同精度、同帧计算）
        if (rcMode >= 1) {
          contCls = rcContinue(wPosR, reflR, penetration * RC_RICO_MUL, contChance, rcDiag);
          if (contCls == 1) { penChance = contChance; ricocheted = false; contPen = true; }   // 续飞击穿→绿
          else if (contCls == 2) {
            ricocheted = false;
            // 名义被挡但 1–99%：显示概率带，不写死红色（与结果卡一致）。
            float p = clamp(contChance, 0.0, 1.0);
            float pct = floor(p * 100.0 + 0.5);
            if (pct >= 1.0 && pct <= 99.0) penChance = p;
          }
        }
      } else {
        float ratio = thickness > 0.0 ? caliber / thickness : 0.0;
        bool twoCal = ratio > 2.0;
        // BlitzKit：主装甲对自身厚度/角度独立套用转正；前置间隙甲/外部模块
        // 不会取消它的 normalization（逐层，不继承首层状态）。
        float norm = twoCal
          ? (1.4 * normalization * caliber) / (2.0 * thickness)
          : normalization;
        // 掠射角保护：mediump 下 cos 可能为 0/负，必须与 resolveLayerGeometry 的
        // 1e-6 下界一致，否则会写入 inf/负厚度并反向扣减覆盖（review 2026-10-18）。
        highp float finalThick = thickness / max(cos(max(0.0, angle - norm)), 1e-6);
        float rem = penetration;
        highp float spacedEff = 0.0;
        // 8 位回退格式 R 饱和：累计值只知 >=1，真实消耗未知；不得当成恰好
        // 一份穿深去算高斯 CDF（200mm 间隙甲/100mm 穿深会被算成 14%）。
        // fail-closed：直接按 blocked 概率处理。
        bool spacedSatBlocked = false;
        // 间隙甲 CDF 的区间基准：若 RT1 最近覆盖层是外部模块，模块 flat 在
        // 间隙甲之前消耗，间隙层 CDF 必须用 P−moduleFlat；否则用原始 P。
        // 均值必须保留符号：模块厚于穿深时区间仍可能保留正向尾部
        // （P199/chassis200/spaced1/hull1 → 均值−1，5.0% 仍可穿），
        // 不得用 max(0, ·) 截断（review 2026-10-18 第二反例）。
        highp float spacedProbBase = penetration;
        // Armor Inspector 概率区间：±5% = ±3σ；两端一起平移，σ 保持不变。
        highp float pMin = penetration * 0.95;
        highp float pMax = penetration * 1.05;
        if (underSpaced) {
          // RT0.R = 各间隙板/模块的逐层 actual effective / penetration 累加
          // （SPACED_FRAG 与 EXTERNAL_FRAG 同口径）；不再用 RT1 最近层差额修正。
          // 累计值可能 >1：半浮点 RT 保留；8 位回退在 R 饱和时按整穿深保守处理。
          highp float rawTotal = spacedData.r;
          spacedSatBlocked = spacedSatGuard > 0.5 && rawTotal >= 1.0;
          highp float totalConsume = spacedSatBlocked ? 1.0 : max(0.0, rawTotal);
          // B = 外部模块 flat 消耗；从总消费中分离间隙甲 normalized effective。
          highp float moduleFlat = max(0.0, spacedData.b * penetration);
          spacedEff = max(0.0, totalConsume * penetration - moduleFlat);
          spacedProbBase = moduleInFront ? (penetration - moduleFlat) : penetration;
          float spacedThick = totalConsume * penetration;
          // 判定/热力图按实际等效厚度消耗一次（与 penetration.js 的
          // remainingPen -= effective 一致）；不能用 3× 概率区间把确定性的
          // 穿透判成红色。Armor Inspector 概率只作为结果卡上的补充数值。
          pMin -= totalConsume * penetration;
          pMax -= totalConsume * penetration;
          rem -= spacedThick;
          // HE（canSplash）即使 rem<=0 也走 SPLASH/BLOCKED，不能落进贯穿 CDF；
          // HEAT 没有溅射，名义 rem 耗尽时随机区间仍可能有正尾，必须继续 gap
          // 衰减并进入 CDF（review 2026-10-18：spaced100→0.1m→hull1 卡片 13.19%）。
          if (isExplosive) {
            float spacedDist = getDist(sc, texture2D(spacedArmorDepth, sc).r);
            float primaryDist = getDist(sc, gl_FragCoord.z);
            // 深度反投影得到视空间距离；场景原生米制，metersPerUnit=1（恒等）
            float distArmor = (primaryDist - spacedDist) * metersPerUnit;
            if (canSplash) {
              // Armor Inspector HE 热力图：以爆点为圆心的距离衰减 + 名义装甲，
              // 输出连续伤害渐变（不再用 0/1 的 splashChance 二值橙色）。
              // 没有爆点（尚未点击）时保持透明，不拿间隙距离伪造分布。
              if (heActive) {
                // 8 位 RT 的 R 饱和：累计间隙甲厚度只知 >=1 倍穿深，真实装甲未知；
                // HE 热力图必须按 0 伤害端 fail-closed，不能用 penetration 冒充
                // 实际厚度去画正值（评审 P2）。
                if (spacedSatBlocked) {
                  splashChance = 0.0;
                  heDamageNorm = 0.0;
                } else {
                  // Armor Inspector HE 热力图（shader 67）：满伤距离衰减 − 1.3×装甲，
                  // 按满伤归一。与面板 0.5·D·(0.75/1.25) − Σ名义装甲是两条路径；
                  // 热力图用 1.3 的装甲系数和满伤基准，薄板/近爆点才会明显发热。
                  float heArmor = (thickness + spacedThick) * 1.3;
                  float heDist = length(wPosR - heCenter);
                  float splashDamage = damage * (1.0 - heDist / max(explosionRadius, 1e-3)) - heArmor;
                  splashChance = step(0.0, splashDamage);
                  heDamageNorm = clamp(splashDamage / max(damage, 1e-3), 0.0, 1.0);
                }
              } else {
                splashChance = 0.0;
                heDamageNorm = 0.0;
              }
              penChance = 0.0;
            } else {
              // HEAT gap decay：与 penetration.js 同一 0.5/m；概率区间同样衰减。
              // RT0 深度只保留最近覆盖层→主甲的总距离，多层前置时这里是
              // 1−0.5·Σd（卡片是逐 gap 乘积，严格更小）；精确需要逐层有序
              // 深度/depth peeling，与多间隙层 CDF 同一 RT0 限制（已知近似）。
              float gapLoss = max(0.0, 1.0 - 0.5 * distArmor);
              pMin *= gapLoss;
              pMax *= gapLoss;
              rem -= 0.5 * rem * distArmor;
            }
          }
        }
        if (penChance < 0.0) {
          // 均值与宽度同时传播：σ = (max-min)/6，不得按扣减后的 rem 重算。
          if (spacedSatBlocked) {
            // 8 位 R 饱和：真实累计厚度未知，按 blocked 处理（fail-closed）。
            penChance = 0.0;
          } else if (pMax <= 0.0) {
            penChance = 0.0;
          } else {
            highp float sigma = max((pMax - pMin) / 6.0, 1e-4);
            highp float mu = 0.5 * (pMin + pMax);
            penChance = clamp(aiNormalCdf((mu - finalThick) / sigma), 0.0, 1.0);
            // 间隙甲层也参与 CDF：GPU additive 只有总 normalized 厚度，
            // 用聚合厚度乘一次 CDF。前置模块用 spacedProbBase 先平移区间；
            // 单间隙层精确，多层仍为同向近似（RT0 无法恢复逐层顺序）。
            if (spacedEff > 0.0) {
              highp float sSigma = max(penetration * 0.05 / 3.0, 1e-4);
              penChance *= clamp(aiNormalCdf((spacedProbBase - spacedEff) / sSigma), 0.0, 1.0);
            }
          }
          if (canSplash) {
            if (heActive) {
              // 同 shader 67 的热力图口径（满伤衰减 − 1.3×装甲，满伤归一）。
              float heArmor2 = thickness * 1.3;
              float heDist2 = length(wPosR - heCenter);
              float splash = damage * (1.0 - heDist2 / max(explosionRadius, 1e-3)) - heArmor2;
              splashChance = step(0.0, splash);
              heDamageNorm = clamp(splash / max(damage, 1e-3), 0.0, 1.0);
            } else {
              splashChance = 0.0;
              heDamageNorm = 0.0;
            }
          }
        }
      }
      float alpha = opaque ? 1.0 : 0.5;
      vec3 base = vec3(1.0, splashChance * 0.392, 0.0);
      if (advancedHighlighting && ricocheted) base = vec3(1.0, base.g, 1.0);
      if (canSplash) {
        // 每块板自身的局部伤害：thickness+spacedThick 与到爆点距离。
        vec3 heColor = heDamageRamp(heDamageNorm);
        // 零伤害仍是热力图的 0 端（暗红），不能整块透明——只有未激活/无爆点
        // 才透明；否则无法区分“零伤害的装甲”和“没开热力图”（评审 P2）。
        float heAlpha = heActive ? mix(0.18, 0.95, heDamageNorm) : 0.0;
        gl_FragColor = vec4(heColor, heAlpha);
      } else if (greenPenetration || advancedHighlighting) {
        // 概率色带：红 → 橙 → 黄 → 绿；高概率端保留 overmatch 青蓝/续飞纯绿。
        // 旧的 base/penColor 二次混合在 30%–60% 之间几乎都是暗红/橄榄色，
        // 这里加入橙/黄中间色相，让相邻概率段的颜色差异一眼可辨。
        vec3 penColor = contPen ? vec3(0.0, 1.0, 0.0) : getPenetrationColor(threeCal, mayRicochet);
        float p = clamp(penChance, 0.0, 1.0);
        vec3 orange = vec3(1.0, 0.45, 0.0);
        vec3 yellow = vec3(1.0, 0.90, 0.0);
        vec3 heat;
        if (p < 0.34) {
          heat = mix(base, orange, p / 0.34);
        } else if (p < 0.67) {
          heat = mix(orange, yellow, (p - 0.34) / 0.33);
        } else {
          heat = mix(yellow, penColor, (p - 0.67) / 0.33);
        }
        gl_FragColor = vec4(heat, alpha);
      } else {
        gl_FragColor = vec4(base, (1.0 - penChance) * alpha);
      }
      // 防编译器消除 rcContinue 调用：out 参数副作用必须可能被观测
      if (rcDiag > 1e30) gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
      gl_FragColor.a *= opacity;
    }
`;

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
export function externalMaterial(thickness, penetration, clip) {
    return new THREE.ShaderMaterial({
        vertexShader: EXTERNAL_VERT, fragmentShader: EXTERNAL_FRAG,
        depthWrite: false, depthTest: true,
        blending: THREE.AdditiveBlending,
        clipping: clip != null,
        clippingPlanes: clip ? [clip] : null,
        uniforms: { thickness: { value: thickness }, penetration: { value: penetration || 200 } },
    });
}
const SPACED_VERT = PBR_VERT;
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
export function moduleStateMaterial(clip) {
    return new THREE.ShaderMaterial({
        vertexShader: EXTERNAL_VERT, fragmentShader: MODULE_STATE_FRAG,
        depthWrite: true, depthTest: true,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.ZeroFactor, blendDst: THREE.OneFactor,
        blendEquationAlpha: THREE.AddEquation,
        blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.ZeroFactor,
        clipping: clip != null,
        clippingPlanes: clip ? [clip] : null,
    });
}

/**
 * 每个 viewer 一份的穿透材质**运行态**：穿透分辨率 uniform、跳弹续飞共享 uniforms、
 * 空白占位纹理，以及把材质绑定到这些对象上的工厂。**不得提升为模块单例**——
 * 两个 viewer 生命周期重叠时，A 的更新/重建/清理会直接改到 B 正在使用的 uniforms。
 */
export function createArmorShaderContext() {
    const resUniform = { value: new THREE.Vector2(1, 1) };   // 共享分辨率（低清/全清 pass 每帧切换）

    const rcUniforms = {
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
    function penetrationMaterial(thickness) {
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
                resolution: resUniform,
                metersPerUnit: { value: 1 },
                opacity: { value: 1 },
                spacedArmorBuffer: { value: emptySpacedTexture() },
                spacedArmorDepth: { value: null },
                spacedStateBuffer: { value: emptySpacedTexture() },
                spacedSatGuard: { value: 0 },
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
    function spacedCommonUniforms(thickness, penetration) {
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
    function spacedMaterial(thickness, penetration, side) {
        return new THREE.ShaderMaterial({
            vertexShader: SPACED_VERT, fragmentShader: SPACED_FRAG,
            depthWrite: false, depthTest: true,
            blending: THREE.AdditiveBlending,
            // 开放面片双面（背面命中可见），闭合网格单面（正/背两表面只累计一次）；
            // 面由几何拓扑决定，调用方传入（armorMeshTopology.isClosedSurfaceGeometry）。
            side,
            uniforms: spacedCommonUniforms(thickness, penetration),
        });
    }
    function spacedStateMaterial(thickness, penetration) {
        return new THREE.ShaderMaterial({
            vertexShader: SPACED_VERT, fragmentShader: SPACED_STATE_FRAG,
            // 状态不可累加：最近板写入后，其余板深度测试失败（独占写入）
            depthWrite: true, depthTest: true, blending: THREE.NoBlending,
            side: THREE.DoubleSide,
            uniforms: spacedCommonUniforms(thickness, penetration),
        });
    }
    let _emptySpacedTex = null;
    function emptySpacedTexture() {
        if (!_emptySpacedTex) {
            const d = new Uint8Array([0, 0, 0, 0]);
            _emptySpacedTex = new THREE.DataTexture(d, 1, 1, THREE.RGBAFormat);
            _emptySpacedTex.needsUpdate = true;
        }
        return _emptySpacedTex;
    }

    /** 释放本 context 的占位纹理（材质由场景 traverse 释放；这里只收 context 私有资源） */
    function dispose() {
        if (_emptySpacedTex) { _emptySpacedTex.dispose(); _emptySpacedTex = null }
    }
    return {
        resUniform, rcUniforms, emptySpacedTexture,
        penetrationMaterial, spacedMaterial, spacedStateMaterial,
        externalMaterial, moduleStateMaterial, dispose,
    }
}
