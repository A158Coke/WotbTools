// 射击复现（world 模式）可视化（#820 Agent A 出仓）：双模型摆位、弹道/段线/锚点/移动
// 标注、DecodeShotSegment 出入点、连续时间滑块与 Impact/World 视角切换。
// 原 tankViewer.js applyUrlOptionsOnce 的 isShotReplay 分支整体平移；
// 回放语义、镜像约定与判定接线保持原样（window.__world* 钩子契约不变）。
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { neutralizeDefaultMetalness } from '../glbRig.js'
import { poseFromYPR } from '../glbRig.js'
import { fetchTankData, fetchReplayShots, assetProvider } from '../agentData.js'
import { mirrorShotData } from './viewerMath.js'
import { shotResultClass } from '../../utils/shotResultClass.js'
import { shellTypeOf } from './armorPlateModel.js'
import { renderMissShotAnnotation } from './shotReplayMiss.js'

/**
 * @param {object} deps composition root 注入的显式接口（host）
 * @param {object} deps.rig 炮塔 rig；deps.hm 热力图管线；deps.tc 轨迹/结果卡；deps.jc 判定链
 * @param {object} deps.ml 模型生命周期（models 引用）
 * @param {() => URLSearchParams} deps.QP 当前 location 查询（弹种/射手/scfg 每次现读）
 * @param {{ get: () => number }} deps.loadGen 模型装载代数
 * @param {() => boolean} deps.isDestroyed
 * @param {() => object|null} deps.getScene / getCamera / getControls
 * @param {() => object|null} deps.getSelectedShell / getShooterShells / getShooterData
 * @param {(shell: object|null) => void} deps.setSelectedShell
 * @param {() => boolean} deps.getPenetrationMode / getArmorStateDecl
 * @param {() => number} deps.getTurretDeg / getGunDeg
 * @param {(on: boolean) => void} deps.setWorldOverviewMode
 * @param {object} deps.L 界面文案
 * @param {() => boolean} deps.armorDebug
 * @param {() => void} deps.syncEquipmentCheckboxes 回放装备自动判定同步（equipment owner）
 * @param {() => void} deps.clearShotError / (msg) => deps.showShotError
 * @param {() => string} deps.shotErrorHtml / deps.eqBadge
 * @param {() => void} deps.dbgReset / deps.setupShotDebug
 * @param {(id,color,name,text) => void} deps.dbgInfo
 * @param {(x,y,z) => string} deps.fmt3
 * @param {(mask:number) => string[]} deps.decodeModules
 * @param {(gid:number) => object|null} deps.shellIdParts
 * @param {(s:object) => string[]} deps.srQualityIssues
 * @param {(stateId:number) => void} deps.setArmorState
 * @param {() => void} deps.syncArmorStateControl
 */
