package com.wotb.core.ai;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;

/** ClusterTermSanitizer：「簇」字确定性兜底——每个组合词精确替换、输出不再含「簇」、普通文本不受影响。 */
class ClusterTermSanitizerTest {

    @Test
    void replacesPhraseCombinations() {
        assertEquals("聚集", ClusterTermSanitizer.sanitize("簇拥"));
        assertEquals("集群状", ClusterTermSanitizer.sanitize("簇状"));
        assertEquals("一批", ClusterTermSanitizer.sanitize("一簇"));
        assertEquals("集群", ClusterTermSanitizer.sanitize("同簇"));
        assertEquals("集群", ClusterTermSanitizer.sanitize("成簇"));
        assertEquals("分散", ClusterTermSanitizer.sanitize("分簇"));
        assertEquals("主力集群", ClusterTermSanitizer.sanitize("主力簇"));
        assertEquals("多股", ClusterTermSanitizer.sanitize("多簇"));
    }

    @Test
    void bareClusterCharacterBecomesGroup() {
        // 兜底用单字「群」而非「集群」，避免把已替换出的「集群」二次污染成「集集群」
        assertEquals("这群坦克", ClusterTermSanitizer.sanitize("这簇坦克"));
    }

    @Test
    void outputNeverContainsClusterCharacter() {
        final List<String> inputs = List.of(
                "这簇坦克呈一字队形", "主力簇集中一波", "簇拥在掩体后",
                "多簇分头推进", "一簇轻坦", "分簇行动", "成簇的装甲集群", "同簇编队");
        for (final String in : inputs) {
            assertFalse(ClusterTermSanitizer.sanitize(in).contains("簇"),
                    "输出不得残留「簇」: " + in + " -> " + ClusterTermSanitizer.sanitize(in));
        }
    }

    @Test
    void normalTextWithoutClusterCharacterIsUnchanged() {
        assertEquals("常规推进，主力集群集中一波，抢占制高点",
                ClusterTermSanitizer.sanitize("常规推进，主力集群集中一波，抢占制高点"));
        assertEquals("集集群", ClusterTermSanitizer.sanitize("集集群"), "不含「簇」不得被污染");
    }

    @Test
    void nullIsSafe() {
        assertNull(ClusterTermSanitizer.sanitize(null));
    }
}
