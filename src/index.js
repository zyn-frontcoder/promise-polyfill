const promiseFinally = require('./finally');
const allSettled = require('./allSettled');

var setTimeoutFunc = setTimeout;
var setImmediateFunc = typeof setImmediate !== 'undefined' ? setImmediate : null;

function isArray(x) {
  return Boolean(x && typeof x.length !== 'undefined');
}

function noop() { }

function bind(fn, thisArg) {
  return function () {
    fn.apply(thisArg, arguments);
  };
}

/**
 * Promise对象的核心三要素
 * status: Pending->FullFilled->Rejected->Override
 * value: resolveValue/rejectValue
 * handled: handleBy then/catch
 * 
 * Promise处理流程分为两类
 * 1. 对于Promise对象自身的处理
 * 根据resolve/reject的调用，调通用的handleResolve和handleReject处理，得到{value: resolvedValue，status: handleResolve(resolvedValue)/handleRejected(rejetedValue) }
 * 2. 调用then时，直接创建一个空promise对象，作为返回值
 * 调用then的promise对象为pending，将then注册到该promise上 => 返回的新promise {value: returnValueOfThen, status: handleResolve(returnValueOfThen)}
 * 调用then的promise对象为确定状态 => 返回的新promise {value: returnValueOfThen, status: handleResolve(returnValueOfThen)}
 */

function Promise(fn) {
  if (!(this instanceof Promise))
    throw new TypeError('Promises must be constructed via new');
  if (typeof fn !== 'function') throw new TypeError('not a function');
  /**
   * 当前promise状态 
   * 0 => Pending<待定>
   * 1 => Fullfilled<满足>
   * 2 => Rejected<拒绝>
   * 3 => Override<被重写>
   */
  this._state = 0;
  /**
   * 当前对象是否被自己的then/catch处理过
   */
  this._handled = false;
  /**
   * resolve/reject的值，会作为调用对应回调时的入参
   */
  this._value = undefined;
  /**
   * 在当前promise上注册的cbs
   */
  this._deferreds = [];

  doResolve(fn, this);
}

/**
 * 1. 执行函数 
 * 2. 为resolve和reject定义实参 => 定义状态改变后的处理逻辑
 * 
 * 直接执行fn说明Promise不在意，传入的fn是否是异步，因为回调是在调用resolve/reject才真正触发的
 * 
  new Promise(async (resolve) => {
    await new Promise(resolve => setTimeout(() => resolve(1), 1000));
    await new Promise(resolve => setTimeout(() => resolve(2), 1000));
    resolve(2000);
  }).then(res => console.error('res->', res));
 */
 function doResolve(fn, self) {
  var done = false; // 标记只允许改变一次状态
  try {
    fn(
      function (value) {
        if (done) return;
        done = true;
        resolve(self, value);
      },
      function (reason) {
        if (done) return;
        done = true;
        reject(self, reason);
      }
    );
  } catch (ex) {
    // 执行错误，也会被分发给onRejectedCb
    if (done) return;
    done = true;
    reject(self, ex);
  }
}

/**
 * 将一个promise状态 Pending => FullFilled & 执行回调
 */
function resolve(self, newValue) {
  try {
    // 这里主要为了防止返回当前promise给不法者改变promise状态的机会
    if (newValue === self){
      throw new TypeError('A promise cannot be resolved with itself.');
    }
    // resolve的值是promiseObj或者具有then属性的对象时，需要改变指针
    if (
      newValue &&
      (typeof newValue === 'object' || typeof newValue === 'function')
    ) {
      var then = newValue.then;
      if (newValue instanceof Promise) {
        self._state = 3;
        self._value = newValue;
        finale(self);
        return;
      } else if (typeof then === 'function') {
        doResolve(bind(then, newValue), self);
        return;
      }
    }

    // 正常resolve的流程
    self._state = 1;
    self._value = newValue;
    finale(self);
  } catch (e) {
    /**
     * onRejected进入的条件：运行错误/状态变为Rejected
     * @test
     * new Promise(resolve => a.toString()).then(null, err => console.error('err=>', err))
     */
    reject(self, e);
  }
}

