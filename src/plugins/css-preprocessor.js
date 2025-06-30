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

export async function processStyles(config, cache, signal, isProduction) {
    perf.mark('styles-start');
    const { include, exclude } = config.css;
    const cssFiles = await globby(include, { ignore: exclude, signal: signal });

    if (!cssFiles.length) return;

    const cacheKey = cssFiles.map(f => path.basename(f)).join('|');
    const latestMtime = Math.max(...await Promise.all(cssFiles.map(async f => (await fs.stat(f)).mtimeMs))).toString();

    if (config.cache && cache.styles.has(cacheKey)) {
        const cached = cache.styles.get(cacheKey);
        if (cached.mtime === latestMtime) {
            Logger.debug('Using cached CSS build');
            return;
        }
    }

    try {
        const combinedCss = await compileCssWithDependencies(config, cssFiles, isProduction);
        const processedCss = await applyPostcssPlugins(config, combinedCss, isProduction);
        const cssHash = createHash('sha256').update(processedCss).digest('hex').slice(0, 8);
        const outputFile = path.join(config.outDir, `styles-${cssHash}.css`);

        await clearOldCssBundles(config);
        await fs.writeFile(outputFile, processedCss);

        cache.styles.set(cacheKey, {
            mtime: latestMtime,
            hash: cssHash
        });

        perf.measure('Styles Processing', 'styles-start');
        Logger.success(`Created CSS bundle: ${path.basename(outputFile)}`);
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