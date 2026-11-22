// 实例运行时/公开 API owner（2026-11-22 自 tankViewer.js 闭包出仓，纯搬移）：外壳与装备覆盖/
// 射手配置 setter，以及 initTankViewer 返回对象的唯一组装点。
import { resolvePitchCheckboxChecked } from '../../replay-local/compute/tankSetup'
import type { Host } from '../tankViewer.js'
import { bind } from '../hostBind.ts'

function setShell(S: Host, index: number) {
            const sel = document.getElementById('shell-select') as HTMLSelectElement | null;
            const i = Number(index);
            if (!sel || !S.dl.getShooterShells() || !Number.isInteger(i) || i < 0 || i >= S.dl.getShooterShells().length) return false;
            S.QP.set('shell', String(i));
            sel.value = String(i);
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }

function setEquipmentOverride(S: Host, kind: 'calibrated' | 'enhanced' | 'pitch', value: boolean | null | undefined) {
            if (kind !== 'calibrated' && kind !== 'enhanced' && kind !== 'pitch') return;
            S.eqs.equipmentOverride[kind] = value == null ? null : !!value;
            // 俯仰只改下一轮拖动钳制，不影响穿深/厚度 uniform；同步原生勾选，
            // 避免宿主清掉不可用车的 eqpitch 后 checkbox 仍显示勾选。
            if (kind === 'pitch') {
                const pit = document.getElementById('eq-pitch-device') as HTMLInputElement | null;
                if (pit) {
                    if (value != null) {
                        pit.checked = !!value;
                    } else {
                        // 撤销覆盖（review P2）：必须按当前目标录制真值/默认值重同步回退勾选。
                        // 只把 override 置 null 会留下旧 checked=true——effectivePitchDevice
                        // 在无真值时回退到 checkbox，122 会被残留勾选重新启用，与已清 URL 的 HUD 不一致。
                        const recorded = S.eqs.shotEquipmentCtx().target;
                        pit.checked = resolvePitchCheckboxChecked({
                            override: null,
                            recorded: recorded ? !!recorded.improved_pitch_limits : null,
                        });
                    }
                }
            } else {
                S.refreshEquipmentEffects();
            }
        }

async function setShooterConfig(S: Host, index: number) {
            if (S.dl.getCurrentShooterId() == null) return false;
            const idx = Number(index);
            if (!Number.isInteger(idx) || idx < 0) return false;
            const hasCurrent = !!(S.dl.getShooterData() && S.dl.getShooterData().tank_id === S.dl.getCurrentShooterId());
            if (hasCurrent && idx >= (S.dl.getShooterData().configs || []).length) return false;
            S.QP.set('scfg', String(idx));
            S.QP.delete('shell');   // 旧弹种下标对新炮表无意义
            if (!hasCurrent) {
                // 当前选中的射手数据仍在路上：不要用上一辆车的 dl.getShooterData() 重载，
                // 否则会递增 shooterLoadGen（dataLoader owner） 把正确的在途响应丢掉。
                S.dl.setPendingShooterConfig({ tankId: S.dl.getCurrentShooterId(), index: idx });
                return true;
            }
            await S.dl.loadShooter(S.dl.getCurrentShooterId());
            return true;
        }

export function bindTankShell(S: Host) {
  Object.assign(S, {
    setShell: bind(S, setShell),
    setEquipmentOverride: bind(S, setEquipmentOverride),
    setShooterConfig: bind(S, setShooterConfig),
  })
}

export function initTankShell(_S: Host) {

}
