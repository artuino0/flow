export const DESIGNER_EXPLANATION_LIMIT = 1500

function fitLines(value: string, limit: number): string {
  const output: string[] = []
  let length = 0
  for (const line of value.trim().split(/\r?\n/).map(item => item.trimEnd())) {
    const separator = output.length ? 1 : 0
    if (length + separator + line.length <= limit) {
      output.push(line)
      length += separator + line.length
      continue
    }
    const room = limit - length - separator
    if (room >= 4 && line.startsWith('- ')) output.push('- …')
    else if (room >= 2) {
      const cut = line.slice(0, room).lastIndexOf(' ')
      output.push(cut > 0 ? `${line.slice(0, cut)}…` : '…')
    }
    else if (output.length) output[output.length - 1] = `${output[output.length - 1]!.slice(0, -1)}…`
    return output.join('\n')
  }
  return output.join('\n')
}

export function limitDesignerExplanation(value: string, warnings: string[] = []): string {
  const warningText = warnings.map(warning => `- **Ajuste automático:** ${warning}`).join('\n')
  if (!warningText) return fitLines(value, DESIGNER_EXPLANATION_LIMIT)
  const reserved = Math.min(warningText.length + 1, DESIGNER_EXPLANATION_LIMIT - 160)
  const explanation = fitLines(value, DESIGNER_EXPLANATION_LIMIT - reserved)
  return `${explanation}\n${fitLines(warningText, DESIGNER_EXPLANATION_LIMIT - explanation.length - 1)}`
}
