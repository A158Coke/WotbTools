package com.wotb.web.replay.ai;

import com.wotb.core.model.Source;
import com.wotb.core.processing.BatchAnalyzer;
import com.wotb.core.processing.BattleCategory;
import com.wotb.core.processing.BattleCategoryUtils;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.PerspectiveTeamNotResolvedException;
import com.wotb.core.processing.ReplayAnalysisMode;
import com.wotb.core.processing.ReplayAnalysisScope;
import com.wotb.core.processing.ReplayFileAnalysisStatus;
import com.wotb.core.processing.ReplayFileRelation;
import com.wotb.core.processing.ReplayPerspectiveGroup;
import com.wotb.core.processing.ReplayProcessingError;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.processing.ReplayProcessingStatus;
import com.wotb.core.processing.TeamPerspectiveResolver;
import com.wotb.core.processing.UnsupportedReplayAnalysisModeException;
import com.wotb.web.replay.dto.AnalyzeResponse;
import com.wotb.web.replay.exception.ReplayFileCountExceededException;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

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

    private void validateBatchSize(final int fileCount) {
        if (fileCount > AiReplayBatchPolicy.MAX_FILES) {
            throw new ReplayFileCountExceededException(AiReplayBatchPolicy.MAX_FILES, fileCount);
        }
    }

    public AnalyzeResponse analyze(final MultipartFile[] files) throws IOException {
        if (files == null || files.length == 0) throw new IllegalArgumentException("NO_REPLAY_FILES");
        validateBatchSize(files.length);
        long totalSize = 0;
        for (int i = 0; i < files.length; i++) {
            final MultipartFile file = files[i];
            if (file == null) throw new IllegalArgumentException("NO_REPLAY_FILE");
            final String name = file.getOriginalFilename();
            if (!StringUtils.hasText(name) || !name.toLowerCase(Locale.ROOT).endsWith(".wotbreplay")) {
                throw new IllegalArgumentException("INVALID_REPLAY_FILE_TYPE");
            }
            if (file.isEmpty()) throw new IllegalArgumentException("NO_REPLAY_FILE");
            final long fileSize = file.getSize();
            if (fileSize > MAX_FILE_SIZE) throw new IllegalArgumentException("FILE_TOO_LARGE");
            if (fileSize > MAX_TOTAL_SIZE - totalSize) throw new IllegalArgumentException("TOTAL_REQUEST_TOO_LARGE");
            totalSize += fileSize;
        }
        final List<ReplayProcessingResult> allResults = new ArrayList<>();
        for (int index = 0; index < files.length; index++) {
            final MultipartFile file = files[index];
            final String name = file.getOriginalFilename() != null
                    ? file.getOriginalFilename() : "replay.wotbreplay";
            final Source source = new Source(name, file.getBytes());
            allResults.add(processingFacade.process(source, ReplayProcessingOptions.full()));
        }
        final BatchAnalyzer.AnalysisPlan plan = new BatchAnalyzer().analyze(allResults);
        final List<ReplayUploadResult> uploadResults = new ArrayList<>();
        for (int i = 0; i < allResults.size(); i++) {
            uploadResults.add(new ReplayUploadResult(i, allResults.get(i).fileName(), allResults.get(i)));
        }
        final boolean hasParsedBattle = allResults.stream().anyMatch(r -> r.battle() != null);
        if (!hasParsedBattle) throw new IllegalArgumentException("NO_BATTLE_DATA");
        if (plan.dominantScope() == null) throw new UnsupportedReplayAnalysisModeException("UNSUPPORTED_BATTLE_CATEGORY");
        final var analyzableGroups = plan.groups().stream()
                .filter(g -> g.representative().capabilities() != null
                        && BatchAnalyzer.isAiAnalyzable(g.representative(), plan.dominantScope()))
                .toList();
        if (analyzableGroups.isEmpty()) {
            if (plan.dominantScope() == ReplayAnalysisScope.TEAM_PERSPECTIVE) {
                final boolean teamResolved = plan.groups().stream()
                        .map(ReplayPerspectiveGroup::representative)
                        .map(ReplayProcessingResult::capabilities)
                        .anyMatch(capabilities -> capabilities != null
                                && capabilities.perspectiveTeamResolved());
                if (teamResolved) {
                    throw new IllegalArgumentException("TEAM_FEATURES_UNAVAILABLE");
                }
                throw new PerspectiveTeamNotResolvedException(unresolvedTeamCode(plan.groups()));
            }
            throw new IllegalArgumentException("NO_BATTLE_DATA");
        }
        final var fileStatuses = buildFileStatuses(uploadResults, plan);
        final int failedCount = countFailed(fileStatuses);
        final int analyzedUnitCount = analyzableGroups.size();
        final int validCount = (int) allResults.stream()
                .filter(r -> r.capabilities() != null
                        && BatchAnalyzer.isAiAnalyzable(r, plan.dominantScope()))
                .count();
        return switch (plan.mode()) {
            case SINGLE_PLAYER_BATTLE -> {
                final var aiResult = aiAnalysisService.analyzePlayerOrFallback(
                        analyzableGroups.getFirst().representative());
                final var units = AiReplayAnalysisService.buildAnalysisUnits(
                        analyzableGroups, plan.dominantScope());
                final int analyzedCount = 1;
                final int unavailable = plan.effectiveUnitCount() - analyzedCount;
                yield new AnalyzeResponse(ReplayAnalysisMode.SINGLE_PLAYER_BATTLE,
                        files.length, validCount,
                        plan.effectiveUnitCount(), analyzedCount, 0, unavailable, analyzedCount,
                        aiResult.analysis(), failedCount,
                        plan.exactDuplicateCount(), plan.sameTeamDuplicatePerspectiveCount(),
                        fileStatuses, units, aiResult.keyEvents(),
                        List.<String>of());
            }
            case MULTI_PLAYER_BATTLE -> {
                final var battles = analyzableGroups.stream()
                        .map(ReplayPerspectiveGroup::representative)
                        .map(ReplayProcessingResult::battle)
                        .toList();
                final var aiResult = aiAnalysisService.analyzeMulti(battles);
                final var units = AiReplayAnalysisService.buildAnalysisUnits(
                        analyzableGroups, plan.dominantScope());
                yield new AnalyzeResponse(ReplayAnalysisMode.MULTI_PLAYER_BATTLE,
                        files.length, validCount,
                        plan.effectiveUnitCount(), analyzedUnitCount, 0, plan.effectiveUnitCount() - analyzedUnitCount, analyzedUnitCount,
                        aiResult.analysis(), failedCount,
                        plan.exactDuplicateCount(), plan.sameTeamDuplicatePerspectiveCount(),
                        fileStatuses, units, aiResult.keyEvents(),
                        List.<String>of());
            }
            case SINGLE_TEAM_BATTLE, MULTI_TEAM_BATTLE -> {
                final var teamResult = aiAnalysisService.analyzeTeamGroups(analyzableGroups);
                final var aiResult = teamResult.analysis();
                final int planUnitCount = plan.effectiveUnitCount();
                final int analyzed = teamResult.analyzedUnitCount();
                final int omitted = teamResult.omittedAnalysisUnitCount();
                final int unavailable = planUnitCount - analyzed - omitted;
                yield new AnalyzeResponse(plan.mode(),
                        files.length, validCount,
                        planUnitCount, analyzed, omitted, unavailable, analyzed,
                        aiResult.analysis(), failedCount,
                        plan.exactDuplicateCount(), plan.sameTeamDuplicatePerspectiveCount(),
                        fileStatuses, teamResult.units(), aiResult.keyEvents(),
                        teamResult.limitations());
            }
            case NONE -> throw new IllegalArgumentException("NO_BATTLE_DATA");
        };
    }

    private static int countFailed(final List<ReplayFileAnalysisStatus> statuses) {
        return (int) statuses.stream()
                .filter(f -> f.status() == ReplayProcessingStatus.FAILED
                        && f.relation() == ReplayFileRelation.INDEPENDENT_BATTLE
                        && f.error() != null)
                .count();
    }

    private static String unresolvedTeamCode(final List<ReplayPerspectiveGroup> groups) {
        final boolean conflict = groups.stream()
                .map(ReplayPerspectiveGroup::representative)
                .map(result -> TeamPerspectiveResolver.resolve(
                        result.battle(), result.reconstruction()))
                .anyMatch(resolution -> resolution.limitations().stream()
                        .anyMatch(code -> "PERSPECTIVE_TEAM_CONFLICT".equals(code)
                                || "RECORDER_IDENTITY_CONFLICT".equals(code)));
        return conflict ? "PERSPECTIVE_TEAM_CONFLICT" : "PERSPECTIVE_TEAM_UNRESOLVED";
    }

    private static List<ReplayFileAnalysisStatus> buildFileStatuses(
            final List<ReplayUploadResult> uploadResults,
            final BatchAnalyzer.AnalysisPlan plan) {
        final java.util.IdentityHashMap<ReplayProcessingResult, Integer> resultToIndex = new java.util.IdentityHashMap<>();
        for (final var ur : uploadResults) {
            resultToIndex.put(ur.processingResult(), ur.uploadIndex());
        }
        final java.util.IdentityHashMap<ReplayProcessingResult, Boolean> indexed = new java.util.IdentityHashMap<>();
        final List<ReplayFileAnalysisStatus> statuses = new ArrayList<>();
        for (final var gp : plan.groups()) {
            final var rep = gp.representative();
            final int repIdx = resultToIndex.getOrDefault(rep, -1);
            final BattleCategory category = rep.battle() != null
                    ? BattleCategoryUtils.fromArenaBonusType(rep.battle().arenaBonusType)
                    : BattleCategory.UNKNOWN;
            statuses.add(ReplayFileAnalysisStatus.primary(
                    rep.fileName(), rep.status(), category, plan.dominantScope(),
                    rep.battle() != null ? rep.battle().arenaId : null,
                    gp.key().perspectiveTeam(),
                    BatchAnalyzer.isAiAnalyzable(rep, plan.dominantScope()),
                    repIdx, rep.capabilities()));
            indexed.put(rep, Boolean.TRUE);
            for (final var dup : gp.duplicates()) {
                final int dupIdx = resultToIndex.getOrDefault(dup, -1);
                statuses.add(ReplayFileAnalysisStatus.duplicate(
                        dup.fileName(), dup.status(),
                        ReplayFileRelation.SAME_TEAM_DUPLICATE_PERSPECTIVE,
                        rep.fileName(), dupIdx, repIdx));
                indexed.put(dup, Boolean.TRUE);
            }
        }
        for (final var dup : plan.exactDuplicates()) {
            final int dupIdx = resultToIndex.getOrDefault(dup.duplicate(), -1);
            final int origIdx = resultToIndex.getOrDefault(dup.original(), -1);
            statuses.add(ReplayFileAnalysisStatus.duplicate(
                    dup.duplicate().fileName(), dup.duplicate().status(),
                    ReplayFileRelation.EXACT_DUPLICATE,
                    dup.original().fileName(), dupIdx, origIdx));
            indexed.put(dup.duplicate(), Boolean.TRUE);
        }
        for (final var ur : uploadResults) {
            final var r = ur.processingResult();
            if (r.status() == ReplayProcessingStatus.FAILED && !indexed.containsKey(r)) {
                statuses.add(ReplayFileAnalysisStatus.failed(
                        r.fileName(), r.error() != null ? r.error()
                                : ReplayProcessingError.of("FAILED", "Processing failed"), ur.uploadIndex()));
            }
        }
        final int uploadCount = uploadResults.size();
        if (statuses.size() != uploadCount) {
            throw new IllegalStateException(
                    "FILE_STATUS_COUNT_MISMATCH: " + statuses.size() + " != " + uploadCount);
        }
        final var uploadIndices = statuses.stream()
                .map(ReplayFileAnalysisStatus::uploadIndex)
                .collect(java.util.stream.Collectors.toSet());
        if (uploadIndices.size() != uploadCount) {
            throw new IllegalStateException("DUPLICATE_UPLOAD_INDEX");
        }
        for (int i = 0; i < uploadCount; i++) {
            if (!uploadIndices.contains(i)) {
                throw new IllegalStateException("MISSING_UPLOAD_INDEX_" + i);
            }
        }
        for (final var s : statuses) {
            if (s.uploadIndex() < 0 || s.uploadIndex() >= uploadCount) {
                throw new IllegalStateException("INVALID_UPLOAD_INDEX_" + s.uploadIndex());
            }
            final boolean isDup = s.relation() == ReplayFileRelation.EXACT_DUPLICATE
                    || s.relation() == ReplayFileRelation.SAME_TEAM_DUPLICATE_PERSPECTIVE;
            if (isDup) {
                final Integer origIdx = s.duplicateOfUploadIndex();
                if (origIdx == null || origIdx < 0 || origIdx >= uploadCount) {
                    throw new IllegalStateException("INVALID_DUPLICATE_OF_UPLOAD_INDEX");
                }
                if (origIdx == s.uploadIndex()) {
                    throw new IllegalStateException("DUPLICATE_POINTS_TO_SELF");
                }
            } else if (s.duplicateOfUploadIndex() != null) {
                throw new IllegalStateException("UNEXPECTED_DUPLICATE_OF_UPLOAD_INDEX");
            }
        }
        statuses.sort(java.util.Comparator.comparingInt(ReplayFileAnalysisStatus::uploadIndex));
        return statuses;
    }

    private record ReplayUploadResult(int uploadIndex, String fileName, ReplayProcessingResult processingResult) {}

}
