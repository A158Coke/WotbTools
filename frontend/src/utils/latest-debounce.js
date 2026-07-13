export function createLatestDebounce(delayMs = 300) {
  let timer = null
  let generation = 0

  function cancel() {
    generation += 1
    if (timer != null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function schedule(task, onResult, onError) {
    cancel()
    const currentGeneration = generation
    timer = setTimeout(async () => {
      timer = null
      try {
        const result = await task()
        if (currentGeneration === generation) onResult(result)
      } catch (error) {
        if (currentGeneration === generation) onError(error)
      }
    }, delayMs)
  }

  return { cancel, schedule }
}
