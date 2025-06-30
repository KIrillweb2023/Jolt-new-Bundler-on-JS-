import path from 'node:path';
import { Logger } from '../core/Logger.js';

/**
 * Анализирует и выводит статистику по размерам бандлов
 * @param {Object} outputs - Метаданные esbuild (из result.metafile)
 */

export function analyzeBundle(metafile) {
    const bundles = Object.entries(metafile)
        .map(([file, output]) => ({
            file: path.basename(file),
            size: (output.bytes / 1024).toFixed(2) + 'kb',
            imports: output.imports.length
        }))
        .sort((a, b) => parseFloat(b.size) - parseFloat(a.size));

    Logger.info('\n📦 Bundle Analysis:');
    console.table(bundles);
}