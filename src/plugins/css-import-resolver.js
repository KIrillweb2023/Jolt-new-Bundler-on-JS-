import path from 'node:path';
import fs from 'node:fs/promises';
import { Logger } from '../core/Logger.js';



export async function resolveImports(cssContent, baseDir) {
    const importRegex = /@import\s+(?:url\()?["']([^"']+)["'](?:\))?[^;]*;/g;
    const imports = [...cssContent.matchAll(importRegex)].map(m => m[1]);

    const resolvedImports = await Promise.all(
        imports.map(async (importPath) => {
            if (/^https?:\/\//.test(importPath)) return '';

            if (importPath.startsWith('~')) {
                try {
                    const modulePath = path.resolve('node_modules', importPath.slice(1));
                    const importedContent = await fs.readFile(modulePath, 'utf8');
                    return await resolveImports(importedContent, path.dirname(modulePath));
                } catch {
                    Logger.warn(`Could not resolve @import "${importPath}"`);
                    return '';
                }
            }

        const fullPath = path.resolve(baseDir, importPath);
            try {
                const importedContent = await fs.readFile(fullPath, 'utf8');
                return await resolveImports(importedContent, path.dirname(fullPath));
            } catch {
                Logger.warn(`Could not resolve @import "${importPath}" in ${baseDir}`);
                return '';
            }
        })
    );

    return cssContent.replace(importRegex, () => resolvedImports.shift() ?? '');
}