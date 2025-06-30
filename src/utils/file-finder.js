import { globby } from "globby";

/**
 * 
 * * @param {AbortSignal} [options.signal] - Сигнал для прерывания
 */

export async function FindFilesWithRetry(signal, pattern, attempts = 3, delay = 50) {
    for (let i = 0; i < attempts; i++) {
        try {
            const files = await globby(pattern, { signal: signal });
            if (files.length) return files;
            await new Promise(resolve => setTimeout(resolve, delay));
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            if (i === attempts - 1) throw error;
        }
    }
    return [];
}