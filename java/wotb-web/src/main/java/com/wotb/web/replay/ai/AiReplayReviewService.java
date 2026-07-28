package com.wotb.web.replay.ai;

import com.wotb.web.replay.exception.ReplayFileCountExceededException;
import org.springframework.stereotype.Service;

@Service
public class AiReplayReviewService {

    public void validateBatchSize(int fileCount) {
        if (fileCount > AiReplayBatchPolicy.MAX_FILES) {
            throw new ReplayFileCountExceededException(AiReplayBatchPolicy.MAX_FILES, fileCount);
        }
    }
}
