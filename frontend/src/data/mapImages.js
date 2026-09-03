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
 * 内部 code 与展示名的完整映射见 docs/reference/maps.md。
 * 新增素材流程：图片按英文展示名放入 assets/maps + 本文件加一行（含 coordinateBounds，
 * 来源见 docs/features/battle-playback.md）。未登记地图整块不渲染。
 */
export const mapImages = {
  amigosville: { src: fallsCreekImg, width: 1536, height: 1530, coordinateBounds: WORLD_BOUNDS_300 },
  canal: { src: canalImg, width: 1556, height: 1544, coordinateBounds: WORLD_BOUNDS_300 },
  canyon: { src: canyonImg, width: 1538, height: 1536, coordinateBounds: WORLD_BOUNDS_300 },
  desert_train: { src: desertSandsImg, width: 1530, height: 1544, coordinateBounds: WORLD_BOUNDS_300 },
  erlenberg: { src: middleburgImg, width: 1526, height: 1536, coordinateBounds: WORLD_BOUNDS_300 },
  faust: { src: faustImg, width: 1538, height: 1526, coordinateBounds: WORLD_BOUNDS_300 },
  forgecity: { src: newBayImg, width: 1536, height: 1560, coordinateBounds: WORLD_BOUNDS_300 },
  fort: { src: fortDespairImg, width: 1532, height: 1544, coordinateBounds: WORLD_BOUNDS_300 },
  himmelsdorf: { src: himmelsdorfImg, width: 1536, height: 1530, coordinateBounds: WORLD_BOUNDS_300 },
  holland: { src: molendijkImg, width: 1532, height: 1538, coordinateBounds: WORLD_BOUNDS_300 },
  idle: { src: yukonImg, width: 1532, height: 1538, coordinateBounds: WORLD_BOUNDS_300 },
  italy: { src: vineyardsImg, width: 1544, height: 1544, coordinateBounds: WORLD_BOUNDS_300 },
  karieri: { src: copperfieldImg, width: 1526, height: 1536, coordinateBounds: WORLD_BOUNDS_300 },
  karelia: { src: rockfieldImg, width: 1536, height: 1536, coordinateBounds: WORLD_BOUNDS_300 },
  lagoon: { src: lagoonImg, width: 1530, height: 1532, coordinateBounds: WORLD_BOUNDS_300 },
  lumber: { src: horrorstadtImg, width: 1542, height: 1544, coordinateBounds: WORLD_BOUNDS_300 },
  malinovka: { src: winterMalinovkaImg, width: 1206, height: 1196, coordinateBounds: WORLD_BOUNDS_300 },
  medvedkovo: { src: deadRailImg, width: 1526, height: 1532, coordinateBounds: WORLD_BOUNDS_300 },
  milbase: { src: yamatoHarborImg, width: 1538, height: 1530, coordinateBounds: WORLD_BOUNDS_300 },
  mountain: { src: blackGoldvilleImg, width: 1542, height: 1544, coordinateBounds: WORLD_BOUNDS_300 },
  neptune: { src: normandyImg, width: 1556, height: 1538, coordinateBounds: WORLD_BOUNDS_300 },
  pliego: { src: castillaImg, width: 1566, height: 1554, coordinateBounds: WORLD_BOUNDS_300 },
  plant: { src: ghostFactoryImg, width: 1532, height: 1542, coordinateBounds: WORLD_BOUNDS_300 },
  port: { src: portBayImg, width: 1538, height: 1538, coordinateBounds: WORLD_BOUNDS_300 },
  rift: { src: hellasImg, width: 1532, height: 1530, coordinateBounds: WORLD_BOUNDS_300 },
  rock: { src: mayanRuinsImg, width: 1538, height: 1542, coordinateBounds: WORLD_BOUNDS_300 },
  savanna: { src: oasisPalmsImg, width: 1524, height: 1532, coordinateBounds: WORLD_BOUNDS_300 },
  skit: { src: navalFrontierImg, width: 1524, height: 1542, coordinateBounds: WORLD_BOUNDS_300 }
}
