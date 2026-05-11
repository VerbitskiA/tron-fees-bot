const prefix = "[tronfees-bot]";

export const log = {
  info: (...args) => console.log(prefix, ...args),
  warn: (...args) => console.warn(prefix, ...args),
  error: (...args) => console.error(prefix, ...args),
};
