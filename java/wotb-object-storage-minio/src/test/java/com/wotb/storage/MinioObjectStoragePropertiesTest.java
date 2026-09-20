package com.wotb.storage;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** Pure unit contract for injected MinIO settings; needs no MinIO. */
class MinioObjectStoragePropertiesTest {

    @Test
    void rejectsBlankSettingsAndNonPositiveTimeouts() {
        assertThrows(IllegalArgumentException.class,
                () -> new MinioObjectStorageProperties(" ", "bucket", "key", "secret", 1, 1));
        assertThrows(IllegalArgumentException.class,
                () -> new MinioObjectStorageProperties("host:9000", null, "key", "secret", 1, 1));
        assertThrows(IllegalArgumentException.class,
                () -> new MinioObjectStorageProperties("host:9000", "bucket", "", "secret", 1, 1));
        assertThrows(IllegalArgumentException.class,
                () -> new MinioObjectStorageProperties("host:9000", "bucket", "key", null, 1, 1));
        assertThrows(IllegalArgumentException.class,
                () -> new MinioObjectStorageProperties("host:9000", "bucket", "key", "secret", 0, 1));
        assertThrows(IllegalArgumentException.class,
                () -> new MinioObjectStorageProperties("host:9000", "bucket", "key", "secret", 1, -1));
    }

    @Test
    void neverPrintsTheSecretKey() {
        final MinioObjectStorageProperties properties =
                new MinioObjectStorageProperties("host:9000", "bucket", "access-key", "top-secret-value", 5, 30);

        final String printed = properties.toString();

        assertFalse(printed.contains("top-secret-value"), printed);
        assertTrue(printed.contains("access-key"), printed);
        assertTrue(printed.contains("bucket"), printed);
        assertEquals("host:9000", properties.endpoint());
    }
}
