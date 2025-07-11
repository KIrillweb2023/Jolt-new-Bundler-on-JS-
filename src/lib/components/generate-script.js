/**
* Генерирует IIFE (Immediately Invoked Function Expression) бандл
* @param {Object[]} modules - Массив модулей
* @param {string} entryPath - Путь к entry-файлу
* @returns {Object} Собранный бандл с кодом и sourcemap
*/

import path from "node:path";
import { normalizeModuleId } from "./utils-script.js";


export function generateIIFEBundle(modules, entryPath) {
    const baseDir = path.dirname(entryPath);
    const moduleMap = new Map();

    for (const mod of modules) {
        const id = normalizeModuleId(mod.path, baseDir);
        moduleMap.set(id, mod);
    }

    let bundleCode = `(function() {\n  'use strict';\n\n`;
    bundleCode += `  const modules = new Map();\n\n`;

    bundleCode += `  function require(moduleId) {\n`;
    bundleCode += `    if (!modules.has(moduleId)) {\n`;
    bundleCode += `      throw new Error('Module not found: ' + moduleId);\n`;
    bundleCode += `    }\n`;
    bundleCode += `    const module = modules.get(moduleId);\n`;
    bundleCode += `    if (module.cache) return module.cache.exports;\n`;
    bundleCode += `    const exports = {};\n`;
    bundleCode += `    module.cache = { exports };\n`;
    bundleCode += `    module.factory(exports, require);\n`;
    bundleCode += `    return exports;\n`;
    bundleCode += `  }\n\n`;

    for (const [id, mod] of moduleMap.entries()) {
        bundleCode += `  // Module: ${id}\n`;
        bundleCode += `  modules.set('${id}', {\n`;
        bundleCode += `    factory: function(exports, require) {\n`;
        bundleCode += mod.code.replace(/\n/g, '\n      ') + '\n';
        bundleCode += `    }\n  });\n\n`;
    }

    const entryId = normalizeModuleId(entryPath, baseDir);
    bundleCode += `  // Entry point\n`;
    bundleCode += `  require('${entryId}');\n`;
    bundleCode += `})();`;

    return {
        code: bundleCode,
        map: modules.find(m => m.path === entryPath)?.map
    };
}

export function generateESBundle(modules, entryPath) {
    const baseDir = path.dirname(entryPath);
    const moduleMap = new Map();

    for (const mod of modules) {
        const id = normalizeModuleId(mod.path, baseDir);
        moduleMap.set(id, mod);
    }

    let bundleCode = '';
    const importMap = { imports: {} };

    for (const [id, mod] of moduleMap.entries()) {
        let moduleCode = mod.code;

        moduleCode = moduleCode.replace(
            /require\(['"]([^'"]+)['"]\)/g,
            (_, depPath) => {
                const depId = normalizeModuleId(
                    path.resolve(path.dirname(mod.path), depPath),
                    baseDir
                );
                return `import('${depId}')`;
            }
        );

        bundleCode += `// ${id}\n`;
        bundleCode += `const ${id.replace(/\//g, '$')} = (() => {\n`;
        bundleCode += moduleCode + '\n';
        bundleCode += `})();\n\n`;

        importMap.imports[id] = `./${path.basename(entryPath)}.js#${id.replace(/\//g, '$')}`;
    }

    const entryId = normalizeModuleId(entryPath, baseDir);
    bundleCode += `// Entry point\n`;
    bundleCode += `export default ${entryId.replace(/\//g, '$')};\n`;

    return {
        code: bundleCode,
        map: modules.find(m => m.path === entryPath)?.map,
        importMap
    };
}