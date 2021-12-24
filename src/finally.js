/**
 * 本质是是为Promise添加了一次then调用，定义了无论状态变为FullFilled/Rejected都会调用的函数
 * 没有任何入参
 * @test
 * Promise.resolve(1).then(res => console.error(1)).finally(() => console.error(2))
 * Promise.reject(1).then(res => console.error(1)).finally(() => console.error(2))
 */
function finallyConstructor(callback) {
  var constructor = this.constructor;
  return this.then(
    function(value) {
      // @ts-ignore
      return constructor.resolve(callback()).then(function() {
        return value;
      });
    },
    function(reason) {
      // @ts-ignore
      return constructor.resolve(callback()).then(function() {
        // @ts-ignore
        return constructor.reject(reason);
      });
    }
  );
}

module.exports = finallyConstructor;
