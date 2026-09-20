package com.wotb.web.replay.config;

import com.wotb.web.replay.job.ReplayJobAuthority;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.simple.JdbcClient;

import javax.sql.DataSource;

/**
 * Replay Processing Job 的 PostgreSQL 权威状态后端开关。
 *
 * <p>只在 {@code wotb.replay.processing-job.repository=jdbc} 时创建
 * {@link ReplayJobAuthority} bean；缺省（{@code memory}）不创建，注册表因此回落到纯内存模式，
 * 既有部署的运行时行为逐字不变。</p>
 *
 * <p>刻意放在 replay 域内而不是共享 {@code com.wotb.web.config}：共享 config 与各 domain 之间
 * 由 {@code WebArchitectureTest} 保证无环（{@code com.wotb.web.(*)..} free of cycles），
 * 而 replay 域已经依赖共享 config（{@code ApiPaths}），共享 config 反向依赖 replay 会成环。</p>
 *
 * <p>这是一次性开关，不是长期双轨设计：分布式回放链路完成后生产只使用 jdbc 模式，
 * memory 模式仅保留给测试与本地开发（见 {@code docs/current-plan.md} §6）。</p>
 */
@Configuration
@ConditionalOnProperty(name = "wotb.replay.processing-job.repository", havingValue = "jdbc")
public class ReplayJobAuthorityConfig {

    /**
     * 直接由 {@link DataSource} 构造 {@link JdbcClient}，不依赖 Spring Boot 的
     * {@code JdbcClientAutoConfiguration}：权威状态在启动关键路径上，显式装配比隐式
     * auto-config 更可预测，也让该 bean 的存在条件只取决于本配置类自身。
     */
    @Bean
    public ReplayJobAuthority replayJobAuthority(final DataSource dataSource) {
        return new ReplayJobAuthority(JdbcClient.create(dataSource));
    }
}