/**
 * 将Promise: pending => rejected & 执行回调
 * 这里没有类似resolve对值的区分,因此一个reject状态的promise对象状态是无法再次改变的
 * @test
 * new Promise((resolve, reject) => reject(Promise.resolve(1))).then(res => console.error('res->', res)).catch(reason => console.error('reason->', reason))
 */
function reject(self, newValue) {
  self._state = 2;
  self._value = newValue;
  finale(self);
}

/**
 * 处理promise的单次回调
 * 这说明同一Promise的回调，执行也是分批次的，不能保证连续执行
 * 在Promise状态确定前注册的then(一个or多个)，在promise对象的状态变化后在下一个微任务队列中批量执行
 * 在Promise状态确定后注册的then(一个or多个)，在在下一个微任务队列中批量执行
 */
function handle(self, deferred) {
  /**
   * 这段逻辑是为resolve(PromiseObj)的场景写的，这是唯一可以更改当前Promise状态的方法
   * Promise实例返回一个resolve一个新的Promise时，使用该Promise替代当前的Promise对象
   * 即resolve一个新的Promise时，回调是绑在返回的新Promise上的
   */
  while (self._state === 3) {
    self = self._value;
  }
  /**
   * For: 这段逻辑是为then方法写的
   * 如果then调用时，调用then的promise对象状态仍为pending，那么将cb注册到该对象上
   */
  if (self._state === 0) {
    self._deferreds.push(deferred);
    return; // 使用return防止cb立即执行了
  }
  /**
   * 进入后面说明Promise的状态已经确定了 FullFilled/Rejected
   * 此时可以将实例的状态标记为handled，因为后续其回调肯定会被调用
   */
  self._handled = true;

 
  /**
   * 这里是在执行promise对象的then方法，可能的触发常见有两种
   * 1. promise对象的状态从pending->FullFilled/Rejected
   * 2. 注册then时，Promise对象已确定，此时直接去除之前缓存的status和value，直接执行cb
   */
  Promise._immediateFn(function () {
    // deferred.onFulfilled || deferred.onRejected 指向了当前promise注册的cbs
    var cb = self._state === 1 ? deferred.onFulfilled : deferred.onRejected;

   /**
    * onFullFilled/onRejected为null时，将当前Promise的值赋值给返回的新Promise
    * 这段逻辑是为catch设计的，如果then中未注册onRejectedCb，那么最终会被下个注册onRejected的then处理，被catch处理
    * @test=>
    * new Promise(resolve => resolve(1)).then(null).then(null).then(res => console.error(res))
    * 
    * @test
    * Promise.reject(1).then(null, reason => console.error('reason->', reason)).catch(err => console.error('err->', err));
    * 
    * @test
    * Promise.reject(1).then(null, reason => console.error('reason->', reason)).then(null, reason => console.error('reason->', reason));
    */
    if (cb === null) {
      (self._state === 1 ? resolve : reject)(deferred.promise, self._value);
      return;
    }

    // 执行cb
    var ret;
    try {
      ret = cb(self._value);
    } catch (e) {
      reject(deferred.promise, e);
      return; // 说明then能执行
    }

    /**
     * then特点总结
     * 1. 入参是之前promise的resolve/reject的值 ｜ resolve/reject的新Promise的reject值
     * @test1 =>
     * new Promise(resolve => resolve()).then(res => console.error(res))
     * @test2 =>
     * new Promise(resolve => {new Promise(innerResolve => innerResolve(1)); resolve(100)}).then(res => console.error(res));
     * @test3 =>
     * new Promise(resolve => {resolve(new Promise(innerResolve => innerResolve(1)))}).then(res => console.error(res));
     * 
     * 2. then总是返回一个新的Promise，value为then函数的返回值
     * 将then创建的新promise状态置为FullFilled，值设置为thencb的返回值
     * 常说的Promise.prototype.then会默认包装返回值,其实不是默认包装，而是每次新建了一个空Promise，最后将promise的value设置为其返回值
     * @test1 =>
     * new Promise(resolve => resolve(1)).then(() => 10).then(res => console.error(res));
     * @test2 =>
     * new Promise(resolve => resolve(1)).then(() => Promise.reject(2)).then(null, reason => console.error(reason));
     * @test3 =>
     * new Promise(resolve => resolve(1)).then(() => new Promise(resolve => setTimeout(() => resolve(2), 3000))).then(res => console.error(res));
     * 
     */
    resolve(deferred.promise, ret);
  });
}

