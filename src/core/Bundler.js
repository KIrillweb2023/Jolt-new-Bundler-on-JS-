import { Build } from '../lib/build.js';
import { JoltConfiguration } from '../../jolt.config.js';
import { performance } from 'perf_hooks';
import path from 'path';
import { ApiLogger, LogLevel } from '../api/ApiLogger.js';

// Инициализация логгера
const logger = new ApiLogger("JOLT", LogLevel.DEBUG);

export class Bundler {
    static async run() {
        const startTime = performance.now();
        let buildTime;

        try {
            const builder = new Build(JoltConfiguration);
            const result = await builder.build();

            buildTime = ((performance.now() - startTime) / 1000).toFixed(2);

            // Обработка случая, когда build() возвращает success: false без исключения
            if (result && result.success === false) {
                logger.error(`Build failed after ${buildTime}s`, result.error);
                return {
                    success: false,
                    error: result.error,
                    buildTime: `${buildTime}s`
                };
            }

            // Успешная сборка
            logger.success(`Build completed in ${buildTime}s`);
            logger.info(`Your main bundle is in the folder: ${path.resolve(JoltConfiguration.outfile)}`);

            return {
                success: true,
                result,
                buildTime: `${buildTime}s`,
                outfile: path.resolve(JoltConfiguration.outfile)
            };

        } catch (error) {
            buildTime = ((performance.now() - startTime) / 1000).toFixed(2);
            logger.error(`Build failed after ${buildTime}s`, error);

            return {
                success: false,
                error: error instanceof Error ? error : new Error(String(error)),
                buildTime: `${buildTime}s`
            };
        }
    }
}