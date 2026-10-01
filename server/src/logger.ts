type Level = "debug" | "info" | "warn" | "error";

type Fields = Record<string, string | number | boolean | null>;

function emit(level: Level, message: string, fields: Fields = {}): void {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
    ...fields,
  });
  if (level === "error" || level === "warn") {
    process.stderr.write(`${line}\n`);
    return;
  }
  process.stdout.write(`${line}\n`);
}

export const log = {
  info: (message: string, fields?: Fields): void => {
    emit("info", message, fields);
  },
  warn: (message: string, fields?: Fields): void => {
    emit("warn", message, fields);
  },
  error: (message: string, fields?: Fields): void => {
    emit("error", message, fields);
  },
};
