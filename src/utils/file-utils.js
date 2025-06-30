import fs from 'node:fs/promises';
import path from 'node:path';
import { copyDirectory } from './file-copier.js'; 


/**
 * Проверяет существование директории
 * @param {string} dirPath - Путь к директории
 * @returns {Promise<boolean>}
 */
export async function directoryExists(dirPath) {
    try {
        const stat = await fs.stat(dirPath);
        return stat.isDirectory();
    } catch {
        return false;
    }
}

/**
 * Копирует статические файлы согласно конфигурации
 * @param {Object} config - Конфигурация бандлера
 * @param {AbortSignal} [signal] - Опциональный сигнал прерывания
 * @returns {Promise<{publicDirCount: number, staticDirCount: number}>}
 */
export async function copyStaticFiles(config, signal) {
    const result = {
        publicDirCount: 0,
        staticDirCount: 0
    };

    const tasks = [];
    
    if (await directoryExists(config.publicDir)) {
        tasks.push(
        copyDirectory(config.publicDir, config.outDir, signal)
            .then(count => { result.publicDirCount = count; })
        );
    }
  
    if (await directoryExists(config.staticDir)) {
        tasks.push(
            copyDirectory(config.staticDir, path.join(config.outDir, 'static'), signal)
            .then(count => { result.staticDirCount = count; })
        );
    }
  
    await Promise.all(tasks);
    return result;
}