package com.wotb.core.ref;

import org.springframework.util.StringUtils;

/**
 * Shared display-name resolver for AI Review prompts.
 * Both TEAM_PERSPECTIVE and PLAYER_FOCUSED paths use the same contract:
 * <ul>
 *   <li>map internal code → {@link MapNames} → user-visible map name</li>
 *   <li>tankId → application-level {@link TankopediaReferenceData} → user-visible tank name</li>
 *   <li>tankId → application-level {@link TankopediaReferenceData} → structured vehicle class</li>
 * </ul>
 *
 * <p>Tankopedia lifecycle/ownership does not belong here. This class only formats display-facing
 * values from the shared application reference data; new replay/AI/vehicle-detail code should
 * consume {@link TankopediaReferenceData} directly when it needs structured vehicle facts.</p>
 *
 * <p>坦克名称是权威专有名词：解析只走 {@code tankId → tankopedia}，
 * 绝不解析名称文本本身。车辆类型同样只来自 tankopedia 的结构化
 * {@code class} 字段，任何情况下都不得由名称推断
 * （例如不得因为名称含 {@code SPHT} 就判定为 SPG / 自行火炮）。</p>
 */
public final class ReplayDisplayNames {

    /** tankopedia 未提供车辆类型时的稳定占位值。 */
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

    /**
     * 结构化车辆类型，仅取自 tankopedia 的 {@code class} 字段（英文，如 Heavy tank）。
     * <p>Blitz 不存在自行火炮车种；tankopedia 未提供时返回 {@link #UNKNOWN_TANK_CLASS}，
     * 调用方必须原样输出「未知」，不得由坦克名称推断。AI 复盘正文语言由前端 {@code lang}
     * 参数控制，后端不在此处做中文本地化。</p>
     */
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

    /**
     * 结构化车辆类型（英文，如 {@code Heavy tank}），仅取自 tankopedia 的 {@code class} 字段。
     * 供 API/前端映射用（API 纯英文契约）：replay 自带 tankType 缺失时的统一 fallback；
     * 缺失返回空串（前端展示 —），不得由名称推断。
     */
    public static String tankClassEn(final long tankId) {
        if (tankId <= 0) {
            return "";
        }
        final String type = TankopediaReferenceData.tankopedia().info(tankId).type();
        return StringUtils.hasText(type) ? type : "";
    }

    /** 结构化车辆等级，仅取自 tankopedia 的 {@code tier}；缺失返回空串，不得由名称推断。 */
    public static String tankTier(final long tankId) {
        if (tankId <= 0) {
            return "";
        }
        final Object tier = TankopediaReferenceData.tankopedia().info(tankId).tier();
        final String text = tier == null ? "" : String.valueOf(tier);
        return text.isBlank() ? "" : text;
    }

    /** 结构化车辆国家，仅取自 tankopedia 的 {@code nation}（英文，如 USA）；缺失返回空串。 */
    public static String tankNation(final long tankId) {
        if (tankId <= 0) {
            return "";
        }
        final String nation = TankopediaReferenceData.tankopedia().info(tankId).nation();
        return StringUtils.hasText(nation) ? nation : "";
    }

    /** 结构化车辆炮伤，仅取自 tankopedia 的 {@code alphaDamage}；缺失或 ≤0 返回空串。 */
    public static String tankAlphaDamage(final long tankId) {
        if (tankId <= 0) {
            return "";
        }
        final Integer alpha = TankopediaReferenceData.tankopedia().info(tankId).alphaDamage();
        return alpha != null && alpha > 0 ? String.valueOf(alpha) : "";
    }

    /** 结构化车辆血量，仅取自 tankopedia 的 {@code hp/maxHp}；缺失或 ≤0 返回空串。 */
    public static String tankMaxHp(final long tankId) {
        if (tankId <= 0) {
            return "";
        }
        final Integer hp = TankopediaReferenceData.tankopedia().info(tankId).maxHp();
        return hp != null && hp > 0 ? String.valueOf(hp) : "";
    }

    /**
     * 结构化车辆 tankopedia 满血量数值（legacy compatibility facade）。
     *
     * <p><b>契约</b>：该值只是 {@code BASE_REFERENCE}——tankopedia base HP，
     * 不是本场 actualStartingHp / actualMaxHp / currentHp。新代码需要结构化 reference data 时
     * 应直接使用 {@link TankopediaReferenceData}，不要继续扩展本 display helper。</p>
     */
    public static Integer tankMaxHpValue(final long tankId) {
        if (tankId <= 0) {
            return null;
        }
        final Integer hp = TankopediaReferenceData.tankopedia().info(tankId).maxHp();
        return hp != null && hp > 0 ? hp : null;
    }

    /** Legacy compatibility alias; new code should query {@link TankopediaReferenceData} directly. */
    public static Integer tankBaseHpValue(final long tankId) {
        return tankMaxHpValue(tankId);
    }

    /** 手工维护的每辆车知识点，取自 tankopedia 的 {@code extraInfo}；空串时不输出。 */
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
