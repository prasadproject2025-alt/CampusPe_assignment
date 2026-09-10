import winston from 'winston';
import path from 'path';
import fs from 'fs';

const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const customFormat = winston.format.printf(({ level, message, timestamp, step, attempt, ...meta }) => {
  const stepTag = step ? ` [STEP: ${step}]` : '';
  const attemptTag = attempt ? ` [ATTEMPT: ${attempt}]` : '';
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}]${stepTag}${attemptTag} ${message}${metaStr}`;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    customFormat
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
        customFormat
      )
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'automation.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'automation_audit.json'),
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    })
  ]
});

export function logStep(step: string, message: string, meta: Record<string, any> = {}) {
  logger.info(message, { step, ...meta });
}

export function logRecovery(step: string, message: string, meta: Record<string, any> = {}) {
  logger.warn(`RECOVERY ACTION: ${message}`, { step, isRecovery: true, ...meta });
}

export function logFailure(step: string, error: Error | string, meta: Record<string, any> = {}) {
  const errMsg = typeof error === 'string' ? error : error.message;
  const stack = typeof error === 'object' ? error.stack : undefined;
  logger.error(`FAILURE: ${errMsg}`, { step, stack, ...meta });
}
