/**
 * Promise.allSettled(对标Promise.all)
 * 创建一个新的Promise对象，在每个成员确定状态后设置为FullFilled(始终为FullFilled)
 * 每个数组成员resolve的值为 {status: 'fullfilled'|'rejected', value: resolvedValue|rejectedValue}
 * 
 * 如果一个成员状态一直不确定，会导致then回调无法调用
 * 
 * @test
 * Promise.allSettled([1, Promise.resolve(2), Promise.reject(3)]).then(([res1, res2, res3]) => console.error(res1, res2, res3));
 * 
 * @test
 * Promise.allSettled([1, Promise.resolve(2), Promise.reject(3), new Promise(() => {})]).then(([res1, res2, res3]) => console.error(res1, res2, res3));
 */
function allSettled(arr) {
  var P = this;
  return new P(function(resolve, reject) {
    if (!(arr && typeof arr.length !== 'undefined')) {
      return reject(
        new TypeError(
          typeof arr +
            ' ' +
            arr +
            ' is not iterable(cannot read property Symbol(Symbol.iterator))'
        )
      );
    }
    var args = Array.prototype.slice.call(arr);
    if (args.length === 0) return resolve([]);
    var remaining = args.length;

    function res(i, val) {
      if (val && (typeof val === 'object' || typeof val === 'function')) {
        var then = val.then;
        if (typeof then === 'function') {
          then.call(
            val,
            function(val) {
              res(i, val);
            },
            function(e) {
              args[i] = { status: 'rejected', reason: e };
              if (--remaining === 0) {
                resolve(args);
              }
            }
          );
          return;
        }
      }
      args[i] = { status: 'fulfilled', value: val };
      if (--remaining === 0) {
        resolve(args);
      }
    }

    for (var i = 0; i < args.length; i++) {
      res(i, args[i]);
    }
  });
}

module.exports = allSettled;
