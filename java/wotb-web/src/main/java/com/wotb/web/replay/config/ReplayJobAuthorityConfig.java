package com.wotb.web.replay.config;

import com.wotb.web.replay.job.PostgresReplayJobAuthority;
import com.wotb.web.replay.job.ReplayJobAuthority;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;

import javax.sql.DataSource;

/**
 * Replay Processing Job 的 PostgreSQL 权威状态装配（**无条件**）。
 *
 * <p>PostgreSQL 是 job/source/operationId 的唯一权威：不存在运行时后端选择器
 * （{@code wotb.replay.processing-job.repository} 已删除），也不存在「无 authority 时回落到纯内存
 * 注册表」的第二套语义。</p>
 *
 * <p>刻意放在 replay 域内而不是共享 {@code com.wotb.web.config}：共享 config 与各 domain 之间
 * 由 {@code WebArchitectureTest} 保证无环（{@code com.wotb.web.(*)..} free of cycles），
 * 而 replay 域已经依赖共享 config（{@code ApiPaths}），共享 config 反向依赖 replay 会成环。</p>
 */
@Configuration
public class ReplayJobAuthorityConfig {

    /**
     * 直接由 {@link DataSource} 构造 {@link JdbcClient}，不依赖 Spring Boot 的
     * {@code JdbcClientAutoConfiguration}：权威状态在启动关键路径上，显式装配比隐式
     * auto-config 更可预测。
     */
    @Bean
    public ReplayJobAuthority replayJobAuthority(final DataSource dataSource) {
        // 权威状态写入必须原子（job 行 + source 投影一个事务），因此这里显式给出
        // DataSource 级事务管理器：job 投影是纯 JDBC 写入，不参与 JPA/Hibernate 事务。
        return new PostgresReplayJobAuthority(JdbcClient.create(dataSource),
                new DataSourceTransactionManager(dataSource));
    }
}
