import { perf } from '../utils/perf.js';
import { Logger } from '../core/Logger.js';
import path from 'node:path';
import { globby } from 'globby';
import fs from "node:fs/promises";
import { resolveImports } from './css-import-resolver.js';
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
        : await globby(include, { ignore: exclude, signal: signal });

    if (!cssFiles.length) return;

    // Генерируем уникальный ключ кэша на основе всех CSS файлов
    const allCssFiles = await globby(include, { ignore: exclude, signal: signal });
    const cacheKey = allCssFiles.map(f => path.basename(f)).join('|');
    
    // Получаем хеш текущего состояния CSS файлов
    const filesContent = await Promise.all(allCssFiles.map(f => fs.readFile(f, 'utf8')));
    const contentHash = createHash('sha256').update(filesContent.join('')).digest('hex').slice(0, 8);

    // Проверяем кэш
    if (config.cache && cache.styles.has(cacheKey)) {
        const cached = cache.styles.get(cacheKey);
        if (cached.hash === contentHash) {
            Logger.debug('Using cached CSS build');
            return;
        }
    }

    try {
        const combinedCss = await compileCssWithDependencies(config, allCssFiles, isProduction);
        const processedCss = await applyPostcssPlugins(config, combinedCss, isProduction);
        
        // Всегда используем хешированное имя файла
        const outputFile = path.join(config.outDir, `styles-${contentHash}.css`);
        
        // Удаляем старые CSS файлы только если хеш изменился
        if (cache.styles.has(cacheKey)) {
            const oldOutputFile = cache.styles.get(cacheKey).outputFile;
            if (oldOutputFile !== outputFile) {
                try {
                    await fs.unlink(oldOutputFile);
                } catch (e) {
                    Logger.debug(`Could not delete old CSS file: ${e.message}`);
                }
            }
        }
        
        await fs.writeFile(outputFile, processedCss);

        // Обновляем ссылку в HTML (если используется)
        if (cache.html.size > 0) {
            cache.html.clear();
            await processHtml(config, cache, isProduction, signal);
        }

        cache.styles.set(cacheKey, {
            hash: contentHash,
            outputFile
        });

        perf.measure('Styles Processing', 'styles-start');
        Logger.success(`Updated CSS bundle: ${path.basename(outputFile)}`);
    } catch (error) {
        if (error.name !== 'AbortError') {
            Logger.error('CSS processing failed:', error);
            throw error;
        }
    }
}

export async function clearOldCssBundles(outDir) {
    const files = await globby(`${outDir}/styles-*.css`);
    await Promise.all(files.map(file => fs.unlink(file)));
}

export async function compileCssWithDependencies(config, files, isProduction) {   
    const results = await Promise.all(files.map(file => processSingleCssFile(config, file, isProduction)));
    return results.join('\n');
}

export async function processSingleCssFile(config, file, isProduction) {
    try {
        const fileContent = await fs.readFile(file, 'utf8');
        const ext = path.extname(file);
        const dir = path.dirname(file);
        let compiledCss = await resolveImports(fileContent, dir);

        switch (ext) {
            case '.scss':
            case '.sass':
                const sass = await import('sass');

                compiledCss = sass.compileString(compiledCss, {
                    loadPaths: [dir, 'node_modules'],
                    style: isProduction ? 'compressed' : 'expanded',
                    sourceMap: config.sourcemap
                }).css;
            break;
            
            case '.less':
                const less = await import('less');
                compiledCss = (await less.render(compiledCss, {
                    filename: file,
                    paths: [dir, 'node_modules'],
                    sourceMap: config.sourcemap
                    ? { sourceMapFileInline: true }
                    : undefined
                })).css;
            break;
            
            case '.styl':
            const stylus = await import('stylus');
                compiledCss = await new Promise((resolve, reject) => {
                    stylus(compiledCss)
                    .set('filename', file)
                    .set('paths', [dir, 'node_modules'])
                    .set('compress', isProduction)
                    .set('sourcemap', config.sourcemap)
                    .render((err, css) => err ? reject(err) : resolve(css));
                });
            break;
        }

        return compiledCss;
    } catch (error) {
        if (error.name !== 'AbortError') {
            Logger.error(`Failed to process ${file}:`, error);
            throw error;
        }
        return '';
    }
  }

export async function applyPostcssPlugins(config, css, isProduction) {
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

        if (isProduction) {
            const { code } = await lightningcss({
                code: Buffer.from(result.css),
                minify: true,
                sourceMap: config.sourcemap
            });
            return code.toString();
        }

        return result.css;
    } catch (error) {
        Logger.error('PostCSS processing failed:', error);
        return css;
    }
}