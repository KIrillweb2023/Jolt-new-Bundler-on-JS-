import chokidar from 'chokidar';
import { globby } from 'globby';
import { Logger, colors } from '../core/Logger.js';
/**
 * Инициализирует вотчер файлов
 * @param {Object} config - Конфигурация бандлера
 * @param {Function} processChanges - Функция обработки изменений
 */
export async function startWatcher(config, processChanges) {
    if (config.watcher) return;

    config.pendingChanges = new Set();
    config.debounceTimer = null;
    config.activeRebuild = false;

    const watchPatterns = [
        'src/**/*.html',
        'src/**/*.js',
        ...config.css.include,
        `${config.staticDir}/**/*`,
        `${config.publicDir}/**/*`
    ];

    const watcher = chokidar.watch(await globby(watchPatterns), {
        ignored: [
            /(^|[/\\])\../,
            /node_modules/,
            new RegExp(config.outDir),
            /\.(git|DS_Store)/
        ],
        ignoreInitial: true,
        persistent: true,
        useFsEvents: true,
        awaitWriteFinish: {
            stabilityThreshold: 200,
            pollInterval: 100
        },
        atomic: 300
    });

    const handleChange = (filePath) => {
        config.pendingChanges.add(filePath);
        clearTimeout(config.debounceTimer);
        config.debounceTimer = setTimeout(() => processChanges(), 100); //тут надо импортом возможно 
    };

    watcher
        .on('add', handleChange)
        .on('change', handleChange)
        .on('unlink', handleChange)
        .on('error', error => Logger.error('Watcher error:', error));

    config.watcher = watcher;
    Logger.info(`${colors.green}👀 Watching for changes...${colors.reset}`);

    return watcher;
}