import path from 'node:path';
import { Logger } from '../core/Logger.js';

/**
 * Анализирует и выводит статистику по размерам бандлов
 * @param {Object} outputs - Метаданные esbuild (из result.metafile)
 */

export function analyzeBundle(result) {
    try {
        if (!result || !result.metafile) {
            Logger.warn('No bundle analysis available - missing metafile');
            return {};
        }

        const { inputs = {}, outputs = {} } = result.metafile;
        
        const analysis = {
            totalInputSize: 0,
            totalOutputSize: 0,
            files: [],
            warnings: result.warnings || [],
            errors: result.errors || []
        };

        // Анализ входных файлов
        Object.entries(inputs).forEach(([file, info]) => {
            analysis.totalInputSize += info.bytes;
            analysis.files.push({
                file: path.basename(file),
                size: info.bytes,
                imports: info.imports?.length || 0
            });
        });

        // Анализ выходных файлов
        Object.entries(outputs).forEach(([file, info]) => {
            analysis.totalOutputSize += info.bytes;
        });

        Logger.debug('Bundle analysis completed');
        return analysis;
    } catch (error) {
        Logger.error('Bundle analysis failed:', error);
        return {
            error: error.message,
            stack: error.stack
        };
    }
}