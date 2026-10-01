// Batería real: reutiliza las salvaguardas locales y el contador persistente.
process.argv.push('--large')
await import('./reproDesignerLarge.mjs')
