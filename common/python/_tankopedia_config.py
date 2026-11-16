"""Tankopedia input endpoints, output paths and BlitzKit field constants."""
import os
from blitzkit_snapshot import BLITZKIT_API_BASE

PB_URL = f"{BLITZKIT_API_BASE}/definitions/tanks.pb"
CONSUMABLES_URL = f"{BLITZKIT_API_BASE}/definitions/consumables.pb"
PROVISIONS_URL = f"{BLITZKIT_API_BASE}/definitions/provisions.pb"
EQUIPMENT_URL = f"{BLITZKIT_API_BASE}/definitions/equipment.pb"

REPO_COMMON_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "common",
)
TIER_FILES = {tier: f"tankopedia-tier{tier}.json" for tier in range(1, 11)}
# 物资/装备的现有 reviewed 模型范围；基础车型资料独立覆盖 1–10 级。
MODELED_ITEM_TIERS = frozenset(range(7, 11))
MIN_TIER_COUNT_RATIO = 0.8
CATALOG_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "common",
    "wotb-item-catalog-json",
)

# ---- tanks.pb 字段号（TankDefinition） ----
FIELD_TANK_ID = 1
FIELD_TANK_DATA = 2
FIELD_TANK_HULL_HP = 10
FIELD_TANK_NATION = 11
FIELD_TANK_NAME = 12
FIELD_TANK_TIER = 16
FIELD_TANK_CLASS = 17
FIELD_TANK_TURRETS = 20
FIELD_TANK_ENGINES = 21
FIELD_TANK_TRACKS = 22
FIELD_TANK_SPEED_FORWARD = 25
FIELD_TANK_SPEED_BACKWARD = 26
FIELD_TANK_WEIGHT = 31
FIELD_TANK_EQUIPMENT_PRESET = 30

# ---- 炮塔 / 炮 / 引擎 / 履带 / 弹 ----
FIELD_TURRET_HP = 2
FIELD_TURRET_TRAVERSE = 4
FIELD_TURRET_TIER = 7
FIELD_TURRET_GUN = 9
FIELD_GUN_ID = 4
FIELD_GUN_TIER = 9
FIELD_GUN_SHELLS = 10
FIELD_ENGINE_TIER = 4
FIELD_ENGINE_POWER = 6
FIELD_TRACK_TIER = 2
FIELD_TRACK_TRAVERSE = 5
FIELD_SHELL_TYPE = 7
FIELD_SHELL_DAMAGE = 4
FIELD_SHELL_PEN = 8
FIELD_PEN_VALUE = 1

# ---- consumables.pb / provisions.pb（map 条目 + 过滤器） ----
FIELD_MAP_KEY = 1
FIELD_MAP_VALUE = 2
FIELD_ITEM_NAME = 2
FIELD_ITEM_INCLUDE = 6
FIELD_ITEM_EXCLUDE = 7
FILTER_TIERS = 1
FILTER_IDS = 2
FILTER_CATEGORIES = 3
FILTER_NATIONS = 4
FILTER_CATEGORY_CLIP = 0

CLASS_TO_EN = {
    0: "Light tank",
    1: "Medium tank",
    2: "Heavy tank",
    3: "Tank destroyer",
}

NATION_TO_EN = {
    "ussr": "USSR",
    "germany": "Germany",
    "usa": "USA",
    "china": "China",
    "france": "France",
    "uk": "UK",
    "japan": "Japan",
    "european": "European",
    "other": "Other",
}

# blitzkit 弹型字符串 -> 归一化类型
SHELL_TYPE_NORM = {
    "ap": "ap",
    "ap_premium": "ap",
    "ap_cr": "apcr",
    "ap_cr_premium": "apcr",
    "hc": "heat",
    "hc_premium": "heat",
    "atgm_heat": "heat",
    "he": "he",
    "he_premium": "he",
}
