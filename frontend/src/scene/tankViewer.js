// 3D 装甲检视器：viewer.rs 嵌入 INDEX_HTML 的模块脚本整体抽取平移（含另一会话新增的
// 配件自动判定逻辑），除包一层 initTankViewer() 外一行未改。
// 数据面（WotBTools 增量）：tank 数据/名册/弹表/GLB/封面/射击数据经 agentData.ts
// 资产面优先 + /api 回退；击穿判定为 penetration.js 客户端移植（上游 Rust 单测同源）。
// /api/hold、/api/ready 保留（Agent 自托管无头截图链专用，静态面缺席时静默无操作）。
// 初始车辆/射手经 options.initialTankId / initialShooterId 显式传入（ArmorView 从路由
// 参数解析后注入；2026-10-24 起替代 window.__INITIAL_TANK__ / __INITIAL_SHOOTER__ 全局）。
// 加载状态（审计 3D-23）：options.onLoadState 收到 { state: 'loading'|'ready'|'error', progress, message }，
// 宿主页据此显示进度条 / 失败重试；返回的 retry() 重新加载当前目标坦克。
// 生命周期：返回 { destroy, retry, selectTank, canPick }——SPA 路由离开时必须调用（ArmorView onBeforeUnmount）：
// 取消 rAF 循环、摘除 window 监听器、释放 WebGL 上下文；不调用则多次进出路由会
// 耗尽浏览器 WebGL 上下文上限（~16 个）出现"context lost"黑屏。selectTank/canPick 供宿主页的
// 共享选车菜单（TankCatalogMenu）加载射手/目标；名册与当前选择经 onTankList/onTankSelection 回调。
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { pitchAtBearing, resolvePitchCheckboxChecked } from '../replay-local/compute/tankSetup'
import { normalizeTankCache } from '../utils/tankopediaQuery.js'
import { createLoadProgress } from './loadProgress.js'
import { shotBallisticLength } from './agentData.js'
import {
    plateThickness,
    applyArmorConfigVisible as applyArmorPrefixVisibility,
} from './viewer/armorPlateModel.js'
import { replaceArmorMaterial } from './viewer/armorMeshState.js'
import { defaultStateId } from '../data/armorStates.js'
// URL 契约基线（urlContract.test.js）经此 re-export；实现 owner = viewer/viewerMath.js
export { dollyZoomFov, mirrorShotData } from './viewer/viewerMath.js'
import { dollyZoomFov } from './viewer/viewerMath.js'
import { armorCameraPreset, armorPresetGunPitch, armorPresetViewPlacement } from './viewer/cameraPresets.js'
import { createTurretRig } from './viewer/turretRig.js'
import { createModelLifecycle } from './viewer/modelLifecycle.js'
import { createHeatmapPipeline } from './viewer/heatmap.js'
import { createTrajectoryCard } from './viewer/trajectoryCard.js'
import { createDebugUi } from './viewer/debugUi.js'
import { createEquipmentState } from './viewer/equipmentState.js'
import { createCollisionView } from './viewer/collisionView.js'
import { createJudgment } from './viewer/judgment.js'
import { createDiagnosticProbe } from './viewer/diagnosticProbe.js'
import { runShotReplay } from './viewer/shotReplay.js'
import { createAimInput } from './viewer/aimInput.js'
import { createDataLoader } from './viewer/dataLoader.js'

/**
 * @param {object} [options]
 * @param {object} [options.labels] 界面文案（审计 3D-16：由宿主页按当前语言提供；缺省为英文原文）
 * @param {(state: { state: string, progress?: number | null, message?: string }) => void} [options.onLoadState]
 * @param {(list: Array) => void} [options.onTankList] 名册视图模型（normalizeTankCache）就绪
 * @param {(selection: { shooter: number|null, target: number|null }) => void} [options.onTankSelection] 当前射手/目标变化
 * @param {(index: number) => void} [options.onConfigSelection] 原生配置下拉切换目标配置（宿主写回 URL）
 * @param {(index: number) => void} [options.onShellSelection] 原生弹种下拉切换（宿主写回 URL）
 * @param {(kind: 'calibrated'|'enhanced', value: boolean) => void} [options.onEquipmentSelection] 原生装备勾选切换（宿主写回 URL）
 */
/**
 * 场景脚本把射击复现 / 调试状态挂在 window 上（__worldPan、__shotCtx…）。以前每次都在新窗口里打开，
 * 现在同一标签页内反复进出，残留状态会让下一辆坦克的炮塔转不动、镜头被锁——初始化与销毁时统一清掉。
 * 宿主传入的 options（含 initialTankId / initialShooterId）不在此列。
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

/**
 * dolly-zoom FOV（纯函数，内核与单测共用）。
 * enabled 时按 k=d/refDist 缩放：d<refDist 时 FOV 变宽，车体屏幕尺寸保持 refDist 处比例；
 * farProductGain/farProductMax 可选：product = baseProduct + max(0,d-refDist)×gain，封顶 max；
 * product 随距离增大 → 远距车体略小（Armor Inspector 实测标定）。enabled=false 恒原生。
 * productScale 可选：整体放大 product（车体屏幕尺寸按 1/scale 缩小），默认 1；
 * 用于查看器的显示缩放，不改变距离曲线形状。maxFovDeg 封顶近距，minFovDeg 封顶远距——
 * 两车 world 总览必须传 false，否则会把远距受击车裁出视锥。
 */
/**
 * 世界镜像校正（数据入口一次性变换：x/yaw/roll 取反）。
 * 回放坐标系(BigWorld)与 three.js 右手系在水平面上手性相反：直接渲染左右舷互换。
 * 镜像 = x 取反、yaw/roll 取反（pitch 不变——绕 x 轴旋转在 x 镜像下不变），
 * 模型网格不动，经共轭旋转自动呈正确手性。
 *
 * 纯数据变换（无闭包依赖），导出供单测做**镜像不变性**回归：弹道折线
 * ball_a + via[] + ball_b 必须整链同变——只镜像端点会把镜像后的端点与原坐标系
 * 中间点混算（review 2026-10-13：1615 第 3 发 405.959668m 被算成 497.83m，
 * 衰减后基础穿深少 3.16mm；点击距离与热力图距离共用该长度源）。
 */
