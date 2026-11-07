// 瞄准输入（#820 Agent A 出仓）：Pointer Events 单一路径（桌面+触屏统一），
// 按炮管 = yaw+俯仰 / 按炮塔壳 = 只 yaw / 车体 = 相机轨道 / 短按 = 点击判定。
// 原 tankViewer.js 闭包内对应块整体平移；手势仲裁与灵敏度语义保持原样。
import { pitchAtBearing } from '../../replay-local/compute/tankSetup'

/**
 * @param {object} deps composition root 注入的显式接口
 * @param {object} deps.models { tankModel, armorModel }
 * @param {object} deps.rig / deps.eqs / deps.jc 相邻 owner handle
 * @param {() => object|null} deps.getRenderer / getCamera / getControls / getRaycaster / getMouse
 * @param {() => object} deps.getTankData / getCurrentConfig
 * @param {() => number} deps.getTurretDeg / deps.getGunDeg
 * @param {(deg: number) => void} deps.setTurretDeg / deps.setGunDeg
 */
export function createAimInput(deps) {
    const {
        models, rig, eqs, jc,
        getRenderer, getCamera, getControls, getRaycaster, getMouse,
        getTankData, getCurrentConfig,
        getTurretDeg, getGunDeg, setTurretDeg, setGunDeg,
    } = deps

        let aimStartX = 0, aimStartY = 0, aimStartTurret = 0, aimStartGun = 0;
        let aiming = false;
        let aimPitchEnabled = true;
        const aimPointerId = { active: null };
        // 触屏手势仲裁状态（评审 BLOCKER：炮塔/炮管上的第一根手指不得吃掉双指缩放）：
        // 触屏先记候选（getControls() 保持启用），只有单指移动过 5px 阈值才 claim；第二根手指
        // 一旦到来 → 本会话永不做瞄准，pinch/pan 全权交给 OrbitControls。
        let aimClaimed = false;         // 本会话是否已 claim（claim 后才禁 getControls() / 捕获）
        let aimPendingPart = null;      // 触屏候选部位（'gun' | 'turret'，未 claim）
        let mouseDownPos = null, isDragging = false;
        let aimMultiTouch = false;      // 会话内出现过第二根手指 → 让位双指手势


function aimFromDrag(dxPx, dyPx) {
            const rect = getRenderer().domElement.getBoundingClientRect();
            const dx = dxPx * 180 / Math.max(1, rect.width);
            const dy = dyPx * 180 / Math.max(1, rect.height);
            const norm180 = (a) => ((a + 180) % 360 + 360) % 360 - 180;
            const yl = getCurrentConfig()?.yaw_limits;
            const pl = getCurrentConfig()?.pitch_limits;
            let yawDeg = aimStartTurret + dx;
            if (yl) {
                if (yl.max - yl.min < 360) {
                    yawDeg = norm180(Math.max(-yl.max, Math.min(-yl.min, yawDeg)));
                } else {
                    yawDeg = norm180(yawDeg);   // 全向射界：角度回卷 [-180,180)，多圈拖动不无限叠加
                }
            } else {
                const tLeft = getTankData().turret_traverse_left ?? 180;
                const tRight = getTankData().turret_traverse_right ?? 180;
                if (!(tLeft >= 180 && tRight >= 180)) {
                    yawDeg = Math.max(-tLeft, Math.min(tRight, yawDeg));
                } else {
                    yawDeg = norm180(yawDeg);   // 全向炮塔：同上回卷
                }
            }
            let pitchDeg = aimStartGun - dy;
            // 复用 tankSetup.pitchAtBearing（射界图与装甲页同一套 front/back 扇区 +
            // 122 加成），场景只把请求角夹到返回的上下限，不另写第二份业务规则。
            if (pl) {
                const limits = pitchAtBearing(
                    pl,
                    yawDeg,
                    eqs.effectivePitchDevice() ? eqs.getPitchDeviceBonusValue() : null,
                );
                pitchDeg = Math.min(limits.up, Math.max(limits.down, pitchDeg));
            }
            
            setTurretDeg(yawDeg);
            setGunDeg(pitchDeg);
            document.getElementById('turret-val').textContent = getTurretDeg().toFixed(0) + '°';
            document.getElementById('gun-val').textContent = getGunDeg().toFixed(0) + '°';
            rig.updateTurretGun(getTurretDeg(), getGunDeg());
        }

function claimAim(e, part) {
            aimClaimed = true;
            aimPendingPart = null;
            aiming = true;
            aimPitchEnabled = part === 'gun';
            aimStartX = e.clientX; aimStartY = e.clientY;
            aimStartTurret = getTurretDeg(); aimStartGun = getGunDeg();
            if (getControls()) getControls().enabled = false;
            try { getRenderer().domElement.setPointerCapture(e.pointerId); } catch (_) {}
        }

function endPointerSession(e) {
            if (aimPointerId.active !== e.pointerId) return;
            aimPointerId.active = null;
            aiming = false;
            aimClaimed = false;
            aimPendingPart = null;
            aimMultiTouch = false;
            mouseDownPos = null;
            isDragging = false;
            if (getControls()) getControls().enabled = true;
            try {
                if (getRenderer().domElement.hasPointerCapture && getRenderer().domElement.hasPointerCapture(e.pointerId)) {
                    getRenderer().domElement.releasePointerCapture(e.pointerId);
                }
            } catch (_) {}
        }

function aimPartAt(clientX, clientY) {
            const rect = getRenderer().domElement.getBoundingClientRect();
            getMouse().x = ((clientX - rect.left) / rect.width) * 2 - 1;
            getMouse().y = -((clientY - rect.top) / rect.height) * 2 + 1;
            getRaycaster().setFromCamera(getMouse(), getCamera());
            const objs = [];
            if (models.armorModel) objs.push(models.armorModel);
            if (models.tankModel) objs.push(models.tankModel);
            const hits = getRaycaster().intersectObjects(objs, true);
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
                        // document pointermove 处理，同一事件里禁 getControls() 仍能拦住相机
                        if (aimPendingPart && !aimClaimed && !aimMultiTouch) claimAim(e, aimPendingPart);
                    }
                }
                if (aiming && isDragging) aimFromDrag(e.clientX - aimStartX, aimPitchEnabled ? e.clientY - aimStartY : 0);
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
                jc.onClick(e);
            },
            cancel: endPointerSession,
            // 指针捕获被系统夺走（元素移除/浏览器抢占）时的兜底出口：会话必须完整收尾
            lostCapture(e) { endPointerSession(e); },
        };
    return {
        aimPointerHandlers, aimPartAt, aimFromDrag,
        getAimSession: () => ({
            aiming,
            session: {
                active: aimPointerId.active,
                claimed: aimClaimed,
                pending: aimPendingPart,
                multiTouch: aimMultiTouch,
            },
        }),
        isDragging: () => isDragging,
    };
}
