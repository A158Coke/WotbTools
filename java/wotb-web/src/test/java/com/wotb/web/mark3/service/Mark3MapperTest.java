package com.wotb.web.mark3.service;

import com.wotb.web.mark3.entity.Mark3Submission;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** 管理端截图只在 PENDING 期间可见，终态不暴露私有证据。 */
class Mark3MapperTest {

    private final Mark3Mapper mapper = new Mark3Mapper();

    @Test
    void adminDetailReturnsOneOrTwoScreenshotsOnlyWhilePending() {
        final Mark3Submission submission = new Mark3Submission();
        submission.setId(1L);
        submission.setProofScreenshotFirst("data:image/png;base64,AAAA");
        submission.setProofScreenshotSecond("data:image/jpeg;base64,BBBB");
        submission.setStatus("PENDING");

        assertThat(mapper.toAdminDetail(submission).proofScreenshots())
                .containsExactly("data:image/png;base64,AAAA", "data:image/jpeg;base64,BBBB");

        for (final String status : List.of("CURRENT", "REJECTED", "CANCELLED", "DELETED")) {
            submission.setStatus(status);
            assertThat(mapper.toAdminDetail(submission).proofScreenshots()).isEmpty();
        }
    }
}
