package com.wotbtools.keycloak.juheqq;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.logging.Handler;
import java.util.logging.LogRecord;
import java.util.logging.Logger;

/** 测试辅助：捕获经由 java.util.logging 输出的结构化诊断日志消息。 */
final class LogCapture implements AutoCloseable {

    private final Logger root = Logger.getLogger("");
    private final List<LogRecord> records = new CopyOnWriteArrayList<>();
    private final Handler handler;

    LogCapture() {
        handler = new Handler() {
            @Override
            public void publish(final LogRecord record) {
                records.add(record);
            }

            @Override
            public void flush() {
            }

            @Override
            public void close() {
            }
        };
        root.addHandler(handler);
    }

    List<String> messages() {
        final List<String> out = new ArrayList<>();
        for (final LogRecord r : records) {
            out.add(r.getMessage());
        }
        return out;
    }

    @Override
    public void close() {
        root.removeHandler(handler);
    }
}
