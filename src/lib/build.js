import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url'
import glob from 'fast-glob';
import buildDependencyGraph from './components/graph-script.js';
import { generateESBundle, generateIIFEBundle } from './components/generate-script.js';
import writeOutput from './components/result-script.js';
import { catchError } from './components/utils-script.js';
import runPlugins from './components/plugin-script.js';
import { ApiLogger, LogLevel } from '../api/ApiLogger.js';
const logger = new ApiLogger("JOLT-BUILD", LogLevel.DEBUG)

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class Build {
    #config;
    #graph = new Map();
    #cache = new Map();

    constructor(config = {}) {
        this.#config = {
            entry: config.entry || null,
            pattern: config.pattern || null,
            outdir: config.outdir || 'dist',
            outfile: config.outfile || null, // Новая опция для единого выходного файла
            format: config.format || 'iife',
            platform: config.platform || 'browser',
            cache: config.cache !== false, // По умолчанию true

            // Настройки трансформации
            target: config.swcOptions?.jsc?.target || 'es2022',
            sourcemaps: config.swcOptions?.sourceMaps ? 'inline' : false,
            minify: !!config.swcOptions?.jsc?.minify,

            // Расширенные настройки SWC
            swcOptions: {
                jsc: {
                    parser: {
                        syntax: config.swcOptions?.jsc?.parser?.syntax || 'ecmascript',
                        jsx: !!config.swcOptions?.jsc?.parser?.jsx,
                        tsx: !!config.swcOptions?.jsc?.parser?.tsx,
                        dynamicImport: !!config.swcOptions?.jsc?.parser?.dynamicImport
                    },
                    target: config.swcOptions?.jsc?.target || 'es2022',
                    minify: config.swcOptions?.jsc?.minify || false,
                    transform: {
                        optimizer: {
                            simplify: true
                        }
                    }
                },
                module: {
                    type: config.swcOptions?.module?.type || 'commonjs'
                },
                sourceMaps: config.sourcemaps === true
            },

            // Внешние зависимости
            external: config.external || [],
            plugins: config.plugins || []
        };
        if (!this.#config.entry && !this.#config.pattern) {
            throw new Error('Either "entry" or "pattern" must be provided');
        }
        if (this.#config.outfile && this.#config.outdir) {
            logger.warn('Both outfile and outdir specified - using outfile');
        }
    }

    async build() {
        try {
            const entries = this.#config.pattern
                ? await glob(this.#config.pattern)
                : [this.#config.entry];

            // Очищаем только при отключенном кешировании
            if (!this.#config.cache) {
                await fs.rm(this.#config.outdir, { recursive: true, force: true });
            }

            // Параллельная обработка entry-точек
            const buildPromises = entries.map(async (entry) => {
                const modules = await buildDependencyGraph(
                    this.#config,
                    this.#cache,
                    this.#graph,
                    entry
                );

                const outFile = this.#config.outfile ||
                    path.join(
                        this.#config.outdir,
                        `${path.basename(entry, path.extname(entry))}.js`
                    );

                const bundle = this.#config.format === 'esm'
                    ? await generateESBundle(modules, entry)
                    : await generateIIFEBundle(modules, entry);

                await writeOutput(this.#config, bundle, outFile);
                return outFile;
            });

            const outputFiles = await Promise.all(buildPromises);


            await runPlugins(this.#config, this.#cache, this.#graph, 'afterBuild', {
                config: this.#config,
                outputFiles
            })

            return catchError(true, null, this.#config, outputFiles);
        } catch (error) {
            logger.error('Build failed:', error);
            return catchError(false, error, this.#config, null);
        }
    }
}