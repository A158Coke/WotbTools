// GENERATED FILE - DO NOT EDIT MANUALLY. Source: contracts/http/openapi.yaml
export default {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$ref": "#/$defs/BattlePlaybackDataset",
  "$defs": {
    "TournamentEvent": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "version",
        "year",
        "region",
        "season",
        "roundCount",
        "daysPerRound",
        "dayLabels",
        "configLocked"
      ],
      "properties": {
        "id": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "version": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "year": {
          "type": "integer",
          "minimum": 2000,
          "maximum": 2100
        },
        "region": {
          "type": "string",
          "enum": [
            "CN",
            "ASIA",
            "EU",
            "NA"
          ]
        },
        "season": {
          "type": "string",
          "enum": [
            "SPRING",
            "SUMMER",
            "AUTUMN",
            "WINTER",
            "FIRE_CUP"
          ]
        },
        "roundCount": {
          "type": "integer",
          "minimum": 4,
          "maximum": 5
        },
        "daysPerRound": {
          "type": "integer",
          "minimum": 2,
          "maximum": 3
        },
        "dayLabels": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "configLocked": {
          "type": "boolean"
        }
      }
    },
    "TournamentCreateRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "year",
        "region",
        "season",
        "roundCount",
        "daysPerRound",
        "dayLabels"
      ],
      "properties": {
        "year": {
          "type": "integer",
          "minimum": 2000,
          "maximum": 2100
        },
        "region": {
          "type": "string",
          "enum": [
            "CN",
            "ASIA",
            "EU",
            "NA"
          ]
        },
        "season": {
          "type": "string",
          "enum": [
            "SPRING",
            "SUMMER",
            "AUTUMN",
            "WINTER",
            "FIRE_CUP"
          ]
        },
        "roundCount": {
          "type": "integer",
          "minimum": 4,
          "maximum": 5
        },
        "daysPerRound": {
          "type": "integer",
          "minimum": 2,
          "maximum": 3
        },
        "dayLabels": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    },
    "TournamentUpdateRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "expectedVersion",
        "year",
        "region",
        "season",
        "roundCount",
        "daysPerRound",
        "dayLabels"
      ],
      "properties": {
        "expectedVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "year": {
          "type": "integer",
          "minimum": 2000,
          "maximum": 2100
        },
        "region": {
          "type": "string",
          "enum": [
            "CN",
            "ASIA",
            "EU",
            "NA"
          ]
        },
        "season": {
          "type": "string",
          "enum": [
            "SPRING",
            "SUMMER",
            "AUTUMN",
            "WINTER",
            "FIRE_CUP"
          ]
        },
        "roundCount": {
          "type": "integer",
          "minimum": 4,
          "maximum": 5
        },
        "daysPerRound": {
          "type": "integer",
          "minimum": 2,
          "maximum": 3
        },
        "dayLabels": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    },
    "TournamentRankPoints": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "rank",
        "points"
      ],
      "properties": {
        "rank": {
          "type": "integer",
          "minimum": 1,
          "maximum": 5
        },
        "points": {
          "type": "integer",
          "minimum": 0,
          "maximum": 1000000
        }
      }
    },
    "TournamentRuleDay": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "dayNumber",
        "points"
      ],
      "properties": {
        "dayNumber": {
          "type": "integer",
          "minimum": 1,
          "maximum": 3
        },
        "points": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/TournamentRankPoints"
          }
        }
      }
    },
    "TournamentRoundRule": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "roundNumber",
        "rulesVersion",
        "complete",
        "locked",
        "days"
      ],
      "properties": {
        "roundNumber": {
          "type": "integer",
          "minimum": 1,
          "maximum": 5
        },
        "rulesVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "complete": {
          "type": "boolean"
        },
        "locked": {
          "type": "boolean"
        },
        "days": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/TournamentRuleDay"
          }
        }
      }
    },
    "TournamentConfig": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "event",
        "rounds",
        "clans"
      ],
      "properties": {
        "event": {
          "$ref": "#/$defs/TournamentEvent"
        },
        "rounds": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/TournamentRoundRule"
          }
        },
        "clans": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    },
    "TournamentRuleRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "expectedEventVersion",
        "expectedRulesVersion",
        "days"
      ],
      "properties": {
        "expectedEventVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "expectedRulesVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "days": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/TournamentRuleDay"
          }
        }
      }
    },
    "TournamentTeam": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "clanTag",
        "rank"
      ],
      "properties": {
        "clanTag": {
          "type": "string",
          "minLength": 1,
          "maxLength": 32
        },
        "rank": {
          "type": "integer",
          "minimum": 1,
          "maximum": 5
        }
      }
    },
    "TournamentGroup": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "groupNumber",
        "evidenceId",
        "imageHash",
        "teams"
      ],
      "properties": {
        "groupNumber": {
          "type": "integer",
          "minimum": 1,
          "maximum": 10000
        },
        "evidenceId": {
          "type": "string",
          "format": "uuid"
        },
        "imageHash": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "teams": {
          "type": "array",
          "minItems": 3,
          "maxItems": 5,
          "items": {
            "$ref": "#/$defs/TournamentTeam"
          }
        }
      }
    },
    "TournamentIncomingGroup": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "groupNumber",
        "evidenceId",
        "imageHash",
        "teams",
        "duplicateAction",
        "complete"
      ],
      "properties": {
        "groupNumber": {
          "type": "integer",
          "minimum": 1,
          "maximum": 10000
        },
        "evidenceId": {
          "type": "string",
          "format": "uuid"
        },
        "imageHash": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "teams": {
          "type": "array",
          "minItems": 3,
          "maxItems": 5,
          "items": {
            "$ref": "#/$defs/TournamentTeam"
          }
        },
        "duplicateAction": {
          "type": "string",
          "enum": [
            "ERROR",
            "REPLACE",
            "SKIP"
          ]
        },
        "complete": {
          "type": "boolean"
        }
      }
    },
    "TournamentVersions": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "expectedEventVersion",
        "expectedDayVersion"
      ],
      "properties": {
        "expectedEventVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "expectedDayVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        }
      }
    },
    "TournamentExpectedGroupsRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "expectedEventVersion",
        "expectedDayVersion",
        "expectedGroupCount"
      ],
      "properties": {
        "expectedEventVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "expectedDayVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "expectedGroupCount": {
          "type": "integer",
          "minimum": 1,
          "maximum": 10000
        }
      }
    },
    "TournamentDraftRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "expectedEventVersion",
        "expectedDayVersion",
        "expectedRulesVersion",
        "groups",
        "confirmedNewClans"
      ],
      "properties": {
        "expectedEventVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "expectedDayVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "expectedRulesVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "groups": {
          "type": "array",
          "maxItems": 10000,
          "items": {
            "$ref": "#/$defs/TournamentIncomingGroup"
          }
        },
        "confirmedNewClans": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    },
    "TournamentFinalizeRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "expectedEventVersion",
        "expectedDayVersion",
        "expectedRulesVersion",
        "idempotencyKey"
      ],
      "properties": {
        "expectedEventVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "expectedDayVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "expectedRulesVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "idempotencyKey": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        }
      }
    },
    "TournamentCorrectionRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "expectedEventVersion",
        "expectedDayVersion",
        "expectedGroupCount",
        "reason"
      ],
      "properties": {
        "expectedEventVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "expectedDayVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "expectedGroupCount": {
          "type": "integer",
          "minimum": 1,
          "maximum": 10000
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      }
    },
    "TournamentClearRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "expectedEventVersion",
        "roundNumber",
        "dayNumber",
        "clanTag",
        "reason",
        "restore"
      ],
      "properties": {
        "expectedEventVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "roundNumber": {
          "type": "integer",
          "minimum": 1,
          "maximum": 5
        },
        "dayNumber": {
          "type": [
            "integer",
            "null"
          ]
        },
        "clanTag": {
          "type": "string"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        },
        "restore": {
          "type": "boolean"
        }
      }
    },
    "TournamentDeleteRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "expectedVersion",
        "confirm"
      ],
      "properties": {
        "expectedVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "confirm": {
          "type": "boolean",
          "const": true
        }
      }
    },
    "TournamentDayPoints": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "dayNumber",
        "points"
      ],
      "properties": {
        "dayNumber": {
          "type": "integer",
          "minimum": 1,
          "maximum": 3
        },
        "points": {
          "type": [
            "integer",
            "null"
          ],
          "format": "int64",
          "minimum": 0
        }
      }
    },
    "TournamentRoundPoints": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "roundNumber",
        "totalPoints",
        "days"
      ],
      "properties": {
        "roundNumber": {
          "type": "integer",
          "minimum": 1,
          "maximum": 5
        },
        "totalPoints": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "days": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/TournamentDayPoints"
          }
        }
      }
    },
    "TournamentStandingRow": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "rank",
        "clanTag",
        "totalPoints",
        "rounds"
      ],
      "properties": {
        "rank": {
          "type": "integer",
          "minimum": 1
        },
        "clanTag": {
          "type": "string"
        },
        "totalPoints": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "rounds": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/TournamentRoundPoints"
          }
        }
      }
    },
    "TournamentStandingDay": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "roundNumber",
        "dayNumber",
        "label",
        "published"
      ],
      "properties": {
        "roundNumber": {
          "type": "integer",
          "minimum": 1,
          "maximum": 5
        },
        "dayNumber": {
          "type": "integer",
          "minimum": 1,
          "maximum": 3
        },
        "label": {
          "type": "string"
        },
        "published": {
          "type": "boolean"
        }
      }
    },
    "TournamentStandings": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "event",
        "days",
        "rows"
      ],
      "properties": {
        "event": {
          "$ref": "#/$defs/TournamentEvent"
        },
        "days": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/TournamentStandingDay"
          }
        },
        "rows": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/TournamentStandingRow"
          }
        }
      }
    },
    "TournamentDayView": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "eventId",
        "roundNumber",
        "dayNumber",
        "eventVersion",
        "rulesVersion",
        "version",
        "status",
        "expectedGroupCount",
        "groups",
        "published",
        "standings"
      ],
      "properties": {
        "eventId": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "roundNumber": {
          "type": "integer",
          "minimum": 1,
          "maximum": 5
        },
        "dayNumber": {
          "type": "integer",
          "minimum": 1,
          "maximum": 3
        },
        "eventVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "rulesVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "version": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "status": {
          "type": "string",
          "enum": [
            "EMPTY",
            "DRAFT",
            "FINALIZED",
            "CORRECTION"
          ]
        },
        "expectedGroupCount": {
          "type": [
            "integer",
            "null"
          ]
        },
        "groups": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/TournamentGroup"
          }
        },
        "published": {
          "type": "boolean"
        },
        "standings": {
          "$ref": "#/$defs/TournamentStandings"
        }
      }
    },
    "TournamentRecognitionPermit": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "permit",
        "expiresAt",
        "evidenceId",
        "imageHash"
      ],
      "properties": {
        "permit": {
          "type": "string"
        },
        "expiresAt": {
          "type": "string",
          "format": "date-time"
        },
        "evidenceId": {
          "type": "string",
          "format": "uuid"
        },
        "imageHash": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        }
      }
    },
    "TournamentRecognizedTeam": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "clanTag",
        "rank",
        "rankText"
      ],
      "properties": {
        "clanTag": {
          "type": "string"
        },
        "rank": {
          "type": [
            "integer",
            "null"
          ]
        },
        "rankText": {
          "type": "string"
        }
      }
    },
    "TournamentRecognitionResult": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "groupNumber",
        "teams",
        "complete",
        "issues",
        "imageHash"
      ],
      "properties": {
        "groupNumber": {
          "type": [
            "integer",
            "null"
          ]
        },
        "teams": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/TournamentRecognizedTeam"
          }
        },
        "complete": {
          "type": "boolean"
        },
        "issues": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "imageHash": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        }
      }
    },
    "TournamentAudit": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "action",
        "actor",
        "reason",
        "roundNumber",
        "dayNumber",
        "createdAt",
        "before",
        "after"
      ],
      "properties": {
        "id": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "action": {
          "type": "string"
        },
        "actor": {
          "type": "string"
        },
        "reason": {
          "type": [
            "string",
            "null"
          ]
        },
        "roundNumber": {
          "type": [
            "integer",
            "null"
          ]
        },
        "dayNumber": {
          "type": [
            "integer",
            "null"
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "before": {
          "type": "object",
          "additionalProperties": true
        },
        "after": {
          "type": "object",
          "additionalProperties": true
        }
      }
    },
    "HundredCreateResult": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "status"
      ],
      "properties": {
        "id": {
          "type": "integer",
          "format": "int64"
        },
        "status": {
          "type": "string",
          "enum": [
            "PENDING"
          ]
        }
      }
    },
    "HundredSubmissionSummary": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "vehicleId",
        "vehicleName",
        "status",
        "claimedAverageDamage",
        "claimedBattleCount"
      ],
      "properties": {
        "id": {
          "type": "integer",
          "format": "int64"
        },
        "vehicleId": {
          "type": "integer",
          "format": "int64"
        },
        "vehicleName": {
          "type": "string"
        },
        "status": {
          "type": "string",
          "enum": [
            "PENDING",
            "CURRENT",
            "SUPERSEDED",
            "REJECTED",
            "CANCELLED",
            "DELETED"
          ]
        },
        "claimedAverageDamage": {
          "type": "integer"
        },
        "claimedBattleCount": {
          "type": "integer"
        },
        "approvedAverageDamage": {
          "type": [
            "integer",
            "null"
          ]
        },
        "approvedBattleCount": {
          "type": [
            "integer",
            "null"
          ]
        },
        "submittedAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "approvedAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "rejectReason": {
          "type": [
            "string",
            "null"
          ]
        },
        "rejectReasonText": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    },
    "HundredUserStatus": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "current",
        "pending",
        "rejected"
      ],
      "properties": {
        "current": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/HundredSubmissionSummary"
          }
        },
        "pending": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/HundredSubmissionSummary"
          }
        },
        "rejected": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/HundredSubmissionSummary"
          }
        }
      }
    },
    "HundredLeaderboardItem": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "rank",
        "vehicleId",
        "vehicleName",
        "nickname",
        "approvedAverageDamage",
        "approvedBattleCount"
      ],
      "properties": {
        "id": {
          "type": "integer",
          "format": "int64"
        },
        "rank": {
          "type": [
            "integer",
            "null"
          ]
        },
        "vehicleId": {
          "type": "integer",
          "format": "int64"
        },
        "vehicleName": {
          "type": "string"
        },
        "nickname": {
          "type": "string"
        },
        "approvedAverageDamage": {
          "type": "integer"
        },
        "approvedBattleCount": {
          "type": "integer"
        },
        "approvedAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        }
      }
    },
    "HundredLeaderboardPage": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "items",
        "page",
        "size",
        "totalItems",
        "totalPages"
      ],
      "properties": {
        "vehicleId": {
          "type": [
            "integer",
            "null"
          ],
          "format": "int64"
        },
        "vehicleName": {
          "type": [
            "string",
            "null"
          ]
        },
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/HundredLeaderboardItem"
          }
        },
        "page": {
          "type": "integer"
        },
        "size": {
          "type": "integer"
        },
        "totalItems": {
          "type": "integer",
          "format": "int64"
        },
        "totalPages": {
          "type": "integer"
        }
      }
    },
    "HundredAdminListItem": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "status",
        "vehicleId",
        "vehicleName",
        "wotbServer",
        "wotbAccountId",
        "nicknameSnapshot"
      ],
      "properties": {
        "id": {
          "type": "integer",
          "format": "int64"
        },
        "status": {
          "type": "string"
        },
        "vehicleId": {
          "type": "integer",
          "format": "int64"
        },
        "vehicleName": {
          "type": "string"
        },
        "wotbServer": {
          "type": "string",
          "enum": [
            "CN",
            "ASIA",
            "EU",
            "NA"
          ]
        },
        "wotbAccountId": {
          "type": "integer",
          "format": "int64"
        },
        "nicknameSnapshot": {
          "type": "string"
        },
        "approvedAverageDamage": {
          "type": [
            "integer",
            "null"
          ]
        },
        "approvedBattleCount": {
          "type": [
            "integer",
            "null"
          ]
        },
        "replayParseOk": {
          "type": "boolean"
        },
        "replayGameIdMatch": {
          "type": "boolean"
        },
        "replayVehicleMatch": {
          "type": "boolean"
        },
        "replayDistinctBattles": {
          "type": "boolean"
        },
        "submittedAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "approvedAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "rejectReason": {
          "type": [
            "string",
            "null"
          ]
        },
        "deleteReason": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    },
    "HundredAdminPage": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "items",
        "page",
        "size",
        "totalItems",
        "totalPages"
      ],
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/HundredAdminListItem"
          }
        },
        "page": {
          "type": "integer"
        },
        "size": {
          "type": "integer"
        },
        "totalItems": {
          "type": "integer",
          "format": "int64"
        },
        "totalPages": {
          "type": "integer"
        }
      }
    },
    "HundredAdminDetail": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "status",
        "vehicleId",
        "vehicleName",
        "wotbServer",
        "wotbAccountId",
        "nicknameSnapshot",
        "claimedAverageDamage",
        "claimedBattleCount",
        "replayParseOk",
        "replayGameIdMatch",
        "replayVehicleMatch",
        "replayDistinctBattles"
      ],
      "properties": {
        "id": {
          "type": "integer",
          "format": "int64"
        },
        "status": {
          "type": "string",
          "enum": [
            "PENDING",
            "CURRENT",
            "SUPERSEDED",
            "REJECTED",
            "CANCELLED",
            "DELETED"
          ]
        },
        "vehicleId": {
          "type": "integer",
          "format": "int64"
        },
        "vehicleName": {
          "type": "string"
        },
        "wotbServer": {
          "type": "string",
          "enum": [
            "CN",
            "ASIA",
            "EU",
            "NA"
          ]
        },
        "wotbAccountId": {
          "type": "integer",
          "format": "int64"
        },
        "nicknameSnapshot": {
          "type": "string"
        },
        "claimedAverageDamage": {
          "type": "integer"
        },
        "claimedBattleCount": {
          "type": "integer"
        },
        "approvedAverageDamage": {
          "type": [
            "integer",
            "null"
          ]
        },
        "approvedBattleCount": {
          "type": [
            "integer",
            "null"
          ]
        },
        "proofScreenshot": {
          "type": [
            "string",
            "null"
          ]
        },
        "replayParseOk": {
          "type": "boolean"
        },
        "replayGameIdMatch": {
          "type": "boolean"
        },
        "replayVehicleMatch": {
          "type": "boolean"
        },
        "replayDistinctBattles": {
          "type": "boolean"
        },
        "submittedAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "approvedAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "approvedBy": {
          "type": [
            "string",
            "null"
          ]
        },
        "rejectedAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "rejectedBy": {
          "type": [
            "string",
            "null"
          ]
        },
        "rejectReason": {
          "type": [
            "string",
            "null"
          ]
        },
        "rejectReasonText": {
          "type": [
            "string",
            "null"
          ]
        },
        "cancelledAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "deletedAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "deletedBy": {
          "type": [
            "string",
            "null"
          ]
        },
        "deleteReason": {
          "type": [
            "string",
            "null"
          ]
        },
        "deleteReasonText": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    },
    "HundredReplayEvidence": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "slot",
        "originalFilename",
        "fileSize",
        "arenaId",
        "sha256",
        "createdAt"
      ],
      "properties": {
        "id": {
          "type": "integer",
          "format": "int64"
        },
        "slot": {
          "type": "integer",
          "minimum": 1,
          "maximum": 5
        },
        "originalFilename": {
          "type": "string"
        },
        "fileSize": {
          "type": "integer",
          "format": "int64"
        },
        "arenaId": {
          "type": "string"
        },
        "sha256": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "createdAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        }
      }
    },
    "HundredRejectRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "rejectReason"
      ],
      "properties": {
        "rejectReason": {
          "type": "string"
        },
        "rejectReasonText": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    },
    "HundredDeleteRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "deleteReason"
      ],
      "properties": {
        "deleteReason": {
          "type": "string"
        },
        "deleteReasonText": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    },
    "BulkDeleteModerationRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "ids",
        "reason"
      ],
      "properties": {
        "ids": {
          "type": "array",
          "items": {
            "type": "integer",
            "format": "int64"
          },
          "maxItems": 100
        },
        "reason": {
          "type": "string"
        },
        "reasonText": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    },
    "BulkDeleteRecordsRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "ids"
      ],
      "properties": {
        "ids": {
          "type": "array",
          "items": {
            "type": "integer",
            "format": "int64"
          },
          "maxItems": 100
        }
      }
    },
    "BulkDeleteItemResult": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "deleted"
      ],
      "properties": {
        "id": {
          "type": "integer",
          "format": "int64"
        },
        "deleted": {
          "type": "boolean"
        },
        "errorCode": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    },
    "BulkDeleteResult": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "requested",
        "deleted",
        "failed",
        "results"
      ],
      "properties": {
        "requested": {
          "type": "integer"
        },
        "deleted": {
          "type": "integer"
        },
        "failed": {
          "type": "integer"
        },
        "results": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/BulkDeleteItemResult"
          }
        }
      }
    },
    "UserProfile": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "keycloakUserId",
        "username",
        "wotbServer",
        "wotbAccountSource"
      ],
      "properties": {
        "id": {
          "type": "integer",
          "format": "int64"
        },
        "keycloakUserId": {
          "type": "string"
        },
        "displayName": {
          "type": [
            "string",
            "null"
          ]
        },
        "username": {
          "type": "string"
        },
        "wotbAccountId": {
          "type": [
            "integer",
            "null"
          ],
          "format": "int64"
        },
        "wotbNickname": {
          "type": [
            "string",
            "null"
          ]
        },
        "wotbServer": {
          "type": "string",
          "enum": [
            "CN",
            "ASIA",
            "EU",
            "NA"
          ]
        },
        "wotbAccountSource": {
          "type": "string",
          "enum": [
            "MANUAL",
            "WARGAMING"
          ]
        },
        "wotbAccountVerifiedAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        }
      }
    },
    "AdminUserListItem": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "keycloakUserId",
        "hasLocalProfile",
        "keycloakUserMissing"
      ],
      "properties": {
        "keycloakUserId": {
          "type": "string"
        },
        "keycloakUsername": {
          "type": [
            "string",
            "null"
          ]
        },
        "keycloakEmail": {
          "type": [
            "string",
            "null"
          ]
        },
        "keycloakEnabled": {
          "type": [
            "boolean",
            "null"
          ]
        },
        "profileId": {
          "type": [
            "integer",
            "null"
          ],
          "format": "int64"
        },
        "displayName": {
          "type": [
            "string",
            "null"
          ]
        },
        "wotbAccountId": {
          "type": [
            "integer",
            "null"
          ],
          "format": "int64"
        },
        "wotbNickname": {
          "type": [
            "string",
            "null"
          ]
        },
        "wotbServer": {
          "type": [
            "string",
            "null"
          ]
        },
        "profileCreatedAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "hasLocalProfile": {
          "type": "boolean"
        },
        "keycloakUserMissing": {
          "type": "boolean"
        }
      }
    },
    "AdminUserPage": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "items",
        "page",
        "size",
        "totalItems",
        "totalPages"
      ],
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/AdminUserListItem"
          }
        },
        "page": {
          "type": "integer"
        },
        "size": {
          "type": "integer"
        },
        "totalItems": {
          "type": "integer",
          "format": "int64"
        },
        "totalPages": {
          "type": "integer"
        }
      }
    },
    "DeleteUserResult": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "userId",
        "deleted"
      ],
      "properties": {
        "userId": {
          "type": "string"
        },
        "deleted": {
          "type": "boolean"
        },
        "errorCode": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    },
    "DeleteUsersResponse": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "requested",
        "deleted",
        "failed",
        "results"
      ],
      "properties": {
        "requested": {
          "type": "integer"
        },
        "deleted": {
          "type": "integer"
        },
        "failed": {
          "type": "integer"
        },
        "results": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/DeleteUserResult"
          }
        }
      }
    },
    "AiReviewRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "locale",
        "correlationId",
        "battle",
        "projection"
      ],
      "properties": {
        "locale": {
          "type": "string",
          "enum": [
            "zh-CN",
            "en-US",
            "ru-RU"
          ]
        },
        "correlationId": {
          "type": "string",
          "format": "uuid"
        },
        "battle": {
          "$ref": "#/$defs/AiReviewBattle"
        },
        "projection": {
          "$ref": "#/$defs/ClientAiReviewProjection"
        }
      }
    },
    "ClientAiReviewProjection": {
      "description": "WotbTools client canonical AI projection (frontend/src/replay-local/ai). Built from the pinned upstream Agent facets through WotbTools canonical replay facts, never the raw Agent DTO. Clocks are raw replay clocks in seconds; battle-relative time = rawClockSec - clock.battleStartRawClockSec. Only combatant entities appear. Evidence the engine does not provide is listed in unavailableEvidence.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "engine",
        "clock",
        "perspective",
        "participants",
        "observationWindows",
        "positions",
        "turrets",
        "prop3Health",
        "healthEvents",
        "damageNotices",
        "periods",
        "objectives",
        "limitations",
        "unavailableEvidence"
      ],
      "properties": {
        "engine": {
          "$ref": "#/$defs/AiProjectionEngine"
        },
        "clock": {
          "$ref": "#/$defs/AiProjectionClock"
        },
        "perspective": {
          "$ref": "#/$defs/AiProjectionPerspective"
        },
        "participants": {
          "type": "array",
          "maxItems": 64,
          "items": {
            "$ref": "#/$defs/AiProjectionParticipant"
          }
        },
        "observationWindows": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/AiProjectionObservationWindow"
          }
        },
        "positions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/AiProjectionSampleTrack"
          }
        },
        "turrets": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/AiProjectionSampleTrack"
          }
        },
        "prop3Health": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/AiProjectionProp3Health"
          }
        },
        "healthEvents": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/AiProjectionHealthEvent"
          }
        },
        "damageNotices": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/AiProjectionDamageNotice"
          }
        },
        "periods": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/AiProjectionPeriod"
          }
        },
        "objectives": {
          "$ref": "#/$defs/AiProjectionObjectives"
        },
        "limitations": {
          "description": "Capability-affecting limitations; non-empty means the timeline is limited.",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "unavailableEvidence": {
          "description": "Evidence classes the engine does not provide; consumers render them as unavailable, never as empty truth.",
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "PACKET_DECODE_COVERAGE",
              "SHOT_LIFECYCLE",
              "TARGETING",
              "AMMUNITION"
            ]
          }
        }
      }
    },
    "AiProjectionEngine": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "agentRelease",
        "agentCommit"
      ],
      "properties": {
        "agentRelease": {
          "type": "string"
        },
        "agentCommit": {
          "type": "string"
        }
      }
    },
    "AiProjectionClock": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "battleStartRawClockSec",
        "battleDurationSec",
        "estimated",
        "battleEndRawClockSec",
        "streamEndRawClockSec"
      ],
      "properties": {
        "battleStartRawClockSec": {
          "type": "number"
        },
        "battleDurationSec": {
          "type": "number"
        },
        "estimated": {
          "type": "boolean"
        },
        "battleEndRawClockSec": {
          "type": [
            "number",
            "null"
          ]
        },
        "streamEndRawClockSec": {
          "type": [
            "number",
            "null"
          ]
        }
      }
    },
    "AiProjectionPerspective": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "recorderAccountId",
        "perspectiveTeam",
        "recorderEntityIds",
        "winnerTeam"
      ],
      "properties": {
        "recorderAccountId": {
          "type": [
            "integer",
            "null"
          ],
          "format": "int64"
        },
        "perspectiveTeam": {
          "type": [
            "integer",
            "null"
          ]
        },
        "recorderEntityIds": {
          "type": "array",
          "items": {
            "type": "integer"
          }
        },
        "winnerTeam": {
          "type": [
            "integer",
            "null"
          ]
        }
      }
    },
    "AiProjectionParticipant": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "entityId",
        "accountId",
        "nickname",
        "team",
        "tankId",
        "recorder"
      ],
      "properties": {
        "entityId": {
          "type": "integer"
        },
        "accountId": {
          "type": "integer",
          "format": "int64"
        },
        "nickname": {
          "type": "string"
        },
        "team": {
          "type": "integer",
          "enum": [
            1,
            2
          ]
        },
        "tankId": {
          "type": "integer"
        },
        "recorder": {
          "type": "boolean"
        }
      }
    },
    "AiProjectionObservationWindow": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "entityId",
        "fromRawClockSec",
        "toRawClockSec",
        "materializationHp"
      ],
      "properties": {
        "entityId": {
          "type": "integer"
        },
        "fromRawClockSec": {
          "type": "number"
        },
        "toRawClockSec": {
          "type": [
            "number",
            "null"
          ]
        },
        "materializationHp": {
          "type": [
            "integer",
            "null"
          ]
        }
      }
    },
    "AiProjectionSampleTrack": {
      "description": "Raw observations of one entity, flat and clock-ordered. positions: [rawClockSec, x, y, z, hullYawRad] x N (unfiltered type-10 world poses). turrets: [rawClockSec, turretRelativeYawDeg] x N (prop2 coarse yaw).",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "entityId",
        "stride",
        "samples"
      ],
      "properties": {
        "entityId": {
          "type": "integer"
        },
        "stride": {
          "type": "integer",
          "enum": [
            2,
            5
          ]
        },
        "samples": {
          "type": "array",
          "items": {
            "type": "number"
          }
        }
      }
    },
    "AiProjectionProp3Health": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "entityId",
        "rawClockSec",
        "hpRaw"
      ],
      "properties": {
        "entityId": {
          "type": "integer"
        },
        "rawClockSec": {
          "type": "number"
        },
        "hpRaw": {
          "type": "integer",
          "minimum": 0,
          "maximum": 65535
        }
      }
    },
    "AiProjectionHealthEvent": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "entityId",
        "rawClockSec",
        "hpRaw",
        "sourceEntityId",
        "causeFlag"
      ],
      "properties": {
        "entityId": {
          "type": "integer"
        },
        "rawClockSec": {
          "type": "number"
        },
        "hpRaw": {
          "type": "integer",
          "minimum": 0,
          "maximum": 65535
        },
        "sourceEntityId": {
          "type": "integer"
        },
        "causeFlag": {
          "type": "integer"
        }
      }
    },
    "AiProjectionDamageNotice": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "rawClockSec",
        "kind",
        "envelopeEntityId",
        "attackerEntityId",
        "victimEntityId",
        "primaryResult",
        "secondaryResult"
      ],
      "properties": {
        "rawClockSec": {
          "type": "number"
        },
        "kind": {
          "type": "string",
          "enum": [
            "HIT",
            "UNDECODED_VARIANT",
            "SHORT_VARIANT"
          ]
        },
        "envelopeEntityId": {
          "type": "integer"
        },
        "attackerEntityId": {
          "type": "integer"
        },
        "victimEntityId": {
          "type": "integer"
        },
        "primaryResult": {
          "type": [
            "integer",
            "null"
          ]
        },
        "secondaryResult": {
          "type": [
            "integer",
            "null"
          ]
        }
      }
    },
    "AiProjectionPeriod": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "rawClockSec",
        "period"
      ],
      "properties": {
        "rawClockSec": {
          "type": "number"
        },
        "period": {
          "type": "integer"
        }
      }
    },
    "AiProjectionObjectives": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "supremacyPoints",
        "supremacyBases",
        "assaultObjectivePresent",
        "assaultBases"
      ],
      "properties": {
        "supremacyPoints": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "rawClockSec",
              "team",
              "points"
            ],
            "properties": {
              "rawClockSec": {
                "type": "number"
              },
              "team": {
                "type": "integer"
              },
              "points": {
                "type": "integer"
              }
            }
          }
        },
        "supremacyBases": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "rawClockSec",
              "baseId",
              "ownerTeam",
              "capturingTeam",
              "captureProgress"
            ],
            "properties": {
              "rawClockSec": {
                "type": "number"
              },
              "baseId": {
                "type": "string",
                "enum": [
                  "A",
                  "B",
                  "C",
                  "D"
                ]
              },
              "ownerTeam": {
                "type": [
                  "integer",
                  "null"
                ]
              },
              "capturingTeam": {
                "type": [
                  "integer",
                  "null"
                ]
              },
              "captureProgress": {
                "type": [
                  "integer",
                  "null"
                ]
              }
            }
          }
        },
        "assaultObjectivePresent": {
          "type": "boolean"
        },
        "assaultBases": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "rawClockSec",
              "captureProgress"
            ],
            "properties": {
              "rawClockSec": {
                "type": "number"
              },
              "captureProgress": {
                "type": "integer"
              }
            }
          }
        }
      }
    },
    "AiReviewBattle": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "players"
      ],
      "properties": {
        "arenaId": {
          "type": [
            "string",
            "null"
          ]
        },
        "winnerTeam": {
          "type": [
            "integer",
            "null"
          ]
        },
        "arenaBonusType": {
          "type": [
            "integer",
            "null"
          ]
        },
        "version": {
          "type": "string"
        },
        "mapName": {
          "type": "string"
        },
        "durationS": {
          "type": [
            "number",
            "null"
          ]
        },
        "startTime": {
          "type": [
            "integer",
            "null"
          ],
          "format": "int64"
        },
        "settlementStartTime": {
          "type": [
            "integer",
            "null"
          ],
          "format": "int64"
        },
        "settlementFinishReasonRaw": {
          "type": [
            "integer",
            "null"
          ]
        },
        "settlementDurationSec": {
          "type": [
            "number",
            "null"
          ]
        },
        "recorder": {
          "type": "string"
        },
        "recorderVehicle": {
          "type": "string"
        },
        "clientVersion": {
          "type": "string"
        },
        "rosterComplete": {
          "type": [
            "boolean",
            "null"
          ]
        },
        "players": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/AiReviewPlayerResult"
          }
        }
      }
    },
    "AiReviewPlayerResult": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "accountId",
        "team",
        "tankId",
        "nickname",
        "survived"
      ],
      "properties": {
        "accountId": {
          "type": "integer",
          "format": "int64"
        },
        "team": {
          "type": "integer"
        },
        "tankId": {
          "type": "integer",
          "format": "int64"
        },
        "nShots": {
          "type": "integer"
        },
        "nHitsDealt": {
          "type": "integer"
        },
        "nPenetrationsDealt": {
          "type": "integer"
        },
        "damageDealt": {
          "type": "integer"
        },
        "damageAssisted": {
          "type": "integer"
        },
        "damageReceived": {
          "type": "integer"
        },
        "nHitsReceived": {
          "type": "integer"
        },
        "nPenetrationsReceived": {
          "type": "integer"
        },
        "nEnemiesDamaged": {
          "type": "integer"
        },
        "kills": {
          "type": "integer"
        },
        "damageBlocked": {
          "type": "integer"
        },
        "victoryPointsEarned": {
          "type": "integer"
        },
        "victoryPointsSeized": {
          "type": "integer"
        },
        "survived": {
          "type": "boolean"
        },
        "xp": {
          "type": "integer"
        },
        "credits": {
          "type": "integer"
        },
        "nickname": {
          "type": "string"
        },
        "clan": {
          "type": "string"
        },
        "prebattleGroupId": {
          "type": [
            "integer",
            "null"
          ],
          "format": "int64"
        },
        "rank": {
          "type": [
            "integer",
            "null"
          ],
          "format": "int64"
        },
        "tankName": {
          "type": "string"
        },
        "contribution": {
          "type": [
            "number",
            "null"
          ]
        },
        "kast": {
          "type": [
            "number",
            "null"
          ]
        },
        "impact": {
          "type": [
            "number",
            "null"
          ]
        },
        "observedMaxHp": {
          "type": [
            "integer",
            "null"
          ]
        },
        "entryHpSource": {
          "type": [
            "string",
            "null"
          ]
        },
        "entryHp": {
          "type": [
            "integer",
            "null"
          ]
        },
        "tankTier": {
          "type": [
            "string",
            "integer",
            "null"
          ]
        },
        "tankType": {
          "type": "string"
        },
        "tankNation": {
          "type": "string"
        },
        "alphaDamage": {
          "type": [
            "string",
            "integer",
            "null"
          ]
        },
        "deathTimeMillis": {
          "type": "integer",
          "format": "int64"
        },
        "settlementResultEntityId": {
          "type": "integer",
          "format": "int64"
        },
        "settlementLifeTimeSec": {
          "type": "number"
        },
        "settlementKillerResultEntityId": {
          "type": [
            "integer",
            "null"
          ],
          "format": "int64"
        },
        "settlementDeathReasonRaw": {
          "type": [
            "integer",
            "null"
          ]
        },
        "killerAccountId": {
          "type": [
            "integer",
            "null"
          ],
          "format": "int64"
        },
        "survivalTimeSec": {
          "type": "number"
        },
        "raw": {
          "type": [
            "object",
            "null"
          ],
          "additionalProperties": {
            "type": "array",
            "items": {}
          }
        }
      }
    },
    "AiReviewStageEventPayload": {
      "type": "object",
      "additionalProperties": false
    },
    "AiReviewTokenEventPayload": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "delta"
      ],
      "properties": {
        "delta": {
          "type": "string"
        }
      }
    },
    "AiReviewErrorEventPayload": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "errorCode"
      ],
      "properties": {
        "id": {
          "type": [
            "string",
            "null"
          ]
        },
        "errorCode": {
          "$ref": "#/$defs/AiReviewErrorCode"
        }
      }
    },
    "AiReviewErrorCode": {
      "type": "string",
      "enum": [
        "AI_CANCELLED",
        "AI_NOT_CONFIGURED",
        "AI_INVALID_REQUEST",
        "AI_TIMEOUT",
        "AI_UPSTREAM_UNAVAILABLE",
        "AI_AUTHENTICATION_ERROR",
        "AI_RATE_LIMITED",
        "AI_CONTEXT_TOO_LARGE",
        "AI_EMPTY_RESPONSE",
        "AI_RESPONSE_INVALID",
        "AI_REVIEW_SCHEMA_FAILED",
        "AI_REVIEW_GROUNDING_FAILED",
        "AI_TIMELINE_UNUSABLE",
        "AI_PROMPT_MANDATORY_SECTION_TOO_LARGE"
      ]
    },
    "TeamAiReviewSummary": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "verdict",
        "primaryDiagnosis"
      ],
      "properties": {
        "verdict": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4000
        },
        "primaryDiagnosis": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4000
        }
      }
    },
    "TeamAiReviewEpisode": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "startSec",
        "endSec",
        "title",
        "analysis",
        "playerKeys"
      ],
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "startSec": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0
        },
        "endSec": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0
        },
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 240
        },
        "analysis": {
          "type": "string",
          "minLength": 1,
          "maxLength": 8000
        },
        "playerKeys": {
          "type": "array",
          "maxItems": 8,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          }
        }
      }
    },
    "TeamAiTrainingSuggestion": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "title",
        "content",
        "episodeId"
      ],
      "properties": {
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 240
        },
        "content": {
          "type": "string",
          "minLength": 1,
          "maxLength": 6000
        },
        "episodeId": {
          "type": [
            "string",
            "null"
          ],
          "maxLength": 64
        }
      }
    },
    "TeamAiReviewFocus": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "playerKey",
        "episodeId",
        "reason"
      ],
      "properties": {
        "playerKey": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "episodeId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2000
        }
      }
    },
    "TeamAiHighContributor": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "playerKey",
        "episodeId",
        "reason"
      ],
      "properties": {
        "playerKey": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "episodeId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2000
        }
      }
    },
    "TeamAiPlayerIdentity": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "playerKey",
        "displayName",
        "tankName"
      ],
      "properties": {
        "playerKey": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "displayName": {
          "type": "string",
          "maxLength": 240
        },
        "tankName": {
          "type": "string",
          "maxLength": 240
        }
      }
    },
    "TeamAiReviewResult": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "summary",
        "episodes",
        "trainingSuggestions",
        "reviewFocus",
        "highContributors"
      ],
      "properties": {
        "summary": {
          "$ref": "#/$defs/TeamAiReviewSummary"
        },
        "episodes": {
          "type": "array",
          "maxItems": 6,
          "items": {
            "$ref": "#/$defs/TeamAiReviewEpisode"
          }
        },
        "trainingSuggestions": {
          "type": "array",
          "maxItems": 12,
          "items": {
            "$ref": "#/$defs/TeamAiTrainingSuggestion"
          }
        },
        "reviewFocus": {
          "type": "array",
          "maxItems": 2,
          "items": {
            "$ref": "#/$defs/TeamAiReviewFocus"
          }
        },
        "highContributors": {
          "type": "array",
          "maxItems": 2,
          "items": {
            "$ref": "#/$defs/TeamAiHighContributor"
          }
        }
      }
    },
    "AiReviewDonePayload": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "analysis",
        "preBattleSection",
        "capability",
        "teamReview",
        "teamPlayers"
      ],
      "properties": {
        "analysis": {
          "type": [
            "string",
            "null"
          ]
        },
        "preBattleSection": {
          "type": [
            "string",
            "null"
          ]
        },
        "capability": {
          "type": [
            "string",
            "null"
          ],
          "enum": [
            "AVAILABLE",
            "AVAILABLE_WITH_LIMITED_TIMELINE",
            "UNAVAILABLE",
            null
          ]
        },
        "teamReview": {
          "oneOf": [
            {
              "$ref": "#/$defs/TeamAiReviewResult"
            },
            {
              "type": "null"
            }
          ]
        },
        "teamPlayers": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/TeamAiPlayerIdentity"
          }
        }
      }
    },
    "PlaybackCapability": {
      "type": "string",
      "enum": [
        "FULL",
        "PARTIAL"
      ]
    },
    "PlaybackConfidence": {
      "type": "string",
      "enum": [
        "HIGH",
        "MEDIUM",
        "LOW",
        "UNKNOWN"
      ]
    },
    "PositionKnowledge": {
      "type": "string",
      "enum": [
        "OBSERVED",
        "LAST_KNOWN"
      ]
    },
    "OrientationKnowledge": {
      "type": "string",
      "enum": [
        "CURRENT",
        "LAST_KNOWN"
      ]
    },
    "HealthKnowledge": {
      "type": "string",
      "enum": [
        "CURRENT",
        "LAST_KNOWN"
      ]
    },
    "PlaybackLifeState": {
      "type": "string",
      "enum": [
        "ALIVE",
        "DESTROYED"
      ]
    },
    "BattlePlaybackDataset": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "durationSec",
        "mapCode",
        "friendlyTeam",
        "recorderAccountId",
        "vehicles",
        "events",
        "pointsSamples",
        "limitations",
        "capability",
        "arenaBonusType"
      ],
      "properties": {
        "durationSec": {
          "type": "number",
          "minimum": 0
        },
        "mapCode": {
          "type": [
            "string",
            "null"
          ]
        },
        "friendlyTeam": {
          "type": [
            "integer",
            "null"
          ],
          "enum": [
            1,
            2,
            null
          ]
        },
        "recorderAccountId": {
          "type": [
            "integer",
            "null"
          ]
        },
        "vehicles": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/VehiclePlaybackTrack"
          }
        },
        "events": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/BattleEvent"
          }
        },
        "pointsSamples": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/PointsSample"
          }
        },
        "assaultObjectivePresent": {
          "type": "boolean",
          "description": "Proven single-base objective presence, independent of capture progress. Requires the objective family to emit fields beyond the bare initialization pair (1=1,2=1 + 1=2,2=1), which ordinary battles also broadcast. Missing on older artifacts means unknown (no static Assault objective rendering). Not derived from arenaBonusType."
        },
        "baseStates": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/BaseStateTransition"
          }
        },
        "limitations": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "capability": {
          "$ref": "#/$defs/PlaybackCapability"
        },
        "arenaBonusType": {
          "type": [
            "integer",
            "null"
          ]
        }
      }
    },
    "VehiclePlaybackTrack": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "accountId",
        "playerName",
        "tankId",
        "tankName",
        "tankClass",
        "tankTier",
        "team",
        "friendly",
        "loadout",
        "positionSegments",
        "orientationSegments",
        "healthTransitions",
        "lifeTransitions",
        "damageLosses",
        "consumableTransitions",
        "moduleCrewTransitions"
      ],
      "properties": {
        "accountId": {
          "type": "integer"
        },
        "playerName": {
          "type": "string"
        },
        "tankId": {
          "type": "integer"
        },
        "tankName": {
          "type": "string"
        },
        "tankClass": {
          "type": "string"
        },
        "tankTier": {
          "type": [
            "integer",
            "null"
          ]
        },
        "team": {
          "type": "integer"
        },
        "friendly": {
          "type": [
            "boolean",
            "null"
          ]
        },
        "loadout": {
          "anyOf": [
            {
              "$ref": "#/$defs/VehicleBattleLoadout"
            },
            {
              "type": "null"
            }
          ]
        },
        "positionSegments": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/PositionSegment"
          }
        },
        "orientationSegments": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/OrientationSegment"
          }
        },
        "healthTransitions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/HealthTransition"
          }
        },
        "lifeTransitions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/LifeTransition"
          }
        },
        "damageLosses": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/DamageLoss"
          }
        },
        "consumableTransitions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/ConsumableTransition"
          }
        },
        "moduleCrewTransitions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/ModuleCrewTransition"
          }
        }
      }
    },
    "VehicleBattleLoadout": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "replayVersion",
        "consumables",
        "consumableWireCodes",
        "provisions",
        "provisionWireCodes",
        "equipmentIds",
        "confidence"
      ],
      "properties": {
        "replayVersion": {
          "type": [
            "string",
            "null"
          ]
        },
        "consumables": {
          "type": "array",
          "minItems": 3,
          "maxItems": 3,
          "items": {
            "type": [
              "string",
              "null"
            ]
          }
        },
        "consumableWireCodes": {
          "type": "array",
          "minItems": 3,
          "maxItems": 3,
          "items": {
            "type": [
              "integer",
              "null"
            ]
          }
        },
        "provisions": {
          "type": "array",
          "minItems": 3,
          "maxItems": 3,
          "items": {
            "type": [
              "string",
              "null"
            ]
          }
        },
        "provisionWireCodes": {
          "type": "array",
          "minItems": 3,
          "maxItems": 3,
          "items": {
            "type": [
              "integer",
              "null"
            ]
          }
        },
        "equipmentIds": {
          "type": "array",
          "minItems": 9,
          "maxItems": 9,
          "items": {
            "type": [
              "integer",
              "null"
            ]
          }
        },
        "confidence": {
          "$ref": "#/$defs/PlaybackConfidence"
        }
      }
    },
    "PositionSegment": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "startSec",
        "endSec",
        "knowledge",
        "interpolationAllowed",
        "samples"
      ],
      "properties": {
        "startSec": {
          "type": "number",
          "minimum": 0
        },
        "endSec": {
          "type": "number",
          "minimum": 0
        },
        "knowledge": {
          "$ref": "#/$defs/PositionKnowledge"
        },
        "interpolationAllowed": {
          "type": "boolean"
        },
        "samples": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/PositionSample"
          }
        }
      }
    },
    "PositionSample": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "timeSec",
        "x",
        "y"
      ],
      "properties": {
        "timeSec": {
          "type": "number",
          "minimum": 0
        },
        "x": {
          "type": "number"
        },
        "y": {
          "type": "number"
        }
      }
    },
    "OrientationSegment": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "startSec",
        "endSec",
        "knowledge",
        "samples"
      ],
      "properties": {
        "startSec": {
          "type": "number",
          "minimum": 0
        },
        "endSec": {
          "type": "number",
          "minimum": 0
        },
        "knowledge": {
          "$ref": "#/$defs/OrientationKnowledge"
        },
        "samples": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/OrientationSample"
          }
        }
      }
    },
    "OrientationSample": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "timeSec",
        "hullYawDeg",
        "turretRelativeYawDeg"
      ],
      "properties": {
        "timeSec": {
          "type": "number",
          "minimum": 0
        },
        "hullYawDeg": {
          "type": [
            "number",
            "null"
          ]
        },
        "turretRelativeYawDeg": {
          "type": [
            "number",
            "null"
          ]
        }
      }
    },
    "HealthTransition": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "timeSec",
        "currentHp",
        "knowledge",
        "source",
        "displayCapacityHp",
        "relativeFull",
        "confidence"
      ],
      "properties": {
        "timeSec": {
          "type": "number",
          "minimum": 0
        },
        "currentHp": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0
        },
        "knowledge": {
          "type": [
            "string",
            "null"
          ],
          "enum": [
            "CURRENT",
            "LAST_KNOWN",
            null
          ]
        },
        "source": {
          "type": [
            "string",
            "null"
          ]
        },
        "displayCapacityHp": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0
        },
        "relativeFull": {
          "type": "boolean"
        },
        "confidence": {
          "$ref": "#/$defs/PlaybackConfidence"
        }
      }
    },
    "LifeTransition": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "timeSec",
        "lifeState",
        "destroyedKnownAtSec"
      ],
      "properties": {
        "timeSec": {
          "type": "number",
          "minimum": 0
        },
        "lifeState": {
          "$ref": "#/$defs/PlaybackLifeState"
        },
        "destroyedKnownAtSec": {
          "type": [
            "number",
            "null"
          ],
          "minimum": 0
        }
      }
    },
    "ConsumableTransition": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "timeSec",
        "consumableSlot",
        "logicalItemId",
        "wireCode",
        "state",
        "invalidation",
        "confidence"
      ],
      "properties": {
        "timeSec": {
          "type": "number",
          "minimum": 0
        },
        "consumableSlot": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0,
          "maximum": 2
        },
        "logicalItemId": {
          "type": [
            "string",
            "null"
          ]
        },
        "wireCode": {
          "type": [
            "integer",
            "null"
          ]
        },
        "state": {
          "type": "string"
        },
        "invalidation": {
          "type": "boolean"
        },
        "confidence": {
          "$ref": "#/$defs/PlaybackConfidence"
        }
      }
    },
    "ModuleCrewTransition": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "timeSec",
        "component",
        "state",
        "recorderVisible",
        "confidence"
      ],
      "properties": {
        "timeSec": {
          "type": "number",
          "minimum": 0
        },
        "component": {
          "type": "string"
        },
        "state": {
          "type": [
            "string",
            "null"
          ]
        },
        "recorderVisible": {
          "type": "boolean"
        },
        "confidence": {
          "$ref": "#/$defs/PlaybackConfidence"
        }
      }
    },
    "DamageLoss": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "fromSec",
        "toSec",
        "hpLoss",
        "attackerAccountId",
        "attackerReliable",
        "damageEventCount",
        "fromHp",
        "toHp",
        "displayCapacityHp",
        "transientAllowed"
      ],
      "properties": {
        "fromSec": {
          "type": "number",
          "minimum": 0
        },
        "toSec": {
          "type": "number",
          "minimum": 0
        },
        "hpLoss": {
          "type": "integer",
          "minimum": 0
        },
        "attackerAccountId": {
          "type": [
            "integer",
            "null"
          ]
        },
        "attackerReliable": {
          "type": "boolean"
        },
        "damageEventCount": {
          "type": "integer",
          "minimum": 0
        },
        "fromHp": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0
        },
        "toHp": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0
        },
        "displayCapacityHp": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0
        },
        "transientAllowed": {
          "type": "boolean"
        }
      }
    },
    "BattleEvent": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "timeSec",
        "accountId",
        "targetAccountId",
        "observedHpLoss"
      ],
      "properties": {
        "type": {
          "type": "string"
        },
        "timeSec": {
          "type": "number",
          "minimum": 0
        },
        "accountId": {
          "type": [
            "integer",
            "null"
          ]
        },
        "targetAccountId": {
          "type": [
            "integer",
            "null"
          ]
        },
        "observedHpLoss": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0
        }
      }
    },
    "PointsSample": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "timeSec",
        "team",
        "points"
      ],
      "properties": {
        "timeSec": {
          "type": "number",
          "minimum": 0
        },
        "team": {
          "type": "integer"
        },
        "points": {
          "type": "integer",
          "minimum": 0
        }
      }
    },
    "BaseStateTransition": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "timeSec",
        "baseId",
        "ownerTeam",
        "capturingTeam",
        "captureProgress"
      ],
      "properties": {
        "timeSec": {
          "type": "number",
          "minimum": 0
        },
        "baseId": {
          "type": "string",
          "enum": [
            "A",
            "B",
            "C",
            "D",
            "BASE"
          ],
          "description": "Supremacy uses A-D; Assault single-base uses BASE."
        },
        "ownerTeam": {
          "type": [
            "integer",
            "null"
          ],
          "enum": [
            1,
            2,
            null
          ]
        },
        "capturingTeam": {
          "type": [
            "integer",
            "null"
          ],
          "enum": [
            1,
            2,
            null
          ]
        },
        "captureProgress": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0,
          "maximum": 100,
          "description": "Supremacy canonical states remain 0-99; Assault BASE may reach protocol value 100."
        }
      }
    },
    "ApiError": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "errorCode",
        "errorMsg",
        "status",
        "retryable",
        "details",
        "timestamp"
      ],
      "properties": {
        "id": {
          "type": [
            "string",
            "null"
          ]
        },
        "errorCode": {
          "type": "string",
          "pattern": "^[A-Z][A-Z0-9_]*$",
          "description": "Stable infrastructure code or a legacy uppercase domain code during the migration boundary."
        },
        "errorMsg": {
          "type": [
            "string",
            "null"
          ]
        },
        "status": {
          "type": "integer",
          "minimum": 400,
          "maximum": 599
        },
        "retryable": {
          "type": "boolean"
        },
        "details": {
          "type": "object",
          "additionalProperties": true
        },
        "timestamp": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        }
      }
    },
    "ApiErrorCode": {
      "type": "string",
      "enum": [
        "TOURNAMENT_VERSION_CONFLICT",
        "TOURNAMENT_LOCKED",
        "TOURNAMENT_RULES_INCOMPLETE",
        "TOURNAMENT_GROUP_CONFLICT",
        "TOURNAMENT_DUPLICATE_GROUP",
        "TOURNAMENT_NEW_CLAN_CONFIRMATION_REQUIRED",
        "TOURNAMENT_GROUP_COUNT_MISMATCH",
        "TOURNAMENT_RECOGNITION_UNAVAILABLE",
        "TOURNAMENT_ALREADY_EXISTS",
        "TOURNAMENT_EVIDENCE_INVALID",
        "TOURNAMENT_STORAGE_FULL",
        "TOURNAMENT_STORAGE_ERROR",
        "INVALID_RECOGNITION_REQUEST",
        "INVALID_RECOGNITION_PERMIT",
        "TOURNAMENT_RECOGNITION_NOT_CONFIGURED",
        "TOURNAMENT_RECOGNITION_BUSY",
        "TOURNAMENT_RECOGNITION_RATE_LIMITED",
        "INVALID_TOURNAMENT_IMAGE",
        "INVALID_TOURNAMENT_IMAGE_DIMENSIONS",
        "TOURNAMENT_IMAGE_TOO_LARGE",
        "UNSUPPORTED_TOURNAMENT_IMAGE",
        "AUTH_UNAUTHENTICATED",
        "AUTH_FORBIDDEN",
        "INVALID_ARGUMENT",
        "MISSING_PARAM",
        "INVALID_REQUEST",
        "DATASET_REFERENCE_REQUIRED",
        "UNSUPPORTED_MEDIA_TYPE",
        "METHOD_NOT_ALLOWED",
        "RESOURCE_NOT_FOUND",
        "REPLAY_BUSY",
        "PROCESSING_QUEUE_FULL",
        "EXPORT_QUEUE_FULL",
        "AI_REVIEW_BUSY",
        "AI_REQUEST_TOO_LARGE",
        "INVALID_AI_REQUEST",
        "UNKNOWN_LOCALE",
        "INVALID_CORRELATION_ID",
        "DUPLICATE_CORRELATION_ID",
        "UNSUPPORTED_BATTLE_CATEGORY",
        "AI_QUEUE_FULL",
        "AI_RATE_LIMITED",
        "AI_UPSTREAM_TIMEOUT",
        "AI_UPSTREAM_UNAVAILABLE",
        "AI_TIMEOUT",
        "AI_CANCELLED",
        "AI_NOT_CONFIGURED",
        "AI_INVALID_REQUEST",
        "AI_AUTHENTICATION_ERROR",
        "AI_CONTEXT_TOO_LARGE",
        "AI_EMPTY_RESPONSE",
        "AI_RESPONSE_INVALID",
        "AI_REVIEW_SCHEMA_FAILED",
        "AI_REVIEW_GROUNDING_FAILED",
        "AI_TIMELINE_UNUSABLE",
        "AI_PROMPT_MANDATORY_SECTION_TOO_LARGE",
        "JOB_NOT_FOUND",
        "SOURCE_NOT_FOUND",
        "SOURCE_NOT_READY",
        "SOURCE_PROCESSING_FAILED",
        "DATASET_UNAVAILABLE",
        "INTERNAL_ERROR",
        "SERVICE_UNAVAILABLE",
        "UPSTREAM_UNAVAILABLE",
        "UPSTREAM_TIMEOUT",
        "RATE_LIMITED"
      ]
    }
  }
} as const
