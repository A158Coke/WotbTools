import blackGoldvilleImg from '../assets/maps/black-goldville.webp'
import canalImg from '../assets/maps/canal.webp'
import canyonImg from '../assets/maps/canyon.webp'
import castillaImg from '../assets/maps/castilla.webp'
import copperfieldImg from '../assets/maps/copperfield.webp'
import deadRailImg from '../assets/maps/dead-rail.webp'
import desertSandsImg from '../assets/maps/desert-sands.webp'
import fallsCreekImg from '../assets/maps/falls-creek.webp'
import faustImg from '../assets/maps/faust.webp'
import fortDespairImg from '../assets/maps/fort-despair.webp'
import ghostFactoryImg from '../assets/maps/ghost-factory.webp'
import hellasImg from '../assets/maps/hellas.webp'
import himmelsdorfImg from '../assets/maps/himmelsdorf.webp'
import horrorstadtImg from '../assets/maps/horrorstadt.webp'
import lagoonImg from '../assets/maps/lagoon.webp'
import mayanRuinsImg from '../assets/maps/mayan-ruins.webp'
import middleburgImg from '../assets/maps/middleburg.webp'
import molendijkImg from '../assets/maps/molendijk.webp'
import navalFrontierImg from '../assets/maps/naval-frontier.webp'
import newBayImg from '../assets/maps/new-bay.webp'
import normandyImg from '../assets/maps/normandy.webp'
import oasisPalmsImg from '../assets/maps/oasis-palms.webp'
import portBayImg from '../assets/maps/port-bay.webp'
import rockfieldImg from '../assets/maps/rockfield.webp'
import vineyardsImg from '../assets/maps/vineyards.webp'
import wastelandImg from '../assets/maps/wasteland.webp'
import winterMalinovkaImg from '../assets/maps/winter-malinovka.webp'
import yamatoHarborImg from '../assets/maps/yamato-harbor.webp'
import yukonImg from '../assets/maps/yukon.webp'

export const WORLD_BOUNDS_300 = { xMin: -300, xMax: 300, yMin: -300, yMax: 300 }

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
