// 3D 装甲检视器：viewer.rs 嵌入 INDEX_HTML 的模块脚本整体抽取平移（含另一会话新增的
// 配件自动判定逻辑），除包一层 initTankViewer() 外一行未改。
// 数据面（WotBTools 增量）：tank 数据/名册/弹表/GLB/封面/射击数据经 agentData.js
// 资产面优先 + /api 回退；击穿判定为 penetration.js 客户端移植（上游 Rust 单测同源）。
// /api/hold、/api/ready 保留（Agent 自托管无头截图链专用，静态面缺席时静默无操作）。
// 调用前须设置 window.__INITIAL_TANK__ / __INITIAL_SHOOTER__（ArmorView 从路由参数注入）。
// 加载状态（审计 3D-23）：options.onLoadState 收到 { state: 'loading'|'ready'|'error', progress, message }，
// 宿主页据此显示进度条 / 失败重试；返回的 retry() 重新加载当前目标坦克。
// 生命周期：返回 { destroy, retry }——SPA 路由离开时必须调用（ArmorView onBeforeUnmount）：
// 取消 rAF 循环、摘除 window 监听器、释放 WebGL 上下文；不调用则多次进出路由会
// 耗尽浏览器 WebGL 上下文上限（~16 个）出现"context lost"黑屏。
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { poseFromYPR, neutralizeDefaultMetalness, dropDuplicateGunMasks } from './glbRig.js'
import {
    fetchTankData,
    fetchTankFilter,
    fetchShells,
    fetchReplayShots,
    judgePenetration,
    tankImageUrl,
    assetProvider,
} from './agentData.js'
import { createLoadProgress } from './loadProgress.js'
import {
    RC, RC_GLSL_CONST, RC_GLSL_FUNCS,
    buildPack, buildRicochetGrid, createGridTextures, simulateContinuation, raycastPackAll,
} from './armorCollisionPack.js'
// 点击判定的触发面分类（Primary = 主装甲板）；与判定本体同源，勿在此复制一份板面清单
import { isPrimary } from './penetration.js'

/**
 * @param {object} [options]
 * @param {object} [options.labels] 界面文案（审计 3D-16：由宿主页按当前语言提供；缺省为英文原文）
 * @param {(state: { state: string, progress?: number | null, message?: string }) => void} [options.onLoadState]
 */
/**
 * 场景脚本把射击复现 / 调试状态挂在 window 上（__worldPan、__shotCtx…）。以前每次都在新窗口里打开，
 * 现在同一标签页内反复进出，残留状态会让下一辆坦克的炮塔转不动、镜头被锁——初始化与销毁时统一清掉。
 * 宿主传入的 __INITIAL_TANK__ / __INITIAL_SHOOTER__ 不在此列。
 */
const VIEWER_GLOBAL_RE = /^__(world|shot|shooter|victim|hit|seg|move|launch|end|dbg|debug|autoRel|fireGun|update|armor)/
function resetViewerGlobals() {
    if (typeof window === 'undefined') return
    for (const key of Object.keys(window)) {
        if (VIEWER_GLOBAL_RE.test(key)) {
            try { delete window[key] } catch (_) { window[key] = undefined }
        }
    }
}

