// Singleton for shared server state.
// cachedHTML is the last-rendered dashboard HTML, updated by buildAndCache()
// and read by GET /. Both dashboard and project handlers write to it.

let _html = '';

module.exports = {
  get html() { return _html; },
  set html(v) { _html = v; },
};
