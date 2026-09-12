import { ref, watchEffect } from 'vue'
export function useRequestHeaders() { return {} }
export function useFetch() { return { data: ref({ name: 'Empacadora del Valle · Demostración', hasLogo: false, fiscalData: { calle: 'Camino del Campo', numeroExterior: '120', municipio: 'Culiacán', estado: 'Sinaloa' }, email: 'contacto@empacadoradelvalle.mx', phone: '+52 667 100 2233' }), status: ref('success') } }
export function useHead(get) { watchEffect(() => { let style = document.getElementById('report-page-size'); if (!style) { style = document.createElement('style'); style.id = 'report-page-size'; document.head.append(style) }; style.textContent = get().style[0].textContent }) }
