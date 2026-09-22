package com.wotb.web.replay.controller;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.web.replay.dto.PreviewResponse;
import com.wotb.web.replay.job.ProcessedDataset;
import com.wotb.web.replay.job.ReplayProcessingJobService;
import com.wotb.web.user.service.UserProfileService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertSame;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@code GET /api/replay/processing-jobs/{jobId}/result} 边界上的绑定账号回放验证回归。
 *
 * <p>契约（wire shape 未变，因此断言的是边界行为而非 JSON 形状）：</p>
 * <ul>
 *   <li>result 用<b>已认证 subject</b> + <b>同一份 READY dataset 的 Battle</b> 调一次验证；</li>
 *   <li>dataset 只读一次（验证与 Preview 投影共用），不重复访问对象存储；</li>
 *   <li>验证抛异常时仍原样返回 Preview——回放结果绝不因验证失败而失败；</li>
 *   <li>没有已认证身份时以 null subject 调用，验证侧 fail-closed。</li>
 * </ul>
 */
class ReplayProcessingJobControllerTest {

    private ReplayProcessingJobService service;
    private UserProfileService userProfileService;
    private ReplayProcessingJobController controller;

    @BeforeEach
    void setUp() {
        service = mock(ReplayProcessingJobService.class);
        userProfileService = mock(UserProfileService.class);
        controller = new ReplayProcessingJobController(service, userProfileService);
    }

    @Test
    void resultVerifiesTheBoundAccountWithTheAuthenticatedSubjectAndReturnsThePreview() {
        final List<Battle> battles = List.of(battle("Recorder", 123L));
        final ProcessedDataset dataset = dataset(battles);
        final PreviewResponse preview = preview();
        when(service.readyDataset("job-1")).thenReturn(dataset);
        when(service.preview(dataset)).thenReturn(preview);

        assertSame(preview, controller.result("job-1", jwt("kc-user")));

        verify(userProfileService).verifyBoundAccountFromReplay("kc-user", battles);
        // dataset 恰好读一次：验证与投影消费同一份，没有第二次对象存储读取。
        verify(service).readyDataset("job-1");
        verify(service).preview(dataset);
    }

    @Test
    void replayStillReturnsItsResultWhenVerificationFails() {
        final ProcessedDataset dataset = dataset(List.of(battle("Recorder", 123L)));
        final PreviewResponse preview = preview();
        when(service.readyDataset("job-1")).thenReturn(dataset);
        when(service.preview(dataset)).thenReturn(preview);
        doThrow(new IllegalStateException("profile store unavailable"))
                .when(userProfileService).verifyBoundAccountFromReplay(eq("kc-user"), any());

        assertSame(preview, controller.result("job-1", jwt("kc-user")));
    }

    @Test
    void callerWithoutAnAuthenticatedSubjectCannotVerifyAnything() {
        final ProcessedDataset dataset = dataset(List.of(battle("Recorder", 123L)));
        when(service.readyDataset("job-1")).thenReturn(dataset);
        when(service.preview(dataset)).thenReturn(preview());

        controller.result("job-1", null);

        verify(userProfileService).verifyBoundAccountFromReplay(null, dataset.battles());
    }

    private static Jwt jwt(final String subject) {
        return Jwt.withTokenValue("token").header("alg", "none").subject(subject).build();
    }

    /** 与生产一致的最小 Battle：meta 录像者昵称可被名册解析出行。 */
    private static Battle battle(final String recorderNickname, final long recorderAccountId) {
        final Battle battle = new Battle();
        battle.recorder = recorderNickname;
        final PlayerResult recorder = new PlayerResult();
        recorder.accountId = recorderAccountId;
        recorder.nickname = recorderNickname;
        battle.players = List.of(recorder);
        return battle;
    }

    private static ProcessedDataset dataset(final List<Battle> battles) {
        return new ProcessedDataset(battles, List.of("battle.wotbreplay"), List.of("src-0"),
                List.of(), List.of(), null, null);
    }

    private static PreviewResponse preview() {
        return new PreviewResponse(List.of(), List.of(), List.of(), List.of(),
                List.of(), List.of(), null, null, false);
    }
}
