package com.wotb.core.processing;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ExactReplayDuplicateTest {

    private static ReplayProcessingResult success(final String hash) {
        return new ReplayProcessingResult("f", ReplayProcessingStatus.SUCCESS,
                new ReplayIdentity(hash, null, null, null, null, null),
                null, null, null, ReplayProcessingCapabilities.NONE, null, null);
    }

    @Test void nullOriginal() { assertThrows(NullPointerException.class, () -> new ExactReplayDuplicate(null, success("h"))); }
    @Test void nullDuplicate() { assertThrows(NullPointerException.class, () -> new ExactReplayDuplicate(success("h"), null)); }
    @Test void selfReference() { var r = success("h"); assertThrows(IllegalArgumentException.class, () -> new ExactReplayDuplicate(r, r)); }
    @Test void originalFailed() { assertThrows(IllegalArgumentException.class, () -> new ExactReplayDuplicate(new ReplayProcessingResult("f", ReplayProcessingStatus.FAILED, null, null, null, null, ReplayProcessingCapabilities.NONE, null, null), success("h"))); }
    @Test void duplicateFailed() { assertThrows(IllegalArgumentException.class, () -> new ExactReplayDuplicate(success("h"), new ReplayProcessingResult("f", ReplayProcessingStatus.FAILED, null, null, null, null, ReplayProcessingCapabilities.NONE, null, null))); }
    @Test void originalIdentityNull() { assertThrows(IllegalArgumentException.class, () -> new ExactReplayDuplicate(new ReplayProcessingResult("f", ReplayProcessingStatus.SUCCESS, null, null, null, null, ReplayProcessingCapabilities.NONE, null, null), success("h"))); }
    @Test void duplicateIdentityNull() { assertThrows(IllegalArgumentException.class, () -> new ExactReplayDuplicate(success("h"), new ReplayProcessingResult("f", ReplayProcessingStatus.SUCCESS, null, null, null, null, ReplayProcessingCapabilities.NONE, null, null))); }
    @Test void originalHashNull() { assertThrows(IllegalArgumentException.class, () -> new ExactReplayDuplicate(success(null), success("h"))); }
    @Test void duplicateHashBlank() { assertThrows(IllegalArgumentException.class, () -> new ExactReplayDuplicate(success("h"), success(""))); }
    @Test void duplicateHashBlankSpaces() { assertThrows(IllegalArgumentException.class, () -> new ExactReplayDuplicate(success("h"), success("   "))); }
    @Test void differentHashes() { assertThrows(IllegalArgumentException.class, () -> new ExactReplayDuplicate(success("h1"), success("h2"))); }
    @Test void successCase() { assertDoesNotThrow(() -> new ExactReplayDuplicate(success("hash-x"), success("hash-x"))); }
}
