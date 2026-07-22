package com.wotb.core.stats;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.ref.VehicleCodes;
import org.springframework.util.StringUtils;

import java.io.InputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 自包含的表现评分 (类 WN8 机制, 但"期望值"来自当前处理的这批战斗, 不依赖外部表)。
 *  1) 每人每场算"有效贡献" EC(伤害为主, 计入协助/格挡/击杀)。
 *  2) 按车型(轻/中/重/TD)从这批数据求 EC 基准均值; 同型相比 -> 跨车型公平。
 *     同型样本不足时, 基准 = 全体均值 * 车型难度系数(避免独苗轻坦被重坦拉低)。
 *  3) Rating = scale * EC/基准 * (1 + 胜场微调)。scale(默认1000) = 同型平均。
 * 所有可调参数在 common/rating.json(classpath:/rating.json), 缺失则用内置默认。
 */
public final class Rating {

    /** 可调配置(对应 common/rating.json), 仅 Rating 内部使用。 */
    private static final class Config {
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

    private static final Config config = load();

    private Rating() {
    }

    /** 当前生效的评分参数快照 (供 API / 前端展示; 内部计算仍直接用私有 config 字段)。 */
    public static RatingConfig config() {
        final Config c = config;
        final Map<String, Double> publicClassFactors = c.classFactor.entrySet().stream()
                .collect(Collectors.toUnmodifiableMap(
                        entry -> VehicleCodes.classCode(entry.getKey()),
                        Map.Entry::getValue,
                        (first, second) -> second));
        return new RatingConfig(c.assist, c.block, c.killValue, c.winBonus,
                c.minSamples, c.scale, publicClassFactors);
    }

    private static Config load() {
        final Config c = new Config();
        try (InputStream in = Rating.class.getResourceAsStream("/rating.json")) {
            if (in != null) {
                final JsonNode n = JsonMapper.builder().build().readTree(in);
                final JsonNode w = n.get("weights");
                if (w != null) {
                    c.assist = w.path("assist").asDouble(c.assist);
                    c.block = w.path("block").asDouble(c.block);
                    c.killValue = w.path("killValue").asDouble(c.killValue);
                    c.winBonus = w.path("winBonus").asDouble(c.winBonus);
                }
                c.minSamples = n.path("minSamples").asInt(c.minSamples);
                c.scale = n.path("scale").asInt(c.scale);
                final JsonNode cf = n.get("classFactor");
                if (cf != null && cf.isObject()) {
                    final Map<String, Double> m = new HashMap<>();
                    cf.properties().forEach(e -> m.put(e.getKey(), e.getValue().asDouble()));
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
        final Config c = config;
        return p.damageDealt
                + c.assist * p.damageAssisted
                + c.block * p.damageBlocked
                + c.killValue * p.kills;
    }

    /** 对一批战斗的所有玩家计算并写入 rating。基准按车型从这批数据求得。 */
    public static void compute(final List<Battle> battles, final Tankopedia tp) {
        final Config c = config;
        final Map<String, double[]> byClass = new HashMap<>();   // class -> [sumEC, count]
        double allSum = 0;
        int allN = 0;
        for (Battle b : battles) {
            for (PlayerResult p : b.players) {
                final double ec = effectiveContribution(p);
                final String cls = classKey(tp, p);
                final double[] acc = byClass.computeIfAbsent(cls, k -> new double[2]);
                acc[0] += ec;
                acc[1] += 1;
                allSum += ec;
                allN += 1;
            }
        }
        if (allN == 0) {
            return;
        }
        final double overall = allSum / allN;

        for (Battle b : battles) {
            final Integer winner = b.winnerTeam;
            for (PlayerResult p : b.players) {
                final String cls = classKey(tp, p);
                final double[] acc = byClass.get(cls);
                double baseline = (acc != null && acc[1] >= c.minSamples)
                        ? acc[0] / acc[1]
                        : overall * c.factor(cls);
                if (baseline <= 0) {
                    baseline = overall > 0 ? overall : 1;
                }
                final double ratio = effectiveContribution(p) / baseline;
                final boolean win = winner != null && winner != 0 && p.team == winner;
                p.rating = (int) Math.round(c.scale * ratio * (1 + (win ? c.winBonus : 0)));
            }
        }
    }

    /** 车型分桶键; 无车型信息归入"其他"。 */
    private static String classKey(final Tankopedia tp, final PlayerResult p) {
        final String type = tp.info(p.tankId).type();
        return StringUtils.hasText(type) ? type : "其他";
    }
}
