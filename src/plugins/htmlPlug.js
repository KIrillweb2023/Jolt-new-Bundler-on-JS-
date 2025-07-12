import fs from 'fs/promises';
import path from 'path';
import glob from 'fast-glob';
import { minify } from 'html-minifier-terser';
import { ApiLogger, LogLevel } from '../api/ApiLogger.js';

const logger = new ApiLogger("JOLT-HTML", LogLevel.DEBUG);

export function htmlPlug(options = {}) {
    const defaultOptions = {
        pattern: '**/*.html',
        srcDir: 'src',
        injectScripts: true,
        scriptLoading: 'defer',
        copyAssets: true,
        cleanExistingAssets: true,
        validateHTML: false, // Отключено по умолчанию для производительности
        minify: true,
        minifyOptions: {
            collapseWhitespace: true,
            removeComments: true,
            removeRedundantAttributes: true,
            removeScriptTypeAttributes: true,
            removeStyleLinkTypeAttributes: true,
            useShortDoctype: true,
            minifyCSS: true,
            minifyJS: true,
            minifyURLs: true,
            removeEmptyAttributes: true
        },
        concurrency: 8 // Ограничение параллельных задач
    };

    const finalOptions = { ...defaultOptions, ...options };
    let assetsCache = null;

    return {
        name: 'optimized-html-plugin',

        async afterBuild({ config }) {
            const startTime = Date.now();
            const outputDir = config.outfile ? path.dirname(config.outfile) : config.outdir || 'dist';
            const srcDir = finalOptions.srcDir;
            const htmlFiles = await glob(path.posix.join(srcDir, finalOptions.pattern));

            logger.info(`Processing ${htmlFiles.length} HTML files`);

            // Кэшируем ассеты один раз
            if (!assetsCache && finalOptions.injectScripts) {
                assetsCache = await this.fetchAssets('dist');
            }

            // Обрабатываем файлы с ограничением параллелизма
            await this.processInBatches(htmlFiles, async (htmlFile) => {
                try {
                    const relativePath = path.relative(srcDir, htmlFile);
                    const outputPath = path.join(outputDir, relativePath);

                    await fs.mkdir(path.dirname(outputPath), { recursive: true });

                    let content = await fs.readFile(htmlFile, 'utf-8');

                    if (finalOptions.cleanExistingAssets) {
                        content = this.cleanHtmlAssets(content);
                    }

                    if (finalOptions.injectScripts && assetsCache) {
                        content = this.injectAssets(
                            content,
                            assetsCache,
                            finalOptions.scriptLoading
                        );
                    }

                    if (finalOptions.minify) {
                        try {
                            content = await minify(content, finalOptions.minifyOptions);
                        } catch (error) {
                            logger.error(`Minification error in ${htmlFile}:`, error);
                        }
                    }

                    await fs.writeFile(outputPath, content);
                    logger.debug(`Generated ${outputPath}`);

                    if (finalOptions.copyAssets) {
                        await this.copyRelatedAssets(htmlFile, path.dirname(outputPath));
                    }
                } catch (error) {
                    logger.error(`Error processing ${htmlFile}:`, error);
                    throw error;
                }
            }, finalOptions.concurrency);

            logger.success(`HTML processing completed in ${Date.now() - startTime}ms`);
        },

        async fetchAssets(dir) {
            try {
                const files = await glob(`${dir}/**/*.{js,css}`, {
                    nodir: true,
                    stats: true
                });

                return {
                    js: files.filter(file => file.path.endsWith('.js')).map(f => path.basename(f.path)),
                    css: files.filter(file => file.path.endsWith('.css')).map(f => path.basename(f.path))
                };
            } catch (error) {
                logger.error('Error fetching assets:', error);
                return { js: [], css: [] };
            }
        },

        async processInBatches(items, processor, concurrency = 8) {
            const batches = [];
            for (let i = 0; i < items.length; i += concurrency) {
                batches.push(items.slice(i, i + concurrency));
            }

            for (const batch of batches) {
                await Promise.all(batch.map(processor));
            }
        },

        cleanHtmlAssets(content) {
            // Оптимизированная версия с единым проходом
            return content
                .replace(/<script\b[^>]*>[\s\S]*?<\/script>|<link\b[^>]*\brel=["']?stylesheet["']?[^>]*>/gi, '')
                .replace(/\n\s*\n/g, '\n');
        },

        injectAssets(content, assets, loading = '') {
            let result = content;
            const headEnd = '</head>';
            const bodyEnd = '</body>';

            // Оптимизированная вставка CSS
            if (assets.css.length > 0) {
                const cssTags = assets.css
                    .map(cssFile => `<link rel="stylesheet" href="${cssFile}">`)
                    .join('\n  ');

                if (result.includes(headEnd)) {
                    result = result.replace(headEnd, `  ${cssTags}\n${headEnd}`);
                } else {
                    result = `${cssTags}\n${result}`;
                }
            }

            // Оптимизированная вставка JS
            if (assets.js.length > 0) {
                const jsTags = assets.js
                    .map(jsFile => `<script src="${jsFile}" ${loading}></script>`)
                    .join('\n  ');

                if (result.includes(bodyEnd)) {
                    result = result.replace(bodyEnd, `  ${jsTags}\n${bodyEnd}`);
                } else {
                    result = `${result}\n${jsTags}`;
                }
            }

            return result;
        },

        async copyRelatedAssets(htmlFile, outputDir) {
            try {
                const content = await fs.readFile(htmlFile, 'utf-8');
                const assets = this.extractAssets(content);

                await Promise.all(Array.from(assets).map(async (asset) => {
                    const srcPath = path.join(path.dirname(htmlFile), asset);
                    const destPath = path.join(outputDir, asset);

                    try {
                        await fs.mkdir(path.dirname(destPath), { recursive: true });
                        await fs.copyFile(srcPath, destPath);
                        logger.debug(`Copied asset: ${destPath}`);
                    } catch (error) {
                        if (error.code !== 'ENOENT') {
                            logger.warn(`Failed to copy ${srcPath}:`, error.message);
                        }
                    }
                }));
            } catch (error) {
                logger.error(`Asset copy error for ${htmlFile}:`, error);
            }
        },

        extractAssets(content) {
            const assets = new Set();
            const regex = /<(?:link|img|script).*?(?:href|src)="([^"]+)".*?>/gi;

            let match;
            while ((match = regex.exec(content))) {
                const asset = match[1];
                if (asset && !asset.startsWith('http') && !asset.startsWith('data:')) {
                    assets.add(asset);
                }
            }

            return assets;
        }
    };
}