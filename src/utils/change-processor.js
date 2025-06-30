import { Logger, colors } from "../core/Logger.js";
/**
 * Обрабатывает изменения файлов
 * @param {Object} config - Конфигурация бандлера
 * @param {Object} dependencies - Зависимости для обработки изменений
 */


export async function processChanges(config, cache, dependencies) {
    if (config.activeRebuild || !config.pendingChanges.size) return;
        config.activeRebuild = true;
        const changedFiles = [...config.pendingChanges];
        config.pendingChanges.clear();
    
        if (changedFiles.some(f => f.endsWith('.js') || f.endsWith('.html'))) {
            cache.html.clear();
            await dependencies.processHtml();
        }
    
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
        
            const tasks = [];
            
            if (hasStatic) {
                tasks.push(dependencies.copyStaticFiles()); // тут импорт тоже 
            }
            
            if (hasCSS) {
                tasks.push(dependencies.processStyles());
            }
            
            if (hasJS) {
                tasks.push(dependencies.processScripts());
            }
            
            if (hasAssets) {
                tasks.push(dependencies.processAssets());
            }
        
            if (hasHTML || hasCSS || hasJS) {
                cache.html.clear();
                tasks.push(dependencies.processHtml());
            }
    
            await Promise.all(tasks);
            Logger.success('✅ Rebuild completed');
        } catch (error) {
            Logger.error('Rebuild failed:', error);
        } finally {
            config.activeRebuild = false;
          
        if (config.pendingChanges.size > 0) {
            await dependencies.processChanges();
        }
    }
}