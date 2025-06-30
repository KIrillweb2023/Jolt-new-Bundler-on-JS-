import { perf } from "./perf.js";
import { globby } from "globby";
import fs from "node:fs/promises";
import { brotliCompress, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { Logger } from "../core/Logger.js";


const compressAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

export default async function compressFiles(config, abortController) { 
    perf.mark('compress-start');

    const files = await globby([`${config.outDir}/**/*.{js,css,html}`], { 
        signal: abortController.signal 
    });

    if (!files.length) {
        perf.measure('Compression', 'compress-start');
        return;
    }

    const BATCH_SIZE = 5;
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(file => compressFile(file)));
    }

    perf.measure('Compression', 'compress-start');
    Logger.success(`Compressed ${files.length} files (Brotli + Gzip)`);
}

const compressFile = async (file) => {
    try {
        const content = await fs.readFile(file);
        const [brotli, gz] = await Promise.all([
            compressAsync(content),
            gzipAsync(content)
        ]);
        
        await Promise.all([
            fs.writeFile(`${file}.br`, brotli),
            fs.writeFile(`${file}.gz`, gz)
        ]);
    } catch (error) {
        if (error.name !== 'AbortError') {
            Logger.error(`Failed to compress file ${file}:`, error);
            throw error;
        }
    }
}