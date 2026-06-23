package com.wotb.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;

import java.io.InputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 自包含的表现评分 (类 WN8 机制, 但"期望值"来自当前处理的这批战斗, 不依赖外部表)。
 *
 *  1) 每人每场算"有效贡献" EC(伤害为主, 计入协助/格挡/击杀)。
 *  2) 按车型(轻/中/重/TD)从这批数据求 EC 基准均值; 同型相比 -> 跨车型公平。
 *     同型样本不足时, 基准 = 全体均值 * 车型难度系数(避免独苗轻坦被重坦拉低)。
 *  3) Rating = scale * EC/基准 * (1 + 胜场微调)。scale(默认1000) = 同型平均。
 *
 * 所有可调参数在 common/rating.json(classpath:/rating.json), 缺失则用内置默认。
 */
public final class Rating {

    /** 可调配置(对应 common/rating.json)。 */
    public static final class Config {
        public double assist = 0.6;
        public double block = 0.35;
        public double killValue = 200;
        public double winBonus = 0.05;
        public int minSamples = 5;
        public int scale = 1000;
        public Map<String, Double> classFactor = new HashMap<>(Map.of(
                "重坦", 1.0, "中坦", 0.9, "TD", 1.0, "轻坦", 0.7, "其他", 0.9));
        public double defaultFactor = 1.0;

        double factor(final String cls) {
            return classFactor.getOrDefault(cls, defaultFactor);
        }
    }

    private static volatile Config config = load();

    private Rating() {
    }

    /** 当前配置。 */
    public static Config config() {
        return config;
    }

    /** 重新加载配置(改了 rating.json 后可调用)。 */
    public static void reload() {
        config = load();
    }

    private static Config load() {
        Config c = new Config();
        try (InputStream in = Rating.class.getResourceAsStream("/rating.json")) {
            if (in != null) {
                JsonNode n = new ObjectMapper().readTree(in);
                JsonNode w = n.get("weights");
                if (w != null) {
                    c.assist = w.path("assist").asDouble(c.assist);
                    c.block = w.path("block").asDouble(c.block);
                    c.killValue = w.path("killValue").asDouble(c.killValue);
                    c.winBonus = w.path("winBonus").asDouble(c.winBonus);
                }
                c.minSamples = n.path("minSamples").asInt(c.minSamples);
                c.scale = n.path("scale").asInt(c.scale);
                JsonNode cf = n.get("classFactor");
                if (cf != null && cf.isObject()) {
                    Map<String, Double> m = new HashMap<>();
                    cf.fields().forEachRemaining(e -> m.put(e.getKey(), e.getValue().asDouble()));
                    if (!m.isEmpty()) {
                        c.classFactor = m;
                    }
                }
            }
        } catch (Exception ignored) {
            // 配置缺失/损坏 -> 用内置默认
        }
        return c;
    }

    /** 有效贡献(伤害当量)。 */
    public static double effectiveContribution(final PlayerResult p) {
        Config c = config;
        return p.damageDealt
                + c.assist * p.damageAssisted
                + c.block * p.damageBlocked
                + c.killValue * p.kills;
    }

    /** 对一批战斗的所有玩家计算并写入 rating。基准按车型从这批数据求得。 */
    public static void compute(final List<Battle> battles, final Tankopedia tp) {
        Config c = config;
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
                double baseline = (acc != null && acc[1] >= c.minSamples)
                        ? acc[0] / acc[1]
                        : overall * c.factor(cls);
                if (baseline <= 0) {
                    baseline = overall > 0 ? overall : 1;
                }
                double ratio = effectiveContribution(p) / baseline;
                boolean win = winner != null && winner != 0 && p.team == winner;
                p.rating = (int) Math.round(c.scale * ratio * (1 + (win ? c.winBonus : 0)));
            }
        }
    }

    /** 车型分桶键; 无车型信息归入"其他"。 */
    private static String classKey(final Tankopedia tp, final PlayerResult p) {
        String type = tp.info(p.tankId).type;
        return (type == null || type.isEmpty()) ? "其他" : type;
    }
}
