package com.wotb.web.replay.service;

import com.wotb.core.ref.Tankopedia;
import com.wotb.core.stats.RatingV2Calculator;
import com.wotb.web.replay.dto.RatingV2Response;
import com.wotb.web.replay.job.ProcessedDataset;
import com.wotb.web.replay.job.ReplayProcessingJobService;
import com.wotb.web.replay.mapper.RatingV2Mapper;
import org.springframework.stereotype.Service;

/** Admin-only adapter from one READY processing dataset to the isolated historical V2 score. */
@Service
public class RatingV2AdminService {

    private final ReplayProcessingJobService processingJobService;
    private final Tankopedia tankopedia = Tankopedia.load();

    public RatingV2AdminService(final ReplayProcessingJobService processingJobService) {
        this.processingJobService = processingJobService;
    }

    public RatingV2Response analyzeReadyJob(final String jobId) {
        final ProcessedDataset dataset = processingJobService.readyDataset(jobId);
        return new RatingV2Response(
                RatingV2Mapper.toRows(RatingV2Calculator.compute(dataset.battles(), tankopedia)),
                dataset.duplicates(), dataset.failures(), RatingV2Mapper.columns());
    }
}