export function initTankViewer({ labels = {}, onLoadState = null } = {}) {
        resetViewerGlobals();
        const L = {
            loading: 'Loading tank model...',
            loadFailed: (phase, msg) => 'Failed to load ' + phase + ': ' + msg,
            tier: (tier) => 'Tier ' + tier,
            type: (value) => value,
            nation: (value) => value,
            showCollision: 'Show Collision',
            hideCollision: 'Hide Collision',
            worldHint: 'Drag to rotate · Scroll to zoom · Right-drag: pan',
            shotDamage: 'damage',
            shotRicochetSeg: 'ricochet (-25% penetration)',
            shotLoss: 'loss',
            shotNominal: 'nominal',
            shotBlocked: 'blocked',
            phase: (phase) => phase,   // 加载阶段名（armor model / tank model / tank data / tank list）
            ...labels,
        };
        const loadFailed = (phase, msg) => L.loadFailed(L.phase(phase), msg);

        // window 级监听统一经 onWin 登记，destroy 时成对摘除
        const cleanups = [];
        let rafId = 0;
        let destroyed = false;   // destroy 后迟到的 init/ animate 不再启动渲染
        let initDone = false;    // 渲染器与名册就绪后 retry 才能只重载目标坦克
        // 加载状态上报（宿主页进度条 / 错误态）；宿主回调异常不影响场景
        const reportLoad = (state) => {
            if (destroyed || typeof onLoadState !== 'function') return;
            try { onLoadState(state); } catch (_) {}
        };
        const errorMessage = (error) => (typeof error === 'string') ? error
            : (error && (error.message || error.statusText || String(error))) || 'unknown';
        // 两个 GLB（装甲 + 外观）字节进度聚合；loadGen 让切车后旧加载的回调不再上报
        let loadGen = 0;
        let targetLoadGen = 0;   // target JSON requests can finish out of order when users switch tanks quickly
        const modelProgress = createLoadProgress((snap) => reportLoad({ state: 'loading', progress: snap.fraction }));
        const onWin = (type, fn) => {
            window.addEventListener(type, fn);
            cleanups.push(() => window.removeEventListener(type, fn));
        };

        onWin('error', function(e) {
            var el = document.getElementById('loading');
            if (el) { el.textContent = 'JS Error: ' + (e.message || e.error) + ' @ ' + (e.filename || '') + ':' + (e.lineno || ''); el.style.color = '#f44336'; el.style.whiteSpace = 'pre-wrap'; }
        });
        onWin('unhandledrejection', function(e) {
            var el = document.getElementById('loading');
            if (el) { el.textContent = 'Promise Rejection: ' + (e.reason && (e.reason.message || e.reason)); el.style.color = '#f44336'; el.style.whiteSpace = 'pre-wrap'; }
        });

        // WotBTools client-only：上游 /api/hold、/api/ready 是 Agent 自托管无头截图
        // 链的会话门控（headless=1 挂起 XHR 扣 Chrome 虚拟时间），WotBTools 拓扑
        // 无该服务端——headless 会话门控整体移除（评审 P0-3 验收 6）。
        const SESS = Math.random().toString(36).slice(2);
        let heatFrames = 0, heatReadySent = false;

        let scene, camera, renderer, controls;
        let raycaster, mouse;
        let tankModel = null, armorModel = null, tankData;   // tankData = target tank (model/armor/info)
        let shooterData = null;                              // shooter tank (caliber/shells)
        let shooterShells = [], shooterCaliber = 120;
        let selectedShell = null;
        let penetrationMode = false;   // 实时穿透热力图模式开关（animate/切弹/按钮共用）
        let collisionMode = false;     // 碰撞模型显示开关（按钮与热力图退出恢复共用）
        let moduleMeshes = [];

        function tidyTrajectory() {
            if (trajGroup) { scene.remove(trajGroup); trajGroup = null; }
            trajInfoPos = null;
            document.getElementById('traj-info').style.display = 'none';
            document.getElementById('click-info').style.display = 'none';
        }

        function getPlateThickness(section, plateId) {
            // BlitzKit resolveArmor 语义：thickness = armor.thickness[index] ?? 0。
            // 数据源只有 models.pb 合成的 tankData.armor_model（armor_cache.json 已退役）；
            // 缺板（如序列化时省略的 0 值板）记 0mm，0 厚度板照常渲染/判定。
            const am = tankData.armor_model || {};
            const id = String(plateId);
            if (section === 'hull') return am.hull?.plates?.[id] ?? 0;
            if (section === 'turret') return am.turret?.plates?.[id] ?? 0;
            if (section === 'gun') return am.gun?.plates?.[id] ?? 0;
            if (section === 'chassis') {
                const ch = am.chassis;
                if (!ch) return 0;
                if (plateId === 'leftTrack') return ch.left_track ?? 0;
                if (plateId === 'rightTrack') return ch.right_track ?? 0;
            }
            if (section === 'gunBarrel') {
                // 炮管：armor_model 的 'gun' 汇总值优先，缺失回退 models.pb 的 gun_thickness
                return am.gun?.plates?.['gun'] ?? currentConfig()?.gun_thickness ?? 0;
            }
            return 0;
        }

        function isRealArmorThickness(t) {
            // BlitzKit resolveArmor：缺失/0 厚度按 0mm 渲染（thickness[index] ?? 0），
            // 仅 null（两份数据源都缺失）才视为 deco 跳过
            return typeof t === 'number' && t >= 0;
        }

        function thicknessToColor(t) {
            if (t === null || t === undefined) return 0x666666;
            if (t >= 200) return 0x8B0000;
            if (t >= 100) return 0xFF4500;
            if (t >= 60) return 0xFFA500;
            if (t >= 30) return 0xFFD700;
            return 0x228B22;
        }

        // ===== 实时穿透热力图（逐行对齐 BlitzKit PrimaryArmorSceneComponent fragment.glsl）=====
        // fragment shader 逐像素计算击穿概率着色：绿=稳定击穿 红=稳定挡住 渐变=概率过渡；
        // 跳弹(角度≥ricochet 且不满足三倍口径规则)→蓝紫高亮
        const PBR_VERT = `
            varying vec3 vNormal;
            varying vec3 vViewPos;
            void main() {
              vec4 mv = modelViewMatrix * vec4(position, 1.0);
              vViewPos = mv.xyz;
              vNormal = normalMatrix * normal;
              gl_Position = projectionMatrix * mv;
            }
        `;
        const PBR_FRAG = `
            precision mediump float;
            varying vec3 vNormal;
            varying vec3 vViewPos;
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
            uniform bool greenPenetration;
            uniform bool advancedHighlighting;
            uniform bool opaque;
            uniform vec2 resolution;
            uniform float metersPerUnit;   // 视空间单位 → 米（场景原生米制，恒为 1，保留 uniform 兼容热力图管线）
            uniform sampler2D spacedArmorBuffer;   // R=外部/间隙甲 thickness/penetration, alpha!=0 表示有覆盖
            uniform highp sampler2D spacedArmorDepth; // 深度（HE 溅射用）
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
            ${RC_GLSL_CONST}
            ${RC_GLSL_FUNCS}
            void main() {
              #include <clipping_planes_fragment>
              vec2 sc = gl_FragCoord.xy / resolution;
              vec4 spacedData = texture2D(spacedArmorBuffer, sc);
              bool underSpaced = spacedData.a != 0.0;
              float viewDistance = length(vViewPos);
              float angle = acos(dot(vNormal, -vViewPos) / viewDistance);

              highp mat3 vRotT = transpose(mat3(viewMatrix));
              highp vec3 wPosR = vRotT * (vViewPos - viewMatrix[3].xyz);
              highp vec3 incR = normalize(vViewPos);
              highp vec3 nVR = normalize(vNormal);
              highp vec3 rVR = incR - 2.0 * dot(incR, nVR) * nVR;
              highp vec3 reflR = normalize(vRotT * rVR);
              bool threeCal = caliber > thickness * 3.0 || underSpaced;
              bool mayRicochet = angle >= ricochet;
              float penChance = -1.0;
              float splashChance = 0.0;
              bool ricocheted = false;
              bool contPen = false;
              int contCls = 0;
              highp float contChance = 0.0;
              highp float rcDiag = 0.0;
              if (!threeCal && mayRicochet) {
                penChance = 0.0; ricocheted = true;
                // 跳弹续飞（GPU 求交）：反射线在打包碰撞几何上做出射段判定，
                // 语义 = 点击判定跳弹后的 judgePenetration 二次判定（强制不跳弹）。
                // 仅动能弹可入本分支（爆炸弹 ricochet=90°）。v5.3 全分辨率逐像素：
                //   rcMode>=1 —— 网格 DDA 求交（与原热力图同精度、同帧计算）；
                //   rcMode=0 —— 关闭（维持紫）。
                // 注：入射侧无消耗可言——有覆盖(underSpaced)时 threeCal 恒真进不了本分支，
                // 故续飞初始穿深恒为 penetration×0.75，与点击链首层跳弹精确一致。
                // 全分辨率逐像素续飞（v5.3）：网格 DDA + 取数预算把单像素求交压回
                // 原热力图量级，不再需要低清类通道中转（与原热力图同精度、同帧计算）
                if (rcMode >= 1) {
                  contCls = rcContinue(wPosR, reflR, penetration * RC_RICO_MUL, contChance, rcDiag);
                  if (contCls == 1) { penChance = contChance; ricocheted = false; contPen = true; }   // 续飞击穿→绿
                  else if (contCls == 2) { ricocheted = false; }                                      // 续飞被挡→红
                }
              } else {
                float ratio = thickness > 0.0 ? caliber / thickness : 0.0;
                bool twoCal = ratio > 2.0;
                float norm = twoCal ? (1.4 * normalization * caliber) / (2.0 * thickness) : normalization;
                float finalThick = thickness / cos(max(0.0, angle - norm));
                float rem = penetration;
                if (underSpaced) {
                  float spacedThick = spacedData.r * penetration;
                  rem -= spacedThick;
                  if (isExplosive && rem > 0.0) {
                    float spacedDist = getDist(sc, texture2D(spacedArmorDepth, sc).r);
                    float primaryDist = getDist(sc, gl_FragCoord.z);
                    // 深度反投影得到视空间距离；场景原生米制，metersPerUnit=1（恒等）
                    float distArmor = (primaryDist - spacedDist) * metersPerUnit;
                    if (canSplash) {
                      float finalDamage = 0.5 * damage * (1.0 - distArmor / explosionRadius) - 1.1 * (finalThick + spacedThick);
                      splashChance = step(0.0, finalDamage);
                      penChance = 0.0;
                    } else {
                      rem -= 0.5 * rem * distArmor;      // HEAT gap decay
                    }
                  }
                }
                if (penChance < 0.0) {
                  rem = max(0.0, rem);
                  float delta = finalThick - rem;
                  float rand = rem * 0.05;               // ±5% randomization band
                  penChance = clamp(1.0 - (delta + rand) / (2.0 * rand), 0.0, 1.0);
                  if (canSplash) {
                    float splash = 0.5 * damage - 1.1 * finalThick;
                    splashChance = step(0.0, splash);
                  }
                }
              }
              float alpha = opaque ? 1.0 : 0.5;
              vec3 base = vec3(1.0, splashChance * 0.392, 0.0);
              if (advancedHighlighting && ricocheted) base = vec3(1.0, base.g, 1.0);
              if (greenPenetration || advancedHighlighting) {
                float fall = 1.0 - penChance * penChance;
                float gain = 1.0 - (penChance - 1.0) * (penChance - 1.0);
                // 续飞击穿用纯绿（不套掠射 overmatch 的青蓝指示色——炮弹确实穿了）
                vec3 penColor = contPen ? vec3(0.0, 1.0, 0.0) : getPenetrationColor(threeCal, mayRicochet);
                gl_FragColor = vec4(fall * base + gain * penColor, alpha);
              } else {
                gl_FragColor = vec4(base, (1.0 - penChance) * alpha);
              }
              // 防编译器消除 rcContinue 调用：out 参数副作用必须可能被观测
              if (rcDiag > 1e30) gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
              gl_FragColor.a *= opacity;
            }
        `;

        // ===== 穿透热力图：对齐 BlitzKit SpacedArmorScene（Armor/index.tsx useFrame）=====
        // spacedArmorScene 在【单次】gl.render 内按 renderOrder 排序：
        //   0 主装甲 omit(colorWrite:false, depthWrite:true，仅供 RT 遮挡)；
        //   1-2 间隙甲 additive(R=thickness/penetration)；3-4 外部模块(3=depth, 4=additive)；5 间隙甲 depth。
        // 结果写入 RT，primaryArmorScene(renderOrder 1) 读 RT 着色到屏幕。
        // 关键：omit/additive 是同一节点的两个独立 Mesh，深度缓冲贯穿全部 renderOrder → 被遮挡模块正确剔除。
        // 主循环顺序：autoClear=true 渲染 RT → autoClear=false 渲染场景 → clearDepth() 渲染 primaryArmorScene。
        let penetrationRT = null;
        function ensurePenetrationRT() {
            if (!penetrationRT) {
                const c = renderer.domElement;
                penetrationRT = new THREE.WebGLRenderTarget(c.width, c.height, {
                    depthTexture: new THREE.DepthTexture(c.width, c.height),
                });
            }
            const cx = renderer.domElement;
            penetrationRT.setSize(cx.width, cx.height);
            return penetrationRT;
        }
        function syncPenetrationRT() {
            const rt = ensurePenetrationRT();
            const c = renderer.domElement;
            const w = c.width, h = c.height;
            if (!rt.depthTexture || rt.depthTexture.width !== w || rt.depthTexture.height !== h) {
                if (rt.depthTexture) rt.depthTexture.dispose();
                rt.depthTexture = new THREE.DepthTexture(w, h);
            }
            rt.setSize(w, h);
            return rt;
        }

        let primaryMeshes = [], spacedMeshes = [], externalMeshes = [];
        let gunClipPlane = null;
        const _gunClipPlaneObj = new THREE.Plane();
        let gunMuzzleWorld = null;
        // 装甲旋转枢轴（alignArmorModules 按 models.pb 原点写入：track+turret / track+turret+gun）。
        // updateTurretGun 以此为炮塔/炮管的旋转中心（对齐 BlitzKit 旋转语义）。
        let armorPivotTurret = null, armorPivotGun = null;
        function computeGunClipPlane() {
            gunClipPlane = null;
            gunMuzzleWorld = null;
            const act = activeGunNumber();
            const cfg = currentConfig();
            if (act == null || !tankModel) return;
            // BlitzKit 真值语义：mask=0 视同无 mask（gunModelDefinition.mask ? ...）
            const hasMask = cfg && typeof cfg.gun_mask === 'number' && cfg.gun_mask !== 0;
            tankModel.updateMatrixWorld(true);
            const gunPrefix = 'gun_' + String(act).padStart(2, '0');
            let barrel = null, barrelLen = 0;
            tankModel.traverse(function(n){
                if (!n.isMesh) return;
                const pn = n.parent && n.parent.name || '';
                if (pn !== gunPrefix) return;
                if (!n.geometry.boundingBox) n.geometry.computeBoundingBox();
                const b = n.geometry.boundingBox;
                const len = Math.max(b.max.x-b.min.x, b.max.y-b.min.y, b.max.z-b.min.z);
                if (len > barrelLen) { barrelLen = len; barrel = n; }
            });
            let dir = new THREE.Vector3(0, 1, 0);
            if (barrel) {
                const wb = new THREE.Box3().setFromObject(barrel);
                const sz = new THREE.Vector3(); wb.getSize(sz);
                let axis = 'x';
                if (sz.y >= sz.x && sz.y >= sz.z) axis = 'y';
                else if (sz.z >= sz.x && sz.z >= sz.y) axis = 'z';
                const a = wb.min.clone(), b2 = wb.max.clone();
                if (axis === 'x') { a.y = b2.y = (wb.min.y+wb.max.y)/2; a.z = b2.z = (wb.min.z+wb.max.z)/2; }
                if (axis === 'y') { a.x = b2.x = (wb.min.x+wb.max.x)/2; a.z = b2.z = (wb.min.z+wb.max.z)/2; }
                if (axis === 'z') { a.x = b2.x = (wb.min.x+wb.max.x)/2; a.y = b2.y = (wb.min.y+wb.max.y)/2; }
                const origin = new THREE.Vector3(0, 0, 0);
                // 炮口方向判定：以 models.pb 火炮原点（炮耳轴）为基准——炮管两端中距耳轴
                // 更远的一端为炮口（按"远离世界原点"判向会因包围盒中心居中于原点而随机反转）。
                // cfg 与上文为同一次 currentConfig()（纯数组查找，原重复调用已合并）
                const mo0 = tankData && tankData.model_origins;
                let gunOriginWorld = null;
                if (mo0 && mo0.track && mo0.turret && cfg && cfg.gun_origin) {
                    const g = new THREE.Vector3(
                        mo0.track[0] + mo0.turret[0] + cfg.gun_origin[0],
                        mo0.track[1] + mo0.turret[1] + cfg.gun_origin[1],
                        mo0.track[2] + mo0.turret[2] + cfg.gun_origin[2]);
                    gunOriginWorld = tankModel.localToWorld(g);
                }
                if (gunOriginWorld) {
                    const dA = a.distanceToSquared(gunOriginWorld);
                    const dB = b2.distanceToSquared(gunOriginWorld);
                    dir = (dA > dB) ? a.sub(b2) : b2.sub(a);
                } else {
                    dir = (a.distanceToSquared(origin) > b2.distanceToSquared(origin)) ? a.sub(b2) : b2.sub(a);
                }
                dir.normalize();
                const center = wb.getCenter(new THREE.Vector3());
                const halfAlongDir = (Math.abs(dir.x)*sz.x + Math.abs(dir.y)*sz.y + Math.abs(dir.z)*sz.z) / 2;
                gunMuzzleWorld = center.add(dir.clone().multiplyScalar(halfAlongDir));
            }
            if (!hasMask) return;
            const mo = tankData && tankData.model_origins;
            if (!(mo && mo.track && mo.turret && cfg.gun_origin && barrel)) return;
            const maskOriginModel = cfg.gun_mask + mo.track[1] + mo.turret[1] + cfg.gun_origin[1];
            // 模型原点的世界坐标 + 炮轴方向 × (模型本地距离 / worldMetersPerUnit → 世界距离)
            const originWorld = new THREE.Vector3(); tankModel.localToWorld(originWorld.set(0, 0, 0));
            const mpu = worldMetersPerUnit || 1;
            const point = originWorld.add(dir.clone().multiplyScalar(maskOriginModel / mpu));
            gunClipPlane = _gunClipPlaneObj.setFromNormalAndCoplanarPoint(dir, point);
        }
        function collectPenetrationMeshes() {
            primaryMeshes = []; spacedMeshes = [];
            armorModel.traverse(function(node) {
                if (!node.isMesh) return;
                if (node.visible === false || node.userData.configHidden) return;
                const sec = node.userData.armorSection;
                if (sec === 'deco') return;
                if (sec === 'spaced') spacedMeshes.push(node);
                else primaryMeshes.push(node);
            });
            externalMeshes = [];
            const act = activeGunNumber();
            const cfg = currentConfig();
            // BlitzKit 真值语义：mask=0 视同无 mask（SpacedArmorScene `gunModelDefinition.mask ?`）
            const hasMask = cfg && typeof cfg.gun_mask === 'number' && cfg.gun_mask !== 0;
            computeGunClipPlane();
            moduleMeshes.forEach(function(node) {
                if (!node.isMesh) return;
                if (node.visible === false) return;
                if (node.userData.gunConfig != null && act != null && node.userData.gunConfig !== act) return;
                // BlitzKit 选择规则：mask 有值 → gun_01 + gun_01_mask 子树都渲染；
                // mask 无值 → 只渲染 gun_01（炮管本体），mask 网格不参与
                if (node.userData.gunMaskPart && !hasMask) return;
                externalMeshes.push(node);
            });
        }

        const omitMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthTest: true, depthWrite: true });
        const excludeMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthTest: true, depthWrite: true });
        // 跳弹续飞共享 uniform（同一对象引用注入每个 penetrationMaterial——单点更新全体生效）。
        // 数据面 = 世界系均匀网格（buildRicochetGrid，炮塔/配置变化时重建；相机移动不重建）；
        // 执行面 = 全分辨率主图逐像素求交（rcMode=1；v5.3 起无低清中转）。
        let ricochetPack = null;
        let ricochetGrid = null;          // 网格加速结构（含纹理）
        let ricochetPoseDirty = true;     // 几何姿态变化（炮塔/配置/模型）→ 需重建网格
        let ricochetPackReason = '';      // 最近一次失败原因（钩子透出，排查用）
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
                    resolution: resUniform,
                    metersPerUnit: { value: 1 },
                    opacity: { value: 1 },
                    spacedArmorBuffer: { value: emptySpacedTexture() },
                    spacedArmorDepth: { value: null },
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
                },
            });
        }
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
              gl_FragColor = vec4(thickness / penetration, 0.0, 0.0, 1.0);
            }
        `;
        function externalMaterial(thickness, penetration, clip) {
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
        const SPACED_FRAG = `
            precision mediump float;
            varying vec3 vNormal;
            varying vec3 vViewPos;
            uniform float thickness;
            uniform float penetration;
            uniform float caliber;
            uniform float ricochet;
            uniform float normalization;
            void main() {
              float viewDistance = length(vViewPos);
              float angle = acos(dot(vNormal, -vViewPos) / viewDistance);
              bool threeCal = caliber > thickness * 3.0;
              if (!threeCal && angle >= ricochet) { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); return; }
              bool twoCal = caliber > thickness * 2.0 && thickness > 0.0;
              float norm = twoCal ? (1.4 * normalization * caliber) / (2.0 * thickness) : normalization;
              float finalThick = thickness / cos(max(0.0, angle - norm));
              gl_FragColor = vec4(finalThick / penetration, 0.0, 0.0, 1.0);
            }
        `;
        function spacedMaterial(thickness, penetration) {
            return new THREE.ShaderMaterial({
                vertexShader: SPACED_VERT, fragmentShader: SPACED_FRAG,
                depthWrite: false, depthTest: true,
                blending: THREE.AdditiveBlending,
                uniforms: {
                    thickness: { value: thickness }, penetration: { value: penetration || 200 },
                    caliber: { value: 120 }, ricochet: { value: 70 * Math.PI / 180 }, normalization: { value: 0 },
                },
            });
        }
        function shellTypeOf(sh) {
            const t = ((sh && sh.type) || '').toLowerCase();
            if (t === 'hc' || t === 'hc_premium' || t === 'heat') return 'heat';
            if (t === 'ap_cr' || t === 'ap_cr_premium' || t === 'apcr') return 'apcr';
            if (t === 'he' || t === 'he_premium') return 'he';
            if (t === 'ap' || t === 'ap_premium') return 'ap';
            return t;
        }
        const SHELL_LABEL = { ap: 'AP', apcr: 'APCR', heat: 'HEAT', he: 'HE' };
        function shellLabel(s) { return SHELL_LABEL[shellTypeOf(s)] || (s && s.type) || '?'; }
        // 调试信息窗口：坐标等调试文字集中展示在窗口行内（颜色点 = 对应 3D 标记），不再往场景挂 sprite 标签
        function fmt3(x, y, z) { return '(' + x.toFixed(1) + ', ' + y.toFixed(1) + ', ' + z.toFixed(1) + ')'; }
        // dbgReset 在 world 分支入口重建窗口（清上一发残留行）；dbgInfo 惰性建行并更新文本
        function dbgReset(title) {
            let w = document.getElementById('debug-info');
            if (!w) {
                w = document.createElement('div');
                w.id = 'debug-info';
                (document.getElementById('corner-tr') || document.body).appendChild(w);
            }
            w.innerHTML = '<h4>' + title + '</h4>';
        }
        function dbgInfo(id, color, name, text) {
            const w = document.getElementById('debug-info');
            if (!w) return;
            let r = document.getElementById(id);
            if (!r) {
                r = document.createElement('div');
                r.id = id; r.className = 'dbg-row';
                r.innerHTML = '<span class="dbg-dot" style="background:' + color + '"></span>'
                    + '<span class="dbg-name">' + name + '</span><span class="dbg-val"></span>';
                w.appendChild(r);
            }
            r.querySelector('.dbg-val').textContent = text;
        }
        // 调试模式开关工厂（原命中/脱靶两分支各建一份几乎相同的 __debugSetVisible + 调试按钮）：
        // 收纳 World View 面板 + 调试信息窗口 + 全部调试标记；extraRefresh = 分支附加刷新
        // （命中分支传 __updateAnchorMarkers 刷新基准点标记，脱靶分支传 null）。
        // URL debug=1 的自动开启时序两分支不同，留在各自调用点处理
        function makeDebugToggle(extraRefresh) {
            window.__debugOn = false;
            window.__debugSetVisible = function(on) {
                window.__debugOn = on;
                if (window.__worldAnno) window.__worldAnno.visible = on;
                if (window.__moveAnno) window.__moveAnno.visible = on;
                if (window.__shooterMuzzleMk) window.__shooterMuzzleMk.visible = on;
                if (window.__shooterMuzzleLine) window.__shooterMuzzleLine.visible = on;
                if (extraRefresh) extraRefresh(on);
                // 面板与移动标注复选框仅在调试模式可交互
                const st = document.getElementById('turret-controls');
                if (st) st.style.display = on ? 'block' : 'none';
                // 调试信息窗口随开关显隐（内容行由各标记更新函数写入）
                const di = document.getElementById('debug-info');
                if (di) di.style.display = on ? 'block' : 'none';
            };
            const btn = document.createElement('button');
            btn.id = 'debug-toggle';
            btn.textContent = '调试标注';
            btn.style.cssText = 'padding:6px 14px;background:var(--panel);color:var(--accent);' +
                'border:1px solid var(--border);border-radius:var(--radius-sm);' +
                'font-size:0.85em;cursor:pointer;backdrop-filter:blur(12px);';
            btn.onclick = function() {
                window.__debugSetVisible(!window.__debugOn);
                this.textContent = window.__debugOn ? '隐藏调试标注' : '调试标注';
            };
            // 挂右下角栈：按钮贴角、操作提示在其上方，不重叠
            (document.getElementById('corner-br') || document.body).appendChild(btn);
            return btn;
        }
        // segment 弹种全局 id 解码（type=32 / method0x07 同源编码）：
        // 全局 = (shells.xml 局部 id << 8) | 国家基数字节（nation_id×16+10）
        function shellIdParts(gid) {
            if (!gid) return null;
            return { local: gid >> 8, nation: gid & 0xff };
        }
        // 模块损伤位掩码解码（method38 components：bit = componentToken − 31）
        function decodeModules(mask) {
            const NAMES = ['引擎','弹药架','油箱','右履带','左履带','火炮','?37','观察装置','?39','?40','?41','?42','?43'];
            const out = [];
            if (!mask) return out;
            for (let b = 0; b < 13; b++) if (mask & (1 << b)) out.push(NAMES[b] || ('bit' + b));
            return out;
        }
        // 命中结果分类：作者 = method38 位图（权威）；他人 hit_flags 恒 0 → 用 game_hit_result 枚举映射
        function shotResultClass(s) {
            // 伤害仲裁优先：一发命中可与目标多次装甲交互（method38 多消息已按位图并集合并，
            // combat.rs ③'）——先弹开又击穿的弹同时带 0x0008 与 0x0010 位，此时以 HP 伤害
            // 定性（伤害>0 = 击穿级结果）；HE 弹（0x1000）无论如何先按 HE 分类；
            // 伤害=0 时才按跳弹/未穿位与结果枚举细分。
            if (!s.target_name) return 'MISS';
            const flg = s.hit_flags || 0;
            const dmg = s.damage || 0;
            if (flg & 0x1000) return 'HE BLAST';
            if (dmg > 0) return 'PENETRATION';
            if (flg & 0x0008) return 'RICOCHET';
            if (flg & 0x0020 || flg & 0x0040 || flg & 0x0080) return 'NO PENETRATION';
            const r = s.game_hit_result;
            if (r === 4) return 'RICOCHET';
            if (r === 3) return 'PENETRATION';
            if (r === 1 || r === 2) return 'NO PENETRATION';
            return 'HIT';   // 0/255：服务器未通知，仅知有目标
        }
        // 单发数据质量提示（ShotQuality 降级/回退项，3D 面板展示）
        function srQualityIssues(s) {
            const q = s.quality;
            const issues = [];
            if (!q) return issues;
            if (q.shooter_pos_from_muzzle) issues.push('射手位置为炮口坐标兜底');
            if (q.target_anchor_src === 'nearest') issues.push('命中通知缺失，目标锚点回退命中时刻最近包');
            else if (q.target_anchor_src === 'extrapolated') issues.push('命中通知缺失，目标锚点按末段速度外推');
            else if (q.target_anchor_src === 'filtered') issues.push('命中通知缺失，目标锚点回退命中时刻插值');
            if ((q.turret_degraded || []).includes('target')) issues.push('目标炮塔角降级为车体朝向');
            if ((q.turret_degraded || []).includes('shooter')) issues.push('射手炮塔角降级为车体朝向');
            if (q.shell_from_broadcast) issues.push('弹种来自开火广播兜底');
            if (q.shell_from_terrain) issues.push('弹种来自地形命中广播兜底（0x1b）');
            if (q.shooter_pitch_from_velocity) issues.push('射手炮管俯仰由弹道推算');
            if (q.dmg_unattributed) issues.push('伤害未记账');
            if (s.target_name && !s.shell_id) issues.push('弹种未知');
            if (s.target_name && s.game_hit_result === 255) issues.push('服务器未通知命中结果');
            return issues;
        }
        // 射手搭载配件自动判定（Type5 物化 9 字节选择串，103=校准弹 / 110=强化装甲）：
        // 回放数据在场（s.shooter_equipment / __shotCtx.eqShooter）时自动生效并禁用手动勾选框；
        // 数据缺失（AoI 未覆盖物化）时回退手动勾选框（旧行为）。
        function shotEquipmentCtx() {
            const ctx = window.__shotCtx || {};
            return { shooter: ctx.eqShooter || null, target: ctx.eqTarget || null };
        }
        function shellPenMul(s) {
            const eq = (s && s.shooter_equipment) || shotEquipmentCtx().shooter;
            const calOn = eq ? eq.calibrated_shells
                : !!(document.getElementById('eq-calibrated') && document.getElementById('eq-calibrated').checked);
            if (!calOn) return 1.0;
            const t = shellTypeOf(s);
            return (t === 'ap' || t === 'apcr') ? 1.06 : 1.07;
        }
        function shellOptionText(s) {
            const pen = Math.round((s.penetration || 0) * shellPenMul(s));
            return `${shellLabel(s)} ${pen}mm / ${s.damage || 0}dmg`;
        }
        function equipmentCoeffs() {
            const penMul = shellPenMul(selectedShell);
            const eqT = shotEquipmentCtx().target;
            const enhOn = eqT ? eqT.enhanced_armor
                : !!(document.getElementById('eq-enhanced') && document.getElementById('eq-enhanced').checked);
            const thickMul = enhOn ? 1.04 : 1.0;
            return { penMul, thickMul };
        }
        // 校准弹判定态变化后刷新下拉穿深文本：populateShellSelector 渲染时回放配件
        // 判定（__shotCtx）常未就绪（并行装载竞速），文本停在基础穿深，与判定
        // 实际采用的 ×1.06/×1.07 口径不一致。只更新文本，不动选中项。
        function refreshShellOptionText() {
            const sel = document.getElementById('shell-select');
            if (!sel || !shooterShells || !shooterShells.length) return;
            Array.from(sel.options).forEach((opt, i) => {
                if (shooterShells[i]) opt.textContent = shellOptionText(shooterShells[i]);
            });
        }
        // 镜头切换时把勾选框同步为回放自动判定（数据在场=禁用并标注来源；缺失=恢复手动）
        function syncEquipmentCheckboxes(s) {
            const cal = document.getElementById('eq-calibrated');
            const enh = document.getElementById('eq-enhanced');
            if (cal) {
                if (s.shooter_equipment) { cal.checked = !!s.shooter_equipment.calibrated_shells; cal.disabled = true; cal.title = '回放自动判定（Type5 配件串）'; }
                else { cal.disabled = false; cal.title = ''; }
            }
            if (enh) {
                if (s.target_equipment) { enh.checked = !!s.target_equipment.enhanced_armor; enh.disabled = true; enh.title = '回放自动判定（Type5 配件串）'; }
                else { enh.disabled = false; enh.title = ''; }
            }
            updateHeatmapThickness();
            refreshShellOptionText();
        }
        function eqBadge(eq) {
            if (!eq) return '<span style="color:var(--muted);">配件?</span>';
            const c = eq.calibrated_shells ? '<span style="color:var(--green);">校准弹✓</span>' : '<span style="color:var(--muted);">校准弹✗</span>';
            const e = eq.enhanced_armor ? '<span style="color:var(--green);">强化装甲✓</span>' : '<span style="color:var(--muted);">强化装甲✗</span>';
            return c + ' ' + e;
        }
        function updateHeatmapThickness() {
            const { thickMul } = equipmentCoeffs();
            rcUniforms.rcThickMul.value = thickMul;   // 续飞层链厚度系数与主图同源
            const apply = function(obj) {
                if (!obj) return;
                obj.traverse(function(node){
                    if (!node.isMesh || !node.material || !node.material.uniforms) return;
                    const u = node.material.uniforms;
                    if (u.thickness && node.userData._baseThickness != null) {
                        u.thickness.value = node.userData._baseThickness * thickMul;
                    }
                });
            };
            apply(spacedArmorScene); apply(primaryArmorScene);
        }
        const externalDepthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, depthTest: true });
        let _emptySpacedTex = null;
        function emptySpacedTexture() {
            if (!_emptySpacedTex) {
                const d = new Uint8Array([0, 0, 0, 0]);
                _emptySpacedTex = new THREE.DataTexture(d, 1, 1, THREE.RGBAFormat);
                _emptySpacedTex.needsUpdate = true;
            }
            return _emptySpacedTex;
        }
        let spacedArmorScene = null;
        let primaryArmorScene = null;

        // 穿透场景克隆工厂：原 addOmitClone/addColorClone/addDepthExcludeClone 三函数
        // 完全同构仅材质不同，合并为单一函数，调用点传各自材质
        function addClone(scene, src, mat, renderOrder) {
            const m = new THREE.Mesh(src.geometry, mat);
            m.renderOrder = renderOrder;
            m.userData._src = src;
            src.updateWorldMatrix(true, false);
            m.matrixAutoUpdate = false;
            m.matrix.copy(src.matrixWorld);
            scene.add(m);
            return m;
        }

        function buildSpacedArmorScene() {
            if (!armorModel) return;
            if (spacedArmorScene) spacedArmorScene.clear();
            else spacedArmorScene = new THREE.Scene();
            const pen = ((selectedShell && selectedShell.penetration) || 200) * equipmentCoeffs().penMul;
            primaryMeshes.forEach(function(node){ addClone(spacedArmorScene, node, omitMaterial, 0); });
            spacedMeshes.forEach(function(node){
                const t = node.userData.armorThickness || 0;
                const cm = addClone(spacedArmorScene, node, spacedMaterial(t, pen), 2);
                cm.userData._baseThickness = t;
                addClone(spacedArmorScene, node, omitMaterial, 5);
            });
            externalMeshes.forEach(function(node){
                const t = node.userData.armorThickness || 20;
                const clipped = node.userData.armorSection === 'gunBarrel' && gunClipPlane;
                const dmat = clipped
                    ? (() => { const m = externalDepthMaterial.clone(); m.clippingPlanes = [gunClipPlane]; return m; })()
                    : externalDepthMaterial;
                const cmat = externalMaterial(t, pen, clipped ? gunClipPlane : null);
                const od = addClone(spacedArmorScene, node, omitMaterial, 3);
                od.material = dmat;
                const cm2 = addClone(spacedArmorScene, node, cmat, 4);
                cm2.userData._baseThickness = t;
            });
        }
        function buildPrimaryArmorScene() {
            if (!armorModel) return;
            if (primaryArmorScene) primaryArmorScene.clear();
            else primaryArmorScene = new THREE.Scene();
            primaryMeshes.forEach(function(node){
                const t = node.userData.armorThickness;
                addClone(primaryArmorScene, node, excludeMaterial, 0);                        // 正面深度遮罩
                const cm = addClone(primaryArmorScene, node, penetrationMaterial(t == null ? 0 : t), 1);  // 着色
                cm.userData._baseThickness = t == null ? 0 : t;
            });
        }
        function syncCloneMatrices(obj) {
            if (!obj) return;
            obj.traverse(function(node){
                const src = node.userData && node.userData._src;
                if (src) {
                    src.updateWorldMatrix(true, false);
                    node.matrix.copy(src.matrixWorld);
                }
            });
        }
        function updateSpacedUniforms(sh) {
            if (!spacedArmorScene) return;
            const t = shellTypeOf(sh);
            const isExplosive = t === 'he' || t === 'heat';
            const { penMul } = equipmentCoeffs();
            const pen = (sh.penetration || 0) * penMul;
            const cal = sh.caliber || 120;
            // BlitzKit：degToRad(shell.normalization ?? 0)
            const norm = (sh.normalization != null ? sh.normalization : 0) * Math.PI / 180;
            const rico = (isExplosive ? 90 : (sh.ricochet != null ? sh.ricochet : 70)) * Math.PI / 180;
            spacedArmorScene.traverse(function(node){
                if (!node.isMesh || !node.material || !node.material.uniforms) return;
                const u = node.material.uniforms;
                if (u.penetration) u.penetration.value = pen;
                if (u.caliber) u.caliber.value = cal;
                if (u.ricochet) u.ricochet.value = rico;
                if (u.normalization) u.normalization.value = norm;
            });
        }

        function disposeMaterial(mat) {
            if (!mat) return;
            if (mat.uniforms) {
                for (const u of Object.values(mat.uniforms)) {
                    const v = u && u.value;
                    if (v && v.isTexture && v !== _emptySpacedTex && !v.isRenderTargetTexture) v.dispose();
                }
            }
            if (mat.map && mat.map.isTexture && mat.map !== _emptySpacedTex) mat.map.dispose();
            mat.dispose();
        }
        // 单场景材质释放（原 primary/spaced 两段 traverse+dispose 完全重复，提取复用）
        function disposeSceneMaterials(scene) {
            if (!scene) return;
            scene.traverse(function(node){
                if (node.isMesh) { if (node.material && node.material.uniforms) disposeMaterial(node.material); }
            });
            scene.clear();
        }
        function disposePenetrationResources() {
            disposeSceneMaterials(primaryArmorScene);
            disposeSceneMaterials(spacedArmorScene);
            if (penetrationRT) {
                if (penetrationRT.depthTexture) penetrationRT.depthTexture.dispose();
                penetrationRT.dispose();
                penetrationRT = null;
            }
            // 续飞 pack/网格随热力图资源整体废弃（纹理已释放；下次重建重新打包）
            if (ricochetGrid && ricochetGrid.textures) {
                ricochetGrid.textures.cellsTex.dispose();
                ricochetGrid.textures.entriesTex.dispose();
                ricochetGrid.textures.worldTrisTex.dispose();
            }
            ricochetPack = null;
            ricochetGrid = null;
            ricochetPoseDirty = true;
            rcUniforms.rcWorldTris.value = null;
            rcUniforms.rcGridCells.value = null;
            rcUniforms.rcGridEntries.value = null;
            rcUniforms.rcEnabled.value = false;
            rcUniforms.rcMode.value = 0;
        }

        // 跳弹续飞求交几何枚举：口径 = 点击判定的 raycast 对象集合经 classifyHit 过滤后的
        // 保留面（armorModel 非 deco、非 configHidden、父节点可见的装甲板 + 按激活炮/掩码
        // 过滤后的外部模块）。可见性口径与 doPenetrationCheck 一致（点击前会取消隐藏网格
        // 本体，但仍拒绝父节点隐藏——classifyHit 同款判定）。
        function collectRicochetEntries() {
            const list = [];
            if (!armorModel) return list;
            armorModel.traverse(function(node) {
                if (!node.isMesh) return;
                const sec = node.userData.armorSection;
                if (sec !== 'hull' && sec !== 'turret' && sec !== 'gun' && sec !== 'spaced') return;
                if (node.userData.configHidden) return;
                if (node.parent && node.parent.visible === false) return;
                const t = node.userData.armorThickness;
                if (typeof t !== 'number') return;
                list.push({ mesh: node, section: sec, thickness: t, variant: null });
            });
            const act = activeGunNumber();
            const cfg = currentConfig();
            const hasMask = cfg && typeof cfg.gun_mask === 'number' && cfg.gun_mask !== 0;
            moduleMeshes.forEach(function(node) {
                if (!node.isMesh) return;
                if (node.userData.gunConfig != null && act != null && node.userData.gunConfig !== act) return;
                if (node.userData.gunMaskPart && !hasMask) return;
                if (node.parent && node.parent.visible === false) return;
                const t = node.userData.armorThickness;
                if (typeof t !== 'number') return;
                const sec = node.userData.armorSection;   // 'chassis' | 'gunBarrel'
                if (sec !== 'chassis' && sec !== 'gunBarrel') return;
                list.push({ mesh: node, section: sec, thickness: t, variant: sec === 'chassis' ? 'track' : 'gun' });
            });
            return list;
        }
        function rebuildRicochetPack() {
            ricochetPack = null;
            ricochetGrid = null;
            ricochetPackReason = '';
            rcUniforms.rcEnabled.value = false;
            const entries = collectRicochetEntries();
            const pack = buildPack(entries);
            if (!pack.ok) {
                // fail-closed：超限/非刚性 → 续飞整体关闭，跳弹维持紫色（现状行为）
                ricochetPackReason = pack.reason + ' (entries=' + entries.length + ')';
                console.warn('[armor-ricochet] continuation disabled:', ricochetPackReason);
                return;
            }
            ricochetPack = pack;
            ricochetGridRetries = 0;
            rebuildRicochetGrid();
            const sh = selectedShell || (shooterShells[0]) || null;
            if (sh) syncRicochetEnabled(sh);
        }
        // 世界系网格重建（炮塔/配置/模型变化时；读取当前 matrixWorld）。
        // 失败不弃用：模块矩阵在加载/对齐时序上可能尚未就位（包围盒异常膨胀 → 网格超密），
        // 保持 poseDirty 下一帧重试（重试上限后禁用，fail-closed 兜底）。
        let ricochetGridRetries = 0;
        const RC_GRID_RETRY_MAX = 240;   // ~4s @60fps：矩阵就位的宽限期
        function rebuildRicochetGrid() {
            if (!ricochetPack) return false;
            const grid = buildRicochetGrid(ricochetPack);
            if (!grid.ok) {
                ricochetGrid = null;
                ricochetPackReason = grid.reason;
                ricochetGridRetries++;
                if (ricochetGridRetries >= RC_GRID_RETRY_MAX) {
                    rcUniforms.rcEnabled.value = false;
                    ricochetPoseDirty = false;   // 放弃重试（跳弹维持紫 = 现状）
                    console.warn('[armor-ricochet] grid disabled after retries:', grid.reason);
                    return false;
                }
                ricochetPoseDirty = true;        // 矩阵可能未就位 → 下一帧重试
                return false;
            }
            ricochetGridRetries = 0;
            // 旧网格纹理释放（disposeMaterial 不会碰它们——不在材质 uniforms 表里）
            if (ricochetGrid && ricochetGrid.textures) {
                ricochetGrid.textures.cellsTex.dispose();
                ricochetGrid.textures.entriesTex.dispose();
                ricochetGrid.textures.worldTrisTex.dispose();
            }
            const tex = createGridTextures(grid);
            grid.textures = tex;
            ricochetGrid = grid;
            rcUniforms.rcWorldTris.value = tex.worldTrisTex;
            rcUniforms.rcTriRows.value = grid.triRows;
            rcUniforms.rcGridCells.value = tex.cellsTex;
            rcUniforms.rcGridEntries.value = tex.entriesTex;
            rcUniforms.rcGridMin.value.set(grid.gridMin[0], grid.gridMin[1], grid.gridMin[2]);
            rcUniforms.rcCell.value = grid.cellSize;
            rcUniforms.rcGridDimsF.value.set(grid.dims[0], grid.dims[1], grid.dims[2]);
            rcUniforms.rcCellRows.value = Math.ceil(grid.cellTotal / RC.CELL_ROW);
            rcUniforms.rcEntryRows.value = Math.ceil(grid.entryTotal / RC.ENTRY_ROW);
            rcUniforms.rcEntryTotal.value = grid.entryTotal;
            ricochetPoseDirty = false;
            return true;
        }
        // 弹种门：仅动能弹（AP/APCR）可跳弹；爆炸弹（HE/HEAT，跳弹角 90°）续飞恒关；
        // 还需网格在位（矩阵未就位的宽限期内跳弹维持紫，网格就位后自动恢复）。
        // rcMode 同步切换（v5.3 全分辨率逐像素：1=启用 0=关闭——低清类通道 pass 已删，
        // 此前由该 pass 设置，删除后曾遗漏导致 rcMode 恒 0 → 续飞全紫）。
        function syncRicochetEnabled(sh) {
            const t = shellTypeOf(sh);
            const on = !!ricochetPack && !!ricochetGrid && (t === 'ap' || t === 'apcr');
            rcUniforms.rcEnabled.value = on;
            rcUniforms.rcMode.value = on ? 1 : 0;
        }
        // 调试/差分测试钩子：info() 看 pack 状态；simulate(跳弹点, 反射向) 跑 JS 参考续飞
        // （与 GLSL rcContinue 同常量同语义，入参口径与着色器一致 = 穿深×0.75）。
        // 浏览器门禁/控制台对拍 "GPU 像素类 vs JS 参考类" 用。
        /**
         * 拖动位移 → 炮塔 / 炮管角度（BlitzKit 式左键拖坦克：灵敏度 = 拖满屏宽转 180°、
         * 拖满屏高俯仰 180°——MixerScene/Model.tsx 的 π/bounds 公式；含俯仰/水平射界限制）。
         */
        function aimFromDrag(dxPx, dyPx) {
            const rect = renderer.domElement.getBoundingClientRect();
            const dx = dxPx * 180 / Math.max(1, rect.width);
            const dy = dyPx * 180 / Math.max(1, rect.height);
            const norm180 = (a) => ((a + 180) % 360 + 360) % 360 - 180;
            const yl = currentConfig()?.yaw_limits;
            const pl = currentConfig()?.pitch_limits;
            let yawDeg = aimStartTurret + dx;
            if (yl) {
                if (yl.max - yl.min < 360) {
                    yawDeg = norm180(Math.max(-yl.max, Math.min(-yl.min, yawDeg)));
                } else {
                    yawDeg = norm180(yawDeg);   // 全向射界：角度回卷 [-180,180)，多圈拖动不无限叠加
                }
            } else {
                const tLeft = tankData.turret_traverse_left ?? 180;
                const tRight = tankData.turret_traverse_right ?? 180;
                if (!(tLeft >= 180 && tRight >= 180)) {
                    yawDeg = Math.max(-tLeft, Math.min(tRight, yawDeg));
                } else {
                    yawDeg = norm180(yawDeg);   // 全向炮塔：同上回卷
                }
            }
            let pitchDeg = aimStartGun - dy;
            let lower = -pl.max, upper = -pl.min;
            const transition = pl.transition || 20;
            if (pl.back) {
                const yawRotatedAbs = Math.abs(norm180(yawDeg - 180));
                if (yawRotatedAbs <= pl.back.range / 2 + transition) {
                    if (yawRotatedAbs <= pl.back.range / 2) {
                        lower = -pl.back.max; upper = -pl.back.min;
                    } else {
                        const tp = (yawRotatedAbs - pl.back.range / 2) / transition;
                        lower = -((1 - tp) * pl.back.max + tp * pl.max);
                        upper = -((1 - tp) * pl.back.min + tp * pl.min);
                    }
                }
            }
            if (pl.front) {
                const yawAbs = Math.abs(norm180(yawDeg));
                if (yawAbs <= pl.front.range / 2 + transition) {
                    if (yawAbs <= pl.front.range / 2) {
                        lower = -pl.front.max; upper = -pl.front.min;
                    } else {
                        const tp = (yawAbs - pl.front.range / 2) / transition;
                        lower = -((1 - tp) * pl.front.max + tp * pl.max);
                        upper = -((1 - tp) * pl.front.min + tp * pl.min);
                    }
                }
            }
            pitchDeg = Math.max(lower, Math.min(upper, pitchDeg));
            currentTurretDeg = yawDeg;
            currentGunDeg = pitchDeg;
            document.getElementById('turret-val').textContent = currentTurretDeg.toFixed(0) + '°';
            document.getElementById('gun-val').textContent = currentGunDeg.toFixed(0) + '°';
            updateTurretGun(currentTurretDeg, currentGunDeg);
        }

        // ===== 瞄准交互（BlitzKit MixerScene 语义；Pointer Events 单一路径，评审 BLOCKER 1/2）=====
        // 按炮管 = yaw+俯仰；按炮塔壳 = 只 yaw；车体/空白 = 相机轨道；短按无拖动 = 点击判定。
        // pointerId 跟踪忽略无关指针；pointer capture 保证画布外拖动/释放也能收到
        // pointerup/pointercancel → controls.enabled 不会卡在 false。
        let aimStartX = 0, aimStartY = 0, aimStartTurret = 0, aimStartGun = 0;
        let aiming = false;
        let aimPitchEnabled = true;
        const aimPointerId = { active: null };
        // 触屏手势仲裁状态（评审 BLOCKER：炮塔/炮管上的第一根手指不得吃掉双指缩放）：
        // 触屏先记候选（controls 保持启用），只有单指移动过 5px 阈值才 claim；第二根手指
        // 一旦到来 → 本会话永不做瞄准，pinch/pan 全权交给 OrbitControls。
        let aimClaimed = false;         // 本会话是否已 claim（claim 后才禁 controls / 捕获）
        let aimPendingPart = null;      // 触屏候选部位（'gun' | 'turret'，未 claim）
        let aimMultiTouch = false;      // 会话内出现过第二根手指 → 让位双指手势
        /** 进入瞄准：禁相机控制 + 捕获指针；起点取当前事件位置（触屏在阈值处 claim，
         *  把已累计的阈值位移吃掉，claim 瞬间不产生角度跳变）。 */
        function claimAim(e, part) {
            aimClaimed = true;
            aimPendingPart = null;
            aiming = true;
            aimPitchEnabled = part === 'gun';
            aimStartX = e.clientX; aimStartY = e.clientY;
            aimStartTurret = currentTurretDeg; aimStartGun = currentGunDeg;
            if (controls) controls.enabled = false;
            try { renderer.domElement.setPointerCapture(e.pointerId); } catch (_) {}
        }
        /** 指针会话的唯一清理点（up / cancel / lostpointercapture 共用）：会话态与
         *  拖动跟踪态一并复位，避免任何一条出口留下半截状态（评审：cleanup 集中完整）。 */
        function endPointerSession(e) {
            if (aimPointerId.active !== e.pointerId) return;
            aimPointerId.active = null;
            aiming = false;
            aimClaimed = false;
            aimPendingPart = null;
            aimMultiTouch = false;
            mouseDownPos = null;
            isDragging = false;
            if (controls) controls.enabled = true;
            try {
                if (renderer.domElement.hasPointerCapture && renderer.domElement.hasPointerCapture(e.pointerId)) {
                    renderer.domElement.releasePointerCapture(e.pointerId);
                }
            } catch (_) {}
        }
        /** 左键按下位置命中哪个瞄准部位（'gun'|'turret'|null=车体/空白→相机）。 */
        function aimPartAt(clientX, clientY) {
            const rect = renderer.domElement.getBoundingClientRect();
            mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(mouse, camera);
            const objs = [];
            if (armorModel) objs.push(armorModel);
            if (tankModel) objs.push(tankModel);
            const hits = raycaster.intersectObjects(objs, true);
            // Raycaster 不查 visible：跳过隐藏链（其它配置的炮塔/炮管/隐藏件），
            // 以第一条可见命中链判定（视觉上光标压着的部位）
            for (let h = 0; h < hits.length && h < 8; h++) {
                let n = hits[h].object;
                let part = null;
                let chainVisible = true;
                while (n) {
                    if (n.visible === false) { chainVisible = false; break; }
                    const name = n.name || '';
                    if (part === null) {
                        if (/^gun_\d/.test(name)) part = 'gun';
                        else if (/^turret_\d/.test(name)) part = 'turret';
                    }
                    n = n.parent;
                }
                if (chainVisible) return part;
            }
            return null;
        }
        const aimPointerHandlers = {
            down(e) {
                if (e.button !== 0) return;                        // 只接左键 / 触摸（触摸 button=0）
                if (aimPointerId.active !== null) {
                    // 会话中的第二根手指：候选瞄准作废、本会话不再进入瞄准（pinch/pan 全权
                    // 交给 OrbitControls）。已 claim 的会话维持瞄准——OrbitControls 此时
                    // 并未登记第一根指针，中途交还只会让它以单指旋转接管第二根手指，
                    // 既做不成 pinch 又丢了正在进行的瞄准；捏合起点本就发生在未 claim 阶段。
                    if (e.pointerType === 'touch') {
                        aimMultiTouch = true;
                        aimPendingPart = null;
                    }
                    return;
                }
                aimPointerId.active = e.pointerId;
                aimClaimed = false;
                aimPendingPart = null;
                aimMultiTouch = false;
                mouseDownPos = { x: e.clientX, y: e.clientY };
                isDragging = false;
                if (window.__worldPan) return;
                const part = aimPartAt(e.clientX, e.clientY);
                if (!part) return;
                if (e.pointerType === 'mouse') {
                    // 鼠标无多指手势冲突：按下即 claim（既有行为，保持零变化）
                    claimAim(e, part);
                } else {
                    // 触屏：只记候选。第二根手指可能马上到来（pinch）——立即 claim 会禁掉
                    // OrbitControls（其 pointerdown 在 enabled=false 时直接 return），
                    // 第二根手指不入 pointer set → 双指缩放失效。改为单指移动过阈值才 claim。
                    aimPendingPart = part;
                }
            },
            move(e) {
                if (aimPointerId.active !== e.pointerId) return;
                if (mouseDownPos) {
                    const dx = e.clientX - mouseDownPos.x;
                    const dy = e.clientY - mouseDownPos.y;
                    if (dx * dx + dy * dy > 25) {
                        isDragging = true; // 5px threshold
                        // 触屏候选在此刻 claim：canvas 的 pointermove 先于 OrbitControls 的
                        // document pointermove 处理，同一事件里禁 controls 仍能拦住相机
                        if (aimPendingPart && !aimClaimed && !aimMultiTouch) claimAim(e, aimPendingPart);
                    }
                }
                if (aiming) aimFromDrag(e.clientX - aimStartX, aimPitchEnabled ? e.clientY - aimStartY : 0);
            },
            up(e) {
                if (aimPointerId.active !== e.pointerId) return;
                const wasDragging = isDragging;       // endPointerSession 会复位手势态，先取
                const wasMultiTouch = aimMultiTouch;
                endPointerSession(e);
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                // 是否触发点击判定只由 isDragging 决定（评审 BLOCKER 1）：短按无拖动一律判定
                // ——点炮塔/炮管同样是「点哪判哪」；手势（拖动 / 双指）不触发判定
                if (wasDragging || wasMultiTouch) return;
                onClick(e);
            },
            cancel: endPointerSession,
            // 指针捕获被系统夺走（元素移除/浏览器抢占）时的兜底出口：会话必须完整收尾
            lostCapture(e) { endPointerSession(e); },
        };
        // 探针：记录最后一次左键点击像素（用户触发问题情形后一条命令取三方对照）。
        // 惰性挂载：闭包顶层 renderer 尚未创建（init 末尾才赋值），animate 首帧再挂。
        let rcLastClick = null;
        let rcClickHooked = false;
        // 判定代数计数（每次 doPenetrationCheck +1）：浏览器门禁用它区分「短按判定」
        // 与「拖动 = 手势（不判定）」——#traj-info 面板被渲染循环持续重新摆位/显示，
        // 无法用 display 判新判定是否发生（评审 BLOCKER 1 的断言口径）
        let judgmentCount = 0;
        function hookRcClickRecorder() {
            if (rcClickHooked || !renderer || !renderer.domElement) return;
            rcClickHooked = true;
            renderer.domElement.addEventListener('mouseup', function(e) {
                if (e.button === 0) rcLastClick = { x: e.clientX, y: e.clientY };
            });
        }
        window.__armorRicochet = {
            info() {
                return {
                    enabled: rcUniforms.rcEnabled.value,
                    meshCount: ricochetPack ? ricochetPack.meshCount : 0,
                    triTotal: ricochetPack ? ricochetPack.triTotal : 0,
                    grid: ricochetGrid ? { dims: ricochetGrid.dims, cell: ricochetGrid.cellSize, entries: ricochetGrid.entryTotal } : null,
                    poseDirty: ricochetPoseDirty,
                    reason: ricochetPackReason,
                    judgments: judgmentCount,
                };
            },
            simulate(bouncePos, reflDir) {
                if (!ricochetPack || !selectedShell) return null;
                const sh = selectedShell;
                const pen = (sh.penetration || 0) * shellPenMul(sh);
                // 入参容错：控制台/CDP 传普通 {x,y,z}（结构化克隆不带 THREE 类）
                const p = bouncePos.isVector3 ? bouncePos : new THREE.Vector3(bouncePos.x, bouncePos.y, bouncePos.z);
                const d = reflDir.isVector3 ? reflDir : new THREE.Vector3(reflDir.x, reflDir.y, reflDir.z);
                return simulateContinuation(ricochetPack, p, d, {
                    remIn: pen * RC.RICO_REMAIN_MUL,
                    caliber: sh.caliber || 120,
                    normalizationRad: (sh.normalization != null ? sh.normalization : 0) * Math.PI / 180,
                    thickMul: equipmentCoeffs().thickMul,
                });
            },
            // GLSL 侧 uniform 当前值（布局对照用）
            __uniforms() {
                return {
                    triRows: rcUniforms.rcTriRows.value, cellRows: rcUniforms.rcCellRows.value, entryRows: rcUniforms.rcEntryRows.value, entryTotal: rcUniforms.rcEntryTotal.value,
                    gridMin: ricochetGrid ? ricochetGrid.gridMin : null, cell: rcUniforms.rcCell.value,
                    dimsF: rcUniforms.rcGridDimsF.value.toArray(), mode: rcUniforms.rcMode.value, thickMul: rcUniforms.rcThickMul.value,
                };
            },
            // CPU 侧逐像素预测类通道（差分测试参照）：RT 像素坐标（左下原点）→
            // 相机射线 → 首命中为主装甲且满足跳弹判据 → 反射 + JS 参考续飞 → cls。
            // skip=true 的像素（首命中非主装甲/不跳弹/无命中）不在比对范围。
            predict(px, py) {
                if (!ricochetPack || !selectedShell) return null;
                const c = renderer.domElement;
                const w = c.width, h = c.height;
                if (px < 0 || py < 0 || px >= w || py >= h) return { skip: true };
                const ndc = new THREE.Vector2((px + 0.5) / w * 2 - 1, (py + 0.5) / h * 2 - 1);
                const dir = new THREE.Vector3(ndc.x, ndc.y, 0.5).unproject(camera)
                    .sub(camera.position).normalize();
                const hits = raycastPackAll(ricochetPack, camera.position, dir, 0.01);
                const first = hits[0];
                const camHits = hits.slice(0, 4).map(x => ({ s: x.section, th: x.thickness, t: +x.t.toFixed(2), ang: +(Math.acos(Math.min(Math.abs(x.normal.dot(dir)), 1)) * 180 / Math.PI).toFixed(0) }));
                if (!first) return { skip: true, why: 'no-hit', camHits };
                if (!(first.section === 'hull' || first.section === 'turret' || first.section === 'gun')) {
                    return { skip: true, why: 'first-not-primary:' + first.section, camHits };
                }
                const PRIM = first.section === 'hull' || first.section === 'turret' || first.section === 'gun';
                if (!PRIM) return { skip: true };   // 首命中为间隙/模块 → 着色器 underSpaced 口径，不比对
                const sh = selectedShell;
                const { penMul, thickMul } = equipmentCoeffs();
                const pen = (sh.penetration || 0) * penMul;
                const caliber = sh.caliber || 120;
                const th = first.thickness * thickMul;
                const angle = Math.acos(Math.min(Math.abs(first.normal.dot(dir)), 1));
                const rico = (sh.ricochet != null ? sh.ricochet : 70) * Math.PI / 180;
                const threeCal = caliber > th * 3.0;   // underSpaced=false（首命中即主装甲）
                if (threeCal || angle < rico) return { skip: true, why: threeCal ? 'threeCal' : 'angle<' + (rico * 180 / Math.PI).toFixed(0), angleDeg: +(angle * 180 / Math.PI).toFixed(1), camHits };
                const r = dir.clone().sub(first.normal.clone().multiplyScalar(2 * dir.dot(first.normal))).normalize();
                const sim = simulateContinuation(ricochetPack, first.point, r, {
                    remIn: pen * RC.RICO_REMAIN_MUL,
                    caliber,
                    normalizationRad: (sh.normalization != null ? sh.normalization : 0) * Math.PI / 180,
                    thickMul,
                });
                return {
                    skip: false, cls: sim.cls,
                    detail: {
                        first: { section: first.section, thickness: first.thickness, angleDeg: +(angle * 180 / Math.PI).toFixed(1), point: [first.point.x.toFixed(2), first.point.y.toFixed(2), first.point.z.toFixed(2)] },
                        reflect: [r.x.toFixed(3), r.y.toFixed(3), r.z.toFixed(3)],
                        layers: (sim.layers || []).map(l => ({ s: l.section, t: +l.t.toFixed(2), eff: +l.eff.toFixed(0), pen: l.penetrated })),
                    },
                };
            },
            // 诊断：部位判定探针（client 坐标 → 'gun'|'turret'|null）
            __aimPart(clientX, clientY) { return aimPartAt(clientX, clientY); },
            // 诊断：瞄准交互状态（浏览器门禁断言「画布外释放不卡死相机」「双指缩放不被
            // 瞄准吃掉」用；cameraDistance = 相机到轨道中心距离，pinch dolly 的可观测面；
            // session = 指针会话内部态，失败时能直接看出是"会话没开"还是"会话没清"）
            aimingState() {
                return {
                    aiming,
                    controlsEnabled: controls ? controls.enabled : null,
                    cameraDistance: (controls && controls.target)
                        ? +camera.position.distanceTo(controls.target).toFixed(4) : null,
                    // 视图静止度（门禁按像素采样部位前必须等它稳定，见 trackCameraMotion）
                    cameraSettledMs: cameraMovedAt ? Math.round(performance.now() - cameraMovedAt) : 0,
                    frameIntervalMs: Math.round(frameIntervalMs),
                    session: {
                        active: aimPointerId.active,
                        claimed: aimClaimed,
                        pending: aimPendingPart,
                        multiTouch: aimMultiTouch,
                    },
                };
            },
            // 诊断：克隆网格 matrix vs matrixWorld（坐标框架核对）
            __clones() {
                if (!primaryArmorScene) return null;
                const out = [];
                primaryArmorScene.children.forEach(c => {
                    if (out.length >= 4 || c.renderOrder !== 1) return;
                    const m = c.matrix.elements, w = c.matrixWorld.elements;
                    let same = true;
                    for (let i = 0; i < 16; i++) if (Math.abs(m[i] - w[i]) > 1e-6) { same = false; break; }
                    out.push({ name: c.userData._src ? (c.userData._src.name || '?') : '?', same, flag: c.matrixWorldNeedsUpdate });
                });
                return out;
            },
            // 诊断：材质实际编译的着色器源码片段（版本核对）
            __shaderPeek() {
                let m = null;
                if (primaryArmorScene) primaryArmorScene.traverse(n => { if (!m && n.isMesh && n.renderOrder === 1) m = n.material; });
                if (!m) return null;
                const src = m.fragmentShader || '';
                return {
                    len: src.length,
                    hasDDA: src.includes('网格 DDA 在线推进'),
                    hasBudget: src.includes('budget'),
                    hasEmptyBody: src.includes('完全空体'),
                    hasCls3: src.includes('探针（恒）'),
                    tail: src.slice(-160),
                };
            },
            // 诊断：网格原始数据（页面内 JS DDA 镜像对照用；引用直通，勿序列化）
            __gridDebug() {
                return ricochetGrid
                    ? { gridMin: ricochetGrid.gridMin, dims: ricochetGrid.dims, cellSize: ricochetGrid.cellSize,
                        cellsData: ricochetGrid.cellsData, entriesData: ricochetGrid.entriesData, worldTrisData: ricochetGrid.worldTrisData }
                    : null;
            },
            // 诊断：当前判定口径（弹参 + 装备系数）
            shell() {
                const sh = selectedShell;
                if (!sh) return null;
                const { penMul, thickMul } = equipmentCoeffs();
                return {
                    type: shellTypeOf(sh), pen: (sh.penetration || 0) * penMul, caliber: sh.caliber || 120,
                    ricoDeg: sh.ricochet != null ? sh.ricochet : 70, normDeg: sh.normalization ?? 0, thickMul,
                    remIn: (sh.penetration || 0) * penMul * RC.RICO_REMAIN_MUL,
                };
            },
            // 诊断：点击链同款求交（含可见性/configHidden 标注）
            __raytrace(px, py) {
                const c = renderer.domElement;
                const rect = c.getBoundingClientRect();
                const ndcX = ((px - rect.left) / rect.width) * 2 - 1;
                const ndcY = -((py - rect.top) / rect.height) * 2 + 1;
                const act = activeGunNumber();
                const cfg = currentConfig();
                const hasMask = cfg && typeof cfg.gun_mask === 'number' && cfg.gun_mask !== 0;
                const activeModules = act == null ? moduleMeshes : moduleMeshes.filter(m => {
                    if (m.userData.gunConfig != null) return m.userData.gunConfig === act;
                    return true;
                }).filter(m => !(m.userData.gunMaskPart && !hasMask));
                const rc = new THREE.Raycaster();
                rc.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
                const objects = [armorModel, ...activeModules];
                const hits = rc.intersectObjects(objects, true);
                return hits.slice(0, 8).map(h => {
                    const sec = h.object.userData.armorSection;
                    return {
                        sec, name: h.object.name || '?', dist: +h.distance.toFixed(3),
                        vis: h.object.visible, hidden: !!h.object.userData.configHidden,
                        parentVis: h.object.parent ? h.object.parent.visible : true,
                        th: h.object.userData.armorThickness,
                    };
                });
            },
            // 最后一次点击的对照：真实点击链结果（DOM 文本）vs CPU 逐像素预测
            probe() {
                if (!rcLastClick) return { error: '还没有点击记录：先在装甲上点一下目标位置' };
                const c = renderer.domElement;
                const rect = c.getBoundingClientRect();
                const cx = Math.floor((rcLastClick.x - rect.left) / rect.width * c.width);
                const cy = Math.floor((rcLastClick.y - rect.top) / rect.height * c.height);
                const infoEl = document.getElementById('traj-info');
                return {
                    canvas: [cx, cy],
                    clickResult: infoEl ? (infoEl.textContent || '').replace(/\s+/g, ' ').slice(0, 400) : '(无 traj-info)',
                    predict: window.__armorRicochet.predict(cx, c.height - 1 - cy),
                    state: window.__armorRicochet.info(),
                };
            },
            // 调试：各打包单元的世界包围盒（定位异常矩阵用）
            units() {
                if (!ricochetPack) return null;
                const bb = new THREE.Box3();
                return ricochetPack.units.map(u => {
                    bb.setFromObject(u.mesh);
                    const mn = bb.min, mx = bb.max;
                    return { name: u.mesh.name || '?', section: u.section,
                        min: [+mn.x.toFixed(2), +mn.y.toFixed(2), +mn.z.toFixed(2)],
                        max: [+mx.x.toFixed(2), +mx.y.toFixed(2), +mx.z.toFixed(2)] };
                });
            },
        };

        function rebuildHeatmapScenes() {
            disposePenetrationResources();
            collectPenetrationMeshes();
            rebuildRicochetPack();
            buildSpacedArmorScene();
            buildPrimaryArmorScene();
            const sh = selectedShell || (shooterShells[0]) || null;
            if (sh) { updatePenetrationUniforms(sh); updateSpacedUniforms(sh); }
            updateHeatmapThickness();
            refreshPenetrationResolution();
        }
        // 装甲模型视图样式（collision 按钮与热力图退出共用一份写入，避免各自硬编码漂移）：
        // 碰撞视图=按厚度上色并隐藏视觉车体；普通视图=透明覆盖层并显示视觉车体
        function applyArmorViewStyle(collision) {
            if (tankModel) tankModel.visible = !collision;
            armorModel.traverse(function(node) {
                if (!node.isMesh) return;
                if (node.userData.armorSection === 'deco') { node.visible = false; return; }
                node.material = collision
                    ? new THREE.MeshStandardMaterial({
                        color: thicknessToColor(node.userData.armorThickness), metalness: 0.4, roughness: 0.6,
                        transparent: true, opacity: 0.95, depthWrite: true,
                    })
                    : new THREE.MeshStandardMaterial({
                        color: 0x444444, metalness: 0.3, roughness: 0.8,
                        transparent: true, opacity: 0, depthWrite: false,
                    });
            });
        }
        function applyPenetrationMode(on) {
            if (!armorModel) return;
            if (!on) {
                disposePenetrationResources();
                armorModel.visible = true;
                // 回到进入热力图前的视图样式（collisionMode 仍开启则恢复碰撞视图）。
                // 不触碰模块网格可见性：热力图开启路径从不隐藏它们；此前在这里按
                // "mask 无值→隐藏 gunMaskPart" 重写视觉模型，会把 gun_XX_mask 炮盾视觉
                // 永久藏掉（有 mask 值的车则反向把 hide_elements 拆件点亮）——该规则只属于
                // collectPenetrationMeshes 的热力图外层网格选取
                applyArmorViewStyle(collisionMode);
                renderer.autoClear = true;
                renderer.setRenderTarget(null);
                return;
            }
            if (tankModel) tankModel.visible = true;
            rebuildHeatmapScenes();
            armorModel.visible = true;
            externalMeshes.forEach(function(node){ node.visible = true; });
        }

        function updatePenetrationUniforms(sh) {
            const t = shellTypeOf(sh);
            const isHE = t === 'he';
            const isExplosive = isHE || t === 'heat';
            syncRicochetEnabled(sh);
            const cal = sh.caliber || 120;
            const { penMul } = equipmentCoeffs();
            const pen = (sh.penetration || 0) * penMul;
            // BlitzKit：degToRad(shell.normalization ?? 0)
            const norm = (sh.normalization != null ? sh.normalization : 0) * Math.PI / 180;
            const rico = (isExplosive ? 90 : (sh.ricochet != null ? sh.ricochet : 70)) * Math.PI / 180;
            const applyTo = (node) => {
                if (!node.isMesh || node.visible === false) return;
                if (!node.material || !node.material.uniforms) return;
                const u = node.material.uniforms;
                if (u.penetration) u.penetration.value = pen;
                if (u.caliber) u.caliber.value = cal;
                if (u.ricochet) u.ricochet.value = rico;
                if (u.normalization) u.normalization.value = norm;
                if (u.isExplosive) u.isExplosive.value = isExplosive;
                if (u.canSplash) u.canSplash.value = isHE;
                if (u.damage) u.damage.value = sh.damage || 0;
                if (u.explosionRadius) u.explosionRadius.value = sh.explosion_radius || 0;
            };
            if (primaryArmorScene) primaryArmorScene.traverse(function(node){ if (node.isMesh) applyTo(node); });
        }
        function refreshPenetrationResolution() {
            const c = renderer.domElement;
            const apply = (obj) => obj.traverse(function(node) {
                if (node.isMesh && node.material && node.material.uniforms && node.material.uniforms.resolution) {
                    node.material.uniforms.resolution.value.set(c.width, c.height);
                    if (node.material.uniforms.metersPerUnit) {
                        node.material.uniforms.metersPerUnit.value = worldMetersPerUnit || 1;
                    }
                }
            });
            if (primaryArmorScene) apply(primaryArmorScene);
        }

        function renderSpacedArmorPass() {
            if (!spacedArmorScene) return;
            const rt = syncPenetrationRT();
            syncCloneMatrices(spacedArmorScene);
            computeGunClipPlane();
            const inject = (obj) => { obj.traverse(function(node){
                if (node.isMesh && node.material && node.material.uniforms && node.material.uniforms.spacedArmorBuffer) {
                    node.material.uniforms.spacedArmorBuffer.value = rt.texture;
                    if (node.material.uniforms.spacedArmorDepth && rt.depthTexture) node.material.uniforms.spacedArmorDepth.value = rt.depthTexture;
                    if (node.material.uniforms.inverseProjectionMatrix) node.material.uniforms.inverseProjectionMatrix.value = camera.projectionMatrixInverse;
                }
            }); };
            if (primaryArmorScene) inject(primaryArmorScene);
            renderer.autoClear = true;
            renderer.setRenderTarget(rt);
            renderer.setClearColor(0x000000, 0);
            renderer.render(spacedArmorScene, camera);
            renderer.autoClear = false;
            renderer.setRenderTarget(null);
        }

        document.getElementById('penetration-btn').addEventListener('click', function() {
            penetrationMode = !penetrationMode;
            this.classList.toggle('active', penetrationMode);
            this.textContent = penetrationMode ? '关闭热力图' : '穿透热力图';
            applyPenetrationMode(penetrationMode);
            refreshPenetrationResolution();
        });

        function retagSpacedSections(model) {
            const root = model || armorModel;
            if (!root) return;
            const cfg = currentConfig();
            const am = tankData.armor_model || {};
            const hullSpaced = new Set((tankData.hull_spaced ?? am.hull?.spaced ?? []).map(String));
            const turretSpaced = new Set((cfg?.turret_spaced ?? am.turret?.spaced ?? []).map(String));
            const gunSpaced = new Set((cfg?.gun_spaced ?? am.gun?.spaced ?? []).map(String));
            root.traverse(function(node) {
                if (!node.isMesh) return;
                const section = node.userData.armorSectionOrig;
                if (section !== 'hull' && section !== 'turret' && section !== 'gun') return;
                const plateId = String(node.userData.armorPlateId);
                const spaced = (section === 'hull' && hullSpaced.has(plateId)) ||
                               (section === 'turret' && turretSpaced.has(plateId)) ||
                               (section === 'gun' && gunSpaced.has(plateId));
                node.userData.armorSection = spaced ? 'spaced' : (section === 'gun' ? 'turret' : section);
            });
        }

        function tagArmorPlates(model) {
            model.traverse(function(node) {
                if (!node.isMesh) return;
                const name = node.name || '';
                if (/state_01/.test(name)) {
                    node.userData.armorSection = 'deco';
                    node.userData.armorPlateId = '';
                    node.userData.armorThickness = 0;
                    return;
                }
                const m = name.match(/(hull|turret|gun)_\w*?_?armor_(\d+)/);
                if (m) {
                    const section = m[1], plateId = m[2];
                    const t = getPlateThickness(section, plateId);
                    if (!isRealArmorThickness(t)) {
                        node.userData.armorSection = 'deco';
                        node.userData.armorPlateId = plateId;
                        node.userData.armorThickness = 0;
                        return;
                    }
                    node.userData.armorSectionOrig = section;
                    node.userData.armorPlateId = plateId;
                    node.userData.armorThickness = t;
                    node.userData.armorSection = section;
                }
            });
            retagSpacedSections(model);
        }

        function tagModuleMeshes(model) {
            moduleMeshes = [];
            model.traverse(function(node) {
                if (!node.isMesh) return;
                const parent = node.parent;
                const parentName = parent ? (parent.name || '') : '';
                let trackNode = null;
                for (let p = node; p; p = p.parent) {
                    const nm = p.name || '';
                    if (/^chassis_track_/.test(nm) || /^chassis_wheel_/.test(nm)) { trackNode = nm; break; }
                }
                if (trackNode) {
                    const isRight = /(^|_)R(_|$)/.test(trackNode);
                    node.userData.armorSection = 'chassis';
                    node.userData.armorPlateId = isRight ? 'rightTrack' : 'leftTrack';
                    node.userData.armorThickness = getPlateThickness('chassis', node.userData.armorPlateId);
                    moduleMeshes.push(node);
                } else if (/^gun_\d+$/.test(parentName)) {
                    node.userData.armorSection = 'gunBarrel';
                    node.userData.armorPlateId = 'gun';
                    node.userData.armorThickness = getPlateThickness('gunBarrel', 'gun');
                    node.userData.gunMaskPart = false;
                    const gm = parentName.match(/^gun_(\d+)/);
                    node.userData.gunConfig = gm ? parseInt(gm[1], 10) : null;
                    moduleMeshes.push(node);
                } else if (/^gun_\d+_/.test(parentName)) {
                    node.userData.armorSection = 'gunBarrel';
                    node.userData.armorPlateId = 'gun';
                    node.userData.armorThickness = getPlateThickness('gunBarrel', 'gun');
                    node.userData.gunMaskPart = true;
                    const gm = parentName.match(/^gun_(\d+)/);
                    node.userData.gunConfig = gm ? parseInt(gm[1], 10) : null;
                    moduleMeshes.push(node);
                }
            });
        }

        let worldMetersPerUnit = 1;      // 场景原生米制：1 单位 = 1 米（模型不再缩放）
        let modelMaxDim = 6;             // 模型实际最长边（米）——仅用于相机取景推算
        // 不缩放（场景原生米制，1 单位 = 1 米）+【模型原点 = 场景原点】：glb 原点即游戏引擎
        // 的车体锚点（= 回放 type10 位置锚点），弹着点/炮口等回放数据零偏移直通；按包围盒
        // 中心对齐会有数厘米残差且被炮管前伸拉偏。代价：OrbitControls 旋转围绕车体锚点
        // （地面高度）而非视觉中心——数据精确性优先。
        function applyModelTransforms(model) {
            model.rotation.x = -Math.PI / 2;
            model.scale.setScalar(1);
            worldMetersPerUnit = 1;
            const box = new THREE.Box3().setFromObject(model);
            const size = box.getSize(new THREE.Vector3());
            modelMaxDim = Math.max(size.x, size.y, size.z);
            model.position.set(0, 0, 0);
        }

        function syncTransforms() {
            if (!tankModel || !armorModel) return;
            armorModel.rotation.copy(tankModel.rotation);
            armorModel.scale.copy(tankModel.scale);
            armorModel.position.copy(tankModel.position);
            collectConfigNodes(tankModel);
            alignArmorModules();
        }

        // models.pb 权威原点装配（对齐 BlitzKit SpacedArmorScene 的 hull/turret/gunOrigin 分组）。
        function alignArmorModules() {
            if (!armorModel || !tankModel) return;
            armorModel.position.copy(tankModel.position);
            armorModel.updateMatrixWorld(true);
            tankModel.updateMatrixWorld(true);

            const installPivot = (mesh, pivot) => {
                if (!mesh.userData.origPos) mesh.userData.origPos = mesh.position.clone();
                mesh.position.copy(mesh.userData.origPos).add(pivot);
                mesh.updateMatrix();
            };

            const mo = tankData && tankData.model_origins;
            const cfgO = currentConfig();
            if (!(mo && mo.track && mo.turret)) return;
            const vTrack = new THREE.Vector3(mo.track[0], mo.track[1], mo.track[2]);
            const vTurret = new THREE.Vector3(mo.turret[0], mo.turret[1], mo.turret[2]);
            const pHull = vTrack.clone();
            const pTurret = vTrack.clone().add(vTurret);
            const pGun = (cfgO && cfgO.gun_origin)
                ? pTurret.clone().add(new THREE.Vector3(cfgO.gun_origin[0], cfgO.gun_origin[1], cfgO.gun_origin[2]))
                : pTurret.clone();
            armorPivotTurret = pTurret.clone();
            armorPivotGun = pGun.clone();
            armorModel.traverse(n => {
                if (!n.isMesh) return;
                const nm = n.name || '';
                if (/^turret_\d+_armor/.test(nm)) { installPivot(n, pTurret); }
                else if (/^gun_\d+_armor/.test(nm)) { installPivot(n, pGun); }
                else if (/^hull_armor/.test(nm)) { installPivot(n, pHull); }
            });
            armorModel.updateMatrixWorld(true);

        }
        function disposeDetachedModel(root) {
            if (!root) return;
            root.traverse(function(node) {
                if (node.geometry && typeof node.geometry.dispose === 'function') node.geometry.dispose();
                const materials = Array.isArray(node.material) ? node.material : (node.material ? [node.material] : []);
                materials.forEach(function(material) {
                    if (!material) return;
                    for (const value of Object.values(material)) {
                        if (value && value.isTexture && typeof value.dispose === 'function') value.dispose();
                    }
                    if (typeof material.dispose === 'function') material.dispose();
                });
            });
        }

        function clearModels() {
            // 释放 GPU 资源：此前只 scene.remove + 置 null，几何/材质/贴图全留在显存里——
            // 反复切换坦克或复现射击时显存单调增长。disposeDetachedModel 是同文件既有助手
            // （此前只用于丢弃「迟到的/失败的」gltf）。
            if (tankModel) { scene.remove(tankModel); disposeDetachedModel(tankModel); tankModel = null; }
            if (armorModel) { scene.remove(armorModel); disposeDetachedModel(armorModel); armorModel = null; }
            if (window.__shooterModel) {
                scene.remove(window.__shooterModel); disposeDetachedModel(window.__shooterModel);
                window.__shooterModel = null;
            }
            _armorPrefixCache = null;   // 装甲模型重建后前缀缓存失效
            if (trajGroup) { scene.remove(trajGroup); trajGroup = null; }
            if (window.__hitMarker) { scene.remove(window.__hitMarker); window.__hitMarker = null; }
            if (window.__endMarker) { scene.remove(window.__endMarker); window.__endMarker = null; }
            if (window.__dbgGroup) { scene.remove(window.__dbgGroup); window.__dbgGroup = null; }
            moduleMeshes = [];
            turretNode = null; gunNodesList = [];
            gunBarrelNodes = [];
            configGunGroups = []; configTurretNodes = [];
            origMatrices = null; armorOrigMatrices = null;
        }

        function loadModels() {
            document.getElementById('loading').style.display = 'block';
            document.getElementById('loading').textContent = L.loading;
            window.__LOAD__ = 'start';
            clearModels();
            const gen = ++loadGen;
            const current = () => gen === loadGen;
            let failed = false;
            modelProgress.reset();
            modelProgress.expect('armor');
            modelProgress.expect('visual');
            // XHR ProgressEvent：长度未知时 total=0，该项只在完成时计满
            const onBytes = (key) => (e) => {
                if (current() && e) modelProgress.update(key, e.loaded, e.lengthComputable ? e.total : 0);
            };
            const finish = (key) => {
                if (!current()) return;
                modelProgress.complete(key);
                const snap = modelProgress.snapshot();
                if (snap.done === snap.total && !failed) reportLoad({ state: 'ready', progress: 1 });
            };
            const loader = new GLTFLoader();
            const fail = (phase) => (error) => {
                const msg = errorMessage(error);
                window.__LOAD__ = 'fail:' + phase + ':' + msg;
                console.error('Failed to load ' + phase + ':', error);
                document.getElementById('loading').textContent = loadFailed(phase, msg);
                if (!current()) return;
                failed = true;
                reportLoad({ state: 'error', message: loadFailed(phase, msg) });
            };

            loader.load(assetProvider.url(tankData.model_url), function(gltf) {
                if (!current() || destroyed) {
                    disposeDetachedModel(gltf?.scene);
                    return;
                }
                armorModel = gltf.scene;
                _armorPrefixCache = null;   // 装甲模型重建后前缀缓存失效
                tagArmorPlates(armorModel);
                armorModel.traverse(function(node) {
                    if (node.isMesh && node.geometry) {
                        // 逐面法线（非索引化 + 逐面重算）：热力图着色的法线必须与点击判定
                        // 的 raycast 面法线同源——hit.face.normal 是几何面法线，若保留 GLB
                        // 平滑法线，曲面/棱线处热力图入射角会偏离判定入射角（实测 T110E5
                        // p90 差 6°，约 11% 表面击穿概率结论相反）。代价是逐面块状着色。
                        if (node.geometry.index) node.geometry = node.geometry.toNonIndexed();
                        node.geometry.computeVertexNormals();
                    }
                });
                armorModel.traverse(function(node) {
                    if (node.isMesh) {
                        if (node.userData.armorSection === 'deco') { node.visible = false; return; }
                        node.material = new THREE.MeshStandardMaterial({
                            color: 0x444444, metalness: 0.3, roughness: 0.8,
                            transparent: true, opacity: 0, depthWrite: false,
                        });
                    }
                });
                scene.add(armorModel);
                syncTransforms();
                applyConfig(currentConfigIdx);
                applyUrlOptionsOnce();
                finish('armor');
            }, onBytes('armor'), fail('armor model'));

            loader.load(assetProvider.url(tankData.visual_model_url), function(gltf) {
                if (!current() || destroyed) {
                    disposeDetachedModel(gltf?.scene);
                    return;
                }
                tankModel = gltf.scene;
                applyModelTransforms(tankModel);
                tagModuleMeshes(tankModel);
                // hide_elements 拆件全部渲染（用户要求完整模型）。拆件位于 hull/turret_XX/gun_XX
                // 子树内，姿态矩阵随父节点自动跟随，无需额外处理。
                tankModel.traverse(function(node) {
                    if (node.isMesh) {
                        node.castShadow = true;
                        node.receiveShadow = true;
                    }
                });
                // 老式车（无 metallicRoughness 贴图）的金属度会被 three.js 取 glTF 默认 1.0
                // 当全金属渲染，无环境贴图下整车发黑（见 glbRig.js）
                neutralizeDefaultMetalness(tankModel);
                // 同回放：Maus 的 mask_01 是 gun_01_mask 的几何副本，rig 不摆位它会留在原地
                dropDuplicateGunMasks(tankModel);
                scene.add(tankModel);
                    // ?debug=1：标注模型原点（=车体原点=场景原点）与两个包围盒中心（验证定位）
                if (QP.get('debug') === '1') {
                    const dbg = new THREE.Group();
                    // 原点：模型原点 = 车体原点 = 场景原点（三轴 RGB=XYZ）
                    dbg.add(new THREE.AxesHelper(0.8));
                    const mk = (color) => new THREE.Mesh(
                        new THREE.SphereGeometry(0.09, 12, 10),
                        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false }));
                    let sum = new THREE.Vector3(); let cnt = 0;
                    tankModel.updateWorldMatrix(true, true);
                    tankModel.traverse(function(node) {
                        if (!node.isMesh || !node.geometry || !node.geometry.attributes.position) return;
                        const pos = node.geometry.attributes.position;
                        for (let i = 0; i < pos.count; i++) {
                            sum.add(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(node.matrixWorld));
                            cnt++;
                        }
                    });
                    const vC = cnt > 0 ? sum.divideScalar(cnt)
                        : new THREE.Box3().setFromObject(tankModel).getCenter(new THREE.Vector3());
                    const vM = mk(0x00ffff); vM.position.copy(vC); vM.renderOrder = 997; dbg.add(vM);
                    if (armorModel) {
                        const aC = new THREE.Box3().setFromObject(armorModel).getCenter(new THREE.Vector3());
                        const aM = mk(0x2b7bff); aM.position.copy(aC); aM.renderOrder = 997; dbg.add(aM);
                    }
                    window.__dbgGroup = dbg;
                    scene.add(dbg);
                }
                document.getElementById('loading').style.display = 'none';
                window.__LOAD__ = 'ok:' + tankData.tank_id;
                controls.target.set(0, 0, 0);   // 旋转中心 = 地面网格原点（模型锚点）
                controls.update();
                syncTransforms();
                applyConfig(currentConfigIdx);
                applyUrlOptionsOnce();
                window.__DBG__ = { scene, tankModel, armorModel, tankData, THREE, controls };
                finish('visual');
            }, onBytes('visual'), fail('tank model'));
        }

        const QP = new URLSearchParams(location.search);
        let urlApplied = false;
        function applyUrlOptionsOnce() {
            if (urlApplied || !tankModel || !armorModel) return;
            urlApplied = true;
            const num = (k) => { const v = parseFloat(QP.get(k)); return isNaN(v) ? null : v; };
            const yaw = num('yaw'), pitch = num('pitch');
            if (yaw !== null || pitch !== null) {
                if (yaw !== null) currentTurretDeg = Math.max(-179, Math.min(179, yaw));
                if (pitch !== null) currentGunDeg = pitch;
                document.getElementById('turret-val').textContent = currentTurretDeg.toFixed(0) + '°';
                document.getElementById('gun-val').textContent = currentGunDeg.toFixed(0) + '°';
                updateTurretGun(currentTurretDeg, currentGunDeg);
            }
            const shooterTank = parseInt(QP.get('shooter'), 10);
            if (!isNaN(shooterTank) && shooterTank > 0) {
                loadShooter(shooterTank);
            }
            const view = QP.get('view');
            const azOv = num('az'), distOv = num('dist'), hOv = num('h');
            if (view || azOv !== null || hOv !== null || distOv !== null) {
                // 炮线高度（米）：gun 枢轴的 glb z（场景原生米制，无缩放）
                const gunLine = (armorPivotGun ? armorPivotGun.z : 2.0);
                // 视角预设（对齐 BlitzKit 语义）：front/rear/left/right = 炮线高度水平视角；
                // hull_down = 低机位仰视炮塔；top = 俯视。机位距离 = 模型最长边倍数
                //（取景需要，与数据无关）：水平 0.80×、斜角 0.87×、顶视 1.17×；顶视高度 = 炮线 + 2×模型长
                const P = ({
                    front:       {az:0,   h:gunLine,     ty:gunLine,      d:0.80*modelMaxDim},
                    rear:        {az:180, h:gunLine,     ty:gunLine,      d:0.80*modelMaxDim},
                    left:        {az:90,  h:gunLine,     ty:gunLine,      d:0.80*modelMaxDim},
                    right:       {az:270, h:gunLine,     ty:gunLine,      d:0.80*modelMaxDim},
                    hull_down:   {az:0,   h:1.1,         ty:gunLine+0.3,  d:0.83*modelMaxDim},
                    top:         {az:0,   h:gunLine+2.0*modelMaxDim, ty:0.1*modelMaxDim, d:1.17*modelMaxDim},
                    front_left:  {az:45,  h:gunLine,     ty:gunLine,      d:0.87*modelMaxDim},
                    front_right: {az:315, h:gunLine,     ty:gunLine,      d:0.87*modelMaxDim},
                    rear_left:   {az:135, h:gunLine,     ty:gunLine,      d:0.87*modelMaxDim},
                    rear_right:  {az:225, h:gunLine,     ty:gunLine,      d:0.87*modelMaxDim},
                })[view] || {az:0, h:gunLine, ty:gunLine, d:0.80*modelMaxDim};
                const d = distOv !== null ? distOv : P.d;
                const a = (azOv !== null ? azOv : P.az) * Math.PI / 180;
                const h = hOv !== null ? hOv : P.h;
                camera.position.set(Math.sin(a) * d, h, -Math.cos(a) * d);
                controls.target.set(0, 0, 0);   // 旋转中心 = 地面网格原点（与初始状态一致）
                controls.update();
            }
            if (QP.get('heatmap') === '1' && !penetrationMode) {
                penetrationMode = true;
                const btn = document.getElementById('penetration-btn');
                btn.classList.add('active'); btn.textContent = '关闭热力图';
                applyPenetrationMode(true);
                refreshPenetrationResolution();
            }
            const shotNo = parseInt(QP.get('shot'), 10);
            const isShotReplay = !isNaN(shotNo);
            if (isShotReplay) {
                // 数据来源：射击复现表经 sessionStorage 交接（WotBTools 纯客户端链），
                // 无交接回退 Agent 自托管 /api/replay_shot（agentData.fetchReplayShots）
                fetchReplayShots().then(d => {
                    const shots = d.shots || d;
                    const s = (Array.isArray(shots) ? shots : []).find(x => x.index === shotNo);
                    if (!s) { showShotError('shot #' + shotNo + ' 不存在（接口返回 ' + (Array.isArray(shots) ? shots.length : 0) + ' 发）'); return; }
                    window.__autoRelView = true;   // 默认相对视角（沿入射方向）
                    // 场景原生米制（1 单位 = 1 米，模型不缩放）：回放数据为真实米，直通使用
                    if (!armorPivotGun) { showShotError('炮管枢轴未安装（模型装配异常）'); return; }
                    // ===== 模型保持默认朝向（车头 -Z），相机做相对调整 =====
                    // toModel = 正交旋转 Ry(π−hullYaw)（无镜像）：世界前向 (sin,0,+cos) 映到模型
                    // 前向 -Z、世界右方映到模型右方；含 z 取反的反射版会使相对视图左右互换。
                    const ta = s.target_ang || [0, 0, 0];
                    // ===== world=1 模式：双模型世界坐标渲染 =====
                    const isWorld = true;   // 世界模式 = 射击复现主视图（旧装甲查看器主视图已删除，world=1 参数兼容但不再需要）
                    if (isWorld) mirrorShotData(s);   // 函数声明提升，定义见下
                    // ===== 命中冲击姿态滤波（必须在 mirror【之后】构造）=====
                    // 实测命中时刻 type10 姿态含冲击晃动（0.1s 内 roll 突变 ~12°），弹丸命中的是
                    // 冲击【前】车体 → 命中 tick(dt≈0) 的 pitch/roll 用最近 dt<0 采样替代（yaw 保留）。
                    // mirror 会原地取反 tick_samples 的 yaw/roll——此处读到的已是镜像值，与
                    // 滑块/回退路径的相邻采样同号（先拷贝会残留未镜像 roll，命中时刻侧倾
                    // 符号翻转 → 移动转向目标姿态跳变、弹着点偏移）。
                    let hitAtt = null;
                    {
                        let pre = null;
                        for (const t of (s.tick_samples || [])) {
                            if (t.dt < -0.02 && (!pre || t.dt > pre.dt)) pre = t;
                        }
                        if (pre && pre.dt > -0.35) hitAtt = { pitch: pre.pitch, roll: pre.roll };
                    }
                    // 判定层姿态回退（无渲染锚点时摆放用；同因必须在 mirror 后读取）
                    const taF = [ (ta[0]||0),
                        (hitAtt ? hitAtt.pitch : (ta[1]||0)),
                        (hitAtt ? hitAtt.roll : (ta[2]||0)) ];
                    // ===== 世界镜像校正（数据入口一次性变换：x/yaw/roll 取反）=====
                    // 回放坐标系(BigWorld)与 three.js 右手系在水平面上手性相反：直接渲染左右舷互换。
                    // 镜像 = x 取反、yaw/roll 取反（pitch 不变——绕 x 轴旋转在 x 镜像下不变），
                    // 模型网格不动，经共轭旋转自动呈正确手性。
                    function mirrorShotData(s) {
                        if (s.__worldMirrored) return;
                        s.__worldMirrored = true;
                        const negX = (a) => { if (Array.isArray(a) && a.length >= 3) a[0] = -a[0]; };
                        const negAng = (a) => { if (Array.isArray(a) && a.length >= 3) { a[0] = -a[0]; a[2] = -a[2]; } };
                        negX(s.ball_a); negX(s.ball_b); negX(s.launch_velocity);
                        negX(s.shooter_pos); negX(s.target_pos);
                        negX(s.aim_point); negX(s.launch_point_rel);
                        // 炮塔相对角时间线：透传不取反（存游戏系原始值）。
                        // 镜像场景的【节点旋转角】须取负（−rel，镜像翻转旋转方向），
                        // 该取反在使用点完成——同初始摆放 turretDegT = 镜像炮塔角−镜像车体角 = −rel
                        const mirTL = (tl) => { if (Array.isArray(tl)) for (const t of tl) { negX(t.pos); t.yaw = -t.yaw; t.roll = -t.roll; } };
                        mirTL(s.target_render_timeline); mirTL(s.shooter_render_timeline);
                        negAng(s.shooter_ang); negAng(s.target_ang);
                        if (typeof s.shooter_turret_yaw === 'number') s.shooter_turret_yaw = -s.shooter_turret_yaw;
                        if (typeof s.target_turret_yaw === 'number') s.target_turret_yaw = -s.target_turret_yaw;
                        for (const t of (s.tick_samples || [])) { negX(t.pos); t.yaw = -t.yaw; t.roll = -t.roll; }
                        for (const t of (s.shooter_tick_samples || [])) { negX(t.pos); t.yaw = -t.yaw; t.roll = -t.roll; }
                        if (s.terrain_impact) { negX(s.terrain_impact.impact_point); negX(s.terrain_impact.terminal_dir); }
                        if (s.shooter_aim && typeof s.shooter_aim.turret_rel_yaw === 'number') {
                            s.shooter_aim.turret_rel_yaw = -s.shooter_aim.turret_rel_yaw;
                        }
                        // 渲染锚点与时间线同规则镜像：pos.x / yaw / roll 取反（pitch 不变）。
                        // 此前漏取反 roll——初始摆放（锚点）与滑块 dt=0（时间线，已取反）在
                        // 有侧倾的移动目标上姿态差一个侧倾符号，拖动滑块才"恢复"。
                        if (s.target_render) { negX(s.target_render.pos); negAng(s.target_render.ang); }
                        if (s.shooter_render) { negX(s.shooter_render.pos); negAng(s.shooter_render.ang); }
                    }
                     // world 穿透判定标志每次进入射击复现重置（防上次会话残留）
                     window.__worldPenMode = false;
                     window.__worldServerInfo = null;
                     // 片元交叉验证上下文（doPenetrationCheck 读取）：世界模式同样提供 segment 解码字段
                     window.__shotCtx = Object.assign({}, window.__shotCtx || {}, {
                         segArmorGroup: s.armor_group || 0,
                         segShellId: s.shell_id || 0,
                         segResult: (typeof s.game_hit_result === 'number') ? s.game_hit_result : 255,
                         eqShooter: s.shooter_equipment || null,
                         eqTarget: s.target_equipment || null,
                     });
                     syncEquipmentCheckboxes(s);
                    // 射手炮塔/炮管姿态（回放原始数据）：炮塔 = type7 prop2 绝对朝向 − 模型偏航；
                    // 炮管俯仰 = launch_velocity 垂直分量反解（prop9 实测与真实弹道无关，弃用）。
                    // cfgIdx = 射手实际搭载配置下标（build_configs 数组序，回放数据注入）；
                    // 多配置坦克按其选炮塔/主炮变体（applyConfigVisible 同式），null = 默认顶级
                    function poseShooterTurretGun(sModel, sd, turretAbsYaw, lv, hullYawS, hullPitchS, hullRollS, gunPitchRad, turretRelOverride, cfgIdx) {
                        if (!sModel || !sd) return;
                        const turrets = [];
                        const gunGroups = new Map();
                        sModel.traverse(function(n) {
                            const nm = n.name || '';
                            const gm = nm.match(/^gun_(\d+)/);
                            const tm = nm.match(/^turret_(\d+)$/);
                            if (gm) { const g = parseInt(gm[1], 10); if (!gunGroups.has(g)) gunGroups.set(g, []); gunGroups.get(g).push(n); }
                            else if (tm) turrets.push(n);
                        });
                        turrets.sort(function(a, b) { return ((a.name.match(/\d+/)[0] | 0) - (b.name.match(/\d+/)[0] | 0)); });
                        const gKeys = Array.from(gunGroups.keys()).sort(function(a, b) { return a - b; });
                        // cfgIdx = configs 数组下标；越界/缺失 → 顶级（末位）
                        const nCfg = (sd.configs && sd.configs.length) || 1;
                        const cfgSel = (Number.isInteger(cfgIdx) && cfgIdx >= 0 && cfgIdx < nCfg) ? cfgIdx : nCfg - 1;
                        const selCfg = sd.configs ? sd.configs[cfgSel] : null;
                        const selTi = selCfg ? selCfg.turret_index : 0;
                        const selGi = selCfg ? selCfg.gun_index : 0;
                        // 未选变体隐藏（含子树）；选中的炮塔/主炮参与摆位
                        turrets.forEach(function(n, i) { n.visible = (i === (selTi % turrets.length)); });
                        gKeys.forEach(function(k, i) { gunGroups.get(k).forEach(function(n) { n.visible = (i === (selGi % gKeys.length)); }); });
                        let turretNode = turrets.length ? turrets[selTi % turrets.length] : null;
                        let gunNodes = gKeys.length ? gunGroups.get(gKeys[selGi % gKeys.length]) : [];
                        const mo = sd.model_origins;
                        if (!turretNode || !(mo && mo.track && mo.turret)) {
                            console.warn('[world] shooter turret/gun pose skipped:',
                                !turretNode ? 'no turret node' : 'no model_origins');
                            return;
                        }
                        const cfg = selCfg;
                        const tP = [mo.track[0]+mo.turret[0], mo.track[1]+mo.turret[1], mo.track[2]+mo.turret[2]];
                        let gP = tP.slice();
                        if (cfg && cfg.gun_origin) gP = [tP[0]+cfg.gun_origin[0], tP[1]+cfg.gun_origin[1], tP[2]+cfg.gun_origin[2]];
                        // 炮塔相对角：优先用显式 rel（镜像系 = −rel；避免"判定层绝对角 −
                        // 渲染层 hull yaw"往返在移动转向时混入转向率×滤波延迟的角度误差）；
                        // 未提供时退回绝对角相减（旧路径）
                        const tr = (turretRelOverride != null) ? turretRelOverride : (turretAbsYaw - hullYawS);
                        // lv → 射手车体系：undo 完整车体姿态（yaw/pitch/roll）。仅 undo 偏航时
                        // 坡地射击会带上车体俯仰的假俯仰（shot3 T110 实测渲染 +6.5°、真值 −0.1°）。
                        // 注意 poseFromYPR 含 qFrame（z-up→y-up 帧变换），其逆作用得到的是帧前
                        // 中间系，还需转回 glb 车体系（+Y 前/+Z 上）；等价做法：仰角 = asin(lv·upWorld/|lv|)。
                        let gr = 0;
                        if (gunPitchRad != null) {
                            // 回放时序驱动（与客户端一致）：炮管俯仰 = type=10 pitch 时序插值
                            gr = gunPitchRad;
                        } else if (lv) {
                            const qH = poseFromYPR(hullYawS, hullPitchS || 0, hullRollS || 0);
                            const llv = Math.hypot(lv[0], lv[1], lv[2]);
                            if (llv > 0.1) {
                                // 炮管运动学：模型系炮管方向 = Rz(炮塔rel)·Rx(俯仰)·(0,1,0)。
                                // 反解：①世界→车体(qH⁻¹)消地形俯仰/侧倾 → ②车体→炮塔系(Rz(−rel))消
                                // 水平偏航 → ③仰角 = atan2(z, y)。未消炮塔偏航时 roll 混入俯仰
                                // (GB109 shot2:炮塔 rel −67°,解出 +22.8°,真值 +9.5°,差 13°)。
                                const lvB = new THREE.Vector3(lv[0], lv[1], lv[2]).applyQuaternion(qH.clone().invert());
                                const cT = Math.cos(tr), sT = Math.sin(tr);
                                const lvT = new THREE.Vector3(
                                    lvB.x*cT + lvB.y*sT, -lvB.x*sT + lvB.y*cT, lvB.z);
                                gr = Math.atan2(lvT.z, lvT.y);
                            }
                        }
                        let turretRot = new THREE.Matrix4().makeRotationZ(tr);
                        const itr = sd.initial_turret_rotation;
                        if (itr) {
                            turretRot = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
                                -THREE.MathUtils.degToRad(itr.pitch), -THREE.MathUtils.degToRad(itr.roll),
                                tr - THREE.MathUtils.degToRad(itr.yaw), 'XYZ'));
                        }
                        const mT = new THREE.Matrix4().makeTranslation(tP[0], tP[1], tP[2]).multiply(turretRot)
                            .multiply(new THREE.Matrix4().makeTranslation(-tP[0], -tP[1], -tP[2]));
                        const mG = mT.clone().multiply(new THREE.Matrix4().makeTranslation(gP[0], gP[1], gP[2]))
                            .multiply(new THREE.Matrix4().makeRotationX(gr))
                            .multiply(new THREE.Matrix4().makeTranslation(-gP[0], -gP[1], -gP[2]));
                        turretNode.updateMatrix(); turretNode.matrixAutoUpdate = false;
                        // 首次调用缓存各节点烘焙矩阵；后续调用基于烘焙矩阵重摆
                        //（幂等——否则滑块每次输入都会累乘旋转，炮塔越转越乱）
                        if (!turretNode.userData.__poseBaked) {
                            turretNode.userData.__poseBaked = turretNode.matrix.clone();
                            for (const gn of gunNodes) {
                                gn.userData.__poseBaked = gn.matrix.clone();
                                // 必须关自动合成：否则 updateMatrixWorld 用未修改的
                                // quaternion 重写 matrix，炮管姿态被静默丢弃（渲染在车体正前向）
                                gn.matrixAutoUpdate = false;
                            }
                        }
                        turretNode.matrix.copy(mT.clone().multiply(turretNode.userData.__poseBaked));
                        for (const gn of gunNodes) {
                            gn.matrix.copy(mG.clone().multiply(gn.userData.__poseBaked));
                        }
                        sModel.updateMatrixWorld(true);
                        console.log('[world] shooter turret/gun posed: turretRel=' +
                            (-(turretAbsYaw - hullYawS) * 180 / Math.PI).toFixed(1) + '° gunPitch=' +
                            (gr * 180 / Math.PI).toFixed(1) + '° gunNodes=' + gunNodes.length);
                    }
                    // type10 原始欧拉 → 场景四元数（世界直通摆放，双方模型共用）。
                    // 车体前向 = (sin yaw, 0, +cos yaw)，glb 前向 = 内部 +Y（炮管伸出端）；
                    // 帧变换 Q0 = Ry(π)·Rx(−π/2)：内部 +Y→场景+Z、+Z→场景+Y（正交保向）。
                    // pitch/roll 是车体轴旋转，必须作用在【偏航前】的 yaw0 系上（前轴=+Z、
                    // 右轴=−X → −pitch ≡ Rx(+pitch)、+roll = Rz(+roll)）：
                    // Q = Ry(+yaw)·Rx(+pitch)·Rz(+roll)·Q0。把轴写成偏航后世界轴会使俯仰
                    // 落到错误轴——坡地姿态错约 2×坡度（GB109 shot2 爬 15° 坡实测错 19°）。
                    // 符号实证：pitch 正=车头下坡（+15° 上坡全部 tick pitch≈−15.5）；
                    // roll 正=右倾（4 份回放反解 ball_a 车体偏移，垂直分量 std 收窄 2-13×）。
                    // poseFromYPR = 共享 rig（scene/glbRig.js）
                    // 射手模型加载工厂（原命中/脱靶两分支大段重复：并行 fetch /api/tank +
                    // GLTFLoader 加载 → applyPose 摆位 → 炮闩 bake 前捕获 → 半透明材质克隆
                    // → scene.add）。resolve({ sd, sModel, breechGunLocal })；GLB 加载失败
                    // resolve(null)。分支差异参数化：logTag（日志前缀）、castShadow
                    // （命中分支网格投影阴影，脱靶分支不投影）、applyPose（各自位姿闭包）。
                    // applyPose 必须在炮闩捕获前调用——breechGunLocal 依赖模型当前世界矩阵。
                    function loadShooterModel(tid, opts) {
                        const castShadow = !!(opts && opts.castShadow);
                        const logTag = (opts && opts.logTag) || '[world]';
                        // URL 前缀跟随目标模型（Web 服务挂 /armor_view/glb/...，独立 viewer 挂 /glb/...，
                        // 硬编码 /glb/ 在 Web 下 404）；/api/tank 不手动拼前缀——viewer_index_html
                        // 已对字面量 '/api/ 加前缀，手动拼会双重前缀 404。
                        const shooterGlbUrl = assetProvider.url(tankData.visual_model_url.replace(/\/glb\/\d+\//, '/glb/' + tid + '/'));
                        return Promise.all([
                            fetchTankData(tid).catch(() => null),
                            new Promise(function(res) {
                                new GLTFLoader().load(shooterGlbUrl,
                                    function(g) { res(g); }, undefined, function() { res(null); });
                            }),
                        ]).then(function(arr) {
                            const sd = arr[0], gltf = arr[1];
                            if (!gltf) { console.warn(logTag + ' shooter model load failed'); return null; }
                            const sModel = gltf.scene;
                            sModel.scale.setScalar(1);
                            // hide_elements 拆件全部渲染（与视觉模型同规则；随父节点姿态自动跟随）
                            if (opts && opts.applyPose) opts.applyPose(sModel);
                            // 炮闩 gun 局部坐标——必须在炮塔/炮管 bake【之前】捕获：
                            // bake 会改写 gun 节点矩阵（绕枢轴偏航/俯仰），之后无法从模型系反推。
                            let breechGunLocal = null;
                            try {
                                let gunPre = null;
                                sModel.traverse(function(n) {
                                    if (!gunPre && /^gun_\d+$/.test(n.name || '')) gunPre = n;
                                });
                                const moPre = sd && sd.model_origins;
                                if (gunPre && moPre) {
                                    const scP = (sd.configs && sd.configs.length) ? sd.configs[sd.configs.length - 1] : null;
                                    // 炮闩标注 = 炮管枢轴 gP(models.pb 原点链)本身，不用碰撞 YAML 后伸量修正
                                    const breechModel = new THREE.Vector3(
                                        moPre.track[0]+moPre.turret[0]+((scP && scP.gun_origin) ? scP.gun_origin[0] : 0),
                                        moPre.track[1]+moPre.turret[1]+((scP && scP.gun_origin) ? scP.gun_origin[1] : 0),
                                        moPre.track[2]+moPre.turret[2]+((scP && scP.gun_origin) ? scP.gun_origin[2] : 0));
                                    sModel.updateMatrixWorld(true);
                                    breechGunLocal = gunPre.worldToLocal(sModel.localToWorld(breechModel));
                                }
                            } catch (e) { console.warn(logTag + ' breech capture failed:', e); }
                            sModel.traverse(function(node) {
                                if (node.isMesh) {
                                    if (castShadow) node.castShadow = true;
                                    if (node.material) {
                                        node.material = node.material.clone();
                                        node.material.transparent = true;
                                        node.material.opacity = 0.6;
                                    }
                                }
                            });
                            // 必须在材质 clone 之后：幽灵车与目标车同规则（老式车金属度归零）
                            neutralizeDefaultMetalness(sModel);
                            sModel.updateMatrixWorld(true);
                            scene.add(sModel);
                            return { sd: sd, sModel: sModel, breechGunLocal: breechGunLocal };
                        });
                    }
                        // 解除装甲检视的近距限制（fog 15-50 / maxDistance 30 会吞掉远距离交战）
                        scene.fog = null;
                        controls.maxDistance = 1e6;
                        controls.minDistance = 0.5;
                        // 右键 = 平移视角（地面平面），禁用手动炮塔/炮管拖拽（回放姿态由数据驱动）
                        controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
                        controls.screenSpacePanning = false;
                        window.__worldPan = true;
                        const hintEl = document.getElementById('controls-hint');
                        if (hintEl) hintEl.textContent = L.worldHint;
                        // ===== 脱靶弹分支：无目标模型，仅射手 + 弹道 + 落点/材质标注 =====
                        // terrain_impact（method 0x1b）提供精确落点与弹道末段起点。
                        const isMiss = !s.target_name;
                        if (isMiss) {
                            const sTS2 = s.shooter_tick_samples || [];
                            const sHit2 = sTS2.reduce((a, b) =>
                                (Math.abs(b.dt) < Math.abs(a.dt)) ? b : a, sTS2[0]);
                            const shooterPos2 = sHit2 ? sHit2.pos : s.shooter_pos;
                            const ba = s.ball_a || null, bb = s.ball_b || null;
                            if (!ba || !bb || !(ba[0] || ba[1] || ba[2])) { showShotError('脱靶弹缺少弹道数据（ball_a/ball_b）'); return; }
                            dbgReset('调试信息 — Shot #' + s.index + '（脱靶）');
                            // 场景中心 = 弹道弦中点（模型为参照物的最小摆放）
                            const mcx = (ba[0] + bb[0]) / 2, mcy = (ba[1] + bb[1]) / 2, mcz = (ba[2] + bb[2]) / 2;
                            // 目标模型加载但隐藏：viewer 主流程依赖 tankModel/armorModel 存在
                            tankModel.visible = false;
                            armorModel.visible = false;
                            // 射手模型：复用命中分支的加载/放置逻辑（loadShooterModel 工厂）
                            const shooterTid2 = parseInt(QP.get('shooter'), 10);
                            if (shooterTid2 > 0) {
                                loadShooterModel(shooterTid2, {
                                    logTag: '[world-miss]',
                                    applyPose: function(sModel) {
                                        const sYaw2 = sHit2 ? sHit2.yaw : 0;
                                        sModel.quaternion.copy(poseFromYPR(sYaw2, sHit2 ? sHit2.pitch : 0, sHit2 ? sHit2.roll : 0));
                                        sModel.position.set(shooterPos2[0] - mcx, shooterPos2[1] - mcy, shooterPos2[2] - mcz);
                                        // 锚点 = type10 记录位置,不做 ball_a 对齐平移（原因见命中分支注释）
                                        window.__shooterFix = new THREE.Vector3(0, 0, 0);
                                    },
                                }).then(function(res) {
                                    if (!res) return;
                                    const sd = res.sd, sModel = res.sModel, breechGunLocal2 = res.breechGunLocal;
                                    const sYaw2 = sHit2 ? sHit2.yaw : 0;
                                    // 脱靶分支同命中分支：显式 rel（镜像系相减还原 −rel）；prop2
                                    // frac 俯仰直用，回退时弹速反解
                                    const sgp2 = (s.quality && s.quality.gun_pitch_degraded &&
                                        s.quality.gun_pitch_degraded.indexOf('shooter') >= 0)
                                        ? null : (s.shooter_gun_pitch != null ? s.shooter_gun_pitch : null);
                                    const sRel2 = (s.shooter_turret_yaw || 0) - (s.shooter_ang ? s.shooter_ang[0] : 0);
                                    poseShooterTurretGun(sModel, sd, s.shooter_turret_yaw, s.launch_velocity, sYaw2,
                                        sHit2 ? sHit2.pitch : 0, sHit2 ? sHit2.roll : 0, sgp2, sRel2, s.shooter_config_idx);
                                    // 基准点标记（调试模式）：type10 记录位置锚点，坐标写入调试信息窗口。
                                    // 脱靶分支无 tick 切换，模型静态——标记挂 __worldAnno 随调试开关显隐。
                                    if (window.__worldAnno) {
                                        const amk2 = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10),
                                            new THREE.MeshBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 0.95, depthTest: false }));
                                        amk2.position.copy(sModel.position);
                                        amk2.renderOrder = 998;
                                        window.__worldAnno.add(amk2);
                                        dbgInfo('dbg-anchor-shooter', '#00aaff', '基准点·射手',
                                            fmt3(sModel.position.x + mcx, sModel.position.y + mcy, sModel.position.z + mcz));
                                    }
                                    // 炮闩标注（脱靶分支，镜像命中分支）:位置随炮塔/炮管 bake
                                    // 变换，标签附回放世界系坐标；对照线连服务器发射点 ball_a
                                    try {
                                        if (breechGunLocal2 && window.__worldAnno) {
                                            let gunNode2 = null;
                                            sModel.traverse(function(n) {
                                                if (!gunNode2 && /^gun_\d+$/.test(n.name || '')) gunNode2 = n;
                                            });
                                            if (gunNode2) {
                                                gunNode2.updateMatrixWorld(true);
                                                const bpos = breechGunLocal2.clone().applyMatrix4(gunNode2.matrixWorld);
                                                const bm2 = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10),
                                                    new THREE.MeshBasicMaterial({ color: 0xcc66ff, transparent: true, opacity: 0.95, depthTest: false }));
                                                bm2.position.copy(bpos);
                                                bm2.renderOrder = 998;
                                                window.__worldAnno.add(bm2);
                                                dbgInfo('dbg-breech', '#cc66ff', '炮闩',
                                                    fmt3(bpos.x + mcx, bpos.y + mcy, bpos.z + mcz));
                                                const dl2 = new THREE.Line(
                                                    new THREE.BufferGeometry().setFromPoints([bpos.clone(),
                                                        new THREE.Vector3(ba[0]-mcx, ba[1]-mcy, ba[2]-mcz)]),
                                                    new THREE.LineDashedMaterial({
                                                        color: 0xffffff, transparent: true, opacity: 0.8,
                                                        dashSize: 0.35, gapSize: 0.25, depthTest: false }));
                                                dl2.computeLineDistances();
                                                dl2.renderOrder = 996;
                                                window.__worldAnno.add(dl2);
                                            }
                                        }
                                    } catch (e) { console.warn('[world-miss] muzzle marker failed:', e); }
                                });
                            }
                            // 标注组
                            if (window.__worldAnno) { scene.remove(window.__worldAnno); }
                            window.__worldAnno = new THREE.Group();
                            const chordM = Math.sqrt((bb[0]-ba[0])**2 + (bb[1]-ba[1])**2 + (bb[2]-ba[2])**2);
                            const trajGeo2 = new THREE.BufferGeometry().setFromPoints([
                                new THREE.Vector3(ba[0]-mcx, ba[1]-mcy, ba[2]-mcz),
                                new THREE.Vector3(bb[0]-mcx, bb[1]-mcy, bb[2]-mcz),
                            ]);
                            const trajLine2 = new THREE.Line(trajGeo2,
                                new THREE.LineBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.7, depthTest: false }));
                            trajLine2.renderOrder = 997;
                            window.__worldAnno.add(trajLine2);
                            const lpM2 = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10),
                                new THREE.MeshBasicMaterial({ color: 0xff6622, transparent: true, opacity: 0.95, depthTest: false }));
                            lpM2.position.set(ba[0]-mcx, ba[1]-mcy, ba[2]-mcz);
                            lpM2.renderOrder = 998;
                            window.__worldAnno.add(lpM2);
                            const lv2 = s.launch_velocity || [0, 0, 0];
                            const spd2 = Math.sqrt(lv2[0]*lv2[0] + lv2[1]*lv2[1] + lv2[2]*lv2[2]);
                            dbgInfo('dbg-launch', '#ff6622', '发射点',
                                fmt3(ba[0], ba[1], ba[2]) + ' · ' + spd2.toFixed(0) + ' m/s');
                            if (spd2 > 1) {
                                const dir2 = new THREE.Vector3(lv2[0], lv2[1], lv2[2]).normalize();
                                const vg2 = new THREE.BufferGeometry().setFromPoints([
                                    lpM2.position.clone(),
                                    lpM2.position.clone().addScaledVector(dir2, Math.max(chordM * 1.3, 10)),
                                ]);
                                const vl2 = new THREE.Line(vg2, new THREE.LineDashedMaterial({
                                    color: 0x00ccff, transparent: true, opacity: 0.8,
                                    dashSize: 1.2, gapSize: 0.8, depthTest: false }));
                                vl2.computeLineDistances();
                                vl2.renderOrder = 997;
                                window.__worldAnno.add(vl2);
                            }
                            // 落点标记（黄）= method20 终点；terrain_impact 附加末段起点（弹跳点）与材质标签
                            const emk2 = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10),
                                new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.95, depthTest: false }));
                            emk2.position.set(bb[0]-mcx, bb[1]-mcy, bb[2]-mcz);
                            emk2.renderOrder = 998;
                            window.__worldAnno.add(emk2);
                            dbgInfo('dbg-end', '#ffcc00', '落点',
                                fmt3(bb[0], bb[1], bb[2]) + (s.terrain_impact ? ' · 材质' + s.terrain_impact.material : ''));
                            if (s.terrain_impact) {
                                // terminal_dir = 弹道末段速度方向向量（P1-B1 裁决：非位置点）。
                                // 从落点画一条沿出射方向的方向线（固定 8m 长，单位化后缩放）+
                                // 落点标记；与"发射点→落点"弦的偏角即弹跳/减速诊断。
                                const td = s.terrain_impact.terminal_dir;
                                const tdn = Math.sqrt(td[0]*td[0] + td[1]*td[1] + td[2]*td[2]) || 1;
                                const dirEnd = [
                                    bb[0] + td[0]/tdn*8, bb[1] + td[1]/tdn*8, bb[2] + td[2]/tdn*8];
                                const segGeo = new THREE.BufferGeometry().setFromPoints([
                                    new THREE.Vector3(bb[0]-mcx, bb[1]-mcy, bb[2]-mcz),
                                    new THREE.Vector3(dirEnd[0]-mcx, dirEnd[1]-mcy, dirEnd[2]-mcz),
                                ]);
                                const segLn = new THREE.Line(segGeo, new THREE.LineBasicMaterial({
                                    color: 0xffaa00, transparent: true, opacity: 0.9, depthTest: false }));
                                segLn.renderOrder = 997;
                                window.__worldAnno.add(segLn);   // 随调试开关收纳(原 scene 直挂漏显)
                                dbgInfo('dbg-ricochet', '#ffaa00', '落点出射方向',
                                    fmt3(td[0], td[1], td[2]));
                            }
                            scene.add(window.__worldAnno);
                            // 相机 = 射手侧弹道 3/4 视角（与命中分支同构：侧偏 + 上抬）
                            const dirT2 = new THREE.Vector3(bb[0]-ba[0], 0, bb[2]-ba[2]);
                            const lenH2 = dirT2.length();
                            if (lenH2 > 1) {
                                dirT2.divideScalar(lenH2);
                                const perp2 = new THREE.Vector3(-dirT2.z, 0, dirT2.x);
                                camera.position.set(ba[0]-mcx, ba[1]-mcy, ba[2]-mcz)
                                    .addScaledVector(perp2, Math.max(lenH2 * 0.3, 6))
                                    .add(new THREE.Vector3(0, Math.max(lenH2 * 0.22, 4), 0));
                            } else {
                                camera.position.set(ba[0]-mcx, ba[1]-mcy, ba[2]-mcz).add(new THREE.Vector3(0, 6, 8));
                            }
                            controls.target.set((ba[0]+bb[0])/2 - mcx, (ba[1]+bb[1])/2 - mcy, (ba[2]+bb[2])/2 - mcz);
                            controls.update();
                            // 信息面板：落点/材质 + 弹种
                            const st2 = document.getElementById('turret-controls');
                            const flgM = s.hit_flags || 0;
                            if (st2) { st2.innerHTML = '<div class="ctrl-row"><b>World View — Shot #' + s.index + ' (脱靶)</b></div>' +
                                (function() {
                                    const t4 = s.is_author ? '作者' : (s.shooter_team === 'enemy' ? '敌方' : (s.shooter_team === 'ally' ? '我方' : ''));
                                    return '<div class="ctrl-row">Shooter: <b style="color:var(--yellow);">' + (s.shooter_name || '—') + '</b>' + (t4 ? ' · ' + t4 : '') + '</div>' +
                                    '<div class="ctrl-row" style="font-size:10px;">搭载: 射手 ' + eqBadge(s.shooter_equipment) +
                                    (s.target_equipment || s.game_hit_result !== undefined ? ' · 目标 ' + eqBadge(s.target_equipment) : '') + '</div>';
                                })() +
                                '<div class="ctrl-row">DMG 0 · MISS · 弦长 ' + chordM.toFixed(0) + 'm</div>' +
                                (s.terrain_impact ? '<div class="ctrl-row" style="font-size:10px;color:var(--blue);">落点材质类: ' +
                                    s.terrain_impact.material + (function() {
                                        // 出射方向 vs（发射点→落点）弦的偏角：>2° 提示弹跳/末段减速
                                        const td = s.terrain_impact.terminal_dir;
                                        const ch = [bb[0]-ba[0], bb[1]-ba[1], bb[2]-ba[2]];
                                        const dn = Math.sqrt(td[0]*td[0]+td[1]*td[1]+td[2]*td[2]) || 1;
                                        const cn = Math.sqrt(ch[0]*ch[0]+ch[1]*ch[1]+ch[2]*ch[2]) || 1;
                                        const ang = Math.acos(Math.max(-1, Math.min(1,
                                            (td[0]*ch[0]+td[1]*ch[1]+td[2]*ch[2])/(dn*cn)))) * 180/Math.PI;
                                        return ' · 出射偏角 <b>' + ang.toFixed(1) + '°</b>' + (ang > 2 ? '（弹跳/减速）' : '');
                                    })() + '</div>' : '') +
                                '<div class="ctrl-row" style="font-size:10px;color:var(--muted);">' +
                                '<span style="color:#ff6622;">●</span> LaunchPoint <span style="color:#00ccff;">┄</span> 速度向量 ' +
                                '<span style="color:#00ff00;">—</span> 弹道弦 <span style="color:#ffcc00;">●</span> 落点 ' +
                                '<span style="color:#ffaa00;">●</span> 弹跳点 ' +
                                '<span style="color:#cc66ff;">●</span> 炮闩(发射起点) ' +
                                '<span style="color:#00aaff;">●</span> 基准点·射手(type10锚)</div>' +
                                '<div class="ctrl-row" style="font-size:10px;color:var(--muted);">flags=' + flgM.toString(16) +
                                ' · shell_id=' + (s.shell_id || '—') +
                                (s.shell_kind ? ' (' + s.shell_kind + ')' : '') +
                                (s.quality && s.quality.shell_from_terrain ? ' · <span style="color:var(--blue);">弹种来自 0x1b 地形广播</span>' : '') +
                                '</div>'; }
                            // 脱靶弹分支同样受调试开关收纳:默认隐藏面板与标注
                            const dbgBtnM = makeDebugToggle(null);
                            // URL debug=1 自动开启（与命中分支同语义）
                            window.__debugSetVisible(QP.get('debug') === '1');
                            dbgBtnM.textContent = window.__debugOn ? '隐藏调试标注' : '调试标注';
                            return;
                        }
                        if (s.target_name) {
                        dbgReset('调试信息 — Shot #' + s.index);
                        const tPos = s.target_pos;           // 目标命中时刻位置（世界系绝对坐标）
                        const sTS = s.shooter_tick_samples || [];
                        // 射手开火时刻采样：优先 |dt| 最小者（首条 |dt|<0.1 可能是更早样本，
                        // terrain 俯仰/侧倾与开火时刻差数度）；无窗内样本才回退首条
                        const sHit = sTS.reduce((a, b) =>
                            (Math.abs(b.dt) < Math.abs(a.dt)) ? b : a, sTS[0]);
                        const shooterWorld = s.shooter_render ? s.shooter_render.pos
                            : (sHit ? sHit.pos : s.shooter_pos);   // 射手开火时刻位置（渲染锚点优先）

                        // 场景中心 = 两车中点（相机取景方便）
                        const cx = (tPos[0] + shooterWorld[0]) / 2;
                        const cy = (tPos[1] + shooterWorld[1]) / 2;
                        const cz = (tPos[2] + shooterWorld[2]) / 2;

                        // 目标模型：**渲染锚点**直通（客户端显示位姿 = 滤波器输出，滞后
                        // 0.1~0.2s——游戏画面里模型的实际呈现；弹着点/弹孔 = 玩家所见）。
                        // 无渲染锚点回退判定层（taF）。与滑块 dt=0（滤波时间线起点）同源，
                        // 初始视图与滑块零点严格一致。行进/倒车目标两层相差 latency×速度
                        // （1436 shot#4：倒车 1.5m/s × 0.17s = 0.31m 沿车体前向——判定层
                        // 摆放会显得"偏后"，即弹着点视觉错位的来源）。
                        const useRT = !!s.target_render;
                        const baseT = useRT ? s.target_render.pos : tPos;
                        const angT = useRT ? s.target_render.ang : taF;
                        tankModel.position.set(baseT[0] - cx, baseT[1] - cy, baseT[2] - cz);
                        const qT = poseFromYPR(angT[0], angT[1], angT[2]);
                        tankModel.quaternion.copy(qT);
                        // 热力图/碰撞模型必须与视觉模型同位同姿——position 只在
                        // 首帧缺失会导致装甲模型留在原点
                        armorModel.position.copy(tankModel.position);
                        armorModel.quaternion.copy(qT);
                        tankModel.updateMatrixWorld(true);
                        armorModel.updateMatrixWorld(true);

                        // 目标炮塔/炮管：炮塔相对角 = prop2 粗值 − 判定层 hull yaw（两侧同层
                        // 相消还原纯 rel；不能用渲染层 angT[0]——移动转向时 (判定−渲染) yaw
                        // 差 = 转向率×滤波延迟会混入炮塔角，静止无感、移动偏移的来源）；
                        // 炮管俯仰 = prop2 低 6 位 frac 比例解码（弧度，正=仰角）→ 度，
                        // 回退（无采样/无锚定）时保持 0（车体 pitch 已随节点链呈现）
                        let turretDegT = ((s.target_turret_yaw || 0) - ta[0]) * 180 / Math.PI;
                        turretDegT = ((turretDegT + 180) % 360 + 360) % 360 - 180;
                        window.__fireGunDegT = (s.target_gun_pitch || 0) * 180 / Math.PI;
                        updateTurretGun(turretDegT, window.__fireGunDegT);

                        // 射手模型：加载并放置（loadShooterModel 工厂，并行取 /api/tank 供炮塔/炮管枢轴）
                        const shooterTid = parseInt(QP.get('shooter'), 10);
                        if (shooterTid > 0) {
                            loadShooterModel(shooterTid, {
                                castShadow: true,
                                logTag: '[world]',
                                applyPose: function(sModel) {
                                    // 射手渲染锚点优先（与受击方同一渲染层语义）；无则 type10 直通
                                    const sR = s.shooter_render;
                                    const sYaw = sR ? sR.ang[0] : (sHit ? sHit.yaw : 0);
                                    sModel.quaternion.copy(poseFromYPR(sYaw,
                                        sR ? sR.ang[1] : (sHit ? sHit.pitch : 0),
                                        sR ? sR.ang[2] : (sHit ? sHit.roll : 0)));
                                    sModel.position.set(shooterWorld[0] - cx, shooterWorld[1] - cy, shooterWorld[2] - cz);
                                    // 锚点 = type10 记录位置（与目标方同一原则，不做发射点对齐平移）。
                                    // 实测（T110E5 逐发）：ball_a 是服务器炮膛生成点（静止时在锚点上方
                                    // ~2.0m/沿炮管 0.1~1.3m，与 models.pb 炮管枢轴垂直差 ~0.6m），而 type10
                                    // 位置是客户端平滑值（行进时与服务器真值偏差 ~2m）。拖模型向 ball_a 会让
                                    // 车体错位（炮口对上、履带全偏）——残余偏差如实呈现：静止 <0.5m，行进 ~1-2m。
                                    window.__shooterFix = new THREE.Vector3(0, 0, 0);
                                },
                            }).then(function(res) {
                                if (!res) return;
                                const sd = res.sd, sModel = res.sModel, breechGunLocal = res.breechGunLocal;
                                // 姿态源 = 渲染锚点（与车体摆放同一渲染层）；炮塔相对角 = 显式
                                // rel（镜像系：shooter_turret_yaw 与 shooter_ang 均已被 mirror
                                // 取反，相减还原 −rel，与滑块路径同约定）；炮管俯仰 prop2 frac
                                // 解码直用（炮塔系，正=仰角）；回退（degraded）传 null → 弹速反解
                                const sR2 = s.shooter_render;
                                const sYaw = sR2 ? sR2.ang[0] : (sHit ? sHit.yaw : 0);
                                const sgp = (s.quality && s.quality.gun_pitch_degraded &&
                                    s.quality.gun_pitch_degraded.indexOf('shooter') >= 0)
                                    ? null : (s.shooter_gun_pitch != null ? s.shooter_gun_pitch : null);
                                const sRel = (s.shooter_turret_yaw || 0) - (s.shooter_ang ? s.shooter_ang[0] : 0);
                                poseShooterTurretGun(sModel, sd, s.shooter_turret_yaw, s.launch_velocity, sYaw,
                                    sR2 ? sR2.ang[1] : (sHit ? sHit.pitch : 0),
                                    sR2 ? sR2.ang[2] : (sHit ? sHit.roll : 0), sgp, sRel, s.shooter_config_idx);
                                // 炮闩标注：bake 前捕获的 gun 局部坐标 × bake 后 gun.matrixWorld——
                                // 精确跟随炮塔偏航/炮管俯仰（来源 = 炮管枢轴 gP，不做后伸量修正）。
                                try {
                                    if (breechGunLocal) {
                                        let gunNode = null;
                                        sModel.traverse(function(n) {
                                            if (!gunNode && /^gun_\d+$/.test(n.name || '')) gunNode = n;
                                        });
                                        if (gunNode) {
                                            window.__shooterGunNode = gunNode;
                                            window.__updateMuzzleMarker = function() {
                                                const g = window.__shooterGunNode, mk = window.__shooterMuzzleMk;
                                                if (!g || !mk) return;
                                                g.updateMatrixWorld(true);
                                                mk.position.copy(breechGunLocal.clone().applyMatrix4(g.matrixWorld));
                                                // 可见性跟随调试模式(位置始终重算,切换时无需重放)
                                                const on = !!window.__debugOn;
                                                mk.visible = on;
                                                if (window.__shooterMuzzleLine && window.__launchPointMk) {
                                                    const lgeo = window.__shooterMuzzleLine.geometry;
                                                    lgeo.setFromPoints([mk.position, window.__launchPointMk.position]);
                                                    window.__shooterMuzzleLine.computeLineDistances();
                                                    window.__shooterMuzzleLine.visible = on;
                                                }
                                                // 炮闩坐标（回放世界系 = 场景坐标 + 中心偏移）写入调试信息窗口
                                                dbgInfo('dbg-breech', '#cc66ff', '炮闩',
                                                    fmt3(mk.position.x + cx, mk.position.y + cy, mk.position.z + cz));
                                            };
                                            const mk = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10),
                                                new THREE.MeshBasicMaterial({ color: 0xcc66ff, transparent: true, opacity: 0.95, depthTest: false }));
                                            mk.renderOrder = 998;
                                            scene.add(mk);
                                            window.__shooterMuzzleMk = mk;
                                            // 对照线:炮闩(文件标定) ⇄ 服务器发射点(橙色 LaunchPoint),
                                            // 白色虚线,长度即两套数据的偏差——随 tick 重算一起更新
                                            const dline = new THREE.Line(
                                                new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
                                                new THREE.LineDashedMaterial({
                                                    color: 0xffffff, transparent: true, opacity: 0.8,
                                                    dashSize: 0.35, gapSize: 0.25, depthTest: false }));
                                            dline.renderOrder = 996;
                                            scene.add(dline);
                                            window.__shooterMuzzleLine = dline;
                                            window.__updateMuzzleMarker();
                                            console.log('[world] shooter breech(gun-local) @', breechGunLocal.toArray().map(v => +v.toFixed(2)).join(','));
                                        }
                                    }
                                } catch (e) { console.warn('[world] muzzle marker failed:', e); }
                                // 注册全局引用（滑块/炮口标记/基准点标注消费）
                                window.__shooterModel = sModel;
                                window.__shooterData = sd;
                                // 射手模型就位后刷新基准点标注（创建时模型可能尚未加载）
                                if (window.__updateAnchorMarkers) window.__updateAnchorMarkers();
                            });
                        }

                        // 弹道原始数据（method29 launchPoint + method20 终点，世界系绝对坐标）
                        const ba = s.ball_a, bb = s.ball_b;
                        // ===== 基准点标记（调试模式）：模型根节点 = type10 记录位置锚点 =====
                        // 随各自 tick 跟随移动；坐标写入调试信息窗口（原场景内 sprite 标签已移除）。
                        function makeAnchorMarker(colorCss) {
                            const mk = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10),
                                new THREE.MeshBasicMaterial({ color: new THREE.Color(colorCss), transparent: true, opacity: 0.95, depthTest: false }));
                            mk.renderOrder = 998;
                            mk.visible = false;
                            scene.add(mk);
                            return { mk: mk, color: colorCss };
                        }
                        window.__victimAnchor = makeAnchorMarker('#00ffcc');
                        window.__shooterAnchor = makeAnchorMarker('#00aaff');
                        window.__updateAnchorMarkers = function() {
                            const on = !!window.__debugOn;
                            const upd = function(a, model, rowId, name) {
                                if (!a) return;
                                if (!model) { a.mk.visible = false; return; }
                                a.mk.position.copy(model.position);
                                a.mk.visible = on;
                                // 坐标 = 回放世界系（场景坐标 + 中心偏移）
                                dbgInfo(rowId, a.color, name,
                                    fmt3(model.position.x + cx, model.position.y + cy, model.position.z + cz));
                            };
                            upd(window.__victimAnchor, tankModel, 'dbg-anchor-victim', '基准点·受击');
                            upd(window.__shooterAnchor, window.__shooterModel, 'dbg-anchor-shooter', '基准点·射手');
                        };
                        window.__updateAnchorMarkers();
                        if (window.__worldAnno) { scene.remove(window.__worldAnno); }
                        window.__worldAnno = new THREE.Group();
                        // tick 切换重算弹着点所需的射线上下文（在弹道块内赋值）。
                        // 击穿判定射线方向用【弹道弦向量】(ball_b − ball_a)而非初速向量——
                        // 弦已包含重力下坠，与命中终点自洽；launch_velocity 保留作初速
                        // 方向可视化(青虚线)与炮管仰角反解。
                        // 轨迹可视化开关（2026-09-24 用户指令）：命中弹判定已切换到
                        // DecodeShotSegment P1/P2 基准——弦/发射点/速度/终点/来向可视化隐藏；
                        // 脱靶弹无 P1/P2，弹道线是其核心复现内容，保持显示。
                        const SHOW_TRAJ_ANNO = (shotResultClass(s) === 'MISS');
                        let ctxLaunch = null, ctxLvDir = null, ctxLvSpd = 0, ctxRayFar = 100;
                        if (ba && bb) {
                            const chordLen = Math.sqrt(
                                (bb[0]-ba[0])**2 + (bb[1]-ba[1])**2 + (bb[2]-ba[2])**2);
                            // 击穿判定射线 = 弦向量方向(归一化),长度覆盖整条弦
                            const chordDir = new THREE.Vector3(
                                (bb[0]-ba[0])/chordLen, (bb[1]-ba[1])/chordLen, (bb[2]-ba[2])/chordLen);
                            ctxLvDir = chordDir;
                            ctxRayFar = Math.max(chordLen * 1.1, 20);
                            // depthTest=false：击穿弹的弦线穿过车体内部，保持全程可见
                            const trajMat = new THREE.LineBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.7, depthTest: false });
                            const trajGeo = new THREE.BufferGeometry().setFromPoints([
                                new THREE.Vector3(ba[0] - cx, ba[1] - cy, ba[2] - cz),
                                new THREE.Vector3(bb[0] - cx, bb[1] - cy, bb[2] - cz),
                            ]);
                            const trajLine = new THREE.Line(trajGeo, trajMat);
                            trajLine.renderOrder = 997;
                            trajLine.visible = SHOW_TRAJ_ANNO;
                            window.__worldAnno.add(trajLine);   // 随调试开关收纳(原 scene 直挂漏显)
                            // ① launchPoint 标记（method29 发射点，橙色）+ 速度标签
                            const lpM = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10),
                                new THREE.MeshBasicMaterial({ color: 0xff6622, transparent: true, opacity: 0.95, depthTest: false }));
                            lpM.position.set(ba[0] - cx, ba[1] - cy, ba[2] - cz);
                            lpM.renderOrder = 998;
                            lpM.visible = SHOW_TRAJ_ANNO;
                            window.__worldAnno.add(lpM);
                            window.__launchPointMk = lpM;   // 供模型发射点对照线引用（隐藏但保留引用）
                            const lv0 = s.launch_velocity || [0, 0, 0];
                            const lvSpd = Math.sqrt(lv0[0]*lv0[0] + lv0[1]*lv0[1] + lv0[2]*lv0[2]);
                            ctxLaunch = lpM.position.clone();
                            ctxLvSpd = lvSpd;
                            if (SHOW_TRAJ_ANNO) dbgInfo('dbg-launch', '#ff6622', '发射点',
                                fmt3(ba[0], ba[1], ba[2]) + ' · ' + lvSpd.toFixed(0) + ' m/s');
                            // ② 速度向量轨迹（青虚线，长度=弦长×1.3）——仅初速方向可视化，判定用弦向量
                            if (lvSpd > 1) {
                                const dir = new THREE.Vector3(lv0[0], lv0[1], lv0[2]).normalize();
                                const vg = new THREE.BufferGeometry().setFromPoints([
                                    lpM.position.clone(),
                                    lpM.position.clone().addScaledVector(dir, Math.max(chordLen * 1.3, 10)),
                                ]);
                                const vl = new THREE.Line(vg, new THREE.LineDashedMaterial({
                                    color: 0x00ccff, transparent: true, opacity: 0.8,
                                    dashSize: 1.2, gapSize: 0.8, depthTest: false }));
                                vl.computeLineDistances();
                                vl.renderOrder = 997;
                                vl.visible = SHOW_TRAJ_ANNO;
                                window.__worldAnno.add(vl);
                            }
                            // ③ 弹道终点标记（method20，黄色）+ 标签——击穿弹终点在车体
                            // 内部/另一侧，≠弹着点（接触点）
                            const eg = new THREE.SphereGeometry(0.15, 12, 10);
                            const em = new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.95, depthTest: false });
                            const emk = new THREE.Mesh(eg, em);
                            emk.position.set(bb[0] - cx, bb[1] - cy, bb[2] - cz);
                            emk.renderOrder = 998;
                                emk.visible = SHOW_TRAJ_ANNO;
                            window.__worldAnno.add(emk);
                                if (SHOW_TRAJ_ANNO) dbgInfo('dbg-end', '#ffcc00', '服务器终点', fmt3(bb[0], bb[1], bb[2]));
                            // ④ 服务器弹着点 = 弦向量射线(launchPoint + 弦方向) ∩ 目标装甲模型，
                            // 取沿射线首个非 deco 命中（弦含重力下坠，弦终点即 ball_b）。
                            // 若服务器下发了受击部件索引（server_part_index，报告 §4.7），射线
                            // 优先约束到该部件（与游戏 DecodeShotSegment 部件约束同构）；该部件
                            // 无交点时回退全模型（部件标注差异容错）。
                            if (armorModel) {
                                const sPart = (typeof s.server_part_index === 'number') ? s.server_part_index : null;
                                const partOf = o => { const u = o.userData || {}; const sec = u.armorSectionOrig || u.armorSection;
                                    return sec === 'chassis' ? 0 : sec === 'hull' ? 1 : (sec === 'turret' || sec === 'gun') ? 2 : sec === 'gunBarrel' ? 3 : -1; };
                                const rc2 = new THREE.Raycaster();
                                rc2.set(lpM.position.clone(), chordDir);
                                rc2.far = Math.max(chordLen * 1.1, 20);
                                const allHits = rc2.intersectObject(armorModel, true)
                                    .filter(h => h.object.userData.armorSection !== 'deco');
                                let iHits = allHits;
                                let partConstrained = false;
                                if (sPart != null) {
                                    const inPart = allHits.filter(h => partOf(h.object) === sPart);
                                    if (inPart.length) { iHits = inPart; partConstrained = true; }
                                }
                                if (iHits.length > 0) {
                                    const imk = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10),
                                        new THREE.MeshBasicMaterial({ color: 0xff2222, transparent: true, opacity: 0.95, depthTest: false }));
                                    imk.position.copy(iHits[0].point);
                                    imk.renderOrder = 998;
                                    window.__worldAnno.add(imk);
                                    window.__worldImpactMk = imk;
                                    // 弹着点坐标（回放世界系）与部件约束写入调试信息窗口
                                    dbgInfo('dbg-impact', '#ff2222', '弹着点',
                                        fmt3(iHits[0].point.x + cx, iHits[0].point.y + cy, iHits[0].point.z + cz)
                                        + (partConstrained ? ' · 部件P' + sPart : ''));
                                } else {
                                    console.warn('[world] impact raycast: 0 hits（弹道未交装甲——几何/位姿错位）');
                                }
                                // ④' DecodeShotSegment 出入点标注 + 判定射线。
                                // hash6 = 游戏客户端 DecodeShotSegment 两点编码：服务器命中判定
                                // 时刻的入点 P1/出点 P2，部件 AABB 1/255 量化，轴序 x右←b2/b5、
                                // y前←b4/b7、z高←b3/b6（b4 恒 255 = 入点钉盒前界面）。
                                // 盒源：game_data collision.*_bbox（游戏原生部件盒，x右/y前/z上）
                                // 优先，缺失回退装甲网格 rest 顶点级紧致盒；部件帧：hull/chassis=
                                // 模型原点、turret/gun=枢轴系。判定射线 __segRay = {P1−0.5·方向,
                                // P1→P2 解码弦}：raycast 与入射角同源此射线（服务器编码的位置
                                // 与弹向），世界系，随位姿联动。
                                window.__worldSegMk = null;
                                // 判定段线组：独立于调试标注层（非调试模式也常显）
                                if (window.__worldSegGroup) { scene.remove(window.__worldSegGroup); window.__worldSegGroup = null; }
                                if (s.hit_token && /^[0-9a-f]{12}$/i.test(s.hit_token)) {
                                    const hb = [];
                                    for (let hi = 0; hi < 6; hi++) hb.push(parseInt(s.hit_token.substr(hi * 2, 2), 16));
                                    const partOfS = o => { const nm = o.name || '';
                                        if (/^turret_\d+_armor_/.test(nm)) return 2;
                                        if (/^gun_\d+_armor_/.test(nm)) return 3;
                                        const u = o.userData || {};
                                        const sec = u.armorSectionOrig || u.armorSection;
                                        return sec === 'chassis' ? 0 : sec === 'hull' ? 1 : (sec === 'turret' || sec === 'gun') ? 2 : sec === 'gunBarrel' ? 3 : -1; };
                                    const sPart2 = (typeof s.server_part_index === 'number') ? s.server_part_index : null;
                                    const partNodes = [];
                                    armorModel.traverse(function(n) {
                                        if (!n.isMesh) return;
                                        const u = n.userData || {};
                                        if (u.armorSection === 'deco') return;
                                        if (sPart2 != null && partOfS(n) !== sPart2) return;
                                        partNodes.push(n);
                                    });
                                    // part 0（底盘/履带）在装甲模型无网格——回退 hull 盒近似
                                    const partFallback = partNodes.length === 0 && sPart2 === 0;
                                    if (partFallback) {
                                        armorModel.traverse(function(n) {
                                            if (!n.isMesh) return;
                                            const u = n.userData || {};
                                            if (u.armorSection === 'deco') return;
                                            if (partOfS(n) === 1) partNodes.push(n);
                                        });
                                    }
                                    if (partNodes.length) {
                                        const cdBoxes = (tankData && tankData.collision_boxes) || null;
                                        const gameBoxRaw = cdBoxes ? (sPart2 === 0 ? cdBoxes.chassis
                                            : sPart2 === 1 ? cdBoxes.hull : sPart2 === 2 ? cdBoxes.turret
                                            : sPart2 === 3 ? cdBoxes.gun : null) : null;
                                        let boxMin = null, boxMax, boxFrame = null;   // boxMax 无 null 初始化：首分支必然赋值
                                        let refNode = null, refRest = null;
                                        if (gameBoxRaw && gameBoxRaw.min && gameBoxRaw.max) {
                                            boxMin = gameBoxRaw.min; boxMax = gameBoxRaw.max;
                                            boxFrame = (sPart2 === 2) ? 'turret-pivot' : (sPart2 === 3) ? 'gun-pivot' : 'model';
                                        } else {
                                            // 回退：装甲网格 rest 顶点级紧致盒（旋转 AABB 会虚胀）
                                            const box = new THREE.Box3();
                                            const vv = new THREE.Vector3();
                                            for (const n of partNodes) {
                                                if (!n.geometry.boundingBox) n.geometry.computeBoundingBox();
                                                const rest = (armorOrigMatrices && armorOrigMatrices.get(n)) || n.matrix;
                                                const pos = n.geometry.attributes.position;
                                                for (let i = 0; i < pos.count; i++) {
                                                    vv.fromBufferAttribute(pos, i).applyMatrix4(rest);
                                                    box.expandByPoint(vv);
                                                }
                                                if (!refNode && armorOrigMatrices && armorOrigMatrices.has(n)) {
                                                    refNode = n; refRest = armorOrigMatrices.get(n);
                                                }
                                            }
                                            boxMin = box.min.toArray(); boxMax = box.max.toArray();
                                            boxFrame = 'mesh-tight';
                                        }
                                        const szv = [boxMax[0] - boxMin[0], boxMax[1] - boxMin[1], boxMax[2] - boxMin[2]];
                                        const qc = (b, ax) => boxMin[ax] + szv[ax] * (b / 255);
                                        const mkP1 = new THREE.Mesh(new THREE.OctahedronGeometry(0.12),
                                            new THREE.MeshBasicMaterial({ color: 0xffa500, transparent: true, opacity: 0.95, depthTest: false }));
                                        const mkP2 = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10),
                                            new THREE.MeshBasicMaterial({ color: 0x22ff88, wireframe: true, transparent: true, opacity: 0.95, depthTest: false }));
                                        const segLine = new THREE.Line(new THREE.BufferGeometry(),
                                            new THREE.LineDashedMaterial({ color: 0xffa500, transparent: true, opacity: 0.85, dashSize: 0.25, gapSize: 0.15, depthTest: false }));
                                        mkP1.renderOrder = 998; mkP2.renderOrder = 998; segLine.renderOrder = 997;
                                        window.__worldSegGroup = new THREE.Group();
                                        window.__worldSegGroup.add(mkP1);
                                        window.__worldSegGroup.add(mkP2);
                                        window.__worldSegGroup.add(segLine);
                                        scene.add(window.__worldSegGroup);
                                        const findPartMesh = function(re) {
                                            let found = null;
                                            armorModel.traverse(function(n) {
                                                if (!found && n.isMesh && re.test(n.name || '')) found = n;
                                            });
                                            return found;
                                        };
                                        // 量化三元组 [右,前,高] → 场景世界坐标。炮塔/炮管件经部件
                                        // 网格世界矩阵（局部系=枢轴系，矩阵由位姿链驱动 → 标记跟随
                                        // 转角；勿用 Rz(currentTurretDeg) 手动组合，初始位姿时它为 0）
                                        const placePt = function(q) {
                                            const pl = new THREE.Vector3(qc(q[0], 0), qc(q[1], 1), qc(q[2], 2));
                                            if (boxFrame === 'turret-pivot') {
                                                const tm = findPartMesh(/^turret_\d+_armor/);
                                                if (tm) { tm.updateWorldMatrix(true, false); return tm.localToWorld(pl); }
                                                const yaw = THREE.MathUtils.degToRad(currentTurretDeg);
                                                pl.applyMatrix4(new THREE.Matrix4().makeRotationZ(yaw)
                                                    .setPosition(armorPivotTurret.x, armorPivotTurret.y, armorPivotTurret.z));
                                                return armorModel.localToWorld(pl);
                                            }
                                            if (boxFrame === 'gun-pivot') {
                                                const gm = findPartMesh(/^gun_\d+_armor/);
                                                if (gm) { gm.updateWorldMatrix(true, false); return gm.localToWorld(pl); }
                                                const pitch = THREE.MathUtils.degToRad(currentGunDeg);
                                                pl.applyMatrix4(new THREE.Matrix4().makeRotationX(pitch));
                                                if (armorPivotGun && armorPivotTurret) {
                                                    pl.add(armorPivotGun.clone().sub(armorPivotTurret));
                                                    pl.applyMatrix4(new THREE.Matrix4().makeRotationZ(
                                                        THREE.MathUtils.degToRad(currentTurretDeg))
                                                        .setPosition(armorPivotTurret.x, armorPivotTurret.y, armorPivotTurret.z));
                                                }
                                                return armorModel.localToWorld(pl);
                                            }
                                            if (boxFrame === 'mesh-tight' && refNode && refRest) {
                                                return pl.applyMatrix4(refRest.clone().invert()).applyMatrix4(
                                                    refNode.matrixWorld.clone().multiply(refRest.clone().invert()));
                                            }
                                            return armorModel.localToWorld(pl);
                                        };
                                        const updSeg = function(visible) {
                                            // 出入点标记 + 段线（P1→P2 = 游戏编码命中线段）
                                            mkP1.position.copy(placePt([hb[0], hb[2], hb[1]]));
                                            mkP2.position.copy(placePt([hb[3], hb[5], hb[4]]));
                                            // 判定方向 = P1→P2 解码弦（世界系），经 placePt 同款部件矩阵
                                            const chordL = new THREE.Vector3(
                                                qc(hb[3], 0) - qc(hb[0], 0),
                                                qc(hb[5], 1) - qc(hb[2], 1),
                                                qc(hb[4], 2) - qc(hb[1], 2));
                                            let dirS = null;
                                            if (chordL.lengthSq() > 1e-9) {
                                                let m = null;
                                                if (boxFrame === 'turret-pivot') {
                                                    const tm = findPartMesh(/^turret_\d+_armor/);
                                                    if (tm) { tm.updateWorldMatrix(true, false); m = tm.matrixWorld; }
                                                } else if (boxFrame === 'gun-pivot') {
                                                    const gm = findPartMesh(/^gun_\d+_armor/);
                                                    if (gm) { gm.updateWorldMatrix(true, false); m = gm.matrixWorld; }
                                                } else if (boxFrame === 'mesh-tight' && refNode && refRest) {
                                                    m = refNode.matrixWorld.clone().multiply(refRest.clone().invert());
                                                } else {
                                                    m = armorModel.matrixWorld;
                                                }
                                                if (m) dirS = chordL.clone().transformDirection(m).normalize();
                                            }
                                            if (!dirS) {
                                                // P1==P2（点射终止，§2.1）：回退炮塔/模型反水平方向
                                                const e = (findPartMesh(/^turret_\d+_armor/) || armorModel).matrixWorld.elements;
                                                const fh = Math.hypot(e[4], e[6]) || 1;
                                                dirS = new THREE.Vector3(-e[4] / fh, 0, -e[6] / fh);
                                            }
                                            // 段线入射端"无限"延长（工程取 900m，相机远平面内）：
                                            // 沿判定弹向 dirS（世界系，与 __segRay 同源）的反向，
                                            // 入射弹向一目了然；P2（穿出端）与标记保持在解码出入点。
                                            // 勿用未变换的 chordL 方向——部件盒带姿态时外延会指向错误方向
                                            const EXT = 900;
                                            const aPt = mkP1.position.clone().addScaledVector(dirS, -EXT);
                                            const bPt = mkP2.position.clone();
                                            segLine.geometry.setFromPoints([aPt, bPt]);
                                            segLine.computeLineDistances();
                                            // 判定射线：P1 表面外 0.5m 沿弹向进入（raycast 与入射角同源）
                                            window.__segRay = {
                                                origin: mkP1.position.clone().addScaledVector(dirS, -0.5),
                                                dir: dirS, far: 26
                                            };
                                            // 弹着点红点 = P1（服务器编码真实入点）
                                            if (window.__worldImpactMk) {
                                                window.__worldImpactMk.position.copy(mkP1.position);
                                                if (visible) {
                                                    dbgInfo('dbg-impact', '#ff2222', '弹着点',
                                                        fmt3(mkP1.position.x + cx, mkP1.position.y + cy, mkP1.position.z + cz)
                                                        + ' · DecodeShotSegment P1' + (sPart2 != null ? ' · 部件P' + sPart2 : ''));
                                                }
                                            }
                                            if (visible) {
                                                dbgInfo('dbg-seg', '#ffa500', 'DecodeShotSegment',
                                                    'P1 ' + fmt3(mkP1.position.x + cx, mkP1.position.y + cy, mkP1.position.z + cz) +
                                                    ' · P2 ' + fmt3(mkP2.position.x + cx, mkP2.position.y + cy, mkP2.position.z + cz) +
                                                    ' · 俯仰' + (THREE.MathUtils.radToDeg(Math.asin(
                                                        chordL.clone().normalize().z)).toFixed(2)) + '°（炮塔系）' +
                                                    (boxFrame === 'mesh-tight' ? ' · 网格盒回退' : ' · 游戏部件盒'));
                                            }
                                        };
                                        window.__worldSegMk = { update: updSeg, p1: mkP1, p2: mkP2 };
                                        updSeg(!!window.__debugOn);
                                        // 立即以 P1→P2 射线重跑判定：armorModel 异步加载，seg 块晚于
                                        // 600ms 的弦判定计时器——以新基准覆盖其结果（penSeq 丢弃旧响应）
                                        if (window.__segRay && window.__worldPenMode) {
                                            __shotRayOrigin = ctxLaunch.clone();
                                            __shotRayTarget = ctxLaunch.clone().addScaledVector(ctxLvDir, ctxRayFar);
                                            doPenetrationCheck(0, 0);
                                            __shotRayOrigin = null; __shotRayTarget = null;
                                        }
                                        // 诊断挂钩：盒/量化字节（静止局部），供控制台校准轴序
                                        window.__segDiag = {
                                            hb: hb, sPart: sPart2, partFallback: partFallback,
                                            boxFrame: boxFrame,
                                            boxMin: boxMin.slice(0, 3), boxMax: boxMax.slice(0, 3),
                                            armorModel: armorModel
                                        };
                                        // debug=1 自动开启晚于本块——延迟补一次刷新（消除加载期位姿竞态残值）
                                        setTimeout(function() {
                                            if (!window.__worldSegMk) return;
                                            window.__worldSegMk.update(!!window.__debugOn);
                                            if (window.__worldImpactMk) {
                                                const pp = window.__worldSegMk.p1.position;
                                                window.__worldImpactMk.position.copy(pp);
                                                dbgInfo('dbg-impact', '#ff2222', '弹着点',
                                                    fmt3(pp.x + cx, pp.y + cy, pp.z + cz) + ' · DecodeShotSegment P1'
                                                    + (sPart2 != null ? ' · 部件P' + sPart2 : ''));
                                            }
                                        }, 1500);
                                    }
                                }
                            }
                            // ⑥ 游戏弹孔 = 服务器 segment（hash6）按 DecodeShotSegment 解码的
                            // 相机 = 炮口侧后上方 3/4 视角。纯第一人称与弹道共线——坦克与网格原点
                            // 重叠、tick 位移方向垂直于视线，空间关系不可判读；侧偏+上抬赋予视差。
                            const dirTraj = new THREE.Vector3(bb[0]-ba[0], 0, bb[2]-ba[2]);
                            const lenH = dirTraj.length();
                            if (lenH > 1) {
                                dirTraj.divideScalar(lenH);
                                const perp = new THREE.Vector3(-dirTraj.z, 0, dirTraj.x);
                                camera.position.copy(lpM.position)
                                    .addScaledVector(perp, Math.max(lenH * 0.3, 6))
                                    .add(new THREE.Vector3(0, Math.max(lenH * 0.22, 4), 0));
                            } else {
                                camera.position.copy(lpM.position).add(new THREE.Vector3(0, 6, 8));
                            }
                            controls.target.set((ba[0]+bb[0])/2 - cx, (ba[1]+bb[1])/2 - cy, (ba[2]+bb[2])/2 - cz);
                        } else {
                            // 无弹道数据回退：射手后上方看向两车中点
                            const camDist = Math.max(20, Math.sqrt(
                                (tPos[0]-shooterWorld[0])**2 + (tPos[2]-shooterWorld[2])**2) * 0.4);
                            const aimYaw = Math.atan2(tPos[0]-shooterWorld[0], tPos[2]-shooterWorld[2]);
                            camera.position.set(
                                shooterWorld[0] - cx + Math.sin(aimYaw) * camDist * 0.3,
                                shooterWorld[1] - cy + camDist * 0.3,
                                shooterWorld[2] - cz + Math.cos(aimYaw) * camDist * 0.3
                            );
                            controls.target.set(0, 1, 0);
                        }
                        controls.update();

                        scene.add(window.__worldAnno);

                        // ===== world 模式穿透判定（相对模式同源管线）=====
                        // 真实炮口射线 → doPenetrationCheck → /api/penetrate。worldPenMode 开启后
                        // check 内部把世界系交点/射线经 worldToLocal 换算成模型局部米制，结果与相对模式同源。
                        window.__worldPenMode = true;
                        window.__shotIsHit = true;   // 0 armor hits 时 doPenetrationCheck 走报错分支
                        window.__worldServerInfo = (function() {
                            return { cls: shotResultClass(s), result: s.game_hit_result };
                        })();
                        // 自动初始判定（用户要求锁定）：命中弹 = DecodeShotSegment
                        // P1→P2 射线（准确命中位置与弹向），脱靶弹 = 弹道弦；
                        // 结果锁定，点击不触发判定（onClick 拦截）。
                        if (ctxLvDir && ctxLaunch) {
                            __shotRayOrigin = ctxLaunch.clone();
                            __shotRayTarget = ctxLaunch.clone().addScaledVector(ctxLvDir, ctxRayFar);
                            setTimeout(() => {
                                doPenetrationCheck(0, 0);
                                __shotRayOrigin = null; __shotRayTarget = null;
                            }, 600);
                        } else {
                            __shotRayOrigin = null; __shotRayTarget = null;
                        }

                        // ===== tick 位移方向标注（默认开启，"移动方向"复选框可关）=====
                        // 车体底部平面（type10 高度 +0.1m）：青线 = 相邻 tick 位移路径；同一基点并排
                        // 两支箭头（消除透视视差）：青 = 位移方向，绿/橙/黄 = 履带朝向（按位移方向着色）。
                        // 三者均取真实 3D 方向（含俯仰）——只做水平投影会与倾斜模型出现视角差；
                        // 前进/倒车/转向分类仍用水平方位角（atan2(dx,dz) vs yaw）。
                        if (window.__moveAnno) { scene.remove(window.__moveAnno); }
                        window.__moveAnno = new THREE.Group();
                        const tksD = s.tick_samples || [];
                        const moveDirColor = (i) => {
                            if (i <= 0) return 0xffdd33;
                            const dx = tksD[i].pos[0]-tksD[i-1].pos[0], dz = tksD[i].pos[2]-tksD[i-1].pos[2];
                            if (Math.sqrt(dx*dx + dz*dz) < 0.05) return 0xffdd33;
                            let e = Math.abs(Math.atan2(dx, dz) - tksD[i].yaw) % (2*Math.PI);
                            if (e > Math.PI) e = 2*Math.PI - e;
                            const deg = e*180/Math.PI;
                            return deg < 60 ? 0x33ff66 : (deg > 120 ? 0xff6622 : 0xffdd33);
                        };
                        const mkMoveArrow = (len, color) => {
                            const arr = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1),
                                new THREE.Vector3(), len, color, 0.55, 0.3);
                            arr.line.material.depthTest = false;
                            arr.cone.material.depthTest = false;
                            arr.renderOrder = 996;
                            return arr;
                        };
                        window.__moveArrow = mkMoveArrow(3.0, 0xffdd33);        // 履带朝向
                        window.__moveVecArrow = mkMoveArrow(2.2, 0x00ccff);     // 位移方向
                        window.__moveAnno.add(window.__moveArrow);
                        window.__moveAnno.add(window.__moveVecArrow);
                        // 两支箭头跟随视觉模型：同基点（车底右侧 3m）并排、间隔 0.9m
                        window.updateMoveArrow = function(idx) {
                            if (!tksD[idx]) return;
                            const ts = tksD[idx];
                            const q = poseFromYPR(ts.yaw, ts.pitch, ts.roll);
                            const fwd = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
                            if (fwd.lengthSq() < 0.01) return;
                            fwd.normalize();   // 真实 3D 履带朝向（含俯仰），与模型姿态一致
                            // 沿车体横向右移 ~3m：箭头放在视觉模型旁边而非车体内部
                            const side = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
                            side.y = 0;
                            if (side.lengthSq() > 0.01) side.normalize();
                            // 场景为中心化坐标系（原点 = 双车中点）——位置必须减 cx/cy/cz
                            const base = new THREE.Vector3(
                                ts.pos[0]+tPos[0]-cx, ts.pos[1]+tPos[1]-cy+0.10, ts.pos[2]+tPos[2]-cz);
                            window.__moveArrow.position.copy(base).addScaledVector(side, 0.9);
                            window.__moveVecArrow.position.copy(base).addScaledVector(side, -0.9);
                            window.__moveArrow.setDirection(fwd);
                            window.__moveArrow.setColor(moveDirColor(idx));
                            // 位移方向箭头 = 进入当前 tick 的线段方向（真实 3D，含爬坡升降）
                            if (idx > 0) {
                                const p0 = tksD[idx-1];
                                const mv = new THREE.Vector3(
                                    ts.pos[0]-p0.pos[0], ts.pos[1]-p0.pos[1], ts.pos[2]-p0.pos[2]);
                                if (mv.lengthSq() > 0.0025) {
                                    window.__moveVecArrow.visible = true;
                                    window.__moveVecArrow.setDirection(mv.normalize());
                                } else {
                                    window.__moveVecArrow.visible = false;
                                }
                            } else {
                                window.__moveVecArrow.visible = false;
                            }
                        };
                        tksD.forEach((ts, i) => {
                            if (i === 0) return;
                            const p0 = tksD[i-1];
                            // 中心化坐标系（原点=双车中点）+ 真实 3D 路径（各点取自身 type10 高度）——坡地不失真
                            const geo = new THREE.BufferGeometry().setFromPoints([
                                new THREE.Vector3(p0.pos[0]+tPos[0]-cx, p0.pos[1]+tPos[1]-cy+0.10, p0.pos[2]+tPos[2]-cz),
                                new THREE.Vector3(ts.pos[0]+tPos[0]-cx, ts.pos[1]+tPos[1]-cy+0.10, ts.pos[2]+tPos[2]-cz),
                            ]);
                            const ln = new THREE.Line(geo, new THREE.LineBasicMaterial({
                                color: 0x00ccff, depthTest: false, transparent: true, opacity: 0.9 }));
                            ln.renderOrder = 995;
                            window.__moveAnno.add(ln);
                            const dx = ts.pos[0]-p0.pos[0], dz = ts.pos[2]-p0.pos[2];
                            if (Math.sqrt(dx*dx + dz*dz) >= 0.05) {
                                const dd = Math.sqrt(dx*dx + dz*dz);
                                const v = dd/Math.max(1e-3, ts.dt - p0.dt);
                                const mvAz = Math.atan2(dx, dz);
                                let e = Math.abs(mvAz - ts.yaw) % (2*Math.PI);
                                if (e > Math.PI) e = 2*Math.PI - e;
                                e = e*180/Math.PI;
                                console.log('[move] dt=%+f yaw=%s° move=%s° err=%s° v=%sm/s %s',
                                    ts.dt.toFixed(3), (ts.yaw*180/Math.PI).toFixed(1),
                                    (mvAz*180/Math.PI).toFixed(1), e.toFixed(1), v.toFixed(1),
                                    e < 60 ? '前进' : (e > 120 ? '倒车' : '转向'));
                            } else {
                                console.log('[move] dt=%+f yaw=%s° pivot/静止',
                                    ts.dt.toFixed(3), (ts.yaw*180/Math.PI).toFixed(1));
                            }
                        });
                        window.updateMoveArrow(tksD.length - 1);   // 初始 = 命中锚点 tick
                        scene.add(window.__moveAnno);
                        // 面板数字摘要：当前窗口内 位移vs朝向 偏差（中位/最大，排除倒车段）
                        {
                            const errs = [];
                            for (let i = 1; i < tksD.length; i++) {
                                const dx = tksD[i].pos[0]-tksD[i-1].pos[0], dz = tksD[i].pos[2]-tksD[i-1].pos[2];
                                if (Math.sqrt(dx*dx + dz*dz) < 0.05) continue;
                                let e = Math.abs(Math.atan2(dx, dz) - tksD[i].yaw) % (2*Math.PI);
                                if (e > Math.PI) e = 2*Math.PI - e;
                                errs.push(e*180/Math.PI);
                            }
                            errs.sort((a,b)=>a-b);
                            const el = document.getElementById('move-err');
                            if (el) el.textContent = errs.length
                                ? '位移vs朝向: 中位' + errs[errs.length>>1].toFixed(1) + '° 最大' + errs[errs.length-1].toFixed(1) + '° (' + errs.length + '段)'
                                : '';
                        }

                        // ===== 弹道判定上下文（精简）：弦起点/方向/长度供相对视角按钮、
                        // 滑块弹着点重算与弦判定重跑共用（原 tick 双下拉已移除，位姿调整
                        // 统一走连续时间滑块）=====
                        window.__worldTickCtx = {
                            launch: ctxLaunch, lvDir: ctxLvDir, lvSpd: ctxLvSpd, rayFar: ctxRayFar,
                        };
                        // 进入射击复现默认相对视角（相机沿入射方向回退看向命中点）；
                        // armorModel 未就绪时留待后续 tick 重试
                        if (window.__autoRelView) {
                            if (armorModel) {
                                window.__autoRelView = false;
                                const rb = document.getElementById('rel-view-toggle');
                                if (rb) rb.click();
                            }
                        }

                        const st = document.getElementById('turret-controls');
                        const cls2 = shotResultClass(s) === 'MISS' ? 'MISS'
                            : (shotResultClass(s) === 'RICOCHET') ? 'RICO'
                            : (shotResultClass(s) === 'PENETRATION') ? 'PEN'
                            : (shotResultClass(s) === 'HE BLAST') ? 'HE' : 'NOPEN';
                        const qIssues = srQualityIssues(s);
                        const tksW = s.tick_samples || [];
                        if (tksW.length > 1) {
                            // 弹种自动匹配：按回放数据推断本发实际弹种并切换选择器（修正
                            // BLOCKED vs SPLASH 类差异）。优先级：① hit_flags 0x1000(HE 爆炸)
                            // → explosion_radius>0 的弹；② shell_id ↔ 射手配置弹表
                            // shell_global_ids 精确匹配（确定性别名，FV215b shot6 竞态实测）；
                            // ③ 仅当 shell_id 未知时才槽位兜底（有 shell_id 而匹配失败 = 数据
                            // 不全，保持当前选择，不回退槽位以免盖掉正确弹种）。
                            window.__worldShellSlot = (typeof s.shell_slot === 'number') ? s.shell_slot : null;
                            window.__worldIsHE = !!(s.hit_flags & 0x1000);
                            window.__worldShellId = (typeof s.shell_id === 'number' && s.shell_id) ? s.shell_id : null;
                            setTimeout(function() {
                                const sel = document.getElementById('shell-select');
                                if (!sel) return;
                                let want = null;
                                if (window.__worldIsHE) {
                                    want = (shooterShells || []).findIndex(sh =>
                                        shellTypeOf(sh) === 'he' || (sh && sh.explosion_radius > 0));
                                }
                                if (want == null || want < 0 && window.__worldShellId) {
                                    // 射手配置弹表全局 id：configs[].shell_global_ids（与弹表
                                    // 同源同序）。优先 &scfg=（射手实际搭载配置，下拉表即其
                                    // shells，下标同域）；未命中再全配置扫（顶级偏好）
                                    const cfgArr = (shooterData && shooterData.configs) || null;
                                    const scfg = parseInt(QP.get('scfg'), 10);
                                    const tryGids = (gids) => {
                                        if (!gids || want >= 0) return;
                                        const gi = gids.indexOf(window.__worldShellId);
                                        if (gi >= 0) want = gi;
                                    };
                                    if (!isNaN(scfg) && cfgArr && cfgArr[scfg]) {
                                        tryGids(cfgArr[scfg].shell_global_ids || null);
                                    }
                                    if (cfgArr) {
                                        for (let ci = cfgArr.length - 1; ci >= 0 && !(want >= 0); ci--) {
                                            tryGids(cfgArr[ci].shell_global_ids || null);
                                        }
                                    }
                                }
                                // 槽位兜底仅在完全无 shell_id 时使用
                                if ((want == null || want < 0) && window.__worldShellId == null) {
                                    want = window.__worldShellSlot;
                                }
                                if (want != null && want >= 0 && want < sel.options.length) {
                                    if (sel.value !== String(want)) {
                                        sel.value = String(want);
                                        sel.dispatchEvent(new Event('change'));
                                    }
                                }
                            }, 800);
                        }
                        if (st) { st.innerHTML = '<div class="ctrl-row"><b>World View — Shot #' + s.index + '</b></div>' +
                            (function() {
                                const t4 = s.is_author ? '作者' : (s.shooter_team === 'enemy' ? '敌方' : (s.shooter_team === 'ally' ? '我方' : ''));
                                return '<div class="ctrl-row">Shooter: <b style="color:var(--yellow);">' + (s.shooter_name || '—') + '</b>' + (t4 ? ' · ' + t4 : '') + '</div>' +
                                    '<div class="ctrl-row" style="font-size:10px;">搭载: 射手 ' + eqBadge(s.shooter_equipment) +
                                    (s.target_equipment || s.game_hit_result !== undefined ? ' · 目标 ' + eqBadge(s.target_equipment) : '') + '</div>';
                            })() +
                            '<div class="ctrl-row">DMG ' + s.damage + ' · ' + cls2 + ' · ' + (s.target_name || '—') + '</div>' +
                            '<div class="ctrl-row" id="world-pen-cmp" style="font-size:10px;"></div>' +
                            (function() {
                                const sp3 = shellIdParts(s.shell_id);
                                if (!sp3) return '';
                                return '<div class="ctrl-row" style="font-size:10px;color:var(--blue);">弹种: shell_id=' + s.shell_id +
                                    ' (局部' + sp3.local + ' · 国家0x' + sp3.nation.toString(16) + ')' +
                                    (s.shell_kind ? ' · <b>' + s.shell_kind + '</b>' : '') +
                                    (s.shell && s.shell.penetration ? ' · ' + Math.round(s.shell.penetration) + 'mm/' + Math.round(s.shell.damage || 0) + 'dmg（弹种反解表）' : '') +
                                    ((s.quality && s.quality.shell_from_broadcast) ? ' · 来源0x07广播' : '') +
                                    ((s.quality && s.quality.shell_from_terrain) ? ' · 来源0x1b广播' : '') +
                                    (s.segment ? ' · 装甲组=' + (s.armor_group || '—') : '') + '</div>';
                            })() +
                            (function() {
                                const cr3 = decodeModules(s.crit_modules || 0);
                                const ds3 = decodeModules(s.destroyed_modules || 0);
                                if (!cr3.length && !ds3.length) return '';
                                return '<div class="ctrl-row" style="font-size:10px;color:var(--yellow);">模块: ' +
                                    cr3.concat(ds3.map(n3 => n3 + '(摧毁)')).join(' · ') + '</div>';
                            })() +
                            (s.shooter_aim ? '<div class="ctrl-row" style="font-size:10px;color:var(--muted);">瞄准: 炮塔偏航 ' +
                                s.shooter_aim.turret_rel_yaw.toFixed(4) + ' rad' +
                                (typeof s.shooter_aim.state_before === 'number'
                                    ? ' · 状态 ' + s.shooter_aim.state_before.toFixed(3) + '→' +
                                      (s.shooter_aim.state_after != null ? s.shooter_aim.state_after.toFixed(3) : '—')
                                    : '') + '</div>' : '') +
                            (s.server_part_index != null ? '<div class="ctrl-row" style="font-size:10px;color:var(--orange);">服务器部件: ' +
                                s.server_part_index + '（0=底盘/履带 1=车体 2=炮塔 3=炮管）· 弹着点已按部件约束</div>' : '') +
                            (s.target_render ? '<div class="ctrl-row" style="font-size:10px;color:var(--blue);">渲染锚点(游戏画面): 滞后 ' +
                                s.target_render.latency.toFixed(3) + 's · 渲染-判定偏差 ' +
                                s.target_render.dist_to_judgment.toFixed(2) + 'm</div>' : '') +
                            // ===== 连续时间滑块（拖动平滑控制双模型位置/姿态） =====
                            (function() {
                                // 滑块范围纳入滤波时间线（−3~+2s 扩展窗口，含命中后）
                                const tlDt = (s.target_render_timeline || []).map(t => t.dt);
                                const sTlDt = (s.shooter_render_timeline || []).map(t => t.dt);
                                const allDt = [].concat(
                                    tksW.filter(t => !t.render).map(t => t.dt),
                                    sTS.filter(t => !t.render).map(t => t.dt),
                                    tlDt, sTlDt
                                ).filter(d => !isNaN(d));
                                if (allDt.length < 2) return '';
                                const tMin = Math.min.apply(null, allDt);
                                const tMax = Math.max.apply(null, allDt);
                                if (tMax - tMin < 0.1) return '';
                                return '<div class="ctrl-row" style="margin-top:6px;gap:6px;">'
                                    + '<span style="font-size:10px;color:var(--scrub);flex:none;">⏱</span>'
                                    + '<input type="range" id="time-scrub" min="' + (tMin*1000).toFixed(0) + '" max="' + (tMax*1000).toFixed(0) + '" value="0" step="10"'
                                    + ' style="flex:1;min-width:0;accent-color:var(--scrub);">'
                                    + '<span id="time-scrub-label" style="font-size:10px;color:var(--scrub);flex:none;min-width:50px;text-align:right;"></span>'
                                    + '</div>';
                            })() +
                            (qIssues.length ? '<div class="ctrl-row" style="font-size:10px;color:var(--yellow);">⚠ '
                                + qIssues.join(' · ') + '</div>' : '') +
                            '<div class="ctrl-row" style="font-size:10px;color:var(--muted);">' +
                            '<span style="color:#ff6622;">●</span> LaunchPoint <span style="color:#00ccff;">┄</span> 速度向量 ' +
                            '<span style="color:#00ff00;">—</span> 弹道弦 <span style="color:#ff2222;">●</span> 弹着点 ' +
                            '<span style="color:#ffcc00;">●</span> 服务器终点 ' +
                            '<span style="color:#cc66ff;">●</span> 炮闩(发射起点) <span style="color:#fff;">┄</span> 偏差线</div>' +
                            '<div class="ctrl-row" style="font-size:10px;color:var(--muted);">' +
                            '<span style="color:#33ff66;">↑</span>履带朝向 <span style="color:#00ccff;">↑</span>位移方向 ' +
                            '<span style="color:#ff6622;">↑</span>倒车(橙) <span style="color:#ffdd33;">↑</span>转向(黄) ' +
                            '<span style="color:#00ccff;">—</span>tick路径(3D)</div>' +
                            '<div class="ctrl-row" style="font-size:10px;color:var(--muted);">' +
                            '<span style="color:#00ffcc;">●</span>基准点·受击(type10锚) ' +
                            '<span style="color:#00aaff;">●</span>基准点·射手(type10锚)</div>' +
                            '<div class="ctrl-row"><label style="font-size:11px;cursor:pointer;">' +
                            '<input type="checkbox" id="move-toggle" checked> 移动方向标注</label>' +
                            '<span id="move-err" style="font-size:10px;color:var(--blue);margin-left:8px;"></span></div>'; }
                        const mt2 = document.getElementById('move-toggle');
                        if (mt2) mt2.onchange = function() {
                            if (window.__moveAnno) window.__moveAnno.visible = this.checked;
                        };
                        // ===== 调试模式开关（默认关闭）：收纳 World View 面板 + 全部调试标注 =====
                        // 可见性集中挂 window.__debugSetVisible。
                        const stEl = document.getElementById('turret-controls');
                        if (stEl) stEl.style.display = 'none';
                        const dbgBtn = makeDebugToggle(function() {
                            // 基准点标注可见性（位置由 __updateAnchorMarkers 维护）
                            if (window.__updateAnchorMarkers) window.__updateAnchorMarkers();
                        });
                        // 相对视角按钮：相机 = 当前位姿的弦命中点沿入射反方向回退 15m（与
                        // showTrajectory 轨迹原点回退距离同语义），看向命中点；弦未命中当前位姿
                        // 时看向车体中心。再点一次恢复世界全景。判定/标注不受影响（弦判定与相机无关）。
                        let __relViewOn = false, __savedCam = null;
                        const relBtn = document.createElement('button');
                        relBtn.id = 'rel-view-toggle';
                        relBtn.textContent = '相对视角';
                        relBtn.style.cssText = 'padding:6px 14px;background:var(--panel);color:var(--accent);' +
                            'border:1px solid var(--border);border-radius:var(--radius-sm);' +
                            'font-size:0.85em;cursor:pointer;backdrop-filter:blur(12px);';
                        relBtn.onclick = function() {
                            if (!__relViewOn) {
                                __savedCam = { pos: camera.position.clone(), target: controls.target.clone() };
                                const ctx = window.__worldTickCtx;
                                if (ctx && ctx.launch && ctx.lvDir) {
                                    const dir = ctx.lvDir.clone().normalize();
                                    let aim = tankModel.position.clone();
                                    const rc = new THREE.Raycaster(ctx.launch.clone(), dir);
                                    rc.far = ctx.rayFar;
                                    const hits = rc.intersectObject(armorModel, true)
                                        .filter(h => h.object.userData.armorSection !== 'deco');
                                    if (hits.length) aim = hits[0].point.clone();
                                    camera.position.copy(aim.clone().addScaledVector(dir, -15));
                                    controls.target.copy(aim);
                                    controls.update();
                                }
                                __relViewOn = true;
                                this.textContent = '世界视角';
                            } else {
                                if (__savedCam) {
                                    camera.position.copy(__savedCam.pos);
                                    controls.target.copy(__savedCam.target);
                                    controls.update();
                                }
                                __relViewOn = false;
                                this.textContent = '相对视角';
                            }
                        };
                        (document.getElementById('corner-br') || document.body).appendChild(relBtn);
                        // 初始即按撤回状态隐藏全部标注（须在 debug=1 自动开启之前，否则被覆盖）
                        window.__debugSetVisible(false);
                        // URL debug=1 自动开启调试标注（与开关按钮同一状态,可再手动关闭）
                        if (QP.get('debug') === '1') {
                            window.__debugSetVisible(true);
                            dbgBtn.textContent = '隐藏调试标注';
                        }
                        // ===== 时间滑块：连续插值双模型位置/姿态（报告 §4.7 渲染层锚点可视化） =====
                        const timeSlider = document.getElementById('time-scrub');
                        if (timeSlider) {
                            // 滑块 0 点 = 渲染位（玩家所见）：存在渲染位采样时，用它替换
                            // dt≈0 的原始锚点采样作为插值关键帧——否则拖动滑块回 0 会回到
                            // 判定层锚点位姿，与初始的渲染位姿相差一个滤波滞后位移。
                            const rSample = (s.tick_samples || []).find(function(t) { return t.render; });
                            // 剔除命中后（dt>0）的兜底采样：数据包源切换致瞬移/朝向跳变
                            //（96 段实测 40 段反转），混入滑块末端 keyframe 会产生翻转行为
                            let vRaw = (s.tick_samples || []).filter(function(t) {
                                return !t.render && t.dt <= 0.001 && Math.abs(t.dt) > 0.025; });
                            if (rSample) {
                                vRaw.push({ dt: rSample.dt, pos: rSample.pos, yaw: rSample.yaw,
                                    pitch: rSample.pitch, roll: rSample.roll, render: true });
                                vRaw.sort(function(a, b) { return a.dt - b.dt; });
                            }
                            const sRaw = (s.shooter_tick_samples || []).filter(function(t) { return !t.render; });
                            const interpTick = function(samples, dt) {
                                if (!samples || !samples.length) return null;
                                for (let i = 0; i < samples.length - 1; i++) {
                                    const a = samples[i], b = samples[i + 1];
                                    if (a.dt <= dt && b.dt >= dt) {
                                        const span = b.dt - a.dt;
                                        const f = span > 1e-6 ? (dt - a.dt) / span : 0;
                                        let dy = b.yaw - a.yaw;
                                        while (dy > Math.PI) dy -= 2 * Math.PI;
                                        while (dy < -Math.PI) dy += 2 * Math.PI;
                                        return {
                                            pos: [0, 1, 2].map(function(k) { return a.pos[k] + (b.pos[k] - a.pos[k]) * f; }),
                                            yaw: a.yaw + dy * f,
                                            pitch: a.pitch + (b.pitch - a.pitch) * f,
                                            roll: a.roll + (b.roll - a.roll) * f
                                        };
                                    }
                                }
                                return dt <= samples[0].dt ? samples[0] : samples[samples.length - 1];
                            };
                            // 滤波时间线（渲染层严格对齐数据源）；null = 无时间线（回退原始采样）
                            const tlT = (s.target_render_timeline && s.target_render_timeline.length > 1) ? s.target_render_timeline : null;
                            const tlS = (s.shooter_render_timeline && s.shooter_render_timeline.length > 1) ? s.shooter_render_timeline : null;
                            // 炮塔相对角：镜像系下取反（相对角 = 炮塔世界角 − 车体角，镜像时两者同时
                            // 取反 → 相对角取反；直接透传会导致炮管指向镜像侧 = 方向反转 180°）
                            if (tlT) for (const t of tlT) t[1] = -t[1];
                            if (tlS) for (const t of tlS) t[1] = -t[1];
                            // 炮塔相对角时间线：镜像系下需取反（车体/炮塔世界 yaw 在镜像系同时翻转，
                            // 相对角 = −原始值；直接透传会导致炮管指向镜像侧 = 方向反转）
                            timeSlider.oninput = function() {
                                const dt = parseInt(this.value, 10) / 1000;
                                const lbl = document.getElementById('time-scrub-label');
                                if (lbl) lbl.textContent = (dt >= 0 ? '+' : '') + dt.toFixed(2) + 's';
                                // 覆盖检查：滤波时间线未覆盖的时段 = 该实体在录像客户端无 volatile
                                // 数据（AoI 外不渲染）——滑块拖入该区间时隐藏模型与附属标记
                                const inCovT = !tlT || (dt >= tlT[0].dt - 0.001 && dt <= tlT[tlT.length - 1].dt + 0.001);
                                const inCovS = !tlS || (dt >= tlS[0].dt - 0.001 && dt <= tlS[tlS.length - 1].dt + 0.001);
                                // 插值受击方：优先滤波时间线（严格对齐游戏每帧实际显示位姿——
                                // 含 latency 移位/误差盒钳位/外推，逆向报告六轮），回退原始采样线性插值。
                                // 时间线 pos = 绝对世界坐标；原始采样 pos = 相对锚点（需 +tPos）
                                const useTlT = !!tlT;
                                const vInt = interpTick(useTlT ? tlT : vRaw, dt);
                                if (vInt && tankModel) {
                                    const wp = useTlT
                                        ? [vInt.pos[0] - cx, vInt.pos[1] - cy, vInt.pos[2] - cz]
                                        : [vInt.pos[0] + tPos[0] - cx, vInt.pos[1] + tPos[1] - cy, vInt.pos[2] + tPos[2] - cz];
                                    tankModel.position.set(wp[0], wp[1], wp[2]);
                                    tankModel.quaternion.copy(poseFromYPR(vInt.yaw, vInt.pitch, vInt.roll));
                                    tankModel.updateMatrixWorld(true);
                                    if (armorModel) {
                                        armorModel.position.copy(tankModel.position);
                                        armorModel.quaternion.copy(tankModel.quaternion);
                                        armorModel.updateMatrixWorld(true);
                                    }
                                    tankModel.visible = inCovT;
                                    if (armorModel) armorModel.visible = inCovT;
                                }
                                // 插值射手方：优先滤波时间线（同受击方）。
                                // 时间线/原始采样的 pos 均为绝对世界坐标——放置逻辑完全同构
                                const sInt = interpTick(tlS ? tlS : sRaw, dt);
                                if (sInt && window.__shooterModel) {
                                    window.__shooterModel.position.set(
                                        sInt.pos[0] - cx, sInt.pos[1] - cy, sInt.pos[2] - cz);
                                    window.__shooterModel.quaternion.copy(poseFromYPR(sInt.yaw, sInt.pitch, sInt.roll));
                                    window.__shooterModel.updateMatrixWorld(true);
                                }
                                // 炮塔/炮管实时：prop2（炮塔相对角）与 prop9（俯仰）时间线插值
                                const lerpTl = (tl, dt2) => {
                                    if (!tl || tl.length < 2) return null;
                                    for (let i = 0; i < tl.length - 1; i++) {
                                        const a = tl[i], b = tl[i + 1];
                                        if (a[0] <= dt2 && b[0] >= dt2) {
                                            const f = (b[0] - a[0]) > 1e-6 ? (dt2 - a[0]) / (b[0] - a[0]) : 0;
                                            return a[1] + (b[1] - a[1]) * f;
                                        }
                                    }
                                    return dt2 <= tl[0][0] ? tl[0][1] : tl[tl.length - 1][1];
                                };
                                // 角度版：跨 ±π 时按短弧插值（与客户端 0x1441e00 短弧归一化一致）
                                const lerpTlAngle = (tl, dt2) => {
                                    if (!tl || tl.length < 2) return null;
                                    for (let i = 0; i < tl.length - 1; i++) {
                                        const a = tl[i], b = tl[i + 1];
                                        if (a[0] <= dt2 && b[0] >= dt2) {
                                            const f = (b[0] - a[0]) > 1e-6 ? (dt2 - a[0]) / (b[0] - a[0]) : 0;
                                            let d = b[1] - a[1];
                                            while (d > Math.PI) d -= 2 * Math.PI;
                                            while (d < -Math.PI) d += 2 * Math.PI;
                                            return a[1] + d * f;
                                        }
                                    }
                                    return dt2 <= tl[0][0] ? tl[0][1] : tl[tl.length - 1][1];
                                };
                                // 受击方炮塔实时：prop2 相对角直接驱动炮塔/炮管节点。
                                // 时间线存游戏系相对角；镜像场景节点旋转角须取负（镜像翻转
                                // 旋转方向）——与初始摆放一致：turretDegT = 镜像炮塔角−镜像车体角 = −rel
                                // 炮管俯仰：target_gun_timeline（prop2 frac 解码，弧度）插值，
                                // 缺时间线时回落命中时刻静态值 __fireGunDegT
                                const relT = lerpTlAngle(s.target_turret_timeline, dt);
                                if (relT != null) {
                                    let deg = -relT * 180 / Math.PI;
                                    deg = ((deg + 180) % 360 + 360) % 360 - 180;
                                    const gpT = lerpTl(s.target_gun_timeline, dt);
                                    updateTurretGun(deg, gpT != null ? gpT * 180 / Math.PI
                                        : (window.__fireGunDegT != null ? window.__fireGunDegT : 0));
                                }
                                // 射手方炮塔实时：炮塔世界角 = 车体 yaw − prop2 相对角
                                //（内部 tr = 炮塔角−车体角 = −rel，同初始摆放的镜像系约定）
                                const relS = lerpTlAngle(s.shooter_turret_timeline, dt);
                                if (sInt && window.__shooterModel && window.__shooterData) {
                                    // 射手炮塔实时：用射手自身的车体位姿（sInt），非受击方的 vInt
                                    // 炮管相对俯仰：shooter_gun_timeline（prop2 frac 解码）插值——
                                    // 与受击方同源同锚定（车体俯仰由 sInt.pitch 时序承载，
                                    // 两者是不同自由度）。无时间线（无锚定/回退）时传 null →
                                    // 弹速反解（method29 弹速仅开火帧存在，窗口内恒定保持）。
                                    const gpS = (s.quality && s.quality.gun_pitch_degraded &&
                                        s.quality.gun_pitch_degraded.indexOf('shooter') >= 0)
                                        ? null : lerpTl(s.shooter_gun_timeline, dt);
                                    poseShooterTurretGun(window.__shooterModel, window.__shooterData,
                                        sInt.yaw - (relS || 0), s.launch_velocity, sInt.yaw, sInt.pitch, sInt.roll,
                                        gpS != null ? gpS : null, -(relS || 0), s.shooter_config_idx);
                                }
                                if (window.__updateMuzzleMarker) window.__updateMuzzleMarker();
                                if (window.__updateAnchorMarkers) window.__updateAnchorMarkers();
                                if (window.__victimAnchor) window.__victimAnchor.mk.visible = inCovT && window.__debugOn;
                                if (window.__shooterAnchor) window.__shooterAnchor.mk.visible = inCovS && window.__debugOn;
                                if (window.__shooterMuzzleMk) window.__shooterMuzzleMk.visible = inCovS && window.__debugOn;
                                if (window.__shooterMuzzleLine) window.__shooterMuzzleLine.visible = inCovS && window.__debugOn;
                                if (window.__updateMuzzleMarker) window.__updateMuzzleMarker();
                                if (window.__updateAnchorMarkers) window.__updateAnchorMarkers();
                                // 弹着点红点随当前位姿重算（部件约束与初始摆放一致）
                                if (window.__worldTickCtx && window.__worldImpactMk && armorModel && window.__worldTickCtx.lvDir) {
                                    if (window.__worldSegMk && window.__worldSegMk.p1) {
                                        // 判定基准 = WI 同构射线（§七补7；update 内随位姿重建
                                        // 射线并重求交），红点贴射线入点（无交点回退解码点）
                                        window.__worldSegMk.update(!!window.__debugOn && inCovT);
                                        const showSeg = window.__debugOn && inCovT;
                                        window.__worldImpactMk.visible = showSeg;
                                        const hitPt = window.__worldSegMk.p1.position;
                                        window.__worldImpactMk.position.copy(hitPt);
                                        if (showSeg) {
                                            dbgInfo('dbg-impact', '#ff2222', '弹着点',
                                                fmt3(hitPt.x + cx, hitPt.y + cy, hitPt.z + cz)
                                                + ' · DecodeShotSegment P1'
                                                + (typeof s.server_part_index === 'number' ? ' · 部件P' + s.server_part_index : ''));
                                        }
                                    } else {
                                    const wc = window.__worldTickCtx;
                                    const rc2 = new THREE.Raycaster();
                                    rc2.set(wc.launch.clone(), wc.lvDir);
                                    rc2.far = wc.rayFar;
                                    const sPart = (typeof s.server_part_index === 'number') ? s.server_part_index : null;
                                    const partOf = o => { const u = o.userData || {}; const sec = u.armorSectionOrig || u.armorSection;
                                        return sec === 'chassis' ? 0 : sec === 'hull' ? 1 : (sec === 'turret' || sec === 'gun') ? 2 : sec === 'gunBarrel' ? 3 : -1; };
                                    let iHits = rc2.intersectObject(armorModel, true)
                                        .filter(h => h.object.userData.armorSection !== 'deco');
                                    if (sPart != null) {
                                        const inPart = iHits.filter(h => partOf(h.object) === sPart);
                                        if (inPart.length) iHits = inPart;
                                    }
                                    const show = iHits.length > 0 && window.__debugOn && inCovT;
                                    window.__worldImpactMk.visible = show;
                                    if (show) {
                                        window.__worldImpactMk.position.copy(iHits[0].point);
                                        dbgInfo('dbg-impact', '#ff2222', '弹着点',
                                            fmt3(iHits[0].point.x + cx, iHits[0].point.y + cy, iHits[0].point.z + cz)
                                            + (sPart != null && iHits.some(h => partOf(h.object) === sPart) ? ' · 部件P' + sPart : ''));
                                    } else {
                                        dbgInfo('dbg-impact', '#ff2222', '弹着点', '（射线无交点）');
                                    }
                                    }
                                }
                                // DecodeShotSegment P1/P2 随位姿重摆（炮塔/炮管部件跟随旋转）
                                if (window.__worldSegMk && armorModel) {
                                    armorModel.updateWorldMatrix(true, false);
                                    window.__worldSegMk.update(!!window.__debugOn && inCovT);
                                }
                                // 弦判定实时重跑（节流尾随 100ms）：滑块连续拖动时模型位姿每刻
                                // 不同，判定/弹道/对比面板若不跟随重算就停留在上次的结果，
                                // 与弹着点红点（上方 raycast）不一致。射线参数 = ctx 的
                                // （launch + 弦向量），判定经 doPenetrationCheck → /api/penetrate，
                                // 过期响应由 __penCheckSeq 丢弃，上屏结果恒对应当前位姿。
                                if (window.__worldTickCtx && window.__worldTickCtx.lvDir && window.__worldPenMode) {
                                    if (timeSlider.__penTimer) clearTimeout(timeSlider.__penTimer);
                                    timeSlider.__penTimer = setTimeout(function() {
                                        timeSlider.__penTimer = null;
                                        const wc2 = window.__worldTickCtx;
                                        if (!wc2 || !wc2.lvDir || !armorModel) return;
                                        __shotRayOrigin = wc2.launch.clone();
                                        __shotRayTarget = wc2.launch.clone().addScaledVector(wc2.lvDir, wc2.rayFar);
                                        doPenetrationCheck(0, 0);
                                        __shotRayOrigin = null; __shotRayTarget = null;
                                    }, 100);
                                }
                            };
                        }
                        return;
                    }
                }).catch(e => showShotError('射击复现数据加载失败: ' + e));
            }
            if (QP.get('clean') === '1' && !isShotReplay) {
                ['info-panel','shell-selector','view-toggle','tank-selectors','turret-controls','controls-hint','loading'].forEach(id => {
                    const el = document.getElementById(id); if (el) el.style.display = 'none';
                });
            }
        }

        function updateInfoPanel() {
            document.getElementById('tank-name').textContent = tankData.name || '?';
            document.getElementById('tank-tier').textContent = L.tier(tankData.tier || '?');
            document.getElementById('tank-type').textContent = tankData.type ? L.type(tankData.type) : '?';
            document.getElementById('tank-nation').textContent = tankData.nation ? L.nation(tankData.nation) : '?';
            document.getElementById('info-panel').style.display = 'block';
        }

        async function loadTarget(tid) {
            const gen = ++targetLoadGen;
            tidyTrajectory();
            reportLoad({ state: 'loading', progress: null });   // 车辆数据（JSON）阶段：不确定进度
            const nextTankData = await fetchTankData(tid);
            if (destroyed || gen !== targetLoadGen) return false;
            tankData = nextTankData;
            const q = new URLSearchParams(location.search);
            const wantCfg = parseInt(q.get('config'), 10);
            const configs = tankData.configs || [];
            const defaultCfg = Math.max(0, configs.length - 1);
            currentConfigIdx = (Number.isInteger(wantCfg) && wantCfg >= 0 && wantCfg < configs.length) ? wantCfg : defaultCfg;
            setupConfigSelect();
            updateInfoPanel();
            loadModels();
            return true;
        }

        function currentConfig() {
            return (tankData && tankData.configs && tankData.configs[currentConfigIdx]) || null;
        }

        const activeGunNumber = () => {
            const cfg = currentConfig();
            if (!cfg) return null;
            const grp = configGunGroups[cfg.gun_index % Math.max(1, configGunGroups.length)];
            if (!grp) return null;
            for (const n of grp) {
                const m = (n.name || '').match(/^gun_(\d+)$/);
                if (m) return parseInt(m[1], 10);
            }
            return null;
        };

        function setupConfigSelect() {
            const sel = document.getElementById('config-select');
            const row = document.getElementById('config-row');
            const cfgs = tankData && tankData.configs ? tankData.configs : [];
            if (cfgs.length <= 1) { row.style.display = 'none'; return; }
            row.style.display = 'flex';
            sel.innerHTML = '';
            cfgs.forEach((c, i) => {
                const o = document.createElement('option');
                o.value = i;
                o.textContent = c.label + (c.turret_name && c.turret_name !== c.label ? ' (' + c.turret_name + ')' : '');
                sel.appendChild(o);
            });
            sel.value = String(currentConfigIdx);
        }

        function applyConfig(idx) {
            currentConfigIdx = idx;
            const cfg = currentConfig();
            if (!cfg) return;
            document.getElementById('config-select').value = String(idx);

            collectConfigNodes(tankModel);
            applyConfigVisible(tankModel, cfg.gun_index, cfg.turret_index);
            applyArmorConfigVisible(cfg);
            retagSpacedSections();
            alignArmorModules();
            origMatrices = null;
            armorOrigMatrices = null;
            collectTurretGunNodes();
            collectArmorNodes();
            updateTurretGun(currentTurretDeg, currentGunDeg);

            // 射手弹表随目标配置切换仅限普通装甲检视；射击复现会话中弹表已按
            // 射手实际搭载配置（&scfg=）选定，同坦克不同玩家配置不同，此处覆盖会
            // 把 scfg 域的弹表错换成目标当前配置的弹表
            if (shooterData && tankData && shooterData.tank_id === tankData.tank_id && !QP.get('shot')) {
                shooterShells = cfg.shells || [];
                shooterCaliber = cfg.caliber || shooterCaliber;
                populateShellSelector(shooterShells);
                selectedShell = shooterShells.length ? shooterShells[0] : null;
            }

            if (penetrationMode && armorModel) rebuildHeatmapScenes();
        }

        function applyArmorConfigVisible(cfg) {
            if (!armorModel) { return; }
            const pk = collectArmorPrefixes();
            const gunPk = pk.gun, turPk = pk.turret;
            const activeGun = gunPk.length ? gunPk[cfg.gun_index % gunPk.length] : null;
            const activeTur = turPk.length ? turPk[cfg.turret_index % turPk.length] : null;
            armorModel.traverse(function(node) {
                if (!node.isMesh) return;
                const name = node.name || '';
                const gm = name.match(/^(gun_\d+)_armor_/);
                const tm = name.match(/^(turret_\d+)_armor_/);
                if (gm) {
                    const visible = activeGun ? gm[1] === activeGun : true;
                    node.visible = visible;
                    node.userData.configHidden = !visible;
                    if (visible) node.userData.armorSection = node.userData.armorSection || 'gun';
                } else if (tm) {
                    const visible = activeTur ? tm[1] === activeTur : true;
                    node.visible = visible;
                    node.userData.configHidden = !visible;
                    if (visible) node.userData.armorSection = node.userData.armorSection || 'turret';
                }
            });
        }

        function populateShellSelector(shells) {
            const sel = document.getElementById('shell-select');
            sel.innerHTML = '';
            shells.forEach((s, i) => {
                const opt = document.createElement('option');
                opt.value = i;
                opt.textContent = shellOptionText(s);
                sel.appendChild(opt);
            });
            selectedShell = shells.length > 0 ? shells[0] : null;
            document.getElementById('shell-selector').style.display = shells.length > 0 ? 'block' : 'none';
        }

        async function loadShooter(tid) {
            if (destroyed) return;
            const data = await fetchTankData(tid);
            if (destroyed) return;
            shooterData = data;
            // 射手实际搭载配置弹表（&scfg= = shooter_config_idx，射击复现表注入）：
            // 多炮坦克 stock 弹表与发射炮的穿深/弹种清单不同（KV-1 发射 85mm F-30 AP
            // 120mm，stock ZiS-5 表只有 86/102/20），选择器必须用发射炮的表；
            // 无 scfg（旧链接）回退顶层 shells（stock 表，仅单配置坦克正确）
            const scfg = parseInt(QP.get('scfg'), 10);
            const cfgArr = shooterData.configs || [];
            let shells = null, caliber = null;
            if (!isNaN(scfg) && scfg >= 0 && scfg < cfgArr.length && (cfgArr[scfg].shells || []).length) {
                shells = cfgArr[scfg].shells;
                caliber = cfgArr[scfg].caliber;
            }
            if (!shells || shells.length === 0) {
                shells = shooterData.shells || [];
                caliber = shooterData.caliber || 120;
            }
            if (!shells || shells.length === 0) {
                const data = await fetchShells(tid);
                if (destroyed) return;
                if (Array.isArray(data)) {
                    shells = data;
                } else {
                    shells = data.shells || [];
                    caliber = data.caliber || 120;
                }
            }
            shooterShells = shells.map(s => (s && s.caliber == null)
                ? Object.assign({}, s, { caliber: caliber }) : s);
            shooterCaliber = caliber;
            populateShellSelector(shooterShells);
            // &shell= = 射手配置内弹下标（射击复现表 resolveShellIdx 同域）
            const si = parseInt(QP.get('shell'), 10);
            if (!isNaN(si) && si >= 0 && si < shooterShells.length) {
                const sel = document.getElementById('shell-select');
                if (sel) sel.value = String(si);
                selectedShell = shooterShells[si];
            }
            // 切换射击坦克后同步热力图 uniforms（口径/穿深/跳弹角/转正角），否则判定沿用旧数据
            if (penetrationMode) {
                const sh = selectedShell || null;
                if (sh) { updatePenetrationUniforms(sh); updateSpacedUniforms(sh); }
            }
        }

        let tanksList = [];
        let currentShooterId = null, currentTargetId = null;
        let pickerMode = 'target'; // which selector the picker is currently editing

        function populateFilterOptions() {
            const tiers = [...new Set(tanksList.map(t => t.tier))].sort((a, b) => a - b);
            const nations = [...new Set(tanksList.map(t => t.nation))].sort();
            const types = [...new Set(tanksList.map(t => t.type))].sort();
            const addOpts = (selId, items, labelFn, defLabel) => {
                const sel = document.getElementById(selId);
                sel.innerHTML = '';
                const def = document.createElement('option');
                def.value = '';
                def.textContent = defLabel;
                sel.appendChild(def);
                items.forEach(v => {
                    const o = document.createElement('option');
                    o.value = String(v);
                    o.textContent = labelFn(v);
                    sel.appendChild(o);
                });
            };
            addOpts('tp-tier', tiers, v => 'Tier ' + v, 'Tier');
            addOpts('tp-nation', nations, v => v, 'Nation');
            addOpts('tp-type', types,
                v => ({lightTank:'Light', mediumTank:'Medium', heavyTank:'Heavy', 'AT-SPG':'TD'}[v] || v), 'Type');
        }

        const TYPE_LABEL = { lightTank:'Light', mediumTank:'Medium', heavyTank:'Heavy', 'AT-SPG':'TD' };

        function getFiltered() {
            const q = document.getElementById('tp-search').value.trim().toLowerCase();
            const tier = document.getElementById('tp-tier').value;
            const nation = document.getElementById('tp-nation').value;
            const type = document.getElementById('tp-type').value;
            return tanksList.filter(t =>
                (!q || (t.name || '').toLowerCase().includes(q)) &&
                (!tier || String(t.tier) === tier) &&
                (!nation || t.nation === nation) &&
                (!type || t.type === type)
            );
        }

        let renderChunk = null;   // { list, rendered, selId }

        function makeCard(t, selId) {
            const card = document.createElement('div');
            card.className = 'tank-card' + (String(t.id) === String(selId) ? ' sel' : '');
            card.dataset.id = String(t.id);

            const img = document.createElement('img');
            img.className = 'tc-img';
            img.loading = 'lazy';
            img.src = tankImageUrl(t.id);
            img.alt = t.name;

            const body = document.createElement('div');
            body.className = 'tc-body';
            const nm = document.createElement('div');
            nm.className = 'tc-name';
            nm.textContent = t.name;
            const meta = document.createElement('div');
            meta.className = 'tc-meta';
            const tier = document.createElement('span');
            tier.className = 'tc-tier';
            tier.textContent = 'T' + t.tier;
            const typ = document.createElement('span');
            typ.className = 'tc-type';
            typ.textContent = TYPE_LABEL[t.type] || t.type;
            const nat = document.createElement('span');
            nat.className = 'tc-nation';
            nat.textContent = t.nation;
            meta.append(tier, typ, nat);

            body.append(nm, meta);
            card.append(img, body);
            card.addEventListener('click', () => selectFromPicker(t.id));
            return card;
        }

        function renderGrid() {
            const grid = document.getElementById('tp-grid');
            const filtered = getFiltered();
            const selId = pickerMode === 'shooter' ? currentShooterId : currentTargetId;
            renderChunk = { list: filtered, rendered: 0, selId };
            grid.innerHTML = '';
            loadMoreCards();
            document.getElementById('tp-count').textContent = filtered.length + '/' + tanksList.length;
        }

        const CHUNK = 90;
        function loadMoreCards() {
            if (!renderChunk) return;
            const grid = document.getElementById('tp-grid');
            const end = Math.min(renderChunk.rendered + CHUNK, renderChunk.list.length);
            for (let i = renderChunk.rendered; i < end; i++) {
                grid.appendChild(makeCard(renderChunk.list[i], renderChunk.selId));
            }
            renderChunk.rendered = end;
        }

        function updateTankLabels() {
            const find = (id) => tanksList.find(t => String(t.id) === String(id));
            const s = find(currentShooterId), t = find(currentTargetId);
            document.getElementById('shooter-select').textContent = s ? s.name : '—';
            document.getElementById('target-select').textContent = t ? t.name : '—';
        }

        function openPicker(mode) {
            pickerMode = mode;
            document.getElementById('tp-title').textContent =
                (mode === 'shooter' ? 'Shooter' : 'Target') + ' — Select Tank';
            renderGrid();
            document.getElementById('tank-picker').classList.add('open');
        }

        function closePicker() {
            document.getElementById('tank-picker').classList.remove('open');
        }

        function selectFromPicker(id) {
            id = parseInt(id);
            if (pickerMode === 'shooter') {
                currentShooterId = id;
                updateTankLabels();
                loadShooter(id);
            } else {
                currentTargetId = id;
                updateTankLabels();
                loadTarget(id).catch((e) => reportLoad({ state: 'error', message: loadFailed('tank data', errorMessage(e)) }));
            }
            closePicker();
        }

        async function populateTankLists(initTargetId, initShooterId) {
            const list = await fetchTankFilter();
            if (destroyed) return;
            tanksList = list;
            currentShooterId = initShooterId || initTargetId;
            currentTargetId = initTargetId;
            populateFilterOptions();
            updateTankLabels();
        }

        function initScene() {
            scene = new THREE.Scene();
            scene.background = new THREE.Color(0x1c1410);
            scene.fog = new THREE.Fog(0x1c1410, 15, 50);

            // SPA 壳内渲染：视口尺寸取 canvas 容器（main 区域），而非整窗（顶部导航占 67px）
            const view = document.getElementById('canvas-container');
            camera = new THREE.PerspectiveCamera(50, view.clientWidth / view.clientHeight, 0.1, 1000);
            camera.position.set(2.5, 3.2, -8);

            // preserveDrawingBuffer 不再开启：本查看器没有任何像素回读（无 toDataURL/readPixels/
            // 录屏），开启它只会阻止浏览器做缓冲区交换优化（每帧多一次全分辨率拷贝）。
            renderer = new THREE.WebGLRenderer({ antialias: true });
            renderer.setSize(view.clientWidth, view.clientHeight);
            // DPR 上限 2：此前直接取 devicePixelRatio（3× 屏上按 3× 全屏渲染，像素数 ×2.25）
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            renderer.localClippingEnabled = true;
            view.appendChild(renderer.domElement);
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = 1.15;

            controls = new OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.05;
            controls.rotateSpeed = 0.35;   // 降低旋转灵敏度（默认 1.0 过快，精细对位困难）
            controls.minDistance = 3;
            controls.maxDistance = 30;
            controls.mouseButtons = {
                LEFT: THREE.MOUSE.ROTATE,
                MIDDLE: THREE.MOUSE.DOLLY,
                RIGHT: null,
            };

            const hemi = new THREE.HemisphereLight(0xffffff, 0x8a7f6e, 2.2);
            scene.add(hemi);
            scene.add(new THREE.AmbientLight(0xffffff, 0.9));
            const spot1 = new THREE.SpotLight(0xfff5e1, 500, 60, 0.55, 0.6);
            spot1.position.set(10, 15, 8);
            scene.add(spot1);
            const spot2 = new THREE.SpotLight(0x88aaff, 260, 50, 0.45, 0.5);
            spot2.position.set(-10, 12, -6);
            scene.add(spot2);

            const grid = new THREE.GridHelper(20, 20, 0x4a3a26, 0x2c241c);
            scene.add(grid);

            raycaster = new THREE.Raycaster();
            mouse = new THREE.Vector2();
        }

        function setupEventHandlers() {
            document.getElementById('shell-select').addEventListener('change', function() {
                const idx = parseInt(this.value);
                if (shooterShells && idx < shooterShells.length) {
                    selectedShell = shooterShells[idx];
                    if (penetrationMode) { updatePenetrationUniforms(selectedShell); updateSpacedUniforms(selectedShell); }
                    if (window.__worldPenMode && window.__worldTickCtx && window.__worldTickCtx.lvDir) {
                        // 世界模式：换弹按权威弦射线重跑判定——直接 doPenetrationCheck
                        // 会用相机射线覆盖锁定的复现结果
                        const wc3 = window.__worldTickCtx;
                        __shotRayOrigin = wc3.launch.clone();
                        __shotRayTarget = wc3.launch.clone().addScaledVector(wc3.lvDir, wc3.rayFar);
                        doPenetrationCheck(0, 0);
                        __shotRayOrigin = null; __shotRayTarget = null;
                    } else if (QP.get('shot')) {
                        doPenetrationCheck(0, 0);
                    }
                }
            });

            const onEquipmentChange = function() {
                const sel = document.getElementById('shell-select');
                for (let i = 0; i < sel.options.length; i++) {
                    if (shooterShells && i < shooterShells.length) {
                        sel.options[i].textContent = shellOptionText(shooterShells[i]);
                    }
                }
                if (!penetrationMode) return;
                const sh = selectedShell || (shooterShells[0]) || null;
                if (sh) { updatePenetrationUniforms(sh); updateSpacedUniforms(sh); }
                updateHeatmapThickness();
            };
            document.getElementById('eq-calibrated').addEventListener('change', onEquipmentChange);
            document.getElementById('eq-enhanced').addEventListener('change', onEquipmentChange);

            document.getElementById('config-select').addEventListener('change', function() {
                applyConfig(parseInt(this.value));
            });

            document.getElementById('target-select').addEventListener('click', function() { openPicker('target'); });
            document.getElementById('shooter-select').addEventListener('click', function() { openPicker('shooter'); });

            document.getElementById('tp-close').addEventListener('click', closePicker);
            document.getElementById('tp-grid').addEventListener('click', function() {
            });
            document.getElementById('tp-search').addEventListener('input', renderGrid);
            document.getElementById('tp-tier').addEventListener('change', renderGrid);
            document.getElementById('tp-nation').addEventListener('change', renderGrid);
            document.getElementById('tp-type').addEventListener('change', renderGrid);
            document.getElementById('tank-picker').addEventListener('click', function(e) {
                if (e.target === this) closePicker();
            });

            document.getElementById('collision-btn').addEventListener('click', function() {
                collisionMode = !collisionMode;
                this.classList.toggle('active', collisionMode);
                this.textContent = collisionMode ? L.hideCollision : L.showCollision;
                if (!armorModel) return;
                applyArmorViewStyle(collisionMode);
            });

            // —— 指针交互注册（单一 Pointer Events，桌面+触屏统一；评审 PR BLOCKER 1/2）——
            // 处理器与全部状态定义在闭包级（__armorRicochet 钩子之前），这里只做注册（renderer 已就绪）。
            renderer.domElement.addEventListener('pointerdown', aimPointerHandlers.down);
            renderer.domElement.addEventListener('pointermove', aimPointerHandlers.move);
            renderer.domElement.addEventListener('pointerup', aimPointerHandlers.up);
            renderer.domElement.addEventListener('pointercancel', aimPointerHandlers.cancel);
            renderer.domElement.addEventListener('lostpointercapture', aimPointerHandlers.lostCapture);

            document.getElementById('turret-controls').style.display = 'block';

            onWin('resize', function() {
                const view = document.getElementById('canvas-container');
                camera.aspect = view.clientWidth / view.clientHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(view.clientWidth, view.clientHeight);
                refreshPenetrationResolution();
                });
        }

        async function init() {
            reportLoad({ state: 'loading', progress: null });
            initScene();
            setupEventHandlers();
            const initTargetId = window.__INITIAL_TANK__ || 28689;
            const initShooterId = window.__INITIAL_SHOOTER__ || initTargetId;
            await populateTankLists(initTargetId, initShooterId);
            if (destroyed) return;
            initDone = true;
            await loadTarget(initTargetId);
            if (destroyed) return;
            await loadShooter(initShooterId);
            if (!destroyed) animate();   // await 期间路由已离开则不再启动渲染
        }

        /// 宿主页"重试"：名册已就绪时只重载当前目标坦克；否则返回 false，由宿主整体重建
        function retry() {
            if (destroyed || !initDone || currentTargetId == null) return false;
            loadTarget(currentTargetId)
                .then(() => { if (!destroyed && !rafId) animate(); })   // 首次加载失败时渲染循环尚未启动
                .catch((e) => reportLoad({ state: 'error', message: loadFailed('tank data', errorMessage(e)) }));
            return true;
        }

        let turretNode = null, gunNodesList = [];
        let gunBarrelNodes = [];   // 精确名 gun_XX = 炮管本体（随炮塔+俯仰）
        let origMatrices = null;
        let currentConfigIdx = 0;
        let currentTurretDeg = 0, currentGunDeg = 0;
        let configGunGroups = [];
        let configTurretNodes = [];// all turret_0X root nodes (visual model), sorted by number

        function collectConfigNodes(model) {
            configGunGroups = [];
            configTurretNodes = [];
            if (!model) return;
            const byGroup = new Map(); // groupNum -> nodes[]
            const turrets = [];
            model.traverse(function(n) {
                const nm = n.name || '';
                const gm = nm.match(/^gun_(\d+)/);
                const tm = nm.match(/^turret_(\d+)$/);
                if (gm) {
                    const g = parseInt(gm[1], 10);
                    if (!byGroup.has(g)) byGroup.set(g, []);
                    byGroup.get(g).push(n);
                } else if (tm) {
                    turrets.push(n);
                }
            });
            const keys = Array.from(byGroup.keys()).sort((a, b) => a - b);
            for (const k of keys) {
                const arr = byGroup.get(k).sort((a, b) => ((a.name||'') < (b.name||'') ? -1 : 1));
                configGunGroups.push(arr);
            }
            configTurretNodes = turrets.sort((a, b) => (a.name.match(/\d+/)?.[0]|0) - (b.name.match(/\d+/)?.[0]|0));
        }

        function applyConfigVisible(model, gi, ti) {
            if (!model) return;
            const gCount = Math.max(1, configGunGroups.length);
            const tCount = Math.max(1, configTurretNodes.length);
            configGunGroups.forEach((grp, i) => { grp.forEach(n => { n.visible = (i === (gi % gCount)); }); });
            configTurretNodes.forEach((n, i) => { n.visible = (i === (ti % tCount)); });
        }

        function collectTurretGunNodes() {
            if (!tankModel || !configTurretNodes.length) return;
            const cfg = currentConfig();
            turretNode = configTurretNodes[cfg.turret_index % configTurretNodes.length] || null;
            if (configGunGroups.length) {
                const grp = configGunGroups[cfg.gun_index % configGunGroups.length];
                gunNodesList = grp || [];
            } else {
                gunNodesList = [];
            }
            // 游戏装配语义【用户实证】：炮盾（gun_XX_mask）**随炮管俯仰**（焊在炮管摇篮上），
            // 与炮管本体同链。group 内其余节点 = 状态拆件（hide_elements 等），不参与姿态。
            gunBarrelNodes = gunNodesList.filter(n => /^gun_\d+(_mask)?$/.test(n.name || ''));
            origMatrices = new Map();
            if (turretNode) {
                turretNode.updateMatrix();
                origMatrices.set(turretNode, turretNode.matrix.clone());
                turretNode.matrixAutoUpdate = false;
            }
            for (const gn of gunNodesList) {
                gn.updateMatrix();
                origMatrices.set(gn, gn.matrix.clone());
                gn.matrixAutoUpdate = false;
            }
        }

        function updateTurretGun(turretDeg, gunDeg) {
            if (!tankModel) return;
            if (!origMatrices) collectTurretGunNodes();
            if (!origMatrices) return;
            ricochetPoseDirty = true;   // 炮塔/炮管旋转 → 世界系网格重建（下一帧类通道前）

            // 旋转枢轴 = models.pb 原点链（alignArmorModules 写入：track+turret / track+turret+gun）
            const tPivot = armorPivotTurret ? armorPivotTurret.clone() : new THREE.Vector3(0, 0, 1.7);
            const gPivot = armorPivotGun ? armorPivotGun.clone() : new THREE.Vector3(0, 0, 2.0);

            const tr = THREE.MathUtils.degToRad(turretDeg);
            const gr = THREE.MathUtils.degToRad(gunDeg);

            let turretRot = new THREE.Matrix4().makeRotationZ(tr);
            const itr = tankData.initial_turret_rotation;
            if (itr) {
                turretRot = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
                    -THREE.MathUtils.degToRad(itr.pitch),
                    -THREE.MathUtils.degToRad(itr.roll),
                    tr - THREE.MathUtils.degToRad(itr.yaw),
                    'XYZ'));
            }
            const mTurret = new THREE.Matrix4();
            mTurret.makeTranslation(tPivot.x, tPivot.y, tPivot.z);
            mTurret.multiply(turretRot);
            mTurret.multiply(new THREE.Matrix4().makeTranslation(-tPivot.x, -tPivot.y, -tPivot.z));

            const mGun = mTurret.clone();
            mGun.multiply(new THREE.Matrix4().makeTranslation(gPivot.x, gPivot.y, gPivot.z));
            mGun.multiply(new THREE.Matrix4().makeRotationX(gr));
            mGun.multiply(new THREE.Matrix4().makeTranslation(-gPivot.x, -gPivot.y, -gPivot.z));

            if (turretNode) {
                const orig = origMatrices.get(turretNode);
                const m = mTurret.clone();
                m.multiply(orig);
                turretNode.matrix.copy(m);
                turretNode.matrixWorldNeedsUpdate = true;
            }
            // 炮管本体 + 炮盾：炮塔旋转 × 俯仰（炮盾焊在炮管摇篮上，同链）
            const barrelNodes = gunBarrelNodes.length ? gunBarrelNodes : gunNodesList;
            for (const gn of barrelNodes) {
                const orig = origMatrices.get(gn);
                const m = mGun.clone();
                m.multiply(orig);
                gn.matrix.copy(m);
                gn.matrixWorldNeedsUpdate = true;
            }

            if (armorModel) {
                if (!armorOrigMatrices) collectArmorNodes();
                if (armorOrigMatrices) {
                    const aTP = tPivot.clone();
                    const aGP = gPivot.clone();
                    const mAT = new THREE.Matrix4();
                    mAT.makeTranslation(aTP.x, aTP.y, aTP.z);
                    // 与视觉炮塔同一旋转（含 initial_turret_rotation）——4 辆意大利固定战斗室 TD
                    // 依赖 itr 定型，漏叠会让装甲板与外观炮塔差 3~6.5° 俯仰
                    mAT.multiply(turretRot.clone());
                    mAT.multiply(new THREE.Matrix4().makeTranslation(-aTP.x, -aTP.y, -aTP.z));

                    const mAG = mAT.clone();
                    mAG.multiply(new THREE.Matrix4().makeTranslation(aGP.x, aGP.y, aGP.z));
                    mAG.multiply(new THREE.Matrix4().makeRotationX(gr));
                    mAG.multiply(new THREE.Matrix4().makeTranslation(-aGP.x, -aGP.y, -aGP.z));

                    for (const [node, orig] of armorOrigMatrices) {
                        const name = node.name || '';
                        if (/^gun_\d+_armor_/.test(name)) {
                            const m = mAG.clone();
                            m.multiply(orig);
                            node.matrix.copy(m);
                        } else {
                            const m = mAT.clone();
                            m.multiply(orig);
                            node.matrix.copy(m);
                        }
                        node.matrixWorldNeedsUpdate = true;
                    }
                }
            }
        }

        let armorOrigMatrices = null;
        function collectArmorNodes() {
            if (!armorModel) return;
            const cfg = currentConfig();
            let gunPrefix = null, turretPrefix = null;
            if (cfg) {
                const pk = collectArmorPrefixes();
                const gunPk = pk.gun, turPk = pk.turret;
                if (gunPk.length) gunPrefix = gunPk[cfg.gun_index % gunPk.length];
                if (turPk.length) turretPrefix = turPk[cfg.turret_index % turPk.length];
            }
            armorOrigMatrices = new Map();
            armorModel.traverse(function(node) {
                if (!node.isMesh) return;
                const name = node.name || '';
                const gm = name.match(/^(gun_\d+)_armor_/);
                const tm = name.match(/^(turret_\d+)_armor_/);
                const isGun = gm && (!gunPrefix || gm[1] === gunPrefix);
                const isTurret = tm && (!turretPrefix || tm[1] === turretPrefix);
                if (isGun || isTurret) {
                    node.updateMatrix();
                    armorOrigMatrices.set(node, node.matrix.clone());
                    node.matrixAutoUpdate = false;
                }
            });
        }

        // 炮管/炮塔装甲前缀收集（原两函数各自全树 traverse，合并为一次遍历同时收集）。
        // 缓存到模块级：armorModel 未变时直接复用，applyArmorConfigVisible 与
        // collectArmorNodes 的重复遍历只发生一次
        let _armorPrefixCache = null;   // { gun: [...], turret: [...] }
        function collectArmorPrefixes() {
            if (_armorPrefixCache) return _armorPrefixCache;
            const gunSet = new Set(), turSet = new Set();
            if (armorModel) armorModel.traverse(n => {
                const name = n.name || '';
                const gm = name.match(/^(gun_\d+)_armor_/);
                if (gm) gunSet.add(gm[1]);
                const tm = name.match(/^(turret_\d+)_armor_/);
                if (tm) turSet.add(tm[1]);
            });
            const sortPk = (set) => Array.from(set).sort((a,b) => (a.match(/\d+/)?.[0]|0)-(b.match(/\d+/)?.[0]|0));
            _armorPrefixCache = { gun: sortPk(gunSet), turret: sortPk(turSet) };
            return _armorPrefixCache;
        }

        let mouseDownPos = null, isDragging = false;
        function onClick(event) {
            if (!armorModel) return;
            // 世界模式(射击复现)：判定结果锁定——初始判定射线已切换为 DecodeShotSegment
            // 基准（P1 位置 + P1→P2 弹向），点击不重跑判定，始终显示该初始结果
            if (window.__worldPenMode) return;
            const rect = renderer.domElement.getBoundingClientRect();
            const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            doPenetrationCheck(ndcX, ndcY);
        }

        let __shotRayOrigin = null;   // 射击复现：射线起点（射手方向，固定距离）
        let __shotRayTarget = null;   // 射击复现：射线终点（瞄准点）
        let __penCheckSeq = 0;        // 判定代数序号：滑块连续重跑判定时丢弃过期的 /api/penetrate 响应
        // 射击复现错误面板（模块级：doPenetrationCheck 等顶层函数也要调用）
        function showShotError(msg) {
            console.error('[shot-replay] ' + msg);
            const st = document.getElementById('turret-controls');
            if (st) {
                // 世界模式调试关闭时该面板被收纳——错误必须强制可见
                st.style.display = 'block';
                st.innerHTML = '<div class="ctrl-row" style="color:var(--red);"><b>射击复现错误</b></div>' +
                    '<div class="ctrl-row" style="color:var(--red);font-size:11px;">' + msg + '</div>';
            }
        }

        // 命中分类 → armorHits 条目（原主循环与跳弹出射循环两段重复实现合并）：
        // parent 不可见 / configHidden / deco 过滤 + userData 或父链正则取名 +
        // getPlateThickness + partName 构造；被过滤或无厚度返回 null。
        // 注意：gunBarrel 的 gunClipPlane 过滤仅主判定循环有，留在调用点
        function classifyHit(hit) {
            if (hit.object.parent && hit.object.parent.visible === false) return null;
            if (hit.object.userData.configHidden) return null;
            if (hit.object.userData.armorSection === 'deco') return null;
            let section = null, plateId = null, thickness = null;
            if (hit.object.userData.armorSection) {
                section = hit.object.userData.armorSection;
                plateId = hit.object.userData.armorPlateId;
                thickness = hit.object.userData.armorThickness;
            } else {
                let node = hit.object;
                while (node) {
                    const m = (node.name || '').match(/(hull|turret|gun)_\w*?_?armor_(\d+)/);
                    if (m) { section = m[1]; plateId = m[2]; break; }
                    node = node.parent;
                }
                if (section && plateId) thickness = getPlateThickness(section, plateId);
            }
            if (section === null || thickness === null || thickness === undefined) return null;
            const normal = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0);
            const nm = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
            normal.applyNormalMatrix(nm).normalize();
            let partName;
            if (section === 'chassis') {
                partName = plateId === 'leftTrack' ? 'Track (Left)' : 'Track (Right)';
            } else if (section === 'gunBarrel') {
                partName = 'Gun Barrel';
            } else {
                const disp = hit.object.userData.armorSectionOrig || section;
                partName = `${disp.charAt(0).toUpperCase() + disp.slice(1)} Plate ${plateId}`;
            }
            return { section, plateId, thickness, point: hit.point, normal, partName };
        }

        function doPenetrationCheck(ndcX, ndcY) {
            if (!armorModel) return;
            judgmentCount++;
            // 代数序号：仅最新一次判定的响应可上屏（滑块拖动会连续触发判定）
            const penSeq = ++__penCheckSeq;

            armorModel.traverse(function(node) {
                if (!node.isMesh) return;
                if (node.userData.configHidden) return;
                if (node.userData.armorSection === 'deco') { node.visible = false; return; }
                if (node.visible === false) node.visible = true;
            });
            const activeGun = activeGunNumber();
            const cfgForGun = currentConfig();
            // BlitzKit 真值语义：mask=0 视同无 mask
            const gunHasMask = cfgForGun && typeof cfgForGun.gun_mask === 'number' && cfgForGun.gun_mask !== 0;
            computeGunClipPlane();
            const activeModules = activeGun == null
                ? moduleMeshes   // 无法确定激活炮(如 configGunGroups 未填充)时退化为全部保留
                : moduleMeshes.filter(m => {
                    if (m.userData.gunConfig != null) return m.userData.gunConfig === activeGun;
                    return true;
                }).filter(m => !(m.userData.gunMaskPart && !gunHasMask));
            for (const mesh of activeModules) {
                if (mesh.visible === false) mesh.visible = true;
            }

            if (window.__segRay) {
                // DecodeShotSegment 判定基准（P1 位置 + P1→P2 弹向）优先于一切
                raycaster.set(window.__segRay.origin.clone(), window.__segRay.dir);
            } else if (__shotRayOrigin && __shotRayTarget) {
                const dir = __shotRayTarget.clone().sub(__shotRayOrigin).normalize();
                raycaster.set(__shotRayOrigin.clone(), dir);
            } else {
                mouse.x = ndcX;
                mouse.y = ndcY;
                raycaster.setFromCamera(mouse, camera);
            }
            const objects = [armorModel, ...activeModules];
            const intersects = raycaster.intersectObjects(objects, true);
            // blitzkit：非外部模块不做去重（外部模块的 variant 去重在判定侧进行）
            const armorHits = [];
            for (const hit of intersects) {
                if (hit.object.userData.armorSection === 'gunBarrel' && gunClipPlane &&
                    gunClipPlane.distanceToPoint(hit.point) < 0) continue;
                const entry = classifyHit(hit);
                if (entry) armorHits.push(entry);
            }

            // BlitzKit 语义（SpacedArmorScene 的触发面）：判定只由【触达主装甲板】的射线发起——
            // shoot() 只挂在 Primary 网格的 onClick 上，spaced / 外部模块网格挂的是空 handler
            // （只为进入 event.intersections，从不触发判定）。所以整条射线没打到 hull/turret/gun
            // 装甲板（只穿间隙甲屏幕、只碰履带/炮管）→ 不构成一次击穿判定，不显示结果。
            // 漏了间隙甲这一条会把「末层 = 屏幕」判成击穿整车（56TP 炮塔 10mm 屏幕板 plate 12
            // 即此类：约四成点击方向只穿过屏幕，无主装甲参与）。
            // 仅作用于相机点击路径；射击复现的弹道弦判定需要外部模块层参与穿深链，保持原样。
            const isCameraClick = !window.__segRay && !(__shotRayOrigin && __shotRayTarget);
            if (isCameraClick && armorHits.length > 0 && !armorHits.some(h => isPrimary(h.section))) {
                if (window.__hitMarker) { scene.remove(window.__hitMarker); window.__hitMarker = null; }
                // 不构成判定 = 无结果态（与「点击未命中装甲」同款清理）：清掉上一次的判定
                // 面板/轨迹，避免旧结论被误读成本次点击的结论
                document.getElementById('click-info').style.display = 'none';
                document.getElementById('traj-info').style.display = 'none';
                trajInfoPos = null;
                if (trajGroup) { scene.remove(trajGroup); trajGroup = null; }
                return;
            }

            if (armorHits.length === 0) {
                console.warn('[shot-replay] check: 0 armor hits, intersects=' + intersects.length);
                document.getElementById('click-info').style.display = 'none';
                document.getElementById('traj-info').style.display = 'none';
                trajInfoPos = null;
                if (trajGroup) { scene.remove(trajGroup); trajGroup = null; }
                // 弦不再与装甲相交（滑块拖到命中前位姿等）：同步清掉上次判定的命中
                // 标记，避免旧位置的绿/红点残留与"不相交"提示并存
                if (window.__hitMarker) { scene.remove(window.__hitMarker); window.__hitMarker = null; }
                if (window.__shotIsHit) {
                    if (window.__worldPenMode) {
                        // 世界模式：默认 tick 在命中前 ≈0.2s，弦不相交是正常数据态而非几何错误。
                        // 浮动中性提示即可，不覆盖左下 World View 面板（tick 选择器在里面）；
                        // 切到命中时刻附近的 tick 会自动被真实判定替换。
                        const div = document.getElementById('traj-info');
                        div.innerHTML = '<div style="background:var(--tooltip-bg);border-radius:10px;'
                            + 'border-left:4px solid #ffcf5c;padding:10px 16px;font-size:13px;color:var(--yellow);'
                            + 'white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,0.5);">'
                            + '当前 tick 位姿与弹道弦不相交（命中前采样，坦克未到命中点）— 切换 tick 查看命中判定</div>';
                        trajInfoPos = controls.target.clone();
                        // 对比面板同步置中性：否则残留上一次判定的"✓ 一致/✗ 不一致"误导
                        const cmpEl = document.getElementById('world-pen-cmp');
                        if (cmpEl) cmpEl.innerHTML = '<span style="color:var(--muted);">— 当前位姿弹道弦未命中装甲，无判定</span>';
                    } else {
                        showShotError('服务器判定命中但射线未命中任何装甲板——弹道/模型几何错位');
                    }
                }
                return;
            }

            // ===== HE 弹命中层语义修正 =====
            // HE(与一切爆炸弹)命中【首个表面】即爆炸，不沿弹道穿透整车；弦判定沿弦收集
            // 全部连续命中会把两侧装甲都算进溅射衰减 → HE 溅射伤害被过度衰减而误判
            // BLOCKED(服务器同发判有伤害)。修正：HE 只保留【第一个非 deco 命中】为爆炸点。
            // AP/APCR/HEAT 的多层穿透语义不变。
            const shellTypeNow = shellTypeOf(selectedShell);
            const hitsForCheck = (shellTypeNow === 'he' && armorHits.length > 1)
                ? [armorHits[0]] : armorHits;

            const first = armorHits[0];
            const point = first.point;
            // ===== 片元交叉验证：raycast 装甲片 ↔ 游戏原生 segment armor_group =====
            // segment（type=32 命中通知，服务器权威）给出命中装甲组。一致 → 标记绿色（高置信），
            // 不一致 → 红色保留 raycast 点（差异可能来自炮塔/炮管姿态近似）。
            const segCtx = window.__shotCtx || {};
            let fragOk = null;
            if (segCtx.segArmorGroup > 0) {
                const pid = parseInt(first.plateId, 10);
                fragOk = (!isNaN(pid)) && pid === segCtx.segArmorGroup;
            }
            if (window.__hitMarker) { scene.remove(window.__hitMarker); window.__hitMarker = null; }
            const markerColor = fragOk === true ? 0x22cc44 : (fragOk === false ? 0xff2222 : 0xffcc00);
            const markerGeo = new THREE.SphereGeometry(0.08, 16, 12);
            const markerMat = new THREE.MeshBasicMaterial({ color: markerColor, transparent: true, opacity: 0.9, depthTest: false });
            const marker = new THREE.Mesh(markerGeo, markerMat);
            marker.position.copy(point);
            marker.renderOrder = 999;
            scene.add(marker);
            window.__hitMarker = marker;
            const ringGeo = new THREE.RingGeometry(0.12, 0.18, 24);
            const ringMat = new THREE.MeshBasicMaterial({ color: markerColor, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthTest: false });
            const ring = new THREE.Mesh(ringGeo, ringMat);
            // 圆环面垂直入射弹向（命中点的"靶环"语义）；无弹向时回退朝向相机
            const ringDir = (window.__segRay && window.__segRay.dir)
                ? point.clone().add(window.__segRay.dir.clone()) : camera.position;
            ring.lookAt(ringDir);
            marker.add(ring);
            window.__hitMarkerRing = ring;
            if (fragOk !== null && window.__shotCtx) {
                window.__shotCtx.fragValidated = fragOk;
                console.log('[shot-replay] 片元验证:', fragOk ? '✓ 一致' : '✗ 不一致',
                    'raycast=' + first.section + '#' + first.plateId, 'segment_group=' + segCtx.segArmorGroup);
            }
            // world 复现模式：射线/交点在世界系，判定请求需模型局部米制（/api/penetrate
            // 语义）——经 worldToLocal 刚体逆变换换算；相对模式模型在原点未旋转，世界=局部。
            const worldPen = window.__worldPenMode === true && !!armorModel.parent;
            const toLocalPt = (p) => (worldPen ? armorModel.worldToLocal(p.clone()) : p.clone());
            // 判定入射方向 = 实际判定射线的方向（§七补4/补5：__segRay = P1→P2 解码弦，
            // 世界系，与 raycast 同源）。勿用炮口弦或模型局部系方向：前者与 P1→P2 射线
            // 是两条不同方向的线（入射角会被弦方向污染），后者与世界系命中法线做点积
            // 属坐标系混用（模型有偏航/坡度俯仰时角度全错）。
            const viewDir = (window.__segRay)
                ? window.__segRay.dir.clone()
                : (__shotRayOrigin && __shotRayTarget)
                    ? __shotRayOrigin.clone().sub(point).normalize()
                    : camera.position.clone().sub(point).normalize();
            const shotRayO = (window.__segRay || __shotRayOrigin)
                ? raycaster.ray.origin.clone() : null;

            // 命中距离（米）：射击复现 = 真实炮口(method29 launchPoint) → 命中点，
            // × worldMetersPerUnit 换算回真实米数；其他模式回退炮管几何/相机距离。
            const dist = (__shotRayOrigin
                ? point.distanceTo(__shotRayOrigin)
                : gunMuzzleWorld
                ? point.distanceTo(gunMuzzleWorld)
                : point.distanceTo(camera.position)) * (worldMetersPerUnit || 1);

            const shellType = shellTypeOf(selectedShell);
            const pen = selectedShell ? (selectedShell.penetration || 0) : 0;
            const dmg = selectedShell ? (selectedShell.damage || 0) : 0;
            const modDmg = selectedShell ? (selectedShell.module_damage || 0) : 0;   // 仅显示用
            const caliber = shooterCaliber || (shooterData && shooterData.caliber) || tankData.caliber || 120;
            const isHE = shellType === 'he';
            const eqCal = !!(document.getElementById('eq-calibrated') && document.getElementById('eq-calibrated').checked);
            const eqEnh = !!(document.getElementById('eq-enhanced') && document.getElementById('eq-enhanced').checked);
            const penDisp = pen * shellPenMul(selectedShell);
            const mpu = worldMetersPerUnit || 1;
            // 每发弹参数（blitzkit：normalization ?? 0；ricochet 仅非 explosive 弹使用）
            const shellNormDeg = (selectedShell && selectedShell.normalization != null) ? selectedShell.normalization : null;
            const shellRicoDeg = (selectedShell && selectedShell.ricochet > 0) ? selectedShell.ricochet : null;

            // blitzkit shoot() 只用 near 穿深（无距离衰减）；dist 仅用于显示
            const req = {
                shell_type: shellType,
                penetration: pen,
                caliber: caliber,
                damage: dmg,
                explosion_radius: isHE ? ((selectedShell && selectedShell.explosion_radius) || 3.0) : 0,
                calibrated_shells: eqCal,
                enhanced_armor: eqEnh,
                normalization_deg: shellNormDeg,
                ricochet_deg: shellRicoDeg,
                allow_ricochet: true,
                view_dir: [viewDir.x, viewDir.y, viewDir.z],
                hits: hitsForCheck.map(ah => {
                    const lp = toLocalPt(ah.point);
                    return {
                        section: ah.section,
                        plate_id: ah.plateId,
                        thickness: ah.thickness,
                        normal: [ah.normal.x, ah.normal.y, ah.normal.z],
                        point: [lp.x * mpu, lp.y * mpu, lp.z * mpu],
                        part_name: ah.partName,
                    };
                }),
            };

            // 判定客户端执行（penetration.js 移植，上游 Rust calculate 同源单测锁定）；
            // wire 形状与 /api/penetrate 响应一致，消费链无感
            judgePenetration(req).then(res => {
                if (penSeq !== __penCheckSeq) return;   // 过期响应：更新位姿的判定已在途，直接丢弃
                let trajLayers = res.layers.map(l => {
                    const ah = hitsForCheck.find(ah => ah.partName === l.part_name);
                    return {
                        point: ah?.point || point,
                        name: l.part_name,
                        thickness: l.thickness,
                        eff: l.effective,
                        remainBefore: l.remaining_before,
                        penetrated: l.penetrated,
                        ricochet: l.ricochet,
                        angle: l.angle_deg != null ? l.angle_deg : null,
                        normal: ah?.normal,
                        seg: 0,
                    };
                });

                if (res.ricochet && res.ricochet_remaining_pen > 0) {
                    const lastLayer = trajLayers[trajLayers.length - 1];
                    if (lastLayer && lastLayer.point) {
                        const shellDir = viewDir.clone().negate(); // incoming shell direction
                        let n = lastLayer.normal;
                        if (!n) {
                            const hitMatch = hitsForCheck.find(ah => ah.point.distanceToSquared(lastLayer.point) < 1e-6);
                            n = hitMatch ? hitMatch.normal : first.normal;
                        }
                        const reflect = shellDir.clone().sub(n.clone().multiplyScalar(2 * shellDir.dot(n))).normalize();
                        // BlitzKit 对齐：出射射线原点=跳弹点、near=0、无近距过滤——接缝处另一侧板
                        // 在厘米级距离，原 +0.05m 偏移 + <0.1m 跳过会把它丢弃 → 续飞穿入车体内部。
                        const rc = new THREE.Raycaster(lastLayer.point, reflect);
                        const ricIntersects = rc.intersectObjects(objects, true);
                        const ricHits = [];
                        for (const hit of ricIntersects) {
                            // 初始接受阈（评审 P1 三路一致）：t ≤ RC.MIN_CONTINUATION_T 一律滤——与 JS
                            // 参考 raycastPackAll 的 tMin、GLSL 的 tStart 同一严格口径（不含推进 eps）
                            if (hit.distance <= RC.MIN_CONTINUATION_T) continue;
                            const entry = classifyHit(hit);
                            if (entry) ricHits.push(entry);
                        }
                        // blitzkit：出射射线（allowRicochet=false）未命中 Primary → shoot 返回
                        // null（无出射段、伤害 0），不进行二次判定
                        const ricHasPrimary = ricHits.some(h => h.section === 'hull' || h.section === 'turret' || h.section === 'gun');
                        if (ricHits.length > 0 && ricHasPrimary) {
                            const ricReq = {
                                shell_type: shellType, penetration: res.ricochet_remaining_pen, caliber: caliber,
                                damage: dmg,
                                enhanced_armor: eqEnh,
                                normalization_deg: shellNormDeg,
                                ricochet_deg: shellRicoDeg,
                                allow_ricochet: false,
                                view_dir: [reflect.x, reflect.y, reflect.z],
                                hits: ricHits.map(ah => ({ section: ah.section, plate_id: ah.plateId, thickness: ah.thickness, normal: [ah.normal.x, ah.normal.y, ah.normal.z], point: [ah.point.x * mpu, ah.point.y * mpu, ah.point.z * mpu], part_name: ah.partName })),
                            };
                            judgePenetration(ricReq)
                                .then(ricRes => {
                                    if (penSeq !== __penCheckSeq) return;   // 过期响应丢弃
                                    if (ricRes) {
                                        const ricLayers = ricRes.layers.map(l => ({ point: ricHits.find(ah => ah.partName === l.part_name)?.point || lastLayer.point, name: l.part_name, thickness: l.thickness, eff: l.effective, remainBefore: l.remaining_before, penetrated: l.penetrated, ricochet: l.ricochet, angle: l.angle_deg != null ? l.angle_deg : null, seg: 1 }));
                                        const combined = { result: 'RICOCHET → ' + ricRes.result, total_effective: res.total_effective, layers: [...trajLayers, ...ricLayers] };
                                        showTrajectory(point, combined.result, combined.total_effective, combined.layers, penDisp, dmg, modDmg, dist, shotRayO, (ricRes && ricRes.damage) || 0);
                                    } else { showTrajectory(point, res.result, res.total_effective, trajLayers, penDisp, dmg, modDmg, dist, shotRayO, res.damage || 0); }
                                }).catch(() => { showTrajectory(point, res.result, res.total_effective, trajLayers, penDisp, dmg, modDmg, dist, shotRayO, res.damage || 0); });
                            return;
                        }
                    }
                }

                showTrajectory(point, res.result, res.total_effective, trajLayers, penDisp, dmg, modDmg, dist, shotRayO, res.damage || 0);
            }).catch(err => {
                if (penSeq !== __penCheckSeq) return;   // 过期请求的失败不覆盖最新结果
                console.error('Penetration API error:', err);
                showTrajectory(point, 'ERROR', 0, [], penDisp, dmg, modDmg, dist, shotRayO, 0);
            });
        }


        let trajGroup = null;
        let trajInfoPos = null;
        function showTrajectory(firstPoint, result, totalEff, layers, penVal, dmgVal, modDmgVal, distVal, trajOrigin, dmgDealt) {
            // world 复现模式：本地内核预测 vs 服务器判定（method38 位图 + game_hit_result）
            if (window.__worldPenMode && window.__worldServerInfo) {
                const el = document.getElementById('world-pen-cmp');
                if (el) {
                    const srv = window.__worldServerInfo;
                    // 服务器等价类：跳弹↔RICOCHET；击穿/HE↔PENETRATION；未穿/间隙止↔BLOCKED
                    const srvEq = srv.cls === 'RICOCHET' ? 'RICOCHET'
                        : (srv.cls === 'PENETRATION' || srv.cls === 'HE BLAST') ? 'PENETRATION'
                        : (srv.cls === 'MISS' ? 'MISS' : 'BLOCKED');
                    // 本地预测等价类：HE 爆炸有伤害内核报 PENETRATION；HE 被装甲挡住报 BLOCKED
                    const locEq = result === 'RICOCHET' ? 'RICOCHET'
                        : result === 'PENETRATION' ? 'PENETRATION'
                        : (result === 'BLOCKED' || result === 'ERROR') ? 'BLOCKED' : 'OTHER';
                    const agree = srvEq !== 'MISS' && locEq !== 'OTHER' && srvEq === locEq;
                    const RES_TXT2 = {0:'无结果',1:'未击穿',2:'间隙止',3:'有伤害',4:'跳弹'};
                    el.innerHTML = '<span style="color:' + (agree ? '#5fbf7a' : '#ff6b6b') + ';">'
                        + (agree ? '✓ 一致' : '✗ 不一致') + '</span>'
                        + ' · 本地: ' + result
                        + ' · 服务器: ' + srv.cls
                        + (typeof srv.result === 'number' && srv.result !== 255
                            ? ' (' + (RES_TXT2[srv.result] || srv.result) + ')' : '');
                }
            }
            if (trajGroup) scene.remove(trajGroup);
            trajGroup = new THREE.Group();

            // 轨迹颜色按【最终能否击穿】染色(用户要求):最终击穿=绿,未穿=红,
            // 跳弹但未击穿=橙。复合结果('RICOCHET → PENETRATION' 等)取末段判定。
            const finalOutcome = result.split('→').pop().trim();
            const color = finalOutcome === 'PENETRATION' ? 0x4CAF50
                : (finalOutcome === 'RICOCHET' ? 0xFF8800
                : (finalOutcome === 'BLOCKED' || finalOutcome === 'ERROR' ? 0xf44336 : 0xff8800));
            const camDir = camera.position.clone().sub(firstPoint).normalize();

            // 轨迹管原点：调用方传入的弹道起点（如炮口）优先；否则沿视线反向
            // 长距离回退（300m），入射弹向一眼可见（原 15m 太短——用户反馈）
            const origin = trajOrigin || firstPoint.clone().add(camDir.clone().multiplyScalar(300));
            const trajMat = new THREE.MeshBasicMaterial({ color: color, depthTest: false, transparent: true, opacity: 0.85 });

            const ricLayer = layers.find(l => l.ricochet);
            const ricPoint = ricLayer ? ricLayer.point : null;

            const incoming = [origin];
            for (const l of layers) {
                incoming.push(l.point);
                if (l.ricochet) break; // stop at ricochet point
            }
            if (incoming.length >= 2) {
                const curve = new THREE.CatmullRomCurve3(incoming, false, 'catmullrom', 0);
                const geo = new THREE.TubeGeometry(curve, Math.max(2, incoming.length * 2), 0.025, 8, false);
                const mesh = new THREE.Mesh(geo, trajMat);
                mesh.renderOrder = 999;
                trajGroup.add(mesh);
            }

            const reflected = [];
            let sawRicPoint = false;
            for (const l of layers) {
                if (l.ricochet) { sawRicPoint = true; reflected.push(l.point); continue; }
                if (l.seg === 1) {
                    if (!sawRicPoint) { reflected.push(ricPoint); sawRicPoint = true; }
                    reflected.push(l.point);
                }
            }
            if (sawRicPoint && reflected.length >= 2) {
                const curve = new THREE.CatmullRomCurve3(reflected, false, 'catmullrom', 0);
                const geo = new THREE.TubeGeometry(curve, Math.max(2, reflected.length * 2), 0.025, 8, false);
                const mesh = new THREE.Mesh(geo, trajMat);
                mesh.renderOrder = 999;
                trajGroup.add(mesh);
            }

            for (let i = 0; i < layers.length; i++) {
                const l = layers[i];
                const pColor = l.penetrated ? 0x4CAF50 : (l.ricochet ? 0xFF8800 : 0xf44336);

                const dotGeo = new THREE.SphereGeometry(0.04, 8, 8);
                const dotMat = new THREE.MeshBasicMaterial({ color: pColor, depthTest: false, transparent: true, opacity: 0.95 });
                const dotMesh = new THREE.Mesh(dotGeo, dotMat);
                dotMesh.position.copy(l.point);
                dotMesh.renderOrder = 999;
                trajGroup.add(dotMesh);
            }

            const lastPt = layers.length > 0 ? layers[layers.length - 1].point : firstPoint;
            trajInfoPos = lastPt.clone();
            const div = document.getElementById('traj-info');
            // ===== 结果面板（对照 BlitzKit ShotDisplayCard）=====
            // 结构：状态+伤害标题（按状态着色）→ 逐层行（主/间隙=等效@角度+名义厚度、
            // 外部模块=flat 厚度、HEAT 间隙=距离+穿深损耗）；跳弹时中间分隔「-25% 穿深」
            // 再出第二段标题。无 Dist / Remain / 汇总行（BlitzKit 卡片不展示这些）。
            const ST_COLOR = {
                PENETRATION: 'var(--green)', BLOCKED: 'var(--red)', RICOCHET: 'var(--orange)',
                SPLASH: 'var(--orange)', ERROR: 'var(--red)',
            };
            const stColor = (st) => ST_COLOR[st] || 'var(--orange)';
            const fmtNum = (v) => {
                const r = Math.round(v);
                return Math.abs(r - v) < 0.05 ? String(r) : (Math.round(v * 10) / 10).toFixed(1);
            };
            const segments = result.split('→').map(x => x.trim()).filter(Boolean);
            const colorHex = '#' + color.toString(16).padStart(6, '0');
            let html = `<div style="background:var(--tooltip-bg);border-radius:10px;border-left:4px solid ${colorHex};padding:10px 16px;font-family:'Segoe UI',sans-serif;white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,0.5);">`;
            const titleHtml = (st) => {
                const d = (typeof dmgDealt === 'number') ? dmgDealt : 0;
                return `<div style="font-size:18px;font-weight:bold;color:${stColor(st)};margin-bottom:4px;">${st}${d > 0 ? ` <span style="font-size:13px;font-weight:normal;color:var(--muted);">· ${L.shotDamage} ${Math.round(d)}</span>` : ''}</div>`;
            };
            html += titleHtml(segments[0]);
            let layerNo = 0;
            let outStarted = false;
            for (let i = 0; i < layers.length; i++) {
                const l = layers[i];
                // 跳弹分段：出射段首层前插分隔线+第二段标题（BlitzKit "ricochet (-25% penetration)"）
                if (segments.length > 1 && l.seg === 1 && !outStarted) {
                    outStarted = true;
                    html += `<div style="display:flex;align-items:center;gap:8px;margin:6px 0;">`;
                    html += `<span style="flex:1;border-top:1px solid var(--border);"></span>`;
                    html += `<span style="font-size:11px;color:var(--muted);">${L.shotRicochetSeg}</span>`;
                    html += `<span style="flex:1;border-top:1px solid var(--border);"></span></div>`;
                    html += titleHtml(segments[segments.length - 1]);
                }
                const pc = l.penetrated ? 'var(--green)' : (l.ricochet ? 'var(--orange)' : 'var(--red)');
                const th = Number(l.thickness);
                const isGap = /^Gap /.test(l.name || '');
                let main, sub;
                if (isGap) {
                    // HEAT 间隙层：距离（mm）+ 跳弹损耗（BlitzKit：max(-100, -50×距离米)）
                    const distM = parseFloat((l.name || '').slice(4)) || 0;
                    main = `${Math.round(distM * 1000)}mm`;
                    sub = `${L.shotLoss} ${Math.max(-100, -50 * distM).toFixed(0)}%`;
                } else if (l.eff != null && l.eff > 0 && l.angle != null) {
                    // 主/间隙装甲：等效厚度 @ 入射角 + 名义厚度（BlitzKit thickness_and_angle + nominal）
                    main = `${fmtNum(l.eff)}mm @ ${Math.round(l.angle)}°`;
                    sub = `${L.shotNominal} ${fmtNum(th)}mm`;
                } else if (l.angle != null) {
                    // 跳弹层：等效为 0，显示名义厚度 @ 角度
                    main = `${fmtNum(th)}mm @ ${Math.round(l.angle)}°`;
                    sub = L.shotRicochetSeg;
                } else {
                    // 外部模块：flat 厚度（BlitzKit External 只显示厚度）
                    main = `${fmtNum(th)}mm`;
                    sub = l.penetrated ? '' : L.shotBlocked;
                }
                const idx = isGap ? '' : `${++layerNo}.`;
                html += `<div style="font-size:13px;line-height:20px;">`;
                html += `<span style="display:inline-block;width:14px;color:${pc};">●</span>`;
                html += `<span style="color:var(--muted);display:inline-block;min-width:20px;">${idx}</span>`;
                html += `<span style="color:var(--txt);">${l.name}</span>`;
                html += `<span style="color:${pc};margin-left:14px;">${main}</span>`;
                if (sub) html += `<span style="color:var(--muted);margin-left:14px;">${sub}</span>`;
                html += `</div>`;
            }
            html += `</div>`;
            div.innerHTML = html;
            // 轨迹线与轨迹面板无条件展示(用户要求:与正常点击判定一致的轨迹展示)
            updateTrajInfoPos();
            scene.add(trajGroup);
        }

        function updateTrajInfoPos() {
            if (!trajInfoPos) { document.getElementById('traj-info').style.display = 'none'; return; }
            const v = trajInfoPos.clone().project(camera);
            const x = (v.x * 0.5 + 0.5) * window.innerWidth;
            const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
            const div = document.getElementById('traj-info');
            if (v.z > 1) { div.style.display = 'none'; return; }
            const offX = 0, offY = 160;
            let px = x + offX, py = y + offY;
            div.style.display = 'block';   // 先显示才能量取实际尺寸
            const w = div.offsetWidth || 300, h = div.offsetHeight || 90;
            // 视口钳制（translateX(-50%)：left 是面板中心 x）
            const clampX = (v2) => Math.max(w / 2 + 10, Math.min(window.innerWidth - w / 2 - 10, v2));
            const clampY = (v2) => Math.max(10, Math.min(window.innerHeight - h - 10, v2));
            px = clampX(px); py = clampY(py);
            // 固定 UI 避让：不压四角与顶部信息面板（左下信息/右下按钮提示/右上栈/左上排）
            const blockers = [];
            const tc = document.getElementById('turret-controls');
            if (tc && tc.style.display !== 'none') blockers.push(tc.getBoundingClientRect());
            const addRect = (id) => {
                const el = document.getElementById(id);
                if (el) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) blockers.push(r); }
            };
            addRect('corner-br'); addRect('corner-tr'); addRect('info-panel'); addRect('tank-selectors');
            for (const r of blockers) {
                if (r.width === 0 || r.height === 0) continue;
                const l = px - w / 2, t = py, rr = l + w, b = t + h;
                if (l >= r.right || rr <= r.left || t >= r.bottom || b <= r.top) continue;
                // 首选：整体上移到面板上方；顶部放不下再水平平移到面板侧边
                if (r.top - h - 12 >= 10) { py = clampY(r.top - h - 12); continue; }
                px = clampX(px < (r.left + r.right) / 2 ? r.left - w / 2 - 12 : r.right + w / 2 + 12);
            }
            div.style.transform = 'translateX(-50%)';
            div.style.left = px + 'px';
            div.style.top = py + 'px';
        }

        // 相机运动追踪（门禁用）：OrbitControls 的 damping 让相机在拖动/捏合结束后继续滑行
        // 若干帧——慢渲染（CI 无 GPU）时这段滑行会持续数秒。门禁"按像素采样部位 → 按下"
        // 之间相机若仍在滑行，采样时的分类与按下时的分类就会不一致（同一像素从 turret
        // 滑成 hull/背景），断言随机翻车。暴露「上次相机移动距今多久 + 帧间隔」，让门禁
        // 等到视图真正静止再采样（等状态，不等时钟）。
        let cameraMovedAt = 0;
        let lastCameraPos = null;   // null = 首帧（NaN 比较恒为 false，会把移动检测永远锁死）
        let lastFrameAt = 0;
        let frameIntervalMs = 16;
        function trackCameraMotion() {
            const now = performance.now();
            if (lastFrameAt) frameIntervalMs = frameIntervalMs * 0.8 + (now - lastFrameAt) * 0.2;
            lastFrameAt = now;
            if (!lastCameraPos) {
                lastCameraPos = camera.position.clone();
                cameraMovedAt = now;
                return;
            }
            if (camera.position.distanceToSquared(lastCameraPos) > 1e-10) {   // > 0.01mm
                lastCameraPos.copy(camera.position);
                cameraMovedAt = now;
            }
        }

        function animate() {
            if (destroyed) return;
            hookRcClickRecorder();   // 探针监听惰性挂载（首帧 renderer 就绪）
            rafId = requestAnimationFrame(animate);
            controls.update();
            trackCameraMotion();
            if (penetrationMode && armorModel) {
                if (SESS && heatFrames < 5) {
                    heatFrames++;   // 就绪门控计数保留（上游语义）；上报端点已随 client-only 移除
                }
                renderSpacedArmorPass();
                // 全分辨率逐像素续飞（v5.3）：姿态变化时重建世界网格（相机移动无需重建）
                if (ricochetPoseDirty && ricochetPack) {
                    rebuildRicochetGrid();
                    const sh0 = selectedShell || (shooterShells[0]) || null;
                    if (sh0) syncRicochetEnabled(sh0);
                }
                renderer.render(scene, camera);                       // 背景/网格（autoClear 已置 false）
                renderer.clearDepth();                                 // 清除深度，让 exclude 深度遮罩生效
                if (primaryArmorScene) { syncCloneMatrices(primaryArmorScene); renderer.render(primaryArmorScene, camera); }
            } else {
                renderer.render(scene, camera);
            }
            if (trajInfoPos) updateTrajInfoPos();
        }

        /// 路由离开清理：停 rAF、摘 window 监听、释放控制器与 WebGL 上下文。
        /// canvas 由 ArmorView 的容器 DOM 一并移除，这里只处理 JS 侧句柄。
        function destroy() {
            destroyed = true;
            targetLoadGen++; // invalidate in-flight target JSON before it can mutate the destroyed/current viewer
            loadGen++;   // invalidate any in-flight GLTF callbacks before releasing the live scene
            resetViewerGlobals();
            cancelAnimationFrame(rafId);
            while (cleanups.length) { try { cleanups.pop()(); } catch (_) {} }
            try { if (controls) controls.dispose(); } catch (_) {}
            if (renderer) {
                try { renderer.dispose(); } catch (_) {}
                try { renderer.forceContextLoss(); } catch (_) {}
                if (renderer.domElement && renderer.domElement.parentNode) {
                    renderer.domElement.parentNode.removeChild(renderer.domElement);
                }
            }
        }

        init().catch((e) => {
            console.error('tank viewer init failed:', e);
            reportLoad({ state: 'error', message: loadFailed(initDone ? 'tank data' : 'tank list', errorMessage(e)) });
        });
        return { destroy, retry };
    }
