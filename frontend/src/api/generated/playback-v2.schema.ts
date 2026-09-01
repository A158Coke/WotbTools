// GENERATED FILE - DO NOT EDIT MANUALLY. Source: contracts/http/openapi.yaml
export default {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$ref": "#/$defs/BattlePlaybackDataset",
  "$defs": {
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
        "LAST_KNOWN",
        "UNKNOWN"
      ]
    },
    "HealthKnowledge": {
      "type": "string",
      "enum": [
        "CURRENT",
        "LAST_KNOWN",
        "UNKNOWN"
      ]
    },
    "PlaybackLifeState": {
      "type": "string",
      "enum": [
        "ALIVE",
        "DESTROYED",
        "UNKNOWN"
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
          "$ref": "#/$defs/HealthKnowledge"
        },
        "source": {
          "type": "string"
        },
        "displayCapacityHp": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0
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
          "type": "string"
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
        "damageEventCount"
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
