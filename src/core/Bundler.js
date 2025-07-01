import esbuild from 'esbuild';
import fs from 'node:fs/promises';
import { Logger, colors } from './Logger.js';
import { perf } from '../utils/perf.js';
import { startServer } from '../utils/server.js';
import { stopBuildProcess } from '../utils/cleanup.js';
import { startWatcher } from '../utils/watcher.js';
import { processChanges } from '../utils/change-processor.js';
import compressFiles from '../utils/compression.js';
import { copyStaticFiles } from '../utils/file-utils.js';
import { processAssets } from '../plugins/asset-manager.js';
import { processStyles } from '../plugins/css-preprocessor.js';
import { handleBuildEndScript } from '../plugins/script-processor.js';
import { Cleaner } from '../utils/cleaner.js';
import { runPipeline } from '../utils/task-manager.js';
import { processHtml } from '../plugins/html-processor.js';

const DEFAULT_CONFIG = {
  assetsDir: 'assets',
  staticDir: 'static',
  publicDir: 'public',
  sourcemap: true,
  tailwind: false,
  compress: false,
  watch: false,
  serve: false,
  cache: true,
  parallel: true,
  css: {
    include: ['src/**/*.css'],
    exclude: [],
    modules: false,
    inlineCritical: true
  },
  minify: {
    js: false,
    css: false,
    html: false
  },
  image: {
    formats: ['webp', 'avif'],
    quality: 80,
    resize: {
      width: 2000,
      height: 2000,
      withoutEnlargement: true
    }
  },
  svgo: {
    plugins: [
      'preset-default',
      { name: 'removeViewBox', active: false },
      'removeDimensions',
      'sortAttrs'
    ]
  },
  fonts: {
    formats: ['woff2', 'woff'],
    preload: true,
    subset: false
  },
  esbuild: {
    target: 'es2022',
    format: 'esm',
    treeShaking: true,
    splitting: true,
    metafile: true
  },
  server: {
    port: 3000,
    open: true,
    host: '0.0.0.0'
  }
};

