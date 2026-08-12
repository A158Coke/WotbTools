import blackGoldvilleImg from '../assets/maps/black-goldville.png'
import canalImg from '../assets/maps/canal.png'
import canyonImg from '../assets/maps/canyon.png'
import castillaImg from '../assets/maps/castilla.png'
import copperfieldImg from '../assets/maps/Copperfield.png'
import deadRailImg from '../assets/maps/dead-rail.png'
import desertSandsImg from '../assets/maps/desert-sands.png'
import fallCreekImg from '../assets/maps/fall-creek.png'
import faustImg from '../assets/maps/faust.png'
import fortDespairImg from '../assets/maps/fort-despair.png'
import ghostFactoryImg from '../assets/maps/ghost-factory.png'
import hellasImg from '../assets/maps/hellas.png'
import himmelsdorfImg from '../assets/maps/Himmelsdorf.png'
import lagoonImg from '../assets/maps/lagoon.png'
import malinovImg from '../assets/maps/malinov.png'
import mayaRuinsImg from '../assets/maps/maya-ruins.png'
import middleburgImg from '../assets/maps/Middleburg.png'
import molenImg from '../assets/maps/molen.png'
import navalImg from '../assets/maps/naval.png'
import newbayImg from '../assets/maps/newbay.png'
import normandyImg from '../assets/maps/Normandy.png'
import oasisImg from '../assets/maps/oasis.png'
import portbayImg from '../assets/maps/portbay.png'
import rockfieldImg from '../assets/maps/rockfield.png'
import vineyardImg from '../assets/maps/vineyard.png'
import yamatoHarborImg from '../assets/maps/Yamato-harbor.png'
import yukonImg from '../assets/maps/yukon.png'

/**
 * 地图鸟瞰素材注册表（素材开关）：mapCode（meta.json 的 mapName）→ 图片资源与尺寸。
 * 新增素材流程：图片放入 assets/maps + 本文件加一行（与后端 MapImageCatalog 同步）。
 * 未登记地图整块不渲染（前端以本文件为准，后端 image 仅信息性）。
 */
export const mapImages = {
  amigosville: { src: fallCreekImg, width: 768, height: 765 },
  canal: { src: canalImg, width: 778, height: 772 },
  canyon: { src: canyonImg, width: 769, height: 768 },
  desert_train: { src: desertSandsImg, width: 765, height: 772 },
  erlenberg: { src: middleburgImg, width: 763, height: 768 },
  faust: { src: faustImg, width: 769, height: 763 },
  forgecity: { src: newbayImg, width: 768, height: 780 },
  fort: { src: fortDespairImg, width: 766, height: 772 },
  himmelsdorf: { src: himmelsdorfImg, width: 768, height: 765 },
  holland: { src: molenImg, width: 766, height: 769 },
  idle: { src: yukonImg, width: 766, height: 769 },
  italy: { src: vineyardImg, width: 772, height: 772 },
  karieri: { src: copperfieldImg, width: 763, height: 768 },
  karelia: { src: rockfieldImg, width: 768, height: 768 },
  lagoon: { src: lagoonImg, width: 765, height: 766 },
  malinovka: { src: malinovImg, width: 754, height: 762 },
  medvedkovo: { src: deadRailImg, width: 763, height: 766 },
  milbase: { src: yamatoHarborImg, width: 769, height: 765 },
  mountain: { src: blackGoldvilleImg, width: 771, height: 772 },
  neptune: { src: normandyImg, width: 778, height: 769 },
  pliego: { src: castillaImg, width: 783, height: 777 },
  plant: { src: ghostFactoryImg, width: 766, height: 771 },
  port: { src: portbayImg, width: 769, height: 769 },
  rift: { src: hellasImg, width: 766, height: 765 },
  rock: { src: mayaRuinsImg, width: 769, height: 771 },
  savanna: { src: oasisImg, width: 762, height: 766 },
  skit: { src: navalImg, width: 762, height: 771 }
}