export function runShotReplay(deps) {
    const {
        rig, hm, tc, jc, ml, QP, loadGen, isDestroyed, L, getTankData,
        getScene, getCamera, getControls, getFxScene,
        getSelectedShell, setSelectedShell, getShooterShells, getShooterData,
        getPenetrationMode, getArmorStateDecl, getTurretDeg, getGunDeg,
        setWorldOverviewMode,
        syncEquipmentCheckboxes, clearShotError, showShotError,
        shotErrorHtml, eqBadge, dbgReset, setupShotDebug, dbgInfo, fmt3,
        decodeModules, shellIdParts, srQualityIssues,
        setArmorState, syncArmorStateControl,
    } = deps

            // 数据来源：射击复现表经 sessionStorage 交接（WotBTools 纯客户端链），
                // 无交接回退 Agent 自托管 /api/replay_shot（agentData.fetchReplayShots）
                const shotGen = deps.loadGen.get();
                const currentShot = () => !deps.isDestroyed() && shotGen === deps.loadGen.get();
                fetchReplayShots().then(d => {
                    if (!currentShot()) return;
                    const shots = d.shots || d;
                    const s = (Array.isArray(shots) ? shots : []).find(x => x.index === parseInt(QP.get('shot'), 10));
                    if (!s) { showShotError('shot #' + parseInt(QP.get('shot'), 10) + ' 不存在（接口返回 ' + (Array.isArray(shots) ? shots.length : 0) + ' 发）'); return; }
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
                     if (Number.isInteger(s.target_armor_state)) {
                         setArmorState(s.target_armor_state);
                     }
                     const stOpt = document.getElementById('armor-state-opt');
                     const stBox = document.getElementById('armor-state-toggle');
                     if (stOpt && stBox) {
                         // 仅动态装甲车（有声明）开放控件；静态车隐藏且禁用
                         // （review P2：无声明时 change 回调读 null.states 崩溃）
                         const dynamic = !!getArmorStateDecl();
                         stOpt.style.display = dynamic ? '' : 'none';
                         const replayAuto = Number.isInteger(s.target_armor_state);
                         stBox.disabled = !dynamic || replayAuto;
                         stBox.title = replayAuto ? L.armorStateAutoTitle : '';
                         if (dynamic) syncArmorStateControl();
                     }
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
                    // poseFromYPR = 共享 rig（getScene()/glbRig.js）
                    // 射手模型加载工厂（原命中/脱靶两分支大段重复：并行 fetch /api/tank +
                    // GLTFLoader 加载 → applyPose 摆位 → 炮闩 bake 前捕获 → 半透明材质克隆
                    // → getScene().add）。resolve({ sd, sModel, breechGunLocal })；GLB 加载失败
                    // resolve(null)。分支差异参数化：logTag（日志前缀）、castShadow
                    // （命中分支网格投影阴影，脱靶分支不投影）、applyPose（各自位姿闭包）。
                    // applyPose 必须在炮闩捕获前调用——breechGunLocal 依赖模型当前世界矩阵。
                    function loadShooterModel(tid, opts) {
                        const castShadow = !!(opts && opts.castShadow);
                        const logTag = (opts && opts.logTag) || '[world]';
                        // URL 前缀跟随目标模型（Web 服务挂 /armor_view/glb/...，独立 viewer 挂 /glb/...，
                        // 硬编码 /glb/ 在 Web 下 404）；/api/tank 不手动拼前缀——viewer_index_html
                        // 已对字面量 '/api/ 加前缀，手动拼会双重前缀 404。
                        const shooterGlbUrl = assetProvider.url(getTankData().visual_model_url.replace(/\/glb\/\d+\//, '/glb/' + tid + '/'));
                        // 目标重试会恢复射手模型；同一射手的车辆 JSON 已随弹药加载，直接复用。
                        // 射手正在切换或本发属于另一辆车时，仍按本发车型独立获取。
                        const reuseShooterData = getShooterData() && getSelectedShell() && !deps.isShooterLoading()
                            && String(deps.getCurrentShooterId()) === String(tid);
                        return Promise.all([
                            reuseShooterData ? Promise.resolve(getShooterData()) : fetchTankData(tid).catch(() => null),
                            new Promise(function(res) {
                                new GLTFLoader().load(shooterGlbUrl,
                                    function(g) { res(g); }, undefined, function() { res(null); });
                            }),
                        ]).then(function(arr) {
                            const sd = arr[0], gltf = arr[1];
                            if (!currentShot()) { ml.disposeDetachedModel(gltf?.scene); return null; }
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
                            getScene().add(sModel);
                            return { sd: sd, sModel: sModel, breechGunLocal: breechGunLocal };
                        });
                    }
                        // world overview：解除近距限制（原 30m 上限会吞掉远距离交战）
                        getControls().maxDistance = 1e6;
                        getControls().minDistance = 0.5;
                        // 右键 = 平移视角（地面平面），禁用手动炮塔/炮管拖拽（回放姿态由数据驱动）
                        getControls().mouseButtons.RIGHT = THREE.MOUSE.PAN;
                        getControls().screenSpacePanning = false;
                        window.__worldPan = true;
                        // ===== 脱靶弹分支：无目标模型，仅射手 + 弹道 + 落点/材质标注 =====
                        // terrain_impact（method 0x1b）提供精确落点与弹道末段起点。
                        const isMiss = !s.target_name;                        renderMissShotAnnotation(deps, { s, currentShot, QP, loadShooterModel, poseShooterTurretGun });
                        if (s.target_name) {
                        dbgReset();
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
                        ml.models.tankModel.position.set(baseT[0] - cx, baseT[1] - cy, baseT[2] - cz);
                        const qT = poseFromYPR(angT[0], angT[1], angT[2]);
                        ml.models.tankModel.quaternion.copy(qT);
                        // 热力图/碰撞模型必须与视觉模型同位同姿——position 只在
                        // 首帧缺失会导致装甲模型留在原点
                        ml.models.armorModel.position.copy(ml.models.tankModel.position);
                        ml.models.armorModel.quaternion.copy(qT);
                        ml.models.tankModel.updateMatrixWorld(true);
                        ml.models.armorModel.updateMatrixWorld(true);

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
                                            getScene().add(mk);
                                            window.__shooterMuzzleMk = mk;
                                            // 对照线:炮闩(文件标定) ⇄ 服务器发射点(橙色 LaunchPoint),
                                            // 白色虚线,长度即两套数据的偏差——随 tick 重算一起更新
                                            const dline = new THREE.Line(
                                                new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
                                                new THREE.LineDashedMaterial({
                                                    color: 0xffffff, transparent: true, opacity: 0.8,
                                                    dashSize: 0.35, gapSize: 0.25, depthTest: false }));
                                            dline.renderOrder = 996;
                                            getScene().add(dline);
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
                            getScene().add(mk);
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
                            upd(window.__victimAnchor, ml.models.tankModel, 'dbg-anchor-victim', '基准点·受击');
                            upd(window.__shooterAnchor, window.__shooterModel, 'dbg-anchor-shooter', '基准点·射手');
                        };
                        window.__updateAnchorMarkers();
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
                            window.__worldAnno.add(trajLine);   // 随调试开关收纳(原 getScene() 直挂漏显)
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
                            if (ml.models.armorModel) {
                                const sPart = (typeof s.server_part_index === 'number') ? s.server_part_index : null;
                                const partOf = o => { const u = o.userData || {}; const sec = u.armorSectionOrig || u.armorSection;
                                    return sec === 'chassis' ? 0 : sec === 'hull' ? 1 : (sec === 'turret' || sec === 'gun') ? 2 : sec === 'gunBarrel' ? 3 : -1; };
                                const rc2 = new THREE.Raycaster();
                                rc2.set(lpM.position.clone(), chordDir);
                                rc2.far = Math.max(chordLen * 1.1, 20);
                                const allHits = rc2.intersectObject(ml.models.armorModel, true)
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
                                // 盒源：game_data collision.*_bbox（客户端 Parameters YAML 的
                                // 权威部件盒，x右/y前/z上）。盒缺失 → fail-closed，不从装甲网格
                                // 自算 AABB；部件帧：hull/chassis=模型原点、turret/gun=枢轴系。
                                // 判定射线 __segRay = {P1−0.5·方向, P1→P2 解码弦}：raycast 与
                                // 入射角同源此射线（服务器编码的位置与弹向），世界系，随位姿联动。
                                window.__worldSegMk = null;
                                window.__segRay = null;
                                // 判定段线组：独立于调试标注层（非调试模式也常显）
                                if (window.__worldSegGroup) { getScene().remove(window.__worldSegGroup); window.__worldSegGroup = null; }
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
                                    ml.models.armorModel.traverse(function(n) {
                                        if (!n.isMesh) return;
                                        const u = n.userData || {};
                                        if (u.armorSection === 'deco') return;
                                        if (sPart2 != null && partOfS(n) !== sPart2) return;
                                        partNodes.push(n);
                                    });
                                    // part 0（底盘/履带）在装甲模型无网格——回退 hull 装甲网格近似
                                    // （解码盒仍取客户端 chassis 盒，不合成）
                                    const partFallback = partNodes.length === 0 && sPart2 === 0;
                                    if (partFallback) {
                                        ml.models.armorModel.traverse(function(n) {
                                            if (!n.isMesh) return;
                                            const u = n.userData || {};
                                            if (u.armorSection === 'deco') return;
                                            if (partOfS(n) === 1) partNodes.push(n);
                                        });
                                    }
                                    const cdBoxes = (getTankData() && getTankData().collision_boxes) || null;
                                    const gameBoxRaw = cdBoxes ? (sPart2 === 0 ? cdBoxes.chassis
                                        : sPart2 === 1 ? cdBoxes.hull : sPart2 === 2 ? cdBoxes.turret
                                        : sPart2 === 3 ? cdBoxes.gun : null) : null;
                                    // 只用客户端权威部件盒；缺失时不解码/不判定（fail-closed），
                                    // 不再按装甲网格 rest 顶点自算 AABB。
                                    const boxMissing = !(gameBoxRaw && gameBoxRaw.min && gameBoxRaw.max)
                                        || partNodes.length === 0;
                                    if (!boxMissing) {
                                        const boxMin = gameBoxRaw.min, boxMax = gameBoxRaw.max;
                                        const boxFrame = (sPart2 === 2) ? 'turret-pivot' : (sPart2 === 3) ? 'gun-pivot' : 'model';
                                        const szv = [boxMax[0] - boxMin[0], boxMax[1] - boxMin[1], boxMax[2] - boxMin[2]];
                                        // 客户端 DecodeShotSegment 用 255.0f（@0x364B110）：b=0→min、
                                        // b=255→max，两端都可表示；不能用 /256（max 面永远差一步）。
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
                                        getScene().add(window.__worldSegGroup);
                                        const findPartMesh = function(re) {
                                            let found = null;
                                            ml.models.armorModel.traverse(function(n) {
                                                if (!found && n.isMesh && re.test(n.name || '')) found = n;
                                            });
                                            return found;
                                        };
                                        // 量化三元组 [右,前,高] → 场景世界坐标。炮塔/炮管件经部件
                                        // 网格世界矩阵（局部系=枢轴系，矩阵由位姿链驱动 → 标记跟随
                                        // 转角；勿用 Rz(getTurretDeg()) 手动组合，初始位姿时它为 0）
                                        const placePt = function(q) {
                                            const pl = new THREE.Vector3(qc(q[0], 0), qc(q[1], 1), qc(q[2], 2));
                                            if (boxFrame === 'turret-pivot') {
                                                const tm = findPartMesh(/^turret_\d+_armor/);
                                                if (tm) { tm.updateWorldMatrix(true, false); return tm.localToWorld(pl); }
                                                const yaw = THREE.MathUtils.degToRad(getTurretDeg());
                                                pl.applyMatrix4(new THREE.Matrix4().makeRotationZ(yaw)
                                                    .setPosition(pvT.x, pvT.y, pvT.z));
                                                return ml.models.armorModel.localToWorld(pl);
                                            }
                                            if (boxFrame === 'gun-pivot') {
                                                const gm = findPartMesh(/^gun_\d+_armor/);
                                                if (gm) { gm.updateWorldMatrix(true, false); return gm.localToWorld(pl); }
                                                const pitch = THREE.MathUtils.degToRad(getGunDeg());
                                                pl.applyMatrix4(new THREE.Matrix4().makeRotationX(pitch));
                                                const pvT = rig.getArmorPivotTurret(), pvG = rig.getArmorPivotGun();
                                                if (pvG && pvT) {
                                                    pl.add(pvG.clone().sub(pvT));
                                                    pl.applyMatrix4(new THREE.Matrix4().makeRotationZ(
                                                        THREE.MathUtils.degToRad(getTurretDeg()))
                                                        .setPosition(pvT.x, pvT.y, pvT.z));
                                                }
                                                return ml.models.armorModel.localToWorld(pl);
                                            }
                                            return ml.models.armorModel.localToWorld(pl);
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
                                                } else {
                                                    m = ml.models.armorModel.matrixWorld;
                                                }
                                                if (m) dirS = chordL.clone().transformDirection(m).normalize();
                                            }
                                            if (!dirS) {
                                                // P1==P2（点射终止，§2.1）：回退炮塔/模型反水平方向
                                                const e = (findPartMesh(/^turret_\d+_armor/) || ml.models.armorModel).matrixWorld.elements;
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
                                                    ' · 客户端部件盒');
                                            }
                                        };
                                        window.__worldSegMk = { update: updSeg, p1: mkP1, p2: mkP2 };
                                        updSeg(!!window.__debugOn);
                                        // 初始判定统一在本发姿态、选弹和面板安装完毕后执行。
                                        // 诊断挂钩：盒/量化字节（静止局部），供控制台校准轴序
                                        window.__segDiag = {
                                            hb: hb, sPart: sPart2, partFallback: partFallback,
                                            boxFrame: boxFrame,
                                            boxMin: boxMin.slice(0, 3), boxMax: boxMax.slice(0, 3),
                                            armorModel: ml.models.armorModel
                                        };
                                        // debug=1 自动开启晚于本块——延迟补一次刷新（消除加载期位姿竞态残值）
                                        setTimeout(function() {
                                            if (!currentShot()) return;
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
                                    } else {
                                        window.__segBoxMissing = true;
                                        tc.tidyTrajectory();
                                        showShotError('缺少客户端部件盒（part ' + sPart2 + '），射击复现已阻断');
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
                                getCamera().position.copy(lpM.position)
                                    .addScaledVector(perp, Math.max(lenH * 0.3, 6))
                                    .add(new THREE.Vector3(0, Math.max(lenH * 0.22, 4), 0));
                            } else {
                                getCamera().position.copy(lpM.position).add(new THREE.Vector3(0, 6, 8));
                            }
                            getControls().target.set((ba[0]+bb[0])/2 - cx, (ba[1]+bb[1])/2 - cy, (ba[2]+bb[2])/2 - cz);
                        } else {
                            // 无弹道数据回退：射手后上方看向两车中点
                            const camDist = Math.max(20, Math.sqrt(
                                (tPos[0]-shooterWorld[0])**2 + (tPos[2]-shooterWorld[2])**2) * 0.4);
                            const aimYaw = Math.atan2(tPos[0]-shooterWorld[0], tPos[2]-shooterWorld[2]);
                            getCamera().position.set(
                                shooterWorld[0] - cx + Math.sin(aimYaw) * camDist * 0.3,
                                shooterWorld[1] - cy + camDist * 0.3,
                                shooterWorld[2] - cz + Math.cos(aimYaw) * camDist * 0.3
                            );
                            getControls().target.set(0, 1, 0);
                        }
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
                        getScene().add(window.__moveAnno);
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
                            window.__worldIsHE = !!(s.hit_flags & 0x1000);
                            window.__worldShellId = (typeof s.shell_id === 'number' && s.shell_id) ? s.shell_id : null;
                            {
                                const sel = document.getElementById('shell-select');
                                let want = -1;
                                if (window.__worldIsHE) {
                                    want = (getShooterShells() || []).findIndex(sh =>
                                        shellTypeOf(sh) === 'he' || (sh && sh.explosion_radius > 0));
                                }
                                if (want < 0 && window.__worldShellId) {
                                    // 射手配置弹表全局 id：configs[].shell_global_ids（与弹表
                                    // 同源同序）。优先 &scfg=（射手实际搭载配置，下拉表即其
                                    // shells，下标同域）；未命中再全配置扫（顶级偏好）
                                    const cfgArr = (getShooterData() && getShooterData().configs) || null;
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
                                if (want < 0 && window.__worldShellId == null) {
                                    want = window.__worldShellSlot;
                                }
                                if (want != null && want >= 0 && want < sel.options.length) {
                                    sel.value = String(want);
                                    setSelectedShell(getShooterShells()[want]);
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
                        let impactViewOn = false, savedOverview = null;
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
                        function setImpactView(on) {
                            if (on === impactViewOn) return;
                            if (on) {
                                const ctx = window.__worldTickCtx;
                                if (!ctx?.launch || !ctx.lvDir || !ml.models.armorModel || !ml.models.tankModel) return;
                                savedOverview = { pos: getCamera().position.clone(), target: getControls().target.clone() };
                                const dir = ctx.lvDir.clone().normalize();
                                let aim = ml.models.tankModel.position.clone();
                                const rc = new THREE.Raycaster(ctx.launch.clone(), dir);
                                rc.far = ctx.rayFar;
                                const hits = rc.intersectObject(ml.models.armorModel, true)
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
                        window.__debugSetVisible(false);
                        // URL debug=1 显式开启开发诊断标注
                        if (QP.get('debug') === '1') {
                            window.__debugSetVisible(true);
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
                                if (vInt && ml.models.tankModel) {
                                    const wp = useTlT
                                        ? [vInt.pos[0] - cx, vInt.pos[1] - cy, vInt.pos[2] - cz]
                                        : [vInt.pos[0] + tPos[0] - cx, vInt.pos[1] + tPos[1] - cy, vInt.pos[2] + tPos[2] - cz];
                                    ml.models.tankModel.position.set(wp[0], wp[1], wp[2]);
                                    ml.models.tankModel.quaternion.copy(poseFromYPR(vInt.yaw, vInt.pitch, vInt.roll));
                                    ml.models.tankModel.updateMatrixWorld(true);
                                    if (ml.models.armorModel) {
                                        ml.models.armorModel.position.copy(ml.models.tankModel.position);
                                        ml.models.armorModel.quaternion.copy(ml.models.tankModel.quaternion);
                                        ml.models.armorModel.updateMatrixWorld(true);
                                    }
                                    ml.models.tankModel.visible = inCovT;
                                    if (ml.models.armorModel) ml.models.armorModel.visible = inCovT;
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
                                    rig.updateTurretGun(deg, gpT != null ? gpT * 180 / Math.PI
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
                                if (window.__worldTickCtx && window.__worldImpactMk && ml.models.armorModel && window.__worldTickCtx.lvDir) {
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
                                    let iHits = rc2.intersectObject(ml.models.armorModel, true)
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
                                if (window.__worldSegMk && ml.models.armorModel) {
                                    ml.models.armorModel.updateWorldMatrix(true, false);
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
                                        if (!wc2 || !wc2.lvDir || !ml.models.armorModel) return;
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
