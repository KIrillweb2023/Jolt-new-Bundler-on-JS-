import { validateConfig } from "../api/Validate.js";
import { Bundler } from "./Bundler.js";
import { Watcher } from "./Watch.js";
import { ApiLogger, LogLevel } from "../api/ApiLogger.js";
import { JoltConfiguration } from "../../jolt.config.js";

const logger = new ApiLogger("JOLT_START", LogLevel.DEBUG)

async function main() {
    try {
        validateConfig(JoltConfiguration);

        if (process.argv.includes('--watch')) {
            const watcher = new Watcher(JoltConfiguration);
            await watcher.start();
            logger.info('👀 Watch mode is active. Waiting for changes...');
        } else {
            await Bundler.run(JoltConfiguration);
            logger.success('✨ Build completed successfully');
        }
    } catch (error) {
        logger.error('❌ Build failed:', error);
        process.exit(1);
    }
}

// Вызываем функцию
main().catch(e => {
    logger.error('Unhandled error:', e);
    process.exit(1);
});