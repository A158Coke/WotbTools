package com.wotb.web.hof.service;

import org.springframework.jdbc.datasource.DataSourceUtils;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.function.Supplier;

/**
 * 回放 hash 级 PostgreSQL advisory lock（session 级，横跨事务提交与文件清理）。
 *
 * <p>串行化两类临界区：</p>
 * <ul>
 *   <li>上传：{@code storage.store(hash)} + {@code recordRecorder(...)}（先落盘后入库）；</li>
 *   <li>admin delete：删除事务（audit + record delete）+ commit 后引用计数 + 物理文件清理。</li>
 * </ul>
 *
 * <p>不变量：任何 hall_of_fame_record 行引用 hash H → 物理 H.wotbreplay 必须存在。
 * 锁在 PostgreSQL（多实例安全），非 JVM synchronized；key 由 SHA-256 前 16 hex 稳定推导，
 * 不同 hash 前缀碰撞只会造成多余串行化，无害。</p>
 *
 * <p>实现要点：session 级 advisory lock 必须持有在<b>同一物理连接</b>上，
 * 因此从 DataSource 取一条专用连接并在该连接上 lock→action→unlock（绝不通过连接池
 * 的多次独立 JdbcTemplate 调用——unlock 可能落在另一条池化连接上导致锁永不释放）。</p>
 */
@Component
public class ReplayHashLock {

    private final DataSource dataSource;

    public ReplayHashLock(final DataSource dataSource) {
        this.dataSource = dataSource;
    }

    private static long key(final String sha256) {
        // 64 hex 的 SHA-256；前 16 hex 即 64 bit（>=2^63 时按无符号回绕为负 long，PostgreSQL bigint 接受）
        return Long.parseUnsignedLong(sha256.substring(0, 16), 16);
    }

    /** 临界区带返回值（如 upload 的 recordRecorder 结果）。 */
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

    /** 临界区无返回值（如 admin delete 的事务 + 文件清理）。 */
    public void runWithLock(final String sha256, final Runnable action) {
        runWithLockResult(sha256, () -> {
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
