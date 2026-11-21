// 射击复现（world 模式）可视化（#820 Agent A 出仓）：双模型摆位、弹道/段线/锚点/移动
// 标注、DecodeShotSegment 出入点、连续时间滑块与 Impact/World 视角切换。
// 原 tankViewer.js applyUrlOptionsOnce 的 isShotReplay 分支整体平移；
// 回放语义、镜像约定与判定接线保持原样（window.__world* 钩子契约不变）。
import * as THREE from 'three'
import { poseFromYPR } from '../glbRig.js'
import { fetchReplayShots } from '../agentData.js'
import { createShooterModelFactory, poseShooterTurretGun } from './shotReplayPose.js'
import { buildTrajectoryAnnotation, installAnchorMarkers, installShooterMuzzleMarker, placeImpactCamera } from './shotReplaySeg.js'
import { installSegmentJudgment } from './judgment.js'
import { mirrorShotData } from './viewerMath.js'
import { shotResultClass } from '../../utils/shotResultClass.js'
import { shellTypeOf } from './armorPlateModel.js'
import { renderMissShotAnnotation } from './shotReplayMiss.js'
import { interpTick, lerpTl, lerpTlAngle } from './shotReplayInterp.js'
import type {
    ArmorStateDecl, PoseTickSample, ReplayShot, ShellSpec, TankData, Vec3,
} from './viewerContracts.js'
import type { ModelLifecycleHandle } from './modelLifecycle.js'
import type { TrajectoryCardHandle } from './trajectoryCard.js'
import type { TurretRigHandle } from './turretRig.js'

/** OrbitControls 在本回放路径实际使用的最小结构。 */
interface ShotControls {
    target: THREE.Vector3
    update(): void
    maxDistance: number
    minDistance: number
    mouseButtons: Record<string, number>
    screenSpacePanning: boolean
}

/** 热力图管线的消费面。 */
interface ShotHeatmapHandle {
    getPrimaryArmorScene(): THREE.Object3D | null
    syncHeatOverlay(): void
    updatePenetrationUniforms(shell: ShellSpec | null): void
    updateSpacedUniforms(shell: ShellSpec | null): void
}

/** 判定链的消费面（setShotRay → doPenetrationCheck → clearShotRay）。 */
interface ShotJudgmentHandle {
    setShotRay(origin: THREE.Vector3, target: THREE.Vector3): void
    clearShotRay(): void
    doPenetrationCheck(ndcX: number, ndcY: number): void
}

/** 回放界面文案（runShotReplay 只读这几个键）。 */
interface ShotReplayLabels {
    armorStateAutoTitle: string
    shotView: string
    relativeView: string
    worldView: string
}

/** composition root 注入的显式依赖（原 JSDoc 契约的 TypeScript 化）。 */
export interface ShotReplayDeps {
    rig: TurretRigHandle
    hm: ShotHeatmapHandle
    tc: Pick<TrajectoryCardHandle, 'tidyTrajectory'>
    jc: ShotJudgmentHandle
    ml: ModelLifecycleHandle
    QP: URLSearchParams
    loadGen: { get(): number }
    isDestroyed(): boolean
    getTankData(): TankData
    getScene(): THREE.Scene
    getCamera(): THREE.PerspectiveCamera
    getControls(): ShotControls
    getSelectedShell(): ShellSpec | null
    setSelectedShell(shell: ShellSpec): void
    getShooterShells(): ShellSpec[]
    getShooterData(): TankData | null
    getPenetrationMode(): boolean
    getArmorStateDecl(): ArmorStateDecl | null
    getTurretDeg(): number
    getGunDeg(): number
    setWorldOverviewMode(on: boolean): void
    L: ShotReplayLabels
    syncEquipmentCheckboxes(s: ReplayShot): void
    clearShotError(): void
    showShotError(msg: string): void
    shotErrorHtml(): string
    eqBadge(equipment: unknown): string
    dbgReset(): void
    setupShotDebug(refresh: ((on: boolean) => void) | null): void
    dbgInfo(id: string, color: string, name: string, text: string): void
    fmt3(x: number, y: number, z: number): string
    decodeModules(mask: number): string[]
    shellIdParts(gid: number): { local: number; nation: number } | null
    srQualityIssues(shot: ReplayShot): string[]
    setArmorState(stateId: number): void
    syncArmorStateControl(): void
    isShooterLoading(): boolean
    getCurrentShooterId(): number | string | null
}

/** 客户端 BWUtils::DecodeShotSegment 的 1/255 量化解码（纯函数，行为测试锚）：b=0→min、b=255→max。 */
export function decodeB255(b: number, min: number, size: number): number {
    return min + size * (b / 255)
}

