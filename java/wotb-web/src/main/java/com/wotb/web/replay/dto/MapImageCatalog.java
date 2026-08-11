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
            Map.entry("alpen", image("alpen.png", 771, 772)),
            Map.entry("black_goldville", image("black-goldville.png", 771, 772)),
            Map.entry("canal", image("canal.png", 778, 772)),
            Map.entry("castilla", image("castilla.png", 783, 777)),
            Map.entry("desert_train", image("desert-sands.png", 765, 772)),
            Map.entry("fort_despair", image("fort-despair.png", 766, 772)),
            Map.entry("malinovka", image("malinov.png", 754, 762)),
            Map.entry("maya_ruins", image("maya-ruins.png", 769, 771)),
            Map.entry("middburg", image("middburg.png", 763, 768)),
            Map.entry("molen", image("molen.png", 766, 769)),
            Map.entry("naval", image("naval.png", 762, 771)),
            Map.entry("newbay", image("newbay.png", 768, 780)),
            Map.entry("normandy", image("Normandy.png", 778, 769)),
            Map.entry("oasis", image("oasis.png", 762, 766)),
            Map.entry("portbay", image("portbay.png", 769, 769)),
            Map.entry("rockfield", image("rockfield.png", 768, 768)),
            Map.entry("vineyard", image("vineyard.png", 772, 772)),
            Map.entry("yukong", image("yukong.png", 766, 769)));

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
