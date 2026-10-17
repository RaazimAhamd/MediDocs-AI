/** One line per request: method, path (no query string, no body), status, duration. */
export function requestLogger(logger = console) {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      logger.log(`[http] ${req.method} ${req.baseUrl}${req.path} ${res.statusCode} ${ms.toFixed(0)}ms`);
    });
    next();
  };
}
