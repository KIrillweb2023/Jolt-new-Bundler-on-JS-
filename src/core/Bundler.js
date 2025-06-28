import esbuild from 'esbuild';
import { globby } from 'globby';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { brotliCompress, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import chokidar from 'chokidar';
import liveServer from 'live-server';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import cssnano from 'cssnano';
import sharp from 'sharp';
import { transform as lightningcss } from 'lightningcss';
import { minify as htmlMinifier } from 'html-minifier-terser';

import { Logger, colors } from './Logger.js';

const compressAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);



export class JoltBundler {
  #config;
  #isProduction;
  #cache = {
    assets: new Map(),
    scripts: new Map(),
    styles: new Map(),
    html: new Map()
  };
  #abortController = new AbortController();

  constructor(config = {}) {
    this.#config = {
      entry: './src/main.js',
      outDir: './dist',
      assetsDir: 'assets',
      sourcemap: true,
      tailwind: false,
      compress: true,
      watch: false,
      serve: false,
      css: { include: ['src/**/*.css'], exclude: [] },
      minify: { js: true, css: true, html: true },
      ...config
    };
    this.#isProduction = process.env.NODE_ENV === 'production';
  }

  async build() {
    Logger.divider();
    Logger.info(`${colors.bright}🚀 Starting ${this.#isProduction ? 'production' : 'development'} build...`);
    const start = performance.now();
    
    try {
      await this.#cleanOutput();
      
      // Параллельная обработка всех типов файлов
      await Promise.all([
        this.#processScripts(),
        this.#processStyles(),
        this.#processAssets(),
        this.#copyStaticFiles(),
        this.#processHtml()
      ]);

      if (this.#config.compress) {
        await this.#compressOutput();
      }

      const time = (performance.now() - start).toFixed(2);
      Logger.success(`${colors.bright}✨ Build completed successfully in ${time}s`);
      Logger.divider();

      if (this.#config.watch) this.#startWatcher();
      if (this.#config.serve) this.#startServer();

      return { success: true, time: `${time}s` };
    } catch (error) {
      this.#abortController.abort();
      Logger.error(`${colors.bright}💥 Build failed!`);
      console.error(error);
      Logger.divider();
      process.exit(1);
    }
  }

  async #processHtml() {
    const htmlFiles = await globby('src/**/*.html');
    if (!htmlFiles.length) return;

    const [jsResult, cssResult] = await Promise.allSettled([
      this.#findFilesWithRetry(`${this.#config.outDir}/**/*.js`),
      this.#findFilesWithRetry(`${this.#config.outDir}/**/*.css`)
    ]);

    const jsFiles = jsResult.status === 'fulfilled' ? jsResult.value : [];
    const cssFiles = cssResult.status === 'fulfilled' ? cssResult.value : [];

    const BATCH_SIZE = 5;
    for (let i = 0; i < htmlFiles.length; i += BATCH_SIZE) {
      const batch = htmlFiles.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(file => this.#processSingleHtml(file, jsFiles, cssFiles)));
    }
    
    Logger.success(`Processed ${htmlFiles.length} HTML files`);
  }

  async #processSingleHtml(file, jsFiles, cssFiles) {
    const cacheKey = path.basename(file);
    try {
      const stat = await fs.stat(file);
      const currentMtime = stat.mtimeMs.toString();

      if (this.#cache.html.has(cacheKey)) {
        const cached = this.#cache.html.get(cacheKey);
        if (cached.mtime === currentMtime) {
          await fs.writeFile(path.join(this.#config.outDir, cacheKey), cached.html);
          Logger.debug(`Used cached HTML: ${cacheKey}`);
          return;
        }
      }

      let html = await fs.readFile(file, 'utf8');
      
      const jsTags = jsFiles?.map(js => 
        `\t<script type="module" src="/${path.relative(this.#config.outDir, js)}"></script>`
      ).join('\n') || '';

      const cssTags = cssFiles?.map(css => 
        `\t<link rel="stylesheet" href="/${path.relative(this.#config.outDir, css)}">`
      ).join('\n') || '';

      html = html
        .replace('</head>', `${cssTags}\n</head>`)
        .replace('</body>', `${jsTags}\n</body>`);

      if (this.#isProduction && this.#config.minify.html) {
        html = await htmlMinifier(html, {
          collapseWhitespace: true,
          removeComments: true
        });
      }

      await fs.writeFile(path.join(this.#config.outDir, path.basename(file)), html);

      this.#cache.html.set(cacheKey, {
        mtime: currentMtime,
        html: html
      });
    } catch (error) {
      if (error.name !== 'AbortError') {
        Logger.error(`Failed to process HTML file ${file}:`, error);
        throw error;
      }
    }
  }

  async #findFilesWithRetry(pattern, attempts = 3, delay = 50) {
    for (let i = 0; i < attempts; i++) {
      try {
        const files = await globby(pattern, { signal: this.#abortController.signal });
        if (files.length) return files;
        await new Promise(resolve => setTimeout(resolve, delay));
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        if (i === attempts - 1) throw error;
      }
    }
    return [];
  }

  async #cleanOutput() {
    await fs.rm(this.#config.outDir, { recursive: true, force: true });
    await fs.mkdir(path.join(this.#config.outDir, this.#config.assetsDir), { recursive: true });
    
    this.#cache = {
      assets: new Map(),
      scripts: new Map(),
      styles: new Map(),
      html: new Map()
    };
  }

  async #processScripts() {
    const cacheKey = this.#config.entry;
    try {
      const stat = await fs.stat(this.#config.entry);
      const currentMtime = stat.mtimeMs.toString();

      if (this.#cache.scripts.has(cacheKey)) {
        const cached = this.#cache.scripts.get(cacheKey);
        if (cached.mtime === currentMtime && !this.#config.watch) {
          Logger.debug('Using cached JS build');
          return;
        }
      }

      const ctx = await esbuild.context(this.#getEsbuildConfig());
      
      if (this.#config.watch) {
        await ctx.watch();
      } else {
        await ctx.rebuild();
        await ctx.dispose();
      }

      this.#cache.scripts.set(cacheKey, {
        mtime: currentMtime
      });
    } catch (error) {
      if (error.name !== 'AbortError') {
        Logger.error('Script processing failed:', error);
        throw error;
      }
    }
  }

  #getEsbuildConfig() {
    return {
      entryPoints: [this.#config.entry],
      bundle: true,
      minify: this.#isProduction && this.#config.minify.js,
      sourcemap: this.#config.sourcemap,
      target: 'es2022',
      format: 'esm',
      outdir: this.#config.outDir,
      entryNames: '[name]-[hash]',
      loader: {
        '.js': 'jsx',
        '.ts': 'tsx',
        '.jsx': 'jsx',
        '.tsx': 'tsx',
      },
      plugins: [{
        name: 'on-end',
        setup: (build) => build.onEnd(this.#handleScriptsBuildEnd)
      }]
    };
  }

  #handleScriptsBuildEnd = (result) => {
    if (result.errors.length) {
      Logger.error(`JavaScript processing failed with ${result.errors.length} errors`);
    } else {
      const count = result.metafile?.outputs ? Object.keys(result.metafile.outputs).length : '?';
      Logger.success(`Processed ${count} JS files`);
    }
  }

  async #processStyles() {
    const { include, exclude } = this.#config.css;
    const cssFiles = await globby(include, { ignore: exclude, signal: this.#abortController.signal });

    if (!cssFiles.length) return;

    const cacheKey = cssFiles.map(f => path.basename(f)).join('|');
    const latestMtime = Math.max(...await Promise.all(
      cssFiles.map(async f => (await fs.stat(f)).mtimeMs)
    )).toString();

    if (this.#cache.styles.has(cacheKey)) {
      const cached = this.#cache.styles.get(cacheKey);
      if (cached.mtime === latestMtime) {
        Logger.debug('Using cached CSS build');
        return;
      }
    }

    try {
      const combinedCss = await this.#compileCssWithDependencies(cssFiles);
      const processedCss = await this.#applyPostcssPlugins(combinedCss);
      const cssHash = createHash('sha256').update(processedCss).digest('hex').slice(0, 8);
      const outputFile = path.join(this.#config.outDir, `styles-${cssHash}.css`);
      
      await fs.writeFile(outputFile, processedCss);
      Logger.success(`Created CSS bundle: ${path.basename(outputFile)}`);

      this.#cache.styles.set(cacheKey, {
        mtime: latestMtime
      });
    } catch (error) {
      if (error.name !== 'AbortError') {
        Logger.error('CSS processing failed:', error);
        throw error;
      }
    }
  }

  async #compileCssWithDependencies(files) {
    const results = await Promise.all(
      files.map(file => this.#processSingleCssFile(file))
    );
    return results.join('\n');
  }

  async #processSingleCssFile(file) {
    try {
      const fileContent = await fs.readFile(file, 'utf8');
      const ext = path.extname(file);
      const dir = path.dirname(file);

      let compiledCss = await this.#resolveImports(fileContent, dir);
      
      if (ext === '.scss' || ext === '.sass') {
        const sass = await import('sass');
        compiledCss = sass.compileString(compiledCss, {
          loadPaths: [dir, 'node_modules'],
          style: this.#isProduction ? 'compressed' : 'expanded'
        }).css;
      } else if (ext === '.less') {
        const less = await import('less');
        compiledCss = (await less.render(compiledCss, {
          filename: file,
          paths: [dir, 'node_modules']
        })).css;
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

  async #resolveImports(cssContent, baseDir) {
    const importRegex = /@import\s+["'](.+?)["'];/g;
    const imports = [];
    let match;
    
    // Сначала собираем все импорты
    while ((match = importRegex.exec(cssContent)) !== null) {
      imports.push(match[1]);
    }
    
    // Затем параллельно их обрабатываем
    const resolvedImports = await Promise.all(
      imports.map(async importPath => {
        const fullPath = path.resolve(baseDir, importPath);
        try {
          const importedContent = await fs.readFile(fullPath, 'utf8');
          return this.#resolveImports(importedContent, path.dirname(fullPath));
        } catch {
          Logger.warn(`Could not resolve @import "${importPath}" in ${baseDir}`);
          return '';
        }
      })
    );
    
    // Заменяем импорты в оригинальном содержимом
    return cssContent.replace(importRegex, () => resolvedImports.shift() || '');
  }

  async #applyPostcssPlugins(css) {
    const plugins = [
      ...(this.#config.tailwind ? [tailwindcss()] : []),
      autoprefixer(),
      ...(this.#isProduction && this.#config.minify.css ? [cssnano()] : [])
    ];

    try {
      const result = await postcss(plugins).process(css, {
        from: undefined,
        map: this.#config.sourcemap
      });

      if (this.#isProduction) {
        const { code } = await lightningcss({
          code: Buffer.from(result.css),
          minify: true
        });
        return code.toString();
      }

      return result.css;
    } catch (error) {
      Logger.error('PostCSS processing failed:', error);
      return css;
    }
  }

  async #processAssets() {
    const assets = await globby([
      'src/assets/**/*',
      '!**/*.{js,jsx,ts,tsx,css,scss,sass,less}'
    ], { signal: this.#abortController.signal });

    // Обработка ассетов параллельно с ограничением количества одновременно обрабатываемых файлов
    const CONCURRENT_ASSETS = 10;
    for (let i = 0; i < assets.length; i += CONCURRENT_ASSETS) {
      const batch = assets.slice(i, i + CONCURRENT_ASSETS);
      await Promise.all(batch.map(asset => this.#processSingleAsset(asset)));
    }
    
    Logger.success(`Processed ${assets.length} assets`);
  }

  async #processSingleAsset(file) {
    const cacheKey = path.basename(file);
    try {
      const stat = await fs.stat(file);
      const currentMtime = stat.mtimeMs.toString();

      if (this.#cache.assets.has(cacheKey)) {
        const cached = this.#cache.assets.get(cacheKey);
        if (cached.mtime === currentMtime) {
          return;
        }
      }

      const ext = path.extname(file).toLowerCase();
      const content = await fs.readFile(file);
      const outputPath = this.#getAssetOutputPath(file, ext, content);

      if (['.png', '.jpg', '.jpeg', '.webp', '.avif'].includes(ext)) {
        await this.#optimizeImage(content, ext, outputPath);
      } else {
        await fs.writeFile(outputPath, content);
      }

      this.#cache.assets.set(cacheKey, {
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

  #getAssetOutputPath(file, ext, content) {
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 8);
    const outputFile = `${path.basename(file, ext)}-${hash}${ext}`;
    return path.join(this.#config.outDir, this.#config.assetsDir, outputFile);
  }

  async #optimizeImage(content, ext, outputPath) {
    try {
      await sharp(content)
        .resize({ width: 2000, withoutEnlargement: true })
        .toFormat(ext.slice(1), { 
          quality: this.#isProduction ? 75 : 90,
          effort: 6
        })
        .toFile(outputPath);
    } catch (error) {
      if (error.name !== 'AbortError') {
        Logger.error(`Failed to optimize image ${outputPath}:`, error);
        throw error;
      }
    }
  }

  async #copyStaticFiles() {
    const files = await globby('src/public/**/*', { signal: this.#abortController.signal });
    
    // Копирование файлов параллельно с ограничением количества
    const CONCURRENT_COPIES = 10;
    for (let i = 0; i < files.length; i += CONCURRENT_COPIES) {
      const batch = files.slice(i, i + CONCURRENT_COPIES);
      await Promise.all(batch.map(file => this.#copySingleFile(file)));
    }
  }

  async #copySingleFile(file) {
    const dest = path.join(this.#config.outDir, path.relative('src/public', file));
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(file, dest);
  }

  async #compressOutput() {
    const files = await globby([`${this.#config.outDir}/**/*.{js,css,html}`], 
      { signal: this.#abortController.signal });
    
    // Параллельное сжатие с ограничением количества одновременно обрабатываемых файлов
    const CONCURRENT_COMPRESS = 5;
    for (let i = 0; i < files.length; i += CONCURRENT_COMPRESS) {
      const batch = files.slice(i, i + CONCURRENT_COMPRESS);
      await Promise.all(batch.map(file => this.#compressSingleFile(file)));
    }
    
    Logger.success(`Compressed ${files.length} files (Brotli + Gzip)`);
  }

  async #compressSingleFile(file) {
    try {
      const content = await fs.readFile(file);
      const [brotli, gz] = await Promise.all([
        compressAsync(content),
        gzipAsync(content)
      ]);
      
      await Promise.all([
        fs.writeFile(`${file}.br`, brotli),
        fs.writeFile(`${file}.gz`, gz)
      ]);
    } catch (error) {
      if (error.name !== 'AbortError') {
        Logger.error(`Failed to compress file ${file}:`, error);
        throw error;
      }
    }
  }

  #startWatcher() {
    const watcher = chokidar.watch('src', {
      ignored: /(^|[/\\])\../,
      persistent: true,
      ignoreInitial: true
    });

    const rebuildDebounce = this.#debounce(async (path) => {
      Logger.info(`🔄 File changed: ${path}`);
      try {
        await this.build();
      } catch (error) {
        Logger.error('Rebuild failed:', error);
      }
    }, 200);

    watcher.on('change', rebuildDebounce);
    watcher.on('add', rebuildDebounce);
    watcher.on('unlink', rebuildDebounce);

    Logger.info(`${colors.green}👀 Watching for changes...${colors.reset}`);
  }

  #startServer() {
    liveServer.start({
      root: this.#config.outDir,
      open: true,
      port: 3000,
      logLevel: 0
    });
    Logger.success(`${colors.green}🌐 Server started at ${colors.underline}http://localhost:3000${colors.reset}`);
  }

  #debounce(func, wait) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }
}