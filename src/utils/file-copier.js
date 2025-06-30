import { globby } from 'globby';
import path from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import { Logger } from '../core/Logger.js';

/**
 * Копирует содержимое директории рекурсивно
 * @param {string} srcDir - Исходная директория
 * @param {string} destDir - Целевая директория 
 * @param {AbortSignal} [signal] - Опциональный сигнал для прерывания
 */
export async function copyDirectory(srcDir, destDir, signal) {
    try {
        const files = await globby(`${srcDir}/**/*`, {
            dot: true,
            signal
        });

        if (!files.length) return 0;

        await Promise.all(files.map(file => copyFile(file, path.join(destDir, path.relative(srcDir, file)), signal)));

        Logger.success(`Copied ${files.length} files from ${path.basename(srcDir)}`);
        return files.length;
    } catch (error) {
        if (error.name !== 'AbortError') {
            Logger.error(`Failed to copy directory ${srcDir}:`, error);
            throw error;
        }
        return 0;
    }
}

/**
 * Копирует одиночный файл с созданием директорий
 * @param {string} src - Исходный файл
 * @param {string} dest - Целевой файл
 * @param {AbortSignal} [signal] - Опциональный сигнал для прерывания
 */
export async function copyFile(src, dest, signal) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException('Aborted', 'AbortError'));
    }

    const read = createReadStream(src);
    const write = createWriteStream(dest);

    read.on('error', reject);
    write.on('error', reject);
    write.on('finish', resolve);

    if (signal) {
      signal.addEventListener('abort', () => {
        read.destroy();
        write.destroy();
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    }

    read.pipe(write);
  });
}