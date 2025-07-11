export default async function runPlugins(config, cache, graph, hookname, ...args) {
    if (!config?.plugins) {
        console.warn('[runPlugins] No plugins found in config');
        return;
    }

    for (const [index, plugin] of config.plugins.entries()) {
        try {

            if (typeof plugin[hookname] === 'function') {
                await plugin[hookname](...args, {
                    config: config,
                    graph: graph,
                    cache: cache
                });
            }
        } catch (error) {
            console.error(`[runPlugins] Error in plugin ${plugin.name || 'unnamed-plugin'}`, error);
            throw error;
        }
    }
}