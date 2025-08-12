import winston from 'winston';

export function createLogger(): winston.Logger {
  return winston.createLogger({
    level: 'info',
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp(),
      winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level}]: ${message}`)
    ),
    transports: [new winston.transports.Console()]
  });
}