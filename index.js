import { JoltBundler } from "./src/core/Bundler.js";

// Пример использования
const bundler = new JoltBundler({
    entry: './src/main.js',
    outDir: './dist',
    tailwind: false,
    compress: false,
    watch: process.argv.includes('--watch'),
    serve: process.argv.includes('--serve'),
    css: {
        include: ['src/style.{css,scss,sass,less}'],
        exclude: [],
        sourceMap: true,
    },
    minify: {
        js: true,
        css: true,
        html: true
    }
});

bundler.build();