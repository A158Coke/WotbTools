package com.wotb.core.ref;

import org.springframework.util.StringUtils;

/** 将车辆库中的中文分类值转换为 API 使用的稳定英文码。 */
public final class VehicleCodes {

    private VehicleCodes() {
    }

    public static String classCode(final String value) {
        if (!StringUtils.hasText(value)) {
            return "OTHER";
        }
        return switch (value.trim()) {
            case "重坦", "HEAVY_TANK" -> "HEAVY_TANK";
            case "中坦", "MEDIUM_TANK" -> "MEDIUM_TANK";
            case "轻坦", "LIGHT_TANK" -> "LIGHT_TANK";
            case "TD", "TANK_DESTROYER" -> "TANK_DESTROYER";
            default -> "OTHER";
        };
    }

    public static String nationCode(final String value) {
        if (!StringUtils.hasText(value)) {
            return "OTHER";
        }
        return switch (value.trim()) {
            case "中国", "CHINA" -> "CHINA";
            case "德国", "GERMANY" -> "GERMANY";
            case "日本", "JAPAN" -> "JAPAN";
            case "欧洲", "EUROPE" -> "EUROPE";
            case "法国", "FRANCE" -> "FRANCE";
            case "美国", "USA" -> "USA";
            case "苏联", "USSR" -> "USSR";
            case "英国", "UK" -> "UK";
            default -> "OTHER";
        };
    }
}
