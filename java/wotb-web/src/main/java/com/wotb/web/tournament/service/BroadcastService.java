package com.wotb.web.tournament.service;

import com.wotb.web.tournament.dto.BroadcastDtos;
import com.wotb.web.tournament.entity.BroadcastCategory;
import com.wotb.web.tournament.entity.BroadcastNode;
import com.wotb.web.tournament.entity.BroadcastReplay;
import com.wotb.web.tournament.entity.BroadcastSeason;
import com.wotb.web.tournament.mapper.BroadcastMapper;
import com.wotb.web.tournament.repository.BroadcastCategoryRepository;
import com.wotb.web.tournament.repository.BroadcastNodeRepository;
import com.wotb.web.tournament.repository.BroadcastReplayRepository;
import com.wotb.web.tournament.repository.BroadcastSeasonRepository;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;
import java.net.URI;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;

/** The season lock serializes tree edits; COS upload runs before that transaction. */
@Service
public class BroadcastService {
    private static final List<String> SERVERS = List.of("CN", "ASIA", "NA", "EU", "LESTA");
    private static final String POINTS = "POINTS";
    private static final String QUARTER_FINALS = "QUARTER_FINALS";
    private static final String SEMI_FINALS = "SEMI_FINALS";
    private final BroadcastSeasonRepository seasons;
    private final BroadcastCategoryRepository categories;
    private final BroadcastNodeRepository nodes;
    private final BroadcastReplayRepository replays;
    private final BroadcastMapper mapper;
    private final BroadcastCoverService covers;
    private final TransactionTemplate transactions;

