"""
WOTB 地图名称映射 (mapName -> 中文名)
数据来源: 录像 meta.json 中的 mapName 字段
"""

MAP_NAMES = {
    "canal":         "运河尽头",
    "desert_train":  "黄沙荒漠",
    "erlenberg":     "米德尔堡",
    "forgecity":     "都市港口",
    "fort":          "绝望堡垒",
    "italy":         "葡萄庄园",
    "lagoon":        "海岸礁湖",
    "lumber":        "山麓角逐",
    "malinovka":     "马利诺夫卡",
    "plant":         "幽灵工厂",
    "pliego":        "卡斯提拉",
    "port":          "港湾小镇",
    "rock":          "古老秘境",
    "savanna":       "沙漠之心",
    # 以下地图暂无录像 mapId，待补充
    "karelia":       "乱石荒野",
    "karieri":       "铜矿采集场",
    "amigosville":   "乡间溪流",
    "medvedkovo":    "废弃轨道",
    "himmelsdorf":   "锡默尔斯多夫",
    "mountain":      "暗金矿窑",
    "milbase":       "落日军港",
    "canyon":        "夺命峡谷",
    "skit":          "海防前沿",
    "faust":         "浮士德",
    "neptune":       "滩涂阵地",
    "rift":          "海拉斯",
    "idle":          "峪崆",
    "holmeisk":      "废弃之地",
    "holland":       "莫伦迪克",
}


def get_map_cn_name(map_name):
    """根据录像 mapName 获取中文名，未匹配则返回原始名称"""
    if not map_name:
        return map_name
    return MAP_NAMES.get(map_name.lower().strip(), map_name)
