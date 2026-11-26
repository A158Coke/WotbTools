import {
  BookOpen, Database, CircleUser, Clapperboard, House, Map, Menu, MessageSquare, Network, Radio, ShieldCheck, Trophy, Users, ListOrdered, Settings,
} from 'lucide-vue-next'

export const PRIMARY_NAV_ICONS = Object.freeze({
  home: House,
  replay: Clapperboard,
  hof: Trophy,
  tankopedia: BookOpen,
  techtree: Network,
  maps: Map,
  'tournament-points': ListOrdered,
  'league-broadcasts': Radio,
  creators: Users,
  more: Menu,
})

export const ADMIN_NAV_ICONS = Object.freeze({
  'admin-users': Users,
  'admin-battle-data': Database,
  'admin-ai-review-feedback': Users,
  'admin-site-feedback': MessageSquare,
  'hof-admin': ShieldCheck,
  'tournament-points-config': Settings,
  'tournament-points-admin': ListOrdered,
  'creators-config': Users,
})

export const ACCOUNT_ICON = CircleUser
