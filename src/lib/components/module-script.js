import fs from "node:fs/promises";
import path from "node:path";

/**
 * Разрешает путь к модулю относительно базовой директории
 * @param {string} baseDir - Базовая директория
 * @param {string} modulePath - Относительный путь модуля
 * @returns {string} Абсолютный путь к модулю
 * @throws {Error} Если модуль не найден
 */

export default async function resolvePath(baseDir, modulePath) {
    const extensions = ['.js', '.jsx', '.ts', '.tsx', '.json', ''];
    const candidates = [
        path.resolve(baseDir, modulePath),
        path.resolve(baseDir, `${modulePath}/index`)
    ];

    for (const candidate of candidates) {
        for (const ext of extensions) {
            const fullPath = ext ? `${candidate}${ext}` : candidate;
            try {
                await fs.access(fullPath);
                return fullPath;
            } catch {

            }
        }
    }

    throw new Error(`Cannot resolve module '${modulePath}' from '${baseDir}'`);
}