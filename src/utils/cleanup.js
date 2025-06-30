import { Logger } from "../core/Logger.js";

/**
 * Останавливает все процессы и очищает ресурсы
 * @param {Object} config - Конфигурация бандлера
 * @param {Object} context - Контекст esbuild
 * @param {AbortController} abortController - Контроллер прерывания
 * @param {Object} cache - Кеш бандлера
 */

export async function stopBuildProcess({ config, context, abortController, cache }) {
    try {
        // Остановка вотчера файлов
        if (config.watcher) {
            await config.watcher.close();
            config.watcher = null;
        }
        
        // Остановка esbuild
        if (context) {
            await context.dispose();
            context = null;
        }
        
        // Прерывание текущих операций
        abortController.abort();
        abortController = new AbortController();
        
        // Очистка кеша
        cache.assets.clear();
        cache.scripts.clear();
        cache.styles.clear();
        cache.html.clear();
        
        Logger.info('Build process stopped and resources cleaned up');
        return { abortController };
    } catch (error) {
        Logger.error('Error during cleanup:', error);
        throw error;
    }
}