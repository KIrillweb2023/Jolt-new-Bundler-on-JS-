export async function runPipeline(activeBuilds, pending, config, tasks) {
    if (config.parallel) {
        await Promise.all(tasks.map(task => queueTask(activeBuilds, pending, task)));
    } else {
        for (const task of tasks) {
            await queueTask(activeBuilds, pending, task);
        }
    }
}

export async function queueTask(activeBuilds, pending, task) {
    if (activeBuilds.has(task)) return;

    activeBuilds.add(task);
    try {
        await task();
    } finally {
        activeBuilds.delete(task);
        
        if (pending.size > 0) {
            const nextTask = pending.values().next().value;
            pending.delete(nextTask);
            await queueTask(nextTask);
        }
    }
}