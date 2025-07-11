import hashFile from "./hash-script.js"

/**
 * Проверяет, нужно ли пересобирать файл (по изменению содержимого)
 * @param {string} config - Конфигурация сборки
 * @param {string} cache - Кеш файла
 * @param {string} filePath - Путь к файлу
 * @returns {boolean} Нужна ли пересборка
 */


export default async function needsRebuild(config, cache, filePath) {
    if (!config.cache) return true;
    const hash = await hashFile(filePath);
    if (cache.get(filePath) !== hash) {
        cache.set(filePath, hash);
        return true;
    }
    return false;
}