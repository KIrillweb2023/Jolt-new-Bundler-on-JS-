import { Logger } from "../core/Logger.js";
import { analyzeBundle } from "../utils/bandle-analyzer.js";


export function handleBuildEndScript(cache, isProduction, result) {
    if (result.errors?.length) {
        Logger.error(`JavaScript processing failed with ${result.errors.length} errors`);
        return;
    }

    cache.html.clear();

    if (!result.metafile) {
        Logger.warn("JS processing completed, but no metafile was generated");
        Logger.success("Processed JS files (no bundle info available)");
        return;
    }

    const outputs = result.metafile.outputs || {};
    const count = Object.keys(outputs).length;
    Logger.success(`Processed ${count} JS file${count !== 1 ? 's' : ''}`);

    if (isProduction && count > 0) {
        analyzeBundle(result.metafile);
    }
}