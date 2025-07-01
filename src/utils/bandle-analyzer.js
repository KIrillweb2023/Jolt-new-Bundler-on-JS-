import path from 'node:path';
import { Logger } from '../core/Logger.js';

/**
 * Анализирует и выводит статистику по размерам бандлов
 * @param {Object} outputs - Метаданные esbuild (из result.metafile)
 */
export function analyzeBundle(metafile) { /// [*] ///
    const result = {
        totalInputSize: 0,
        totalOutputSize: 0,
        ratio: 0
    };

    if (!metafile) {
        Logger.warn('No metafile provided for analysis');
        return result;
    }

    try {
        // Анализ входных файлов
        if (metafile.inputs) {
            for (const input in metafile.inputs) {
                result.totalInputSize += metafile.inputs[input].bytes || 0;
            }
        }

        // Анализ выходных файлов
        if (metafile.outputs) {
            for (const output in metafile.outputs) {
                result.totalOutputSize += metafile.outputs[output].bytes || 0;
            }
        }

        // Расчет коэффициента сжатия
        if (result.totalInputSize > 0) {
            result.ratio = (result.totalOutputSize / result.totalInputSize).toFixed(2);
        }

        return result;
    } catch (error) {
        Logger.error('Bundle analysis error:', error);
        return result;
    }
}