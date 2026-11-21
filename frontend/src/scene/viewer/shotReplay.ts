// 射击复现（world 模式）可视化（#820 Agent A 出仓）：双模型摆位、弹道/段线/锚点/移动
// 标注、DecodeShotSegment 出入点、连续时间滑块与 Impact/World 视角切换。
// 原 tankViewer.js applyUrlOptionsOnce 的 isShotReplay 分支整体平移；
// 回放语义、镜像约定与判定接线保持原样（window.__world* 钩子契约不变）。
import * as THREE from 'three'
import { poseFromYPR } from '../glbRig.js'
import { fetchReplayShots } from '../agentData.js'
import { createShooterModelFactory, poseShooterTurretGun } from './shotReplayPose.js'
import { buildTrajectoryAnnotation, installAnchorMarkers, installShooterMuzzleMarker, placeImpactCamera } from './shotReplaySeg.js'
import { autoSelectReplayShell, buildMoveAnnotation, buildWorldPanelHtml, installViewSwitch } from './shotReplayPanel.js'
import { installTimeScrubHandler } from './shotReplayScrub.js'
import { installSegmentJudgment } from './judgment.js'
import { mirrorShotData } from './viewerMath.js'
import { shotResultClass } from '../../utils/shotResultClass.js'
import { renderMissShotAnnotation } from './shotReplayMiss.js'
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
                        buildMoveAnnotation({ s, tPos, cx, cy, cz, getScene });

                        // ===== 弹道判定上下文（精简）：弦起点/方向/长度供相对视角按钮、
                        // 滑块弹着点重算与弦判定重跑共用（原 tick 双下拉已移除，位姿调整
                        // 统一走连续时间滑块）=====
                        window.__worldTickCtx = {
                            launch: ctxLaunch, lvDir: ctxLvDir, lvSpd: ctxLvSpd, rayFar: ctxRayFar,
                        };
                        const st = document.getElementById('turret-controls');
                        if ((s.tick_samples || []).length > 1) autoSelectReplayShell({
                            s, QP, getShooterShells, getShooterData, setSelectedShell,
                            getSelectedShell, getPenetrationMode, hm,
                        });
                        if (st) st.innerHTML = buildWorldPanelHtml({
                            s, shotErrorHtml, eqBadge, shellIdParts, decodeModules,
                            srQualityIssues, sTS,
                        });
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
                        installViewSwitch({ QP, L, tankModel, armorModel, getCamera, getControls,
                            setWorldOverviewMode: (on) => deps.setWorldOverviewMode(on) });
                        installTimeScrubHandler({
                            s, QP, L, cx, cy, cz, tPos, tankModel, armorModel, rig, jc,
                            getScene, getCamera, getControls, currentShot, dbgInfo, fmt3,
                        });
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
