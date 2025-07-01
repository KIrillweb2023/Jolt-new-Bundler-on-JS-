import { Logger } from "../core/Logger.js";
import { analyzeBundle } from "../utils/bandle-analyzer.js";


export function handleBuildEndScript(cache, isProduction, result) {
    if (result?.errors?.length) {
        Logger.error(`Build failed with ${result.errors.length} errors`);
        result.errors.forEach(err => Logger.error(err.text));
        return;
    }

    cache.html?.clear();

    if (!result?.metafile?.outputs) {
        Logger.debug("No bundle metadata available");
        return;
    }

    const analysis = analyzeBundle(result.metafile);
    const outputCount = Object.keys(result.metafile.outputs).length;

    if (isProduction) {
        const sizeKB = analysis.totalOutputSize 
            ? (analysis.totalOutputSize / 1024).toFixed(2) 
            : 'unknown';
        
        Logger.success(`Generated ${outputCount} JS file(s) | Size: ${sizeKB} KB`);
        
        if (analysis.ratio) {
            Logger.debug(`Compression ratio: ${analysis.ratio}x`);
        }
    } else {
        Logger.debug(`Updated ${outputCount} JS file(s)`);
    }
}