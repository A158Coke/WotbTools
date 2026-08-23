import TANKOPEDIA from '../../../common/tankopedia-tier10.json'

const NATION_CODES = {
  China: 'CHINA', European: 'EUROPE', France: 'FRANCE', Germany: 'GERMANY',
  Japan: 'JAPAN', Other: 'OTHER', UK: 'UK', USA: 'USA', USSR: 'USSR',
}

const VEHICLE_TYPE_CODES = {
  'Heavy tank': 'HEAVY_TANK', 'Medium tank': 'MEDIUM_TANK',
  'Light tank': 'LIGHT_TANK', 'Tank destroyer': 'TANK_DESTROYER',
}

/** 百场页面共用的 Tier X 车辆筛选选项，分类值统一为 API 稳定英文码。 */
export const HUNDRED_VEHICLES = TANKOPEDIA.vehicles
  .map(vehicle => ({
    id: vehicle.id,
    name: vehicle.name,
    nation: NATION_CODES[vehicle.nation] || 'OTHER',
    vehicleType: VEHICLE_TYPE_CODES[vehicle.class] || 'OTHER',
  }))
  .sort((a, b) => a.name.localeCompare(b.name))
