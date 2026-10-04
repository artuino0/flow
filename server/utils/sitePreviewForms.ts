/** Runtime exclusivo de la vista previa aislada; no captura ni envía datos. */
function bootSandboxSiteForms() {
  const message = 'Esta vista previa no envía formularios. Abre el sitio publicado en su dominio para enviar.'
  const boot = () => document.querySelectorAll<HTMLFormElement>('form[data-flow-form]').forEach(form => {
    form.dataset.flowBound = 'true'; form.dataset.flowState = 'error'
    const container = form.closest('[data-flow-form-container]') ?? form.parentElement ?? form
    container.querySelectorAll<HTMLElement>('[data-flow-form-success],[data-flow-form-validation]').forEach(node => { node.hidden = true })
    container.querySelectorAll<HTMLElement>('[data-flow-form-error]').forEach(node => { node.hidden = false })
    let output = form.querySelector<HTMLElement>('[data-flow-form-message]')
    if (!output) { output = document.createElement('p'); output.setAttribute('data-flow-form-message', ''); output.setAttribute('role', 'status'); form.append(output) }
    output.textContent = message; output.hidden = false
    form.addEventListener('submit', event => { event.preventDefault(); output!.textContent = message }, true)
  })
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot()
}

export function sandboxSiteFormsDocument(html: string) {
  // Solo el último runtime generado por Flow; scripts del autor intactos.
  const opening = '<script data-flow-sites-runtime>', start = html.lastIndexOf(opening)
  if (start < 0) return html
  const end = html.indexOf('</script>', start + opening.length)
  if (end < 0) return html
  return html.slice(0, start + opening.length) + `(${bootSandboxSiteForms.toString()})();` + html.slice(end)
}