    public BroadcastService(final BroadcastSeasonRepository seasons, final BroadcastCategoryRepository categories,
                            final BroadcastNodeRepository nodes, final BroadcastReplayRepository replays,
                            final BroadcastMapper mapper, final BroadcastCoverService covers,
                            final PlatformTransactionManager transactionManager) {
        this.seasons = seasons; this.categories = categories; this.nodes = nodes; this.replays = replays;
        this.mapper = mapper; this.covers = covers; this.transactions = new TransactionTemplate(transactionManager);
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public BroadcastDtos.Index index(final String server) {
        if (server != null) { validateServer(server); }
        return new BroadcastDtos.Index(SERVERS, server == null ? List.of() : seasons.list(server).stream()
                .map(this::seasonDto).toList(), covers.configured());
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public BroadcastDtos.SeasonView season(final long id) { return seasonView(findSeason(id)); }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public BroadcastDtos.CategoryView category(final long id) {
        final BroadcastCategory category = findCategory(id);
        return categoryView(findSeason(category.seasonId), category);
    }

    public BroadcastDtos.SeasonView createSeason(final BroadcastDtos.SeasonCreate request) {
        validateServer(request.server()); validateSeason(request.year(), request.name(), request.startDate());
        return transactions.execute(status -> {
            final BroadcastSeason season = new BroadcastSeason();
            season.server = request.server(); season.year = request.year(); season.name = request.name().strip();
            season.startDate = request.startDate(); season.createdAt = Instant.now(); seasons.save(season);
            return seasonView(season);
        });
    }
    public BroadcastDtos.SeasonView updateSeason(final long id, final BroadcastDtos.SeasonUpdate request) {
        validateSeason(request.year(), request.name(), request.startDate());
        return transactions.execute(status -> {
            final BroadcastSeason season = locked(id, request.expectedVersion());
            season.year = request.year(); season.name = request.name().strip(); season.startDate = request.startDate();
            season.version++; return seasonView(season);
        });
    }
    public BroadcastDtos.SeasonView createCategory(final long seasonId, final BroadcastDtos.CategoryCreate request) {
        if (!contains(Set.of(POINTS, QUARTER_FINALS, SEMI_FINALS), request.type())) { throw invalid(); }
        return transactions.execute(status -> {
            final BroadcastSeason season = locked(seasonId, request.expectedVersion());
            if (categories.findBySeasonIdAndType(seasonId, request.type()).isEmpty()) {
                final BroadcastCategory category = new BroadcastCategory(); category.seasonId = seasonId;
                category.type = request.type(); categories.save(category);
            }
            season.version++; return seasonView(season);
        });
    }
    public BroadcastDtos.CategoryView createNode(final long categoryId, final BroadcastDtos.NodeCreate request) {
        return transactions.execute(status -> {
            final BroadcastCategory category = findCategory(categoryId);
            final BroadcastSeason season = locked(category.seasonId, request.expectedVersion());
            // Re-read after taking the ancestor lock: its tree may have been deleted while waiting.
            findCategory(categoryId);
            final int key;
            if (POINTS.equals(category.type)) {
                if (request.roundNumber() == null || request.roundNumber() < 1 || request.roundNumber() > 5 || request.format() != null) { throw invalid(); }
                key = request.roundNumber();
            } else {
                if (request.roundNumber() != null || (QUARTER_FINALS.equals(category.type)
                        ? !contains(Set.of("ROUND_ROBIN", "KNOCKOUT"), request.format()) : request.format() != null)) { throw invalid(); }
                key = 0;
            }
            if (nodes.existsByCategoryIdAndRootKey(categoryId, key)) { throw new ApiException(ApiErrorCode.BROADCAST_NODE_CONFLICT); }
            final BroadcastNode node = new BroadcastNode(); node.categoryId = categoryId; node.rootKey = key;
            node.roundNumber = request.roundNumber(); node.format = request.format(); nodes.save(node);
            season.version++; return categoryView(season, category);
        });
    }

    public BroadcastDtos.CategoryView createReplay(final long nodeId, final BroadcastDtos.ReplaySave request,
                                                  final MultipartFile cover) {
        return saveReplay(nodeId, null, request, cover);
    }
    public BroadcastDtos.CategoryView updateReplay(final long replayId, final BroadcastDtos.ReplaySave request,
                                                  final MultipartFile cover) {
        final long nodeId = transactions.execute(status -> findReplay(replayId).nodeId);
        return saveReplay(nodeId, replayId, request, cover);
    }
    private BroadcastDtos.CategoryView saveReplay(final long nodeId, final Long replayId,
                                                  final BroadcastDtos.ReplaySave request, final MultipartFile file) {
        final long seasonId = transactions.execute(status -> {
            final BroadcastNode node = findNode(nodeId); final BroadcastCategory category = findCategory(node.categoryId);
            final BroadcastSeason season = findSeason(category.seasonId); version(season, request.expectedVersion());
            validateReplay(request, category.type, node.format, file);
            return season.id;
        });
        // A committed reservation makes failures between PUT and the business commit recoverable.
        final String uploaded = "REPLACE".equals(request.coverAction()) ? covers.upload(seasonId, file) : null;
        return transactions.execute(status -> {
            final BroadcastSeason season = locked(seasonId, request.expectedVersion());
            final BroadcastNode node = findNode(nodeId); final BroadcastCategory category = findCategory(node.categoryId);
            if (category.seasonId != seasonId) { throw notFound(); }
            final BroadcastReplay replay = replayId == null ? new BroadcastReplay() : findReplay(replayId);
            if (replayId != null && replay.nodeId != nodeId) { throw notFound(); }
            final String previousCover = replay.coverId;
            if (uploaded != null) { covers.attach(seasonId, uploaded); }
            replay.nodeId = nodeId; replay.title = request.title().strip(); replay.url = request.url().strip();
            replay.matchDate = request.matchDate(); replay.dayNumber = request.dayNumber(); replay.groupLabel = request.groupLabel() == null ? null : request.groupLabel().strip();
            replay.groupNumber = request.groupNumber(); replay.bracket = request.bracket();
            replay.teams = request.teams().stream().map(String::strip).toList(); replay.perspective = request.perspective();
            if (uploaded != null) { replay.coverId = uploaded; }
            else if ("REMOVE".equals(request.coverAction())) { replay.coverId = null; }
            if (replayId == null) { replay.createdAt = Instant.now(); }
            replays.saveAndFlush(replay);
            if (previousCover != null && !previousCover.equals(replay.coverId)) { covers.detach(previousCover); }
            season.version++; return categoryView(season, category);
        });
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public BroadcastDtos.DeletionPreview seasonDeletionPreview(final long id) {
        final BroadcastSeason season = findSeason(id); final BroadcastDtos.Season data = seasonDto(season);
        return new BroadcastDtos.DeletionPreview(id, season.version, data.rootCount(), data.replayCount());
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public BroadcastDtos.DeletionPreview nodeDeletionPreview(final long id) {
        final BroadcastNode node = findNode(id); final BroadcastCategory category = findCategory(node.categoryId);
        final BroadcastSeason season = findSeason(category.seasonId);
        return new BroadcastDtos.DeletionPreview(season.id, season.version, 1, replays.countByNodeId(id));
    }
    public void deleteSeason(final long id, final long expectedVersion, final boolean confirm) {
        requireConfirmation(confirm);
        transactions.executeWithoutResult(status -> {
            locked(id, expectedVersion);
            for (final BroadcastNode node : nodes.findBySeasonId(id)) { deleteNodeContents(node.id); nodes.delete(node); }
            nodes.flush(); categories.deleteBySeasonId(id); categories.flush(); seasons.deleteById(id);
        });
    }
    public void deleteNode(final long id, final long expectedVersion, final boolean confirm) {
        requireConfirmation(confirm);
        transactions.executeWithoutResult(status -> {
            final BroadcastNode node = findNode(id); final BroadcastCategory category = findCategory(node.categoryId);
            final BroadcastSeason season = locked(category.seasonId, expectedVersion); findNode(id);
            deleteNodeContents(id); nodes.delete(node); season.version++;
        });
    }
    public void deleteReplay(final long id, final long expectedVersion, final boolean confirm) {
        requireConfirmation(confirm);
        transactions.executeWithoutResult(status -> {
            final BroadcastReplay listed = findReplay(id); final BroadcastNode node = findNode(listed.nodeId);
            final BroadcastCategory category = findCategory(node.categoryId);
            final BroadcastSeason season = locked(category.seasonId, expectedVersion);
            final BroadcastReplay replay = findReplay(id); replays.delete(replay); replays.flush();
            if (replay.coverId != null) { covers.detach(replay.coverId); }
            season.version++;
        });
    }
    private void deleteNodeContents(final long id) {
        final List<String> removed = replays.findByNodeIdOrderByMatchDateAscIdAsc(id).stream()
                .map(replay -> replay.coverId).filter(java.util.Objects::nonNull).distinct().sorted().toList();
        replays.deleteByNodeId(id); replays.flush(); removed.forEach(covers::detach);
    }
    private BroadcastDtos.Season seasonDto(final BroadcastSeason season) {
        final List<BroadcastNode> stored = nodes.findBySeasonId(season.id);
        return mapper.season(season, stored.size(), stored.stream().mapToLong(node -> replays.countByNodeId(node.id)).sum());
    }
    private BroadcastDtos.SeasonView seasonView(final BroadcastSeason season) {
        return new BroadcastDtos.SeasonView(seasonDto(season), categories.findBySeasonIdOrderByIdAsc(season.id)
                .stream().map(mapper::category).toList(), covers.configured());
    }
    private BroadcastDtos.CategoryView categoryView(final BroadcastSeason season, final BroadcastCategory category) {
        return new BroadcastDtos.CategoryView(seasonDto(season), mapper.category(category),
                nodes.findByCategoryIdOrderByRootKeyAscIdAsc(category.id).stream()
                        .map(node -> mapper.node(node, replays.findByNodeIdOrderByMatchDateAscIdAsc(node.id))).toList(), covers.configured());
    }
    private BroadcastSeason findSeason(final long id) { return seasons.findById(id).orElseThrow(BroadcastService::notFound); }
    private BroadcastCategory findCategory(final long id) { return categories.findById(id).orElseThrow(BroadcastService::notFound); }
    private BroadcastNode findNode(final long id) { return nodes.findById(id).orElseThrow(BroadcastService::notFound); }
    private BroadcastReplay findReplay(final long id) { return replays.findById(id).orElseThrow(BroadcastService::notFound); }
    private BroadcastSeason locked(final long id, final long expected) {
        final BroadcastSeason season = seasons.findLocked(id).orElseThrow(BroadcastService::notFound); version(season, expected); return season;
    }
    private static void version(final BroadcastSeason season, final long expected) {
        if (expected < 0 || expected != season.version) { throw new ApiException(ApiErrorCode.BROADCAST_VERSION_CONFLICT); }
    }
    private static void validateServer(final String server) { if (server == null || !SERVERS.contains(server)) { throw invalid(); } }
    private static void validateSeason(final int year, final String name, final LocalDate startDate) {
        if (year < 1 || year > 9999) { throw invalid(); }
        text(name, 100); if (startDate != null) { date(startDate); }
    }
    private static void validateReplay(final BroadcastDtos.ReplaySave request, final String type,
                                       final String format, final MultipartFile file) {
        text(request.title(), 200); text(request.url(), 2048); date(request.matchDate());
        try {
            final URI uri = URI.create(request.url().strip());
            if (!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))
                    || uri.getHost() == null || uri.getUserInfo() != null) { throw invalid(); }
        } catch (final IllegalArgumentException failure) { throw invalid(); }
        if (request.dayNumber() < 1 || request.teams() == null || request.teams().size() < 2 || request.teams().size() > 4
                || !contains(Set.of("POV", "OBSERVER"), request.perspective())) { throw invalid(); }
        request.teams().forEach(team -> text(team, 100));
        if (POINTS.equals(type)) {
            text(request.groupLabel(), 100);
            if (request.groupNumber() != null || request.bracket() != null) { throw invalid(); }
        } else if (SEMI_FINALS.equals(type) || "KNOCKOUT".equals(format)) {
            if (request.groupLabel() != null || request.groupNumber() == null || request.groupNumber() < 1
                    || request.groupNumber() > 4 || !contains(Set.of("DEFAULT", "WINNERS", "LOSERS"), request.bracket())) { throw invalid(); }
        } else if (request.groupLabel() != null || request.groupNumber() != null || request.bracket() != null) { throw invalid(); }
        if (!contains(Set.of("KEEP", "REMOVE", "REPLACE"), request.coverAction())
                || ("REPLACE".equals(request.coverAction()) ? file == null || file.isEmpty() : file != null)) { throw invalid(); }
    }
    private static boolean contains(final Set<String> values, final String value) { return value != null && values.contains(value); }
    private static void date(final LocalDate date) { if (date == null || date.getYear() < 1 || date.getYear() > 9999) { throw invalid(); } }
    private static void text(final String value, final int maximum) { if (!StringUtils.hasText(value) || value.strip().length() > maximum) { throw invalid(); } }
    private static void requireConfirmation(final boolean confirm) { if (!confirm) { throw invalid(); } }
    private static ApiException invalid() { return new ApiException(ApiErrorCode.INVALID_ARGUMENT); }
    private static ApiException notFound() { return new ApiException(ApiErrorCode.RESOURCE_NOT_FOUND); }
}
