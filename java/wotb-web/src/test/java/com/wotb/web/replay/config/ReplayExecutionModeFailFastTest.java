package com.wotb.web.replay.config;

import com.wotb.web.replay.job.ReplayExecutionMode;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * {@code wotb.replay.execution.mode} 的 fail-fast 契约：未知值（含显式空值）必须让启动失败。
 *
 * <p>静默降级为 local 是最危险的失败模式——部署方以为解析已经不在本机执行，本机却继续占用
 * CPU 解析；因此这里锁死「未知值 = 启动失败」，并同时锁死缺省/合法值不会误伤。</p>
 */
class ReplayExecutionModeFailFastTest {

    private final ApplicationContextRunner runner =
            new ApplicationContextRunner().withUserConfiguration(ReplayProcessingConfig.class);

    @Test
    void unknownModeFailsStartup() {
        runner.withPropertyValues(ReplayExecutionMode.PROPERTY + "=distributed-ish").run(context -> {
            assertThat(context).hasFailed();
            assertThat(failureText(context.getStartupFailure()))
                    .contains(ReplayExecutionMode.PROPERTY)
                    .contains("distributed-ish");
        });
    }

    @Test
    void explicitlyBlankModeFailsStartup() {
        runner.withPropertyValues(ReplayExecutionMode.PROPERTY + "=").run(context -> {
            assertThat(context).hasFailed();
            assertThat(failureText(context.getStartupFailure())).contains(ReplayExecutionMode.PROPERTY);
        });
    }

    @Test
    void missingAndLocalAndDistributedModesAreAccepted() {
        runner.run(context -> assertThat(context).hasNotFailed());
        runner.withPropertyValues(ReplayExecutionMode.PROPERTY + "=" + ReplayExecutionMode.LOCAL_VALUE)
                .run(context -> assertThat(context).hasNotFailed());
        runner.withPropertyValues(ReplayExecutionMode.PROPERTY + "=" + ReplayExecutionMode.DISTRIBUTED_VALUE)
                .run(context -> assertThat(context).hasNotFailed());
    }

    @Test
    void parserRejectsEveryUnknownValue() {
        assertThat(ReplayExecutionMode.parse("local")).isEqualTo(ReplayExecutionMode.LOCAL);
        assertThat(ReplayExecutionMode.parse("distributed")).isEqualTo(ReplayExecutionMode.DISTRIBUTED);
        assertThat(ReplayExecutionMode.parse(" distributed ")).isEqualTo(ReplayExecutionMode.DISTRIBUTED);

        assertThatThrownBy(() -> ReplayExecutionMode.parse("LOCAL")).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> ReplayExecutionMode.parse("")).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> ReplayExecutionMode.parse(null)).isInstanceOf(IllegalStateException.class);
    }

    /** 整条 cause 链文本（Spring 会把配置类构造器的异常包若干层）。 */
    private static String failureText(final Throwable failure) {
        final StringBuilder text = new StringBuilder();
        for (Throwable current = failure; current != null; current = current.getCause()) {
            text.append(current).append(' ');
        }
        return text.toString();
    }
}
