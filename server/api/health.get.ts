export default defineEventHandler(() => {
  return {
    status: 'ok',
    service: 'erp-dinamico-frontback',
    timestamp: new Date().toISOString()
  }
})
