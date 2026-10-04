<script setup>
// 2D 回放控制条：共用的 PlaybackTransport（播放 / 跳秒 / 速度 / 时间 / 进度条）+ 2D 特有按钮。
// 3D 回放用同一个 PlaybackTransport 配自己的按钮。
//
// **主 / 次分层（与 3D 同一契约）**：
//   PRIMARY（常驻主面）＝ 传输控件（时间轴 / 播放 / ±5 / 当前速度）+ **全屏** + 二级面入口；
//   SECONDARY（二级面）＝ 面板 / 标注 / 重置视图等渲染器专属工具。
// 手机形态下主面只留 PRIMARY：五个速度档已改渐进披露，渲染器工具再常驻就会把地图挤掉
// （3D 侧同一问题已按此收敛）。宽档保留在原位——契约允许宽档用更宽的呈现，且那里空间足够。
import { Maximize2, Minimize2, PanelLeft, PencilLine, SlidersHorizontal } from 'lucide-vue-next'
import { usePlaybackPhoneForm } from '../composables/usePlaybackPhoneForm.js'
import PlaybackTransport from './PlaybackTransport.vue'

defineOptions({ name: 'PlaybackControls' })

// 手机形态下速度档位改成渐进披露（含全屏横屏）：五个档位常驻会独占一整行，
// 把地图/战场挤掉。两个形态共用同一个 PlaybackTransport 与同一份 speed 状态。
const { isPhone } = usePlaybackPhoneForm()

const props = defineProps({
  playing: Boolean,
  speed: { type: Number, default: 1 },
  currentTime: { type: Number, default: 0 },
  duration: { type: Number, default: 0 },
  fullscreenSupported: Boolean,
  isFullscreen: Boolean,
  // §right-rail：左边 Left Rail 可见时，底部右侧的 面板/标注/重置/全屏 与其重叠 → 隐藏。
  railVisible: Boolean,
  formatClock: { type: Function, required: true },
})

const emit = defineEmits([
  'toggle-play', 'step', 'set-speed', 'reset-view', 'toggle-fullscreen',
  'toggle-panels', 'toggle-annotation', 'drag-start', 'drag-end', 'seek',
])
</script>

<template>
  <PlaybackTransport
    :playing="props.playing"
    :speed="props.speed"
    :current-time="props.currentTime"
    :duration="props.duration"
    :rail-mode="props.railVisible"
    :compact="isPhone"
    :format-clock="props.formatClock"
    @toggle-play="emit('toggle-play')"
    @step="emit('step', $event)"
    @set-speed="emit('set-speed', $event)"
    @scrub-start="emit('drag-start')"
    @scrub-end="emit('drag-end')"
    @seek="emit('seek', $event)"
  >
    <template #actions>
      <!-- 二级面入口（PRIMARY）：手机形态下它是渲染器专属工具的唯一出口，必须常驻。 -->
      <button
        v-if="isPhone"
        type="button" class="pb-btn pb-secondary-entry" data-test="pb-secondary-entry"
        :aria-label="$t('recon.map.playback.panel_display')" :title="$t('recon.map.playback.panel_display')"
        @click="emit('toggle-panels')"
      >
        <SlidersHorizontal :size="16" aria-hidden="true" />
      </button>
      <!-- 渲染器专属工具（SECONDARY）：宽档留在主面原位；手机形态下改由二级面提供，
           功能不丢（同一批 emit 仍由二级面触发）。 -->
      <template v-if="!isPhone">
        <button type="button" class="pb-btn pb-secondary-btn" data-test="pb-panels" :aria-label="$t('recon.map.playback.panels')" :title="$t('recon.map.playback.panels')" @click="emit('toggle-panels')">
          <PanelLeft :size="16" aria-hidden="true" />
        </button>
        <button type="button" class="pb-btn pb-secondary-btn" data-test="pb-annotation" :aria-label="$t('recon.map.playback.annotation')" :title="$t('recon.map.playback.annotation')" @click="emit('toggle-annotation')">
          <PencilLine :size="16" aria-hidden="true" />
        </button>
        <button type="button" class="pb-btn pb-reset" data-test="pb-reset" :aria-label="$t('recon.map.playback.reset_view')" @click="emit('reset-view')">{{ $t('recon.map.playback.reset_view') }}</button>
      </template>
      <!-- 全屏是主操作：两种形态都常驻，一键直达（不允许藏进二级面） -->
      <button v-if="props.fullscreenSupported" type="button" class="pb-btn pb-fullscreen-btn" data-test="pb-fullscreen" :aria-label="$t(props.isFullscreen ? 'recon.map.playback.exit_fullscreen' : 'recon.map.playback.enter_fullscreen')" @click="emit('toggle-fullscreen')">
        <component :is="props.isFullscreen ? Minimize2 : Maximize2" :size="16" aria-hidden="true" />
        <span class="pb-control-label">{{ props.isFullscreen ? $t('recon.map.playback.exit_fullscreen') : $t('recon.map.playback.enter_fullscreen') }}</span>
      </button>
    </template>
  </PlaybackTransport>
</template>

<style scoped>
/* §right-rail：控制条在 Left Rail 内时，面板/标注/重置/全屏与 rail 的图标导航重复，隐藏掉。 */
.pb-controls-rail-mode .pb-secondary-btn,
.pb-controls-rail-mode .pb-reset,
.pb-controls-rail-mode .pb-fullscreen-btn { display: none; }

.phone-form .pb-control-label { display: none; }
</style>
