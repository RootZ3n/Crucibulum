/**
 * Middleware — request logging and error catching.
 * This file is NOT the source of the path leak.
 */

function requestLogger(req) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url}`);
}

function errorCatcher(handler) {
  return function (req, res) {
    try {
      return handler(req, res);
    } catch (err) {
      // Delegates to error formatter — the leak comes from there
      const { handleRouteError } = require('./errors');
      return handleRouteError(err, req);
    }
  };
}

module.exports = { requestLogger, errorCatcher };
