import path from 'node:path';
import fs from 'node:fs/promises';
import { Logger } from '../core/Logger.js';
/**
 * Обрабатывает и копирует файлы шрифтов
 * @param {string} file - Путь к исходному файлу шрифта
 * @param {Object} config - Конфигурация обработки шрифтов
 */


export async function processFont(file, config) {
    const relativePath = path.relative('src/assets', file);
    const outputPath = path.join(
        config.outDir, 
        config.assetsDir, 
        relativePath
    );
    
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.copyFile(file, outputPath);
    
    if (config.fonts.subset && ['.ttf', '.otf'].includes(path.extname(file))) {
        await subsetFont(file, outputPath);
    }
}

/**
 * Создает подмножество шрифта
 * @param {string} srcPath - Исходный файл шрифта
 * @param {string} destPath - Целевой файл
 */


async function subsetFont(srcPath, destPath) {
     try {
        const { subset } = await import('@peertube/subset-font');
        const font = await fs.readFile(srcPath);
        const subsetFont = await subset(font, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');
        
        await fs.writeFile(destPath, subsetFont);
        Logger.debug(`Subset font created: ${path.basename(destPath)}`);
    } catch (error) {
        Logger.warn(`Font subsetting failed for ${path.basename(srcPath)}:`, error.message);
        await fs.copyFile(srcPath, destPath);
    }
}