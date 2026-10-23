// GENERATED FILE - DO NOT EDIT MANUALLY. Source: contracts/http/openapi.yaml
export default {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$ref": "#/$defs/BattlePlaybackDataset",
  "$defs": {
    "RecommendationType": {
      "type": "string",
      "enum": [
        "UP",
        "VIDEO"
      ]
    },
    "RecommendationCategory": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "id",
        "name"
      ],
      "properties": {
        "type": {
          "$ref": "#/$defs/RecommendationType"
        },
        "id": {
          "type": "integer",
          "minimum": 1
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        }
      }
    },
    "RecommendationCard": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "id",
        "externalId",
        "name",
        "description",
        "targetUrl",
        "imageUrl",
        "categories",
        "level",
        "score",
        "createdAt",
        "version"
      ],
      "properties": {
        "type": {
          "$ref": "#/$defs/RecommendationType"
        },
        "id": {
          "type": "integer",
          "minimum": 1
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "description": {
          "type": [
            "string",
            "null"
          ],
          "maxLength": 2000
        },
        "categories": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/RecommendationCategory"
          },
          "minItems": 1
        },
        "level": {
          "oneOf": [
            {
              "$ref": "#/$defs/CreatorLevel"
            },
            {
              "type": "null"
            }
          ]
        },
        "score": {
          "type": "integer",
          "enum": [
            2,
            4,
            6,
            8,
            10
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "version": {
          "type": "integer",
          "minimum": 0
        },
        "externalId": {
          "type": "string",
          "description": "UP: positive decimal UID. VIDEO: case-sensitive BV identifier. See type-specific constraints."
        },
        "targetUrl": {
          "type": "string",
          "format": "uri"
        },
        "imageUrl": {
          "type": [
            "string",
            "null"
          ]
        }
      },
      "allOf": [
        {
          "if": {
            "properties": {
              "type": {
                "const": "UP"
              }
            }
          },
          "then": {
            "properties": {
              "externalId": {
                "type": "string",
                "pattern": "^[1-9][0-9]{0,19}$",
                "maxLength": 20
              },
              "targetUrl": {
                "type": "string",
                "format": "uri",
                "pattern": "^https://space\\.bilibili\\.com/[1-9][0-9]{0,19}$",
                "maxLength": 47
              },
              "categories": {
                "items": {
                  "properties": {
                    "type": {
                      "const": "UP"
                    }
                  }
                }
              }
            }
          },
          "else": {
            "properties": {
              "externalId": {
                "type": "string",
                "pattern": "^BV[A-Za-z0-9]{10}$",
                "description": "Case-sensitive BV identifier. Only surrounding ECMAScript whitespace is trimmed; structural validation does not verify video existence."
              },
              "level": {
                "type": "null"
              },
              "targetUrl": {
                "type": "string",
                "format": "uri",
                "pattern": "^https://www\\.bilibili\\.com/video/BV[A-Za-z0-9]{10}$"
              },
              "categories": {
                "items": {
                  "properties": {
                    "type": {
                      "const": "VIDEO"
                    }
                  }
                }
              }
            }
          }
        }
      ]
    },
    "RecommendationDetail": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "id",
        "externalId",
        "name",
        "description",
        "categoryIds",
        "levelId",
        "stars",
        "imageUrl",
        "version"
      ],
      "properties": {
        "type": {
          "$ref": "#/$defs/RecommendationType"
        },
        "id": {
          "type": "integer",
          "minimum": 1
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "description": {
          "type": [
            "string",
            "null"
          ],
          "maxLength": 2000
        },
        "categoryIds": {
          "type": "array",
          "minItems": 1,
          "uniqueItems": true,
          "items": {
            "type": "integer",
            "minimum": 1
          }
        },
        "levelId": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 1
        },
        "stars": {
          "type": "integer",
          "minimum": 1,
          "maximum": 5
        },
        "version": {
          "type": "integer",
          "minimum": 0
        },
        "externalId": {
          "type": "string",
          "description": "UP: positive decimal UID. VIDEO: case-sensitive BV identifier. See type-specific constraints."
        },
        "imageUrl": {
          "type": [
            "string",
            "null"
          ]
        }
      },
      "allOf": [
        {
          "if": {
            "properties": {
              "type": {
                "const": "UP"
              }
            }
          },
          "then": {
            "properties": {
              "externalId": {
                "type": "string",
                "pattern": "^[1-9][0-9]{0,19}$",
                "maxLength": 20
              }
            }
          },
          "else": {
            "properties": {
              "externalId": {
                "type": "string",
                "pattern": "^BV[A-Za-z0-9]{10}$",
                "description": "Case-sensitive BV identifier. Only surrounding ECMAScript whitespace is trimmed; structural validation does not verify video existence."
              },
              "levelId": {
                "type": "null"
              }
            }
          }
        }
      ]
    },
    "RecommendationSaveRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "externalId",
        "name",
        "description",
        "categoryIds",
        "levelId",
        "stars",
        "imageAction",
        "expectedVersion"
      ],
      "properties": {
        "type": {
          "$ref": "#/$defs/RecommendationType"
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "description": {
          "type": [
            "string",
            "null"
          ],
          "maxLength": 2000
        },
        "categoryIds": {
          "type": "array",
          "minItems": 1,
          "uniqueItems": true,
          "items": {
            "type": "integer",
            "minimum": 1
          }
        },
        "levelId": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 1
        },
        "stars": {
          "type": "integer",
          "minimum": 1,
          "maximum": 5
        },
        "expectedVersion": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0
        },
        "externalId": {
          "type": "string",
          "description": "UP: positive decimal UID. VIDEO: case-sensitive BV identifier. See type-specific constraints."
        },
        "imageAction": {
          "type": "string",
          "enum": [
            "KEEP",
            "REPLACE",
            "REMOVE"
          ]
        }
      },
      "allOf": [
        {
          "if": {
            "properties": {
              "type": {
                "const": "UP"
              }
            }
          },
          "then": {
            "properties": {
              "externalId": {
                "type": "string",
                "pattern": "^\\s*(?=0*[1-9])[0-9]{1,20}\\s*$",
                "description": "Positive decimal UID of at most 20 digits; surrounding whitespace and leading zeros are normalized by the server."
              }
            }
          },
          "else": {
            "properties": {
              "externalId": {
                "type": "string",
                "pattern": "^\\s*BV[A-Za-z0-9]{10}\\s*$",
                "description": "Case-sensitive BV identifier. Only surrounding ECMAScript whitespace is trimmed; structural validation does not verify video existence."
              },
              "levelId": {
                "type": "null"
              }
            }
          }
        }
      ]
    },
    "RecommendationMetadata": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "categories",
        "levels",
        "imageUploadsAvailable"
      ],
      "properties": {
        "type": {
          "$ref": "#/$defs/RecommendationType"
        },
        "categories": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/RecommendationCategory"
          }
        },
        "levels": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/CreatorLevel"
          }
        },
        "imageUploadsAvailable": {
          "type": "boolean"
        }
      },
      "allOf": [
        {
          "if": {
            "properties": {
              "type": {
                "const": "VIDEO"
              }
            }
          },
          "then": {
            "properties": {
              "levels": {
                "maxItems": 0
              },
              "categories": {
                "items": {
                  "properties": {
                    "type": {
                      "const": "VIDEO"
                    }
                  }
                }
              }
            }
          },
          "else": {
            "properties": {
              "categories": {
                "items": {
                  "properties": {
                    "type": {
                      "const": "UP"
                    }
                  }
                }
              }
            }
          }
        }
      ]
    },
    "RecommendationCategoryRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "name"
      ],
      "properties": {
        "type": {
          "$ref": "#/$defs/RecommendationType"
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        }
      }
    },
    "CreatorLevel": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "name"
      ],
      "properties": {
        "id": {
          "type": "integer",
          "minimum": 1
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        }
      }
    },
    "CreatorNameRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name"
      ],
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        }
      }
    },
    "BackendHealth": {
      "type": "object",
      "additionalProperties": true,
      "required": [
        "status",
        "tanks"
      ],
      "properties": {
        "status": {
          "type": "string"
        },
        "tanks": {
          "type": "integer",
          "minimum": 0
        },
        "capabilities": {
          "description": "recommendations-v1 enables the UP/VIDEO recommendation APIs and their populated public categories. Technical capability markers are independent of directory contents and read without querying the database; clients fetch public categories to decide which recommendation types have content. broadcast-season-contents-v1 enables the consistent season contents endpoint and version-confirmed category deletion; frontend deployment requires this marker before replacing live containers.",
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    },
    "BroadcastServer": {
      "type": "string",
      "enum": [
        "CN",
        "ASIA",
        "NA",
        "EU",
        "LESTA"
      ]
    },
    "BroadcastCategoryType": {
      "type": "string",
      "enum": [
        "POINTS",
        "QUARTER_FINALS",
        "SEMI_FINALS"
      ]
    },
    "BroadcastFormat": {
      "type": "string",
      "enum": [
        "ROUND_ROBIN",
        "KNOCKOUT"
      ]
    },
    "BroadcastPerspective": {
      "type": "string",
      "enum": [
        "POV",
        "OBSERVER"
      ]
    },
    "BroadcastBracket": {
      "type": "string",
      "enum": [
        "DEFAULT",
        "WINNERS",
        "LOSERS"
      ]
    },
    "BroadcastSeason": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "server",
        "year",
        "nameZh",
        "nameEn",
        "nameRu",
        "startDate",
        "createdAt",
        "version",
        "rootCount",
        "replayCount"
      ],
      "properties": {
        "id": {
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        },
        "server": {
          "$ref": "#/$defs/BroadcastServer"
        },
        "year": {
          "type": "integer",
          "minimum": 1,
          "maximum": 9999
        },
        "nameZh": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "nameEn": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "nameRu": {
          "type": [
            "string",
            "null"
          ],
          "maxLength": 100
        },
        "startDate": {
          "type": [
            "string",
            "null"
          ],
          "format": "date"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "version": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "rootCount": {
          "type": "integer",
          "minimum": 0,
          "maximum": 2147483647
        },
        "replayCount": {
          "type": "integer",
          "minimum": 0,
          "maximum": 2147483647
        }
      }
    },
    "BroadcastCategory": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "seasonId",
        "type"
      ],
      "properties": {
        "id": {
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        },
        "seasonId": {
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        },
        "type": {
          "$ref": "#/$defs/BroadcastCategoryType"
        }
      }
    },
    "BroadcastReplay": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "nodeId",
        "title",
        "url",
        "matchDate",
        "dayNumber",
        "groupNumber",
        "bracket",
        "teams",
        "perspective",
        "coverId"
      ],
      "properties": {
        "id": {
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        },
        "nodeId": {
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        },
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "url": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2048,
          "pattern": "^[hH][tT][tT][pP][sS]?://[^\\s]+$"
        },
        "matchDate": {
          "type": "string",
          "format": "date"
        },
        "dayNumber": {
          "type": "integer",
          "minimum": 1,
          "maximum": 2147483647
        },
        "groupNumber": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 1,
          "maximum": 2147483647
        },
        "bracket": {
          "anyOf": [
            {
              "$ref": "#/$defs/BroadcastBracket"
            },
            {
              "type": "null"
            }
          ]
        },
        "teams": {
          "type": "array",
          "minItems": 2,
          "maxItems": 4,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          }
        },
        "perspective": {
          "$ref": "#/$defs/BroadcastPerspective"
        },
        "coverId": {
          "type": [
            "string",
            "null"
          ],
          "format": "uuid"
        }
      }
    },
    "BroadcastNode": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "categoryId",
        "roundNumber",
        "format",
        "replays"
      ],
      "properties": {
        "id": {
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        },
        "categoryId": {
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        },
        "roundNumber": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 1,
          "maximum": 5
        },
        "format": {
          "anyOf": [
            {
              "$ref": "#/$defs/BroadcastFormat"
            },
            {
              "type": "null"
            }
          ]
        },
        "replays": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/BroadcastReplay"
          }
        }
      }
    },
    "BroadcastIndex": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "servers",
        "seasons",
        "coverUploadAvailable"
      ],
      "properties": {
        "servers": {
          "type": "array",
          "minItems": 5,
          "maxItems": 5,
          "uniqueItems": true,
          "items": {
            "$ref": "#/$defs/BroadcastServer"
          }
        },
        "seasons": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/BroadcastSeason"
          }
        },
        "coverUploadAvailable": {
          "type": "boolean"
        }
      }
    },
    "BroadcastSeasonView": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "season",
        "categories",
        "coverUploadAvailable"
      ],
      "properties": {
        "season": {
          "$ref": "#/$defs/BroadcastSeason"
        },
        "categories": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/BroadcastCategory"
          }
        },
        "coverUploadAvailable": {
          "type": "boolean"
        }
      }
    },
    "BroadcastTimeZone": {
      "type": "string",
      "enum": [
        "Asia/Shanghai",
        "America/Los_Angeles",
        "Europe/Berlin",
        "Europe/Moscow"
      ]
    },
    "BroadcastReplayStart": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "replayId",
        "startsAt"
      ],
      "properties": {
        "replayId": {
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        },
        "startsAt": {
          "type": "string",
          "format": "date-time"
        }
      }
    },
    "BroadcastSeasonContents": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "season",
        "categories",
        "nodes",
        "defaultTimeZone",
        "replayStarts",
        "coverUploadAvailable"
      ],
      "properties": {
        "season": {
          "$ref": "#/$defs/BroadcastSeason"
        },
        "categories": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/BroadcastCategory"
          }
        },
        "coverUploadAvailable": {
          "type": "boolean"
        },
        "nodes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/BroadcastNode"
          }
        },
        "defaultTimeZone": {
          "$ref": "#/$defs/BroadcastTimeZone"
        },
        "replayStarts": {
          "type": "array",
          "description": "Only replays with a known start instant are included.",
          "items": {
            "$ref": "#/$defs/BroadcastReplayStart"
          }
        }
      }
    },
    "BroadcastTimedCategoryView": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "data",
        "defaultTimeZone",
        "replayStarts"
      ],
      "properties": {
        "data": {
          "$ref": "#/$defs/BroadcastCategoryView"
        },
        "defaultTimeZone": {
          "$ref": "#/$defs/BroadcastTimeZone"
        },
        "replayStarts": {
          "type": "array",
          "description": "Only replays with a known start instant are included.",
          "items": {
            "$ref": "#/$defs/BroadcastReplayStart"
          }
        }
      }
    },
    "BroadcastTimedReplaySave": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "replay",
        "startsAt"
      ],
      "properties": {
        "replay": {
          "$ref": "#/$defs/BroadcastReplaySave"
        },
        "startsAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time",
          "description": "Explicit null clears the time. When present, its date in the server tournament timezone must equal replay.matchDate."
        }
      }
    },
    "BroadcastCategoryView": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "season",
        "category",
        "nodes",
        "coverUploadAvailable"
      ],
      "properties": {
        "season": {
          "$ref": "#/$defs/BroadcastSeason"
        },
        "category": {
          "$ref": "#/$defs/BroadcastCategory"
        },
        "nodes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/BroadcastNode"
          }
        },
        "coverUploadAvailable": {
          "type": "boolean"
        }
      }
    },
    "BroadcastDeletionPreview": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "seasonId",
        "expectedVersion",
        "rootCount",
        "replayCount"
      ],
      "properties": {
        "seasonId": {
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        },
        "expectedVersion": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "rootCount": {
          "type": "integer",
          "minimum": 0,
          "maximum": 2147483647
        },
        "replayCount": {
          "type": "integer",
          "minimum": 0,
          "maximum": 2147483647
        }
      }
    },
    "BroadcastSeasonCreate": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "server",
        "year",
        "nameZh",
        "nameEn",
        "startDate"
      ],
      "properties": {
        "server": {
          "$ref": "#/$defs/BroadcastServer"
        },
        "year": {
          "type": "integer",
          "minimum": 1,
          "maximum": 9999
        },
        "nameZh": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "nameEn": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "nameRu": {
          "type": [
            "string",
            "null"
          ],
          "maxLength": 100
        },
        "startDate": {
          "type": [
            "string",
            "null"
          ],
          "format": "date"
        }
      }
    },
    "BroadcastSeasonUpdate": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "expectedVersion",
        "year",
        "nameZh",
        "nameEn",
        "startDate"
      ],
      "properties": {
        "expectedVersion": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "year": {
          "type": "integer",
          "minimum": 1,
          "maximum": 9999
        },
        "nameZh": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "nameEn": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "nameRu": {
          "type": [
            "string",
            "null"
          ],
          "maxLength": 100
        },
        "startDate": {
          "type": [
            "string",
            "null"
          ],
          "format": "date"
        }
      }
    },
    "BroadcastCategoryCreate": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "expectedVersion",
        "type"
      ],
      "properties": {
        "expectedVersion": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "type": {
          "$ref": "#/$defs/BroadcastCategoryType"
        }
      }
    },
    "BroadcastNodeCreate": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "expectedVersion",
        "roundNumber",
        "format"
      ],
      "properties": {
        "expectedVersion": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "roundNumber": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 1,
          "maximum": 5
        },
        "format": {
          "anyOf": [
            {
              "$ref": "#/$defs/BroadcastFormat"
            },
            {
              "type": "null"
            }
          ]
        }
      }
    },
    "BroadcastReplaySave": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "expectedVersion",
        "title",
        "url",
        "matchDate",
        "dayNumber",
        "groupNumber",
        "bracket",
        "teams",
        "perspective",
        "coverAction"
      ],
      "properties": {
        "expectedVersion": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "url": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2048,
          "pattern": "^[hH][tT][tT][pP][sS]?://[^\\s]+$"
        },
        "matchDate": {
          "type": "string",
          "format": "date"
        },
        "dayNumber": {
          "type": "integer",
          "minimum": 1,
          "maximum": 2147483647
        },
        "groupNumber": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 1,
          "maximum": 2147483647
        },
        "bracket": {
          "anyOf": [
            {
              "$ref": "#/$defs/BroadcastBracket"
            },
            {
              "type": "null"
            }
          ]
        },
        "teams": {
          "type": "array",
          "minItems": 2,
          "maxItems": 4,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          }
        },
        "perspective": {
          "$ref": "#/$defs/BroadcastPerspective"
        },
        "coverAction": {
          "type": "string",
          "enum": [
            "KEEP",
            "REMOVE",
            "REPLACE"
          ]
        }
      }
    },
    "ObservabilityEventsRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "events"
      ],
      "properties": {
        "events": {
          "type": "array",
          "minItems": 1,
          "maxItems": 20,
          "items": {
            "$ref": "#/$defs/ObservabilityEvent"
          }
        }
      }
    },
    "ObservabilityEvent": {
      "description": "Event-family discriminated union. Android download clicks use an exact tuple and cannot carry replay-parse-only fields.",
      "oneOf": [
        {
          "$ref": "#/$defs/GenericObservabilityEvent"
        },
        {
          "$ref": "#/$defs/AndroidDownloadClickEvent"
        }
      ]
    },
    "GenericObservabilityEvent": {
      "description": "All product telemetry except the dedicated Android download click event.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "event_id",
        "event",
        "platform",
        "feature",
        "occurred_at"
      ],
      "properties": {
        "event_id": {
          "type": "string",
          "format": "uuid"
        },
        "event": {
          "type": "string",
          "enum": [
            "active_user",
            "feature_open",
            "replay_parse"
          ]
        },
        "platform": {
          "type": "string",
          "enum": [
            "web",
            "android"
          ]
        },
        "feature": {
          "type": "string",
          "enum": [
            "home",
            "replay_parse",
            "replay_2d",
            "replay_3d",
            "replay_shots",
            "ai_review",
            "tankopedia",
            "armor",
            "hall_of_fame",
            "tournament",
            "android_download",
            "sponsor",
            "profile"
          ]
        },
        "occurred_at": {
          "type": "string",
          "format": "date-time"
        },
        "operation_id": {
          "type": "string",
          "format": "uuid",
          "description": "Required for replay_parse; one ID per file attempt shared by start and terminal."
        },
        "outcome": {
          "type": "string",
          "enum": [
            "start",
            "success",
            "failure",
            "cancelled"
          ],
          "description": "Required only for replay_parse."
        },
        "error_code": {
          "type": "string",
          "enum": [
            "PARSE_FAILED",
            "UNSUPPORTED_REPLAY",
            "INVALID_REPLAY",
            "RESOURCE_UNAVAILABLE",
            "UNKNOWN"
          ],
          "description": "Allowed only for failed replay_parse. Never raw exception text."
        },
        "error_id": {
          "type": "string",
          "format": "uuid",
          "description": "Allowed only for failed replay_parse."
        }
      }
    },
    "AndroidDownloadClickEvent": {
      "description": "One click on the final \"下载 APK\" button on /download/android. Intent only; never implies a completed transfer or installation.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "event_id",
        "event",
        "platform",
        "feature",
        "occurred_at"
      ],
      "properties": {
        "event_id": {
          "type": "string",
          "format": "uuid"
        },
        "event": {
          "type": "string",
          "enum": [
            "android_download_click"
          ]
        },
        "platform": {
          "type": "string",
          "enum": [
            "web"
          ]
        },
        "feature": {
          "type": "string",
          "enum": [
            "android_download"
          ]
        },
        "occurred_at": {
          "type": "string",
          "format": "date-time"
        }
      }
    },
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
    "TournamentDefaultRound": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "roundNumber",
        "days"
      ],
      "properties": {
        "roundNumber": {
          "type": "integer",
          "minimum": 1,
          "maximum": 5
        },
        "days": {
          "type": "array",
          "minItems": 2,
          "maxItems": 3,
          "items": {
            "$ref": "#/$defs/TournamentRuleDay"
          }
        }
      }
    },
    "TournamentDefaultRules": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "version",
        "active",
        "sourceEventId",
        "sourceLabel",
        "updatedAt",
        "rounds"
      ],
      "properties": {
        "version": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "active": {
          "type": "boolean"
        },
        "sourceEventId": {
          "description": "Null for a directly configured or seeded default, a deleted source event, or an inactive default.",
          "type": [
            "integer",
            "null"
          ],
          "format": "int64",
          "minimum": 1
        },
        "sourceLabel": {
          "description": "Stable source identity snapshot; empty when no default is active. Not a localized UI message.",
          "type": "string"
        },
        "updatedAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "rounds": {
          "description": "Full published rule snapshot; empty when inactive. Round and day numbers are unique within their parent.",
          "type": "array",
          "maxItems": 5,
          "items": {
            "$ref": "#/$defs/TournamentDefaultRound"
          }
        }
      }
    },
    "TournamentSetDefaultRulesRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "eventId",
        "expectedEventVersion",
        "expectedDefaultVersion",
        "confirm"
      ],
      "properties": {
        "eventId": {
          "type": "integer",
          "format": "int64",
          "minimum": 1
        },
        "expectedEventVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "expectedDefaultVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "confirm": {
          "description": "Must be true when replacing an active default.",
          "type": "boolean"
        }
      }
    },
    "TournamentDefaultConfigurationRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "expectedDefaultVersion",
        "confirm",
        "rounds"
      ],
      "properties": {
        "expectedDefaultVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "confirm": {
          "description": "Must be true when replacing an active default.",
          "type": "boolean"
        },
        "rounds": {
          "description": "Complete rounds numbered consecutively from 1, with a consistent number of days and ranks 1-4 present on each day. Duplicate round, day, or rank numbers are rejected.",
          "type": "array",
          "minItems": 4,
          "maxItems": 5,
          "items": {
            "$ref": "#/$defs/TournamentDefaultRound"
          }
        }
      }
    },
    "TournamentClearDefaultRulesRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "expectedDefaultVersion",
        "confirm"
      ],
      "properties": {
        "expectedDefaultVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "confirm": {
          "description": "Must be true to clear the default.",
          "type": "boolean"
        }
      }
    },
    "TournamentRuleSource": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "eventVersion",
        "source",
        "defaultVersion",
        "isDefaultSource",
        "defaultOutdated"
      ],
      "properties": {
        "eventVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "source": {
          "type": "string",
          "enum": [
            "INHERIT",
            "CUSTOM",
            "FROZEN"
          ]
        },
        "defaultVersion": {
          "description": "Current singleton version for INHERIT (including an inactive default), captured version for events frozen from a default, otherwise null.",
          "type": [
            "integer",
            "null"
          ],
          "format": "int64",
          "minimum": 0
        },
        "isDefaultSource": {
          "description": "True only when this event is the source of the currently active default.",
          "type": "boolean"
        },
        "defaultOutdated": {
          "description": "True when the active default source event has saved rules differing from the published snapshot.",
          "type": "boolean"
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
        "expectedDefaultVersion": {
          "description": "Optional for legacy clients. When supplied for inherited rules, must match the current singleton version before copying the complete effective rule set into this event. Null or omission uses the server-authoritative current default.",
          "type": [
            "integer",
            "null"
          ],
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
        "expectedDefaultVersion": {
          "description": "Optional for legacy clients. When supplied for inherited rules, must match the current singleton version before freezing the effective rule set. Null or omission uses the server-authoritative current default.",
          "type": [
            "integer",
            "null"
          ],
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
        },
        "canonicalStandings": {
          "allOf": [
            {
              "$ref": "#/$defs/TournamentStandings"
            }
          ],
          "description": "Optional authenticated admin import/export facts before sanctions and clear overlays; absent on older servers."
        }
      }
    },
    "TournamentHistoricalState": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "eventVersion",
        "imported",
        "canImport",
        "historical"
      ],
      "properties": {
        "eventVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "imported": {
          "type": "boolean",
          "description": "A historical import was committed, including roster-only imports with all-null cells."
        },
        "canImport": {
          "type": "boolean",
          "description": "The backend one-time import gate currently accepts this event."
        },
        "historical": {
          "type": "boolean",
          "description": "The selected published day still uses historical direct scores."
        }
      }
    },
    "TournamentHistoricalRow": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "clanTag",
        "points",
        "sourceTotal"
      ],
      "properties": {
        "clanTag": {
          "type": "string",
          "minLength": 1,
          "maxLength": 32
        },
        "points": {
          "type": "array",
          "minItems": 8,
          "maxItems": 15,
          "description": "Round-major then day-major matrix, with exactly roundCount times daysPerRound cells. Null is no participation; zero is an explicit score.",
          "items": {
            "type": [
              "integer",
              "null"
            ],
            "minimum": 0,
            "maximum": 1000000
          }
        },
        "sourceTotal": {
          "type": "integer",
          "format": "int64",
          "minimum": 0,
          "maximum": 15000000
        }
      }
    },
    "TournamentHistoricalPreviewRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "expectedEventVersion",
        "sourceName",
        "sourceSha256",
        "rows"
      ],
      "properties": {
        "expectedEventVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "sourceName": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "sourceSha256": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "rows": {
          "type": "array",
          "minItems": 1,
          "maxItems": 10000,
          "items": {
            "$ref": "#/$defs/TournamentHistoricalRow"
          }
        }
      }
    },
    "TournamentHistoricalImportRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "expectedEventVersion",
        "sourceName",
        "sourceSha256",
        "rows",
        "confirm",
        "idempotencyKey"
      ],
      "properties": {
        "expectedEventVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "sourceName": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "sourceSha256": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "rows": {
          "type": "array",
          "minItems": 1,
          "maxItems": 10000,
          "items": {
            "$ref": "#/$defs/TournamentHistoricalRow"
          }
        },
        "confirm": {
          "type": "boolean"
        },
        "idempotencyKey": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        }
      }
    },
    "TournamentHistoricalPreview": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "standings",
        "sourceRowCount",
        "clanCount",
        "missingCellCount",
        "eventVersion"
      ],
      "properties": {
        "standings": {
          "$ref": "#/$defs/TournamentStandings"
        },
        "sourceRowCount": {
          "type": "integer",
          "minimum": 1,
          "maximum": 10000
        },
        "clanCount": {
          "type": "integer",
          "minimum": 1,
          "maximum": 10000
        },
        "missingCellCount": {
          "type": "integer",
          "minimum": 0,
          "maximum": 150000,
          "description": "Missing cells after merging distinct source rows for the same clan."
        },
        "eventVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        }
      }
    },
    "TournamentCsvChanges": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "addedClans",
        "changedClans",
        "removedClans",
        "addedScores",
        "changedScores",
        "removedScores",
        "preservedClears"
      ],
      "properties": {
        "addedClans": {
          "type": "integer",
          "minimum": 0
        },
        "changedClans": {
          "type": "integer",
          "minimum": 0
        },
        "removedClans": {
          "type": "integer",
          "minimum": 0
        },
        "addedScores": {
          "type": "integer",
          "minimum": 0
        },
        "changedScores": {
          "type": "integer",
          "minimum": 0
        },
        "removedScores": {
          "type": "integer",
          "minimum": 0
        },
        "preservedClears": {
          "type": "integer",
          "minimum": 0,
          "description": "Administrative clear overrides retained in the effective replacement."
        }
      }
    },
    "TournamentCsvImportPreview": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "standings",
        "sourceName",
        "sourceSha256",
        "sourceRowCount",
        "clanCount",
        "missingCellCount",
        "eventVersion",
        "changes"
      ],
      "properties": {
        "standings": {
          "$ref": "#/$defs/TournamentStandings"
        },
        "sourceName": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "sourceSha256": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "sourceRowCount": {
          "type": "integer",
          "minimum": 1,
          "maximum": 10000
        },
        "clanCount": {
          "type": "integer",
          "minimum": 1,
          "maximum": 10000
        },
        "missingCellCount": {
          "type": "integer",
          "minimum": 0,
          "maximum": 150000
        },
        "eventVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "changes": {
          "$ref": "#/$defs/TournamentCsvChanges"
        }
      }
    },
    "TournamentAttribution": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "url"
      ],
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1
        },
        "url": {
          "type": "string",
          "format": "uri"
        }
      }
    },
    "TournamentDataSource": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "csvImported",
        "attribution"
      ],
      "properties": {
        "csvImported": {
          "type": "boolean",
          "description": "Remains true after the first successful CSV import for the lifetime of this event."
        },
        "attribution": {
          "oneOf": [
            {
              "$ref": "#/$defs/TournamentAttribution"
            },
            {
              "type": "null"
            }
          ]
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
      "description": "Audit-list metadata. Full before/after snapshots remain in storage for internal audit and evidence readers.",
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
          "description": "Empty in audit-list responses; the full snapshot is retained internally.",
          "additionalProperties": true
        },
        "after": {
          "type": "object",
          "description": "Empty in audit-list responses; the full snapshot is retained internally.",
          "additionalProperties": true
        }
      }
    },
    "HofVehicleOption": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "tankId",
        "tankName",
        "nation",
        "type",
        "tier"
      ],
      "properties": {
        "tankId": {
          "type": "integer",
          "format": "int64"
        },
        "tankName": {
          "type": "string"
        },
        "nation": {
          "type": "string",
          "enum": [
            "CHINA",
            "GERMANY",
            "JAPAN",
            "EUROPE",
            "FRANCE",
            "USA",
            "USSR",
            "UK",
            "OTHER"
          ]
        },
        "type": {
          "type": "string",
          "enum": [
            "HEAVY_TANK",
            "MEDIUM_TANK",
            "LIGHT_TANK",
            "TANK_DESTROYER",
            "OTHER"
          ]
        },
        "tier": {
          "type": [
            "integer",
            "null"
          ]
        }
      }
    },
    "HofAdminRecord": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "accountId",
        "nickname",
        "tankId",
        "tankName",
        "battleType",
        "damageDealt",
        "mapName",
        "version",
        "battleTime",
        "createdAt",
        "replayHash",
        "replayFileName",
        "replaySize",
        "replayUploadedBy",
        "replayAvailable"
      ],
      "properties": {
        "id": {
          "type": "integer",
          "format": "int64"
        },
        "accountId": {
          "type": "integer",
          "format": "int64"
        },
        "nickname": {
          "type": "string"
        },
        "tankId": {
          "type": "integer",
          "format": "int64"
        },
        "tankName": {
          "type": "string"
        },
        "battleType": {
          "$ref": "#/$defs/HallOfFameBattleType"
        },
        "damageDealt": {
          "type": "integer"
        },
        "mapName": {
          "type": [
            "string",
            "null"
          ]
        },
        "version": {
          "type": [
            "string",
            "null"
          ]
        },
        "battleTime": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "replayHash": {
          "type": [
            "string",
            "null"
          ]
        },
        "replayFileName": {
          "type": [
            "string",
            "null"
          ]
        },
        "replaySize": {
          "type": [
            "integer",
            "null"
          ],
          "format": "int64"
        },
        "replayUploadedBy": {
          "type": [
            "string",
            "null"
          ]
        },
        "replayAvailable": {
          "type": "boolean"
        }
      }
    },
    "HofAdminPage": {
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
            "$ref": "#/$defs/HofAdminRecord"
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
    "HofAdminAudit": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "action",
        "recordId",
        "arenaId",
        "accountId",
        "nickname",
        "tankId",
        "tankName",
        "damageDealt",
        "battleType",
        "arenaBonusType",
        "replayHash",
        "adminKeycloakUserId",
        "adminUsername",
        "createdAt"
      ],
      "properties": {
        "id": {
          "type": "integer",
          "format": "int64"
        },
        "action": {
          "type": "string",
          "enum": [
            "DELETE_ENTRY"
          ]
        },
        "recordId": {
          "type": "integer",
          "format": "int64"
        },
        "arenaId": {
          "type": "string"
        },
        "accountId": {
          "type": "integer",
          "format": "int64"
        },
        "nickname": {
          "type": "string"
        },
        "tankId": {
          "type": "integer",
          "format": "int64"
        },
        "tankName": {
          "type": "string"
        },
        "damageDealt": {
          "type": "integer"
        },
        "battleType": {
          "$ref": "#/$defs/HallOfFameBattleType"
        },
        "arenaBonusType": {
          "type": "integer"
        },
        "replayHash": {
          "type": [
            "string",
            "null"
          ]
        },
        "adminKeycloakUserId": {
          "type": "string"
        },
        "adminUsername": {
          "type": [
            "string",
            "null"
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      }
    },
    "HofAdminAuditPage": {
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
            "$ref": "#/$defs/HofAdminAudit"
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
    "Mark3CreateResult": {
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
    "Mark3SubmissionSummary": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "vehicleId",
        "vehicleName",
        "status",
        "claimedBattleCount",
        "claimedAverageDamage",
        "claimedWinRate",
        "approvedBattleCount",
        "approvedAverageDamage",
        "approvedWinRate",
        "submittedAt",
        "approvedAt",
        "rejectReason",
        "rejectReasonText"
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
            "REJECTED",
            "CANCELLED",
            "DELETED"
          ]
        },
        "claimedBattleCount": {
          "type": "integer"
        },
        "claimedAverageDamage": {
          "type": "integer"
        },
        "claimedWinRate": {
          "type": "number"
        },
        "approvedBattleCount": {
          "type": [
            "integer",
            "null"
          ]
        },
        "approvedAverageDamage": {
          "type": [
            "integer",
            "null"
          ]
        },
        "approvedWinRate": {
          "type": [
            "number",
            "null"
          ]
        },
        "submittedAt": {
          "type": "string",
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
          ],
          "enum": [
            "SCREENSHOT_MISMATCH",
            "SCREENSHOT_UNREADABLE",
            "INSUFFICIENT_PROOF",
            "SUSPECTED_FRAUD",
            "OTHER",
            null
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
    "Mark3UserStatus": {
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
            "$ref": "#/$defs/Mark3SubmissionSummary"
          }
        },
        "pending": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Mark3SubmissionSummary"
          }
        },
        "rejected": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Mark3SubmissionSummary"
          }
        }
      }
    },
    "Mark3LeaderboardItem": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "rank",
        "vehicleId",
        "vehicleName",
        "nickname",
        "approvedBattleCount",
        "approvedAverageDamage",
        "approvedWinRate",
        "approvedAt"
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
        "approvedBattleCount": {
          "type": "integer"
        },
        "approvedAverageDamage": {
          "type": "integer"
        },
        "approvedWinRate": {
          "type": "number"
        },
        "approvedAt": {
          "type": "string",
          "format": "date-time"
        }
      }
    },
    "Mark3LeaderboardPage": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "vehicleId",
        "vehicleName",
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
            "$ref": "#/$defs/Mark3LeaderboardItem"
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
    "Mark3AdminListItem": {
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
        "claimedBattleCount",
        "claimedAverageDamage",
        "claimedWinRate",
        "approvedBattleCount",
        "approvedAverageDamage",
        "approvedWinRate",
        "replayParseOk",
        "replayGameIdMatch",
        "replayVehicleMatch",
        "replayDistinctBattles",
        "submittedAt",
        "approvedAt",
        "rejectReason",
        "deleteReason"
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
        "claimedBattleCount": {
          "type": "integer"
        },
        "claimedAverageDamage": {
          "type": "integer"
        },
        "claimedWinRate": {
          "type": "number"
        },
        "approvedBattleCount": {
          "type": [
            "integer",
            "null"
          ]
        },
        "approvedAverageDamage": {
          "type": [
            "integer",
            "null"
          ]
        },
        "approvedWinRate": {
          "type": [
            "number",
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
          "type": "string",
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
          ],
          "enum": [
            "SCREENSHOT_MISMATCH",
            "SCREENSHOT_UNREADABLE",
            "INSUFFICIENT_PROOF",
            "SUSPECTED_FRAUD",
            "OTHER",
            null
          ]
        },
        "deleteReason": {
          "type": [
            "string",
            "null"
          ],
          "enum": [
            "CHEATING_FORGERY",
            "WRONG_REVIEW",
            "PLAYER_IDENTITY_ISSUE",
            "DATA_ERROR",
            "ADMIN_CORRECTION",
            "OTHER",
            null
          ]
        }
      }
    },
    "Mark3AdminPage": {
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
            "$ref": "#/$defs/Mark3AdminListItem"
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
    "Mark3AdminDetail": {
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
        "claimedBattleCount",
        "claimedAverageDamage",
        "claimedWinRate",
        "approvedBattleCount",
        "approvedAverageDamage",
        "approvedWinRate",
        "proofScreenshots",
        "replayParseOk",
        "replayGameIdMatch",
        "replayVehicleMatch",
        "replayDistinctBattles",
        "submittedAt",
        "approvedAt",
        "approvedBy",
        "rejectedAt",
        "rejectedBy",
        "rejectReason",
        "rejectReasonText",
        "cancelledAt",
        "deletedAt",
        "deletedBy",
        "deleteReason",
        "deleteReasonText"
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
        "claimedBattleCount": {
          "type": "integer"
        },
        "claimedAverageDamage": {
          "type": "integer"
        },
        "claimedWinRate": {
          "type": "number"
        },
        "approvedBattleCount": {
          "type": [
            "integer",
            "null"
          ]
        },
        "approvedAverageDamage": {
          "type": [
            "integer",
            "null"
          ]
        },
        "approvedWinRate": {
          "type": [
            "number",
            "null"
          ]
        },
        "proofScreenshots": {
          "type": "array",
          "items": {
            "type": "string"
          }
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
          "type": "string",
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
          ],
          "enum": [
            "SCREENSHOT_MISMATCH",
            "SCREENSHOT_UNREADABLE",
            "INSUFFICIENT_PROOF",
            "SUSPECTED_FRAUD",
            "OTHER",
            null
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
          ],
          "enum": [
            "CHEATING_FORGERY",
            "WRONG_REVIEW",
            "PLAYER_IDENTITY_ISSUE",
            "DATA_ERROR",
            "ADMIN_CORRECTION",
            "OTHER",
            null
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
    "Mark3ReplayEvidence": {
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
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      }
    },
    "HofUploadResponse": {
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "status",
            "arenaId"
          ],
          "properties": {
            "status": {
              "type": "string",
              "enum": [
                "ok",
                "already_recorded"
              ]
            },
            "arenaId": {
              "type": "string"
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "status",
            "arenaId",
            "reasonCode"
          ],
          "properties": {
            "status": {
              "type": "string",
              "const": "skipped"
            },
            "arenaId": {
              "type": "string"
            },
            "reasonCode": {
              "type": "string",
              "enum": [
                "DUPLICATE_OR_UNKNOWN_RECORDER",
                "REPLAY_HASH_CONFLICT"
              ]
            }
          }
        }
      ]
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
    "HallOfFameBattleType": {
      "type": "string",
      "enum": [
        "RANDOM",
        "RATING"
      ]
    },
    "HallOfFameRecord": {
      "type": "object",
      "description": "公开单场榜单记录；rank 为分页筛选上下文中的正整数排名。",
      "additionalProperties": false,
      "required": [
        "id",
        "rank",
        "tankId",
        "tankName",
        "nickname",
        "damageDealt",
        "battleType",
        "mapName",
        "version",
        "battleTime",
        "createdAt",
        "replayAvailable"
      ],
      "properties": {
        "id": {
          "type": "integer",
          "format": "int64"
        },
        "rank": {
          "type": "integer",
          "minimum": 1
        },
        "tankId": {
          "type": "integer",
          "format": "int64"
        },
        "tankName": {
          "type": "string"
        },
        "nickname": {
          "type": "string"
        },
        "damageDealt": {
          "type": "integer"
        },
        "battleType": {
          "$ref": "#/$defs/HallOfFameBattleType"
        },
        "mapName": {
          "type": [
            "string",
            "null"
          ]
        },
        "version": {
          "type": [
            "string",
            "null"
          ]
        },
        "battleTime": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "replayAvailable": {
          "type": "boolean"
        }
      }
    },
    "PersonalHallOfFameRecord": {
      "type": "object",
      "description": "个人单场记录；rank 不适用于个人记录并固定为 null，归属仅按 accountId。",
      "additionalProperties": false,
      "required": [
        "id",
        "rank",
        "tankId",
        "tankName",
        "nickname",
        "damageDealt",
        "battleType",
        "mapName",
        "version",
        "battleTime",
        "createdAt",
        "replayAvailable"
      ],
      "properties": {
        "id": {
          "type": "integer",
          "format": "int64"
        },
        "rank": {
          "type": "null"
        },
        "tankId": {
          "type": "integer",
          "format": "int64"
        },
        "tankName": {
          "type": "string"
        },
        "nickname": {
          "type": "string"
        },
        "damageDealt": {
          "type": "integer"
        },
        "battleType": {
          "$ref": "#/$defs/HallOfFameBattleType"
        },
        "mapName": {
          "type": [
            "string",
            "null"
          ]
        },
        "version": {
          "type": [
            "string",
            "null"
          ]
        },
        "battleTime": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "replayAvailable": {
          "type": "boolean"
        }
      }
    },
    "HallOfFamePage": {
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
            "$ref": "#/$defs/HallOfFameRecord"
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
    "OnboardingReceipt": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "coreEpoch",
        "disposition"
      ],
      "properties": {
        "coreEpoch": {
          "type": "integer",
          "format": "int32",
          "minimum": 0,
          "maximum": 2147483647
        },
        "disposition": {
          "type": "string",
          "enum": [
            "NONE",
            "COMPLETED",
            "SKIPPED"
          ]
        }
      }
    },
    "SaveOnboardingReceipt": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "coreEpoch",
        "disposition"
      ],
      "properties": {
        "coreEpoch": {
          "type": "integer",
          "format": "int32",
          "minimum": 1,
          "maximum": 2147483647
        },
        "disposition": {
          "type": "string",
          "enum": [
            "COMPLETED",
            "SKIPPED"
          ]
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
    "UpdateWotbAccountRequest": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
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
        }
      }
    },
    "VerifyWotbAccountFromReplayRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "recorderAccountId"
      ],
      "properties": {
        "recorderAccountId": {
          "type": "integer",
          "format": "int64"
        }
      }
    },
    "AdminUserDetail": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "keycloakUserId",
        "profile",
        "keycloak",
        "warnings"
      ],
      "properties": {
        "keycloakUserId": {
          "type": "string"
        },
        "profile": {
          "anyOf": [
            {
              "$ref": "#/$defs/AdminUserDetailProfile"
            },
            {
              "type": "null"
            }
          ]
        },
        "keycloak": {
          "anyOf": [
            {
              "$ref": "#/$defs/AdminUserDetailKeycloak"
            },
            {
              "type": "null"
            }
          ]
        },
        "warnings": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    },
    "AdminUserDetailProfile": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "displayName",
        "wotbNickname",
        "wotbServer",
        "createdAt",
        "updatedAt",
        "wotbAccountId"
      ],
      "properties": {
        "id": {
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
        "createdAt": {
          "type": [
            "string",
            "null"
          ]
        },
        "updatedAt": {
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
        }
      }
    },
    "AdminUserDetailKeycloak": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "username",
        "email",
        "firstName",
        "lastName",
        "enabled",
        "federatedIdentities"
      ],
      "properties": {
        "id": {
          "type": [
            "string",
            "null"
          ]
        },
        "username": {
          "type": [
            "string",
            "null"
          ]
        },
        "email": {
          "type": [
            "string",
            "null"
          ]
        },
        "firstName": {
          "type": [
            "string",
            "null"
          ]
        },
        "lastName": {
          "type": [
            "string",
            "null"
          ]
        },
        "enabled": {
          "type": "boolean"
        },
        "federatedIdentities": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/AdminUserFederatedIdentity"
          }
        }
      }
    },
    "AdminUserFederatedIdentity": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "identityProvider",
        "userId",
        "userName"
      ],
      "properties": {
        "identityProvider": {
          "type": [
            "string",
            "null"
          ]
        },
        "userId": {
          "type": [
            "string",
            "null"
          ]
        },
        "userName": {
          "type": [
            "string",
            "null"
          ]
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
        },
        "hpState": {
          "description": "canonical 层对 hpRaw 的权威分类（HpRawState）。服务端不得重新分类。客户端投影恒发送该字段 （v0.4.9 起的 pinned producer 路径）；字段缺省只出现在旧载荷上，此时服务端按 hpRaw 现算 （legacy 语义：仅 0/0xFFFD 终态）。",
          "type": "string",
          "enum": [
            "CURRENT_HP",
            "HP_ZERO_TERMINAL",
            "DEATH_TERMINAL_FFFD",
            "DEATH_TERMINAL",
            "UNKNOWN_FFFF",
            "UNKNOWN_OTHER"
          ]
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
        },
        "hpState": {
          "description": "同 AiProjectionProp3Health.hpState：canonical 权威分类（客户端投影恒发送）；缺省 = 旧载荷 （legacy 现算）。",
          "type": "string",
          "enum": [
            "CURRENT_HP",
            "HP_ZERO_TERMINAL",
            "DEATH_TERMINAL_FFFD",
            "DEATH_TERMINAL",
            "UNKNOWN_FFFF",
            "UNKNOWN_OTHER"
          ]
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
        "damageDealtSamples": {
          "description": "Optional recorded cumulative damage broadcasts. Absent in older datasets and on players without this evidence; never populated from final settlement totals.",
          "type": "array",
          "items": {
            "$ref": "#/$defs/DamageDealtSample"
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
    "DamageDealtSample": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "timeSec",
        "total"
      ],
      "properties": {
        "timeSec": {
          "type": "number",
          "minimum": 0
        },
        "total": {
          "type": "integer",
          "minimum": 0
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
        "CREATOR_NOT_FOUND",
        "CREATOR_INVALID_REQUEST",
        "RECOMMENDATION_ID_ALREADY_EXISTS",
        "CREATOR_UID_ALREADY_EXISTS",
        "CREATOR_CATEGORY_IN_USE",
        "CREATOR_LEVEL_IN_USE",
        "CREATOR_CONFIG_CONFLICT",
        "CREATOR_STORAGE_UNAVAILABLE",
        "CREATOR_AVATAR_NOT_FOUND",
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
        "TOURNAMENT_CSV_INVALID",
        "TOURNAMENT_CSV_WORKSPACE_BUSY",
        "BROADCAST_VERSION_CONFLICT",
        "BROADCAST_NODE_CONFLICT",
        "BROADCAST_COVER_INVALID",
        "BROADCAST_STORAGE_UNAVAILABLE",
        "BROADCAST_STORAGE_ERROR",
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
        "FILE_TOO_LARGE",
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
    },
    "Mark3RejectRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "rejectReason"
      ],
      "properties": {
        "rejectReason": {
          "type": "string",
          "enum": [
            "SCREENSHOT_MISMATCH",
            "SCREENSHOT_UNREADABLE",
            "INSUFFICIENT_PROOF",
            "SUSPECTED_FRAUD",
            "OTHER"
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
    "Mark3DeleteRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "deleteReason"
      ],
      "properties": {
        "deleteReason": {
          "type": "string",
          "enum": [
            "CHEATING_FORGERY",
            "WRONG_REVIEW",
            "PLAYER_IDENTITY_ISSUE",
            "DATA_ERROR",
            "ADMIN_CORRECTION",
            "OTHER"
          ]
        },
        "deleteReasonText": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    }
  }
} as const
