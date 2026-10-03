/**
 * 3D 名牌的**存活 / 阵亡两套样式**（纯函数；绘制留在 playbackScene.drawLabel）。
 *
 * 为什么要单独一套：此前阵亡只做三件很轻的事（名字加 `✝`、文字压到 65% 透明度、
 * 血条不填），在 14–20 车同屏时几乎看不出差别、容易把阵亡车当成还在场上。
 * 阵亡样式改为**整体去队色 + 卡片删除线 + 数字转灰 + 不画装填条**：
 * - 去队色：卡面/描边/名字/血槽/数字全部走中性灰，绿的红的都不再出现；
 * - 删除线：卡片对角一条灰线（"划掉"的语义，一眼可辨，不遮挡文字）；
 * - 不画装填条：阵亡车没有装填状态，继续画会把最后一帧的装填态读成"还在装填"
 *   （语义错误 + 少一行元素又拉开一档差异）；
 * - 受击闪只在存活时生效（阵亡车不会再掉血）。
 *
 * 与 2D 名牌的关系：2D（`.pb-labels`）当前只做"文字压到 65%"。本模块只服务 3D；
 * 若要把 2D 一起对齐，改 2D 的 CSS 并同步 `docs/frontend/design-language.md`。
 */

/** 阵亡态的中性灰（与卡片里原有的压暗灰 #4a525c 同族，提亮一档保证可读） */
export const DEAD_GRAY = '#9aa3ad'

/**
 * @param {boolean} dead
 * @returns {{
 *   cardFill: string, cardStroke: string, cardStrokeW: number,
 *   namePrefix: string, nameColor: string | null,
 *   hpTrackFill: string, hpTextColor: string,
 *   strike: boolean, strikeColor: string, strikeW: number,
 *   showReload: boolean, flash: boolean,
 * }} nameColor = null 表示"用队色"（存活态由调用方按阵营决定）
 */
export function labelVisual(dead) {
  if (!dead) {
    return {
      cardFill: 'rgba(0, 0, 0, .55)',
      cardStroke: 'rgba(255,255,255,.14)', cardStrokeW: 6,
      namePrefix: '', nameColor: null,
      hpTrackFill: '#0a0e13', hpTextColor: '#fff',
      strike: false, strikeColor: 'transparent', strikeW: 0,
      showReload: true, flash: true,
    }
  }
  return {
    // 卡面更暗更实：与存活卡拉开明度差，同时保证灰字可读
    cardFill: 'rgba(10, 12, 16, .78)',
    cardStroke: 'rgba(150,158,168,.42)', cardStrokeW: 8,
    namePrefix: '✝ ', nameColor: DEAD_GRAY,
    hpTrackFill: '#161b22', hpTextColor: DEAD_GRAY,
    // 删除线要压在不透明的血条与数字之上（绘制顺序见 drawLabel），故取值偏实：
    // 太淡会被深色血槽吃掉，太重又会压掉名字可读性
    strike: true, strikeColor: 'rgba(178,186,196,.55)', strikeW: 8,
    showReload: false, flash: false,
  }
}
