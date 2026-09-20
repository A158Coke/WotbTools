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
    void neverPrintsEitherCredential() {
        final MinioObjectStorageProperties properties =
                new MinioObjectStorageProperties("host:9000", "bucket", "access-key", "top-secret-value", 5, 30);

        final String printed = properties.toString();

        // 两个凭据都是敏感运行时值（tofu 侧 worker_access_key / control_api_access_key 均为 sensitive，
        // 生产值来自 GitHub Secrets），因此渲染字符串里一个都不许出现。
        assertFalse(printed.contains("top-secret-value"), printed);
        assertFalse(printed.contains("access-key"), printed);
        assertTrue(printed.contains("accessKey=***"), printed);
        assertTrue(printed.contains("secretKey=***"), printed);

        // 非敏感设置保持可见，便于排障定位。
        assertTrue(printed.contains("endpoint=host:9000"), printed);
        assertTrue(printed.contains("bucket=bucket"), printed);
        assertTrue(printed.contains("connectTimeoutSeconds=5"), printed);
        assertTrue(printed.contains("writeTimeoutSeconds=30"), printed);

        // 脱敏只发生在 toString：数据模型本身仍然返回真实值。
        assertEquals("access-key", properties.accessKey());
        assertEquals("top-secret-value", properties.secretKey());
        assertEquals("host:9000", properties.endpoint());
    }
}
