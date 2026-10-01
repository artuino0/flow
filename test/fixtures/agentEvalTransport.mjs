// Precarga exclusiva de pruebas: reemplaza fetch por completo, sin transporte de red.
globalThis.fetch = async (_url, init) => {
 const body = JSON.parse(init.body)
 let content
 if (body.messages[0].content.startsWith('Evalúa cada respuesta')) {
  if (process.env.AGENT_EVAL_TEST_INVALID_JUDGE === '1') content = '{}'
  else {
   const pair = JSON.parse(body.messages[1].content)
   const scores = [pair.A, pair.B].map(raw => {
    const value = JSON.parse(raw).reply === 'Modelo ligero.' ? 2 : 4
    return { correccion: value, no_inventa: value, tono: value, acciones: value, seguridad: value }
   })
   content = JSON.stringify({ scores })
  }
 } else content = JSON.stringify({ intent: 'guide', reply: body.model === 'gpt-5.4-mini' ? 'Modelo ligero.' : 'Modelo alto.', emotion: 'happy', actions: [] })
 return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 20, completion_tokens: 10 } }))
}