/**
 * 执行绑在promise实例上的回调
 */
function finale(self) {
  if (self._state === 2 && self._deferreds.length === 0) {
    Promise._immediateFn(function () {
      if (!self._handled) {
        Promise._unhandledRejectionFn(self._value);
      }
    });
  }

  /**
   * 这里是将指针传递了，往异步队列里添加了一个待执行的cb；
   * 这意味着then回调肯定是按顺序异步执行的，但是是否在同一微任务队列得看注册的时间节点
   * @test
   ```
    const p = new Promise(resolve => resolve(1));
      p.then(res1 => console.error('res1->', res1));
      requestAnimationFrame(() => {
        console.error('requestAnimationFrame called');
      })
      p.then(res2 => console.error('res2->', res2));
      setTimeout(() => {
        console.error('timeout01 called');
      }, 10)
      setTimeout(() => {
        console.error('timeout02 called');
      }, 10)
      setTimeout(() => {
        console.error('timeout03 called');
      }, 100)
      p.then(res3 => console.error('res3->', res3));
      setTimeout(() => {
        p.then(res4 => console.error('res4->', res4));
      }, 50)
    ```
    *
   */
  for (var i = 0, len = self._deferreds.length; i < len; i++) {
    handle(self, self._deferreds[i]); // 
  }

  // 清空待执行的回调，防止内存泄漏
  self._deferreds = null;
}

// 处理回调区分onFulfilled|onRejected和promise实例指向
function Handler(onFulfilled, onRejected, promise) {
  this.onFulfilled = typeof onFulfilled === 'function' ? onFulfilled : null;
  this.onRejected = typeof onRejected === 'function' ? onRejected : null;
  this.promise = promise; // 链表设计，指向下一个要处理的promise
}

/**
 * 参考handle中对catch的特殊设计
 * 这里默认调用一次then，只处理onRejected，这样就保证了@运行错误/@rejected未处理，会被捕获
 * 也意味着，如果在then中处理了无法被catch处理
 * @test
 new Promise(resolve => a.toString()).then(null, err => console.error('err=>', err)).catch(err => console.error('catch->', err));

 * @test
 new Promise(resolve => a.toString()).then(null, err => Promise.reject(1)).catch(err => console.error('catch->', err));
 */
Promise.prototype['catch'] = function (onRejected) {
  return this.then(null, onRejected);
};

/**
 * @Promise.prototype.then 
 * 每次调用立即创建一个Pending状态的空Promise
 */
Promise.prototype.then = function (onFulfilled, onRejected) {
  var prom = new this.constructor(noop); // 每次返回一个空的promise

  handle(this, new Handler(onFulfilled, onRejected, prom));

  return prom; // 【链式调用核心1】
};

Promise.prototype['finally'] = promiseFinally;

/**
 * Promise.all为每个成员注册then
 * 在所有成员变为FullFilled进入then，值为每一项resolve的值
 * 
 */
