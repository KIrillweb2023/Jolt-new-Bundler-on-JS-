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
import { minimatch } from 'minimatch';

const compressAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

const perf = {
  start: null,
  mark: (name) => {
    if (!perf.start) perf.start = performance.now();
    performance.mark(name);
  },
  measure: (name, startMark, endMark) => {
    performance.measure(name, startMark, endMark);
    const measure = performance.getEntriesByName(name).pop();
    Logger.debug(`⏱️ ${name}: ${measure.duration.toFixed(2)}ms`);
  }
};

export class JoltBundler {
  #config;
  #isProduction = process.env.NODE_ENV === 'production';
  #isCI = process.env.CI === 'true';
  #cache = {
    assets: new Map(),
    scripts: new Map(),
    styles: new Map(),
    html: new Map()
  };
  #abortController = new AbortController();
  #activeBuilds = new Set();
  #pendingQueue = new Set();
  #currentProcess = null;
  #esbuildContext = null;

  constructor(config = {}) {
    this.#config = {
      entry: './src/main.js',
      outDir: './dist',
      assetsDir: 'assets',
      staticDir: 'static',
      publicDir: 'public',
      sourcemap: !this.#isProduction,
      tailwind: false,
      compress: this.#isProduction,
      watch: !this.#isProduction && !this.#isCI,
      serve: !this.#isProduction && !this.#isCI,
      cache: !this.#isProduction,
      pendingChanges: new Set(),
      debounceTimer: null,
      activeRebuild: false,
      watcher: null,
      parallel: true,
      css: { 
        include: ['src/**/*.css'], 
        exclude: [],
        modules: false,
        inlineCritical: true
      },
      minify: { 
        js: this.#isProduction, 
        css: this.#isProduction, 
        html: this.#isProduction 
      },
      image: {
        formats: ['webp', 'avif'],
        quality: 80,
        resize: {
          width: 2000,
          height: 2000,
          withoutEnlargement: true
        },
        ...config.image
      },
      svgo: {
        plugins: [
          'preset-default',
          { name: 'removeViewBox', active: false },
          'removeDimensions',
          'sortAttrs'
        ],
        ...config.svgo
      },
      fonts: {
        formats: ['woff2', 'woff'],
        preload: true,
        subset: this.#isProduction,
        ...config.fonts
      },
      esbuild: {
        target: 'es2022',
        format: 'esm',
        treeShaking: true,
        splitting: true,
        metafile: true,
        ...config.esbuild
      },
      server: {
        port: 3000,
        open: true,
        host: '0.0.0.0',
        ...config.server
      },
      ...config
    };
  }

  async build() {
    Logger.divider();
    Logger.info(`${colors.bright}🚀 Starting ${this.#isProduction ? 'production' : 'development'} build...`);
    perf.start = performance.now();

    try {
      await this.#cleanOutput();
      
      await this.#runPipeline([
        this.#processScripts.bind(this),
        this.#processStyles.bind(this),
        this.#processAssets.bind(this),
        this.#copyStaticFiles.bind(this),
        this.#processHtml.bind(this)
      ]);

      if (this.#config.compress) {
        await this.#compressOutput();
      }

      const time = (performance.now() - perf.start).toFixed(2);
      Logger.success(`${colors.bright}✨ Build completed successfully in ${time}ms`);
      Logger.divider();

      if (this.#config.watch) this.#startWatcher();
      if (this.#config.serve) this.#startServer();

      return { success: true, time: `${time}ms` };
    } catch (error) {
      await this.stop();
      Logger.error(`${colors.bright}💥 Build failed!`);
      console.error(error);
      Logger.divider();
      process.exit(1);
    }
  }

  async #runPipeline(tasks) {
    if (this.#config.parallel) {
      await Promise.all(tasks.map(task => this.#queueTask(task)));
    } else {
      for (const task of tasks) {
        await this.#queueTask(task);
      }
    }
  }

  async #queueTask(task) {
    if (this.#activeBuilds.has(task)) return;
    
    this.#activeBuilds.add(task);
    try {
      await task();
    } finally {
      this.#activeBuilds.delete(task);
      
      if (this.#pendingQueue.size > 0) {
        const nextTask = this.#pendingQueue.values().next().value;
        this.#pendingQueue.delete(nextTask);
        await this.#queueTask(nextTask);
      }
    }
  }

  async #processHtml() {
    perf.mark('html-start');
    const htmlFiles = await globby('src/**/*.html');
    if (!htmlFiles.length) return;

    const [jsResult, cssResult] = await Promise.allSettled([
      this.#findFilesWithRetry(`${this.#config.outDir}/**/*.js`),
      this.#findFilesWithRetry(`${this.#config.outDir}/**/*.css`)
    ]);

    const jsFiles = jsResult.status === 'fulfilled' ? 
      jsResult.value.filter(f => !f.includes(this.#config.staticDir)) : [];
    const cssFiles = cssResult.status === 'fulfilled' ? 
      cssResult.value.filter(f => !f.includes(this.#config.staticDir)) : [];

    await Promise.all(htmlFiles.map(file => this.#processSingleHtml(file, jsFiles, cssFiles)));

    perf.measure('HTML Processing', 'html-start');
    Logger.success(`Processed ${htmlFiles.length} HTML files`);
  }

  async #processSingleHtml(file, jsFiles, cssFiles) {
    const cacheKey = path.basename(file);
    const stat = await fs.stat(file);
    const currentMtime = stat.mtimeMs.toString();

    if (this.#config.cache && this.#cache.html.has(cacheKey)) {
      const cached = this.#cache.html.get(cacheKey);
      if (cached.mtime === currentMtime) {
        await fs.writeFile(path.join(this.#config.outDir, cacheKey), cached.html);
        Logger.debug(`Used cached HTML: ${cacheKey}`);
        return;
      }
    }

    try {
      let html = await fs.readFile(file, 'utf8');
      const staticPath = `${this.#config.staticDir}/`;
      const staticPathRegex = new RegExp(staticPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      
      html = html
        .replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi, match => 
          staticPathRegex.test(match) ? match : '')
        .replace(/<script[^>]*type=["']module["'][^>]*>.*?<\/script>/gi, match => 
          staticPathRegex.test(match) ? match : '');

      const jsTags = jsFiles.map(js =>
        `\t<script type="module" src="/${path.relative(this.#config.outDir, js).replace(/\\/g, '/')}"></script>`
      ).join('\n') || '';

      const cssTags = cssFiles.map(css =>
        `\t<link rel="stylesheet" href="/${path.relative(this.#config.outDir, css).replace(/\\/g, '/')}">`
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

      if (this.#isProduction && this.#config.minify.html) {
        html = await htmlMinifier(html, {
          collapseWhitespace: true,
          removeComments: true,
          minifyJS: false,
          minifyCSS: true,
          processConditionalComments: true,
          minifyURLs: true
        });
      }

      await fs.writeFile(path.join(this.#config.outDir, path.basename(file)), html);
      
      this.#cache.html.set(cacheKey, {
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
    perf.mark('clean-start');
    try {
      await fs.rm(this.#config.outDir, { recursive: true, force: true });
      await fs.mkdir(path.join(this.#config.outDir, this.#config.assetsDir), { recursive: true });
      
      if (this.#config.cache) {
        this.#cache.assets.clear();
        this.#cache.scripts.clear();
        this.#cache.styles.clear();
        this.#cache.html.clear();
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    perf.measure('Output Clean', 'clean-start');
  }

  async #processScripts() {
    perf.mark('scripts-start');
    const cacheKey = this.#config.entry;
    
    try {
      const stat = await fs.stat(this.#config.entry);
      const currentMtime = stat.mtimeMs.toString();

      if (this.#config.cache && this.#cache.scripts.has(cacheKey)) {
        const cached = this.#cache.scripts.get(cacheKey);
        if (cached.mtime === currentMtime && !this.#config.watch) {
          Logger.debug('Using cached JS build');
          return;
        }
      }

      if (this.#esbuildContext) {
        await this.#esbuildContext.dispose();
      }

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
      plugins: [{
        name: 'on-end',
        setup: (build) => build.onEnd(this.#handleScriptsBuildEnd.bind(this))
      }, ...(this.#config.esbuild.plugins || [])]
    };
  }

  #handleScriptsBuildEnd(result) {
    if (result.errors?.length) {
      Logger.error(`JavaScript processing failed with ${result.errors.length} errors`);
      return;
    }

    this.#cache.html.clear();

    if (!result.metafile) {
      Logger.warn("JS processing completed, but no metafile was generated");
      Logger.success("Processed JS files (no bundle info available)");
      return;
    }

    const outputs = result.metafile.outputs || {};
    const count = Object.keys(outputs).length;
    Logger.success(`Processed ${count} JS file${count !== 1 ? 's' : ''}`);

    if (this.#isProduction && count > 0) {
      this.#analyzeBundleSizes(result.metafile);
    }
  }

  #analyzeBundleSizes(metafile) {
    const bundles = Object.entries(metafile.outputs)
      .map(([file, output]) => ({
        file: path.basename(file),
        size: (output.bytes / 1024).toFixed(2) + 'kb',
        imports: output.imports.length
      }))
      .sort((a, b) => parseFloat(b.size) - parseFloat(a.size));

    Logger.info('\n📦 Bundle Analysis:');
    console.table(bundles);
  }

  async #processStyles() {
    perf.mark('styles-start');
    const { include, exclude } = this.#config.css;
    const cssFiles = await globby(include, { ignore: exclude, signal: this.#abortController.signal });
    if (!cssFiles.length) return;

    const cacheKey = cssFiles.map(f => path.basename(f)).join('|');
    const latestMtime = Math.max(...await Promise.all(
      cssFiles.map(async f => (await fs.stat(f)).mtimeMs)
    )).toString();

    if (this.#config.cache && this.#cache.styles.has(cacheKey)) {
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

      await this.#clearOldCssBundles();
      await fs.writeFile(outputFile, processedCss);

      this.#cache.styles.set(cacheKey, {
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

  async #clearOldCssBundles() {
    const files = await globby(`${this.#config.outDir}/styles-*.css`);
    await Promise.all(files.map(file => fs.unlink(file)));
  }

  async #compileCssWithDependencies(files) {
    const results = await Promise.all(files.map(file => this.#processSingleCssFile(file)));
    return results.join('\n');
  }

  async #processSingleCssFile(file) {
    try {
      const fileContent = await fs.readFile(file, 'utf8');
      const ext = path.extname(file);
      const dir = path.dirname(file);
      let compiledCss = await this.#resolveImports(fileContent, dir);

      switch (ext) {
        case '.scss':
        case '.sass':
          const sass = await import('sass');
          compiledCss = sass.compileString(compiledCss, {
            loadPaths: [dir, 'node_modules'],
            style: this.#isProduction ? 'compressed' : 'expanded',
            sourceMap: this.#config.sourcemap
          }).css;
          break;
          
        case '.less':
          const less = await import('less');
          compiledCss = (await less.render(compiledCss, {
            filename: file,
            paths: [dir, 'node_modules'],
            sourceMap: this.#config.sourcemap
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
              .set('compress', this.#isProduction)
              .set('sourcemap', this.#config.sourcemap)
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

  async #resolveImports(cssContent, baseDir) {
    const importRegex = /@import\s+(?:url\()?["']([^"']+)["'](?:\))?[^;]*;/g;
    const imports = [...cssContent.matchAll(importRegex)].map(m => m[1]);

    const resolvedImports = await Promise.all(
      imports.map(async (importPath) => {
        if (/^https?:\/\//.test(importPath)) return '';

        if (importPath.startsWith('~')) {
          try {
            const modulePath = path.resolve('node_modules', importPath.slice(1));
            const importedContent = await fs.readFile(modulePath, 'utf8');
            return await this.#resolveImports(importedContent, path.dirname(modulePath));
          } catch {
            Logger.warn(`Could not resolve @import "${importPath}"`);
            return '';
          }
        }

        const fullPath = path.resolve(baseDir, importPath);
        try {
          const importedContent = await fs.readFile(fullPath, 'utf8');
          return await this.#resolveImports(importedContent, path.dirname(fullPath));
        } catch {
          Logger.warn(`Could not resolve @import "${importPath}" in ${baseDir}`);
          return '';
        }
      })
    );

    return cssContent.replace(importRegex, () => resolvedImports.shift() ?? '');
  }

  async #applyPostcssPlugins(css) {
    const plugins = [
      ...(this.#config.tailwind ? [tailwindcss(this.#config.tailwind === true ? {} : this.#config.tailwind)] : []),
      autoprefixer(),
      ...(this.#isProduction && this.#config.minify.css ? [cssnano({
        preset: ['default', {
          discardComments: { removeAll: true },
          reduceIdents: false
        }]
      })] : [])
    ];

    try {
      const result = await postcss(plugins).process(css, {
        from: undefined,
        map: this.#config.sourcemap
      });

      if (this.#isProduction) {
        const { code } = await lightningcss({
          code: Buffer.from(result.css),
          minify: true,
          sourceMap: this.#config.sourcemap
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
    perf.mark('assets-start');
    const assets = await globby([
      'src/assets/**/*',
      '!**/*.{js,jsx,ts,tsx,css,scss,sass,less,styl}'
    ], { signal: this.#abortController.signal });

    if (!assets.length) {
      perf.measure('Assets Processing', 'assets-start');
      return;
    }

    let processedCount = 0;
    const stats = { images: 0, svgs: 0, fonts: 0, others: 0 };

    const BATCH_SIZE = 10;
    for (let i = 0; i < assets.length; i += BATCH_SIZE) {
      const batch = assets.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (file) => {
        const ext = path.extname(file).toLowerCase();
        
        // Обрабатываем шрифты отдельно
        if (['.woff', '.woff2', '.ttf', '.eot', '.otf'].includes(ext)) {
          await this.#processFont(file);
          stats.fonts++;
        } else {
          await this.#processSingleAsset(file);
          if (['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif'].includes(ext)) {
            stats.images++;
          } else if (ext === '.svg') {
            stats.svgs++;
          } else {
            stats.others++;
          }
        }
        processedCount++;
      }));
    }

    perf.measure('Assets Processing', 'assets-start');
    
    if (stats.svgs > 0) Logger.success(`Optimized ${stats.svgs} SVG files`);
    if (stats.fonts > 0) Logger.success(`Processed ${stats.fonts} font files`);
    if (stats.images > 0) Logger.success(`Optimized ${stats.images} images`);
    Logger.success(`Processed ${processedCount} assets total`);
  }

  async #processFont(file) {
  const relativePath = path.relative('src/assets', file);
  const outputPath = path.join(
    this.#config.outDir, 
    this.#config.assetsDir, 
    relativePath
  );

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.copyFile(file, outputPath);

  if (this.#config.fonts.subset && ['.ttf', '.otf'].includes(path.extname(file))) {
    await this.#subsetFont(file, outputPath);
  }
}

async #subsetFont(srcPath, destPath) {
  try {
    const { subset } = await import('@peertube/subset-font');
    const font = await fs.readFile(srcPath);
    const subsetFont = await subset(font, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');
    
    await fs.writeFile(destPath, subsetFont);
    Logger.debug(`Subset font created: ${path.basename(destPath)}`);
  } catch (error) {
    Logger.warn(`Font subsetting failed for ${path.basename(srcPath)}:`, error.message);
    await fs.copyFile(srcPath, destPath);
  }
}

  async #processSingleAsset(file) {
    const relativePath = path.relative('src/assets', file);
    const cacheKey = relativePath.replace(/\\/g, '/');
    const ext = path.extname(file).toLowerCase();



    if (['.woff', '.woff2', '.ttf', '.eot', '.otf'].includes(ext)) return;
    
    try {
      const stat = await fs.stat(file);
      const currentMtime = stat.mtimeMs.toString();

      if (this.#config.cache && this.#cache.assets.has(cacheKey)) {
        const cached = this.#cache.assets.get(cacheKey);
        if (cached.mtime === currentMtime) return;
      }

      const content = await fs.readFile(file);
      const noHashExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.avif', '.svg', '.ico', 
                              '.woff', '.woff2', '.ttf', '.eot', '.otf'];
      const shouldHash = !noHashExtensions.includes(ext);
      
      const outputDir = path.join(
        this.#config.outDir, 
        this.#config.assetsDir, 
        path.dirname(relativePath)
      );
      
      const outputFile = shouldHash 
        ? `${path.basename(file, ext)}-${createHash('sha256').update(content).digest('hex').slice(0, 8)}${ext}`
        : path.basename(file);
        
      const outputPath = path.join(outputDir, outputFile);

      await fs.mkdir(outputDir, { recursive: true });

      if (['.png', '.jpg', '.jpeg', '.webp', '.avif'].includes(ext)) {
        await this.#optimizeImage(content, ext, outputPath);
      } else if (ext === '.svg') {
        await this.#optimizeSvg(content, outputPath);
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

  async #optimizeSvg(content, outputPath) {
    try {
      const { optimize } = await import('svgo');
      const result = optimize(content.toString(), {
        multipass: false,
        path: outputPath,
      });

      await fs.writeFile(outputPath, result.data);
      Logger.debug(`Optimized SVG: ${path.basename(outputPath)} (${(content.length / 1024).toFixed(2)}kb → ${(result.data.length / 1024).toFixed(2)}kb)`);
    } catch (error) {
      Logger.warn(`SVGO fallback for ${outputPath}:`, error.message);
      await fs.writeFile(outputPath, content);
    }
  }

  async #optimizeImage(content, ext, outputPath) {
    try {
      const sharpInstance = sharp(content)
        .resize(this.#config.image.resize)
        .withMetadata();

      const formatTasks = [];
      
      if (this.#config.image.formats.includes('avif')) {
        formatTasks.push(
          sharpInstance
            .clone()
            .toFormat('avif', {
              quality: this.#config.image.quality,
              effort: 6
            })
            .toFile(outputPath.replace(ext, '.avif'))
        );
      }

      if (this.#config.image.formats.includes('webp')) {
        formatTasks.push(
          sharpInstance
            .clone()
            .toFormat('webp', {
              quality: this.#config.image.quality,
              effort: 6
            })
            .toFile(outputPath.replace(ext, '.webp'))
        );
      }

      formatTasks.push(
        sharpInstance
          .toFormat(ext.slice(1), {
            quality: this.#config.image.quality,
            effort: 6
          })
          .toFile(outputPath)
      );

      await Promise.all(formatTasks);
    } catch (error) {
      if (error.name !== 'AbortError') {
        Logger.error(`Failed to optimize image ${outputPath}:`, error);
        throw error;
      }
    }
  }

  async #copyStaticFiles() {
    perf.mark('static-start');
    const tasks = [];
    
    if (await this.#dirExists(this.#config.publicDir)) {
      tasks.push(this.#copyDir(this.#config.publicDir, this.#config.outDir));
    }
    
    if (await this.#dirExists(this.#config.staticDir)) {
      tasks.push(this.#copyDir(this.#config.staticDir, path.join(this.#config.outDir, 'static')));
    }
    
    await Promise.all(tasks);
    perf.measure('Static Files', 'static-start');
  }

  async #dirExists(dirPath) {
    try {
      const stat = await fs.stat(dirPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  async #copyDir(srcDir, destDir) {
    try {
      const files = await globby(`${srcDir}/**/*`, { 
        dot: true,
        signal: this.#abortController.signal 
      });
      
      if (!files.length) return;
      
      await Promise.all(files.map(file => 
        this.#copySingleFile(file, path.join(destDir, path.relative(srcDir, file))))
      );
      
      Logger.success(`Copied ${files.length} static files from ${path.basename(srcDir)}`);
    } catch (error) {
      if (error.name !== 'AbortError') {
        Logger.error(`Failed to copy directory ${srcDir}:`, error);
        throw error;
      }
    }
  }

  async #copySingleFile(src, dest) {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    return new Promise((resolve, reject) => {
      const read = createReadStream(src);
      const write = createWriteStream(dest);
      read.pipe(write);
      write.on('finish', resolve);
      write.on('error', reject);
    });
  }

  async #compressOutput() { 
    perf.mark('compress-start');
    const files = await globby([`${this.#config.outDir}/**/*.{js,css,html}`], { 
      signal: this.#abortController.signal 
    });

    if (!files.length) {
      perf.measure('Compression', 'compress-start');
      return;
    }

    const BATCH_SIZE = 5;
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(file => this.#compressSingleFile(file)));
    }

    perf.measure('Compression', 'compress-start');
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

  async #startWatcher() {
    if (this.#config.watcher) return;

    this.#config.pendingChanges = new Set();
    this.#config.debounceTimer = null;
    this.#config.activeRebuild = false;

    const watchPatterns = [
      'src/**/*.html',
      'src/**/*.js',
      ...this.#config.css.include,
      `${this.#config.staticDir}/**/*`,
      `${this.#config.publicDir}/**/*`
    ];

    this.#config.watcher = chokidar.watch(await globby(watchPatterns), {
      ignored: [
        /(^|[/\\])\../,
        /node_modules/,
        new RegExp(this.#config.outDir),
        /\.(git|DS_Store)/
      ],
      ignoreInitial: true,
      persistent: true,
      useFsEvents: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100
      },
      atomic: 300
    });

    const handleChange = (filePath) => {
      this.#config.pendingChanges.add(filePath);
      clearTimeout(this.#config.debounceTimer);
      this.#config.debounceTimer = setTimeout(() => this.#processChanges(), 100);
    };

    this.#config.watcher
      .on('add', handleChange)
      .on('change', handleChange)
      .on('unlink', handleChange)
      .on('error', error => Logger.error('Watcher error:', error));

    Logger.info(`${colors.green}👀 Watching for changes...${colors.reset}`);
  }

  async #processChanges() {
    if (this.#config.activeRebuild || !this.#config.pendingChanges.size) return;
    this.#config.activeRebuild = true;
    const changedFiles = [...this.#config.pendingChanges];
    this.#config.pendingChanges.clear();

    if (changedFiles.some(f => f.endsWith('.js') || f.endsWith('.html'))) {
      this.#cache.html.clear();
      await this.#processHtml();
    }

    try {
      Logger.info(`🔄 Detected changes in: ${changedFiles.map(f => path.relative(process.cwd(), f)).join(', ')}`);

      const hasHTML = changedFiles.some(f => f.endsWith('.html'));
      const hasCSS = changedFiles.some(f => /\.(css|scss|sass|less)$/i.test(f));
      const hasJS = changedFiles.some(f => /\.(js|jsx|ts|tsx)$/i.test(f));
      const hasAssets = changedFiles.some(f => /\.(png|jpe?g|gif|svg|webp|avif|woff2?|ttf|eot)$/i.test(f));
      const hasStatic = changedFiles.some(f => 
        f.startsWith(this.#config.staticDir) || 
        f.startsWith('src/public')
      );

      const tasks = [];
      
      if (hasStatic) {
        tasks.push(this.#copyStaticFiles());
      }
      
      if (hasCSS) {
        tasks.push(this.#processStyles());
      }
      
      if (hasJS) {
        tasks.push(this.#processScripts());
      }
      
      if (hasAssets) {
        tasks.push(this.#processAssets());
      }

      if (hasHTML || hasCSS || hasJS) {
        this.#cache.html.clear();
        tasks.push(this.#processHtml());
      }

      await Promise.all(tasks);
      Logger.success('✅ Rebuild completed');
    } catch (error) {
      Logger.error('Rebuild failed:', error);
    } finally {
      this.#config.activeRebuild = false;
      
      if (this.#config.pendingChanges.size > 0) {
        await this.#processChanges();
      }
    }
  }

  async stop() {
    if (this.#config.watcher) {
      await this.#config.watcher.close();
      this.#config.watcher = null;
    }
    
    if (this.#esbuildContext) {
      await this.#esbuildContext.dispose();
      this.#esbuildContext = null;
    }
    
    this.#abortController.abort();
    this.#abortController = new AbortController();
    
    this.#cache.assets.clear();
    this.#cache.scripts.clear();
    this.#cache.styles.clear();
    this.#cache.html.clear();
    
    Logger.info('Build process stopped and resources cleaned up');
  }

  #startServer() {
    liveServer.start({
      root: this.#config.outDir,
      open: this.#config.server.open,
      port: this.#config.server.port,
      host: this.#config.server.host,
      logLevel: 0,
      middleware: [
        (req, res, next) => {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          next();
        }
      ]
    });
    Logger.success(`${colors.green}🌐 Server started at ${colors.underscore}http://${this.#config.server.host}:${this.#config.server.port}${colors.reset}`);
  }
}