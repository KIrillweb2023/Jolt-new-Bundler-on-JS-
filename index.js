import { JoltBundler } from "./src/core/Bundler.js";

// Определяем режим разработки
const isDev = process.env.NODE_ENV !== 'production';
const isWatch = process.argv.includes('--watch');
const isServe = process.argv.includes('--serve');

// Конфигурация сборщика
const bundler = new JoltBundler({
  // Основные настройки
  entry: './src/main.js',
  outDir: './dist',
  publicDir: './public',  // Директория с публичными файлами
  staticDir: './static',  // Директория со статическими файлами
  
  // Режимы работы
  watch: isWatch,
  serve: isServe,
  cache: isDev,  // Кеширование только в разработке
  parallel: true,  // Параллельная обработка
  
  // Настройки сборки
  sourcemap: isDev,  // Карты кода только в разработке
  tailwind: false,   // Можно передать конфиг Tailwind при необходимости
  compress: false,  // Сжатие только в production // !isDev
  
  // Обработка CSS
  css: {
    include: [
      'src/sass/style.scss',
    //   'src/**/*.scss',
    //   'src/**/*.sass',
    //   'src/**/*.less'
    ],
    exclude: [],
    modules: false,  // Включить CSS Modules при необходимости
    inlineCritical: true,  // Инлайнинг критического CSS
    sourceMap: isDev
  },
  
  // Минификация
  minify: {
    js: !isDev,
    css: !isDev,
    html: !isDev
  },
  
  // Оптимизация изображений
  image: {
    formats: ['webp', 'original'],  // Генерация webp + оригинальный формат
    quality: 85,  // Качество изображений
    resize: {
      width: 1920,  // Максимальная ширина
      height: 1080, // Максимальная высота
      withoutEnlargement: true  // Не увеличивать маленькие изображения
    }
  },
  
  // Оптимизация SVG
  svgo: {
    plugins: [
      'preset-default',
      'removeDimensions',
      {
        name: 'addAttributesToSVGElement',
        params: {
          attributes: [
            { 'aria-hidden': 'true' },
            { focusable: 'false' }
          ]
        }
      },
      {
        name: 'removeAttrs',
        params: {
          attrs: ['fill', 'stroke']  // Удаляем fill/stroke для возможности стилизации через CSS
        }
      }
    ]
  },
  
  // Настройки шрифтов
  fonts: {
    formats: ['woff2', 'woff'],  // Современные форматы
    preload: true,  // Предзагрузка шрифтов
    subset: !isDev  // Подмножество символов только в production
  },
  
  // Расширенные настройки esbuild
  esbuild: {
    target: 'es2022',
    format: 'esm',  
    treeShaking: true,
    splitting: true,
    metafile: true,
    define: {
      'APP_VERSION': JSON.stringify(process.env.npm_package_version)
    },
    loader: {
      '.svg': 'file'  // Обработка SVG как файлов
    }
  },
  
  // Настройки сервера разработки
  server: {
    port: 3000,
    open: true,
    host: 'localhost',
    cors: true  // Включить CORS для разработки
  }
});

// Запуск сборки
bundler.build();

// Обработка сигналов для корректного завершения
process.on('SIGINT', async () => {
  await bundler.stop();
  process.exit(0);
});