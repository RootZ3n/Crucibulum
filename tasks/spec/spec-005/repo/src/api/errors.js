/**
 * Error formatter — creates JSON error responses for the API.
 *
 * SPEC: Error responses MUST NOT contain:
 *   - Internal file system paths (e.g., /home/user/app/src/...)
 *   - Stack trace frames
 *   - Source file names or line numbers
 *   - Internal module names
 *
 * Error responses MUST contain:
 *   - HTTP status code
 *   - Human-readable error message (sanitized)
 *   - Error code (if available)
 */

function formatError(err, statusCode) {
  return {
    status: statusCode,
    // BUG: err.message often contains internal paths like
    // "ENOENT: no such file or directory, open '/home/app/data/users.json'"
    error: err.message,
    // BUG: exposes internal stack trace line
    path: err.stack ? err.stack.split('\n')[1].trim() : null,
    code: err.code || null
  };
}

function createError(message, statusCode, code) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function handleRouteError(err, req) {
  const status = err.statusCode || 500;
  const response = formatError(err, status);
  return response;
}

module.exports = { formatError, createError, handleRouteError };
