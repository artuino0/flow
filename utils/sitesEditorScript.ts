// HTML del editor de Sites que incluye etiquetas <script>/<style> dentro de textos.
// Vive en un .ts y no en el <script setup> de pages/sites/[siteId]/pages/[pageId].vue
// porque esos textos dentro del SFC rompían el build de producción (ERD-87).

// JS propio de una página: el editor lo guarda dentro del HTML como
// <script data-flow-site-js>...</script> y al cargar la página lo separa del HTML.
const SITE_JS_PATTERN = /<script\s+data-flow-site-js(?:=["'][^"']*["'])?[^>]*>([\s\S]*?)<\/script\s*>/i

export function splitSiteScript(html: string): { html: string; js: string } {
  const match = html.match(SITE_JS_PATTERN)
  return { html: html.replace(SITE_JS_PATTERN, '').trimEnd(), js: match?.[1]?.trim() ?? '' }
}

export function joinSiteScript(html: string, js: string): string {
  if (!js.trim()) return html
  return `${html.trimEnd()}\n<script data-flow-site-js>\n${js.trim()}\n</script>`
}

// Puente dentro del iframe de vista previa: resalta el formulario o campo que el
// editor le indica por postMessage.
const PREVIEW_BRIDGE = `(function(){
    var formClass='flow-editor-form-focus';
    var fieldClass='flow-editor-field-focus';
    function clear(){document.querySelectorAll('.'+formClass).forEach(function(el){el.classList.remove(formClass)});document.querySelectorAll('.'+fieldClass).forEach(function(el){el.classList.remove(fieldClass)})}
    window.addEventListener('message',function(event){
      var data=event.data;
      if(!data||data.source!=='flow-sites-editor')return;
      clear();
      if(!data.formKey)return;
      var form=Array.from(document.querySelectorAll('[data-flow-form]')).find(function(el){return el.getAttribute('data-flow-form')===data.formKey});
      if(!form)return;
      form.classList.add(formClass);
      var target=form;
      if(data.fieldName){var field=Array.from(form.querySelectorAll('[name]')).find(function(el){return el.getAttribute('name')===data.fieldName});if(field){field.classList.add(fieldClass);target=field}}
      target.scrollIntoView({behavior:'smooth',block:'center',inline:'nearest'});
    });
  })();`

const EDITOR_STYLES = '.flow-editor-form-focus{outline:2px solid #0091ae!important;outline-offset:3px!important;background:rgba(0,145,174,.08)!important}.flow-editor-field-focus{outline:2px solid #ff7a59!important;outline-offset:2px!important;background:rgba(255,122,89,.14)!important}'

export function buildPreviewDocument(html: string, css: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><style>html,body{min-height:100%;margin:0}${css}${EDITOR_STYLES}:root{color-scheme:light!important}</style></head><body>${html}<script>${PREVIEW_BRIDGE}</script></body></html>`
}
