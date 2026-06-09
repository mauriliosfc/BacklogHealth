// Shared HTTP utilities for handler functions.
// Handlers are pure async functions that throw HttpError for HTTP-level errors.
// server.js (or future Electron IPC) catches these and maps to the transport layer.

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function httpError(status, message) {
  throw new HttpError(status, message);
}

function readBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
  });
}

module.exports = { HttpError, httpError, readBody };
