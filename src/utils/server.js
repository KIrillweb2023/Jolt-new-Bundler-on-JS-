import liveServer from 'live-server';
import { Logger, colors } from '../core/Logger.js';

/**
 * Запускает dev-сервер для разработки
 * @param {Object} config - Конфигурация сервера из JoltBundler
 */
export function startServer(config) {  /// [*] ///
    try {
        liveServer.start({
            root: config.outDir,
            open: config.server.open,
            port: config.server.port,
            host: config.server.host,
            logLevel: 0,
            middleware: [
                (req, res, next) => {
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
                
                if (req.method === 'OPTIONS') {
                    return res.end();
                }
                    next();
                }
            ]
        }, (error) => {
            if (error) {
                Logger.error(`Server failed to start: ${error.message}`);
                return;
            }
            Logger.success(`${colors.green}🌐 Server started at ${colors.underscore}http://${config.server.host}:${config.server.port}${colors.reset}`);
        });
    } catch (error) {
        Logger.error(`Failed to start server: ${error.message}`);
    }
}