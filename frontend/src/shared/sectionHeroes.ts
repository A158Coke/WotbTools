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

export const SECTION_HERO_IDS = [
  'hof',
  'mark3',
  'replay',
  'tankopedia',
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
  compactPosition?: string
}

export const SECTION_HEROES: Record<SectionHeroId, SectionHero> = {
  hof: { image: heroHof, position: 'center 45%', mobilePosition: '22% center' },
  mark3: { image: heroMark3, position: 'center 45%', mobilePosition: '18% center' },
  replay: { image: heroReplay, position: 'center 48%', mobilePosition: '45% center', compactPosition: 'center 50%' },
  tankopedia: { image: heroTankopedia, position: 'center 45%', mobilePosition: '18% center' },
  maps: { image: heroMaps, position: 'center 45%', mobilePosition: '22% center' },
  events: { image: heroEvents, position: 'center 45%', mobilePosition: '40% center' },
  community: { image: heroCommunity, position: 'center 45%', mobilePosition: '45% center' },
  profile: { image: heroProfile, position: 'center 45%', mobilePosition: '45% center' },
  docs: { image: heroDocs, position: 'center 45%', mobilePosition: '42% center' },
  admin: { image: heroAdmin, position: 'center 45%', mobilePosition: '40% center' },
}

export function sectionHeroStyle(section: SectionHeroId): Record<string, string> {
  const hero = SECTION_HEROES[section]
  return {
    '--hero-image': `url("${hero.image}")`,
    '--hero-pos': hero.position,
    '--hero-pos-mobile': hero.mobilePosition,
    ...(hero.compactPosition ? { '--hero-pos-compact': hero.compactPosition } : {}),
  }
}
