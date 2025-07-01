import { perf } from '../utils/perf.js';
import { Logger } from '../core/Logger.js';
import { processHtml } from './html-processor.js';
import path from 'node:path';
import { globby } from 'globby';
import fs from "node:fs/promises";
import { createHash } from 'node:crypto';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import cssnano from 'cssnano';
import { transform as lightningcss } from 'lightningcss';

export async function processStyles(config, cache, signal, isProduction, changedFiles = null) {
    perf.mark('styles-start');
    const { include, exclude } = config.css;
    const cssFiles = changedFiles 
        ? changedFiles.filter(f => /\.(css|scss|sass|less)$/i.test(f))
        : await globby(include, { ignore: exclude, signal });

    if (!cssFiles.length) return;

    // Генерируем хеш на основе содержимого всех файлов
    const filesContent = await Promise.all(cssFiles.map(f => fs.readFile(f, 'utf8')));
    const contentHash = createHash('sha256').update(filesContent.join('')).digest('hex').slice(0, 8);
    const cacheKey = cssFiles.map(f => path.basename(f)).join('|');

    // Проверяем кэш
    if (config.cache && cache.styles.has(cacheKey) && cache.styles.get(cacheKey).hash === contentHash) {
        Logger.debug('Using cached CSS build');
        return;
    }

    try {
        // Компилируем все файлы
        const compiledCss = await compileAllCssFiles(config, cssFiles, isProduction);
        
        // Обрабатываем PostCSS
        const processedCss = await applyPostcssPlugins(config, compiledCss, isProduction);
        
        // Сохраняем результат
        const outputFile = path.join(config.outDir, `styles-${contentHash}.css`);
        await saveCssBundle(outputFile, processedCss, cache, cacheKey, contentHash, config, isProduction, signal);

        perf.measure('Styles Processing', 'styles-start');
        Logger.success(`Updated CSS bundle: ${path.basename(outputFile)}`);
    } catch (error) {
        if (error.name !== 'AbortError') {
            Logger.error('CSS processing failed:', error);
            throw error;
        }
    }
}

async function compileAllCssFiles(config, files, isProduction) {
    const results = await Promise.all(
        files.map(file => compileSingleCssFile(config, file, isProduction))
    );
    return results.join('\n');
}

async function compileSingleCssFile(config, file, isProduction) {
    try {
        const fileContent = await fs.readFile(file, 'utf8');
        const ext = path.extname(file);
        const dir = path.dirname(file);

        switch (ext) {
            case '.scss':
            case '.sass':
                const sass = await import('sass');
                return sass.compileString(fileContent, {
                    loadPaths: [dir, 'node_modules'],
                    style: isProduction ? 'compressed' : 'expanded',
                    sourceMap: config.sourcemap
                }).css;
            
            case '.less':
                const less = await import('less');
                return (await less.render(fileContent, {
                    filename: file,
                    paths: [dir, 'node_modules'],
                    sourceMap: config.sourcemap ? { sourceMapFileInline: true } : undefined
                })).css;
            
            case '.styl':
                const stylus = await import('stylus');
                return await new Promise((resolve, reject) => {
                    stylus(fileContent)
                        .set('filename', file)
                        .set('paths', [dir, 'node_modules'])
                        .set('compress', isProduction)
                        .set('sourcemap', config.sourcemap)
                        .render((err, css) => err ? reject(err) : resolve(css));
                });
            
            default:
                return fileContent;
        }
    } catch (error) {
        Logger.error(`Failed to process ${file}:`, error);
        throw error;
    }
}

async function applyPostcssPlugins(config, css, isProduction) {
    const plugins = [
        ...(config.tailwind ? [tailwindcss(config.tailwind === true ? {} : config.tailwind)] : []),
        autoprefixer(),
        ...(isProduction && config.minify.css ? [cssnano({
            preset: ['default', {
                discardComments: { removeAll: true },
                reduceIdents: false
            }]
        })] : [])
    ];

    try {
        const result = await postcss(plugins).process(css, {
            from: undefined,
            map: config.sourcemap
        });

        return isProduction 
            ? (await lightningcss({
                code: Buffer.from(result.css),
                minify: true,
                sourceMap: config.sourcemap
            })).code.toString()
            : result.css;
    } catch (error) {
        Logger.error('PostCSS processing failed:', error);
        return css;
    }
}

async function saveCssBundle(outputFile, css, cache, cacheKey, hash, config, isProduction, signal) {
    // Удаляем старый файл если он существует
    if (cache.styles.has(cacheKey)) {
        const oldFile = cache.styles.get(cacheKey).outputFile;
        if (oldFile !== outputFile) {
            try { await fs.unlink(oldFile); } 
            catch (e) { Logger.debug(`Could not delete old CSS file: ${e.message}`); }
        }
    }
    
    await fs.writeFile(outputFile, css);
    
    // Обновляем кэш и HTML при необходимости
    cache.styles.set(cacheKey, { hash, outputFile });
    if (cache.html.size > 0) {
        cache.html.clear();
        await processHtml(config, cache, isProduction, signal);
    }
}