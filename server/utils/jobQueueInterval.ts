export function jobQueueIntervalSeconds(nodeEnv?: string, configured?: string): number {
  const seconds = Number(configured)
  return configured && Number.isSafeInteger(seconds) && seconds > 0 ? seconds : nodeEnv === 'development' ? 10 : 60
}
