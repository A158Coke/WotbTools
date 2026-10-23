package com.wotb.web.tournament.mapper;

import com.wotb.web.tournament.dto.BroadcastDtos;
import com.wotb.web.tournament.entity.BroadcastCategory;
import com.wotb.web.tournament.entity.BroadcastNode;
import com.wotb.web.tournament.entity.BroadcastReplay;
import com.wotb.web.tournament.entity.BroadcastSeason;
import com.wotb.web.util.Mapper;
import org.springframework.stereotype.Component;
import java.util.List;

@Component
public class BroadcastMapper implements Mapper<BroadcastReplay, BroadcastDtos.Replay> {
    public BroadcastDtos.Season season(final BroadcastSeason season, final long rootCount, final long replayCount) {
        return new BroadcastDtos.Season(season.id, season.server, season.year, season.nameZh, season.nameEn, season.nameRu,
                season.startDate, season.createdAt, season.version, rootCount, replayCount);
    }
    public BroadcastDtos.Category category(final BroadcastCategory category) {
        return new BroadcastDtos.Category(category.id, category.seasonId, category.type);
    }
    public BroadcastDtos.Node node(final BroadcastNode node, final List<BroadcastReplay> replays) {
        return new BroadcastDtos.Node(node.id, node.categoryId, node.roundNumber, node.format,
                replays.stream().map(this::toDto).toList());
    }
    public BroadcastDtos.ReplayStart replayStart(final BroadcastReplay replay) {
        return new BroadcastDtos.ReplayStart(replay.id, replay.matchStartsAt);
    }
    @Override
    public BroadcastDtos.Replay toDto(final BroadcastReplay replay) {
        return new BroadcastDtos.Replay(replay.id, replay.nodeId, replay.title, replay.url, replay.matchDate,
                replay.dayNumber, replay.groupNumber, replay.bracket,
                List.copyOf(replay.teams), replay.perspective, replay.coverId);
    }
}
