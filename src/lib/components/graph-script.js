/**
 * Строит граф зависимостей для entry-точки
 * @param {string} entryPath - Путь к entry-файлу
 * @returns {Object[]} Массив всех модулей в графе
 */

import processFile from "./process-script.js";
import path from "node:path";

export default async function buildDependencyGraph(config, cache, graph, entryPath) {
    const queue = [path.resolve(entryPath)];
    const visited = new Set();

    while (queue.length > 0) {
        const current = queue.pop();
        if (visited.has(current)) continue;
        visited.add(current);
        try {
            const node = await processFile(config, cache, graph, current);
            queue.push(...node.dependencies);
        } catch (error) {
            console.error(`Error processing ${current}:`, error);
            throw error;
        }
    }

    return [...visited].map(f => graph.get(f));
}