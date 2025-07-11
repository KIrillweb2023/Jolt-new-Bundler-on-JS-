import { htmlPlug } from "./src/plugins/htmlPlug.js";
import { cssPlug } from "./src/plugins/cssPlug.js";

export const JoltConfiguration = {
    // Основные обязательные настройки
    entry: './src/main.js',       // Абсолютный путь к точке входа
    outfile: './dist/bundle.js', // Выходной файл

    // Формат и целевая платформа
    format: 'iife',        // 'iife' (для браузера) | 'esm' (для современных браузеров)
    platform: 'browser',   // 'browser' | 'node'

    // Настройки трансформации кода
    swcOptions: {
        jsc: {
            parser: {
                syntax: 'ecmascript',     // 'ecmascript' | 'typescript'
                jsx: false,               // Включить, если используете React
                dynamicImport: true       // Поддержка динамических импортов
            },
            target: 'es2020',             // Целевая версия ES
            // minify: {
            //     compress: {
            //         unused: false,         // Удаление неиспользуемого кода
            //         drop_console: false   // Удаление console.log (true для прода)
            //     },
            //     mangle: false              // Упрощение имен переменных
            // }
        },
        module: {
            type: 'commonjs'              // Транспиляция в CommonJS
        },
        sourceMaps: true                  // Генерация sourcemaps
    },
    plugins: [
        cssPlug(),
        htmlPlug({ minify: false }),
    ],

    watchPatterns: [
        'src/main.js',    // Все JS-файлы
        'src/index.html',  // Все HTML-файлы
        'src/style.css'    // Все CSS-файлы
    ]

    // Опциональные настройки (раскомментируйте при необходимости)
    // cache: true,                      // Кеширование для ускорения сборки
    // sourcemaps: 'external',           // 'inline' | 'external'
    // watch: true,                     // Режим наблюдения за изменениями
    // external: ['react', 'lodash']     // Внешние зависимости
};

