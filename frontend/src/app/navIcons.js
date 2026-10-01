import { CircleUser, Clapperboard, House, Menu, Trophy } from 'lucide-vue-next'

// 主导航图标（顶栏与底部 Tab 栏共用，键为 PRIMARY_NAV.id）
export const PRIMARY_NAV_ICONS = Object.freeze({
  home: House,
  replay: Clapperboard,
  hof: Trophy,
  more: Menu,
})

// 账户入口（顶栏右侧头像，进入个人中心）
export const ACCOUNT_ICON = CircleUser
