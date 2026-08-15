package com.wotb.core.ai;

/**
 * AI 用户可见自由文本的「簇」字确定性兜底（prompt 规则「禁止输出簇字及组合」的字符级保障）。
 * <p>替换顺序：① 需要特殊自然表达的词先替换（簇拥→聚集、簇状→集群状）→
 * ② 短语级自然替换（一簇/同簇/成簇/分簇/主力簇/多簇）→ ③ 剩余「簇」字符兜底为「群」。
 * 兜底用单字「群」而非「集群」，不会把已替换出的「集群」二次污染成「集集群」。
 * 语义同 {@code PreBattleSectionRenderer} 的用语卫生段；供复盘正文/赛前预测统一复用。</p>
 */
public final class ClusterTermSanitizer {

    private ClusterTermSanitizer() {
    }

    /** 确定性替换：输出不含「簇」字；null 输入返回 null（调用方保持 null 语义）。 */
    public static String sanitize(final String text) {
        if (text == null) {
            return null;
        }
        return text
                .replace("簇拥", "聚集")
                .replace("簇状", "集群状")
                .replace("一簇", "一批")
                .replace("同簇", "集群")
                .replace("成簇", "集群")
                .replace("分簇", "分散")
                .replace("主力簇", "主力集群")
                .replace("多簇", "多股")
                .replace("簇", "群");
    }
}
