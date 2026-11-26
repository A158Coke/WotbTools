package com.wotb.core.ai;

import java.util.Collection;
import java.util.Comparator;
import java.util.List;

public final class ClusterTermSanitizer {

    private ClusterTermSanitizer() {
    }

    public static String sanitize(final String text) {
        return sanitize(text, List.of());
    }

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
