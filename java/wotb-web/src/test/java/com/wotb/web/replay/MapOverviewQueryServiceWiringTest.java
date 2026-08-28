package com.wotb.web.replay;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.wotb.web.replay.job.ReplayProcessingJobStore;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;

/**
 * BLOCKER 2 — {@link MapOverviewQueryService} 强制依赖 {@link ReplayProcessingJobStore}
 * （单一构造器）：store 缺失必须启动失败（fail-fast），store 存在则正常注入并可用。
 */
@SpringJUnitConfig(MapOverviewQueryServiceWiringTest.Cfg.class)
class MapOverviewQueryServiceWiringTest {

    @Configuration
    @Import(MapOverviewQueryService.class)
    static class Cfg {
        @Bean
        ReplayProcessingJobStore processingStore() {
            try {
                // 每个测试类上下文（Spring 缓存）创建一次临时根目录。
                return new ReplayProcessingJobStore(Files.createTempDirectory("wotb-mapoverview-wiring"), 60);
            } catch (final IOException e) {
                throw new UncheckedIOException(e);
            }
        }
    }

    @Configuration
    @Import(MapOverviewQueryService.class)
    static class MissingStoreCfg {
    }

    @Autowired
    MapOverviewQueryService service;

    @Test
    void storePresentContextStartsAndServiceUsesStore() {
        assertNotNull(service);
        // 真实 store 已注入：查询不存在 job → JOB_NOT_FOUND（而非 DATASET_UNAVAILABLE / NPE）。
        final ResponseStatusException e = assertThrows(ResponseStatusException.class,
                () -> service.buildOverviewFromDataset("no-such-job", 0));
        assertEquals(HttpStatus.NOT_FOUND, e.getStatusCode());
        assertEquals("JOB_NOT_FOUND", e.getReason());
    }

    @Test
    void storeMissingFailsContextStartup() {
        final AnnotationConfigApplicationContext ctx = new AnnotationConfigApplicationContext();
        ctx.register(MissingStoreCfg.class);
        // 启动失败 = 强制依赖注入 fail-fast（BLOCKER 2）：store bean 缺失 → refresh() 必须抛。
        assertThrows(RuntimeException.class, ctx::refresh);
        ctx.close();
    }
}
