import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs/promises';
import { Logger } from '../core/Logger.js';
/**
 * Оптимизирует SVG изображения с помощью SVGO
 * @param {Buffer} content - Бинарное содержимое SVG
 * @param {string} outputPath - Путь для сохранения
 * @param {AbortSignal} [signal] - Опциональный сигнал прерывания
 */
export async function optimizeSvg(content, outputPath, signal) {
   try {
      const { optimize } = await import('svgo');
      const result = optimize(content.toString(), {
        multipass: false,
        path: outputPath,
      });

      await fs.writeFile(outputPath, result.data);
      Logger.debug(`Optimized SVG: ${path.basename(outputPath)} (${(content.length / 1024).toFixed(2)}kb → ${(result.data.length / 1024).toFixed(2)}kb)`);
    } catch (error) {
      Logger.warn(`SVGO fallback for ${outputPath}:`, error.message);
      await fs.writeFile(outputPath, content);
    }
}

/**
 * Оптимизирует растровые изображения с помощью Sharp
 * @param {Buffer} content - Бинарное содержимое изображения
 * @param {string} ext - Расширение файла (например '.jpg')
 * @param {string} outputPath - Путь для сохранения
 * @param {Object} config - Конфигурация оптимизации
 * @param {AbortSignal} [signal] - Опциональный сигнал прерывания
 */
export async function optimizeImage(content, ext, outputPath, config, signal) {
    try {
        const sharpInstance = sharp(content, { sequentialRead: true })
            .resize(config.image.resize)
            .sharpen({ sigma: 0.5 })
            .threshold(0)
            .withMetadata()
            .modulate({ brightness: 1 })

        const formatTasks = [];
        
        if (config.image.formats.includes('avif')) {
            formatTasks.push(
            sharpInstance
                .clone()
                .toFormat('avif', {
                quality: config.image.quality,
                effort: 6
                })
                .toFile(outputPath.replace(ext, '.avif'))
            );
        }

        if (config.image.formats.includes('webp')) {
            formatTasks.push(
            sharpInstance
                .clone()
                .toFormat('webp', {
                quality: config.image.quality,
                effort: 6
                })
                .toFile(outputPath.replace(ext, '.webp'))
            );
        }

        formatTasks.push(
            sharpInstance
            .toFormat(ext.slice(1), {
                quality: config.image.quality,
                effort: 6
            })
            .toFile(outputPath)
        );

        await Promise.all(formatTasks);
        } catch (error) {
        if (error.name !== 'AbortError') {
            Logger.error(`Failed to optimize image ${outputPath}:`, error);
            throw error;
        }
     }
}