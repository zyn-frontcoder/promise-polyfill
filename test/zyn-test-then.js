require('../src/polyfill');

const p = new Promise((resolve, reject) => resolve(1));
p.then(res1 => console.error('res1_1->', res1));
p.then(res2 => console.error('res2->', res2));