import { perf } from "../utils/perf.js";
import fs from "node:fs/promises";
import { Logger } from "../core/Logger.js";
import { globby } from "globby";
import path from "node:path";
import { FindFilesWithRetry } from "../utils/file-finder.js";
import { minify }  from "html-minifier-terser";


// Кэш для статических путей (чтобы избежать повторной компиляции RegExp)
const staticPathCache = new Map();

export async function processHtml(config, cache, isProduction, signal) { /// [*] ///
    perf.mark('html-start');
    
    const htmlFiles = await globby('src/**/*.html', { signal });
    if (!htmlFiles.length) return;

    const fileContents = await Promise.all(
        htmlFiles.map(file => fs.readFile(file, 'utf8'))
    );

    const [jsFiles, cssFiles] = await getAssets(config, signal);

    const { jsTags, cssTags } = prepareAssetTags(config, jsFiles, cssFiles);

    await Promise.all(
        htmlFiles.map((file, index) => 
            processSingleHtml(
                config, 
                cache, 
                isProduction, 
                file, 
                fileContents[index], 
                jsTags, 
                cssTags
            )
        )
    );

    perf.measure('HTML Processing', 'html-start');
    Logger.success(`Processed ${htmlFiles.length} HTML files`);
}

async function getAssets(config, signal) {
    try {
        const [jsFiles, cssFiles] = await Promise.all([
            globby(`${config.outDir}/**/*.js`, { 
                signal,
                ignore: [`${config.staticDir}/**`]
            }),
            globby(`${config.outDir}/**/*.css`, {
                signal,
                ignore: [`${config.staticDir}/**`]
            })
        ]);
        return [jsFiles, cssFiles];
    } catch (error) {
        Logger.debug('Assets discovery error:', error);
        return [[], []];
    }
}

function prepareAssetTags(config, jsFiles, cssFiles) {
    const jsTags = jsFiles.map(js =>
        `\t<script type="module" src="/${path.relative(config.outDir, js).replace(/\\/g, '/')}"></script>`
    ).join('\n');

    const cssTags = cssFiles.map(css =>
        `\t<link rel="stylesheet" href="/${path.relative(config.outDir, css).replace(/\\/g, '/')}">`
    ).join('\n');

    return { jsTags, cssTags };
}

async function processSingleHtml(config, cache, isProduction, file, fileContent, jsTags, cssTags) {
    const cacheKey = path.basename(file);
    const stat = await fs.stat(file).catch(() => null);
    
    if (config.cache && cache.html.has(cacheKey) && stat) {
        const cached = cache.html.get(cacheKey);
        if (cached.mtime === stat.mtimeMs.toString()) {
            await fs.writeFile(path.join(config.outDir, cacheKey), cached.html)
                .catch(e => Logger.debug(`Cache write error: ${e.message}`));
            return;
        }
    }

    try {
        let html = processStaticAssets(fileContent, config.staticDir);
        
        if (cssTags) {
            html = insertTags(html, cssTags, '</head>', true);
        }
        
        if (jsTags) {
            html = insertTags(html, jsTags, '</body>', false);
        }

        if (isProduction && config.minify.html) {
            html = await optimizeHtml(html);
        }

        await fs.writeFile(path.join(config.outDir, cacheKey), html);
        
        if (stat) {
            cache.html.set(cacheKey, {
                mtime: stat.mtimeMs.toString(),
                html
            });
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            Logger.error(`HTML processing error [${cacheKey}]:`, error);
            throw error;
        }
    }
}

function processStaticAssets(html, staticDir) {
    if (!staticPathCache.has(staticDir)) {
        const staticPath = `${staticDir}/`;
        staticPathCache.set(
            staticDir,
            new RegExp(staticPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        );
    }
    const staticRegex = staticPathCache.get(staticDir);

    return html
        .replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi, 
            match => staticRegex.test(match) ? match : '')
        .replace(/<script[^>]*type=["']module["'][^>]*>.*?<\/script>/gi,
            match => staticRegex.test(match) ? match : '');
}

function insertTags(html, tags, closingTag, insertBefore) {
    const tagPos = html.indexOf(closingTag);
    return tagPos > -1
        ? html.slice(0, tagPos) + tags + '\n' + html.slice(tagPos)
        : insertBefore 
            ? tags + '\n' + html
            : html + '\n' + tags;
}

async function optimizeHtml(html) {
    try {
        return await minify(html, {
            collapseWhitespace: true,
            removeComments: true,
            minifyCSS: true,
            processConditionalComments: true,
            minifyURLs: true
        });
    } catch (error) {
        Logger.debug('HTML minification error:', error);
        return html; 
    }
}