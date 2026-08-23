<script setup>
import { computed, onMounted, ref } from 'vue'
import * as api from '../utils/api.js'
import desertSandsImg from '../assets/maps/desert-sands.png'
import leopardPortrait from '../assets/tank-portraits/tier-x/14609.webp'

const topRecord = ref(null)
const topDamageDisplay = computed(() => {
  const damage = Number(topRecord.value?.damageDealt)
  return Number.isFinite(damage) ? formatDamage(damage) : '--'
})

onMounted(loadTopDamageRecord)

async function loadTopDamageRecord() {
  try {
    const res = await api.hofList({ page: 1, size: 1 })
    topRecord.value = res?.items?.[0] ?? null
  } catch {
    topRecord.value = null
  }
}
function formatDamage(value) { return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') }
</script>

<template>
  <main class="homepage-showcase">
    <section class="showcase-hero">
      <img class="hero-map" :src="desertSandsImg" alt="" aria-hidden="true">
      <div class="hero-atmosphere" aria-hidden="true"></div>
      <img class="hero-tank" :src="leopardPortrait" alt="" aria-hidden="true">

      <div class="hero-copy">
        <img class="hero-logo" src="/wotbtoolslogo.png" alt="WoTBTools">
        <p class="hero-kicker">WOTBTOOLS · BATTLE INTELLIGENCE</p>
        <h1>{{ $t('app.title') }}</h1>
        <p class="hero-subtitle">{{ $t('app.subtitle') }}</p>
        <div class="hero-actions">
          <a class="hero-btn primary" href="/?view=replay">{{ $t('home.uploadReplay') }}</a>
          <a class="hero-btn secondary" href="/?view=replay">{{ $t('home.analysisTitle') }}</a>
        </div>
      </div>
      <aside class="record-card">
        <span>{{ $t('home.highestDamageRecord') }}</span>
        <strong>{{ topDamageDisplay }}</strong>
        <div v-if="topRecord" class="record-meta">
          <b>{{ topRecord.tankName || topRecord.vehicleName || '—' }}</b>
          <small>{{ topRecord.nickname || topRecord.playerNickname || '—' }}</small>
          <small>{{ topRecord.map || topRecord.mapName || '—' }}</small>
        </div>
      </aside>
    </section>

    <section class="feature-grid" aria-label="WotBTools">
      <a class="feature-card feature-primary" href="/?view=replay">
        <div class="feature-visual replay-visual"><img :src="leopardPortrait" alt="" aria-hidden="true"><span class="feature-index">01</span></div>
        <div class="feature-copy"><h2>{{ $t('home.analysisTitle') }}</h2><p>{{ $t('home.analysisDesc') }}</p><span class="feature-action">{{ $t('home.uploadReplay') }} →</span></div>
      </a>
      <a class="feature-card" href="/?view=hof">
        <div class="feature-visual hof-visual"><div class="medal" aria-hidden="true">1</div><span class="feature-index">02</span></div>
        <div class="feature-copy"><h2>{{ $t('hof.btn') }}</h2><p>{{ $t('home.hofDesc') }}</p><span class="feature-action">{{ $t('hof.btn') }} →</span></div>
      </a>
      <a class="feature-card" href="/?view=boost">
        <div class="feature-visual map-visual"><img :src="desertSandsImg" alt="" aria-hidden="true"><span class="feature-index">03</span></div>
        <div class="feature-copy"><h2>{{ $t('app.boost_tab') }}</h2><p>{{ $t('home.boostDesc') }}</p><span class="feature-action">{{ $t('app.boost_tab') }} →</span></div>
      </a>
      <a class="feature-card" href="/sponsor.html">
        <div class="feature-visual support-visual"><img src="/wotbtoolslogo.png" alt="" aria-hidden="true"><span class="feature-index">SP</span></div>
        <div class="feature-copy"><h2>{{ $t('home.sponsorTitle') }}</h2><p>{{ $t('home.sponsorDesc') }}</p><span class="feature-action">{{ $t('home.sponsorTag') }} →</span></div>
      </a>
    </section>

    <section class="home-bottom">
      <div class="bottom-panel replay-panel">
        <div class="bottom-copy"><span class="panel-kicker">{{ $t('home.analysisTitle') }}</span><h2>{{ $t('upload.title') }}</h2><p>{{ $t('upload.description') }}</p>
          <div class="panel-actions"><a class="mini-action primary" href="/?view=replay">{{ $t('upload.select_files') }}</a><a class="mini-action" href="/?view=replay">{{ $t('upload.select_folder') }}</a></div>
        </div><div class="replay-decoration" aria-hidden="true"><span></span><span></span><span></span></div>
      </div>
      <div class="bottom-panel quick-panel"><h2>{{ $t('app.title') }}</h2><a href="/?view=version">{{ $t('version.btn') }} <span>→</span></a><a href="/?view=contact">{{ $t('contact.nav') }} <span>→</span></a><a href="https://github.com/A158Coke/WotbTools/issues/new" target="_blank" rel="noopener">{{ $t('app.feedback') }} <span>→</span></a><a href="/sponsor.html">{{ $t('home.sponsorTitle') }} <span>→</span></a></div>
    </section>
    <footer class="home-footer">{{ $t('home.footer') }}</footer>
  </main>
</template>

<style scoped>
.homepage-showcase{width:min(1680px,calc(100vw - 40px));margin:0 auto;padding:20px 0 40px}.showcase-hero{position:relative;min-height:430px;overflow:hidden;border:1px solid rgba(213,146,28,.34);border-radius:10px;background:#090d11;box-shadow:0 24px 64px rgba(0,0,0,.36)}.hero-map{position:absolute;inset:-8%;width:116%;height:116%;object-fit:cover;filter:saturate(.68) contrast(1.08) brightness(.5) blur(1px);transform:scale(1.04)}.showcase-hero:before{content:'';position:absolute;z-index:1;inset:0;background:linear-gradient(90deg,rgba(4,8,12,.98) 0%,rgba(4,8,12,.9) 34%,rgba(4,8,12,.32) 66%,rgba(4,8,12,.64) 100%)}.hero-atmosphere{position:absolute;z-index:1;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.02),transparent 58%,rgba(0,0,0,.56)),radial-gradient(circle at 68% 49%,rgba(229,148,21,.24),transparent 26%),repeating-linear-gradient(135deg,transparent 0 44px,rgba(255,255,255,.018) 44px 45px)}.hero-tank{position:absolute;z-index:2;right:11%;bottom:2%;width:min(610px,45vw);height:80%;object-fit:contain;object-position:center bottom;transform:scale(1.42);transform-origin:center bottom;filter:drop-shadow(0 32px 30px rgba(0,0,0,.62)) saturate(.92) contrast(1.08);opacity:.96}.hero-copy{position:relative;z-index:3;width:min(650px,50%);padding:52px;color:#f7f4ed}.hero-logo{width:62px;height:62px;object-fit:contain}.hero-kicker{margin:18px 0 8px;color:#d59a32;font-size:.7rem;font-weight:800;letter-spacing:.14em}.showcase-hero h1{margin:0;font-size:clamp(2.7rem,4.3vw,4.8rem);line-height:.98;letter-spacing:-.04em;color:#fff;text-shadow:0 6px 32px #000}.hero-subtitle{margin:18px 0 0;max-width:580px;color:rgba(255,255,255,.78);font-size:1.04rem;line-height:1.6}.hero-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:28px}.hero-btn{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:0 22px;border-radius:6px;font-weight:800;text-decoration:none;transition:.18s}.hero-btn:hover{text-decoration:none;transform:translateY(-1px)}.hero-btn.primary{background:linear-gradient(180deg,#ffbc38,#d9850b);border:1px solid #ffb52a;color:#171006;box-shadow:0 12px 32px rgba(224,139,16,.28)}.hero-btn.secondary{border:1px solid rgba(255,255,255,.25);background:rgba(7,12,17,.68);color:#fff;backdrop-filter:blur(8px)}.record-card{position:absolute;z-index:4;right:30px;top:50%;width:250px;padding:18px 20px;transform:translateY(-50%);border:1px solid rgba(222,153,38,.46);border-radius:8px;background:rgba(6,11,16,.84);color:#fff;box-shadow:0 18px 42px rgba(0,0,0,.36);backdrop-filter:blur(12px)}.record-card>span{display:block;color:rgba(255,255,255,.62);font-size:.76rem}.record-card>strong{display:block;margin:4px 0 12px;color:#ffad24;font-size:2.3rem;font-variant-numeric:tabular-nums}.record-meta{display:grid;gap:3px;padding-top:10px;border-top:1px solid rgba(255,255,255,.12)}.record-meta small{color:rgba(255,255,255,.58)}.feature-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-top:14px}.feature-card{min-width:0;overflow:hidden;border:1px solid var(--border);border-radius:9px;background:var(--bg-card);color:inherit;text-decoration:none;box-shadow:var(--surface-shadow);transition:.18s}.feature-card:hover{transform:translateY(-2px);border-color:#d99a25;box-shadow:0 18px 36px rgba(190,120,12,.14);text-decoration:none}.feature-primary{border-color:color-mix(in srgb,#d99a25 40%,var(--border))}.feature-visual{position:relative;height:132px;overflow:hidden;border-bottom:1px solid var(--border);background:var(--bg-card2)}.feature-visual:after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,transparent 28%,color-mix(in srgb,var(--bg-card) 88%,transparent))}.feature-visual img{width:100%;height:100%;object-fit:cover}.replay-visual img{object-fit:contain;transform:scale(1.25);filter:drop-shadow(0 16px 16px rgba(0,0,0,.35))}.map-visual img{filter:saturate(.78) contrast(1.04) brightness(.78)}.support-visual{display:grid;place-items:center;background:radial-gradient(circle,color-mix(in srgb,#d99a25 14%,var(--bg-card2)),var(--bg-card2) 66%)}.support-visual img{width:72px;height:72px;object-fit:contain}.hof-visual{display:grid;place-items:center;background:radial-gradient(circle at 50% 45%,color-mix(in srgb,#d99a25 18%,var(--bg-card2)),var(--bg-card2) 68%)}.medal{position:relative;z-index:1;width:64px;height:64px;display:grid;place-items:center;border:2px solid #d99a25;border-radius:50%;color:#f4b23b;font-size:1.8rem;font-weight:900;box-shadow:0 0 0 8px rgba(217,154,37,.09)}.feature-index{position:absolute;z-index:2;right:12px;top:10px;color:#d99a25;font-weight:900;font-size:.76rem;letter-spacing:.08em}.feature-copy{padding:16px 18px 18px}.feature-copy h2{margin:0 0 7px;font-size:1.12rem}.feature-copy p{min-height:42px;margin:0;color:var(--text-muted);font-size:.82rem;line-height:1.55}.feature-action{display:inline-block;margin-top:12px;color:#d58b19;font-size:.8rem;font-weight:800}.home-bottom{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(270px,.65fr);gap:14px;margin-top:14px}.bottom-panel{border:1px solid var(--border);border-radius:9px;background:var(--bg-card);box-shadow:var(--surface-shadow)}.replay-panel{position:relative;overflow:hidden;min-height:170px;padding:22px}.replay-panel:after{content:'';position:absolute;inset:0 0 0 auto;width:43%;background:linear-gradient(90deg,transparent,rgba(217,154,37,.07));pointer-events:none}.bottom-copy{position:relative;z-index:2;max-width:640px}.panel-kicker{color:#d58b19;font-size:.72rem;font-weight:900;letter-spacing:.08em}.bottom-copy h2{margin:7px 0 6px;font-size:1.2rem}.bottom-copy p{margin:0;color:var(--text-muted);font-size:.84rem;line-height:1.55}.panel-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:15px}.mini-action{display:inline-flex;min-height:34px;align-items:center;padding:0 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card2);color:var(--text);font-size:.78rem;font-weight:700;text-decoration:none}.mini-action:hover{text-decoration:none;border-color:#d99a25}.mini-action.primary{border-color:#d99a25;background:#d58b19;color:#171006}.replay-decoration{position:absolute;right:28px;top:30px;display:grid;gap:12px;width:220px;opacity:.55}.replay-decoration span{height:12px;border:1px solid rgba(217,154,37,.38);transform:skewX(-18deg)}.replay-decoration span:nth-child(2){margin-left:28px}.replay-decoration span:nth-child(3){margin-left:58px}.quick-panel{padding:16px 18px}.quick-panel h2{margin:0 0 8px;font-size:.95rem}.quick-panel a{display:flex;align-items:center;min-height:32px;border-top:1px solid var(--border);color:var(--text-muted);font-size:.78rem;text-decoration:none}.quick-panel a:hover{color:#d58b19;text-decoration:none}.quick-panel a span{margin-left:auto}.home-footer{margin-top:24px;padding:14px 0 0;border-top:1px solid var(--border);text-align:center;font-size:.72rem;color:var(--text-muted)}
@media(max-width:1199px){.homepage-showcase{width:calc(100vw - 28px)}.showcase-hero{min-height:400px}.hero-copy{width:62%;padding:42px 34px}.hero-tank{right:8%;width:min(520px,49vw)}.record-card{right:18px;width:220px}.feature-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.home-bottom{grid-template-columns:1fr}}
@media(max-width:767px){.homepage-showcase{width:calc(100vw - 16px);padding-top:8px}.showcase-hero{min-height:540px}.hero-map{inset:0;width:100%;height:100%}.showcase-hero:before{background:linear-gradient(180deg,rgba(4,8,12,.9) 0%,rgba(4,8,12,.7) 54%,rgba(4,8,12,.97) 100%)}.hero-tank{right:50%;bottom:112px;width:82vw;height:auto;transform:translateX(50%) scale(1.15);opacity:.55}.hero-copy{width:100%;padding:24px 20px}.hero-logo{width:48px;height:48px}.showcase-hero h1{font-size:2.45rem}.hero-subtitle{font-size:.92rem}.hero-actions{flex-direction:column}.hero-btn{width:100%}.record-card{left:14px;right:14px;top:auto;bottom:14px;width:auto;transform:none}.record-card>strong{font-size:1.85rem}.feature-grid{grid-template-columns:1fr}.feature-visual{height:112px}.feature-copy p{min-height:0}.replay-decoration{display:none}.replay-panel{padding:18px}}
</style>