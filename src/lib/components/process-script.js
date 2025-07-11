/**
 * Обрабатывает файл: читает, трансформирует и извлекает зависимости
 * @param {string} filePath - Путь к файлу
 * @returns {Object} Объект с кодом, картой кода и зависимостями
 */

import { transform } from "@swc/core";
import parseImports from "./imports-script.js";
import resolvePath from "./module-script.js";
import needsRebuild from "./rebuild-script.js";
import isExternalDependency from "./utils-script.js";
import fs from "node:fs/promises";
import path from "node:path"

export default async function processFile(config, cache, graph, filePath) {
    if (isExternalDependency(config, filePath)) {
        return {
            path: filePath,
            code: `module.exports = require('${path.basename(filePath, path.extname(filePath))}');`,
            map: null,
            dependencies: []
        };
    }


    if (!await needsRebuild(config, cache, filePath) && graph.has(filePath)) {
        return graph.get(filePath);
    }

    const code = await fs.readFile(filePath, 'utf8');
    const result = await transform(code, {
        filename: filePath,
        sourceMaps: config.sourcemaps,
        jsc: {
            parser: {
                syntax: filePath.endsWith('.ts') ? 'typescript' : 'ecmascript',
                tsx: filePath.endsWith('.tsx'),
                jsx: filePath.endsWith('.jsx')
            },
            target: config.target,
            transform: {
                optimizer: {
                    simplify: true
                }
            }
        },
        module: {
            type: 'commonjs'
        },
        minify: config.minify
    });

    const dependencies = await parseImports(result.code);
    const resolvedDeps = [];

    for (const dep of dependencies) {
        try {
            const resolved = await resolvePath(path.dirname(filePath), dep);
            resolvedDeps.push(resolved);
        } catch (error) {
            console.error(`Failed to resolve ${dep} from ${filePath}:`, error.message);
            throw error;
        }
    }

    const node = {
        path: filePath,
        code: result.code,
        map: result.map,
        dependencies: resolvedDeps
    };

    graph.set(filePath, node);
    return node;
}