package com.wotb.storage;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.wotb.contracts.ObjectKey;
import org.junit.jupiter.api.Test;

/** Pure unit contract for the single object-key layout; needs no MinIO. */
class ObjectStorageKeysTest {

    @Test
    void buildsTheFixedTempJobLayout() {
        final ObjectKey key = ObjectStorageKeys.tempJobObject("job-1", "artifacts/0/ai-facts.json");

        assertEquals("temp/jobs/job-1/artifacts/0/ai-facts.json", key.value());
        assertTrue(key.value().startsWith("temp/jobs/"));
    }

    @Test
    void buildsKeysForEveryDocumentedSubPath() {
        assertEquals(
                "temp/jobs/job-1/input/0/round.wotbreplay",
                ObjectStorageKeys.tempJobObject("job-1", "input/0/round.wotbreplay").value());
        assertEquals(
                "temp/jobs/job-1/result/source-0.json",
                ObjectStorageKeys.tempJobObject("job-1", "result/source-0.json").value());
    }

    @Test
    void rejectsBlankParts() {
        assertThrows(IllegalArgumentException.class, () -> ObjectStorageKeys.tempJobObject(null, "input/0/a"));
        assertThrows(IllegalArgumentException.class, () -> ObjectStorageKeys.tempJobObject("  ", "input/0/a"));
        assertThrows(IllegalArgumentException.class, () -> ObjectStorageKeys.tempJobObject("job-1", null));
        assertThrows(IllegalArgumentException.class, () -> ObjectStorageKeys.tempJobObject("job-1", " "));
    }

    @Test
    void rejectsTraversal() {
        assertThrows(IllegalArgumentException.class, () -> ObjectStorageKeys.tempJobObject("..", "input/0/a"));
        assertThrows(IllegalArgumentException.class, () -> ObjectStorageKeys.tempJobObject("job-1", ".."));
        assertThrows(IllegalArgumentException.class, () -> ObjectStorageKeys.tempJobObject("job-1", "../../etc/passwd"));
        assertThrows(IllegalArgumentException.class, () -> ObjectStorageKeys.tempJobObject("job-1", "input/../result/a"));
        assertThrows(IllegalArgumentException.class, () -> ObjectStorageKeys.tempJobObject("job-1", "a..b"));
    }

    @Test
    void rejectsAbsoluteAndSeparatorBearingParts() {
        assertThrows(IllegalArgumentException.class, () -> ObjectStorageKeys.tempJobObject("/job-1", "input/0/a"));
        assertThrows(IllegalArgumentException.class, () -> ObjectStorageKeys.tempJobObject("job-1", "/input/0/a"));
        assertThrows(IllegalArgumentException.class, () -> ObjectStorageKeys.tempJobObject("a/b", "input/0/a"));
        assertThrows(IllegalArgumentException.class, () -> ObjectStorageKeys.tempJobObject("job\\1", "input/0/a"));
        assertThrows(IllegalArgumentException.class, () -> ObjectStorageKeys.tempJobObject("job-1", "input\\0\\a"));
    }

    @Test
    void rejectsControlCharacters() {
        assertThrows(IllegalArgumentException.class, () -> ObjectStorageKeys.tempJobObject("job\u00001", "input/0/a"));
        assertThrows(IllegalArgumentException.class, () -> ObjectStorageKeys.tempJobObject("job-1", "input/0/a\n"));
        assertThrows(IllegalArgumentException.class, () -> ObjectStorageKeys.tempJobObject("job-1", "input/0/\u007fb"));
    }
}
