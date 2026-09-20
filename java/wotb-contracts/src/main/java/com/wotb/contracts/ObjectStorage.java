package com.wotb.contracts;

import java.io.IOException;
import java.io.InputStream;

/** Provider-neutral artifact storage port; SDK clients belong in a future adapter module. */
public interface ObjectStorage {
    void put(ObjectKey key, InputStream content, long contentLength, String contentType) throws IOException;

    InputStream get(ObjectKey key) throws IOException;

    boolean exists(ObjectKey key) throws IOException;

    /**
     * Deletes exactly one object; deleting an object that does not exist succeeds.
     *
     * <p><strong>Key-scoped on purpose.</strong> There is deliberately no prefix or listing
     * operation: a caller may only remove objects whose key it built itself through
     * {@code ObjectStorageKeys}, so a bug can never delete a neighbouring job's workspace or
     * another prefix of the bucket. Idempotence is part of the contract because the only use is
     * rolling back a partially written set, where some keys may never have been created.</p>
     */
    void delete(ObjectKey key) throws IOException;
}
