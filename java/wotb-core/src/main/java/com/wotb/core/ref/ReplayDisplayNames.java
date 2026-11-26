package com.wotb.core.ref;

import org.springframework.util.StringUtils;

public final class ReplayDisplayNames {

    public static final String UNKNOWN_TANK_CLASS = "未知";

    private ReplayDisplayNames() {
    }

    public static String mapName(final String internalMapCode) {
        if (!StringUtils.hasText(internalMapCode)) {
            return "未知地图";
        }
        try {
            return MapNames.tryResolve(internalMapCode).orElse("未知地图");
        } catch (final Exception e) {
            return "未知地图";
        }
    }

    public static String tankName(final long tankId, final String existingTankName) {
        if (tankId > 0) {
            final String name = TankopediaReferenceData.tankopedia().info(tankId).name();
            if (isValidDisplayName(name)) {
                return name;
            }
        }
        if (isValidDisplayName(existingTankName)) {
            return existingTankName;
        }
        return "未知坦克";
    }

    public static String tankClass(final long tankId) {
        if (tankId <= 0) {
            return UNKNOWN_TANK_CLASS;
        }
        final String type = TankopediaReferenceData.tankopedia().info(tankId).type();
        if (!StringUtils.hasText(type)) {
            return UNKNOWN_TANK_CLASS;
        }
        return type;
    }

    public static String tankClassEn(final long tankId) {
        if (tankId <= 0) {
            return "";
        }
        final String type = TankopediaReferenceData.tankopedia().info(tankId).type();
        return StringUtils.hasText(type) ? type : "";
    }

    public static String tankTier(final long tankId) {
        if (tankId <= 0) {
            return "";
        }
        final Object tier = TankopediaReferenceData.tankopedia().info(tankId).tier();
        final String text = tier == null ? "" : String.valueOf(tier);
        return text.isBlank() ? "" : text;
    }

    public static String tankNation(final long tankId) {
        if (tankId <= 0) {
            return "";
        }
        final String nation = TankopediaReferenceData.tankopedia().info(tankId).nation();
        return StringUtils.hasText(nation) ? nation : "";
    }

    public static String tankAlphaDamage(final long tankId) {
        if (tankId <= 0) {
            return "";
        }
        final Integer alpha = TankopediaReferenceData.tankopedia().info(tankId).alphaDamage();
        return alpha != null && alpha > 0 ? String.valueOf(alpha) : "";
    }

    public static String tankMaxHp(final long tankId) {
        if (tankId <= 0) {
            return "";
        }
        final Integer hp = TankopediaReferenceData.tankopedia().info(tankId).maxHp();
        return hp != null && hp > 0 ? String.valueOf(hp) : "";
    }

    public static Integer tankMaxHpValue(final long tankId) {
        if (tankId <= 0) {
            return null;
        }
        final Integer hp = TankopediaReferenceData.tankopedia().info(tankId).maxHp();
        return hp != null && hp > 0 ? hp : null;
    }

    public static Integer tankBaseHpValue(final long tankId) {
        return tankMaxHpValue(tankId);
    }

    public static String tankExtraInfo(final long tankId) {
        if (tankId <= 0) {
            return "";
        }
        final String knowledge = TankopediaReferenceData.tankopedia().info(tankId).extraInfo();
        return StringUtils.hasText(knowledge) ? knowledge.trim() : "";
    }

    private static boolean isValidDisplayName(final String name) {
        if (!StringUtils.hasText(name)) return false;
        if (name.startsWith("#")) return false;
        if (name.startsWith("?")) return false;
        if (name.startsWith("vehicle_")) return false;
        if (name.startsWith("tankId=")) return false;
        if (name.matches("\\d+")) return false;
        return true;
    }
}
