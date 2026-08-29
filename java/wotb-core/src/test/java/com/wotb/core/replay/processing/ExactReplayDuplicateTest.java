package com.wotb.core.replay.processing;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ExactReplayDuplicateTest {

    private static ReplayProcessingResult success(final String hash) {
        return new ReplayProcessingResult("f", ReplayProcessingStatus.SUCCESS,
                new ReplayIdentity(hash, null, null, null, null, null),
                null, null, null, ReplayProcessingCapabilities.NONE, null, null);
    }

    @Test
    void nullOriginalThrows() {
        assertThrows(NullPointerException.class,
                () -> new ExactReplayDuplicate(null, success("h")));
    }

    @Test
    void nullDuplicateThrows() {
        assertThrows(NullPointerException.class,
                () -> new ExactReplayDuplicate(success("h"), null));
    }

    @Test
    void selfReferenceThrows() {
        var r = success("h");
        assertThrows(IllegalArgumentException.class,
                () -> new ExactReplayDuplicate(r, r));
    }

    @Test
    void originalFailedThrows() {
        var r = new ReplayProcessingResult("f", ReplayProcessingStatus.FAILED, null, null, null, null,
                ReplayProcessingCapabilities.NONE, null, null);
        assertThrows(IllegalArgumentException.class,
                () -> new ExactReplayDuplicate(r, success("h")));
    }

    @Test
    void duplicateFailedThrows() {
        var r = new ReplayProcessingResult("f", ReplayProcessingStatus.FAILED, null, null, null, null,
                ReplayProcessingCapabilities.NONE, null, null);
        assertThrows(IllegalArgumentException.class,
                () -> new ExactReplayDuplicate(success("h"), r));
    }

    @Test
    void originalIdentityNullThrows() {
        var r = new ReplayProcessingResult("f", ReplayProcessingStatus.SUCCESS, null, null, null, null,
                ReplayProcessingCapabilities.NONE, null, null);
        assertThrows(IllegalArgumentException.class,
                () -> new ExactReplayDuplicate(r, success("h")));
    }

    @Test
    void duplicateIdentityNullThrows() {
        var r = new ReplayProcessingResult("f", ReplayProcessingStatus.SUCCESS, null, null, null, null,
                ReplayProcessingCapabilities.NONE, null, null);
        assertThrows(IllegalArgumentException.class,
                () -> new ExactReplayDuplicate(success("h"), r));
    }

    @Test
    void originalHashNullThrows() {
        assertThrows(IllegalArgumentException.class,
                () -> new ExactReplayDuplicate(success(null), success("h")));
    }

    @Test
    void duplicateHashBlankThrows() {
        assertThrows(IllegalArgumentException.class,
                () -> new ExactReplayDuplicate(success("h"), success("")));
    }

    @Test
    void duplicateHashBlankSpacesThrows() {
        assertThrows(IllegalArgumentException.class,
                () -> new ExactReplayDuplicate(success("h"), success("   ")));
    }

    @Test
    void differentHashesThrows() {
        assertThrows(IllegalArgumentException.class,
                () -> new ExactReplayDuplicate(success("h1"), success("h2")));
    }

    @Test
    void sameHashSucceeds() {
        assertDoesNotThrow(() -> new ExactReplayDuplicate(success("hash-x"), success("hash-x")));
    }
}
