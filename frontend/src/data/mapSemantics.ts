/**
 * 地图语义档案读取（`common/map-semantics/*.semantic.json` 唯一权威；与回放
 * spawnResolver / 2D 预览 / 3D 预览同一份文件）。
 *
 * 索引一次（eager glob 与回放侧同式），按 mapId 与 mapCodes 小写查；缺档 fail-closed
 * （返回 null，消费方不得猜坐标）。原先 MapPreview2DPane 内联了同一份 glob+索引，
 * 3D 预览的出生点标记（#835）需要同一入口，这里收敛为唯一读取面。
 */
import { indexMapGridProfiles, type MapGridProfile } from '../replay-local/playback/toMapOverview.js'

let gridProfiles: Map<string, MapGridProfile> | null = null

/** 按 mapKey（mapId 或任一 mapCode，大小写不敏感）取语义档案；缺档返回 null。 */
export function mapGridProfile(mapKey: string | number): MapGridProfile | null {
  gridProfiles ??= indexMapGridProfiles(Object.values(import.meta.glob('../../../common/map-semantics/*.semantic.json', {
    eager: true, import: 'default',
  }) as Record<string, unknown>))
  return gridProfiles.get(String(mapKey).toLowerCase()) ?? null
}

/**
 * 语义档案是否可代表当前变体。档案带 `battleVariant`（如 neptune=nt0）时只能用于该
 * 变体；选中变体与档案不一致 ⇒ 该变体的出生点/可玩边界没有已验证数据，调用方必须
 * 隐藏（fail-closed），不能把 nt0 的 battlePoints 当作 nt1/nt2 的地图事实。
 * 任一侧未标注（单变体旧档案 / 未选变体）→ 允许，保持既有单变体行为。
 */
export function profileMatchesVariant(
  profile: MapGridProfile | null | undefined,
  variant: string | null | undefined,
): boolean {
  if (!profile) return false
  const tagged = (profile.battleVariant || '').trim().toLowerCase()
  const selected = String(variant || '').trim().toLowerCase()
  if (!tagged || !selected) return true
  return tagged === selected
}
