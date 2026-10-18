-- Reviewed 2025/2026 tournament broadcasts; one evidenced representative battle pair per stream.
-- Source: docs/research/broadcast-seed-2025-2026/seed-ready-2025-2026-verified.json
-- Source SHA-256 (UTF-8, LF): e851618cb48addce71af760263a455c084aa857678bd3f8f924ea44d4d7adafc
-- Live-start UTC remains in source evidence; only its regional calendar date is imported.
-- Confirmed groups are preserved; unknown groups remain NULL. No network access or overwrite of administrator-owned data.
DO $seed$
DECLARE
    source_rows CONSTANT jsonb := $entries$[
  {
    "server": "EU",
    "year": 2026,
    "season": {
      "nameZh": "春季赛",
      "nameEn": "Spring Games",
      "nameRu": "Весенние игры",
      "startDate": "2026-03-02"
    },
    "categoryType": "POINTS",
    "node": {
      "roundNumber": 1,
      "format": null
    },
    "replay": {
      "title": "积分赛 PYS · 第1轮 / Round 1 · 第4天 / Day 4 · MERCY vs AQVA",
      "url": "https://www.youtube.com/watch?v=FXGodwWu1cw",
      "matchDate": "2026-03-05",
      "startsAt": null,
      "dayNumber": 4,
      "groupNumber": null,
      "bracket": null,
      "teams": [
        "[MERCY] Vaporize",
        "[AQVA] Mono"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2026,
    "season": {
      "nameZh": "春季赛",
      "nameEn": "Spring Games",
      "nameRu": "Весенние игры",
      "startDate": "2026-03-02"
    },
    "categoryType": "POINTS",
    "node": {
      "roundNumber": 2,
      "format": null
    },
    "replay": {
      "title": "积分赛 PYS · 第2轮 / Round 2 · 第4天 / Day 4 · LQVID vs MERCY",
      "url": "https://www.youtube.com/watch?v=ZcwvTGyUP9M",
      "matchDate": "2026-03-10",
      "startsAt": null,
      "dayNumber": 4,
      "groupNumber": null,
      "bracket": null,
      "teams": [
        "[LQVID] 67",
        "[MERCY] Vaporize"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2026,
    "season": {
      "nameZh": "春季赛",
      "nameEn": "Spring Games",
      "nameRu": "Весенние игры",
      "startDate": "2026-03-02"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · BLOVE vs MERCY",
      "url": "https://www.youtube.com/watch?v=_u3nHqOfX5s",
      "matchDate": "2026-03-25",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": null,
      "bracket": "DEFAULT",
      "teams": [
        "[BLOVE] Bedbug",
        "[MERCY] Vaporize"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2026,
    "season": {
      "nameZh": "闪击大师赛：传承",
      "nameEn": "Blitz Masters: Legacy",
      "nameRu": "Blitz Masters: Наследие",
      "startDate": "2026-05-10"
    },
    "categoryType": "POINTS",
    "node": {
      "roundNumber": 1,
      "format": null
    },
    "replay": {
      "title": "积分赛 PYS · 第1轮 / Round 1 · 第4天 / Day 4 · BLOVE vs EXL",
      "url": "https://www.youtube.com/watch?v=qBqQwnb-CQw",
      "matchDate": "2026-05-13",
      "startsAt": null,
      "dayNumber": 4,
      "groupNumber": null,
      "bracket": null,
      "teams": [
        "[BLOVE] Bedbug",
        "[EXL] Excellence"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2026,
    "season": {
      "nameZh": "闪击大师赛：传承",
      "nameEn": "Blitz Masters: Legacy",
      "nameRu": "Blitz Masters: Наследие",
      "startDate": "2026-05-10"
    },
    "categoryType": "POINTS",
    "node": {
      "roundNumber": 2,
      "format": null
    },
    "replay": {
      "title": "积分赛 PYS · 第2轮 / Round 2 · 第4天 / Day 4 · -BPS- vs S-WIL",
      "url": "https://www.youtube.com/watch?v=M6F3kmIxGjg",
      "matchDate": "2026-05-18",
      "startsAt": null,
      "dayNumber": 4,
      "groupNumber": null,
      "bracket": null,
      "teams": [
        "[-BPS-] Push or Bench",
        "[S-WIL] dep"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2026,
    "season": {
      "nameZh": "闪击大师赛：传承",
      "nameEn": "Blitz Masters: Legacy",
      "nameRu": "Blitz Masters: Наследие",
      "startDate": "2026-05-10"
    },
    "categoryType": "POINTS",
    "node": {
      "roundNumber": 3,
      "format": null
    },
    "replay": {
      "title": "积分赛 PYS · 第3轮 / Round 3 · 第4天 / Day 4 · TORND vs L333T",
      "url": "https://www.youtube.com/watch?v=RKA0U8rzXF0",
      "matchDate": "2026-05-24",
      "startsAt": null,
      "dayNumber": 4,
      "groupNumber": null,
      "bracket": null,
      "teams": [
        "[TORND] TORNADO",
        "[L333T] LEEET ALLIANCE"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2026,
    "season": {
      "nameZh": "秋季赛",
      "nameEn": "Autumn Games",
      "nameRu": "Осенние игры",
      "startDate": "2026-09-12"
    },
    "categoryType": "POINTS",
    "node": {
      "roundNumber": 3,
      "format": null
    },
    "replay": {
      "title": "积分赛 PYS · 第3轮 / Round 3 · 第4天 / Day 4 · LUV- vs L333T",
      "url": "https://www.youtube.com/watch?v=09LHv_Hk4VI",
      "matchDate": "2026-09-26",
      "startsAt": null,
      "dayNumber": 4,
      "groupNumber": null,
      "bracket": null,
      "teams": [
        "[LUV-] LostInNorway",
        "[L333T] LEEEEEEEEEEEEET"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2026,
    "season": {
      "nameZh": "秋季赛",
      "nameEn": "Autumn Games",
      "nameRu": "Осенние игры",
      "startDate": "2026-09-12"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · KOVA- vs BLOVE",
      "url": "https://www.youtube.com/watch?v=HwtHTRndqCY",
      "matchDate": "2026-10-11",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": null,
      "bracket": "DEFAULT",
      "teams": [
        "[KOVA-] KOVA",
        "[BLOVE] Bedbug"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "ASIA",
    "year": 2026,
    "season": {
      "nameZh": "春季赛",
      "nameEn": "Spring Games",
      "nameRu": "Весенние игры",
      "startDate": "2026-03-02"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · 败者组 / Lower Bracket · REQM vs CHRD",
      "url": "https://www.youtube.com/watch?v=reSgKpylUwE",
      "matchDate": "2026-03-25",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "LOSERS",
      "teams": [
        "REQM",
        "CHRD"
      ],
      "perspective": "POV"
    }
  },
  {
    "server": "ASIA",
    "year": 2026,
    "season": {
      "nameZh": "秋季赛",
      "nameEn": "Autumn Games",
      "nameRu": "Осенние игры",
      "startDate": "2026-09-12"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第1天 / Day 1 · 第1组 / Group 1 · LEEET vs FL4ME",
      "url": "https://www.youtube.com/watch?v=Vh89K143B4k",
      "matchDate": "2026-10-10",
      "startsAt": null,
      "dayNumber": 1,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "[LEEET] LEEEEEEEET",
        "[FL4ME] Jaded"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "ASIA",
    "year": 2026,
    "season": {
      "nameZh": "秋季赛",
      "nameEn": "Autumn Games",
      "nameRu": "Осенние игры",
      "startDate": "2026-09-12"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · FL4ME vs LEEET",
      "url": "https://www.youtube.com/watch?v=Lo9JZspuPr4",
      "matchDate": "2026-10-11",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "[FL4ME] Jaded",
        "[LEEET] LEEEEEEEET"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "ASIA",
    "year": 2026,
    "season": {
      "nameZh": "闪击大师赛：传承",
      "nameEn": "Blitz Masters: Legacy",
      "nameRu": "Blitz Masters: Наследие",
      "startDate": "2026-05-10"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第1天 / Day 1 · 第1组 / Group 1 · REQM vs ISRL",
      "url": "https://www.youtube.com/watch?v=QdWSCdplcII",
      "matchDate": "2026-06-06",
      "startsAt": null,
      "dayNumber": 1,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "[REQM] Primacy",
        "[ISRL] Island Boys"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "ASIA",
    "year": 2026,
    "season": {
      "nameZh": "春季赛",
      "nameEn": "Spring Games",
      "nameRu": "Весенние игры",
      "startDate": "2026-03-02"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第1天 / Day 1 · 第1组 / Group 1 · REQM vs CHRD",
      "url": "https://www.youtube.com/watch?v=PetG1HegBTI",
      "matchDate": "2026-03-24",
      "startsAt": null,
      "dayNumber": 1,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "[REQM] Primacy",
        "[CHRD] Last chance"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "ASIA",
    "year": 2026,
    "season": {
      "nameZh": "春季赛",
      "nameEn": "Spring Games",
      "nameRu": "Весенние игры",
      "startDate": "2026-03-02"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · REQM vs CHRD",
      "url": "https://www.youtube.com/watch?v=6a47CV6v1Fs",
      "matchDate": "2026-03-25",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "[REQM] Primacy",
        "[CHRD] Last chance"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "ASIA",
    "year": 2026,
    "season": {
      "nameZh": "秋季赛",
      "nameEn": "Autumn Games",
      "nameRu": "Осенние игры",
      "startDate": "2026-09-12"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · FL4ME vs LEEET",
      "url": "https://www.youtube.com/watch?v=FMmyzEl16_o",
      "matchDate": "2026-10-11",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "[FL4ME] Jaded",
        "[LEEET] LEEEEEEEET"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "ASIA",
    "year": 2026,
    "season": {
      "nameZh": "秋季赛",
      "nameEn": "Autumn Games",
      "nameRu": "Осенние игры",
      "startDate": "2026-09-12"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第1天 / Day 1 · 第1组 / Group 1 · LEEET vs FL4ME",
      "url": "https://www.youtube.com/watch?v=yOpc-sG7o4k",
      "matchDate": "2026-10-10",
      "startsAt": null,
      "dayNumber": 1,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "[LEEET] LEEEEEEEET",
        "[FL4ME] Jaded"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "ASIA",
    "year": 2026,
    "season": {
      "nameZh": "秋季赛",
      "nameEn": "Autumn Games",
      "nameRu": "Осенние игры",
      "startDate": "2026-09-12"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · FL4ME vs LEEET",
      "url": "https://www.youtube.com/watch?v=FrefK25xhEk",
      "matchDate": "2026-10-11",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "[FL4ME] Jaded",
        "[LEEET] LEEEEEEEET"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "ASIA",
    "year": 2026,
    "season": {
      "nameZh": "春季赛",
      "nameEn": "Spring Games",
      "nameRu": "Весенние игры",
      "startDate": "2026-03-02"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · YSL vs REQM",
      "url": "https://www.youtube.com/watch?v=KwBzUqpky_E",
      "matchDate": "2026-03-25",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "[YSL] Casino Royale",
        "[REQM] Primacy"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2026,
    "season": {
      "nameZh": "春季赛",
      "nameEn": "Spring Games",
      "nameRu": "Весенние игры",
      "startDate": "2026-03-02"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第1天 / Day 1 · 第1组 / Group 1 · MERCY vs EXL",
      "url": "https://www.youtube.com/watch?v=uBWcqQDlIK4",
      "matchDate": "2026-03-24",
      "startsAt": null,
      "dayNumber": 1,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "[MERCY] Vaporize",
        "[EXL] Excellence"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2026,
    "season": {
      "nameZh": "春季赛",
      "nameEn": "Spring Games",
      "nameRu": "Весенние игры",
      "startDate": "2026-03-02"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · EXL vs MERCY",
      "url": "https://www.youtube.com/watch?v=9MCy6iZpu0s",
      "matchDate": "2026-03-25",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "[EXL] Excellence",
        "[MERCY] Vaporize"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2026,
    "season": {
      "nameZh": "春季赛",
      "nameEn": "Spring Games",
      "nameRu": "Весенние игры",
      "startDate": "2026-03-02"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · BLOVE vs MERCY",
      "url": "https://www.youtube.com/watch?v=ceJSSkGUHj4",
      "matchDate": "2026-03-25",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "[BLOVE] Bedbug",
        "[MERCY] Vaporize"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2026,
    "season": {
      "nameZh": "春季赛",
      "nameEn": "Spring Games",
      "nameRu": "Весенние игры",
      "startDate": "2026-03-02"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · BLOVE vs MERCY",
      "url": "https://www.youtube.com/watch?v=zfG1ebtx2bU",
      "matchDate": "2026-03-25",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "[BLOVE] Bedbug",
        "[MERCY] Vaporize"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2026,
    "season": {
      "nameZh": "春季赛",
      "nameEn": "Spring Games",
      "nameRu": "Весенние игры",
      "startDate": "2026-03-02"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · EXL vs MERCY",
      "url": "https://www.youtube.com/watch?v=on7JjjO-Uok",
      "matchDate": "2026-03-25",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "[EXL] Excellence",
        "[MERCY] Vaporize"
      ],
      "perspective": "POV"
    }
  },
  {
    "server": "EU",
    "year": 2026,
    "season": {
      "nameZh": "闪击大师赛：传承",
      "nameEn": "Blitz Masters: Legacy",
      "nameRu": "Blitz Masters: Наследие",
      "startDate": "2026-05-10"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第1天 / Day 1 · 第1组 / Group 1 · EXL vs -BPS-",
      "url": "https://www.youtube.com/watch?v=ea468wLLh08",
      "matchDate": "2026-06-06",
      "startsAt": null,
      "dayNumber": 1,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "[EXL] Excellence",
        "[-BPS-] Push or Bench"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2026,
    "season": {
      "nameZh": "秋季赛",
      "nameEn": "Autumn Games",
      "nameRu": "Осенние игры",
      "startDate": "2026-09-12"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第1天 / Day 1 · 第1组 / Group 1 · BLOVE vs JESUS",
      "url": "https://www.youtube.com/watch?v=mWNEw1wTG0A",
      "matchDate": "2026-10-10",
      "startsAt": null,
      "dayNumber": 1,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "[BLOVE] Bedbug",
        "[JESUS] Vaporize"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2026,
    "season": {
      "nameZh": "秋季赛",
      "nameEn": "Autumn Games",
      "nameRu": "Осенние игры",
      "startDate": "2026-09-12"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · KOVA- vs BLOVE",
      "url": "https://www.youtube.com/watch?v=tISW8qtVzAI",
      "matchDate": "2026-10-11",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "[KOVA-] KOVA",
        "[BLOVE] Bedbug"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2026,
    "season": {
      "nameZh": "秋季赛",
      "nameEn": "Autumn Games",
      "nameRu": "Осенние игры",
      "startDate": "2026-09-12"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · KOVA- vs BLOVE",
      "url": "https://www.youtube.com/watch?v=DXncD0sLetg",
      "matchDate": "2026-10-11",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "[KOVA-] KOVA",
        "[BLOVE] Bedbug"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2026,
    "season": {
      "nameZh": "秋季赛",
      "nameEn": "Autumn Games",
      "nameRu": "Осенние игры",
      "startDate": "2026-09-12"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · JESUS vs BLOVE",
      "url": "https://www.youtube.com/watch?v=rgO8V0QOc2g",
      "matchDate": "2026-10-11",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "[JESUS] Vaporize",
        "[BLOVE] Bedbug"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2026,
    "season": {
      "nameZh": "秋季赛",
      "nameEn": "Autumn Games",
      "nameRu": "Осенние игры",
      "startDate": "2026-09-12"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · JESUS vs BLOVE",
      "url": "https://www.youtube.com/watch?v=MxMlbXBZPpU",
      "matchDate": "2026-10-11",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "[JESUS] Vaporize",
        "[BLOVE] Bedbug"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "NA",
    "year": 2026,
    "season": {
      "nameZh": "春季赛",
      "nameEn": "Spring Games",
      "nameRu": "Весенние игры",
      "startDate": "2026-03-02"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第1天 / Day 1 · 第1组 / Group 1 · OBLVN vs -_X",
      "url": "https://www.youtube.com/watch?v=bvBbgyFa4PQ",
      "matchDate": "2026-03-24",
      "startsAt": null,
      "dayNumber": 1,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "[OBLVN] So Predictable",
        "[-_X] Origin"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "NA",
    "year": 2026,
    "season": {
      "nameZh": "春季赛",
      "nameEn": "Spring Games",
      "nameRu": "Весенние игры",
      "startDate": "2026-03-02"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · GG- vs -_X",
      "url": "https://www.youtube.com/watch?v=QBkZvrl5ato",
      "matchDate": "2026-03-25",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "[GG-] Good Game",
        "[-_X] Origin"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "NA",
    "year": 2026,
    "season": {
      "nameZh": "春季赛",
      "nameEn": "Spring Games",
      "nameRu": "Весенние игры",
      "startDate": "2026-03-02"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · OBLVN vs -_X",
      "url": "https://www.youtube.com/watch?v=hVlLISeO-vE",
      "matchDate": "2026-03-25",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "[OBLVN] So Predictable",
        "[-_X] Origin"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "NA",
    "year": 2026,
    "season": {
      "nameZh": "闪击大师赛：传承",
      "nameEn": "Blitz Masters: Legacy",
      "nameRu": "Blitz Masters: Наследие",
      "startDate": "2026-05-10"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第1天 / Day 1 · 第1组 / Group 1 · -_X vs JKR",
      "url": "https://www.youtube.com/watch?v=a7nYJekObDU",
      "matchDate": "2026-06-06",
      "startsAt": null,
      "dayNumber": 1,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "[-_X] Origin",
        "[JKR] Jokers"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "NA",
    "year": 2026,
    "season": {
      "nameZh": "秋季赛",
      "nameEn": "Autumn Games",
      "nameRu": "Осенние игры",
      "startDate": "2026-09-12"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第1天 / Day 1 · 第1组 / Group 1 · -NM- vs 322",
      "url": "https://www.youtube.com/watch?v=X1f0o05OoyM",
      "matchDate": "2026-10-10",
      "startsAt": null,
      "dayNumber": 1,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "[-NM-] Primus Nox",
        "[322] Exterminatus"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "NA",
    "year": 2026,
    "season": {
      "nameZh": "秋季赛",
      "nameEn": "Autumn Games",
      "nameRu": "Осенние игры",
      "startDate": "2026-09-12"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第1天 / Day 1 · 第1组 / Group 1 · -NM- vs 322",
      "url": "https://www.youtube.com/watch?v=Ob5AAwDYKic",
      "matchDate": "2026-10-10",
      "startsAt": null,
      "dayNumber": 1,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "[-NM-] Primus Nox",
        "[322] Exterminatus"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "NA",
    "year": 2026,
    "season": {
      "nameZh": "秋季赛",
      "nameEn": "Autumn Games",
      "nameRu": "Осенние игры",
      "startDate": "2026-09-12"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · -NM- vs JKR",
      "url": "https://www.youtube.com/watch?v=QRGPK3fSlYA",
      "matchDate": "2026-10-11",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "[-NM-] Primus Nox",
        "[JKR] Joker"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "NA",
    "year": 2026,
    "season": {
      "nameZh": "秋季赛",
      "nameEn": "Autumn Games",
      "nameRu": "Осенние игры",
      "startDate": "2026-09-12"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · -NM- vs JKR",
      "url": "https://www.youtube.com/watch?v=N1mnt_6z7D0",
      "matchDate": "2026-10-11",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "[-NM-] Primus Nox",
        "[JKR] Joker"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "NA",
    "year": 2026,
    "season": {
      "nameZh": "春季赛",
      "nameEn": "Spring Games",
      "nameRu": "Весенние игры",
      "startDate": "2026-03-02"
    },
    "categoryType": "QUARTER_FINALS",
    "node": {
      "roundNumber": null,
      "format": "ROUND_ROBIN"
    },
    "replay": {
      "title": "八强 TOP 8 · 循环赛 / Round Robin · 第1天 / Day 1 · GG- vs APX",
      "url": "https://www.youtube.com/watch?v=sYURrUAi-oE",
      "matchDate": "2026-03-18",
      "startsAt": null,
      "dayNumber": 1,
      "groupNumber": null,
      "bracket": null,
      "teams": [
        "[GG-] Good Game",
        "[APX] Washed Gamers"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "NA",
    "year": 2026,
    "season": {
      "nameZh": "闪击大师赛：传承",
      "nameEn": "Blitz Masters: Legacy",
      "nameRu": "Blitz Masters: Наследие",
      "startDate": "2026-05-10"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · JKR vs OBLVN",
      "url": "https://www.youtube.com/watch?v=jR5Z5bMvOQQ",
      "matchDate": "2026-06-07",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": null,
      "bracket": "DEFAULT",
      "teams": [
        "[JKR] Jokers",
        "[OBLVN] So Predictable"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "NA",
    "year": 2026,
    "season": {
      "nameZh": "闪击大师赛：传承",
      "nameEn": "Blitz Masters: Legacy",
      "nameRu": "Blitz Masters: Наследие",
      "startDate": "2026-05-10"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · JKR vs OBLVN",
      "url": "https://www.youtube.com/watch?v=haxzkQHOYss",
      "matchDate": "2026-06-07",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": null,
      "bracket": "DEFAULT",
      "teams": [
        "[JKR] Jokers",
        "[OBLVN] So Predictable"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "NA",
    "year": 2026,
    "season": {
      "nameZh": "闪击大师赛：传承",
      "nameEn": "Blitz Masters: Legacy",
      "nameRu": "Blitz Masters: Наследие",
      "startDate": "2026-05-10"
    },
    "categoryType": "POINTS",
    "node": {
      "roundNumber": 2,
      "format": null
    },
    "replay": {
      "title": "积分赛 PYS · 第2轮 / Round 2 · 第3天 / Day 3 · -_X vs PONDA",
      "url": "https://www.youtube.com/watch?v=ddrhpWqhO0I",
      "matchDate": "2026-05-17",
      "startsAt": null,
      "dayNumber": 3,
      "groupNumber": null,
      "bracket": null,
      "teams": [
        "-_X",
        "PONDA"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "ASIA",
    "year": 2026,
    "season": {
      "nameZh": "闪击大师赛：传承",
      "nameEn": "Blitz Masters: Legacy",
      "nameRu": "Blitz Masters: Наследие",
      "startDate": "2026-05-10"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · REQM vs ISRL",
      "url": "https://www.youtube.com/watch?v=sOj19MwBReQ",
      "matchDate": "2026-06-07",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "[REQM] Primacy",
        "[ISRL] Island Boys"
      ],
      "perspective": "POV"
    }
  },
  {
    "server": "LESTA",
    "year": 2026,
    "season": {
      "nameZh": "闪击积分联赛·第4期·第I赛季",
      "nameEn": "Blitz Point League — Part 4, Season I",
      "nameRu": "Лига Блиц Поинт, Часть 4 — Сезон I",
      "startDate": null
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第3天 / Day 3 · 败者组 / Lower Bracket · CONSILIUM vs ILLUMINATI",
      "url": "https://www.youtube.com/watch?v=YvJe9n4L5Aw",
      "matchDate": "2026-01-17",
      "startsAt": null,
      "dayNumber": 3,
      "groupNumber": null,
      "bracket": "LOSERS",
      "teams": [
        "CONSILIUM",
        "ILLUMINATI"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "LESTA",
    "year": 2026,
    "season": {
      "nameZh": "闪击积分联赛·第4期·第II赛季",
      "nameEn": "Blitz Point League — Part 4, Season II",
      "nameRu": "Лига Блиц Поинт, Часть 4 — Сезон II",
      "startDate": null
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第3天 / Day 3 · 败者组 / Lower Bracket · ZOMBI vs new era",
      "url": "https://www.youtube.com/watch?v=khGt6Bfj8Zw",
      "matchDate": "2026-04-18",
      "startsAt": null,
      "dayNumber": 3,
      "groupNumber": null,
      "bracket": "LOSERS",
      "teams": [
        "ZOMBI",
        "new era"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "LESTA",
    "year": 2026,
    "season": {
      "nameZh": "闪击积分联赛·第4期·第III赛季",
      "nameEn": "Blitz Point League — Part 4, Season III",
      "nameRu": "Лига Блиц Поинт, Часть 4 — Сезон III",
      "startDate": null
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第3天 / Day 3 · 败者组 / Lower Bracket · new era vs ZOMBI",
      "url": "https://www.youtube.com/watch?v=DApGlNljg60",
      "matchDate": "2026-07-10",
      "startsAt": null,
      "dayNumber": 3,
      "groupNumber": null,
      "bracket": "LOSERS",
      "teams": [
        "new era",
        "ZOMBI"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "LESTA",
    "year": 2026,
    "season": {
      "nameZh": "闪击积分联赛·第4期总决赛（Tanks Blitz × RuStore）",
      "nameEn": "Blitz Point League — Part 4 Finals (Tanks Blitz × RuStore)",
      "nameRu": "Лига Блиц Поинт, Часть 4 — Финальный турнир (Tanks Blitz × RuStore)",
      "startDate": null
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第3天 / Day 3 · ZOMBI vs new era",
      "url": "https://www.youtube.com/watch?v=xAWKGZ2dAts",
      "matchDate": "2026-09-04",
      "startsAt": null,
      "dayNumber": 3,
      "groupNumber": null,
      "bracket": "DEFAULT",
      "teams": [
        "ZOMBI",
        "new era"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2025,
    "season": {
      "nameZh": "闪击大师赛：新地平线",
      "nameEn": "Blitz Masters: New Horizons",
      "nameRu": "Blitz Masters: Новые горизонты",
      "startDate": null
    },
    "categoryType": "POINTS",
    "node": {
      "roundNumber": 3,
      "format": null
    },
    "replay": {
      "title": "积分赛 PYS · 第3轮 / Round 3 · 第4天 / Day 4 · OSLI vs BLOVE",
      "url": "https://www.youtube.com/watch?v=L_pe55WT8RA",
      "matchDate": "2025-03-09",
      "startsAt": null,
      "dayNumber": 4,
      "groupNumber": null,
      "bracket": null,
      "teams": [
        "OSLI",
        "BLOVE"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2025,
    "season": {
      "nameZh": "闪击大师赛：新地平线",
      "nameEn": "Blitz Masters: New Horizons",
      "nameRu": "Blitz Masters: Новые горизонты",
      "startDate": null
    },
    "categoryType": "QUARTER_FINALS",
    "node": {
      "roundNumber": null,
      "format": "ROUND_ROBIN"
    },
    "replay": {
      "title": "八强 TOP 8 · 循环赛 / Round Robin · 第1天 / Day 1 · LUV- vs BLOVE",
      "url": "https://www.youtube.com/watch?v=L2m45TldVTA",
      "matchDate": "2025-03-11",
      "startsAt": null,
      "dayNumber": 1,
      "groupNumber": null,
      "bracket": null,
      "teams": [
        "LUV-",
        "BLOVE"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2025,
    "season": {
      "nameZh": "闪击大师赛：新地平线",
      "nameEn": "Blitz Masters: New Horizons",
      "nameRu": "Blitz Masters: Новые горизонты",
      "startDate": null
    },
    "categoryType": "QUARTER_FINALS",
    "node": {
      "roundNumber": null,
      "format": "ROUND_ROBIN"
    },
    "replay": {
      "title": "八强 TOP 8 · 循环赛 / Round Robin · 第2天 / Day 2 · -RDX vs IMM0R",
      "url": "https://www.youtube.com/watch?v=KR_ZtYsi0jI",
      "matchDate": "2025-03-12",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": null,
      "bracket": null,
      "teams": [
        "-RDX",
        "IMM0R"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2025,
    "season": {
      "nameZh": "闪击大师赛：新地平线",
      "nameEn": "Blitz Masters: New Horizons",
      "nameRu": "Blitz Masters: Новые горизонты",
      "startDate": null
    },
    "categoryType": "QUARTER_FINALS",
    "node": {
      "roundNumber": null,
      "format": "ROUND_ROBIN"
    },
    "replay": {
      "title": "八强 TOP 8 · 循环赛 / Round Robin · 第3天 / Day 3 · APA vs LUV-",
      "url": "https://www.youtube.com/watch?v=xp395TEid_E",
      "matchDate": "2025-03-13",
      "startsAt": null,
      "dayNumber": 3,
      "groupNumber": null,
      "bracket": null,
      "teams": [
        "APA",
        "LUV-"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2025,
    "season": {
      "nameZh": "闪击大师赛：新地平线",
      "nameEn": "Blitz Masters: New Horizons",
      "nameRu": "Blitz Masters: Новые горизонты",
      "startDate": null
    },
    "categoryType": "QUARTER_FINALS",
    "node": {
      "roundNumber": null,
      "format": "ROUND_ROBIN"
    },
    "replay": {
      "title": "八强 TOP 8 · 循环赛 / Round Robin · 第4天 / Day 4 · AQVA vs APA",
      "url": "https://www.youtube.com/watch?v=Voc0UHRXKNA",
      "matchDate": "2025-03-14",
      "startsAt": null,
      "dayNumber": 4,
      "groupNumber": null,
      "bracket": null,
      "teams": [
        "AQVA",
        "APA"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2025,
    "season": {
      "nameZh": "闪击大师赛：新地平线",
      "nameEn": "Blitz Masters: New Horizons",
      "nameRu": "Blitz Masters: Новые горизонты",
      "startDate": null
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第1天 / Day 1 · 第1组 / Group 1 · AQVA vs IMM0R",
      "url": "https://www.youtube.com/watch?v=CUO58z3vr9U",
      "matchDate": "2025-03-15",
      "startsAt": null,
      "dayNumber": 1,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "AQVA",
        "IMM0R"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2025,
    "season": {
      "nameZh": "闪击大师赛：新地平线",
      "nameEn": "Blitz Masters: New Horizons",
      "nameRu": "Blitz Masters: Новые горизонты",
      "startDate": null
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · DEMOH vs IMM0R",
      "url": "https://www.youtube.com/watch?v=VWT0AE2RmWc",
      "matchDate": "2025-03-16",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "DEMOH",
        "IMM0R"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2025,
    "season": {
      "nameZh": "闪击大师赛：新地平线",
      "nameEn": "Blitz Masters: New Horizons",
      "nameRu": "Blitz Masters: Новые горизонты",
      "startDate": null
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · DEMOH vs IMM0R",
      "url": "https://www.youtube.com/watch?v=GU9PXRxLG2I",
      "matchDate": "2025-03-16",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "DEMOH",
        "IMM0R"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2025,
    "season": {
      "nameZh": "闪击大师赛：新地平线",
      "nameEn": "Blitz Masters: New Horizons",
      "nameRu": "Blitz Masters: Новые горизонты",
      "startDate": null
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · DEMOH vs IMM0R",
      "url": "https://www.youtube.com/watch?v=KTFGqgr9ee8",
      "matchDate": "2025-03-16",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "DEMOH",
        "IMM0R"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2025,
    "season": {
      "nameZh": "闪击大师赛：新地平线",
      "nameEn": "Blitz Masters: New Horizons",
      "nameRu": "Blitz Masters: Новые горизонты",
      "startDate": null
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · DEMOH vs IMM0R",
      "url": "https://www.youtube.com/watch?v=Fys8aexb8Qw",
      "matchDate": "2025-03-16",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "DEMOH",
        "IMM0R"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2025,
    "season": {
      "nameZh": "闪击钻石杯",
      "nameEn": "Blitz Diamond Cup",
      "nameRu": "Бриллиантовый кубок Blitz",
      "startDate": null
    },
    "categoryType": "QUARTER_FINALS",
    "node": {
      "roundNumber": null,
      "format": "ROUND_ROBIN"
    },
    "replay": {
      "title": "八强 TOP 8 · 循环赛 / Round Robin · 第1天 / Day 1 · DEMOH vs BLOVE",
      "url": "https://www.youtube.com/watch?v=3owGIRLMsdM",
      "matchDate": "2025-09-03",
      "startsAt": null,
      "dayNumber": 1,
      "groupNumber": null,
      "bracket": null,
      "teams": [
        "DEMOH",
        "BLOVE"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2025,
    "season": {
      "nameZh": "闪击钻石杯",
      "nameEn": "Blitz Diamond Cup",
      "nameRu": "Бриллиантовый кубок Blitz",
      "startDate": null
    },
    "categoryType": "QUARTER_FINALS",
    "node": {
      "roundNumber": null,
      "format": "ROUND_ROBIN"
    },
    "replay": {
      "title": "八强 TOP 8 · 循环赛 / Round Robin · 第2天 / Day 2 · -BPS- vs AQVA",
      "url": "https://www.youtube.com/watch?v=aeXtzIpyXMQ",
      "matchDate": "2025-09-04",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": null,
      "bracket": null,
      "teams": [
        "-BPS-",
        "AQVA"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2025,
    "season": {
      "nameZh": "闪击钻石杯·挑战者赛",
      "nameEn": "Blitz Diamond Cup — Challengers",
      "nameRu": "Бриллиантовый кубок Blitz — Турнир претендентов",
      "startDate": null
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第1天 / Day 1 · 第1组 / Group 1 · AFERA vs DSRT_",
      "url": "https://www.youtube.com/watch?v=OyMQG6OR27o",
      "matchDate": "2025-09-05",
      "startsAt": null,
      "dayNumber": 1,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "AFERA",
        "DSRT_"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2025,
    "season": {
      "nameZh": "闪击钻石杯",
      "nameEn": "Blitz Diamond Cup",
      "nameRu": "Бриллиантовый кубок Blitz",
      "startDate": null
    },
    "categoryType": "QUARTER_FINALS",
    "node": {
      "roundNumber": null,
      "format": "ROUND_ROBIN"
    },
    "replay": {
      "title": "八强 TOP 8 · 循环赛 / Round Robin · 第4天 / Day 4 · S-WIL vs SNTY",
      "url": "https://www.youtube.com/watch?v=RRSFC-CGgbQ",
      "matchDate": "2025-09-07",
      "startsAt": null,
      "dayNumber": 4,
      "groupNumber": null,
      "bracket": null,
      "teams": [
        "S-WIL",
        "SNTY"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2025,
    "season": {
      "nameZh": "闪击钻石杯",
      "nameEn": "Blitz Diamond Cup",
      "nameRu": "Бриллиантовый кубок Blitz",
      "startDate": null
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第1天 / Day 1 · 第1组 / Group 1 · DEMOH vs -BPS-",
      "url": "https://www.youtube.com/watch?v=guIa_J5h9bI",
      "matchDate": "2025-09-10",
      "startsAt": null,
      "dayNumber": 1,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "DEMOH",
        "-BPS-"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2025,
    "season": {
      "nameZh": "闪击钻石杯",
      "nameEn": "Blitz Diamond Cup",
      "nameRu": "Бриллиантовый кубок Blitz",
      "startDate": null
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · -BPS- vs DEMOH",
      "url": "https://www.youtube.com/watch?v=IdlBhevrwTs",
      "matchDate": "2025-09-11",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "-BPS-",
        "DEMOH"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2025,
    "season": {
      "nameZh": "闪击钻石杯",
      "nameEn": "Blitz Diamond Cup",
      "nameRu": "Бриллиантовый кубок Blitz",
      "startDate": null
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · -BPS- vs DEMOH",
      "url": "https://www.youtube.com/watch?v=uT5NdwISBGQ",
      "matchDate": "2025-09-11",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "-BPS-",
        "DEMOH"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2025,
    "season": {
      "nameZh": "闪击钻石杯",
      "nameEn": "Blitz Diamond Cup",
      "nameRu": "Бриллиантовый кубок Blitz",
      "startDate": null
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · -BPS- vs DEMOH",
      "url": "https://www.youtube.com/watch?v=KpYcmkxiP_0",
      "matchDate": "2025-09-11",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "-BPS-",
        "DEMOH"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2025,
    "season": {
      "nameZh": "闪击钻石杯",
      "nameEn": "Blitz Diamond Cup",
      "nameRu": "Бриллиантовый кубок Blitz",
      "startDate": null
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · -BPS- vs DEMOH",
      "url": "https://www.youtube.com/watch?v=FAzgtcD332k",
      "matchDate": "2025-09-11",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "-BPS-",
        "DEMOH"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "NA",
    "year": 2025,
    "season": {
      "nameZh": "闪击大师赛：新地平线",
      "nameEn": "Blitz Masters: New Horizons",
      "nameRu": "Blitz Masters: Новые горизонты",
      "startDate": null
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · -_X vs APX",
      "url": "https://www.youtube.com/watch?v=2Te4Q2hwn7g",
      "matchDate": "2025-03-16",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "-_X",
        "APX"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "NA",
    "year": 2025,
    "season": {
      "nameZh": "闪击大师赛：新地平线",
      "nameEn": "Blitz Masters: New Horizons",
      "nameRu": "Blitz Masters: Новые горизонты",
      "startDate": null
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · -_X vs APX",
      "url": "https://www.youtube.com/watch?v=1rPFxY60wXs",
      "matchDate": "2025-03-16",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "-_X",
        "APX"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "NA",
    "year": 2025,
    "season": {
      "nameZh": "闪击钻石杯",
      "nameEn": "Blitz Diamond Cup",
      "nameRu": "Бриллиантовый кубок Blitz",
      "startDate": null
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · REGI vs APX",
      "url": "https://www.youtube.com/watch?v=425kzgiiN4Q",
      "matchDate": "2025-09-11",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "REGI",
        "APX"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "ASIA",
    "year": 2025,
    "season": {
      "nameZh": "闪击大师赛：新地平线",
      "nameEn": "Blitz Masters: New Horizons",
      "nameRu": "Blitz Masters: Новые горизонты",
      "startDate": null
    },
    "categoryType": "POINTS",
    "node": {
      "roundNumber": 1,
      "format": null
    },
    "replay": {
      "title": "积分赛 PYS · 第1轮 / Round 1 · 第3天 / Day 3 · 第1组 / Group 1 · YSL vs -KSR-",
      "url": "https://www.youtube.com/watch?v=s1TUiB7oAgA",
      "matchDate": "2025-02-24",
      "startsAt": null,
      "dayNumber": 3,
      "groupNumber": 1,
      "bracket": null,
      "teams": [
        "YSL",
        "-KSR-"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "ASIA",
    "year": 2025,
    "season": {
      "nameZh": "闪击大师赛：新地平线",
      "nameEn": "Blitz Masters: New Horizons",
      "nameRu": "Blitz Masters: Новые горизонты",
      "startDate": null
    },
    "categoryType": "POINTS",
    "node": {
      "roundNumber": 2,
      "format": null
    },
    "replay": {
      "title": "积分赛 PYS · 第2轮 / Round 2 · 第3天 / Day 3 · 第2组 / Group 2 · 14582 vs RATS",
      "url": "https://www.youtube.com/watch?v=rM1wLYLEbPI",
      "matchDate": "2025-03-02",
      "startsAt": null,
      "dayNumber": 3,
      "groupNumber": 2,
      "bracket": null,
      "teams": [
        "14582",
        "RATS"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "ASIA",
    "year": 2025,
    "season": {
      "nameZh": "闪击大师赛：新地平线",
      "nameEn": "Blitz Masters: New Horizons",
      "nameRu": "Blitz Masters: Новые горизонты",
      "startDate": null
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强 TOP 4 · 第2天 / Day 2 · 第1组 / Group 1 · YSL vs ERZ",
      "url": "https://www.youtube.com/watch?v=wVUQW5Acf74",
      "matchDate": "2025-03-16",
      "startsAt": null,
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "YSL",
        "ERZ"
      ],
      "perspective": "OBSERVER"
    }
  }
]$entries$::jsonb;
    existing_videos jsonb;
    event jsonb;
    item jsonb;
    event_video_ids text[];
    video_id text;
    seed_season_id bigint;
    seed_category_id bigint;
    seed_root_id bigint;
    matched_seasons integer;
    existing_owner_matches boolean;
    added integer;
BEGIN
    -- Acquire before row locks, as normal writes lock the season before changing its descendants.
    -- Ordinary readers remain available while the small one-time import runs.
    LOCK TABLE tournament_broadcast_season IN EXCLUSIVE MODE;
    SELECT coalesce(jsonb_agg(jsonb_build_object('videoId', identity.video_id, 'seasonId', season.id,
            'server', season.server, 'year', season.year)), '[]'::jsonb)
    INTO existing_videos
    FROM tournament_broadcast_replay existing
    JOIN tournament_broadcast_node node ON node.id = existing.node_id
    JOIN tournament_broadcast_category category ON category.id = node.category_id
    JOIN tournament_broadcast_season season ON season.id = category.season_id
    CROSS JOIN LATERAL (
        SELECT CASE
            WHEN existing.url ~* '^https?://(www\.|m\.)?youtube\.com/watch\?'
                THEN substring(substring(split_part(existing.url, '#', 1) from '^[^?]*\?(.*)$')
                        from '(?:^|&)v=([A-Za-z0-9_-]{11})(?:&|$)')
            WHEN existing.url ~* '^https?://(www\.|m\.)?youtube\.com/live/'
                THEN substring(existing.url from '/live/([A-Za-z0-9_-]{11})(?:[/?#]|$)')
            WHEN existing.url ~* '^https?://(www\.)?youtu\.be/'
                THEN substring(existing.url from '://[^/]+/([A-Za-z0-9_-]{11})(?:[/?#]|$)')
        END AS video_id
    ) identity
    WHERE identity.video_id IS NOT NULL;

    FOR event IN SELECT DISTINCT jsonb_build_object('server', value->'server', 'year', value->'year', 'season', value->'season')
            FROM jsonb_array_elements(source_rows) LOOP
        added := 0;
        SELECT array_agg(substring(candidate->'replay'->>'url' from '[?&]v=([A-Za-z0-9_-]{11})(?:[&#]|$)'))
        INTO event_video_ids FROM jsonb_array_elements(source_rows) candidate
        WHERE candidate->'server' = event->'server' AND candidate->'year' = event->'year' AND candidate->'season' = event->'season';

        -- Existing video ownership outranks default names, including renamed administrator seasons.
        SELECT count(DISTINCT (existing->>'seasonId')::bigint), min((existing->>'seasonId')::bigint),
                bool_and(existing->'server' = event->'server' AND existing->'year' = event->'year')
        INTO matched_seasons, seed_season_id, existing_owner_matches
        FROM jsonb_array_elements(existing_videos) existing WHERE existing->>'videoId' = ANY(event_video_ids);
        IF matched_seasons > 1 OR (matched_seasons = 1 AND NOT existing_owner_matches) THEN
            RAISE WARNING 'Broadcast seed V43 skipped event %: conflicting existing video ownership', event->'season'->>'nameEn';
            CONTINUE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM unnest(event_video_ids) candidate
                WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(existing_videos) existing WHERE existing->>'videoId' = candidate)) THEN
            CONTINUE;
        END IF;
        IF matched_seasons = 0 THEN
            SELECT count(*), min(id) INTO matched_seasons, seed_season_id
            FROM tournament_broadcast_season
            WHERE server = event->>'server' AND year = (event->>'year')::integer
                AND (btrim(name_zh) = event->'season'->>'nameZh' OR btrim(name_en) = event->'season'->>'nameEn'
                    OR btrim(name_zh) = event->'season'->>'nameEn'
                    -- Original Lesta defaults used the same Russian name in all three fields.
                    OR (name_zh = event->'season'->>'nameRu' AND name_en = event->'season'->>'nameRu'
                        AND name_ru = event->'season'->>'nameRu'));
        END IF;
        IF matched_seasons > 1 THEN
            RAISE WARNING 'Broadcast seed V43 skipped event %: ambiguous default season names', event->'season'->>'nameEn';
            CONTINUE;
        END IF;
        IF matched_seasons = 0 THEN
            INSERT INTO tournament_broadcast_season(server, year, name_zh, name_en, name_ru, start_date, created_at, version)
            VALUES (event->>'server', (event->>'year')::integer, event->'season'->>'nameZh', event->'season'->>'nameEn',
                    event->'season'->>'nameRu', (event->'season'->>'startDate')::date, now(), 0) RETURNING id INTO seed_season_id;
        ELSE
            PERFORM id FROM tournament_broadcast_season WHERE id = seed_season_id FOR UPDATE;
        END IF;

        FOR item IN SELECT value FROM jsonb_array_elements(source_rows)
                WHERE value->'server' = event->'server' AND value->'year' = event->'year' AND value->'season' = event->'season' LOOP
            video_id := substring(item->'replay'->>'url' from '[?&]v=([A-Za-z0-9_-]{11})(?:[&#]|$)');
            IF EXISTS (SELECT 1 FROM jsonb_array_elements(existing_videos) existing WHERE existing->>'videoId' = video_id) THEN CONTINUE; END IF;
            INSERT INTO tournament_broadcast_category(season_id, type) VALUES (seed_season_id, item->>'categoryType')
            ON CONFLICT (season_id, type) DO NOTHING;
            SELECT id INTO seed_category_id FROM tournament_broadcast_category
                WHERE season_id = seed_season_id AND type = item->>'categoryType';
            INSERT INTO tournament_broadcast_node(category_id, root_key, round_number, format)
            VALUES (seed_category_id, coalesce((item->'node'->>'roundNumber')::integer, 0),
                    (item->'node'->>'roundNumber')::integer, item->'node'->>'format')
            ON CONFLICT (category_id, root_key) DO NOTHING;
            SELECT id INTO seed_root_id FROM tournament_broadcast_node
                WHERE category_id = seed_category_id AND root_key = coalesce((item->'node'->>'roundNumber')::integer, 0)
                    AND format IS NOT DISTINCT FROM (item->'node'->>'format');
            IF seed_root_id IS NULL THEN
                RAISE WARNING 'Broadcast seed V43 skipped video %: existing root format differs', video_id;
                CONTINUE;
            END IF;
            INSERT INTO tournament_broadcast_replay(node_id, title, url, match_date, match_starts_at, day_number,
                    group_number, bracket, teams, perspective, cover_id, created_at)
            VALUES (seed_root_id, item->'replay'->>'title', item->'replay'->>'url', (item->'replay'->>'matchDate')::date,
                    (item->'replay'->>'startsAt')::timestamptz, (item->'replay'->>'dayNumber')::integer,
                    (item->'replay'->>'groupNumber')::integer, item->'replay'->>'bracket', item->'replay'->'teams', item->'replay'->>'perspective', NULL, now());
            existing_videos := existing_videos || jsonb_build_array(jsonb_build_object('videoId', video_id,
                    'seasonId', seed_season_id, 'server', event->'server', 'year', event->'year'));
            added := added + 1;
        END LOOP;
        IF added > 0 THEN UPDATE tournament_broadcast_season SET version = version + 1 WHERE id = seed_season_id; END IF;
    END LOOP;
END $seed$;
