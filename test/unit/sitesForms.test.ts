import { describe, expect, it } from 'vitest'
import { extractSiteForms } from '../../server/utils/sites'

describe('extractSiteForms', () => {
  it('detecta formularios identificados y sus campos', () => {
    const forms = extractSiteForms(`
      <form data-flow-form="contacto" data-flow-name="Solicitar información" method="post">
        <input name="nombre" placeholder="Nombre completo" required>
        <input type="email" name="correo" aria-label="Correo de trabajo">
        <textarea name="mensaje" required></textarea>
        <button type="submit">Enviar</button>
      </form>
    `)

    expect(forms).toEqual([{
      id: 'contacto',
      name: 'Solicitar información',
      method: 'POST',
      action: '',
      fields: [
        { name: 'nombre', label: 'Nombre completo', type: 'text', required: true },
        { name: 'correo', label: 'Correo de trabajo', type: 'email', required: false },
        { name: 'mensaje', label: 'mensaje', type: 'textarea', required: true }
      ]
    }])
  })

  it('ignora controles sin name y crea una identidad estable de respaldo', () => {
    const forms = extractSiteForms('<form><input placeholder="Sin nombre"><select name="area"></select></form>')
    expect(forms[0]?.id).toBe('form-1')
    expect(forms[0]?.fields).toHaveLength(1)
    expect(forms[0]?.fields[0]?.name).toBe('area')
  })

  it('extrae los valores reales de los campos select', () => {
    const forms = extractSiteForms(`
      <form data-flow-form="viaje">
        <select name="tipo" required>
          <option value="">Selecciona</option>
          <option value="familia">Viaje familiar</option>
          <option value="pareja">Viaje en pareja</option>
        </select>
      </form>
    `)

    expect(forms[0]?.fields[0]).toEqual({
      name: 'tipo',
      label: 'tipo',
      type: 'select',
      required: true,
      options: [
        { value: 'familia', label: 'Viaje familiar' },
        { value: 'pareja', label: 'Viaje en pareja' }
      ]
    })
  })
})
