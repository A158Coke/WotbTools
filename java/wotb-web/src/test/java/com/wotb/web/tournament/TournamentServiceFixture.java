package com.wotb.web.tournament;

import com.wotb.web.tournament.dto.TournamentDtos;
import com.wotb.web.tournament.entity.TournamentAudit;
import com.wotb.web.tournament.entity.TournamentClan;
import com.wotb.web.tournament.entity.TournamentDay;
import com.wotb.web.tournament.entity.TournamentDefaultRules;
import com.wotb.web.tournament.entity.TournamentEvent;
import com.wotb.web.tournament.entity.TournamentEvidence;
import com.wotb.web.tournament.entity.TournamentRule;
import com.wotb.web.tournament.entity.TournamentSnapshot;
import com.wotb.web.tournament.mapper.TournamentMapper;
import com.wotb.web.tournament.repository.TournamentAuditRepository;
import com.wotb.web.tournament.repository.TournamentClanRepository;
import com.wotb.web.tournament.repository.TournamentDayRepository;
import com.wotb.web.tournament.repository.TournamentDefaultRulesRepository;
import com.wotb.web.tournament.repository.TournamentEventRepository;
import com.wotb.web.tournament.repository.TournamentEvidenceRepository;
import com.wotb.web.tournament.repository.TournamentRuleRepository;
import com.wotb.web.tournament.service.TournamentEvidenceStorage;
import com.wotb.web.tournament.service.TournamentService;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.mock.web.MockMultipartFile;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

abstract class TournamentServiceFixture {

    protected static final String KEY = "unit-only-32-byte-signing-key-123456";
    protected final TournamentDefaultRulesRepository defaults = mock(TournamentDefaultRulesRepository.class);
    protected final TournamentEventRepository events = mock(TournamentEventRepository.class);
    protected final TournamentRuleRepository rules = mock(TournamentRuleRepository.class);
    protected final TournamentDayRepository days = mock(TournamentDayRepository.class);
    protected final TournamentClanRepository clans = mock(TournamentClanRepository.class);
    protected final TournamentEvidenceRepository evidence = mock(TournamentEvidenceRepository.class);
    protected final TournamentAuditRepository audits = mock(TournamentAuditRepository.class);
    protected final TournamentEvidenceStorage storage = mock(TournamentEvidenceStorage.class);
    protected TournamentService service;
    protected TournamentEvent event;
    protected TournamentRule rule;
    protected TournamentDay day;
    protected final List<TournamentDay> dayRows = new ArrayList<>();
    protected final List<TournamentClan> clanRows = new ArrayList<>();
    protected final Map<String, TournamentEvidence> images = new HashMap<>();
    protected final List<TournamentAudit> auditRows = new ArrayList<>();
    @BeforeEach void setup() {
        service = new TournamentService(events,rules,defaults,days,clans,evidence,audits,new TournamentMapper(),storage,KEY);
        final TournamentDefaultRules slot = new TournamentDefaultRules();
        when(defaults.findById(1L)).thenReturn(Optional.of(slot)); when(defaults.findLocked()).thenReturn(slot);
        event = new TournamentEvent(); event.ruleSource="CUSTOM"; event.id=1L; event.year=2026; event.region="CN"; event.season="FIRE_CUP";
        event.roundCount=5; event.daysPerRound=2; event.dayLabels=List.of("Day 1","Day 2");
        rule = new TournamentRule(); rule.eventId=1; rule.roundNumber=1; rule.rulesVersion=1; rule.days=ruleDays(false);
        day = new TournamentDay(); day.id=1L; day.eventId=1; day.roundNumber=1; day.dayNumber=1; day.expectedGroupCount=2;
        day.clearedClans=Set.of(); day.publicationKeys=Set.of(); dayRows.add(day);
        when(events.findById(1L)).thenAnswer(call->Optional.of(event)); when(events.findLocked(1L)).thenAnswer(call->Optional.of(event));
        when(events.findAllByOrderByYearDescIdDesc()).thenReturn(List.of(event));
        when(rules.findByEventIdAndRoundNumber(1L,1)).thenAnswer(call->Optional.of(rule));
        when(rules.findByEventIdOrderByRoundNumber(1L)).thenReturn(List.of(rule));
        when(days.findByEventIdOrderByRoundNumberAscDayNumberAsc(1L)).thenAnswer(call->List.copyOf(dayRows));
        when(days.findByEventIdAndRoundNumberAndDayNumber(anyLong(),anyInt(),anyInt())).thenAnswer(call -> dayRows.stream()
                .filter(row->row.roundNumber==(int)call.getArgument(1) && row.dayNumber==(int)call.getArgument(2)).findFirst());
        when(days.save(any())).thenAnswer(call->{ final TournamentDay row=call.getArgument(0); if(!dayRows.contains(row)){dayRows.add(row);} return row;});
        when(clans.findByEventIdOrderByClanTag(1L)).thenAnswer(call->List.copyOf(clanRows));
        when(clans.existsByEventIdAndClanTag(anyLong(),anyString())).thenAnswer(call->clanRows.stream().anyMatch(row->row.clanTag.equals(call.getArgument(1))));
        when(clans.save(any())).thenAnswer(call->{final TournamentClan row=call.getArgument(0);clanRows.add(row);return row;});
        when(evidence.findByIdAndEventId(anyString(),anyLong())).thenAnswer(call->Optional.ofNullable(images.get(call.getArgument(0))));
        when(evidence.findByEventId(anyLong())).thenAnswer(call->List.copyOf(images.values()));
        when(evidence.save(any())).thenAnswer(call->{final TournamentEvidence row=call.getArgument(0);images.put(row.id,row);return row;});
        when(audits.save(any())).thenAnswer(call->{final TournamentAudit row=call.getArgument(0);row.id=(long)auditRows.size()+1;auditRows.add(row);return row;});
        when(audits.findCsvImport(anyLong(),anyString())).thenAnswer(call->auditRows.stream()
                .filter(row->"CSV_IMPORTED".equals(row.action) && call.getArgument(1).equals(row.afterState.get("idempotencyKey"))).findFirst());
    }
    protected TournamentDtos.HistoricalImportRequest historicalRequest(final List<TournamentDtos.HistoricalRow> input, final String key) {
        return new TournamentDtos.HistoricalImportRequest(event.version,"source.png","a".repeat(64),input,true,key);
    }












