import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { globby } from 'globby';
import { Logger } from '../core/Logger.js';
import { processFont } from './font-processor.js';
import { optimizeImage } from './image-optimizer.js';
import { optimizeSvg } from './image-optimizer.js';
import { perf } from '../utils/perf.js';



export async function processAssets(config, cache, signal) {
    perf.mark('assets-start');
    const assets = await globby([
        'src/assets/**/*',
        '!**/*.{js,jsx,ts,tsx,css,scss,sass,less,styl}'
    ], { signal: signal });
    
    if (!assets.length) {
        perf.measure('Assets Processing', 'assets-start');
        return;
    }
    
    let processedCount = 0;
    const stats = { images: 0, svgs: 0, fonts: 0, others: 0 };
    
    const BATCH_SIZE = 10;

    for (let i = 0; i < assets.length; i += BATCH_SIZE) {
        const batch = assets.slice(i, i + BATCH_SIZE);
        
        await Promise.all(batch.map(async (file) => {
            const ext = path.extname(file).toLowerCase();
            
            if (['.woff', '.woff2', '.ttf', '.eot', '.otf'].includes(ext)) {
                await processFont(file, config);
                stats.fonts++;
            } else {
                await processSingleAsset(config, cache, signal, file);
                if (['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif'].includes(ext)) {
                    stats.images++;
                } else if (ext === '.svg') {
                    stats.svgs++;
                } else {
                    stats.others++;
                }
            }
            processedCount++;
        }));
    }
}



async function processSingleAsset(config, cache, signal, file) {
    const relativePath = path.relative('src/assets', file);
    const cacheKey = relativePath.replace(/\\/g, '/');
    const ext = path.extname(file).toLowerCase();
    
    if (['.woff', '.woff2', '.ttf', '.eot', '.otf'].includes(ext)) return;
    
    try {
        const stat = await fs.stat(file);
        const currentMtime = stat.mtimeMs.toString();
    
        if (config.cache && cache.assets.has(cacheKey)) {
            const cached = cache.assets.get(cacheKey);
            if (cached.mtime === currentMtime) return;
        }

        const content = await fs.readFile(file);
        const noHashExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.avif', '.svg', '.ico', 
                                '.woff', '.woff2', '.ttf', '.eot', '.otf'];
        const shouldHash = !noHashExtensions.includes(ext);
        
        const outputDir = path.join(
            config.outDir, 
            config.assetsDir, 
            path.dirname(relativePath)
        );
        
        const outputFile = shouldHash 
        ? `${path.basename(file, ext)}-${createHash('sha256').update(content).digest('hex').slice(0, 8)}${ext}`
        : path.basename(file);
        
        const outputPath = path.join(outputDir, outputFile);

        await fs.mkdir(outputDir, { recursive: true });
    
        if (['.png', '.jpg', '.jpeg', '.webp', '.avif'].includes(ext)) {
            await optimizeImage(content, ext, outputPath, config, signal);
        } else if (ext === '.svg') {
            await optimizeSvg(content, outputPath, signal);
        } else {
            await fs.writeFile(outputPath, content);
        }
    
        cache.assets.set(cacheKey, {
            mtime: currentMtime,
            outputPath: outputPath
        });
    } catch (error) {
        if (error.name !== 'AbortError') {
            Logger.error(`Failed to process asset ${file}:`, error);
            throw error;
        }
    }
}