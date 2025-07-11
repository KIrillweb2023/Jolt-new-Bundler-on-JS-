import fastGlob from 'fast-glob';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sass from 'sass';
import postcss from 'postcss';
import autoprefixer from 'autoprefixer';
import cssnano from 'cssnano';
import { generateContentHash, cleanOldHashes } from "../utils/hash-utils.js";
import { ApiLogger, LogLevel } from '../api/ApiLogger.js';

const logger = new ApiLogger("JOLT-CSS", LogLevel.DEBUG)
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Кэш для Sass-компиляции
const sassCache = new Map();

export function cssPlug(userOptions = {}) {
    const defaults = {
        input: ['src/**/*.{css,scss,sass}'],
        output: 'dist/[name].[hash].css',
        minify: process.env.NODE_ENV === 'production',
        sourcemap: process.env.NODE_ENV !== 'production',
        hashLength: 8,
        cleanOldHashes: true,
        cache: true
    };

    const options = { ...defaults, ...userOptions };
    let cache = { hash: '', files: new Set() };
    let outputDirChecked = false;

    return {
        name: 'optimized-css-bundler',

        async afterBuild() {
            const startTime = Date.now();
            try {
                const outputDir = path.dirname(options.output.replace(/\[.*\]/, ''));

                // Проверка директории один раз
                if (!outputDirChecked) {
                    try {
                        await access(outputDir);
                    } catch {
                        await mkdir(outputDir, { recursive: true });
                    }
                    outputDirChecked = true;
                }

                const files = await fastGlob(options.input, { stats: true });
                if (!files.length) {
                    logger.warn('No CSS files found matching pattern:', options.input);
                    return;
                }

                // Параллельная обработка файлов с кэшированием
                const cssChunks = await Promise.all(
                    files.map(file => processCSSWithCache(file.path, options))
                );

                // Эффективное объединение CSS
                const combinedCSS = cssChunks
                    .map((css, i) => `/* ${path.basename(files[i].path)} */\n${css}`)
                    .join('\n\n');

                const postcssPlugins = [autoprefixer()];
                if (options.minify) {
                    postcssPlugins.push(cssnano({ preset: 'default' }));
                }

                const result = await postcss(postcssPlugins).process(combinedCSS, {
                    from: undefined,
                    to: undefined,
                    map: options.sourcemap ? { inline: false } : false
                });

                const contentHash = generateContentHash(result.css, {
                    length: options.hashLength
                });

                if (options.cache && contentHash === cache.hash) {
                    logger.log('✅ CSS bundle is up to date (cached)');
                    return;
                }

                const outputFile = options.output
                    .replace('[name]', 'bundle')
                    .replace('[hash]', contentHash);

                const outputPath = path.join(outputDir, path.basename(outputFile));

                if (options.cleanOldHashes) {
                    await cleanOldHashes(outputDir, 'bundle', '.css');
                }

                // Параллельная запись файлов
                await Promise.all([
                    writeFile(outputPath, result.css),
                    options.sourcemap && result.map && writeFile(`${outputPath}.map`, result.map.toString())
                ]);

                cache = { hash: contentHash, files: new Set(files.map(f => f.path)) };

                logger.success(`✅ CSS bundle created in ${Date.now() - startTime}ms: ${path.relative(process.cwd(), outputPath)}`);

                return {
                    fileName: path.basename(outputPath),
                    filePath: outputPath,
                    hash: contentHash
                };
            } catch (error) {
                logger.error('❌ CSS bundling failed:', error);
                throw error;
            }
        }
    };
}

async function processCSSWithCache(filePath, options) {
    if (options.cache && sassCache.has(filePath)) {
        return sassCache.get(filePath);
    }

    const result = await processCSS(filePath, options);

    if (options.cache) {
        sassCache.set(filePath, result);
    }

    return result;
}

async function processCSS(filePath, options) {
    const ext = path.extname(filePath);
    let cssContent;

    if (ext === '.scss' || ext === '.sass') {
        const compileResult = sass.compile(filePath, {
            loadPaths: [path.dirname(filePath)],
            style: 'expanded',
            sourceMap: false,
            quietDeps: true
        });
        cssContent = compileResult.css;
    } else {
        cssContent = await readFile(filePath, 'utf8');
    }

    return await resolveImportsOptimized(cssContent, path.dirname(filePath));
}

async function resolveImportsOptimized(cssContent, baseDir) {
    const importRegex = /@import\s+['"]([^'"]+)['"];/g;
    const imports = [];
    let match;

    while ((match = importRegex.exec(cssContent)) !== null) {
        imports.push(match[1]);
    }

    if (!imports.length) return cssContent;

    // Параллельная обработка импортов
    const importPromises = imports.map(async (importPath) => {
        const fullPath = importPath.startsWith('.')
            ? path.resolve(baseDir, importPath)
            : path.resolve(__dirname, 'node_modules', importPath.replace(/^~/, ''));

        const foundExtension = await findFileWithExtensionFast(fullPath, ['.css', '.scss', '.sass']);
        if (!foundExtension) {
            logger.warn(`Import not found: ${importPath}`);
            return { importPath, content: '' };
        }

        const importedContent = await processCSS(`${fullPath}${foundExtension}`, { minify: false });
        return { importPath, content: importedContent };
    });

    const resolvedImports = await Promise.all(importPromises);
    let resolvedContent = cssContent;

    for (const { importPath, content } of resolvedImports) {
        resolvedContent = resolvedContent.replace(
            `@import "${importPath}";`,
            `/* Imported from ${importPath} */\n${content}`
        );
    }

    return resolvedContent;
}

async function findFileWithExtensionFast(basePath, extensions) {
    const patterns = extensions.map(ext => `${basePath}${ext}`);
    const files = await fastGlob(patterns, { onlyFiles: true });
    return files[0] ? path.extname(files[0]) : null;
}