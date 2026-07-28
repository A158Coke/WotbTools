package com.wotb.web.replay.ai;

import com.wotb.core.model.Source;
import com.wotb.core.processing.BatchAnalyzer;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.processing.ReplayFileAnalysisStatus;
import com.wotb.core.processing.BattleCategory;
import com.wotb.core.processing.BattleCategoryUtils;
import com.wotb.core.processing.ReplayFileRelation;
import com.wotb.core.processing.ReplayProcessingStatus;
import com.wotb.core.processing.ReplayProcessingError;
import com.wotb.web.replay.exception.ReplayFileCountExceededException;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

@Service
public class AiReplayReviewService {

    private final DefaultReplayProcessingFacade processingFacade;
    private final AiReplayAnalysisService aiAnalysisService;
    private static final long MAX_FILE_SIZE = 20L * 1024 * 1024;
    private static final long MAX_TOTAL_SIZE = 200L * 1024 * 1024;

    public AiReplayReviewService(
            final DefaultReplayProcessingFacade processingFacade,
            final AiReplayAnalysisService aiAnalysisService) {
        this.processingFacade = processingFacade;
        this.aiAnalysisService = aiAnalysisService;
    }

    public void validateBatchSize(final int fileCount) {
        if (fileCount > AiReplayBatchPolicy.MAX_FILES) {
            throw new ReplayFileCountExceededException(AiReplayBatchPolicy.MAX_FILES, fileCount);
        }
    }

    /**
     * Process uploaded replay files for AI Review.
     * Validates batch size, file types, sizes, then processes and analyzes.
     */
    public ReviewContext process(final MultipartFile[] files) throws IOException {
        validateBatchSize(files.length);
        long totalSize = 0;
        for (final MultipartFile file : files) {
            final String name = file.getOriginalFilename();
            if (name == null || !name.toLowerCase().endsWith(".wotbreplay")) {
                throw new IllegalArgumentException("INVALID_FILE_EXTENSION");
            }
            if (file.isEmpty()) {
                throw new IllegalArgumentException("EMPTY_REPLAY_FILE");
            }
            if (file.getSize() > MAX_FILE_SIZE) {
                throw new IllegalArgumentException("FILE_TOO_LARGE");
            }
            totalSize += file.getSize();
            if (totalSize > MAX_TOTAL_SIZE) {
                throw new IllegalArgumentException("TOTAL_SIZE_EXCEEDED");
            }
        }
        // Process each file
        final List<ReplayProcessingResult> allResults = new ArrayList<>();
        for (int index = 0; index < files.length; index++) {
            final MultipartFile file = files[index];
            final String name = file.getOriginalFilename() != null
                    ? file.getOriginalFilename() : "replay.wotbreplay";
            final Source source = new Source(name, file.getBytes());
            allResults.add(processingFacade.process(
                    source, ReplayProcessingOptions.full()));
        }
        final BatchAnalyzer.AnalysisPlan plan = new BatchAnalyzer().analyze(allResults);
        return new ReviewContext(files.length, allResults, plan);
    }

    public record ReviewContext(
            int totalFiles,
            List<ReplayProcessingResult> allResults,
            BatchAnalyzer.AnalysisPlan plan
    ) {}
}
