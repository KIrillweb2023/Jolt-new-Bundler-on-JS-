import { createHash } from "node:crypto";
import fs from "node:fs/promises"

/**
 * Генерирует хеш SHA-256 содержимого файла
 * @param {string} filePath - Путь к файлу
 * @returns {string} Хеш содержимого файла
 */

export default async function hashFile(filePath) {
    const content = await fs.readFile(filePath, 'utf8');
    return createHash('sha256').update(content).digest('hex');
}