type LogLevel = "debug" | "info" | "error";

const ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  error: 30,
};

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

function formatFields(fields?: Record<string, unknown>): string {
  if (!fields || Object.keys(fields).length === 0) return "";
  return ` ${Object.entries(fields)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ")}`;
}

export function createLogger(level: LogLevel): Logger {
  const shouldLog = (current: LogLevel): boolean => ORDER[current] >= ORDER[level];

  return {
    debug(message, fields) {
      if (shouldLog("debug")) console.log(`[proxy] ${message}${formatFields(fields)}`);
    },
    info(message, fields) {
      if (shouldLog("info")) console.log(`[proxy] ${message}${formatFields(fields)}`);
    },
    error(message, fields) {
      if (shouldLog("error")) console.error(`[proxy] ${message}${formatFields(fields)}`);
    },
  };
}
