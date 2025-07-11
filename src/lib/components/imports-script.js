/**
 * Парсит код и извлекает все импорты/зависимости
 * @param {string} code - Исходный код
 * @returns {string[]} Массив путей зависимостей
 */

export default async function parseImports(code) {
    const imports = new Set();

    // Все возможные варианты импортов
    const importPatterns = [
        // Стандартные импорты
        /(?:import|export)\s*(?:(?:\{[^}]+\}|\* as \w+)\s*from\s*)?['"]([^'"]+)['"]/g,
        // Динамические импорты
        /import\s*\(['"]([^'"]+)['"]\)/g,
        // CommonJS require
        /require\(['"]([^'"]+)['"]\)/g
    ];

    for (const pattern of importPatterns) {
        let match;
        // Сбрасываем lastIndex перед каждым использованием
        pattern.lastIndex = 0;
        while ((match = pattern.exec(code)) !== null) {
            if (match[1]) {
                imports.add(match[1]);
            }
        }
    }

    return [...imports].filter(dep => dep.startsWith('.'));
}