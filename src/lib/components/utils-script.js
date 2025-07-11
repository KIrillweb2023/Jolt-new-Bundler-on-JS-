/**
 * Проверяет, является ли модуль внешней зависимостью
 * @param {string} config - Конфигурация сборки
 * @param {string} filePath - Путь к файлу
 * @returns {boolean} Является ли внешней зависимостью
 */


import path from "node:path";

export default function isExternalDependency(config, filePath) {
    const packageName = getPackageNameFromPath(filePath);
    return config.external.includes(packageName);
}

/**
* Извлекает имя пакета из пути к файлу
* @param {string} filePath - Путь к файлу
* @returns {string} Имя пакета
*/

export function getPackageNameFromPath(filePath) {
    return path.basename(filePath, path.extname(filePath));
}


/**
* Нормализует ID модуля (делает относительным и убирает расширение)
* @param {string} filePath - Абсолютный путь к файлу
* @param {string} baseDir - Базовая директория
* @returns {string} Нормализованный ID модуля
*/



export function normalizeModuleId(filePath, baseDir) {
    const relativePath = path.relative(baseDir, filePath)
        .replace(/\\/g, '/')
        .replace(/\.(js|ts)x?$/, '');
    return `./${relativePath}`;
}

export const catchError = (success, error, config, outputFile) => {
    return {
        success: success,
        error: error,
        config: config,
        outputFile: outputFile
    }
}