export function initTankViewer({ labels = {}, onLoadState = null, onTankList = null, onTankSelection = null, onConfigSelection = null, onShellSelection = null, onEquipmentSelection = null, onDistanceChange = null, initialTankId = null, initialShooterId = null, pitchDeviceBonus = null, pitchDeviceAvailable: initialPitchDeviceAvailable = false } = {}) {
        resetViewerGlobals();
        const QP = new URLSearchParams(location.search);
        const shotMode = QP.has('shot');
        // XI 升级态与模块配置一样按双方独立读取；同车也不从目标推导射手状态。
        // custom（部分研发）必须原样透传：折叠成 top 会把未研发节点的加成也画上去，
        // 折叠成 stock 会丢掉已研发效果。
        const upgradeOptions = (side) => {
            const rawUpgrade = QP.get(side === 'shooter' ? 'supgrade' : 'upgrade');
            const explicit = rawUpgrade === 'top' ? 'top'
                : rawUpgrade === 'stock' ? 'stock'
                    : rawUpgrade === 'custom' ? 'custom' : undefined;
            return {
                // 普通装甲检视缺省 XI 顶级；射击复现没有升级态证据时不得补成满级，
                // 只有显式 &upgrade=top / &supgrade=top 才是 what-if。
                upgrade: explicit ?? (shotMode ? undefined : 'top'),
                abilities: QP.get(side === 'shooter' ? 'sabilities' : 'abilities'),
            };
        };
        const L = {
            loading: 'Loading tank model...',
            shellUnavailable: 'Shell data is missing or invalid.',
            loadFailed: (phase, msg) => 'Failed to load ' + phase + ': ' + msg,
            contextLost: '3D rendering context was lost (GPU/driver reset). Please retry.',
            type: (value) => value,
            nation: (value) => value,
            showCollision: 'Show Collision',
            hideCollision: 'Hide Collision',
            partName: (name) => name, resultName: (result) => result,
            shotDamage: 'damage',
            shotRicochetSeg: 'ricochet (-25% penetration)',
            shotLoss: 'loss',
            shotNominal: 'nominal',
            shotBlocked: 'blocked',
            shotDistance: 'Engagement distance', distanceUnit: 'm',
            effectivePenetration: 'effective penetration',
            shotMinDamage: 'min damage', shotMaxDamage: 'max damage', shotAvgDamage: 'avg damage', shotAvgShort: 'avg',
            shotPenChance: 'penetration chance', shotPenDamage: 'penetration damage',
            shotSplashDamage: 'splash damage', heRadius: 'splash radius', heBestSample: 'best sample',
            directHit: 'direct hit', expectedDamage: 'expected damage',
            heSamplingUnavailable: 'splash sampling unavailable',
            noPrimaryBlocked: 'No primary armor hit; treated as non-penetration',
            heBestSampleUpper: 'best sample (upper)', heBestSampleLower: 'best sample (lower)',
            sectionName: (section) => section,
            mayPenetrate: 'May penetrate',
            heatmap: 'Penetration map', hideHeatmap: 'Hide penetration map',
            technicalEvidence: 'Technical evidence', shotView: 'Shot view', relativeView: 'Impact view', worldView: 'Overview',
            phase: (phase) => phase,   // 加载阶段名（armor model / tank model / tank data / tank list）
            armorStateCheckbox: 'Dynamic armor',
            armorStateAutoTitle: 'Replay-detected (armor state at impact)',
            // 122 装备徽标（射击诊断面板）：不得硬编码文案，宿主经 labels 传三语。
            pitchDevice: 'Improved Vertical Stabilizer',
            // Type5 配件串回放判定来源提示（勾选框禁用时的 tooltip）：同不得硬编码。
            replayEquipmentAutoTitle: 'Replay-detected (Type5 equipment)',
            ...labels,
        };
        const loadFailed = (phase, msg) => L.loadFailed(L.phase(phase), msg);

        // Armor Inspector 单车装甲检视实测参考（PC T-34，2026-10-18）：
        // 默认 15m/18.75°，FOV 最大 40°（约 6.5m 处封顶）；实测 product 从 15m 的
        // ≈2.477 按 +0.0128/m 缓慢增大、封顶 2.8。用户 2026-10-19 要求车体随距离
        // 缩放更明显：显示 profile 改用 +0.028/m、封顶 3.8（再乘 1.1 整体缩放），
        // 15m 基准不变；30m 约小 14%，100m/500m 约小 35%（实测参考仍保留在上面的注释）。
        // near=0.05d / far=d+30；相机距离沿用查看器 3–500m。
        // shot replay 与装甲检视共用这套显示 profile；两车 world overview 保持原生 50° 取景。
        const ARMOR_REF_DIST = 15;
        const ARMOR_BASE_FOV = 18.75;
        const ARMOR_MAX_FOV = 40;
        const ARMOR_MIN_FOV = 0.5;
        const ARMOR_FAR_PRODUCT_GAIN = 0.028;
        const ARMOR_FAR_PRODUCT_MAX = 3.8;
        const ARMOR_PRODUCT_SCALE = 1.1;
        const OVERVIEW_BASE_FOV = 50;

        // window 级监听统一经 onWin 登记，destroy 时成对摘除
        const escapeText = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
        const cleanups = [];
        let rafId = 0;
        let destroyed = false;   // destroy 后迟到的 init/ animate 不再启动渲染
        let contextLost = false; // WebGL 上下文丢失后 retry 必须重建 renderer，而不是只 reload 数据
        let gpuLabel = '';       // 上下文丢失诊断：UNMASKED_RENDERER_WEBGL / RENDERER
        // Navigation between shots replaces the scene before delayed shell/trajectory work can finish.
        const pendingTimers = new Set();
        const setTimeout = (callback, delay) => {
            const timer = globalThis.setTimeout(() => {
                pendingTimers.delete(timer);
                if (!destroyed) callback();
            }, delay);
            pendingTimers.add(timer);
            return timer;
        };
        cleanups.push(() => { pendingTimers.forEach(globalThis.clearTimeout); pendingTimers.clear(); });
        let initPhase = 'tank list';
        // 加载状态上报（宿主页进度条 / 错误态）；宿主回调异常不影响场景
        const reportLoad = (state) => {
            if (destroyed || typeof onLoadState !== 'function') return;
            // Context loss 后所有 load/ready 上报都必须让位于错误态；只有带 contextLost
            // 标记的错误本身可以写入，否则 in-flight GLTF/modelProgress 回调会把错误卡
            // 覆盖成 loading/ready，retry 入口消失。
            if (contextLost && !(state && state.contextLost)) return;
            try { onLoadState(state); } catch (_) {}
        };
        const errorMessage = (error) => (typeof error === 'string') ? error
            : (error && (error.message || error.statusText || String(error))) || 'unknown';
        const contextLostMessage = () => gpuLabel ? `${L.contextLost} (${gpuLabel})` : L.contextLost;
        function reportContextLost(event) {
            if (event && typeof event.preventDefault === 'function') event.preventDefault();
            if (destroyed) return;
            contextLost = true;
            // 让所有 in-flight 资产/目标加载 continuation 失效，避免它们在错误态之后
            // 继续写 loading/ready 或启动渲染。
            loadGen++;
            targetLoadGen++;
            dl.bumpShooterLoadGen();
            if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
            reportLoad({ state: 'error', message: contextLostMessage(), contextLost: true });
        }
        function reportContextRestored() {
            // 浏览器允许恢复上下文，但 Three.js 的 GPU 资源已失效；保持错误态，由宿主
            // “重试”销毁并重新创建整个 renderer，不在这里重建半套 GL 资源。
            if (!destroyed && contextLost) reportLoad({ state: 'error', message: contextLostMessage(), contextLost: true });
        }
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
        // 点击判定特效（轨迹/命中标记/溅射半径球）独立场景：见 renderFxPass()。
        let fxScene = null;
        let raycaster, mouse;
        let tankData;   // tankData = target tank (model/armor/info)；tankModel/armorModel owner = modelLifecycle
        
        // 口径不再预置默认值：判定必须用实际数据（配置/弹体/坦克），缺失即报错。
        // shooterShells/shooterCaliber owner = dataLoader；selectedShell 为判定当前弹。
        let selectedShell = null;
        let penetrationMode = false;   // 实时穿透热力图模式开关（animate/切弹/按钮共用）
        // 射击复现 world 总览（命中/脱靶【同置】）——dolly-zoom 补偿的门控。
        // 不能复用 __worldPenMode：它只在命中路径置位（脱靶在弹道标注后提前返回），
        // 且还兼管判定坐标转换（review 2026-10-13：脱靶回放曾误套单车补偿致落点裁出视锥）。
        let worldOverviewMode = false;
        let collisionMode = false;     // 碰撞模型显示开关（按钮与热力图退出恢复共用）
                // 炮塔/炮管 rig：枢轴、姿态表与 gun 裁切姿态矩阵的唯一 owner（#820 Agent A 出仓）
        const rig = createTurretRig({
            getTankModel: () => ml.models.tankModel,
            getArmorModel: () => ml.models.armorModel,
            getTankData: () => tankData,
            getConfig: () => currentConfig(),
            updateCollisionWorldMatrices: () => hm.updateCollisionWorldMatrices(),
            getCollisionMode: () => collisionMode,
            computeGunClipPlane: () => hm.computeGunClipPlane(),
            syncModuleClipPlanes: () => cvs.syncModuleClipPlanes(),
            invalidateRicochetPose: () => hm.invalidateRicochetPose(),
        });
        // 模型/资源生命周期：tankModel/armorModel 引用与 GLB 装载的唯一 owner（#820 Agent A 出仓）
        const clearTrajectory = () => tc.clearTrajGroup();
        const ml = createModelLifecycle({
            rig,
            isDestroyed: () => destroyed,
            isContextLost: () => contextLost,
            loadGen: { get: () => loadGen, bump: () => ++loadGen },
            modelProgress,
            reportLoad,
            errorMessage,
            L_loading: L.loading,
            loadFailed,
            getTankData: () => tankData,
            getCurrentConfigIdx: () => dl.getCurrentConfigIdx(),
            getScene: () => scene,
            getControls: () => controls,
            getFxScene: () => fxScene,
            getQP: () => QP,
            getPlateThickness,
            getCurrentConfig: () => currentConfig(),
            applyConfig: (...a) => dl.applyConfig(...a),
            applyArmorStateToModel: () => cvs.applyArmorStateToModel(),
            applyUrlOptionsOnce,
            clearTrajectory,
            clearHeBlast: () => hm.clearHeBlast(),
            disposePenetrationResources: () => hm.disposePenetrationResources(),
            clearHighlight: () => { cvs.setHighlightedArmorNode(null); },
            releaseModuleMaterialCaches: () => cvs.releaseModuleMaterialCaches(),
        });
        ml.setArmorModelResolver(() => models.armorModel);
        const { models } = ml;
        // 穿透热力图/装甲渲染管线：RT、间隙甲场景、跳弹网格与 HE 可视化的唯一 owner（#820 Agent A 出仓）
        const hm = createHeatmapPipeline({
            models,
            rig,
            getWorldMetersPerUnit: () => ml.getWorldMetersPerUnit(),
            getModuleMeshes: () => ml.getModuleMeshes(),
            getRenderer: () => renderer,
            getCamera: () => camera,
            getTankData: () => tankData,
            getCurrentConfig: () => currentConfig(),
            getActiveGunNumber: (...a) => activeGunNumber(...a),
            getSelectedShell: () => selectedShell,
            getShooterShells: () => dl.getShooterShells(),
            getPenetrationMode: () => penetrationMode,
            getCollisionMode: () => collisionMode,
            equipmentCoeffs: (...a) => eqs.equipmentCoeffs(...a),
            resolveCaliberFor: (...a) => jc.resolveCaliberFor(...a),
            applyArmorViewStyle: (...a) => cvs.applyArmorViewStyle(...a),
            getFxScene: () => fxScene,
            getScene: () => scene,
            applyCategoryFilters: (...a) => cvs.applyCategoryFilters(...a),
        });
        // 装备判定状态：校准弹/强化装甲/122 的唯一 owner（#820 Agent A 出仓）
        const eqs = createEquipmentState({
            hmRef: () => hm,
            jcRef: () => jc,
            isDestroyed: () => destroyed,
            getCurrentTargetId: () => dl.getCurrentTargetId(),
            getSelectedShell: () => selectedShell,
            getShooterShells: () => dl.getShooterShells(),
            pitchDeviceBonus,
            pitchDeviceAvailable: initialPitchDeviceAvailable,
            L,
        });
        // 碰撞（厚度）视图 + 动态装甲状态：视图样式与状态机的唯一 owner（#820 Agent A 出仓）
        const cvs = createCollisionView({
            models,
            ml,
            getModuleMeshes: () => ml.getModuleMeshes(),
            hmRef: () => hm,
            rig,
            getRenderer: () => renderer,
            getTankData: () => tankData,
            getCurrentConfig: () => currentConfig(),
            getActiveGunNumber: (...a) => activeGunNumber(...a),
            getPenetrationMode: () => penetrationMode,
            getCollisionMode: () => collisionMode,
            getPlateThickness,
            thicknessToColor,
            isEffectivelyVisible: (...a) => jc.isEffectivelyVisible(...a),
        });
        // 数据装载与选车/配置编排（#820 Agent A 出仓）
        const dl = createDataLoader({
            ml, rig, hmRef: () => hm, tcRef: () => tc, jcRef: () => jc, cvsRef: () => cvs,
            targetLoadGen: { get: () => targetLoadGen, bump: () => ++targetLoadGen },
            loadGen: { get: () => loadGen, bump: () => ++loadGen },
            isDestroyed: () => destroyed,
            isContextLost: () => contextLost,
            getTankData: () => tankData,
            setTankData: (d) => { tankData = d; },
            setShooterData: (d) => { shooterData = d; },
            getSelectedShell: () => selectedShell,
            setSelectedShell: (sh) => { selectedShell = sh; },
            getShooterData: () => dl.getShooterData(),
            reportLoad,
            loadFailed,
            errorMessage,
            rerunAuthoritativeShotCheck: () => rerunAuthoritativeShotCheck(),
            requestedShellIndex,
            isShotReplay: () => !!QP.get('shot'),
            L,
            QP,
            onTankList,
            onTankSelection,
            getFxScene: () => fxScene,
            eqsRef: () => eqs,
            getPenetrationMode: () => penetrationMode,
            getCollisionMode: () => collisionMode,
            getCurrentConfig: () => currentConfig(),
            getUpgradeOptions: upgradeOptions,
            getUrlApplied: () => urlApplied,
            setUrlApplied: (v) => { urlApplied = v; },
            getTurretDeg: () => currentTurretDeg,
            getGunDeg: () => currentGunDeg,
        });
        // 调试/诊断 UI：错误条 + 技术证据窗口（#820 Agent A 出仓）
        const du = createDebugUi({
            L,
            escapeText,
            isDestroyed: () => destroyed,
            getCurrentTargetId: () => dl.getCurrentTargetId(),
        });
        // 轨迹/结果卡：trajGroup 与卡片摆位的唯一 owner（#820 Agent A 出仓）
        const tc = createTrajectoryCard({
            isDestroyed: () => destroyed,
            clearShotError: du.clearShotError,
            clearHeBlast: () => hm.clearHeBlast(),
            getFxScene: () => fxScene,
            getCamera: () => camera,
            L,
            armorDebug: () => ARMOR_DEBUG,
        });
        // 射击判定链：点击判定、命中分类、判定请求组装的唯一 owner（#820 Agent A 出仓）
        const jc = createJudgment({
            models,
            hm,
            tc,
            cvs,
            getRenderer: () => renderer,
            getCamera: () => camera,
            getControls: () => controls,
            getFxScene: () => fxScene,
            getRaycaster: () => raycaster,
            getMouse: () => mouse,
            getTankData: () => tankData,
            getCurrentConfig: () => currentConfig(),
            getActiveGunNumber: (...a) => activeGunNumber(...a),
            getSelectedShell: () => selectedShell,
            getShooterShells: () => dl.getShooterShells(),
            getShooterCaliber: () => dl.getShooterCaliber(),
            getShooterData: () => dl.getShooterData(),
            isDestroyed: () => destroyed,
            isShooterLoading: () => dl.isShooterLoading(),
            isShotReplay: () => !!QP.get('shot'),
            getCurrentConfigIdx: () => dl.getCurrentConfigIdx(),
            getCollisionMode: () => collisionMode,
            getPenetrationMode: () => penetrationMode,
            getWorldOverviewMode: () => worldOverviewMode,
            armorDebug: () => ARMOR_DEBUG,
            getModuleMeshes: () => ml.getModuleMeshes(),
            getWorldMetersPerUnit: () => ml.getWorldMetersPerUnit(),
            getPlateThickness,
            equipmentCoeffs: (...a) => eqs.equipmentCoeffs(...a),
            effectiveCalibrated: eqs.effectiveCalibrated,
            effectiveEnhanced: eqs.effectiveEnhanced,
            shellPenMul: eqs.shellPenMul,
            L,
            showShotError: du.showShotError,
        });
        // 诊断探针：window.__armorRicochet 与 readArmorPixels（#820 Agent A 出仓）
        createDiagnosticProbe({
            hm,
            models,
            rig,
            jc,
            getRenderer: () => renderer,
            getCamera: () => camera,
            getControls: () => controls,
            getTankData: () => tankData,
            getCurrentConfig: () => currentConfig(),
            getActiveGunNumber: (...a) => activeGunNumber(...a),
            getSelectedShell: () => selectedShell,
            getShooterShells: () => dl.getShooterShells(),
            getModuleMeshes: () => ml.getModuleMeshes(),
            getWorldMetersPerUnit: () => ml.getWorldMetersPerUnit(),
            equipmentCoeffs: (...a) => eqs.equipmentCoeffs(...a),
            getWorldOverviewMode: () => worldOverviewMode,
            getPenetrationMode: () => penetrationMode,
            shellPenMul: eqs.shellPenMul,
            getTurretDeg: () => currentTurretDeg,
            getGunDeg: () => currentGunDeg,
            getAimSession: () => aim.getAimSession(),
            aimPartAt: (x, y) => aim.aimPartAt(x, y),
            getCameraMotion: () => ({ cameraMovedAt, frameIntervalMs }),
            getRcLastClick: () => rcLastClick,
            setRcLastClick: (v) => { rcLastClick = v; },
        });
        // 瞄准输入：Pointer Events 会话与炮塔/炮管拖拽灵敏度（#820 Agent A 出仓）
        const aim = createAimInput({
            models,
            rig,
            eqs,
            jc,
            getRenderer: () => renderer,
            getCamera: () => camera,
            getControls: () => controls,
            getFxScene: () => fxScene,
            getRaycaster: () => raycaster,
            getMouse: () => mouse,
            getTankData: () => tankData,
            getCurrentConfig: () => currentConfig(),
            getTurretDeg: () => currentTurretDeg,
            getGunDeg: () => currentGunDeg,
            setTurretDeg: (deg) => { currentTurretDeg = deg; },
            setGunDeg: (deg) => { currentGunDeg = deg; },
        });

                
        // ===== HE 溅射可视化：只标注一个半径球面 =====
        // 800 方向采样不再画线；方向化信息交给热力图染色（best 方向白色高亮）。
                
        
                /** 击穿视图/默认视图二分（2026-10-30 用户裁定）：true = 把 HE 的可直穿像素盖白
         *  （渐变照画）；false = 默认视图，只有渐变。随模式切换/机械重建统一刷新。 */
        
        function getPlateThickness(section, plateId) {
            return plateThickness(tankData, currentConfig(), section, plateId);
        }

        function thicknessToColor(t) {
            if (t === null || t === undefined) return 0x666666;
            if (t >= 200) return 0x8B0000;
            if (t >= 100) return 0xFF4500;
            if (t >= 60) return 0xFFA500;
            if (t >= 30) return 0xFFD700;
            return 0x228B22;
        }


        // 跳弹续飞共享 uniform（同一对象引用注入每个 penetrationMaterial——单点更新全体生效）。
        // 数据面 = 世界系均匀网格（buildRicochetGrid，炮塔/配置变化时重建；相机移动不重建）；
        // 执行面 = 全分辨率主图逐像素求交（rcMode=1；v5.3 起无低清中转）。
        // 调试信息窗口：坐标等调试文字集中展示在窗口行内（颜色点 = 对应 3D 标记），不再往场景挂 sprite 标签
                                /**
         * 122 是否生效：宿主确认该车有槽位 +（手动/URL 覆盖 > 射击受击方装备真值 > 原生勾选）。
         * 裁决走 tankSetup 的纯函数（与勾选回退态同一份逻辑，单测覆盖）。
         */
                /** 宿主从 research/devices.json 读到 122 的 bonusValues 后注入（避免场景硬编码）。 */
                /** 宿主确认目标车预设暴露 122（或射击真值已装备）后开启；未知时 fail-closed。 */
                                        // 校准弹判定态变化后刷新下拉穿深文本：populateShellSelector 渲染时回放配件
        // 判定（__shotCtx）常未就绪（并行装载竞速），文本停在基础穿深，与判定
        // 实际采用的 ×1.06/×1.07 口径不一致。只更新文本，不动选中项。
                // 镜头切换时把勾选框同步为回放自动判定（数据在场=禁用并标注来源；缺失=恢复手动）
                                                                // 弹种门：仅动能弹（AP/APCR）可跳弹；爆炸弹（HE/HEAT，跳弹角 90°）续飞恒关；
        // 还需网格在位（矩阵未就位的宽限期内跳弹维持紫，网格就位后自动恢复）。
        // rcMode 同步切换（v5.3 全分辨率逐像素：1=启用 0=关闭——低清类通道 pass 已删，
        // 此前由该 pass 设置，删除后曾遗漏导致 rcMode 恒 0 → 续飞全紫）。
                // 调试/差分测试钩子：info() 看 pack 状态；simulate(跳弹点, 反射向) 跑 JS 参考续飞
        // （与 GLSL rcContinue 同常量同语义，入参口径与着色器一致 = 穿深×0.75）。
        // 浏览器门禁/控制台对拍 "GPU 像素类 vs JS 参考类" 用。
        /**
         * 拖动位移 → 炮塔 / 炮管角度（BlitzKit 式左键拖坦克：灵敏度 = 拖满屏宽转 180°、
         * 拖满屏高俯仰 180°——MixerScene/Model.tsx 的 π/bounds 公式；含俯仰/水平射界限制）。
         */
        
        // ===== 瞄准交互（BlitzKit MixerScene 语义；Pointer Events 单一路径，评审 BLOCKER 1/2）=====
        // 按炮管 = yaw+俯仰；按炮塔壳 = 只 yaw；车体/空白 = 相机轨道；短按无拖动 = 点击判定。
        // pointerId 跟踪忽略无关指针；pointer capture 保证画布外拖动/释放也能收到
        // pointerup/pointercancel → controls.enabled 不会卡在 false。
        /** 进入瞄准：禁相机控制 + 捕获指针；起点取当前事件位置（触屏在阈值处 claim，
         *  把已累计的阈值位移吃掉，claim 瞬间不产生角度跳变）。 */
                /** 指针会话的唯一清理点（up / cancel / lostpointercapture 共用）：会话态与
         *  拖动跟踪态一并复位，避免任何一条出口留下半截状态（评审：cleanup 集中完整）。 */
                /** 左键按下位置命中哪个瞄准部位（'gun'|'turret'|null=车体/空白→相机）。 */
                        // 探针：记录最后一次左键点击像素（用户触发问题情形后一条命令取三方对照）。
        // 惰性挂载：闭包顶层 renderer 尚未创建（init 末尾才赋值），animate 首帧再挂。
        let rcLastClick = null;
        let rcClickHooked = false;
        // 判定代数计数 owner = judgment 模块（jc.getJudgmentCount()）：浏览器门禁用它区分
        // 「短按判定」与「拖动 = 手势（不判定）」。
        function hookRcClickRecorder() {
            if (rcClickHooked || !renderer || !renderer.domElement) return;
            rcClickHooked = true;
            renderer.domElement.addEventListener('mouseup', function(e) {
                if (e.button === 0) rcLastClick = { x: e.clientX, y: e.clientY };
            });
        }
        // Raw diagnostic readback, never decode IDs/classes from the blended display RGB.
        // Synchronous passes freeze one prepared frame; temporary geometry belongs only to this probe.
                
                // 本查看器替换过的装甲材质才可 dispose；GLTF 原始材质可能跨网格共享，不能动。
        // （replaceArmorMaterial 已出仓 viewer/armorMeshState.js，语义原样）
        // —— 装甲分类过滤（主装甲 / 间隙 / 外部模块，2026-10-28 用户要求）——
        /** 节点在“未被分类过滤”时应有的可见性（配置/动态装甲/炮塔变体等其它规则）。 */
                /** 装甲组成显隐只在装甲厚度视图可用：进入时显示这一行，退出时复位并隐藏。 */
        function setArmorFilterRowVisible(visible) {
            const row = document.getElementById('armor-filters');
            if (row) row.hidden = !visible;
        }
                /** 把三个分类开关应用到装甲板与外部模块（炮管/履带）的可见性。 */
        
        // 装甲模型视图样式（collision 按钮与热力图退出共用一份写入，避免各自硬编码漂移）：
        // 碰撞视图=按厚度上色并隐藏视觉车体；普通视图=透明覆盖层并显示视觉车体
        // 装甲厚度视图的点击高亮：选中的装甲板保持不透明 + 轻微自发光，其余部件降透明度
                // 高亮/复位共用的材质状态写入：needsUpdate 触发材质参数整体重评估（program 重选 +
        // 缓存哈希），只有 transparent/depthWrite 这类参与渲染状态的开关真正变化时才置位；
        // opacity 是逐 draw 读取的普通状态，不需要（每次点击全板置 needsUpdate 会让下一帧
        // 对每块装甲材质多做一次参数重评估）。
                        
        // 碰撞（装甲厚度）视图：炮管/履带等外部模块用纯色材质（无贴图），与装甲板同厚度色阶
        /** 厚度视图实心炮管体的 gun_mask 裁剪面同步（材质持有同一 Plane 对象，原地更新）。 */
                                // ===== HE 渐变叠加层（默认视图随点击判定显示，2026-10-30 用户裁定）=====
        // 击穿视图的机械（RT0/RT1/叠加 clone）由 penetrationMode 管理；默认视图下选中
        // HE 且爆点已由点击判定给出时复用同一套机械渲染渐变（材质 heatmapMask=false），
        // 条件消失（换非 HE 弹/进厚度视图/换车）即释放。白色可直穿遮罩只在击穿视图。
                        
                
        /** 交战距离衰减（每帧）：对主图 + spaced clone 逐板计算相机→**板心**距离，
         *  按 0x719740 衰减式刷新 pen uniform（d≤100 或 HE 恒 near；d>100 非 HE 线性至 far，
         *  clamp≥0；HEAT 数据 far==near 天然恒平）。相机旋转/移动即实时更新。
         *  距离取样 = 几何包围球中心经**源网格**当前世界矩阵变换——装甲网格节点原点在
         *  模块枢轴（整块车体/炮塔共点），直接用节点原点是模块级距离而非板级；
         *  源矩阵帧内新鲜（同 syncCloneMatrices 的 updateWorldMatrix 口径）。 */
                
        document.getElementById('penetration-btn').addEventListener('click', function() {
            penetrationMode = !penetrationMode;
            // 与装甲厚度（碰撞）视图互斥：开一个必须关另一个（2026-10-28 用户要求）
            if (penetrationMode && collisionMode) {
                collisionMode = false;
                const cb = document.getElementById('collision-btn');
                cb.classList.remove('active');
                cb.setAttribute('aria-pressed', 'false');
                cvs.resetArmorFilters();
                setArmorFilterRowVisible(false);
                cvs.setHighlightedArmorNode(null);
                cvs.applyArmorViewStyle(false);
            }
            this.classList.toggle('active', penetrationMode);
            this.setAttribute('aria-pressed', String(penetrationMode));
            document.getElementById('click-info').style.display = 'none';
            hm.applyPenetrationMode(penetrationMode);
            hm.refreshPenetrationResolution();
        });


        // —— 动态装甲（armorsStatesController，全库 6 车，声明见 src/data/armorStates.js）——
        // 状态应用 = 可控板（各态 armors 并集）中非激活板按 **deco 口径**摘除（与穿透判定/
        // 点击分类/跳弹枚举的保留面过滤同源，一处摘除全链生效）；常驻板不受状态控制。
        // 恢复两段式：retag 先按 armorSectionOrig 还原（含 spaced 重判），再对非激活可控板
        // 摘除——顺序不可换。上游 PlaybackShot.target_armor_state 已按弹着时刻预解析状态号，
        // 本层不再持有时间线；换弹/重进复现时经 setArmorState 门控切换。

        /** 换车时解析声明：动态车 → {decl, 初态}；静态车两者置 null（全链 no-op）。 */
        
        /** 设置面板勾选框（#armor-state-opt）：动态车显示「动态装甲」勾选——
         *  勾选 = 非默认态，不勾 = 默认态（初值随当前态）；静态车隐藏并复位。 */
        
        
        /** 切换到声明内的状态号；∉ 声明集的值拒绝（消费方门控的最后防线）。 */
        
        /** 非默认态 id（勾选「动态装甲」对应的态；全部 default 标记时兜底首态）。 */
        
        /** 勾选框与当前态同步（射击复现回放自动判定 = 禁用手动，title 标注来源）。 */
        
        /** 厚度视图缓存的原材质与实心材质：目标卸载后不会再恢复，必须连同贴图释放。 */
        
        // 装甲页图形开关的手动覆盖（&eqcal=0/1、&eqenh=0/1）：场景初始化即生效
        if (QP.has('eqcal')) eqs.equipmentOverride.calibrated = QP.get('eqcal') === '1';
        if (QP.has('eqenh')) eqs.equipmentOverride.enhanced = QP.get('eqenh') === '1';
        // 122 改进型垂直稳定器（装甲页手动 what-if；射击复现由 target_equipment 自动判定）
        if (QP.has('eqpitch')) eqs.equipmentOverride.pitch = QP.get('eqpitch') === '1';
        // 本机复现开关：?armordebug=1（仅 dev）。点击后复制/查看本次判定的完整输入与层链。
        const ARMOR_DEBUG = import.meta.env.DEV && QP.get('armordebug') === '1';
        let urlApplied = false;
        /** shell 的权威 owner 是 URL：换目标/重载后按当前 location 恢复，不能用初始化时的 QP 快照。 */
        function requestedShellIndex() {
            return parseInt(new URLSearchParams(location.search).get('shell'), 10);
        }
        // 场景独占距离；Vue 只接收按显示精度去重的快照。回放长度不能被相机缩放覆盖。
        let lastReportedDistance = undefined;
        function reportDistance() {
            const recorded = QP.has('shot');
            const shot = window.__shotCtx?.shot;
            const raw = recorded
                ? (shot ? shotBallisticLength(shot) * (ml.getWorldMetersPerUnit() || 1) : NaN)
                : camera.position.distanceTo(controls.target) * (ml.getWorldMetersPerUnit() || 1);
            const distance = ml.models.tankModel && ml.models.armorModel && !contextLost && Number.isFinite(raw) && raw > 0
                ? Math.round(raw) : null;
            if (distance === lastReportedDistance) return;
            lastReportedDistance = distance;
            onDistanceChange?.(distance == null ? null : {
                distance, min: controls.minDistance, max: controls.maxDistance, readOnly: recorded,
            });
        }
        function setDistance(value) {
            if (destroyed || contextLost || !ml.models.tankModel || !ml.models.armorModel || QP.has('shot')
                || typeof value !== 'number' || !Number.isFinite(value)) return false;
            // 无阻尼 update 会先应用残余旋转/平移，再清空惯性；必须先保存当前姿态。
            const target = controls.target.clone();
            const offset = camera.position.clone().sub(target);
            if (offset.lengthSq() === 0) return false;
            const damping = controls.enableDamping;
            controls.enableDamping = false;
            controls.update();
            controls.target.copy(target);
            const distance = THREE.MathUtils.clamp(value, controls.minDistance, controls.maxDistance);
            camera.position.copy(target).add(offset.setLength(distance / (ml.getWorldMetersPerUnit() || 1)));
            controls.update();
            controls.enableDamping = damping;
            applyLongRangeCompensation(!worldOverviewMode);
            reportDistance();
            return true;
        }
        function setCameraPreset(kind, { preserveView = false } = {}) {
            if (destroyed || contextLost || !ml.models.tankModel || !ml.models.armorModel || QP.get('shot')) return false;
            if (kind !== 'front' && kind !== 'hull_down') return false;
            const pitch = currentConfig()?.pitch_limits;
            const limits = pitch ? pitchAtBearing(pitch, 0,
                eqs.effectivePitchDevice() ? eqs.getPitchDeviceBonusValue() : null) : { down: 0, up: 0 };
            if (!Number.isFinite(limits.down) || !Number.isFinite(limits.up)) return false;
            currentTurretDeg = 0;
            currentGunDeg = armorPresetGunPitch(kind, limits);
            rig.updateTurretGun(currentTurretDeg, currentGunDeg);
            const pose = armorCameraPreset(rig.getArmorPivotGun() || new THREE.Vector3(0, 0, 2),
                new THREE.Matrix4().copy(ml.models.tankModel.matrixWorld).multiply(rig.gunPoseMatrix), ARMOR_REF_DIST);
            // preserveView 在清惯性**之前**取景快照：无阻尼 update 会把残余 panOffset 一次性
            // 应用（target 跳到平移终点），与 setDistance 同口径——快照 → 清惯性 → 用快照摆位。
            // 按钮（preserveView）只换观察方向：旋转中心与距离归用户，平移/缩放不被重置；
            // URL 首载路径没有用户取景，仍由预设完整摆位。
            const userView = preserveView
                ? { target: controls.target.clone(), position: camera.position.clone() }
                : null;
            // 先清除轨道惯性，再设置预设；后续拖动仍由 OrbitControls 正常接管。
            const damping = controls.enableDamping;
            controls.enableDamping = false;
            controls.update();
            const placement = preserveView
                ? armorPresetViewPlacement(userView.target, userView.position, pose)
                : pose;
            controls.target.copy(placement.target);
            camera.position.copy(placement.position);
            controls.update();
            controls.enableDamping = damping;
            document.getElementById('turret-val').textContent = '0°';
            document.getElementById('gun-val').textContent = currentGunDeg.toFixed(0) + '°';
            tc.tidyTrajectory();
            return true;
        }
        function applyUrlOptionsOnce() {
            if (urlApplied || !ml.models.tankModel || !ml.models.armorModel) return;
            urlApplied = true;
            // 普通检视两个模型都完成后再恢复 URL 下标，避免任一模型回调重建下拉框
            // 把选弹重置；手动切配置不重套 URL。
            // 射击复现的弹表/选弹由射手 scfg 与回放 shell_id 所有，不在此覆盖。
            if (!QP.get('shot')) {
                dl.populateShellSelector(dl.getShooterShells(), requestedShellIndex());
                if (penetrationMode && selectedShell) {
                    hm.updatePenetrationUniforms(selectedShell);
                    hm.updateSpacedUniforms(selectedShell);
                }
            }
            const num = (k) => { const v = parseFloat(QP.get(k)); return isNaN(v) ? null : v; };
            const yaw = num('yaw'), pitch = num('pitch');
            function restoreUrlPose() {
                if (yaw !== null || pitch !== null) {
                    if (yaw !== null) currentTurretDeg = Math.max(-179, Math.min(179, yaw));
                    if (pitch !== null) currentGunDeg = pitch;
                    document.getElementById('turret-val').textContent = currentTurretDeg.toFixed(0) + '°';
                    document.getElementById('gun-val').textContent = currentGunDeg.toFixed(0) + '°';
                    rig.updateTurretGun(currentTurretDeg, currentGunDeg);
                }
            }
            restoreUrlPose();
            const view = QP.get('view');
            // `view` 同时是 SPA 路由 id（agent-armor）。只有已知相机预设才按预设处理；
            // 否则 ?view=agent-armor 会命中 fallback（0.8×模型尺寸）覆盖默认 15m 相机距离。
            // 显式相机预设优先用 ?camview=front|top|...，兼容旧的 ?view=<preset>。
            const CAMERA_VIEW_PRESETS = new Set(['front', 'rear', 'left', 'right', 'hull_down', 'top', 'front_left', 'front_right', 'rear_left', 'rear_right']);
            const camView = QP.get('camview') || (CAMERA_VIEW_PRESETS.has(view) ? view : null);
            const azOv = num('az'), distOv = num('dist'), hOv = num('h');
            // 炮线高度（米）：gun 枢轴的 glb z（场景原生米制，无缩放）。默认目标也用它，
            // 让车体垂直居中（地面原点会让坦克落在屏幕上半）。
            const gunLine = (rig.getArmorPivotGun() ? rig.getArmorPivotGun().z : 2.0);
            if ((camView === 'front' || camView === 'hull_down') && azOv === null && hOv === null && distOv === null && !QP.get('shot')) {
                setCameraPreset(camView);
                // 预设只给默认姿态，显式 URL 角度仍然优先。
                restoreUrlPose();
            } else if (camView || azOv !== null || hOv !== null || distOv !== null) {
                // 视角预设（对齐 BlitzKit 语义）：front/rear/left/right = 炮线高度水平视角；
                // hull_down = 低机位仰视炮塔；top = 俯视。机位距离 = 模型最长边倍数
                //（取景需要，与数据无关）：水平 0.80×、斜角 0.87×、顶视 1.17×；顶视高度 = 炮线 + 2×模型长
                const P = ({
                    front:       {az:0,   h:gunLine,     ty:gunLine,      d:0.80*ml.getModelMaxDim()},
                    rear:        {az:180, h:gunLine,     ty:gunLine,      d:0.80*ml.getModelMaxDim()},
                    left:        {az:90,  h:gunLine,     ty:gunLine,      d:0.80*ml.getModelMaxDim()},
                    right:       {az:270, h:gunLine,     ty:gunLine,      d:0.80*ml.getModelMaxDim()},
                    hull_down:   {az:0,   h:1.1,         ty:gunLine+0.3,  d:0.83*ml.getModelMaxDim()},
                    top:         {az:0,   h:gunLine+2.0*ml.getModelMaxDim(), ty:0.1*ml.getModelMaxDim(), d:1.17*ml.getModelMaxDim()},
                    front_left:  {az:45,  h:gunLine,     ty:gunLine,      d:0.87*ml.getModelMaxDim()},
                    front_right: {az:315, h:gunLine,     ty:gunLine,      d:0.87*ml.getModelMaxDim()},
                    rear_left:   {az:135, h:gunLine,     ty:gunLine,      d:0.87*ml.getModelMaxDim()},
                    rear_right:  {az:225, h:gunLine,     ty:gunLine,      d:0.87*ml.getModelMaxDim()},
                })[camView] || {az:0, h:gunLine, ty:gunLine, d:0.80*ml.getModelMaxDim()};
                const d = distOv !== null ? distOv : P.d;
                const a = (azOv !== null ? azOv : P.az) * Math.PI / 180;
                const h = hOv !== null ? hOv : P.h;
                camera.position.set(Math.sin(a) * d, h, -Math.cos(a) * d);
                controls.target.set(0, P.ty, 0);   // 预设目标高度（炮线/顶视），不再回地面原点
            } else {
                // 默认目标 = 装甲模型包围盒中心（车体视觉中心）；包围盒为空时退回炮线高度。
                // 同时把默认相机距离归一到 15m，保持 Armor Inspector 的 18.75° 基准。
                const aimModel = ml.models.armorModel || ml.models.tankModel;
                aimModel.updateWorldMatrix(true, true);
                const aimBox = new THREE.Box3().setFromObject(aimModel);
                if (!aimBox.isEmpty()) {
                    const aimCenter = aimBox.getCenter(new THREE.Vector3());
                    controls.target.set(aimCenter.x, aimCenter.y, aimCenter.z);
                    // 默认正对车头（-Z）且平视：与目标同高，距离 15m；tank 在屏幕中心。
                    camera.position.set(aimCenter.x, aimCenter.y, aimCenter.z - ARMOR_REF_DIST);
                } else {
                    controls.target.set(0, gunLine, 0);
                    camera.position.set(0, gunLine, -ARMOR_REF_DIST);
                }
            }
            controls.update();
            // 击穿视图默认开启；?heatmap=0 显式关闭。换目标重载时若用户已选厚度视图，
            // 不能把击穿视图再打开成“双模式”（厚度点选与热力图会同时生效）。
            if (QP.get('heatmap') !== '0' && !penetrationMode && !collisionMode) {
                penetrationMode = true;
                const btn = document.getElementById('penetration-btn');
                btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true');
                hm.applyPenetrationMode(true);
                hm.refreshPenetrationResolution();
            }
            const shotNo = parseInt(QP.get('shot'), 10);
            const isShotReplay = !isNaN(shotNo);
            if (isShotReplay) {
                // 射击复现（world 模式）可视化：owner = viewer/shotReplay.js（#820 Agent A 出仓）
                runShotReplay({
                    rig, hm, tc, jc, ml,
                    QP,
                    loadGen: { get: () => loadGen },
                    isDestroyed: () => destroyed,
                    L,
                    getScene: () => scene,
                    getCamera: () => camera,
                    getControls: () => controls,
                    getFxScene: () => fxScene,
                    getSelectedShell: () => selectedShell,
                    setSelectedShell: (v) => { selectedShell = v; },
                    getShooterShells: () => dl.getShooterShells(),
                    getShooterData: () => dl.getShooterData(),
                    getUpgradeOptions: upgradeOptions,
                    isShooterLoading: () => dl.isShooterLoading(),
                    getTankData: () => tankData,
                    getCurrentShooterId: () => dl.getCurrentShooterId(),
                    getPenetrationMode: () => penetrationMode,
                    getArmorStateDecl: () => cvs.getArmorStateDecl(),
                    getTurretDeg: () => currentTurretDeg,
                    getGunDeg: () => currentGunDeg,
                    setWorldOverviewMode: (v) => { worldOverviewMode = v; },
                    syncEquipmentCheckboxes: (...a) => eqs.syncEquipmentCheckboxes(...a),
                    clearShotError: du.clearShotError,
                    showShotError: du.showShotError,
                    shotErrorHtml: du.shotErrorHtml,
                    eqBadge: eqs.eqBadge,
                    dbgReset: du.dbgReset,
                    setupShotDebug: du.setupShotDebug,
                    dbgInfo: du.dbgInfo,
                    fmt3: du.fmt3,
                    decodeModules: du.decodeModules,
                    shellIdParts: du.shellIdParts,
                    srQualityIssues: du.srQualityIssues,
                    setArmorState: (...a) => cvs.setArmorState(...a),
                    syncArmorStateControl: () => cvs.syncArmorStateControl(),
                });
            }
            if (QP.get('clean') === '1' && !isShotReplay) {
                ['info-panel','shell-selector','view-toggle','tank-selectors','turret-controls','controls-hint','loading'].forEach(id => {
                    const el = document.getElementById(id); if (el) el.style.display = 'none';
                });
            }
        }

        
        
        function currentConfig() {
            return (tankData && tankData.configs && tankData.configs[dl.getCurrentConfigIdx()]) || null;
        }

        const activeGunNumber = () => {
            const cfg = currentConfig();
            if (!cfg) return null;
            const gunGroups = rig.getConfigGunGroups();
            const grp = gunGroups[cfg.gun_index % Math.max(1, gunGroups.length)];
            if (!grp) return null;
            for (const n of grp) {
                const m = (n.name || '').match(/^gun_(\d+)$/);
                if (m) return parseInt(m[1], 10);
            }
            return null;
        };

        /** 宿主（装甲页）有了图形化装配编辑器时隐藏原生配置下拉；仍是场景的配置状态源。 */
        let configUiHidden = false;
        /** 射击复现的图形面板就绪后隐藏原生弹种下拉（仍是场景的弹种状态源）。 */
        let shellUiHidden = false;
                
        
        
        function applyArmorConfigVisible(cfg) {
            if (!ml.models.armorModel) { return; }
            applyArmorPrefixVisibility(ml.models.armorModel, cfg, rig.collectArmorPrefixes());
        }

        
        

        
        /** 选车（宿主页的共享 TankCatalogMenu → 这里）：加载弹药/目标并回报当前选择。 */
        
        /** 宿主页选车入口可用性：名册已就绪且弹药初始化完成。 */
        
        
        function initScene() {
            scene = new THREE.Scene();
            // 3D 场景不再自带棕色调背景/雾与地面网格：画布透明，直接继承网页 UI 的
            // --color-canvas；场景只保留车体与光照，风格与页面外壳一致。
            scene.background = null;
            // 点击判定特效（轨迹/命中标记/溅射半径球）单独一个场景：热力图 pass 后渲染，
            // 留在主场景会被半透明着色（HE 白色遮罩 alpha≈0.95）整片盖掉。特效材质全是
            // MeshBasicMaterial（不吃光照），空场景即可正确显色。
            fxScene = new THREE.Scene();

            // SPA 壳内渲染：视口尺寸取 canvas 容器（main 区域），而非整窗（顶部导航占 67px）
            const view = document.getElementById('canvas-container');
            camera = new THREE.PerspectiveCamera(ARMOR_BASE_FOV, view.clientWidth / view.clientHeight, 0.1, 1000);
            // 默认正对车头（-Z）且平视：目标高度在模型加载后由装甲包围盒中心决定；距离 15m。
            camera.position.set(0, 0, -ARMOR_REF_DIST);

            // preserveDrawingBuffer 不再开启：本查看器没有任何像素回读（无 toDataURL/readPixels/
            // 录屏），开启它只会阻止浏览器做缓冲区交换优化（每帧多一次全分辨率拷贝）。
            renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
            renderer.setClearColor(0x000000, 0);
            renderer.setSize(view.clientWidth, view.clientHeight);
            // DPR 上限 2：此前直接取 devicePixelRatio（3× 屏上按 3× 全屏渲染，像素数 ×2.25）
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            renderer.localClippingEnabled = true;
            view.appendChild(renderer.domElement);
            try {
                const gl = renderer.getContext();
                const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
                gpuLabel = String((debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) || '');
            } catch (_) { gpuLabel = ''; }
            const canvas = renderer.domElement;
            canvas.addEventListener('webglcontextlost', reportContextLost);
            canvas.addEventListener('webglcontextrestored', reportContextRestored);
            cleanups.push(() => {
                canvas.removeEventListener('webglcontextlost', reportContextLost);
                canvas.removeEventListener('webglcontextrestored', reportContextRestored);
            });
            // 某些环境（模拟器的 GL 翻译层）在 listener 挂上之前就已经丢了上下文。
            try { if (renderer.getContext().isContextLost()) reportContextLost(); } catch (_) {}
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = 1.15;

            controls = new OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.05;
            controls.rotateSpeed = 0.35;   // 降低旋转灵敏度（默认 1.0 过快，精细对位困难）
            controls.minDistance = 3;
            controls.maxDistance = 500;   // 查看器距离范围；Armor Inspector 的 6.5–30m 仅作 FOV 标定参考
            controls.mouseButtons = {
                LEFT: THREE.MOUSE.ROTATE,
                MIDDLE: THREE.MOUSE.DOLLY,
                RIGHT: null,
            };


            const readThemeColor = (name, fallback) => {
                const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
                if (!raw) return new THREE.Color(fallback);
                try { return new THREE.Color(raw); } catch { return new THREE.Color(fallback); }
            };
            const hemi = new THREE.HemisphereLight(0xffffff, readThemeColor('--color-surface-2', '#172024'), 2.2);
            scene.add(hemi);
            // 网页主题（四季）切换时，半球光底面跟随 UI 表面色；画布背景由透明 CSS 继承。
            const themeObserver = new MutationObserver(() => {
                hemi.groundColor.copy(readThemeColor('--color-surface-2', '#172024'));
            });
            themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
            cleanups.push(() => themeObserver.disconnect());
            scene.add(new THREE.AmbientLight(0xffffff, 0.9));
            const spot1 = new THREE.SpotLight(0xfff5e1, 500, 60, 0.55, 0.6);
            spot1.position.set(10, 15, 8);
            scene.add(spot1);
            const spot2 = new THREE.SpotLight(0x88aaff, 260, 50, 0.45, 0.5);
            spot2.position.set(-10, 12, -6);
            scene.add(spot2);

            raycaster = new THREE.Raycaster();
            mouse = new THREE.Vector2();
        }

        /** 射击复现重判必须沿录像的 launch/lvDir，不能用相机中心射线替代权威方向。 */
        function rerunAuthoritativeShotCheck() {
            const wc = window.__worldTickCtx;
            if (!(window.__worldPenMode && wc?.launch && wc.lvDir)) return false;
            jc.setShotRay(wc.launch.clone(), wc.launch.clone().addScaledVector(wc.lvDir, wc.rayFar));
            jc.doPenetrationCheck(0, 0);
            jc.clearShotRay();
            return true;
        }

        /** 校准弹/强化装甲变化后的统一刷新（勾选框与宿主 HUD 的 setEquipmentOverride 共用）。
         *  厚度系数与判定模式无关：装甲检视下点板/热力图读同一份 uniform。 */
        function refreshEquipmentEffects() {
            const sel = document.getElementById('shell-select');
            if (sel) {
                for (let i = 0; i < sel.options.length; i++) {
                    if (dl.getShooterShells() && i < dl.getShooterShells().length) {
                        sel.options[i].textContent = eqs.shellOptionText(dl.getShooterShells()[i]);
                    }
                }
            }
            hm.updateHeatmapThickness();
            // 旧判定失效必须排在「渲染资源是否存在」的守卫之前：厚度视图里叠加层已释放
            // （penetrationMode / hm.getPrimaryArmorScene() 都为假），但上一发的爆点、结果卡、轨迹
            // 仍是上一发的——换了装备再回默认视图，syncHeatOverlay 会在旧爆点上按新参数
            // 重建渐变且没有新的点击（Codex 复核 P2，2026-10-30）。只有 uniform 刷新
            // 依资源存在与否，replay 的权威重判分支保持原样。
            if (!QP.get('shot') && (jc.getLastClickNdc() || hm.getHeHeatmapCenter())) {
                tc.tidyTrajectory();
                if (window.__hitMarker) { fxScene.remove(window.__hitMarker); window.__hitMarker = null; }
                jc.clearLastClickNdc();
            }
            if (penetrationMode || hm.getPrimaryArmorScene()) {
                const sh = selectedShell || (dl.getShooterShells()[0]) || null;
                if (sh) { hm.updatePenetrationUniforms(sh); hm.updateSpacedUniforms(sh); }
            }
            if (QP.get('shot')) {
                if (!rerunAuthoritativeShotCheck()) jc.doPenetrationCheck(0, 0);
            }
            hm.syncHeatOverlay();
        }

        function setupEventHandlers() {
            // 回退 checkbox 初始勾选必须反映 URL/场景的有效装备状态，否则 HUD 资产加载
            // 失败时会出现“界面关闭、判定仍开启”的误导。
            const initialCal = document.getElementById('eq-calibrated');
            if (initialCal && eqs.equipmentOverride.calibrated != null) initialCal.checked = eqs.equipmentOverride.calibrated;
            const initialEnh = document.getElementById('eq-enhanced');
            if (initialEnh && eqs.equipmentOverride.enhanced != null) initialEnh.checked = eqs.equipmentOverride.enhanced;
            const initialPitch = document.getElementById('eq-pitch-device');
            if (initialPitch && eqs.equipmentOverride.pitch != null) initialPitch.checked = eqs.equipmentOverride.pitch;
            document.getElementById('shell-select').addEventListener('change', function() {
                if (destroyed || dl.isShooterLoading()) return;
                const idx = parseInt(this.value);
                if (dl.getShooterShells() && idx < dl.getShooterShells().length) {
                    QP.set('shell', String(idx));
                    selectedShell = dl.getShooterShells()[idx];
                    // 机械存在（击穿视图或默认视图 HE 渐变）时都要刷新弹种 uniforms，
                    // 否则默认视图换弹后渐变仍用上一发的穿深/伤害/爆炸半径。
                    if (penetrationMode || hm.getPrimaryArmorScene()) { hm.updatePenetrationUniforms(selectedShell); hm.updateSpacedUniforms(selectedShell); }
                    if (QP.get('shot')) {
                        // 世界模式：换弹按权威弦射线重跑判定。
                        if (!rerunAuthoritativeShotCheck()) jc.doPenetrationCheck(0, 0);
                    } else if (jc.getLastClickNdc() || hm.getHeHeatmapCenter()) {
                        // 普通检视换弹（2026-10-28 用户裁定）：只清掉上一次判定结果，
                        // 不按旧点击位置重跑——新弹种要用户重新点击才产生结果。
                        // 清理与「叠加层资源是否存在」解耦：厚度视图里叠加层已释放，
                        // 上一发的爆点/轨迹仍必须清（Codex 复核 P2，2026-10-30）。
                        tc.tidyTrajectory();
                        if (window.__hitMarker) { fxScene.remove(window.__hitMarker); window.__hitMarker = null; }
                        jc.clearLastClickNdc();
                    }
                    // 清理之后再统一裁决叠加层（HE→非 HE 释放、HE+爆点保留/重建）。
                    hm.syncHeatOverlay();
                    onShellSelection?.(idx);
                }
            });

            document.getElementById('eq-calibrated').addEventListener('change', function() {
                // 原生勾选是回退控件：用户手动改动后必须接管 URL 初始化留下的 override，
                // 否则复选框可见但计算仍走旧覆盖值。
                eqs.equipmentOverride.calibrated = null;
                refreshEquipmentEffects();
                onEquipmentSelection?.('calibrated', this.checked);
            });
            document.getElementById('eq-enhanced').addEventListener('change', function() {
                eqs.equipmentOverride.enhanced = null;
                refreshEquipmentEffects();
                onEquipmentSelection?.('enhanced', this.checked);
            });
            const pitchToggle = document.getElementById('eq-pitch-device');
            if (pitchToggle) pitchToggle.addEventListener('change', function() {
                // 只影响炮管俯仰钳制（不碰穿深/厚度），下一次拖动按新上下限生效。
                eqs.equipmentOverride.pitch = null;
                onEquipmentSelection?.('pitch', this.checked);
            });
            document.getElementById('armor-state-toggle').addEventListener('change', function() {
                if (!cvs.getArmorStateDecl()) return;   // 静态车无声明：不得读 states（review P2 崩溃点）
                cvs.setArmorState(this.checked ? cvs.nonDefaultStateId(cvs.getArmorStateDecl()) : defaultStateId(cvs.getArmorStateDecl()));
            });

            document.getElementById('config-select').addEventListener('change', function() {
                const idx = parseInt(this.value);
                dl.applyConfig(idx);
                onConfigSelection?.(idx);
            });

            document.getElementById('collision-btn').addEventListener('click', function() {
                collisionMode = !collisionMode;
                // 与击穿视图互斥：切到装甲厚度先关掉热力图
                if (collisionMode && penetrationMode) {
                    penetrationMode = false;
                    const pb = document.getElementById('penetration-btn');
                    pb.classList.remove('active');
                    pb.setAttribute('aria-pressed', 'false');
                    hm.applyPenetrationMode(false);
                    hm.refreshPenetrationResolution();
                }
                this.classList.toggle('active', collisionMode);
                this.setAttribute('aria-pressed', String(collisionMode));
                // 组成显隐只在厚度视图可用；退出时复位为全显示
                if (!collisionMode) cvs.resetArmorFilters();
                setArmorFilterRowVisible(collisionMode);
                if (!collisionMode) { cvs.resetArmorHighlight(); document.getElementById('click-info').style.display = 'none'; }
                if (!ml.models.armorModel) { hm.syncHeatOverlay(); return; }
                cvs.applyArmorViewStyle(collisionMode);
                // 叠加层裁决必须排在网格可见性恢复**之后**：退出厚度视图时
                // cvs.resetArmorFilters() 只复位开关，真正恢复可见性的是
                // applyArmorViewStyle → applyCategoryFilters；而 rebuildHeatmapScenes →
                // collectPenetrationMeshes 会跳过 visible=false 的板，先重建会漏掉被分类
                // 过滤隐藏的主装/间隙甲/模块，之后的点击也复用这份残缺场景
                // （Codex 复核 P2，2026-10-30）。进入厚度视图时这里只做释放，顺序无影响。
                hm.syncHeatOverlay();
            });

            // 分类过滤（主装甲 / 间隙 / 外部模块）：active = 显示
            ['primary', 'spaced', 'external'].forEach(function(name) {
                const btn = document.getElementById('filter-' + name);
                if (!btn) return;
                btn.addEventListener('click', function() {
                    cvs.toggleCategory(name);
                });
            });

            // —— 指针交互注册（单一 Pointer Events，桌面+触屏统一；评审 PR BLOCKER 1/2）——
            // 处理器与全部状态定义在闭包级（__armorRicochet 钩子之前），这里只做注册（renderer 已就绪）。
            renderer.domElement.addEventListener('pointerdown', aim.aimPointerHandlers.down);
            renderer.domElement.addEventListener('pointermove', aim.aimPointerHandlers.move);
            renderer.domElement.addEventListener('pointerup', aim.aimPointerHandlers.up);
            renderer.domElement.addEventListener('pointercancel', aim.aimPointerHandlers.cancel);
            renderer.domElement.addEventListener('lostpointercapture', aim.aimPointerHandlers.lostCapture);

            document.getElementById('turret-controls').style.display = 'block';

            const resizeView = () => {
                if (destroyed) return;
                const view = document.getElementById('canvas-container');
                if (!view?.clientWidth || !view.clientHeight) return;
                camera.aspect = view.clientWidth / view.clientHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(view.clientWidth, view.clientHeight);
                hm.refreshPenetrationResolution();
            };
            onWin('resize', resizeView);
            // The recorded-shot header can wrap without a window resize (locale / error message).
            if (typeof ResizeObserver === 'function') {
                const observer = new ResizeObserver(resizeView);
                observer.observe(document.getElementById('canvas-container'));
                cleanups.push(() => observer.disconnect());
            }
        }

        async function init() {
            reportLoad({ state: 'loading', progress: null });
            initScene();
            setupEventHandlers();
            const initTargetId = initialTankId ?? 28689;
            const initShooterId = initialShooterId ?? initTargetId;
            await dl.populateTankLists(initTargetId, initShooterId);
            if (destroyed || contextLost) return;
            // 模型回调可立即恢复射击并判定，因此弹药必须先完成，不能靠定时器猜网络耗时。
            initPhase = 'shell data';
            await dl.loadShooter(initShooterId);
            if (destroyed || contextLost) return;
            dl.markInitDone();
            dl.updateTankLabels();
            initPhase = 'tank data';
            await dl.loadTarget(initTargetId);
            if (destroyed || contextLost) return;
            if (!destroyed && !contextLost) animate();   // await 期间路由已离开/上下文已丢失则不再启动渲染
        }

        /// 宿主页"重试"：恢复缺失弹药并重载当前目标；初始化未完成则由宿主整体重建
        function retry() {
            if (destroyed || contextLost || !dl.isInitDone() || dl.getCurrentTargetId() == null) return false;
            let phase = 'shell data';
            const ready = selectedShell && !dl.isShooterLoading()
                ? Promise.resolve() : dl.loadShooter(dl.getCurrentShooterId());
            ready.then(() => { phase = 'tank data'; if (!destroyed) return dl.loadTarget(dl.getCurrentTargetId()); })
                .then(() => { if (!destroyed && !rafId) animate(); })   // 首次加载失败时渲染循环尚未启动
                .catch((e) => reportLoad({ state: 'error', message: loadFailed(phase, errorMessage(e)) }));
            return true;
        }

        let currentTurretDeg = 0, currentGunDeg = 0;

        // lastClickNdc owner = judgment 模块（jc.getLastClickNdc()）。
        
        /** 装甲厚度模式：命中装甲板 → 高亮该板，并在命中点旁侧的浮层显示部件名与基础装甲值
         *  （浮层相对点击坐标偏移 24px 并在视口内钳制，避免盖住命中点；无击穿判定）。 */
        
        // 射击复现错误面板（模块级：doPenetrationCheck 等顶层函数也要调用）
        
                
        /**
         * 间隙甲（spaced）双面求交：显示/采样材质与 BlitzKit 同为 FrontSide，从背面命中的
         * 间隙屏（单面屏幕或闭合板的背面）不会进入 THREE.Raycaster。求交前把间隙甲材质的
         * side 临时切成 DoubleSide，求交是同步的，完成后立即恢复（不经过渲染，画面不变）。
         */
                /**
         * 判定命中收集（点击主链 / 跳弹续飞共用）：
         *  - 间隙甲双面：背面命中的间隙屏参与判定（法线已由 classifyHit 翻向来向）；
         *    主装甲/外部模块仍只认迎面命中（闭合壳体正/背面各算一层会重复消耗厚度）。
         *  - 闭合间隙甲的正/背面是同一块板：该板前面已计过时不再重复计背面。
         */
        
        /**
         * 判定口径必须是实际数据：射手配置 → 射手数据 → 弹体 → 目标坦克。
         * 历史实现缺数据时静默用 120mm，会改变 overmatch / 转正 / 3× 口径结果；
         * 现在返回 0 由调用方 fail-closed（报 shellUnavailable），不再猜。
         */
        
        
        

                
        
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

        // ===== 单车装甲检视 / shot replay 的相机标定 =====
        // Armor Inspector 实测（PC T-34）：基准 15m/18.75°，FOV 最大 40°（约 6.5m 处封顶），
        // 实测取景点 6.5–28.35m；near=0.05d，far=d+30；d<15 时 FOV 变宽、车体屏幕尺寸保持 15m 比例。
        // 单车装甲检视与 shot replay 共用这套标定；shot replay 的 0.5–500m 由 minFov=0.5° 兜底。
        // enabled=false（两车 world 总览）以原生 50° 幂等还原——总览按射手/目标取景，
        // 套单车 dolly-zoom 会把远距受击车裁出视锥（review P2）。
        function applyLongRangeCompensation(enabled) {
            const d = camera.position.distanceTo(controls.target);
            let fov, near, far;
            if (!enabled) {
                // world overview：原生 50° 取景（far 随距离防裁切）
                fov = OVERVIEW_BASE_FOV;
                near = 0.1;
                far = Math.max(1000, d * 3);
            } else {
                // 单车装甲检视 / shot replay：同一套 Armor Inspector 参考 + 更强的距离缩放
                // display profile（+0.028/m、封顶 3.8、整体 ×1.1），远距车体缩小更明显。
                fov = dollyZoomFov(d, true, ARMOR_BASE_FOV, ARMOR_REF_DIST, ARMOR_MIN_FOV, ARMOR_MAX_FOV, ARMOR_FAR_PRODUCT_GAIN, ARMOR_FAR_PRODUCT_MAX, ARMOR_PRODUCT_SCALE);
                near = 0.05 * d;
                far = d + 30;
            }
            let dirty = false;
            if (Math.abs(camera.fov - fov) > 0.005) { camera.fov = fov; dirty = true; }
            if (Math.abs(camera.near - near) > 1e-4 || Math.abs(camera.far - far) > 1) {
                camera.near = near; camera.far = far; dirty = true;
            }
            if (dirty) camera.updateProjectionMatrix();
        }

        /** 点击判定特效 pass：独立 fxScene，永远画在车体/热力图之上。击穿概率模式在
         *  hm.getPrimaryArmorScene() 之后、clearDepth 之上叠加，HE 白色遮罩下命中点/轨迹仍清晰；
         *  默认视图画在场景之后。autoClear 必须临时关闭——fxScene 没有背景，
         *  否则会把整帧清掉。 */
        function renderFxPass() {
            if (!fxScene || fxScene.children.length === 0) return;
            const prevAutoClear = renderer.autoClear;
            renderer.autoClear = false;
            renderer.render(fxScene, camera);
            renderer.autoClear = prevAutoClear;
        }

        function animate() {
            if (destroyed || contextLost) return;
            hookRcClickRecorder();   // 探针监听惰性挂载（首帧 renderer 就绪）
            rafId = requestAnimationFrame(animate);
            controls.update();
            // 单车装甲检视：Armor Inspector 实测 15m/18.75° + 40° 上限；
            // shot replay：旧 30m/50° dolly-zoom；world 总览传 false → 原生 50°。
            applyLongRangeCompensation(!worldOverviewMode);
            trackCameraMotion();
            reportDistance();
            // 击穿视图全管线；默认视图下 HE 渐变叠加层（机械已建且爆点在）复用同一管线。
            if ((penetrationMode || (!!hm.getPrimaryArmorScene() && hm.heGradientWanted())) && ml.models.armorModel) {
                if (SESS && heatFrames < 5) {
                    heatFrames++;   // 就绪门控计数保留（上游语义）；上报端点已随 client-only 移除
                }
                hm.prepareRicochetFrame(); // 所有通道先共享本帧几何，RT1 不再消费上一帧网格
                hm.updatePenetrationDistanceUniforms();   // 交战距离衰减（相机/炮口→命中板，每帧刷 pen uniform）
                hm.renderSpacedArmorPass();
                renderer.render(scene, camera);                       // 背景/网格（autoClear 已置 false）
                renderer.clearDepth();                                 // 清除深度，让 exclude 深度遮罩生效
                if (hm.getPrimaryArmorScene()) { hm.syncCloneMatrices(hm.getPrimaryArmorScene()); renderer.render(hm.getPrimaryArmorScene(), camera); }
                renderFxPass();   // 点击判定特效画在热力图之上（否则被 0.5/0.95 alpha 覆盖）
            } else {
                // 普通分支必须自清屏：热力图/叠加层的最后一帧会把 autoClear 留成 false，
                // 若条件在两次 syncHeatOverlay 之间失效（如 selectedShell 被换掉但尚未
                // 同步），没有显式 clear 的帧会复用上一帧缓冲（评审 2026-10-30 提出的
                // 清理状态风险）。这里不依赖「谁最后动过 autoClear」。
                renderer.autoClear = true;
                renderer.render(scene, camera);
                renderFxPass();
            }
            if (tc.getTrajInfoPos()) tc.updateTrajInfoPos();
        }

        /// 路由离开清理：停 rAF、摘 window 监听、释放控制器与 WebGL 上下文。
        /// canvas 由 ArmorView 的容器 DOM 一并移除，这里只处理 JS 侧句柄。
        function destroy() {
            destroyed = true;
            dl.bumpShooterLoadGen();
            jc.bumpPenSeq();
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
            try { hm.armorShaders.dispose(); } catch (_) {}   // context 私有占位纹理（材质已随场景释放）
        }

        function isContextLost() { return contextLost; }

        init().catch((e) => {
            console.error('tank viewer init failed:', e);
            reportLoad({ state: 'error', message: loadFailed(initPhase, errorMessage(e)) });
        });
        /** 弹种选择（与原生下拉的 change 同一路径）：index 越界即忽略。 */
        function setShell(index) {
            const sel = document.getElementById('shell-select');
            const i = Number(index);
            if (!sel || !dl.getShooterShells() || !Number.isInteger(i) || i < 0 || i >= dl.getShooterShells().length) return false;
            QP.set('shell', String(i));
            sel.value = String(i);
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }

        /** 校准弹/强化装甲手动覆盖（null = 跟随回放真值/旧勾选框）。 */
        function setEquipmentOverride(kind, value) {
            if (kind !== 'calibrated' && kind !== 'enhanced' && kind !== 'pitch') return;
            eqs.equipmentOverride[kind] = value == null ? null : !!value;
            // 俯仰只改下一轮拖动钳制，不影响穿深/厚度 uniform；同步原生勾选，
            // 避免宿主清掉不可用车的 eqpitch 后 checkbox 仍显示勾选。
            if (kind === 'pitch') {
                const pit = document.getElementById('eq-pitch-device');
                if (pit) {
                    if (value != null) {
                        pit.checked = !!value;
                    } else {
                        // 撤销覆盖（review P2）：必须按当前目标录制真值/默认值重同步回退勾选。
                        // 只把 override 置 null 会留下旧 checked=true——effectivePitchDevice
                        // 在无真值时回退到 checkbox，122 会被残留勾选重新启用，与已清 URL 的 HUD 不一致。
                        const recorded = eqs.shotEquipmentCtx().target;
                        pit.checked = resolvePitchCheckboxChecked({
                            override: null,
                            recorded: recorded ? !!recorded.improved_pitch_limits : null,
                        });
                    }
                }
            } else {
                refreshEquipmentEffects();
            }
        }

        /**
         * 射击方主炮（配置下标）：换 &scfg= 后重载射手弹表（弹种/口径随炮塔×炮），
         * 再按新表重跑判定。回放记录的炮塔/炮管姿态保持原样（那是历史真值）。
         */
        async function setShooterConfig(index) {
            if (dl.getCurrentShooterId() == null) return false;
            const idx = Number(index);
            if (!Number.isInteger(idx) || idx < 0) return false;
            const hasCurrent = !!(dl.getShooterData() && dl.getShooterData().tank_id === dl.getCurrentShooterId());
            if (hasCurrent && idx >= (dl.getShooterData().configs || []).length) return false;
            QP.set('scfg', String(idx));
            QP.delete('shell');   // 旧弹种下标对新炮表无意义
            if (!hasCurrent) {
                // 当前选中的射手数据仍在路上：不要用上一辆车的 dl.getShooterData() 重载，
                // 否则会递增 shooterLoadGen（dataLoader owner） 把正确的在途响应丢掉。
                dl.setPendingShooterConfig({ tankId: dl.getCurrentShooterId(), index: idx });
                return true;
            }
            await dl.loadShooter(dl.getCurrentShooterId());
            return true;
        }

        return {
            destroy, retry, canPick: () => dl.canPick(), isContextLost,
            selectTank: (...a) => dl.selectTank(...a),
            setCameraPreset, setDistance,
            setConfig: (...a) => dl.applyConfig(...a),
            setConfigUiVisible: (...a) => dl.setConfigUiVisible(...a), setShellUiVisible: (...a) => dl.setShellUiVisible(...a),
            setShell, setShooterConfig, setEquipmentOverride,
            setPitchDeviceBonus: (...a) => eqs.setPitchDeviceBonus(...a), setPitchDeviceAvailable: (...a) => eqs.setPitchDeviceAvailable(...a),
        };
    }