    protected List<TournamentDtos.Team> teamsOf(final String... tags) {
        final List<TournamentDtos.Team> teams = new ArrayList<>();
        for (int index = 0; index < tags.length; index++) { teams.add(new TournamentDtos.Team(tags[index], index + 1)); }
        return teams;
    }




    protected final MockMultipartFile evidenceFile = new MockMultipartFile("image", "group.png", "image/png", new byte[] {1});









    protected TournamentDtos.IncomingGroup groupForDay(final int round, final int dayNumber, final String... tags) {
        final TournamentEvidence row = new TournamentEvidence(); row.id = UUID.randomUUID().toString(); row.eventId = 1;
        row.roundNumber = round; row.dayNumber = dayNumber; row.createdAt = Instant.now(); row.imageHash = String.format("%064x", images.size() + 1);
        images.put(row.id, row);
        final List<TournamentDtos.Team> teams = new ArrayList<>();
        for (int index = 0; index < tags.length; index++) { teams.add(new TournamentDtos.Team(tags[index], index + 1)); }
        return new TournamentDtos.IncomingGroup(1, row.id, row.imageHash, teams, "ERROR", true);
    }









    protected MockMultipartFile csv(final String text) { return new MockMultipartFile("file", "standings.csv", "text/csv", text.getBytes(StandardCharsets.UTF_8)); }
    protected String csvText(final String tag, final String first, final String second, final String total) {
        return "军团标签,R1D1,R1D2,R2D1,R2D2,R3D1,R3D2,R4D1,R4D2,R5D1,R5D2,总积分\n" + tag + "," + first + "," + second + ",,,,,,,,," + total + "\n";
    }
    protected TournamentDtos.HistoricalRow historicalRow(final String tag, final Integer... input) {
        final List<Integer> values=new ArrayList<>(java.util.Collections.nCopies(10,null)); long total=0;
        for(int index=0;index<input.length;index++){values.set(index,input[index]); if(input[index]!=null){total+=input[index];}}
        return new TournamentDtos.HistoricalRow(tag,values,total);
    }
    protected void publish(final String key) { service.finalizeDay("admin",1,1,1,new TournamentDtos.FinalizeRequest(event.version,day.version,rule.rulesVersion,key)); }
    protected TournamentDtos.DraftRequest request(final List<TournamentDtos.IncomingGroup> groups, final List<String> tags) { return new TournamentDtos.DraftRequest(event.version,day.version,rule.rulesVersion,groups,tags); }
    protected TournamentDtos.IncomingGroup group(final int number, final String action, final String... tags) {
        final TournamentEvidence row=new TournamentEvidence(); row.id=UUID.randomUUID().toString(); row.eventId=1; row.roundNumber=1; row.dayNumber=1;
        row.createdAt=Instant.now(); row.imageHash=String.format("%064x",images.size()+1); images.put(row.id,row);
        final List<TournamentDtos.Team> teams=new ArrayList<>(); for(int i=0;i<tags.length;i++){teams.add(new TournamentDtos.Team(tags[i],i+1));}
        return new TournamentDtos.IncomingGroup(number,row.id,row.imageHash,teams,action,true);
    }
    protected List<TournamentSnapshot.RuleDay> ruleDays(final boolean fifth) {
        final List<TournamentSnapshot.RankPoints> points=new ArrayList<>(List.of(new TournamentSnapshot.RankPoints(1,100),new TournamentSnapshot.RankPoints(2,50),new TournamentSnapshot.RankPoints(3,25),new TournamentSnapshot.RankPoints(4,10)));
        if(fifth){points.add(new TournamentSnapshot.RankPoints(5,5));} return List.of(new TournamentSnapshot.RuleDay(1,points),new TournamentSnapshot.RuleDay(2,points));
    }
    protected void assertCode(final ApiErrorCode code, final Runnable action) { assertEquals(code,assertThrows(ApiException.class,action::run).errorCode()); }
}


