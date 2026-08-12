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
 * 地图鸟瞰素材注册表（唯一权威，素材开关）：mapCode（meta.json 的 mapName）→ 图片资源与尺寸。
 * 文件命名约定：游戏英文展示名小写中划线（如 Normandy → normandy.png，Middleburg → middleburg.png）；
 * 内部 code 与展示名的完整映射见 docs/map-catalog.md。
 * 新增素材流程：图片按英文展示名放入 assets/maps + 本文件加一行。未登记地图整块不渲染。
 */
export const mapImages = {
  amigosville: { src: fallsCreekImg, width: 768, height: 765 },
  canal: { src: canalImg, width: 778, height: 772 },
  canyon: { src: canyonImg, width: 769, height: 768 },
  desert_train: { src: desertSandsImg, width: 765, height: 772 },
  erlenberg: { src: middleburgImg, width: 763, height: 768 },
  faust: { src: faustImg, width: 769, height: 763 },
  forgecity: { src: newBayImg, width: 768, height: 780 },
  fort: { src: fortDespairImg, width: 766, height: 772 },
  himmelsdorf: { src: himmelsdorfImg, width: 768, height: 765 },
  holland: { src: molendijkImg, width: 766, height: 769 },
  idle: { src: yukonImg, width: 766, height: 769 },
  italy: { src: vineyardsImg, width: 772, height: 772 },
  karieri: { src: copperfieldImg, width: 763, height: 768 },
  karelia: { src: rockfieldImg, width: 768, height: 768 },
  lagoon: { src: lagoonImg, width: 765, height: 766 },
  lumber: { src: horrorstadtImg, width: 771, height: 772 },
  malinovka: { src: winterMalinovkaImg, width: 754, height: 762 },
  medvedkovo: { src: deadRailImg, width: 763, height: 766 },
  milbase: { src: yamatoHarborImg, width: 769, height: 765 },
  mountain: { src: blackGoldvilleImg, width: 771, height: 772 },
  neptune: { src: normandyImg, width: 778, height: 769 },
  pliego: { src: castillaImg, width: 783, height: 777 },
  plant: { src: ghostFactoryImg, width: 766, height: 771 },
  port: { src: portBayImg, width: 769, height: 769 },
  rift: { src: hellasImg, width: 766, height: 765 },
  rock: { src: mayanRuinsImg, width: 769, height: 771 },
  savanna: { src: oasisPalmsImg, width: 762, height: 766 },
  skit: { src: navalFrontierImg, width: 762, height: 771 }
}
