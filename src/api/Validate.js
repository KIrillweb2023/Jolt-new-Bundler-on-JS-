import { ApiLogger, LogLevel } from './ApiLogger.js';

const logger = new ApiLogger("JOLT-CONFIG", LogLevel.DEBUG);

export function validateConfig(cfg) {
    if (!cfg.entry) throw new Error('Entry point is required');
    if (!cfg.outfile && !cfg.outdir) {
        throw new Error('Either outfile or outdir must be specified');
    }

    logger.success('✅ Configuration is valid');
    return true;
}