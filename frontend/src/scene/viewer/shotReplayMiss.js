// 射击复现·脱靶分支可视化（#820 Agent A 出仓）：terrain_impact 落点/弹跳标注、
// 射手模型摆放与脱靶信息面板。原 shotReplay 命中/脱靶分支共享上下文经 ctx 注入。
import * as THREE from 'three'
import { poseFromYPR } from '../glbRig.js'
import { shotResultClass } from '../../utils/shotResultClass.js'
import { shellTypeOf } from './armorPlateModel.js'

/**
 * @param {object} deps runShotReplay 的同一 host 依赖对象（见 viewer/shotReplay.js）
 * @param {object} ctx { s, currentShot }
 */
export function renderMissShotAnnotation(deps, ctx) {
    const { s, currentShot, loadShooterModel, poseShooterTurretGun } = ctx
    const { ml, rig, hm, tc, jc, QP } = deps

                        // 脱靶同样是 world 总览：dolly 补偿必须关闭（review：此前只在命中
                        // 路径置 __worldPenMode，MISS 提前返回漏置 → 远距落点裁出视锥）
                        deps.setWorldOverviewMode(true);
                        const sTS2 = s.shooter_tick_samples || [];
                        const sHit2 = sTS2.reduce((a, b) =>
                            (Math.abs(b.dt) < Math.abs(a.dt)) ? b : a, sTS2[0]);
                        const shooterPos2 = sHit2 ? sHit2.pos : s.shooter_pos;
                        const ba = s.ball_a || null, bb = s.ball_b || null;
                        if (!ba || !bb || !(ba[0] || ba[1] || ba[2])) { deps.showShotError('脱靶弹缺少弹道数据（ball_a/ball_b）'); return; }
                        deps.dbgReset();
                        // 场景中心 = 弹道弦中点（模型为参照物的最小摆放）
                        const mcx = (ba[0] + bb[0]) / 2, mcy = (ba[1] + bb[1]) / 2, mcz = (ba[2] + bb[2]) / 2;
                        // 目标模型加载但隐藏：viewer 主流程依赖 deps.ml.models.tankModel/deps.ml.models.armorModel 存在
                        deps.ml.models.tankModel.visible = false;
                        deps.ml.models.armorModel.visible = false;
                        // 射手模型：复用命中分支的加载/放置逻辑（loadShooterModel 工厂）
                        const shooterTid2 = parseInt(deps.QP.get('shooter'), 10);
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
                                if (!res || !deps.currentShot()) return;
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
                                    deps.dbgInfo('dbg-anchor-shooter', '#00aaff', '基准点·射手',
                                        deps.fmt3(sModel.position.x + mcx, sModel.position.y + mcy, sModel.position.z + mcz));
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
                                            deps.dbgInfo('dbg-breech', '#cc66ff', '炮闩',
                                                deps.fmt3(bpos.x + mcx, bpos.y + mcy, bpos.z + mcz));
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
                        if (window.__worldAnno) { deps.getScene().remove(window.__worldAnno); }
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
                        deps.dbgInfo('dbg-launch', '#ff6622', '发射点',
                            deps.fmt3(ba[0], ba[1], ba[2]) + ' · ' + spd2.toFixed(0) + ' m/s');
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
                        deps.dbgInfo('dbg-end', '#ffcc00', '落点',
                            deps.fmt3(bb[0], bb[1], bb[2]) + (s.terrain_impact ? ' · 材质' + s.terrain_impact.material : ''));
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
                            window.__worldAnno.add(segLn);   // 随调试开关收纳(原 deps.getScene() 直挂漏显)
                            deps.dbgInfo('dbg-ricochet', '#ffaa00', '落点出射方向',
                                deps.fmt3(td[0], td[1], td[2]));
                        }
                        deps.getScene().add(window.__worldAnno);
                        // 相机 = 射手侧弹道 3/4 视角（与命中分支同构：侧偏 + 上抬）
                        const dirT2 = new THREE.Vector3(bb[0]-ba[0], 0, bb[2]-ba[2]);
                        const lenH2 = dirT2.length();
                        if (lenH2 > 1) {
                            dirT2.divideScalar(lenH2);
                            const perp2 = new THREE.Vector3(-dirT2.z, 0, dirT2.x);
                            deps.getCamera().position.set(ba[0]-mcx, ba[1]-mcy, ba[2]-mcz)
                                .addScaledVector(perp2, Math.max(lenH2 * 0.3, 6))
                                .add(new THREE.Vector3(0, Math.max(lenH2 * 0.22, 4), 0));
                        } else {
                            deps.getCamera().position.set(ba[0]-mcx, ba[1]-mcy, ba[2]-mcz).add(new THREE.Vector3(0, 6, 8));
                        }
                        deps.getControls().target.set((ba[0]+bb[0])/2 - mcx, (ba[1]+bb[1])/2 - mcy, (ba[2]+bb[2])/2 - mcz);
                        deps.getControls().update();
                        // 信息面板：落点/材质 + 弹种
                        const st2 = document.getElementById('turret-controls');
                        const flgM = s.hit_flags || 0;
                        if (st2) { st2.innerHTML = deps.shotErrorHtml() + '<div class="ctrl-row"><b>World View — Shot #' + s.index + ' (脱靶)</b></div>' +
                            (function() {
                                const t4 = s.is_author ? '作者' : (s.shooter_team === 'enemy' ? '敌方' : (s.shooter_team === 'ally' ? '我方' : ''));
                                return '<div class="ctrl-row">Shooter: <b style="color:var(--yellow);">' + (s.shooter_name || '—') + '</b>' + (t4 ? ' · ' + t4 : '') + '</div>' +
                                '<div class="ctrl-row" style="font-size:10px;">搭载: 射手 ' + deps.eqBadge(s.shooter_equipment) +
                                (s.target_equipment || s.game_hit_result !== undefined ? ' · 目标 ' + deps.eqBadge(s.target_equipment) : '') + '</div>';
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
                        deps.setupShotDebug(null);
                        // URL debug=1 自动开启（与命中分支同语义）
                        window.__debugSetVisible(deps.QP.get('debug') === '1');
                        return;
}
