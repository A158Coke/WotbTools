package com.wotb.web.replayfile;

import org.springframework.jdbc.datasource.DataSourceUtils;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.List;
import java.util.function.Supplier;

@Component
public class ReplayHashLock {

    private final DataSource dataSource;

    public ReplayHashLock(final DataSource dataSource) {
        this.dataSource = dataSource;
    }

    private static long key(final String sha256) {
        return Long.parseUnsignedLong(sha256.substring(0, 16), 16);
    }

    public <T> T runWithLockResult(final String sha256, final Supplier<T> action) {
        final long key = key(sha256);
        final Connection conn = DataSourceUtils.getConnection(dataSource);
        try {
            advisory(conn, "select pg_advisory_lock(?)", key);
            try {
                return action.get();
            } finally {
                advisory(conn, "select pg_advisory_unlock(?)", key);
            }
        } finally {
            DataSourceUtils.releaseConnection(conn, dataSource);
        }
    }

    public void runWithLock(final String sha256, final Runnable action) {
        runWithLockResult(sha256, () -> {
            action.run();
            return null;
        });
    }

    public <T> T runWithLocksResult(final List<String> sha256s, final Supplier<T> action) {
        final List<Long> keys = sha256s.stream().distinct().sorted()
                .map(ReplayHashLock::key)
                .toList();
        final Connection conn = DataSourceUtils.getConnection(dataSource);
        try {
            for (final long key : keys) {
                advisory(conn, "select pg_advisory_lock(?)", key);
            }
            try {
                return action.get();
            } finally {
                for (int i = keys.size() - 1; i >= 0; i--) {
                    advisory(conn, "select pg_advisory_unlock(?)", keys.get(i));
                }
            }
        } finally {
            DataSourceUtils.releaseConnection(conn, dataSource);
        }
    }

    public void runWithLocks(final List<String> sha256s, final Runnable action) {
        runWithLocksResult(sha256s, () -> {
            action.run();
            return null;
        });
    }

    private static void advisory(final Connection conn, final String sql, final long key) {
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, key);
            try (var rs = ps.executeQuery()) {
                rs.next();
            }
        } catch (final SQLException e) {
            throw new IllegalStateException("advisory lock operation failed", e);
        }
    }
}
