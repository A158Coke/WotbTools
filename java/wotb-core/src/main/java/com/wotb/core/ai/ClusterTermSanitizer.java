package com.wotb.core.ai;

import java.util.Collection;
import java.util.Comparator;
import java.util.List;

/**
 * AI 用户可见自由文本的「簇」字确定性兜底（prompt 规则「禁止输出簇字及组合」的字符级保障）。
 * <p>替换顺序：① 需要特殊自然表达的词先替换（簇拥→聚集、簇状→集群状）→
 * ② 短语级自然替换（一簇/同簇/成簇/分簇/主力簇/多簇）→ ③ 剩余「簇」字符兜底为「群」。
 * 兜底用单字「群」而非「集群」，不会把已替换出的「集群」二次污染成「集集群」。
 * 语义同 {@code PreBattleSectionRenderer} 的用语卫生段；供复盘正文/赛前预测统一复用。</p>
 * <p><b>权威 proper noun 保护</b>：合法玩家昵称/权威坦克名本身可能包含「簇」（如昵称
 * 「星簇」）。{@link #sanitize(String, Collection)} 接受 protected literals——它们按
 * 出现位置原样保留（最长优先、重叠不互相污染），其余自由文本应用「簇」替换链。
 * 契约：AI 生成的内部术语「簇」会被确定性转换，权威玩家昵称/车辆名称保持原样。</p>
 */
public final class ClusterTermSanitizer {

    private ClusterTermSanitizer() {
    }

    /**
     * 确定性替换：无保护名单版本（仅自由文本语义；调用方应优先传入权威 proper noun）。
     */
    public static String sanitize(final String text) {
        return sanitize(text, List.of());
    }

    /**
     * 带权威 proper noun 保护的确定性替换。
     * protectedLiterals 中出现的子串原样保留（按最早出现位置切分；同位置取最长 literal；
     * 重叠 literal 不互相污染），其余文本应用「簇」替换链。null/blank 输入安全。
     */
    public static String sanitize(final String text, final Collection<String> protectedLiterals) {
        if (text == null) {
            return null;
        }
        if (protectedLiterals == null || protectedLiterals.isEmpty()) {
            return replaceCluster(text);
        }
        final List<String> literals = protectedLiterals.stream()
                .filter(l -> l != null && !l.isEmpty())
                .sorted(Comparator.comparingInt(String::length).reversed())
                .toList();
        if (literals.isEmpty()) {
            return replaceCluster(text);
        }
        final StringBuilder sb = new StringBuilder(text.length() + 16);
        int i = 0;
        while (i < text.length()) {
            int next = -1;
            String literal = null;
            for (final String l : literals) {
                final int idx = text.indexOf(l, i);
                // 最早出现位置优先；同位置由 longest-first 排序保证取最长 literal
                if (idx >= 0 && (next < 0 || idx < next)) {
                    next = idx;
                    literal = l;
                }
            }
            if (literal == null) {
                sb.append(replaceCluster(text.substring(i)));
                break;
            }
            if (next > i) {
                sb.append(replaceCluster(text.substring(i, next)));
            }
            sb.append(literal);
            i = next + literal.length();
        }
        return sb.toString();
    }

    /**
     * 「簇」替换链（短语优先，单字兜底）。
     */
    private static String replaceCluster(final String text) {
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
