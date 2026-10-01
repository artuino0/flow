import { agentModelPool } from '../utils/agent/models'

export default defineNitroPlugin(nitro => {
 agentModelPool.watch()
 const timer = setInterval(() => agentModelPool.watch(), 6 * 60 * 60 * 1000)
 timer.unref()
 nitro.hooks.hook('close', () => { clearInterval(timer) })
})
