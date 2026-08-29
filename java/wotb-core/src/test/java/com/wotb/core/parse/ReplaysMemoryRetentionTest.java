package com.wotb.core.parse;

import com.wotb.core.model.Battle;
import com.wotb.core.model.Source;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

/** Phase 4 内存契约：解析完成后的 ParsedEntry 不持有 Source / byte[]。 */
class ReplaysMemoryRetentionTest {

    @Test
    void parsedEntriesDoNotRetainSourceOrRawBytes() {
        final List<Source> sources = List.of(new Source("a.wotbreplay", new byte[64]));
        final List<Replays.ParsedEntry> entries = Replays.parseAll(sources, s -> {
            final Battle battle = new Battle();
            battle.arenaId = "arena-1";
            return battle;
        }, null);

        assertEquals(1, entries.size());
        final Replays.ParsedEntry entry = entries.getFirst();
        assertEquals("a.wotbreplay", entry.sourceName());
        assertEquals(0, entry.sourceIndex());
        assertEquals("arena-1", entry.battle().arenaId);

        // record 组件不得包含 Source 类型（byte[] 只能经 Source 引用，删之即无强引用）
        final boolean hasSourceComponent = java.util.Arrays.stream(entry.getClass().getRecordComponents())
                .anyMatch(c -> c.getType().getSimpleName().equals("Source"));
        assertFalse(hasSourceComponent,
                "ParsedEntry 不得持有 Source/byte[]（batch 聚合阶段不再需要原始字节）");
    }

    @Test
    void failedEntryKeepsNameIndexAndMessageWithoutSource() {
        final List<Replays.ParsedEntry> entries = Replays.parseAll(
                List.of(new Source("bad.wotbreplay", new byte[]{1})),
                s -> {
                    throw new IllegalArgumentException("NO_BATTLE_DATA");
                }, null);

        final Replays.ParsedEntry entry = entries.getFirst();
        assertEquals("bad.wotbreplay", entry.sourceName());
        assertEquals(0, entry.sourceIndex());
        assertEquals("NO_BATTLE_DATA", entry.failureMessage());
        assertFalse(java.util.Arrays.stream(entry.getClass().getRecordComponents())
                .anyMatch(c -> c.getType().getSimpleName().equals("Source")));
    }
}
