export function jsonMessage<T>(message: T): T {
  return JSON.parse(JSON.stringify(message, (_key, value: unknown) => {
    if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol" ||
        value instanceof Map || value instanceof Set || value instanceof Error) {
      throw new TypeError("Viewer IPC requires JSON values; encode errors as {message}");
    }
    return value;
  }));
}
