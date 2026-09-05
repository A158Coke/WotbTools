import blackGoldvilleImg from '../assets/maps-hd/black-goldville.webp'
import canalImg from '../assets/maps-hd/canal.webp'
import canyonImg from '../assets/maps-hd/canyon.webp'
import castillaImg from '../assets/maps-hd/castilla.webp'
import copperfieldImg from '../assets/maps-hd/copperfield.webp'
import deadRailImg from '../assets/maps-hd/dead-rail.webp'
import desertSandsImg from '../assets/maps-hd/desert-sands.webp'
import fallsCreekImg from '../assets/maps-hd/falls-creek.webp'
import faustImg from '../assets/maps-hd/faust.webp'
import fortDespairImg from '../assets/maps-hd/fort-despair.webp'
import ghostFactoryImg from '../assets/maps-hd/ghost-factory.webp'
import hellasImg from '../assets/maps-hd/hellas.webp'
import himmelsdorfImg from '../assets/maps-hd/himmelsdorf.webp'
import horrorstadtImg from '../assets/maps-hd/horrorstadt.webp'
import lagoonImg from '../assets/maps-hd/lagoon.webp'
import mayanRuinsImg from '../assets/maps-hd/mayan-ruins.webp'
import middleburgImg from '../assets/maps-hd/middleburg.webp'
import molendijkImg from '../assets/maps-hd/molendijk.webp'
import navalFrontierImg from '../assets/maps-hd/naval-frontier.webp'
import newBayImg from '../assets/maps-hd/new-bay.webp'
import normandyImg from '../assets/maps-hd/normandy.webp'
import oasisPalmsImg from '../assets/maps-hd/oasis-palms.webp'
import portBayImg from '../assets/maps-hd/port-bay.webp'
import rockfieldImg from '../assets/maps-hd/rockfield.webp'
import vineyardsImg from '../assets/maps-hd/vineyards.webp'
import wastelandImg from '../assets/maps-hd/wasteland.webp'
import winterMalinovkaImg from '../assets/maps-hd/winter-malinovka.webp'
import yamatoHarborImg from '../assets/maps-hd/yamato-harbor.webp'
import yukonImg from '../assets/maps-hd/yukon.webp'

/**
 * 地图图片对应的世界坐标范围（米）。
 * 来源：各图 `common/map-semantics/*.semantic.json` 的 `coordinateSystem.worldBounds`。
 * 底图是完整世界坐标截图，渲染必须用该范围，不能用分析用的 `playableBounds`
 * （否则越靠近地图边缘，路线/出生点/网格越被向外放大推移）。
 * 当前 29 张已登记图均为 -300..300；新图以各自语义 JSON 为准，
 * 范围不同时给该图单独写对象，勿改共享常量。
 */
const WORLD_BOUNDS_300 = { xMin: -300, xMax: 300, yMin: -300, yMax: 300 }

/**
 * 地图鸟瞰素材注册表（唯一权威，素材开关）：mapCode（meta.json 的 mapName）→ 图片资源与尺寸。
 * 文件命名约定：游戏英文展示名小写中划线（如 Normandy → normandy.webp，Middleburg → middleburg.webp）；
 * 内部 code 与展示名的完整映射见 docs/reference/maps.md。
 * 新增素材流程：图片按英文展示名放入 assets/maps + 本文件加一行（含 coordinateBounds，
 * 来源见 docs/features/battle-playback.md）。未登记地图整块不渲染。
 *
 * AI-enhanced basemaps live under assets/maps-hd. The original assets/maps files
 * remain untouched as the rollback source and are never overwritten by enhancement.
 */
export const mapImages = {
  amigosville: { src: fallsCreekImg, width: 768, height: 765, coordinateBounds: WORLD_BOUNDS_300 },
  canal: { src: canalImg, width: 778, height: 772, coordinateBounds: WORLD_BOUNDS_300 },
  canyon: { src: canyonImg, width: 769, height: 768, coordinateBounds: WORLD_BOUNDS_300 },
  desert_train: { src: desertSandsImg, width: 765, height: 772, coordinateBounds: WORLD_BOUNDS_300 },
  erlenberg: { src: middleburgImg, width: 763, height: 768, coordinateBounds: WORLD_BOUNDS_300 },
  faust: { src: faustImg, width: 769, height: 763, coordinateBounds: WORLD_BOUNDS_300 },
  forgecity: { src: newBayImg, width: 768, height: 780, coordinateBounds: WORLD_BOUNDS_300 },
  fort: { src: fortDespairImg, width: 766, height: 772, coordinateBounds: WORLD_BOUNDS_300 },
  himmelsdorf: { src: himmelsdorfImg, width: 768, height: 765, coordinateBounds: WORLD_BOUNDS_300 },
  holland: { src: molendijkImg, width: 766, height: 769, coordinateBounds: WORLD_BOUNDS_300 },
  holmeisk: { src: wastelandImg, width: 768, height: 768, coordinateBounds: WORLD_BOUNDS_300 },
  idle: { src: yukonImg, width: 766, height: 769, coordinateBounds: WORLD_BOUNDS_300 },
  italy: { src: vineyardsImg, width: 772, height: 772, coordinateBounds: WORLD_BOUNDS_300 },
  karieri: { src: copperfieldImg, width: 763, height: 768, coordinateBounds: WORLD_BOUNDS_300 },
  karelia: { src: rockfieldImg, width: 768, height: 768, coordinateBounds: WORLD_BOUNDS_300 },
  lagoon: { src: lagoonImg, width: 765, height: 766, coordinateBounds: WORLD_BOUNDS_300 },
  lumber: { src: horrorstadtImg, width: 771, height: 772, coordinateBounds: WORLD_BOUNDS_300 },
  malinovka: { src: winterMalinovkaImg, width: 754, height: 762, coordinateBounds: WORLD_BOUNDS_300 },
  medvedkovo: { src: deadRailImg, width: 763, height: 766, coordinateBounds: WORLD_BOUNDS_300 },
  milbase: { src: yamatoHarborImg, width: 769, height: 765, coordinateBounds: WORLD_BOUNDS_300 },
  mountain: { src: blackGoldvilleImg, width: 771, height: 772, coordinateBounds: WORLD_BOUNDS_300 },
  neptune: { src: normandyImg, width: 778, height: 769, coordinateBounds: WORLD_BOUNDS_300 },
  pliego: { src: castillaImg, width: 783, height: 777, coordinateBounds: WORLD_BOUNDS_300 },
  plant: { src: ghostFactoryImg, width: 766, height: 771, coordinateBounds: WORLD_BOUNDS_300 },
  port: { src: portBayImg, width: 769, height: 769, coordinateBounds: WORLD_BOUNDS_300 },
  rift: { src: hellasImg, width: 766, height: 765, coordinateBounds: WORLD_BOUNDS_300 },
  rock: { src: mayanRuinsImg, width: 769, height: 771, coordinateBounds: WORLD_BOUNDS_300 },
  savanna: { src: oasisPalmsImg, width: 762, height: 766, coordinateBounds: WORLD_BOUNDS_300 },
  skit: { src: navalFrontierImg, width: 762, height: 771, coordinateBounds: WORLD_BOUNDS_300 }
}
