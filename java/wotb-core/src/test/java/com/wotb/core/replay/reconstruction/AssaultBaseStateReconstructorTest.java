package com.wotb.core.replay.reconstruction;

import com.wotb.core.replay.event.AssaultBaseStateTransition;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.RawAssaultBaseUpdate;
import com.wotb.core.replay.event.RawSupremacyBaseUpdate;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class AssaultBaseStateReconstructorTest {

    @Test
    void objectiveRequiresMoreThanBareInitialization() {
        // 裸初始化对是通用广播：普通对局（Regular / TrainingRoom）同样只发这一对，
        // 不得据此判定"有目标"（62 份真实样本里 8 份普通对局正是如此）。
        final List<ReplayEvent> bare = List.of(raw(1, 2, 1, null, null), raw(2, 1, 1, null, null));
        assertEquals(false, AssaultBaseStateReconstructor.hasObjective(bare));
        assertEquals(List.of(), AssaultBaseStateReconstructor.reconstruct(bare));

        // 目标族发出裸初始化对以外的字段（field4 标志流 / field3 进度）→ 目标存在
        assertEquals(true, AssaultBaseStateReconstructor.hasObjective(
                List.of(raw(1, 2, 1, null, null), raw(2, 2, 1, null, 1))));
        assertEquals(true, AssaultBaseStateReconstructor.hasObjective(
                List.of(raw(1, 2, 1, 0, null))));
        // 目标存在但无进度 → 不合成进度事件
        assertEquals(List.of(), AssaultBaseStateReconstructor.reconstruct(
                List.of(raw(1, 2, 1, null, 1))));

        // field2 非 1：不属目标族
        assertEquals(false, AssaultBaseStateReconstructor.hasObjective(
                List.of(raw(1, 2, 2, null, 1))));
    }

    @Test
    void canonicalTransitionAloneProvesObjective() {
        // 调用方只递 canonical 事件时的门槛：canonical 迁移只可能由 field3 存在产生，
        // 故其存在即证明目标存在——只看原始更新会误判为无目标（CI 抓到的漏项）。
        final List<ReplayEvent> events = List.of(
                raw(1, 2, 1, null, null),
                new AssaultBaseStateTransition(2, new ReplayTimestamp(2, null), 8,
                        DecodeConfidence.EXACT, 100));
        assertEquals(true, AssaultBaseStateReconstructor.hasObjective(events));
    }

    @Test
    void progressIsAcceptedFromEitherField1Side() {
        // 遭遇战（Naval Frontier 真实样本）里进度**只**由 field1=1 承载，
        // field1=2 族只有常量 field4=1；旧判据 field1==2 会得到空时间线。
        final List<ReplayEvent> events = List.of(
                raw(1, 2, 1, null, 1),
                raw(2, 1, 1, 1, null),
                raw(3, 1, 1, 19, null),
                raw(4, 2, 1, 7, null));
        final List<AssaultBaseStateTransition> states =
                AssaultBaseStateReconstructor.reconstruct(events);
        assertEquals(List.of(1, 19, 7),
                states.stream().map(AssaultBaseStateTransition::captureProgress).toList());
    }

    @Test
    void reconstructsInitializationAndFullCaptureIncludingOneHundred() {
        final List<ReplayEvent> events = List.of(
                raw(1, 2, 1, 0, null),
                raw(2, 1, 1, null, 1),
                raw(3, 2, 1, 1, null),
                raw(4, 2, 1, 99, null),
                raw(5, 2, 1, 100, null),
                raw(6, 2, 1, 50, null));

        final List<AssaultBaseStateTransition> states =
                AssaultBaseStateReconstructor.reconstruct(events);

        assertEquals(List.of(0, 1, 99, 100, 50),
                states.stream().map(AssaultBaseStateTransition::captureProgress).toList());
    }

    @Test
    void missingAndInvalidProgressNeverCreateCanonicalStates() {
        assertEquals(List.of(), AssaultBaseStateReconstructor.reconstruct(List.of(
                raw(1, 2, 1, null, null), raw(2, 2, 1, -1, null),
                raw(3, 2, 1, 101, null), raw(4, 2, 2, 50, null),
                raw(5, 1, 1, 300, null), raw(6, 3, 1, 50, null))));
    }

    @Test
    void siblingRawFamilyDoesNotBecomeCanonicalTeamState() {
        final List<AssaultBaseStateTransition> states =
                AssaultBaseStateReconstructor.reconstruct(List.of(raw(1, 1, 1, null, 1)));
        assertEquals(List.of(), states);
    }

    @Test
    void suppressesSingleBaseProjectionWhenSupremacyWrapper12IsPresent() {
        final RawSupremacyBaseUpdate supremacy = new RawSupremacyBaseUpdate(
                2, new ReplayTimestamp(2, null), 8, DecodeConfidence.EXACT,
                0, 0, 0, 0, null, null);
        final List<AssaultBaseStateTransition> states =
                AssaultBaseStateReconstructor.reconstruct(List.of(
                        raw(1, 2, 1, 40, null), supremacy));
        assertEquals(List.of(), states);
    }

    private static RawAssaultBaseUpdate raw(final int sequence,
            final Integer field1, final Integer field2,
            final Integer progress, final Integer field4) {
        return new RawAssaultBaseUpdate(
                sequence, new ReplayTimestamp(sequence, null), 8, DecodeConfidence.EXACT,
                field1, field2, progress, field4);
    }
}
