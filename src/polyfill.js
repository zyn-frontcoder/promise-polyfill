const Promise = require('./index');
const promiseFinally = require('./finally');
const allSettled = require('./allSettled');

/** @suppress {undefinedVars} */
var globalNS = (function() {
  // the only reliable means to get the global object is
  // `Function('return this')()`
  // However, this causes CSP violations in Chrome apps.
  // TODO: 这是什么环境
  if (typeof self !== 'undefined') {
    return self;
  }
  // 浏览器环境全局变量返回
  if (typeof window !== 'undefined') {
    return window;
  }
  // Node环境全局变量返回
  if (typeof global !== 'undefined') {
    return global;
  }
  throw new Error('unable to locate global object');
})();

// Expose the polyfill if Promise is undefined or set to a
// non-function value. The latter can be due to a named HTMLElement
// being exposed by browsers for legacy reasons.
// https://github.com/taylorhakes/promise-polyfill/issues/114
// if (typeof globalNS['Promise'] !== 'function') {
//   // 兼容全局不存在Promise
//   globalNS['Promise'] = Promise;
// } else if(){
//   // 兼容Promise.prototype.finally&Promise.prototype.allSettled
//   if (!globalNS.Promise.prototype['finally']) {
//     globalNS.Promise.prototype['finally'] = promiseFinally;
//   } 
//   if (!globalNS.Promise.allSettled) {
//     globalNS.Promise.allSettled = allSettled;
//   }
// }


// 强制使用promise-polyfill
globalNS['Promise'] = Promise;
