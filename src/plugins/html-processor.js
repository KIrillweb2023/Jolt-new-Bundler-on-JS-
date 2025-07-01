import { perf } from "../utils/perf.js";
import fs from "node:fs/promises";
import { Logger } from "../core/Logger.js";
import { globby } from "globby";
import path from "node:path";
import { FindFilesWithRetry } from "../utils/file-finder.js";
import { minify }  from "html-minifier-terser";

export async function processHtml(config, cache, isProduction, signal) {
    perf.mark('html-start');
    const htmlFiles = await globby('src/**/*.html');
    if (!htmlFiles.length) return;

    const [jsResult, cssResult] = await Promise.allSettled([
        FindFilesWithRetry(signal, `${config.outDir}/**/*.js`),
        FindFilesWithRetry(signal, `${config.outDir}/**/*.css`)
    ]);

    const jsFiles = jsResult.status === 'fulfilled' ? jsResult.value.filter(f => !f.includes(config.staticDir)) : [];
    const cssFiles = cssResult.status === 'fulfilled' ? cssResult.value.filter(f => !f.includes(config.staticDir)) : [];

    await Promise.all(htmlFiles.map(file => processSingleHtml(config, cache, isProduction, file, jsFiles, cssFiles)));

    perf.measure('HTML Processing', 'html-start');
    Logger.success(`Processed ${htmlFiles.length} HTML files`);
}

export async function processSingleHtml(config, cache, isProduction, file, jsFiles, cssFiles) {
    const cacheKey = path.basename(file);
    const stat = await fs.stat(file);
    const currentMtime = stat.mtimeMs.toString();

    if (config.cache && cache.html.has(cacheKey)) {
        const cached = cache.html.get(cacheKey);
        if (cached.mtime === currentMtime) {
            await fs.writeFile(path.join(config.outDir, cacheKey), cached.html);
            Logger.debug(`Used cached HTML: ${cacheKey}`);
            return;
        }
    }

    try {
        let html = await fs.readFile(file, 'utf8');
        const staticPath = `${config.staticDir}/`;
        const staticPathRegex = new RegExp(staticPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        
        html = html
            .replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi, match => 
            staticPathRegex.test(match) ? match : '')
            .replace(/<script[^>]*type=["']module["'][^>]*>.*?<\/script>/gi, match => 
            staticPathRegex.test(match) ? match : '');

        const jsTags = jsFiles.map(js =>
            `\t<script type="module" src="/${path.relative(config.outDir, js).replace(/\\/g, '/')}"></script>`
        ).join('\n') || '';

        const cssTags = cssFiles.map(css =>
            `\t<link rel="stylesheet" href="/${path.relative(config.outDir, css).replace(/\\/g, '/')}">`
        ).join('\n') || ''; 

        if (cssTags) {
            html = html.includes('</head>') ? 
            html.replace('</head>', `${cssTags}\n</head>`) : 
            `${cssTags}\n${html}`;
        }

        if (jsTags) {
            html = html.includes('</body>') ? 
            html.replace('</body>', `${jsTags}\n</body>`) : 
            `${html}\n${jsTags}`;
        }

        if (isProduction && config.minify.html) {
            html = await minify(html, {
            collapseWhitespace: true,
            removeComments: true,
            minifyJS: false,
            minifyCSS: true,
            processConditionalComments: true,
            minifyURLs: true
            });
        }

        await fs.writeFile(path.join(config.outDir, path.basename(file)), html);
        
        cache.html.set(cacheKey, {
            mtime: currentMtime,
            html: html
        });

        Logger.debug(`Processed HTML: ${cacheKey}`);
    } catch (error) {
      if (error.name !== 'AbortError') {
        Logger.error(`Failed to process HTML file ${file}:`, error);
        throw error;
      }
    }
}