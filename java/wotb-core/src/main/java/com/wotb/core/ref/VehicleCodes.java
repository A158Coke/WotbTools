package com.wotb.core.ref;

import org.springframework.util.StringUtils;

/** 将车辆库分类/国家值（中文或英文）转换为 API 使用的稳定英文码。 */
public final class VehicleCodes {

    private VehicleCodes() {
    }

    public static String classCode(final String value) {
        if (!StringUtils.hasText(value)) {
            return "OTHER";
        }
        return switch (value.trim()) {
            case "重坦", "Heavy tank", "HEAVY_TANK" -> "HEAVY_TANK";
            case "中坦", "Medium tank", "MEDIUM_TANK" -> "MEDIUM_TANK";
            case "轻坦", "Light tank", "LIGHT_TANK" -> "LIGHT_TANK";
            case "TD", "Tank destroyer", "TANK_DESTROYER" -> "TANK_DESTROYER";
            default -> "OTHER";
        };
    }

    public static String nationCode(final String value) {
        if (!StringUtils.hasText(value)) {
            return "OTHER";
        }
        return switch (value.trim()) {
            case "中国", "China", "CHINA" -> "CHINA";
            case "德国", "Germany", "GERMANY" -> "GERMANY";
            case "日本", "Japan", "JAPAN" -> "JAPAN";
            case "欧洲", "European", "EUROPE" -> "EUROPE";
            case "法国", "France", "FRANCE" -> "FRANCE";
            case "美国", "USA" -> "USA";
            case "苏联", "USSR" -> "USSR";
            case "英国", "UK" -> "UK";
            case "其他", "Other" -> "OTHER";
            default -> "OTHER";
        };
    }
}
