import { createHash } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";


/**
 * Генерирует хеш для контента
 * @param {string|Buffer} content - Контент для хеширования
 * @param {object} [options] - Настройки
 * @param {string} [options.algorithm='sha256'] - Алгоритм хеширования
 * @param {number} [options.length=8] - Длина хеша (символов)
 * @returns {string} Хеш-строка
 */

export function generateContentHash(content, { _algoritm = "sha256", length = 8 } = {}) {
    return createHash(_algoritm)
        .update(content)
        .digest("hex")
        .substring(0, length);
}

/**
 * Генерирует хешированное имя файла
 * @param {string} filePath - Путь к файлу
 * @param {string|Buffer} content - Контент файла
 * @param {object} [options] - Настройки
 * @returns {string} Имя файла в формате `name.hash.ext`
 */

export function generateHashedFileName(filePath, content, options = {}) {
    const ext = path.extname(filePath)
    const base = path.basename(filePath, ext);
    const hash = generateContentHash(content, options);
    return `${base}.${hash}${ext}`;
}

/**
 * Читает файл и возвращает хешированное имя
 * @param {string} filePath - Путь к файлу
 * @param {object} [options] - Настройки
 * @returns {Promise<string>} Хешированное имя файла
 */

export async function getFileHash(filePath, options = {}) {
    const content = await fs.readFile(filePath);
    return generateHashedFileName(filePath, content, options);
}


/**
 * Удаляет старые хешированные версии файла
 * @param {string} dir - Директория для поиска
 * @param {string} baseName - Базовое имя файла (без хеша)
 * @param {string} ext - Расширение файла
 */

export async function cleanOldHashes(dir, basename, ext) {
    try {
        const files = await fs.readdir(dir);
        const pattern = new RegExp(`^${basename}\\.([a-f0-9]+)${ext}$`);

        await Promise.all(
            files.map(async file => {
                if (pattern.test(file)) {
                    await fs.unlink(path.join(dir, file)).catch(() => { });
                    // Удаляем связанный .map файл если есть
                    const mapFile = `${file}.map`;
                    if (await fs.access(path.join(dir, mapFile)).then(() => true).catch(() => false)) {
                        await fs.unlink(path.join(dir, mapFile)).catch(() => { });
                    }
                }
            })
        )
    } catch (err) {
        console.warn("Error hashed", err.message);
    }
}