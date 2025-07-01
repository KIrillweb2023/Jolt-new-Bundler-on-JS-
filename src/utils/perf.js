import { Logger } from "../core/Logger.js";

export const perf = { /// [*] ///
    start: null,
    mark: (name) => {
        if (!perf.start) perf.start = performance.now();
        performance.mark(name);
    },
    measure: (name, startMark, endMark) => {
        performance.measure(name, startMark, endMark);
        const measure = performance.getEntriesByName(name).pop();
        Logger.debug(`⏱️ ${name}: ${measure.duration.toFixed(2)}ms`);
    }
};