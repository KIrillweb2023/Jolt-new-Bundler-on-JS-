export const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  underscore: "\x1b[4m",
  blink: "\x1b[5m",
  reverse: "\x1b[7m",
  hidden: "\x1b[8m",
  
  // Цвета текста
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  
  // Цвета фона
  bgBlack: "\x1b[40m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
  bgWhite: "\x1b[47m"
};

// Улучшенный логгер
export class Logger {
  static #getTimestamp() {
    return new Date().toLocaleTimeString();
  }

  static info(message) {
    console.log(`${colors.cyan}${this.#getTimestamp()} ℹ ${colors.reset} ${message}`);
  }

  static success(message) {
    console.log(`${colors.green}${this.#getTimestamp()} ✓ ${colors.reset} ${message}`);
  }

  static warn(message) {
    console.log(`${colors.yellow}${this.#getTimestamp()} ⚠ ${colors.reset} ${message}`);
  }

  static error(message) {
    console.log(`${colors.red}${this.#getTimestamp()} ✖ ${colors.reset} ${message}`);
  }

  static debug(message) {
    console.log(`${colors.dim}${this.#getTimestamp()} ⚙ ${colors.reset} ${message}`);
  }

  static divider() {
    console.log(`${colors.dim}────────────────────────────────────────${colors.reset}`);
  }
}