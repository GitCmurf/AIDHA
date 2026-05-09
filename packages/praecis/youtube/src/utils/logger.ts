export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export const consoleLogger: Logger = {
  debug: (message, ...args) => console.debug(message, ...args),
  info: (message, ...args) => console.info(message, ...args),
  warn: (message, ...args) => console.warn(message, ...args),
  error: (message, ...args) => console.error(message, ...args),
};

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export interface BufferedLogEntry {
  level: keyof Logger;
  message: string;
  args: unknown[];
}

export class BufferedLogger implements Logger {
  readonly entries: BufferedLogEntry[] = [];

  debug(message: string, ...args: unknown[]): void {
    this.entries.push({ level: 'debug', message, args });
  }

  info(message: string, ...args: unknown[]): void {
    this.entries.push({ level: 'info', message, args });
  }

  warn(message: string, ...args: unknown[]): void {
    this.entries.push({ level: 'warn', message, args });
  }

  error(message: string, ...args: unknown[]): void {
    this.entries.push({ level: 'error', message, args });
  }
}
