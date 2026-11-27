/**
 * 拆分模块共享的宿主对象类型（迁移期声明：宿主字段由各 owner 模块安装，逐字段类型化随迁移推进）。
 * @typedef {Record<string, any>} Host
 */
export { dollyZoomFov, mirrorShotData } from './viewer/viewerMath.js'
import { createTankHost } from './tankViewer/sceneHost.js'
import { bindTankStatus, initTankStatus } from './tankViewer/tankStatus.js'
import { bindTankScene, initTankScene } from './tankViewer/tankScene.js'
import { bindTankArmor, initTankArmor } from './tankViewer/tankArmor.js'
import { bindTankTransport, initTankTransport } from './tankViewer/tankTransport.js'
import { bindTankShell, initTankShell } from './tankViewer/tankRuntime.js'
import { bindTankShotCheck, initTankShotCheck } from './tankViewer/tankLoop.js'
import { createTankApi } from './tankViewer/tankApi.js'

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
export function initTankViewer({
    labels = {},
    onLoadState = null,
    onTankList = null,
    onTankSelection = null,
    onConfigSelection = null,
    onShellSelection = null,
    onEquipmentSelection = null,
    onDistanceChange = null,
    onJudgmentDistance = null,
    initialTankId = null,
    initialShooterId = null,
    pitchDeviceBonus = null,
    pitchDeviceAvailable = false,
} = {}) {
    const S = createTankHost({
        labels,
        onLoadState,
        onTankList,
        onTankSelection,
        onConfigSelection,
        onShellSelection,
        onEquipmentSelection,
        onDistanceChange,
        onJudgmentDistance,
        initialTankId,
        initialShooterId,
        pitchDeviceBonus,
        pitchDeviceAvailable,
    })
    bindTankStatus(S)
    bindTankScene(S)
    bindTankArmor(S)
    bindTankTransport(S)
    bindTankShell(S)
    bindTankShotCheck(S)
    initTankStatus(S)
    initTankScene(S)
    initTankArmor(S)
    initTankTransport(S)
    initTankShell(S)
    initTankShotCheck(S)
    return createTankApi(S)
}
