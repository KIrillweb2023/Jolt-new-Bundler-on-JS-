export const LogLevel = {
    DEBUG: "DEBUG",
    INFO: "INFO",
    WARN: "WARN",
    ERROR: "ERROR",
    SUCCESS: "SUCCESS",
};
// ANSI-коды для цветов в терминале
const TerminalColors = {
    RESET: "\x1b[0m",
    BRIGHT: "\x1b[1m",
    DIM: "\x1b[2m",
    UNDERSCORE: "\x1b[4m",
    BLINK: "\x1b[5m",
    REVERSE: "\x1b[7m",
    HIDDEN: "\x1b[8m",

    // Цвета текста
    BLACK: "\x1b[30m",
    RED: "\x1b[31m",
    GREEN: "\x1b[32m",
    YELLOW: "\x1b[33m",
    BLUE: "\x1b[34m",
    MAGENTA: "\x1b[35m",
    CYAN: "\x1b[36m",
    WHITE: "\x1b[37m",

    // Фоновые цвета
    BG_BLACK: "\x1b[40m",
    BG_RED: "\x1b[41m",
    BG_GREEN: "\x1b[42m",
    BG_YELLOW: "\x1b[43m",
    BG_BLUE: "\x1b[44m",
    BG_MAGENTA: "\x1b[45m",
    BG_CYAN: "\x1b[46m",
    BG_WHITE: "\x1b[47m",
};
// Стили для разных уровней логов (терминал)
const LogStyles = {
    [LogLevel.DEBUG]: `${TerminalColors.DIM}${TerminalColors.BLUE}`,
    [LogLevel.INFO]: `${TerminalColors.CYAN}`,
    [LogLevel.WARN]: `${TerminalColors.YELLOW}`,
    [LogLevel.ERROR]: `${TerminalColors.RED}`,
    [LogLevel.SUCCESS]: `${TerminalColors.GREEN}${TerminalColors.BRIGHT}`,
};

class ApiLogger {
    constructor(prefix = "API", logLevel = LogLevel.INFO) {
        this.prefix = prefix;
        this.logLevel = logLevel;
    }

    shouldLog(level) {
        const levels = Object.values(LogLevel);
        return levels.indexOf(level) >= levels.indexOf(this.logLevel);
    }

    formatMessage(level, message) {
        const timestamp = new Date().toISOString();
        let formattedMessage = message;

        if (message instanceof Error) {
            formattedMessage = `${message.name}: ${message.message}\n${message.stack || "No stack trace"}`;
        } else if (typeof message !== "string") {
            try {
                formattedMessage = JSON.stringify(message, null, 2);
            } catch (e) {
                formattedMessage = "[Non-serializable object]";
            }
        }

        const levelStyle = LogStyles[level] || "";
        const prefixStyle = `${TerminalColors.WHITE}${TerminalColors.BRIGHT}`;
        const timestampStyle = TerminalColors.DIM;

        return [
            `${timestampStyle}[${timestamp}]${TerminalColors.RESET} ${prefixStyle}[${this.prefix}]${TerminalColors.RESET} ${levelStyle}[${level}]${TerminalColors.RESET} - ${formattedMessage}`
        ];
    }

    log(level, message) {
        if (!message || !this.shouldLog(level)) return;

        const formattedMessage = this.formatMessage(level, message);

        switch (level) {
            case LogLevel.DEBUG:
                console.debug(...formattedMessage);
                break;
            case LogLevel.INFO:
                console.info(...formattedMessage);
                break;
            case LogLevel.WARN:
                console.warn(...formattedMessage);
                break;
            case LogLevel.ERROR:
                console.error(...formattedMessage);
                break;
            case LogLevel.SUCCESS:
                console.log(...formattedMessage);
                break;
            default:
                console.log(...formattedMessage);
        }
    }

    debug = (message) => this.log(LogLevel.DEBUG, message);
    info = (message) => this.log(LogLevel.INFO, message);
    warn = (message) => this.log(LogLevel.WARN, message);
    error = (message) => this.log(LogLevel.ERROR, message);
    success = (message) => this.log(LogLevel.SUCCESS, message);
}

export { ApiLogger };