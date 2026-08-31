package com.wotb.contracts;

import java.io.IOException;
import java.io.InputStream;

/** Provider-neutral artifact storage port; SDK clients belong in a future adapter module. */
public interface ObjectStorage {
    void put(ObjectKey key, InputStream content, long contentLength, String contentType) throws IOException;

    InputStream get(ObjectKey key) throws IOException;

    boolean exists(ObjectKey key) throws IOException;
}
