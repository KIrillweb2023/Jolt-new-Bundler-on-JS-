import { Logger } from "../core/Logger.js";
import path from "node:path"

export async function processChanges(config, cache, dependencies) { /// [*] ///
    if (config.activeRebuild || config.pendingChanges.size === 0) return;
    config.activeRebuild = true;

    const changedFiles = [...config.pendingChanges];
    config.pendingChanges.clear();

    try {
        Logger.info(`🔄 Detected changes in: ${changedFiles.map(f => path.relative(process.cwd(), f)).join(', ')}`);

        const hasHTML = changedFiles.some(f => f.endsWith('.html'));
        const hasCSS = changedFiles.some(f => /\.(css|scss|sass|less)$/i.test(f));
        const hasJS = changedFiles.some(f => /\.(js|jsx|ts|tsx)$/i.test(f));
        const hasAssets = changedFiles.some(f => /\.(png|jpe?g|gif|svg|webp|avif|woff2?|ttf|eot)$/i.test(f));
        const hasStatic = changedFiles.some(f => 
            f.startsWith(config.staticDir) || 
            f.startsWith('src/public')
        );

        if (hasJS || hasHTML) {
            cache.html.clear();
        }

        const tasks = [];
        
        if (hasStatic) {
            tasks.push(dependencies.copyStaticFiles());
        }
        
        if (hasCSS) {
            // Передаем только измененные CSS файлы
            tasks.push(dependencies.processStyles(changedFiles));
        }
        
        if (hasJS) {
            tasks.push(dependencies.processScripts());
        }
        
        if (hasAssets) {
            tasks.push(dependencies.processAssets());
        }
        
        if (hasHTML || hasCSS || hasJS) {
            tasks.push(dependencies.processHtml());
        }

        await Promise.all(tasks);
        Logger.success('✅ Rebuild completed');
    } catch (error) {
        Logger.error('Rebuild failed:', error);
    } finally {
        config.activeRebuild = false;
        
        if (config.pendingChanges.size > 0) {
            await processChanges(config, cache, dependencies);
        }
    }
}