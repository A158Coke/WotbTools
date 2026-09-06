// GENERATED FILE - DO NOT EDIT MANUALLY. Source: contracts/http/openapi.yaml
export default {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$ref": "#/$defs/BattlePlaybackDataset",
  "$defs": {
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
        "gameAccountIdSnapshot",
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
        "gameAccountIdSnapshot": {
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
        "gameAccountIdSnapshot",
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
        "gameAccountIdSnapshot": {
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
    "DatasetReference": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "processingJobId",
        "sourceId"
      ],
      "properties": {
        "processingJobId": {
          "type": "string",
          "minLength": 1
        },
        "sourceId": {
          "type": "string",
          "pattern": "^r[0-9]+$"
        }
      }
    },
    "AiReviewAnalyzeRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "processingJobId",
        "sourceId",
        "lang",
        "correlationId"
      ],
      "properties": {
        "processingJobId": {
          "type": "string",
          "minLength": 1
        },
        "sourceId": {
          "type": "string",
          "pattern": "^r[0-9]+$"
        },
        "lang": {
          "type": "string",
          "enum": [
            "zh",
            "en",
            "ru"
          ]
        },
        "correlationId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        }
      }
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
            "D"
          ]
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
          "maximum": 99
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
