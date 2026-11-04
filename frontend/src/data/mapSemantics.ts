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
