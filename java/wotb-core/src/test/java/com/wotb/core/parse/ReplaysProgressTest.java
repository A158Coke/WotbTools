package com.wotb.core.parse;

import com.wotb.core.model.Battle;
import com.wotb.core.model.Collected;
import com.wotb.core.model.Source;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** 回归：collect 的逐文件进度回调每个输入恰好回调一次，结果类别正确（§11/§12）。 */
class ReplaysProgressTest {

    @Test
    void progressFiresPerSourceWithCorrectOutcome() {
        final List<Source> sources = List.of(
                new Source("a.wotbreplay", new byte[]{1}),
                new Source("b.wotbreplay", new byte[]{2}),   // 与 a 同 arenaId → duplicate
                new Source("c.wotbreplay", new byte[]{3}));  // loader 抛异常 → failure

        final List<String> outcomes = new ArrayList<>();
        final Collected collected = Replays.collect(sources,
                source -> {
                    if (source.name().startsWith("c")) {
                        throw new IllegalArgumentException("NO_BATTLE_DATA");
                    }
                    final Battle battle = new Battle();
                    battle.arenaId = "same-arena";
                    return battle;
                },
                null,
                (source, outcome) -> outcomes.add(source.name() + ":" + outcome));

        assertEquals(List.of("a.wotbreplay:SUCCESS", "b.wotbreplay:DUPLICATE", "c.wotbreplay:FAILURE"), outcomes);
        assertEquals(1, collected.battles.size());
        assertEquals(1, collected.duplicates.size());
        assertEquals(1, collected.failures.size());
    }

    @Test
    void noProgressListenerIsBackwardCompatible() {
        final Source source = new Source("a.wotbreplay", new byte[]{1});
        final Battle battle = new Battle();
        battle.arenaId = "arena";
        final Collected collected = Replays.collect(List.of(source),
                s -> battle,
                null,
                null);
        assertEquals(1, collected.battles.size());
    }
}
