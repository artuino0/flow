import { setResponseHeader } from 'h3'
import { newRequestPerformance, performanceEnabled, performanceHeader, performanceSummary, type RequestPerformance } from '~/server/utils/requestPerformance'

export default defineNitroPlugin(app => {
  app.hooks.hook('request', event => { if (performanceEnabled()) event.context.requestPerformance = newRequestPerformance() })
  app.hooks.hook('beforeResponse', event => {
    const metrics = event.context.requestPerformance as RequestPerformance | undefined
    if (metrics) setResponseHeader(event, 'Server-Timing', performanceHeader(metrics))
  })
  app.hooks.hook('afterResponse', event => {
    const metrics = event.context.requestPerformance as RequestPerformance | undefined
    if (!metrics) return
    const summary = performanceSummary(event, metrics)
    if (summary.totalMs > 500) console.info(JSON.stringify(summary))
  })
})
