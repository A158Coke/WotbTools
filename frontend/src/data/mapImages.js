import blackGoldvilleImg from '../assets/maps/black-goldville.png'
import canalImg from '../assets/maps/canal.png'
import canyonImg from '../assets/maps/canyon.png'
import castillaImg from '../assets/maps/castilla.png'
import copperfieldImg from '../assets/maps/copperfield.png'
import deadRailImg from '../assets/maps/dead-rail.png'
import desertSandsImg from '../assets/maps/desert-sands.png'
import fallsCreekImg from '../assets/maps/falls-creek.png'
import faustImg from '../assets/maps/faust.png'
import fortDespairImg from '../assets/maps/fort-despair.png'
import ghostFactoryImg from '../assets/maps/ghost-factory.png'
import hellasImg from '../assets/maps/hellas.png'
import himmelsdorfImg from '../assets/maps/himmelsdorf.png'
import horrorstadtImg from '../assets/maps/horrorstadt.png'
import lagoonImg from '../assets/maps/lagoon.png'
import mayanRuinsImg from '../assets/maps/mayan-ruins.png'
import middleburgImg from '../assets/maps/middleburg.png'
import molendijkImg from '../assets/maps/molendijk.png'
import navalFrontierImg from '../assets/maps/naval-frontier.png'
import newBayImg from '../assets/maps/new-bay.png'
import normandyImg from '../assets/maps/normandy.png'
import oasisPalmsImg from '../assets/maps/oasis-palms.png'
import portBayImg from '../assets/maps/port-bay.png'
import rockfieldImg from '../assets/maps/rockfield.png'
import vineyardsImg from '../assets/maps/vineyards.png'
import winterMalinovkaImg from '../assets/maps/winter-malinovka.png'
import yamatoHarborImg from '../assets/maps/yamato-harbor.png'
import yukonImg from '../assets/maps/yukon.png'

/**
 * 地图图片对应的世界坐标范围（米）。
 * 来源：各图 `common/map-semantics/*.semantic.json` 的 `coordinateSystem.worldBounds`。
 * 底图是完整世界坐标截图，渲染必须用该范围，不能用分析用的 `playableBounds`
 * （否则越靠近地图边缘，路线/出生点/网格越被向外放大推移）。
 * 当前 28 张已登记图均为 -300..300；新图以各自语义 JSON 为准，
 * 范围不同时给该图单独写对象，勿改共享常量。
 */
const WORLD_BOUNDS_300 = { xMin: -300, xMax: 300, yMin: -300, yMax: 300 }

/**
 * 地图鸟瞰素材注册表（唯一权威，素材开关）：mapCode（meta.json 的 mapName）→ 图片资源与尺寸。
 * 文件命名约定：游戏英文展示名小写中划线（如 Normandy → normandy.png，Middleburg → middleburg.png）；
 * 内部 code 与展示名的完整映射见 docs/map-catalog.md。
 * 新增素材流程：图片按英文展示名放入 assets/maps + 本文件加一行（含 coordinateBounds，
 * 来源见 docs/DEVELOPER_GUIDE.md「地图鸟瞰」）。未登记地图整块不渲染。
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