export function runShotReplay(deps: ShotReplayDeps): void {
    const {
        rig, hm, tc, jc, ml, QP, L, getTankData,
        getScene, getCamera, getControls,
        getSelectedShell, setSelectedShell, getShooterShells, getShooterData,
        getPenetrationMode, getArmorStateDecl, getTurretDeg, getGunDeg,
        syncEquipmentCheckboxes, clearShotError, showShotError,
        shotErrorHtml, eqBadge, dbgReset, setupShotDebug, dbgInfo, fmt3,
        decodeModules, shellIdParts, srQualityIssues,
        setArmorState, syncArmorStateControl,
    } = deps

            // 数据来源：射击复现表经 sessionStorage 交接（WotBTools 纯客户端链），
                // 无交接回退 Agent 自托管 /api/replay_shot（agentData.fetchReplayShots）
                const shotGen = deps.loadGen.get();
                const currentShot = () => !deps.isDestroyed() && shotGen === deps.loadGen.get();
                const shotQuery = QP.get('shot') || '';
                fetchReplayShots().then(d => {
                    if (!currentShot()) return;
                    const shots = d.shots || d;
                    const s: ReplayShot | undefined = (Array.isArray(shots) ? shots : [])
                        .find((x: ReplayShot) => x.index === parseInt(shotQuery, 10));
                    if (!s) { showShotError('shot #' + parseInt(shotQuery, 10) + ' 不存在（接口返回 ' + (Array.isArray(shots) ? shots.length : 0) + ' 发）'); return; }
                    // 场景原生米制（1 单位 = 1 米，模型不缩放）：回放数据为真实米，直通使用
                    if (!rig.getArmorPivotGun()) { showShotError('炮管枢轴未安装（模型装配异常）'); return; }
                    // ===== 模型保持默认朝向（车头 -Z），相机做相对调整 =====
                    // toModel = 正交旋转 Ry(π−hullYaw)（无镜像）：世界前向 (sin,0,+cos) 映到模型
                    // 前向 -Z、世界右方映到模型右方；含 z 取反的反射版会使相对视图左右互换。
                    const ta = s.target_ang || [0, 0, 0];
                    // ===== world=1 模式：双模型世界坐标渲染 =====
                    const isWorld = true;   // 世界模式 = 射击复现主视图（旧装甲查看器主视图已删除，world=1 参数兼容但不再需要）
                    if (isWorld) mirrorShotData(s);   // 模块级纯函数（定义见文件头）
                    // ===== 命中冲击姿态滤波（必须在 mirror【之后】构造）=====
                    // 实测命中时刻 type10 姿态含冲击晃动（0.1s 内 roll 突变 ~12°），弹丸命中的是
                    // 冲击【前】车体 → 命中 tick(dt≈0) 的 pitch/roll 用最近 dt<0 采样替代（yaw 保留）。
                    // mirror 会原地取反 tick_samples 的 yaw/roll——此处读到的已是镜像值，与
                    // 滑块/回退路径的相邻采样同号（先拷贝会残留未镜像 roll，命中时刻侧倾
                    // 符号翻转 → 移动转向目标姿态跳变、弹着点偏移）。
                    let hitAtt: { pitch: number; roll: number } | null = null;
                    {
                        let pre: PoseTickSample | null = null;
                        for (const t of (s.tick_samples || [])) {
                            if ((t.dt ?? NaN) < -0.02 && (!pre || (t.dt ?? NaN) > (pre.dt ?? NaN))) pre = t;
                        }
                        if (pre && (pre.dt ?? NaN) > -0.35) hitAtt = { pitch: pre.pitch ?? 0, roll: pre.roll };
                    }
                    // 判定层姿态回退（无渲染锚点时摆放用；同因必须在 mirror 后读取）
                    const taF: Vec3 = [ (ta[0]||0),
                        (hitAtt ? hitAtt.pitch : (ta[1]||0)),
                        (hitAtt ? hitAtt.roll : (ta[2]||0)) ];
                    // ===== 世界镜像校正 =====
                    // 模块级纯函数（导出供单测镜像不变性回归）；定义见文件头 mirrorShotData。

                     // world 穿透判定标志每次进入射击复现重置（防上次会话残留）
                     window.__worldPenMode = false;
                     window.__segBoxMissing = false;
                     clearShotError();
                     deps.setWorldOverviewMode(false);   // 命中/脱靶分支各自置位（见下）
                     // 片元交叉验证上下文（doPenetrationCheck 读取）：世界模式同样提供 segment 解码字段
                     window.__shotCtx = Object.assign({}, window.__shotCtx || {}, {
                         // 弹道长度源（射击复现的"交战距离"= 服务器解码弹道折线总长）
                         shot: s,
                         segArmorGroup: s.armor_group || 0,
                         segShellId: s.shell_id || 0,
                         segResult: (typeof s.game_hit_result === 'number') ? s.game_hit_result : 255,
                         eqShooter: s.shooter_equipment || null,
                         eqTarget: s.target_equipment || null,
                     });
                     syncEquipmentCheckboxes(s);
                     // 动态装甲：弹着时刻状态由上游按 PlaybackShot.target_armor_state 预解析
                     // （None = 静态车/初态域——初态已在装甲模型装载时按声明 default 应用）。
                     // 控件与校准弹/强化装甲同模式：回放数据在场 → 自动判定 + 禁用手动。
                     const targetArmorState = s.target_armor_state;
                     if (typeof targetArmorState === 'number' && Number.isInteger(targetArmorState)) {
                         setArmorState(targetArmorState);
                     }
                     const stOpt = document.getElementById('armor-state-opt');
                     const stBox = document.getElementById('armor-state-toggle') as HTMLInputElement | null;
                     if (stOpt && stBox) {
                         // 仅动态装甲车（有声明）开放控件；静态车隐藏且禁用
                         // （review P2：无声明时 change 回调读 null.states 崩溃）
                         const dynamic = !!getArmorStateDecl();
                         stOpt.style.display = dynamic ? '' : 'none';
                         const replayAuto = typeof targetArmorState === 'number' && Number.isInteger(targetArmorState);
                         stBox.disabled = !dynamic || replayAuto;
                         stBox.title = replayAuto ? L.armorStateAutoTitle : '';
                         if (dynamic) syncArmorStateControl();
                     }
                    // 射手模型加载工厂已出仓 shotReplayPose.ts（poseShooterTurretGun /
                    // loadShooterModel 原样平移，闭包依赖经工厂参数注入）。
                    const loadShooterModel = createShooterModelFactory({
                        getTankData, getShooterData, getSelectedShell,
                        isShooterLoading: () => deps.isShooterLoading(),
                        getCurrentShooterId: () => deps.getCurrentShooterId(),
                        currentShot,
                        ml,
                        getScene,
                    });
                        // world overview：解除近距限制（原 30m 上限会吞掉远距离交战）
                        getControls().maxDistance = 1e6;
                        getControls().minDistance = 0.5;
                        // 右键 = 平移视角（地面平面），禁用手动炮塔/炮管拖拽（回放姿态由数据驱动）
                        getControls().mouseButtons.RIGHT = THREE.MOUSE.PAN;
                        getControls().screenSpacePanning = false;
                        window.__worldPan = true;
                        // ===== 脱靶弹分支：无目标模型，仅射手 + 弹道 + 落点/材质标注 =====
                        // terrain_impact（method 0x1b）提供精确落点与弹道末段起点。
                        const isMiss = !s.target_name;
                        if (isMiss) {
                            // 回放入口在目标模型装载完成后才执行；MissShotDeps 描述的是该既有不变量。
                            const missDeps = deps as ShotReplayDeps & {
                                ml: { models: { tankModel: THREE.Object3D; armorModel: THREE.Object3D } };
                            };
                            renderMissShotAnnotation(missDeps, { s, currentShot, QP, loadShooterModel, poseShooterTurretGun });
                        }
                        if (!isMiss) {
                        dbgReset();
                        const tPos = s.target_pos;           // 目标命中时刻位置（世界系绝对坐标）
                        if (!tPos) { showShotError('受击弹缺少目标位置（target_pos），射击复现已阻断'); return; }
                        const tankModel = ml.models.tankModel, armorModel = ml.models.armorModel;
                        if (!tankModel || !armorModel) {
                            showShotError('目标模型未就绪（模型装配异常），射击复现已阻断');
                            return;
                        }
                        const sTS = s.shooter_tick_samples || [];
                        // 射手开火时刻采样：优先 |dt| 最小者（首条 |dt|<0.1 可能是更早样本，
                        // terrain 俯仰/侧倾与开火时刻差数度）；无窗内样本才回退首条
                        const sHit = sTS.reduce((a, b) =>
                            (Math.abs(b.dt ?? NaN) < Math.abs(a.dt ?? NaN)) ? b : a,
                            sTS[0] as PoseTickSample);
                        const shooterWorld = s.shooter_render ? s.shooter_render.pos
                            : (sHit ? sHit.pos : s.shooter_pos);   // 射手开火时刻位置（渲染锚点优先）
                        if (!shooterWorld) { showShotError('受击弹缺少射手位置（shooter_pos），射击复现已阻断'); return; }

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
                        const rt = s.target_render;
                        const baseT = rt ? rt.pos : tPos;
                        const angT = rt ? rt.ang : taF;
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
                        rig.updateTurretGun(turretDegT, window.__fireGunDegT);

                        // 射手模型：加载并放置（loadShooterModel 工厂，并行取 /api/tank 供炮塔/炮管枢轴）
                        const shooterTid = parseInt(QP.get('shooter') || '', 10);
                        if (shooterTid > 0) {
                            loadShooterModel(shooterTid, {
                                castShadow: true,
                                logTag: '[world]',
                                applyPose: function(sModel) {
                                    // 射手渲染锚点优先（与受击方同一渲染层语义）；无则 type10 直通
                                    const sR = s.shooter_render;
                                    const sYaw = sR ? sR.ang[0] : (sHit ? sHit.yaw : 0);
                                    sModel.quaternion.copy(poseFromYPR(sYaw,
                                        sR ? sR.ang[1] : (sHit ? (sHit.pitch ?? 0) : 0),
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
                                if (!res || !currentShot()) return;
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
                                    sR2 ? sR2.ang[1] : (sHit ? (sHit.pitch ?? 0) : 0),
                                    sR2 ? sR2.ang[2] : (sHit ? sHit.roll : 0), sgp, sRel, s.shooter_config_idx);
                                installShooterMuzzleMarker(sModel, breechGunLocal,
                                    { cx, cy, cz, getScene, dbgInfo, fmt3 });
                                // 注册全局引用（滑块/炮口标记/基准点标注消费）
                                window.__shooterModel = sModel;
                                window.__shooterData = sd;
                                // 射手模型就位后刷新基准点标注（创建时模型可能尚未加载）
                                if (window.__updateAnchorMarkers) window.__updateAnchorMarkers();
                            });
                        }

                        // 弹道原始数据（method29 launchPoint + method20 终点，世界系绝对坐标）
                        const ba = s.ball_a, bb = s.ball_b;
                        installAnchorMarkers({ cx, cy, cz, getScene, dbgInfo, fmt3 }, tankModel);
                        if (window.__worldAnno) { getScene().remove(window.__worldAnno); }
                        window.__worldAnno = new THREE.Group();
                        // tick 切换重算弹着点所需的射线上下文（在弹道块内赋值）。
                        // 击穿判定射线方向用【弹道弦向量】(ball_b − ball_a)而非初速向量——
                        // 弦已包含重力下坠，与命中终点自洽；launch_velocity 保留作初速
                        // 方向可视化(青虚线)与炮管仰角反解。
                        // 轨迹可视化开关（2026-09-24 用户指令）：命中弹判定已切换到
                        // DecodeShotSegment P1/P2 基准——弦/发射点/速度/终点/来向可视化隐藏；
                        // 脱靶弹无 P1/P2，弹道线是其核心复现内容，保持显示。
                        const SHOW_TRAJ_ANNO = (shotResultClass(s) === 'MISS');
                        const trajCtx = buildTrajectoryAnnotation(
                            { s, cx, cy, cz, armorModel, dbgInfo, fmt3 }, ba ?? undefined, bb ?? undefined, SHOW_TRAJ_ANNO);
                        const ctxLaunch = trajCtx.ctxLaunch;
                        const ctxLvDir = trajCtx.ctxLvDir;
                        const ctxLvSpd = trajCtx.ctxLvSpd, ctxRayFar = trajCtx.ctxRayFar;
                        if (ba && bb) {
                                // ④' DecodeShotSegment 出入点标注 + 判定射线（已出仓 shotReplaySeg.ts）。
                                installSegmentJudgment({
                                    s, cx, cy, cz, armorModel, getScene, dbgInfo, fmt3,
                                    getTankData, rig, tc, showShotError, currentShot,
                                    getTurretDeg, getGunDeg,
                                });
                        }
                        // ⑥ 游戏弹孔视角 = 炮口侧后上方 3/4 视角（已出仓 shotReplaySeg.ts）。
                        placeImpactCamera({ cx, cy, cz, getCamera, getControls },
                            ba ?? undefined, bb ?? undefined, ctxLaunch, tPos, shooterWorld!);
                        getControls().update();

                        getScene().add(window.__worldAnno);

                        // ===== world 模式穿透判定（相对模式同源管线）=====
                        // 真实炮口射线 → doPenetrationCheck → /api/penetrate。worldPenMode 开启后
                        // check 内部把世界系交点/射线经 worldToLocal 换算成模型局部米制，结果与相对模式同源。
                        window.__worldPenMode = true;
                        deps.setWorldOverviewMode(true);   // 命中 world 同置（补偿门控，review 2026-10-13）
                        window.__shotIsHit = true;   // 0 armor hits 时 doPenetrationCheck 走报错分支
                        // ===== tick 位移方向标注（默认开启，"移动方向"复选框可关）=====
                        // 车体底部平面（type10 高度 +0.1m）：青线 = 相邻 tick 位移路径；同一基点并排
                        // 两支箭头（消除透视视差）：青 = 位移方向，绿/橙/黄 = 履带朝向（按位移方向着色）。
                        // 三者均取真实 3D 方向（含俯仰）——只做水平投影会与倾斜模型出现视角差；
                        // 前进/倒车/转向分类仍用水平方位角（atan2(dx,dz) vs yaw）。
                        if (window.__moveAnno) { getScene().remove(window.__moveAnno); }
                        const moveAnno = new THREE.Group();
                        window.__moveAnno = moveAnno;
                        const tksD = s.tick_samples || [];
                        const moveDirColor = (i: number): number => {
                            if (i <= 0) return 0xffdd33;
                            const dx = tksD[i].pos[0]-tksD[i-1].pos[0], dz = tksD[i].pos[2]-tksD[i-1].pos[2];
                            if (Math.sqrt(dx*dx + dz*dz) < 0.05) return 0xffdd33;
                            let e = Math.abs(Math.atan2(dx, dz) - tksD[i].yaw) % (2*Math.PI);
                            if (e > Math.PI) e = 2*Math.PI - e;
                            const deg = e*180/Math.PI;
                            return deg < 60 ? 0x33ff66 : (deg > 120 ? 0xff6622 : 0xffdd33);
                        };
                        const setArrowDepthTestOff = (m: THREE.Material | THREE.Material[]): void => {
                            (Array.isArray(m) ? m : [m]).forEach(function(mt) { mt.depthTest = false; });
                        };
                        const mkMoveArrow = (len: number, color: number): THREE.ArrowHelper => {
                            const arr = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1),
                                new THREE.Vector3(), len, color, 0.55, 0.3);
                            setArrowDepthTestOff(arr.line.material);
                            setArrowDepthTestOff(arr.cone.material);
                            arr.renderOrder = 996;
                            return arr;
                        };
                        const moveArrow = mkMoveArrow(3.0, 0xffdd33);        // 履带朝向
                        const moveVecArrow = mkMoveArrow(2.2, 0x00ccff);     // 位移方向
                        window.__moveArrow = moveArrow;
                        window.__moveVecArrow = moveVecArrow;
                        moveAnno.add(moveArrow);
                        moveAnno.add(moveVecArrow);
                        // 两支箭头跟随视觉模型：同基点（车底右侧 3m）并排、间隔 0.9m
                        window.updateMoveArrow = function(idx: number): void {
                            if (!tksD[idx]) return;
                            const ts = tksD[idx];
                            const q = poseFromYPR(ts.yaw, ts.pitch ?? 0, ts.roll);
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
                            moveArrow.position.copy(base).addScaledVector(side, 0.9);
                            moveVecArrow.position.copy(base).addScaledVector(side, -0.9);
                            moveArrow.setDirection(fwd);
                            moveArrow.setColor(moveDirColor(idx));
                            // 位移方向箭头 = 进入当前 tick 的线段方向（真实 3D，含爬坡升降）
                            if (idx > 0) {
                                const p0 = tksD[idx-1];
                                const mv = new THREE.Vector3(
                                    ts.pos[0]-p0.pos[0], ts.pos[1]-p0.pos[1], ts.pos[2]-p0.pos[2]);
                                if (mv.lengthSq() > 0.0025) {
                                    moveVecArrow.visible = true;
                                    moveVecArrow.setDirection(mv.normalize());
                                } else {
                                    moveVecArrow.visible = false;
                                }
                            } else {
                                moveVecArrow.visible = false;
                            }
                        };
                        tksD.forEach((ts: PoseTickSample, i: number): void => {
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
                            moveAnno.add(ln);
                            const dx = ts.pos[0]-p0.pos[0], dz = ts.pos[2]-p0.pos[2];
                            if (Math.sqrt(dx*dx + dz*dz) >= 0.05) {
                                const dd = Math.sqrt(dx*dx + dz*dz);
                                const v = dd/Math.max(1e-3, (ts.dt ?? 0) - (p0.dt ?? 0));
                                const mvAz = Math.atan2(dx, dz);
                                let e = Math.abs(mvAz - ts.yaw) % (2*Math.PI);
                                if (e > Math.PI) e = 2*Math.PI - e;
                                e = e*180/Math.PI;
                                console.log('[move] dt=%+f yaw=%s° move=%s° err=%s° v=%sm/s %s',
                                    (ts.dt ?? 0).toFixed(3), (ts.yaw*180/Math.PI).toFixed(1),
                                    (mvAz*180/Math.PI).toFixed(1), e.toFixed(1), v.toFixed(1),
                                    e < 60 ? '前进' : (e > 120 ? '倒车' : '转向'));
                            } else {
                                console.log('[move] dt=%+f yaw=%s° pivot/静止',
                                    (ts.dt ?? 0).toFixed(3), (ts.yaw*180/Math.PI).toFixed(1));
                            }
                        });
                        window.updateMoveArrow(tksD.length - 1);   // 初始 = 命中锚点 tick
                        getScene().add(moveAnno);
                        // 面板数字摘要：当前窗口内 位移vs朝向 偏差（中位/最大，排除倒车段）
                        {
                            const errs: number[] = [];
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
                        const st = document.getElementById('turret-controls');
                        const cls2 = shotResultClass(s) === 'MISS' ? 'MISS'
                            : (shotResultClass(s) === 'RICOCHET') ? 'RICO'
                            : (shotResultClass(s) === 'PENETRATION') ? 'PEN'
                            : (shotResultClass(s) === 'HE BLAST') ? 'HE'
                            : (shotResultClass(s) === 'UNVERIFIED') ? 'R4?'
                            : (shotResultClass(s) === 'NO PENETRATION') ? 'NOPEN' : 'HIT';
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
                            window.__worldIsHE = !!((s.hit_flags || 0) & 0x1000);
                            window.__worldShellId = (typeof s.shell_id === 'number' && s.shell_id) ? s.shell_id : null;
                            {
                                const sel = document.getElementById('shell-select') as HTMLSelectElement | null;
                                let want = -1;
                                if (window.__worldIsHE) {
                                    want = (getShooterShells() || []).findIndex(sh =>
                                        shellTypeOf(sh) === 'he' || (sh && (sh.explosion_radius || 0) > 0));
                                }
                                if (want < 0 && window.__worldShellId) {
                                    // 射手配置弹表全局 id：configs[].shell_global_ids（与弹表
                                    // 同源同序）。优先 &scfg=（射手实际搭载配置，下拉表即其
                                    // shells，下标同域）；未命中再全配置扫（顶级偏好）
                                    const shooterData = getShooterData();
                                    const cfgArr = (shooterData && shooterData.configs) || null;
                                    const scfg = parseInt(QP.get('scfg') || '', 10);
                                    const tryGids = (gids: number[] | null): void => {
                                        if (!gids || want >= 0) return;
                                        const shellGlobalId = window.__worldShellId;
                                        if (shellGlobalId == null) return;
                                        const gi = gids.indexOf(shellGlobalId);
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
                                if (want < 0 && window.__worldShellId == null) {
                                    want = window.__worldShellSlot ?? -1;
                                }
                                const pickedShell = getShooterShells()[want];
                                if (sel && pickedShell && want >= 0 && want < sel.options.length) {
                                    sel.value = String(want);
                                    setSelectedShell(pickedShell);
                                    if (getPenetrationMode() || hm.getPrimaryArmorScene()) {
                                        hm.updatePenetrationUniforms(getSelectedShell());
                                        hm.updateSpacedUniforms(getSelectedShell());
                                    }
                                    hm.syncHeatOverlay();
                                }
                            }
                        }
                        if (st) { st.innerHTML = shotErrorHtml() + '<div class="ctrl-row"><b>World View — Shot #' + s.index + '</b></div>' +
                            (function() {
                                const t4 = s.is_author ? '作者' : (s.shooter_team === 'enemy' ? '敌方' : (s.shooter_team === 'ally' ? '我方' : ''));
                                return '<div class="ctrl-row">Shooter: <b style="color:var(--yellow);">' + (s.shooter_name || '—') + '</b>' + (t4 ? ' · ' + t4 : '') + '</div>' +
                                    '<div class="ctrl-row" style="font-size:10px;">搭载: 射手 ' + eqBadge(s.shooter_equipment) +
                                    (s.target_equipment || s.game_hit_result !== undefined ? ' · 目标 ' + eqBadge(s.target_equipment) : '') + '</div>';
                            })() +
                            '<div class="ctrl-row">DMG ' + s.damage + ' · ' + cls2 + ' · ' + (s.target_name || '—') + '</div>' +
                            (function() {
                                if (s.shell_id == null) return '';
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
                                const tlDt = (s.target_render_timeline || []).map(t => t.dt ?? NaN);
                                const sTlDt = (s.shooter_render_timeline || []).map(t => t.dt ?? NaN);
                                const allDt: number[] = ([] as number[]).concat(
                                    tksW.filter(t => !t.render).map(t => t.dt ?? NaN),
                                    sTS.filter(t => !t.render).map(t => t.dt ?? NaN),
                                    tlDt, sTlDt
                                ).filter((d): d is number => !isNaN(d));
                                if (allDt.length < 2) return '';
                                const tMin = Math.min(...allDt);
                                const tMax = Math.max(...allDt);
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
                        const mt2 = document.getElementById('move-toggle') as HTMLInputElement | null;
                        if (mt2) mt2.onchange = function() {
                            const anno = window.__moveAnno;
                            if (anno) anno.visible = mt2.checked;
                        };
                        // ===== 开发诊断（默认关闭）：收纳 World View 面板 + 全部调试标注 =====
                        // 可见性集中挂 window.__debugSetVisible。
                        const stEl = document.getElementById('turret-controls');
                        if (stEl) stEl.style.display = 'none';
                        setupShotDebug(function() {
                            // 基准点标注可见性（位置由 __updateAnchorMarkers 维护）
                            if (window.__updateAnchorMarkers) window.__updateAnchorMarkers();
                        });
                        // 相对视角按钮：相机 = 当前位姿的弦命中点沿入射反方向回退 15m（与
                        // showTrajectory 轨迹原点回退距离同语义），看向命中点；弦未命中当前位姿
                        // 时看向车体中心。「双方位置」恢复全景。判定/标注不受影响（弦判定与相机无关）。
                        let impactViewOn = false;
                        let savedOverview: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
                        const viewSwitch = document.createElement('div');
                        viewSwitch.className = 'armor-shot-view-switch';
                        viewSwitch.setAttribute('role', 'group');
                        viewSwitch.setAttribute('aria-label', L.shotView);
                        const relBtn = document.createElement('button');
                        relBtn.id = 'rel-view-toggle';
                        relBtn.textContent = L.relativeView;
                        relBtn.type = 'button';
                        relBtn.className = 'armor-scene-button';
                        const worldBtn = document.createElement('button');
                        worldBtn.id = 'world-view-toggle';
                        worldBtn.textContent = L.worldView;
                        worldBtn.type = 'button';
                        worldBtn.className = 'armor-scene-button';
                        function setImpactView(on: boolean): void {
                            if (on === impactViewOn) return;
                            if (on) {
                                const ctx = window.__worldTickCtx;
                                if (!ctx?.launch || !ctx.lvDir || !armorModel || !tankModel) return;
                                savedOverview = { pos: getCamera().position.clone(), target: getControls().target.clone() };
                                const dir = ctx.lvDir.clone().normalize();
                                let aim = tankModel.position.clone();
                                const rc = new THREE.Raycaster(ctx.launch.clone(), dir);
                                rc.far = ctx.rayFar;
                                const hits = rc.intersectObject(armorModel, true)
                                    .filter(h => h.object.userData.armorSection !== 'deco');
                                if (hits.length) aim = hits[0].point.clone();
                                getCamera().position.copy(aim.clone().addScaledVector(dir, -15));
                                getControls().target.copy(aim);
                            } else if (savedOverview) {
                                getCamera().position.copy(savedOverview.pos);
                                getControls().target.copy(savedOverview.target);
                            }
                            // 相对命中视角 = 单车取景（15m/18.75° 标定）；双方位置恢复 50° 总览。
                            deps.setWorldOverviewMode(!on);
                            getControls().update();
                            impactViewOn = on;
                            relBtn.setAttribute('aria-pressed', String(on));
                            worldBtn.setAttribute('aria-pressed', String(!on));
                        }
                        relBtn.setAttribute('aria-pressed', 'false');
                        worldBtn.setAttribute('aria-pressed', 'true');
                        // MISS 没有命中点可聚焦：相对视角按钮禁用，保持 world 总览。
                        relBtn.disabled = !window.__shotIsHit || !window.__worldTickCtx?.launch || !window.__worldTickCtx?.lvDir;
                        relBtn.onclick = () => setImpactView(true);
                        worldBtn.onclick = () => setImpactView(false);
                        viewSwitch.append(relBtn, worldBtn);
                        (document.getElementById('corner-br') || document.body).appendChild(viewSwitch);
                        // 命中弹默认进入命中点相对视角（15m/18.75° 标定，与装甲查看器
                        // 一致）；MISS 没有命中点，保持双方位置 world 总览（原生 50°）。
                        // 用户可随时用「双方位置 / 相对视角」切换，切换时同步 FOV 模式。
                        if (window.__shotIsHit) setImpactView(true);
                        else setImpactView(false);
                        // 初始即按撤回状态隐藏全部标注（须在 debug=1 自动开启之前，否则被覆盖）
                        const debugSetVisible = window.__debugSetVisible;
                        if (debugSetVisible) debugSetVisible(false);
                        // URL debug=1 显式开启开发诊断标注
                        if (QP.get('debug') === '1' && debugSetVisible) {
                            debugSetVisible(true);
                        }
                        // ===== 时间滑块：连续插值双模型位置/姿态（报告 §4.7 渲染层锚点可视化） =====
                        const timeSlider = document.getElementById('time-scrub') as
                            (HTMLInputElement & { __penTimer?: ReturnType<typeof setTimeout> | null }) | null;
                        if (timeSlider) {
                            // 滑块 0 点 = 渲染位（玩家所见）：存在渲染位采样时，用它替换
                            // dt≈0 的原始锚点采样作为插值关键帧——否则拖动滑块回 0 会回到
                            // 判定层锚点位姿，与初始的渲染位姿相差一个滤波滞后位移。
                            const rSample = (s.tick_samples || []).find(function(t) { return t.render; });
                            // 剔除命中后（dt>0）的兜底采样：数据包源切换致瞬移/朝向跳变
                            //（96 段实测 40 段反转），混入滑块末端 keyframe 会产生翻转行为
                            let vRaw = (s.tick_samples || []).filter(function(t) {
                                return !t.render && (t.dt ?? NaN) <= 0.001 && Math.abs(t.dt ?? NaN) > 0.025; });
                            if (rSample) {
                                vRaw.push({ dt: rSample.dt, pos: rSample.pos, yaw: rSample.yaw,
                                    pitch: rSample.pitch, roll: rSample.roll, render: true });
                                vRaw.sort(function(a, b) { return (a.dt ?? 0) - (b.dt ?? 0); });
                            }
                            const sRaw = (s.shooter_tick_samples || []).filter(function(t) { return !t.render; });
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
                                const dt = parseInt(timeSlider.value, 10) / 1000;
                                const lbl = document.getElementById('time-scrub-label');
                                if (lbl) lbl.textContent = (dt >= 0 ? '+' : '') + dt.toFixed(2) + 's';
                                // 覆盖检查：滤波时间线未覆盖的时段 = 该实体在录像客户端无 volatile
                                // 数据（AoI 外不渲染）——滑块拖入该区间时隐藏模型与附属标记
                                const inCovT = !tlT || (dt >= (tlT[0].dt ?? 0) - 0.001
                                    && dt <= (tlT[tlT.length - 1].dt ?? 0) + 0.001);
                                const inCovS = !tlS || (dt >= (tlS[0].dt ?? 0) - 0.001
                                    && dt <= (tlS[tlS.length - 1].dt ?? 0) + 0.001);
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
                                // 炮塔/炮管实时：prop2（炮塔相对角）与 prop9（俯仰）时间线插值（shotReplayInterp）
                                // 受击方炮塔实时：prop2 相对角直接驱动炮塔/炮管节点。
                                // 时间线存游戏系相对角；镜像场景节点旋转角须取负（镜像翻转
                                // 旋转方向）——与初始摆放一致：turretDegT = 镜像炮塔角−镜像车体角 = −rel
                                // 炮管俯仰：target_gun_timeline（prop2 frac 解码，弧度）插值，
                                // 缺时间线时回落命中时刻静态值 __fireGunDegT
                                const relT = lerpTlAngle(s.target_turret_timeline ?? null, dt);
                                if (relT != null) {
                                    let deg = -relT * 180 / Math.PI;
                                    deg = ((deg + 180) % 360 + 360) % 360 - 180;
                                    const gpT = lerpTl(s.target_gun_timeline ?? null, dt);
                                    rig.updateTurretGun(deg, gpT != null ? gpT * 180 / Math.PI
                                        : (window.__fireGunDegT != null ? window.__fireGunDegT : 0));
                                }
                                // 射手方炮塔实时：炮塔世界角 = 车体 yaw − prop2 相对角
                                //（内部 tr = 炮塔角−车体角 = −rel，同初始摆放的镜像系约定）
                                const relS = lerpTlAngle(s.shooter_turret_timeline ?? null, dt);
                                if (sInt && window.__shooterModel && window.__shooterData) {
                                    // 射手炮塔实时：用射手自身的车体位姿（sInt），非受击方的 vInt
                                    // 炮管相对俯仰：shooter_gun_timeline（prop2 frac 解码）插值——
                                    // 与受击方同源同锚定（车体俯仰由 sInt.pitch 时序承载，
                                    // 两者是不同自由度）。无时间线（无锚定/回退）时传 null →
                                    // 弹速反解（method29 弹速仅开火帧存在，窗口内恒定保持）。
                                    const gpS = (s.quality && s.quality.gun_pitch_degraded &&
                                        s.quality.gun_pitch_degraded.indexOf('shooter') >= 0)
                                        ? null : lerpTl(s.shooter_gun_timeline ?? null, dt);
                                    poseShooterTurretGun(window.__shooterModel, window.__shooterData,
                                        sInt.yaw - (relS || 0), s.launch_velocity, sInt.yaw, sInt.pitch ?? 0, sInt.roll,
                                        gpS != null ? gpS : null, -(relS || 0), s.shooter_config_idx);
                                }
                                if (window.__updateMuzzleMarker) window.__updateMuzzleMarker();
                                if (window.__updateAnchorMarkers) window.__updateAnchorMarkers();
                                if (window.__victimAnchor) window.__victimAnchor.mk.visible = inCovT && !!window.__debugOn;
                                if (window.__shooterAnchor) window.__shooterAnchor.mk.visible = inCovS && !!window.__debugOn;
                                if (window.__shooterMuzzleMk) window.__shooterMuzzleMk.visible = inCovS && !!window.__debugOn;
                                if (window.__shooterMuzzleLine) window.__shooterMuzzleLine.visible = inCovS && !!window.__debugOn;
                                if (window.__updateMuzzleMarker) window.__updateMuzzleMarker();
                                if (window.__updateAnchorMarkers) window.__updateAnchorMarkers();
                                // 弹着点红点随当前位姿重算（部件约束与初始摆放一致）
                                if (window.__worldTickCtx && window.__worldImpactMk && armorModel && window.__worldTickCtx.lvDir) {
                                    if (window.__worldSegMk && window.__worldSegMk.p1) {
                                        // 判定基准 = WI 同构射线（§七补7；update 内随位姿重建
                                        // 射线并重求交），红点贴射线入点（无交点回退解码点）
                                        window.__worldSegMk.update(!!window.__debugOn && inCovT);
                                        const showSeg = !!window.__debugOn && !!inCovT;
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
                                    if (!wc?.launch || !wc.lvDir) return;
                                    const rc2 = new THREE.Raycaster();
                                    rc2.set(wc.launch.clone(), wc.lvDir);
                                    rc2.far = wc.rayFar;
                                    const sPart = (typeof s.server_part_index === 'number') ? s.server_part_index : null;
                                    const partOf = (o: THREE.Object3D): number => { const u = o.userData || {}; const sec = u.armorSectionOrig || u.armorSection;
                                        return sec === 'chassis' ? 0 : sec === 'hull' ? 1 : (sec === 'turret' || sec === 'gun') ? 2 : sec === 'gunBarrel' ? 3 : -1; };
                                    let iHits = rc2.intersectObject(armorModel, true)
                                        .filter(h => h.object.userData.armorSection !== 'deco');
                                    if (sPart != null) {
                                        const inPart = iHits.filter(h => partOf(h.object) === sPart);
                                        if (inPart.length) iHits = inPart;
                                    }
                                    const show = iHits.length > 0 && !!window.__debugOn && inCovT;
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
                                        if (!currentShot()) return;
                                        const wc2 = window.__worldTickCtx;
                                        if (!wc2 || !wc2.launch || !wc2.lvDir || !armorModel) return;
                                        jc.setShotRay(wc2.launch.clone(), wc2.launch.clone().addScaledVector(wc2.lvDir, wc2.rayFar));
                                        jc.doPenetrationCheck(0, 0);
                                        jc.clearShotRay();
                                    }, 100);
                                }
                            };
                        }
                        // 弹药已在 init 中就绪；等姿态、射线、选弹与结果面板全部安装后再判定。
                        if (ctxLvDir && ctxLaunch) {
                            jc.setShotRay(ctxLaunch.clone(), ctxLaunch.clone().addScaledVector(ctxLvDir, ctxRayFar));
                            jc.doPenetrationCheck(0, 0);
                            jc.clearShotRay();
                        }
                        return;
                    }
                }).catch(e => { console.error('[shot-replay] load chain error:', e); if (currentShot()) showShotError('射击复现数据加载失败: ' + e); });
}
