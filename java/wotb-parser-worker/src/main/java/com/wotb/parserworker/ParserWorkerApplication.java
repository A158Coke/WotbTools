package com.wotb.parserworker;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Yecao 无状态 parser worker 入口。
 *
 * <p>进程内只有一条执行路径：consume {@code wotb.parser} → 从 MinIO 读输入 → 复用 canonical
 * 解析（{@code DefaultReplayProcessingFacade}）→ artifact PUT 回 MinIO → 发
 * {@code parser.result} / {@code parser.failed} → ack。它不持有数据库凭据、不声明 RabbitMQ
 * topology（唯一 owner 是 {@code infra/tofu/rabbitmq}）、不暴露公网端口。</p>
 */
@SpringBootApplication
public class ParserWorkerApplication {

    public static void main(final String[] args) {
        SpringApplication.run(ParserWorkerApplication.class, args);
    }
}
