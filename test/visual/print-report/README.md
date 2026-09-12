# Validación visual de reportes

Desde `frontback`:

```
node node_modules/vite/bin/vite.js --config test/visual/print-report/vite.config.mjs
```

Abrir http://127.0.0.1:3015. Usa los componentes reales de impresión con datos de demostración y un reemplazo local de las lecturas de branding de Nuxt; no requiere credenciales ni modifica la base de datos. El fixture no forma parte de las rutas de la aplicación.

Escenarios: 81 filas agrupadas con textos largos, reporte corto, solo importes y sin registros. Revisar Carta/A4, ambas orientaciones, densidades y zoom. Cada hoja debe conservar el tamaño físico, ninguna tabla debe invadir el pie y los importes del total deben aparecer incluso sin columnas de texto. En las páginas de continuación se repite el grupo.

La acción Imprimir / PDF abre la impresión del navegador; seleccionar una impresora o guardar el archivo se realiza en ese diálogo. El navegador integrado de Codex no mostró un diálogo de impresión durante la validación; la paginación y sus límites se comprobaron en la vista de hoja, no mediante una impresora física.