export class JoltBundler {
  #config;
  #isProduction;
  #isCI;
  #cache = {
    assets: new Map(),
    scripts: new Map(),
    styles: new Map(),
    html: new Map()
  };
  #abortController = new AbortController();
  #activeBuilds = new Set();
  #pendingQueue = new Set();
  #esbuildContext = null;

  constructor(config = {}) {
    this.#isProduction = process.env.NODE_ENV === 'production';
    this.#isCI = process.env.CI === 'true';

    this.#config = {
      ...DEFAULT_CONFIG,
      entry: config.entry || './src/main.js',
      outDir: config.outDir || './dist',
      sourcemap: !this.#isProduction,
      compress: this.#isProduction,
      watch: !this.#isProduction && !this.#isCI,
      serve: !this.#isProduction && !this.#isCI,
      minify: {
        js: this.#isProduction,
        css: this.#isProduction,
        html: this.#isProduction
      },
      pendingChanges: new Set(),
      debounceTimer: null,
      activeRebuild: false,
      watcher: null,
      ...config,
      css: { ...DEFAULT_CONFIG.css, ...config.css },
      image: { ...DEFAULT_CONFIG.image, ...config.image },
      svgo: { ...DEFAULT_CONFIG.svgo, ...config.svgo },
      fonts: { ...DEFAULT_CONFIG.fonts, ...config.fonts },
      esbuild: { ...DEFAULT_CONFIG.esbuild, ...config.esbuild },
      server: { ...DEFAULT_CONFIG.server, ...config.server }
    };
  }

  async build() {
    Logger.divider();
    Logger.info(`${colors.bright}🚀 Starting ${this.#isProduction ? 'production' : 'development'} build...`);
    perf.start = performance.now();

    try {
      await Cleaner(this.#config, this.#cache);
      
      await runPipeline(this.#activeBuilds, this.#pendingQueue, this.#config, [
        this.#processScripts.bind(this),
        this.#processStyles.bind(this),
        this.#processAssets.bind(this),
        this.#copyStaticFiles.bind(this),
        this.#processHtml.bind(this)
      ]);

      if (this.#config.compress) {
        await compressFiles(this.#config, this.#abortController);
      }

      this.#logBuildSuccess();
      
      if (this.#config.watch) this.#startWatcher();
      if (this.#config.serve) this.#startServer();

      return { success: true, time: `${(performance.now() - perf.start).toFixed(2)}ms` };
    } catch (error) {
      await this.#handleBuildError(error);
    }
  }

  #logBuildSuccess() {
    const time = (performance.now() - perf.start).toFixed(2);
    Logger.success(`${colors.bright}✨ Build completed successfully in ${time}ms`);
    Logger.divider();
  }

  async #handleBuildError(error) {
    await this.stop();
    Logger.error(`${colors.bright}💥 Build failed!`);
    console.error(error);
    Logger.divider();
    process.exit(1);
  }

  async #processHtml() {
    await processHtml(this.#config, this.#cache, this.#isProduction, this.#abortController.signal);
  }

  async #processScripts() {
    perf.mark('scripts-start');
    const cacheKey = this.#config.entry;
    
    try {
      const stat = await fs.stat(this.#config.entry);
      const currentMtime = stat.mtimeMs.toString();

      if (this.#shouldUseScriptCache(cacheKey, currentMtime)) {
        Logger.debug('Using cached JS build');
        return;
      }

      await this.#disposeEsbuildContext();

      const ctx = await esbuild.context(this.#getEsbuildConfig());
      this.#esbuildContext = ctx;
      
      if (this.#config.watch) {
        await ctx.watch();
      } else {
        const result = await ctx.rebuild();
        await ctx.dispose();
        this.#esbuildContext = null;
        this.#handleScriptsBuildEnd(result);
      }

      this.#cache.scripts.set(cacheKey, { mtime: currentMtime });
      perf.measure('Scripts Processing', 'scripts-start');
    } catch (error) {
      if (error.name !== 'AbortError') {
        Logger.error('Script processing failed:', error);
        throw error;
      }
    }
  }

  #shouldUseScriptCache(cacheKey, currentMtime) {
    return this.#config.cache && 
           this.#cache.scripts.has(cacheKey) && 
           this.#cache.scripts.get(cacheKey).mtime === currentMtime && 
           !this.#config.watch;
  }

  async #disposeEsbuildContext() {
    if (this.#esbuildContext) {
      await this.#esbuildContext.dispose();
      this.#esbuildContext = null;
    }
  }

  #getEsbuildConfig() {
    return {
      entryPoints: [this.#config.entry],
      bundle: true,
      minify: this.#config.minify.js,
      sourcemap: this.#config.sourcemap,
      target: this.#config.esbuild.target,
      format: this.#config.esbuild.format,
      outdir: this.#config.outDir,
      entryNames: '[name]-[hash]',
      treeShaking: this.#config.esbuild.treeShaking,
      splitting: this.#config.esbuild.splitting,
      metafile: this.#config.esbuild.metafile,
      define: {
        'process.env.NODE_ENV': `"${this.#isProduction ? 'production' : 'development'}"`,
        ...this.#config.esbuild.define
      },
      loader: {
        '.js': 'jsx',
        '.ts': 'tsx',
        '.jsx': 'jsx',
        '.tsx': 'tsx',
        '.json': 'json',
        '.woff': 'file',
        '.woff2': 'file',
        '.ttf': 'file',
        '.eot': 'file',
        '.otf': 'file',
        ...this.#config.esbuild.loader
      },
      plugins: [
        {
          name: 'on-end',
          setup: build => build.onEnd(this.#handleScriptsBuildEnd.bind(this))
        },
        ...(this.#config.esbuild.plugins || [])
      ]
    };
  }

  #handleScriptsBuildEnd(result) {
    handleBuildEndScript(this.#cache, this.#isProduction, result);
  }

  async #processStyles() {
    await processStyles(this.#config, this.#cache, this.#abortController.signal, this.#isProduction);
  }

  async #processAssets() {
    await processAssets(this.#config, this.#cache, this.#abortController.signal);
  }

  async #copyStaticFiles() {
    await copyStaticFiles(this.#config, this.#abortController.signal);
  }

  #startWatcher() {
    this.#config.watcher = startWatcher(this.#config, this.#cache, {
      copyStaticFiles: this.#copyStaticFiles.bind(this),
      processStyles: this.#processStyles.bind(this),
      processScripts: this.#processScripts.bind(this),
      processAssets: this.#processAssets.bind(this),
      processHtml: this.#processHtml.bind(this)
    });
  }

  async #processChanges() {
    await processChanges(this.#config, this.#cache, {
      copyStaticFiles: this.#copyStaticFiles.bind(this),
      processStyles: this.#processStyles.bind(this),
      processScripts: this.#processScripts.bind(this),
      processAssets: this.#processAssets.bind(this),
      processHtml: this.#processHtml.bind(this)
    });
  }

  async stop() {
    return stopBuildProcess({
      config: this.#config,
      context: this.#esbuildContext,
      abortController: this.#abortController,
      cache: this.#cache
    });
  }

  #startServer() {
    startServer(this.#config);
  }
}