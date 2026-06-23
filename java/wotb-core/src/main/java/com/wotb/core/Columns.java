package com.wotb.core;

import com.wotb.core.model.PlayerResult;

import java.util.List;
import java.util.Set;
import java.util.function.Function;

/**
 * 集中的列定义 (Excel 与各前端共用)。
 */
public final class Columns {

    /** 一列: 表头 / 键 / Excel宽 / GUI像素宽 / 是否数值 / 取值函数。 */
    public record Col(String title, String key, int xlsx, int px, boolean num,
                      Function<PlayerResult, Object> get) {
    }

    private Columns() {
    }

    public static final List<Col> IDENTITY = List.of(
            new Col("玩家", "nickname", 20, 130, false, p -> p.nickname),
            new Col("战队", "clan", 10, 70, false, p -> p.clan),
            new Col("车辆", "tank_name", 20, 120, false, p -> p.tankName),
            new Col("等级", "tank_tier", 6, 45, true, p -> p.tankTier),
            new Col("坦克类型", "tank_type", 9, 60, false, p -> p.tankType),
            new Col("国家", "tank_nation", 8, 55, false, p -> p.tankNation)
    );

    public static final List<Col> STAT = List.of(
            new Col("评分", "rating", 6, 55, true, p -> p.rating),
            new Col("存活", "survived_label", 6, 45, false, p -> p.survived ? "存活" : "阵亡"),
            new Col("击杀", "kills", 6, 45, true, p -> p.kills),
            new Col("伤害", "damage_dealt", 8, 65, true, p -> p.damageDealt),
            new Col("协助伤害", "damage_assisted", 9, 65, true, p -> p.damageAssisted),
            new Col("损失血量", "damage_received", 9, 65, true, p -> p.damageReceived),
            new Col("格挡", "damage_blocked", 9, 65, true, p -> p.damageBlocked),
            new Col("发射", "n_shots", 6, 45, true, p -> p.nShots),
            new Col("命中", "n_hits_dealt", 6, 45, true, p -> p.nHitsDealt),
            new Col("击穿", "n_penetrations_dealt", 6, 45, true, p -> p.nPenetrationsDealt),
            new Col("被命中", "n_hits_received", 7, 50, true, p -> p.nHitsReceived),
            new Col("被击穿", "n_penetrations_received", 7, 50, true, p -> p.nPenetrationsReceived),
            new Col("击伤", "n_enemies_damaged", 9, 55, true, p -> p.nEnemiesDamaged)
    );

    public static final List<Col> TAIL = List.of(
            new Col("排", "platoon_label", 6, 40, false, p -> p.platoonLabel),
            new Col("车辆ID", "tank_id", 9, 65, true, p -> p.tankId),
            new Col("账号ID", "account_id", 12, 95, true, p -> p.accountId)
    );

    /** 单场「玩家数据」表完整列。 */
    public static final List<Col> PLAYER = concat(IDENTITY, STAT, TAIL);

    /** 左对齐(文本)列。 */
    public static final Set<String> LEFT_ALIGN = Set.of(
            "nickname", "clan", "tank_name", "date", "map_name");

    private static List<Col> concat(List<Col>... lists) {
        java.util.ArrayList<Col> out = new java.util.ArrayList<>();
        for (List<Col> l : lists) {
            out.addAll(l);
        }
        return List.copyOf(out);
    }

    /** 表头显示宽度: 中文算 2, 其余算 1。 */
    public static int displayWidth(String text) {
        int w = 0;
        for (int i = 0; i < text.length(); i++) {
            w += text.charAt(i) > 0x2E7F ? 2 : 1;
        }
        return w;
    }
}
