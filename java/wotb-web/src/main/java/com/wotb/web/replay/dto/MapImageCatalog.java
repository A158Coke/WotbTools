package com.wotb.web.replay.dto;

import java.util.Map;

/**
 * 后端地图图片元信息目录（信息性；前端渲染门控在 {@code frontend/src/data/mapImages.js}）。
 * <p>只登记用户已提供的真实鸟瞰素材（assets/maps/*.png）；未登记地图的
 * {@code MapOverview.image} 为 null，前端不会渲染。两处目录需保持同步（新增素材：
 * 放 assets/maps + 在 mapImages.js 加一行 + 本目录加一行）。</p>
 */
public final class MapImageCatalog {

    private static final Map<String, MapOverview.ImageInfo> IMAGES = Map.ofEntries(
            Map.entry("amigosville", image("fall-creek.png", 768, 765)),
            Map.entry("canal", image("canal.png", 778, 772)),
            Map.entry("canyon", image("canyon.png", 769, 768)),
            Map.entry("desert_train", image("desert-sands.png", 765, 772)),
            Map.entry("erlenberg", image("Middleburg.png", 763, 768)),
            Map.entry("faust", image("faust.png", 769, 763)),
            Map.entry("forgecity", image("newbay.png", 768, 780)),
            Map.entry("fort", image("fort-despair.png", 766, 772)),
            Map.entry("himmelsdorf", image("Himmelsdorf.png", 768, 765)),
            Map.entry("holland", image("molen.png", 766, 769)),
            Map.entry("idle", image("yukon.png", 766, 769)),
            Map.entry("italy", image("vineyard.png", 772, 772)),
            Map.entry("karieri", image("Copperfield.png", 763, 768)),
            Map.entry("karelia", image("rockfield.png", 768, 768)),
            Map.entry("lagoon", image("lagoon.png", 765, 766)),
            Map.entry("malinovka", image("malinov.png", 754, 762)),
            Map.entry("medvedkovo", image("dead-rail.png", 763, 766)),
            Map.entry("milbase", image("Yamato-harbor.png", 769, 765)),
            Map.entry("mountain", image("black-goldville.png", 771, 772)),
            Map.entry("neptune", image("Normandy.png", 778, 769)),
            Map.entry("pliego", image("castilla.png", 783, 777)),
            Map.entry("plant", image("ghost-factory.png", 766, 771)),
            Map.entry("port", image("portbay.png", 769, 769)),
            Map.entry("rift", image("hellas.png", 766, 765)),
            Map.entry("rock", image("maya-ruins.png", 769, 771)),
            Map.entry("savanna", image("oasis.png", 762, 766)),
            Map.entry("skit", image("naval.png", 762, 771)));

    private MapImageCatalog() {
    }

    /** 按地图 code 取图片元信息；未登记返回 null。 */
    public static MapOverview.ImageInfo imageFor(final String mapCode) {
        if (mapCode == null) {
            return null;
        }
        return IMAGES.get(mapCode.trim().toLowerCase());
    }

    private static MapOverview.ImageInfo image(final String file, final int width, final int height) {
        return new MapOverview.ImageInfo(file, width, height);
    }
}
