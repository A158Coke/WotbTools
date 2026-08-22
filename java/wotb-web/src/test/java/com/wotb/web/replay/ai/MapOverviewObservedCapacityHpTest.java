package com.wotb.web.replay.ai;

import com.wotb.web.replay.dto.MapOverview;
import com.wotb.web.replay.dto.MapOverview.HpSample;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * MapOverview.observedCapacityHpOf：observedCapacityHp 必须来自真实可信 Type-7 positive HP 采样
 * 的最大值（纯回放观测）——无可信 sample 为 null；绝不 max(观测, tankopedia base)、不 fallback base。
 */
class MapOverviewObservedCapacityHpTest {

    private static HpSample sample(final double t, final int hp) {
        return new HpSample(t, hp);
    }

    @Test
    void noSampleYieldsNull() {
        assertNull(MapOverview.observedCapacityHpOf(null));
        assertNull(MapOverview.observedCapacityHpOf(List.of()));
    }

    @Test
    void singlePositiveSampleYieldsItsValue() {
        // sample=2000、base=3400（外部）→ observedCapacityHp=2000（绝不用 base 钳制/回退）
        assertEquals(2000, MapOverview.observedCapacityHpOf(List.of(sample(10, 2000))));
    }

    @Test
    void maxAcrossSamples() {
        // samples=3189/2800 → observedCapacityHp=3189
        assertEquals(3189, MapOverview.observedCapacityHpOf(
                List.of(sample(10, 2800), sample(0, 3189))));
    }

    @Test
    void destroyedZeroOnlyYieldsNull() {
        // 只有阵亡 0 采样（无 positive）→ null：0 不是容量
        assertNull(MapOverview.observedCapacityHpOf(List.of(sample(31, 0))));
        assertEquals(3000, MapOverview.observedCapacityHpOf(
                List.of(sample(30, 3000), sample(31, 0))));
    }

    @Test
    void helperIsPureMaxOverAlreadyTrustedSamples() {
        // helper 只对「已可信」的 hpSamples 取最大值——sentinel（0xFFFD=65533 等）过滤发生在
        // hpSamples 构建层（builder 只放 EXACT & isPlausibleHp 样本进 hpSamples），helper 不再重复过滤。
        assertEquals(65533, MapOverview.observedCapacityHpOf(
                List.of(sample(10, 2000), sample(11, 65533))));
    }
}
