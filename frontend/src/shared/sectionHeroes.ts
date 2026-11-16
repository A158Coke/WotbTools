// 分区主视觉（design-language §2「分区主视觉」）：每个导航分区固定一张 key visual，不随季节切换。
// 原图在 frontend/art-source/heroes/，产物由 scripts/build-section-heroes.mjs 生成到 assets/theme/。
// 这里同时维护背景焦点位置：桌面横版取 center（宽幅只裁上下），竖屏取偏左的百分比，
// 把主体留在画面右侧，避免被左下角的标题盖住。
import heroAdmin from '../assets/theme/hero-admin.webp'
import heroCommunity from '../assets/theme/hero-community.webp'
import heroDocs from '../assets/theme/hero-docs.webp'
import heroEvents from '../assets/theme/hero-events.webp'
import heroHof from '../assets/theme/hero-hof.webp'
import heroMaps from '../assets/theme/hero-maps.webp'
import heroMark3 from '../assets/theme/hero-mark3.webp'
import heroProfile from '../assets/theme/hero-profile.webp'
import heroReplay from '../assets/theme/hero-replay.webp'
import heroTankopedia from '../assets/theme/hero-tankopedia.webp'
import heroTechtree from '../assets/theme/hero-techtree.webp'

export const SECTION_HERO_IDS = [
  'hof',
  'mark3',
  'replay',
  'tankopedia',
  'techtree',
  'maps',
  'events',
  'community',
  'profile',
  'docs',
  'admin',
] as const

export type SectionHeroId = (typeof SECTION_HERO_IDS)[number]

interface SectionHero {
  image: string
  position: string
  mobilePosition: string
  /** 紧凑横幅的焦点位置：可见带约 43%，对准主体中线；缺省回退 position */
  compactPosition?: string
}

export const SECTION_HEROES: Record<SectionHeroId, SectionHero> = {
  hof: { image: heroHof, position: 'center 45%', mobilePosition: '22% center' },
  mark3: { image: heroMark3, position: 'center 45%', mobilePosition: '18% center' },
  replay: { image: heroReplay, position: 'center 48%', mobilePosition: '45% center', compactPosition: 'center 50%' },
  tankopedia: { image: heroTankopedia, position: 'center 45%', mobilePosition: '18% center' },
  techtree: { image: heroTechtree, position: 'center 45%', mobilePosition: '42% center', compactPosition: 'center 58%' },
  maps: { image: heroMaps, position: 'center 45%', mobilePosition: '22% center' },
  events: { image: heroEvents, position: 'center 45%', mobilePosition: '40% center' },
  community: { image: heroCommunity, position: 'center 45%', mobilePosition: '45% center' },
  profile: { image: heroProfile, position: 'center 45%', mobilePosition: '45% center' },
  docs: { image: heroDocs, position: 'center 45%', mobilePosition: '42% center' },
  admin: { image: heroAdmin, position: 'center 45%', mobilePosition: '40% center' },
}

/** ShowcaseHero / 卡片背景用：把图片与焦点位置注入成 CSS 变量，四套主题共用同一张图。 */
export function sectionHeroStyle(section: SectionHeroId): Record<string, string> {
  const hero = SECTION_HEROES[section]
  return {
    '--hero-image': `url("${hero.image}")`,
    '--hero-pos': hero.position,
    '--hero-pos-mobile': hero.mobilePosition,
    ...(hero.compactPosition ? { '--hero-pos-compact': hero.compactPosition } : {}),
  }
}
