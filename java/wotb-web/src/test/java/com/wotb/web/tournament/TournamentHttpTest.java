package com.wotb.web.tournament;
import com.wotb.web.config.ApiErrorTestConfig;
import com.wotb.web.config.SecurityConfig;
import com.wotb.web.exceptionhandler.GlobalExceptionHandler;
import com.wotb.web.tournament.controller.TournamentAdminController;
import com.wotb.web.tournament.controller.TournamentController;
import com.wotb.web.tournament.dto.TournamentDtos;
import com.wotb.web.tournament.service.TournamentService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;
import tools.jackson.databind.json.JsonMapper;
import java.util.List;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class TournamentHttpTest {
    private AnnotationConfigWebApplicationContext context;
    private MockMvc mvc;
    @BeforeEach void setup() {
        context=new AnnotationConfigWebApplicationContext(); context.setServletContext(new MockServletContext()); context.register(TestConfig.class); context.refresh();
        mvc=MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }
    @AfterEach void close(){context.close();}
    @Test void onlyPublicGetsAndTournamentOrSuperAdminsMayReachTournamentRoutes() throws Exception {
        when(context.getBean(TournamentService.class).listEvents()).thenReturn(List.of());
        mvc.perform(get("/api/tournaments")).andExpect(status().isOk());
        mvc.perform(get("/api/admin/tournaments")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/admin/tournaments").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_HoF-admin")))).andExpect(status().isForbidden());
        mvc.perform(get("/api/admin/tournaments").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin")))).andExpect(status().isOk());
        mvc.perform(get("/api/admin/tournaments").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin")))).andExpect(status().isOk());
        mvc.perform(get("/api/tournaments/1/evidence/x")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/tournaments").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin")))).andExpect(status().isForbidden());
    }
    @Test void publicStandingsSerializationContainsOnlyProjectionAndExplicitMissingCells() throws Exception {
        final TournamentDtos.Event event=new TournamentDtos.Event(1,2,2026,"EU","SUMMER",4,3,List.of("Day 1","Day 2","Day 3"),true);
        final TournamentDtos.Standings board=new TournamentDtos.Standings(event,List.of(new TournamentDtos.StandingDay(1,1,"Day 1",true)),
                List.of(new TournamentDtos.StandingRow(1,"25时",100,List.of(new TournamentDtos.RoundPoints(1,100,List.of(new TournamentDtos.DayPoints(1,100L),new TournamentDtos.DayPoints(2,null)))))));
        when(context.getBean(TournamentService.class).publicStandings(1)).thenReturn(board);
        mvc.perform(get("/api/tournaments/1/standings")).andExpect(status().isOk()).andExpect(jsonPath("$.rows[0].clanTag").value("25时"))
                .andExpect(jsonPath("$.rows[0].rounds[0].days[1].points").doesNotExist()).andExpect(jsonPath("$.groups").doesNotExist()).andExpect(jsonPath("$.clans").doesNotExist());
        final var node=JsonMapper.builder().findAndAddModules().build().valueToTree(board);
        assertEquals(3,node.properties().size()); assertEquals(true,node.path("rows").get(0).path("rounds").get(0).path("days").get(1).has("points"));
    }
    @Test void requiredVersionAndRankPointsCannotSilentlyDefaultToZero() throws Exception {
        final var mapper=JsonMapper.builder().findAndAddModules().build();
        assertThrows(tools.jackson.core.JacksonException.class,()->mapper.readValue("{\"expectedDayVersion\":0}",TournamentDtos.Versions.class));
        assertThrows(tools.jackson.core.JacksonException.class,()->mapper.readValue("{\"rank\":1}",TournamentDtos.RankPoints.class));
        assertThrows(tools.jackson.core.JacksonException.class,()->mapper.readValue("{\"expectedEventVersion\":null,\"expectedDayVersion\":0}",TournamentDtos.Versions.class));
        assertThrows(tools.jackson.core.JacksonException.class,()->mapper.readValue("{\"rank\":1,\"points\":100.5}",TournamentDtos.RankPoints.class));
        assertThrows(tools.jackson.core.JacksonException.class,()->mapper.readValue("{\"rank\":1,\"points\":\"100\"}",TournamentDtos.RankPoints.class));
        assertThrows(tools.jackson.core.JacksonException.class,()->mapper.readValue("{\"expectedEventVersion\":0.1,\"expectedDayVersion\":0}",TournamentDtos.Versions.class));
        assertThrows(tools.jackson.core.JacksonException.class,()->mapper.readValue("{\"clanTag\":\"A\",\"rank\":1.5}",TournamentDtos.Team.class));
        assertEquals(100,mapper.readValue("{\"rank\":1.0,\"points\":100.0}",TournamentDtos.RankPoints.class).points());
        mvc.perform(post("/api/admin/tournaments/1/rounds/1/days/1/finalize").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin")))
                .contentType("application/json").content("{\"expectedDayVersion\":0,\"expectedRulesVersion\":1,\"idempotencyKey\":\"test\"}"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(context.getBean(TournamentService.class));
    }
    @Test void historicalImportUsesStrictJacksonCellReadersAndPreservesExplicitNulls() throws Exception {
        final var mapper=JsonMapper.builder().findAndAddModules().build();
        final String base="{\"expectedEventVersion\":0,\"sourceName\":\"summer.png\",\"sourceSha256\":\""+"a".repeat(64)+"\",\"rows\":[{\"clanTag\":\"25时\",\"points\":[null,0,100],\"sourceTotal\":100}]}";
        final TournamentDtos.HistoricalPreviewRequest request=mapper.readValue(base,TournamentDtos.HistoricalPreviewRequest.class);
        assertEquals(0,request.rows().getFirst().points().get(1)); assertEquals(null,request.rows().getFirst().points().getFirst());
        assertThrows(tools.jackson.core.JacksonException.class,()->mapper.readValue(base.replace("null,0,100","null,0,100.5"),TournamentDtos.HistoricalPreviewRequest.class));
        assertThrows(tools.jackson.core.JacksonException.class,()->mapper.readValue(base.replace("null,0,100","null,0,\"100\""),TournamentDtos.HistoricalPreviewRequest.class));
        assertThrows(tools.jackson.core.JacksonException.class,()->mapper.readValue(base.replace("\"sourceTotal\":100","\"sourceTotal\":\"100\""),TournamentDtos.HistoricalPreviewRequest.class));
        assertThrows(tools.jackson.core.JacksonException.class,()->mapper.readValue(base.replace(",\"sourceTotal\":100",""),TournamentDtos.HistoricalPreviewRequest.class));
        assertThrows(tools.jackson.core.JacksonException.class,()->mapper.readValue(base.replace("\"sourceTotal\":100","\"sourceTotal\":100.5"),TournamentDtos.HistoricalPreviewRequest.class));
    }
    @Test void historicalImportEndpointsAreAdminOnlyAndReturnExplicitPreviewShape() throws Exception {
        final TournamentDtos.Event event=new TournamentDtos.Event(1,0,2026,"CN","SUMMER",5,2,List.of("小组赛","决赛圈"),false);
        final TournamentDtos.HistoricalPreview response=new TournamentDtos.HistoricalPreview(new TournamentDtos.Standings(event,List.of(),List.of()),32,32,4,0);
        when(context.getBean(TournamentService.class).previewHistorical(eq(1L),any())).thenReturn(response);
        final String request="{\"expectedEventVersion\":0,\"sourceName\":\"summer.png\",\"sourceSha256\":\""+"a".repeat(64)+"\",\"rows\":[]}";
        mvc.perform(post("/api/admin/tournaments/1/historical-import/preview").contentType("application/json").content(request)).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/admin/tournaments/1/historical-import/preview").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_HoF-admin"))).contentType("application/json").content(request)).andExpect(status().isForbidden());
        mvc.perform(post("/api/admin/tournaments/1/historical-import/preview").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin"))).contentType("application/json").content(request))
                .andExpect(status().isOk()).andExpect(jsonPath("$.sourceRowCount").value(32)).andExpect(jsonPath("$.clanCount").value(32)).andExpect(jsonPath("$.missingCellCount").value(4)).andExpect(jsonPath("$.eventVersion").value(0));
        mvc.perform(post("/api/admin/tournaments/1/historical-import/preview").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin"))).contentType("application/json").content(request)).andExpect(status().isOk());
        mvc.perform(post("/api/admin/tournaments/1/historical-import").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin"))).contentType("application/json").content(request))
                .andExpect(status().isBadRequest());
    }
    @Configuration @EnableWebMvc
    @Import({SecurityConfig.class,ApiErrorTestConfig.class,GlobalExceptionHandler.class})
    static class TestConfig {
        @Bean JwtDecoder jwtDecoder(){return mock(JwtDecoder.class);}
        @Bean TournamentService service(){return mock(TournamentService.class);}
        @Bean TournamentController publicController(final TournamentService service){return new TournamentController(service);}
        @Bean TournamentAdminController adminController(final TournamentService service){return new TournamentAdminController(service);}
    }
}