Promise.all = function (arr) {
  // 包装成一个大的promise
  return new Promise(function (resolve, reject) {
    if (!isArray(arr)) {
      return reject(new TypeError('Promise.all accepts an array'));
    }

    // resolve(args)
    var args = Array.prototype.slice.call(arr);

    /**
     * 部分成员不是Promise也是可以的
     * Promise.all([1, 2, 3, new Promise(resolve => setTimeout(() => resolve(1), 1000))]).then(result => console.error('result', result));
     */
    if (args.length === 0) return resolve([]);
    var remaining = args.length;

    function res(i, val) {
      try {
        // 成员是promise
        if (val && (typeof val === 'object' || typeof val === 'function')) {
          var then = val.then;
          if (typeof then === 'function') {
            // 成员为promise时，为每个Promise成员注册then,在每个成员状态改变后调用
            then.call(
              val,
              function (val) {
                res(i, val);
              },
              /**
               * 在最先出现的成员状态不是FullFilled后，totalPromise立即Rejected
               * @test
                const p1 = Promise.reject(1);
                const p2 = Promise.resolve(2);
                const p3 = Promise.resolve(3);
                Promise.all([p1, p2, p3]).then(res => console.error(res)).catch(err => console.error(err));
              */
              reject 
            );
            return;
          }
        }
        // 成员不是promise,就为当前值
        args[i] = val;
        /**
         * 在最后一项的状态改变后，totalPromise才能把状态确定为FullFilled，
         * 这意味着如果单个成员状态一直不确定，会导致Promoise.all创建的新Promise无法确定状态
         * 所以在API请求时，Promise.all时不合理，最终耗时取决于最慢的那个接口
         * @test
         *  const p1 = Promise.resolve(1);
            const p2 = new Promise(resolve => setTimeout(() => resolve(2), 5000));
            Promise.all([p1, p2]).then(res => console.error(res));
          *
          * @test
          * const p1 = Promise.resolve(1);
            const p2 = new Promise(() => {});
            const p3 = Promise.resolve(3);
            Promise.all([p1, p2, p3]).then(res => console.error(res)).catch(err => console.error(err));
         */
        if (--remaining === 0) {
          resolve(args);
        }
      } catch (ex) {
        reject(ex);
      }
    }

    /**
     * Promise.all中的所有成员都会被执行
     * @test
      const p1 = Promise.reject(1);
      const p2 = new Promise(resolve => setTimeout(() => {
        console.error('p2');
        resolve();
      }, 1000));
      const p3 = new Promise(resolve => setTimeout(() => {
        console.error('p3');
      }, 1000))
      Promise.all([p1, p2]).then(res => console.error(res));
     */
    for (var i = 0; i < args.length; i++) {
      res(i, args[i]);
    }
  });
};

Promise.allSettled = allSettled;

/**
 * 立即创建一个新的promise对象,区分value类型
 * 类属性
 * @test
 * Promise.resolve(1).then(res => console.error('res->', res));
 * 
 * @test
 * Promise.resolve(Promise.reject(2)).catch(err => console.error('err->', err));
 */
Promise.resolve = function (value) {
  if (value && typeof value === 'object' && value.constructor === Promise) {
    return value;
  }

  return new Promise(function (resolve) {
    resolve(value);
  });
};

/**
 * 立即创建一个rejected的promise对象
 * 
 * @test
 * Promise.reject(Promise.resolve(2)).catch(err => console.error('err->', err));
 */
Promise.reject = function (value) {
  return new Promise(function (resolve, reject) {
    reject(value);
  });
};

/**
 * 由第一个确定Promise状态的Promise决定最终的状态
 * 每个promise都会执行
 * 
 * @test
  const p1 = Promise.resolve(1);
  const p2 = Promise.reject(2);
  const p3 = Promise.resolve(3);
  Promise.race([p1, p2, p3]).then(res => console.error(res));
 * 
 */
Promise.race = function (arr) {
  return new Promise(function (resolve, reject) {
    if (!isArray(arr)) {
      return reject(new TypeError('Promise.race accepts an array'));
    }

    for (var i = 0, len = arr.length; i < len; i++) {
      Promise.resolve(arr[i]).then(resolve, reject);
    }
  });
};

// 模拟浏览器promise微任务的特点
Promise._immediateFn =
  (typeof setImmediateFunc === 'function' &&
    function (fn) {
      setImmediateFunc(fn);
    }) ||
  function (fn) {
    setTimeoutFunc(fn, 0);
  };


Promise._unhandledRejectionFn = function _unhandledRejectionFn(err) {
  if (typeof console !== 'undefined' && console) {
    console.warn('Possible Unhandled Promise Rejection:', err); 
  }
};

module.exports = Promise;
