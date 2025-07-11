import path from "node:path";
import fs from "node:fs/promises";
import { generateContentHash, generateHashedFileName, cleanOldHashes } from "../../utils/hash-utils.js"
/**
 * Записывает результат сборки с хешированными именами
 * @param {Object} config - Конфигурация сборки
 * @param {Object} output - Результат сборки
 * @param {string} outFile - Исходный путь для файла
 * @returns {Promise<{mainFile: string}>} Информация о созданных файлах
 */
export default async function writeOutput(config, output, outFile) {
    const dir = path.dirname(outFile);
    const ext = path.extname(outFile);
    const baseName = path.basename(outFile, ext);

    const hashedFileName = generateHashedFileName(outFile, output.code)
    const hashedFilePath = path.join(dir, hashedFileName);

    await cleanOldHashes(dir, baseName, ext);

    await fs.mkdir(dir, { recursive: true });


    let finalCode = output.code;

    // Обработка sourcemap
    if (output.map) {
        if (config.sourcemaps === 'inline') {
            const mapBase64 = Buffer.from(JSON.stringify(output.map)).toString('base64');
            finalCode += `\n//# sourceMappingURL=data:application/json;base64,${mapBase64}`;
        } else if (config.sourcemaps === 'external') {
            const mapFileName = `${hashedFileName}.map`;
            await fs.writeFile(path.join(dir, mapFileName), JSON.stringify(output.map, null, 2));
            finalCode += `\n//# sourceMappingURL=${mapFileName}`;
        }
    }

    await fs.writeFile(hashedFilePath, finalCode);

    // 4. Записываем import-map если есть
    if (output.importMap) {
        const importMapHash = generateContentHash(JSON.stringify(output.importMap));
        const importMapFileName = `import-map.${importMapHash}.json`;
        await fs.writeFile(
            path.join(dir, importMapFileName),
            JSON.stringify(output.importMap, null, 2)
        );
    }

    return {
        mainFile: hashedFileName,
        filePath: hashedFilePath
    };
}