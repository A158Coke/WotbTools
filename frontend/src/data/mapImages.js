import canalImg from '../assets/maps/canal.png'
import desertSandsImg from '../assets/maps/desert-sands.png'
import middburgImg from '../assets/maps/middburg.png'
import newbayImg from '../assets/maps/newbay.png'
import fortDespairImg from '../assets/maps/fort-despair.png'
import molenImg from '../assets/maps/molen.png'
import yukongImg from '../assets/maps/yukong.png'
import vineyardImg from '../assets/maps/vineyard.png'
import rockfieldImg from '../assets/maps/rockfield.png'
import malinovImg from '../assets/maps/malinov.png'
import blackGoldvilleImg from '../assets/maps/black-goldville.png'
import normandyImg from '../assets/maps/Normandy.png'
import castillaImg from '../assets/maps/castilla.png'
import portbayImg from '../assets/maps/portbay.png'
import mayaRuinsImg from '../assets/maps/maya-ruins.png'
import oasisImg from '../assets/maps/oasis.png'
import navalImg from '../assets/maps/naval.png'

/**
 * 地图鸟瞰素材注册表（素材开关）：mapCode（meta.json 的 mapName）→ 图片资源与尺寸。
 * 新增素材流程：图片放入 assets/maps + 本文件加一行（与后端 MapImageCatalog 同步）。
 * 未登记地图整块不渲染（前端以本文件为准，后端 image 仅信息性）。
 */
export const mapImages = {
  canal: { src: canalImg, width: 778, height: 772 },
  desert_train: { src: desertSandsImg, width: 765, height: 772 },
  erlenberg: { src: middburgImg, width: 763, height: 768 },
  forgecity: { src: newbayImg, width: 768, height: 780 },
  fort: { src: fortDespairImg, width: 766, height: 772 },
  holland: { src: molenImg, width: 766, height: 769 },
  idle: { src: yukongImg, width: 766, height: 769 },
  italy: { src: vineyardImg, width: 772, height: 772 },
  karelia: { src: rockfieldImg, width: 768, height: 768 },
  malinovka: { src: malinovImg, width: 754, height: 762 },
  mountain: { src: blackGoldvilleImg, width: 771, height: 772 },
  neptune: { src: normandyImg, width: 778, height: 769 },
  pliego: { src: castillaImg, width: 783, height: 777 },
  port: { src: portbayImg, width: 769, height: 769 },
  rock: { src: mayaRuinsImg, width: 769, height: 771 },
  savanna: { src: oasisImg, width: 762, height: 766 },
  skit: { src: navalImg, width: 762, height: 771 }
}
