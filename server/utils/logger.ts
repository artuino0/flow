// HU-ERD-20: logging estructurado en JSON, con nivel/timestamp/contexto.
// Sin dependencias externas (evita agregar peso solo por esto); Sentry
// (server/utils/sentry.ts) se encarga de la captura de errores no controlados.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogContext {
  [key: string]: unknown
}

function write(level: LogLevel, message: string, context: LogContext = {}): void {
  // context primero: level/message/timestamp del propio log SIEMPRE ganan,
  // aunque el context traiga una clave con el mismo nombre (p. ej. un
  // context.message con el mensaje de un error capturado).
  const entry = {
    ...context,
    level,
    message,
    timestamp: new Date().toISOString()
  }
  const line = JSON.stringify(entry)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  debug: (message: string, context?: LogContext) => write('debug', message, context),
  info: (message: string, context?: LogContext) => write('info', message, context),
  warn: (message: string, context?: LogContext) => write('warn', message, context),
  error: (message: string, context?: LogContext) => write('error', message, context)
}
