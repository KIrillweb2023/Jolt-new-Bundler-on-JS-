import { perf } from "./perf.js";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * @param {Object} config - Конфигурация бандлера
 * @param {Object} cache - Объект кеша
 */
export async function Cleaner(config, cache) {
    perf.mark('clean-start');
    try {
        await fs.rm(config.outDir, { recursive: true, force: true });
        await fs.mkdir(path.join(config.outDir, config.assetsDir), { recursive: true });
        
        if (config.cache) {
            cache.assets.clear();
            cache.scripts.clear();
            cache.styles.clear();
            cache.html.clear();
        }
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    perf.measure('Output Clean', 'clean-start');
}