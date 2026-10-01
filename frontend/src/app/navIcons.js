import {
  BookOpen, CircleUser, Clapperboard, House, Menu, ShieldCheck, Trophy, Users,
} from 'lucide-vue-next'

// 主导航图标（侧边栏与底部 Tab 栏共用，键为 PRIMARY_NAV.id / ADMIN_NAV.id）
export const PRIMARY_NAV_ICONS = Object.freeze({
  home: House,
  replay: Clapperboard,
  hof: Trophy,
  tankopedia: BookOpen,
  more: Menu,
})

export const ADMIN_NAV_ICONS = Object.freeze({
  'admin-users': Users,
  'hof-admin': ShieldCheck,
})

// 账户入口（进入个人中心）
export const ACCOUNT_ICON = CircleUser
