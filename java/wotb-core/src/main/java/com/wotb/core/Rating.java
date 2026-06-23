package com.wotb.core;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 自包含的表现评分 (类 WN8 机制, 但"期望值"来自当前处理的这批战斗, 不依赖外部表)。
 *
 * 思路:
 *  1) 每人每场算"有效贡献" EC(伤害为主, 计入协助/格挡/击杀)。
 *  2) 按车型(轻/中/重/TD)从这批数据求 EC 基准均值; 同型相比 -> 跨车型公平。
 *  3) Rating = 1000 * EC/基准 * (1 + 胜场微调)。1000 = 同型平均。
 *
 * 基准来自"被一起处理的这批战斗", 所以 rating 是相对该批数据的; 单场导出即相对该场。
 * 某车型样本不足时回退到全体基准, 避免小样本噪声。
 */
public final class Rating {

    // 可调权重(以"伤害当量"为单位)
    public static final double W_ASSIST = 0.6;     // 协助伤害权重
    public static final double W_BLOCK = 0.35;     // 格挡权重
    public static final double KILL_VALUE = 200;   // 每个击杀的当量加成
    public static final double WIN_BONUS = 0.05;   // 胜场微调
    public static final int MIN_SAMPLES = 5;       // 同车型样本不足则用 全体均值*车型系数
    public static final int SCALE = 1000;          // 1000 = 同型平均

    // 车型难度系数(经验默认, 可调): 同类样本不足时 基准 = 全体均值 * 系数。
    // 让独苗轻坦不至于被重坦拉高的全体均值压低。
    public static final Map<String, Double> CLASS_FACTOR = Map.of(
            "重坦", 1.0, "中坦", 0.9, "TD", 1.0, "轻坦", 0.7, "其他", 0.9);
    public static final double DEFAULT_FACTOR = 1.0;

    private Rating() {
    }

    private static double classFactor(String cls) {
        return CLASS_FACTOR.getOrDefault(cls, DEFAULT_FACTOR);
    }

    /** 有效贡献(伤害当量)。 */
    public static double effectiveContribution(PlayerResult p) {
        return p.damageDealt
                + W_ASSIST * p.damageAssisted
                + W_BLOCK * p.damageBlocked
                + KILL_VALUE * p.kills;
    }

    /** 对一批战斗的所有玩家计算并写入 rating。基准按车型从这批数据求得。 */
    public static void compute(List<Battle> battles, Tankopedia tp) {
        Map<String, double[]> byClass = new HashMap<>();   // class -> [sumEC, count]
        double allSum = 0;
        int allN = 0;
        for (Battle b : battles) {
            for (PlayerResult p : b.players) {
                double ec = effectiveContribution(p);
                String cls = classKey(tp, p);
                double[] acc = byClass.computeIfAbsent(cls, k -> new double[2]);
                acc[0] += ec;
                acc[1] += 1;
                allSum += ec;
                allN += 1;
            }
        }
        if (allN == 0) {
            return;
        }
        double overall = allSum / allN;

        for (Battle b : battles) {
            Integer winner = b.winnerTeam;
            for (PlayerResult p : b.players) {
                String cls = classKey(tp, p);
                double[] acc = byClass.get(cls);
                double baseline = (acc != null && acc[1] >= MIN_SAMPLES)
                        ? acc[0] / acc[1]
                        : overall * classFactor(cls);
                if (baseline <= 0) {
                    baseline = overall > 0 ? overall : 1;
                }
                double ratio = effectiveContribution(p) / baseline;
                boolean win = winner != null && winner != 0 && p.team == winner;
                p.rating = (int) Math.round(SCALE * ratio * (1 + (win ? WIN_BONUS : 0)));
            }
        }
    }

    /** 车型分桶键; 无车型信息归入"其他"。 */
    private static String classKey(Tankopedia tp, PlayerResult p) {
        String type = tp.info(p.tankId).type;
        return (type == null || type.isEmpty()) ? "其他" : type;
    }
}
