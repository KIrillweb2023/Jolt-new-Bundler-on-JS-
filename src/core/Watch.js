// core/watch.js
import chokidar from 'chokidar';
import { Bundler } from './Bundler.js';
import { ApiLogger, LogLevel } from '../api/ApiLogger.js';

const logger = new ApiLogger("JOLT_WATCH", LogLevel.DEBUG);

export class Watcher {
    constructor(config) {
        this.config = {
            watchPatterns: [],
            debounceTime: 300,
            chokidarOptions: {
                ignored: /(^|[\/\\])\../,
                persistent: true,
                ignoreInitial: true
            },
            ...config
        };
        this.watcher = null;
        this.rebuildTimeout = null;
        this.isBuilding = false;
        this.isWatching = false;
    }

    async start() {
        if (this.isWatching) {
            logger.warn('Watcher is already running');
            return;
        }

        return new Promise((resolve, reject) => {
            try {
                this.watcher = chokidar.watch(
                    this.config.watchPatterns,
                    this.config.chokidarOptions
                );

                this.watcher
                    .on('ready', () => {
                        this.isWatching = true;
                        logger.success(`👀 Watching: ${this.config.watchPatterns.join(', ')}`);
                        resolve();
                    })
                    .on('add', path => this.handleFileChange('add', path))
                    .on('change', path => this.handleFileChange('change', path))
                    .on('unlink', path => this.handleFileChange('remove', path))
                    .on('error', error => {
                        logger.error(`Watcher error: ${error.message}`);
                        if (error.stack) logger.debug(error.stack);
                        reject(error);
                    });

            } catch (error) {
                logger.error(`Failed to start watcher: ${error.message}`);
                reject(error);
            }
        });
    }

    async handleFileChange(event, path) {
        if (this.isBuilding) {
            logger.debug(`Skipping rebuild: already in progress (${event} ${path})`);
            return;
        }

        clearTimeout(this.rebuildTimeout);

        this.rebuildTimeout = setTimeout(async () => {
            try {
                this.isBuilding = true;
                logger.info(`🔃 File ${event}: ${path}`);
                await Bundler.run(this.config);
            } catch (err) {
                logger.error(`Rebuild failed: ${err.message}`);
                if (err.stack) logger.debug(err.stack);

                // Добавляем задержку после ошибки, чтобы избежать бесконечного цикла
                await new Promise(resolve => setTimeout(resolve, 1000));
            } finally {
                this.isBuilding = false;
            }
        }, this.config.debounceTime);
    }

    async stop() {
        if (!this.isWatching) {
            logger.warn('Watcher is not running');
            return;
        }

        clearTimeout(this.rebuildTimeout);

        try {
            await this.watcher.close();
            this.isWatching = false;
            logger.info('Watcher stopped');
        } catch (error) {
            logger.error(`Failed to stop watcher: ${error.message}`);
            throw error;
        }
    }
}