package com.wotb.web.replay.ai;

import com.wotb.core.replay.event.ShotResultEvent;
import com.wotb.core.replay.facts.ShotFact;
import com.wotb.core.replay.facts.ShotResolution;
import com.wotb.core.replay.facts.TargetingShotPair;
import com.wotb.core.replay.reconstruction.Vector3;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertTrue;

/** D6：录像者射击事实渲染（canonical facts 进入 AI context，未知项标注 UNKNOWN）。 */
class RecorderShotEvidenceTest {

    @Test
    void rendersRecorderShotWithResolutionAndTargeting() {
        final ShotResolution resolution = ShotResolution.of(
                0x0410, List.of(1, 2),
                List.of(new ShotResultEvent.ComponentResult(36, 1)));
        final ShotFact shot = new ShotFact(9001, 10, 1001L, 7.0,
                new Vector3(1f, 2f, 3f), new Vector3(100f, 0f, 0f),
                8.0, new Vector3(50f, 10f, 20f),
                1, 0x003C5A0A, resolution, true);
        final TargetingShotPair pair = new TargetingShotPair(
                9001, 0.1, -0.05, 2.158, 1.0, 1.5, 0.5);
        final StringBuilder sb = new StringBuilder();
        PlayerEvidenceFormatter.appendRecorderShotEvidence(sb, List.of(shot), List.of(pair));

        final String out = sb.toString();
        assertTrue(out.contains("RECORDER_COMBAT_FACTS_BACKEND_COMPUTED"));
        assertTrue(out.contains("发射"));
        assertTrue(out.contains("弹药选择=1"));
        assertTrue(out.contains("0x3C5A0A"), "descriptor 以 hex 输出（不臆测弹种名）");
        assertTrue(out.contains("命中结果"));
        assertTrue(out.contains("弹体击穿"));
        assertTrue(out.contains("履带受损"));
        assertTrue(out.contains("精准射击+钨芯弹"), "modifier additive [1,2]");
        assertTrue(out.contains("gun:损坏"));
        assertTrue(out.contains("开火前散布=1.0000"));
        assertTrue(out.contains("开火后散布增量=+0.5000"));
    }

    @Test
    void unknownFieldsAreMarkedUnknownNotZero() {
        final ShotFact shot = new ShotFact(9002, 10, 1001L, 7.0,
                new Vector3(0f, 0f, 0f), new Vector3(1f, 0f, 0f),
                null, null, null, null, null, true);
        final StringBuilder sb = new StringBuilder();
        PlayerEvidenceFormatter.appendRecorderShotEvidence(sb, List.of(shot), List.of());
        final String out = sb.toString();
        assertTrue(out.contains("弹药选择=UNKNOWN"), "无 Type28 → UNKNOWN，不得伪造 0");
        assertTrue(out.contains("命中结果=UNKNOWN"), "无 method38 → UNKNOWN");
        assertTrue(!out.contains("命中终点"), "无 method20 → 不写命中终点");
    }

    @Test
    void nonRecorderShotsAreNotRendered() {
        final ShotFact enemy = new ShotFact(9003, 20, 2001L, 7.0,
                new Vector3(0f, 0f, 0f), new Vector3(1f, 0f, 0f),
                null, null, null, null, null, false);
        final StringBuilder sb = new StringBuilder();
        PlayerEvidenceFormatter.appendRecorderShotEvidence(sb, List.of(enemy), List.of());
        assertTrue(sb.isEmpty(), "全局弹丸流中的非 recorder 射击不得渲染为「你」的射击");
    }
}
