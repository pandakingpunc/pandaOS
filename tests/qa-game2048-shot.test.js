/* QA scratch scenes (to be deleted) */
(function () {
  'use strict';
  const P = window.PandaOS;
  const T = window.PandaTest;
  const Q = P.params.get('q');
  const api = (w) => w.state.api;
  T.test('scene ' + Q, async (t) => {
    P.storage.remove('app.game2048');
    const w = P.apps.launch('game2048');
    await t.sleep(100);
    const A = api(w);
    const min = () => { w.setSize(360, 520); };
    if (Q === 'wide-short') {
      w.setSize(520, 520);
      A.setBoard([[2, 4, 8, 16], [32, 64, 128, 256], [512, 1024, 2, 4], [8, 16, 32, 0]], { score: 120, best: 500, moves: 4 });
    } else if (Q === 'win-min') {
      min();
      A.setBoard([[2048, 8, 2, 4], [4, 16, 32, 64], [2, 4, 128, 256], [8, 2, 4, 2]], { score: 1234567, best: 1234567, bestStart: 100 });
      A.move('left');
    } else if (Q === 'over-min') {
      min();
      A.setBoard([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]], { score: 123456, best: 123456, bestStart: 1000, moves: 4321 });
      A.setBoard([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]], { score: 123456, best: 123456, bestStart: 1000, moves: 4321 });
    } else if (Q === 'big-min') {
      min();
      A.setBoard([[131072, 65536, 32768, 16384], [8192, 4096, 2048, 1024], [512, 256, 128, 64], [1048576, 524288, 262144, 2]], { score: 9999999, best: 12345678, moves: 99999, keep: true });
    } else if (Q === 'long-header') {
      min();
      A.setBoard([[2, 4, 8, 16], [32, 64, 128, 256], [512, 1024, 2, 4], [8, 16, 32, 0]], { score: 9999999, best: 12345678, moves: 12345, keep: true });
    } else if (Q === 'small-hist') {
      min();
      A.setBoard([[2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
      for (const d of ['right', 'down', 'left', 'up', 'right', 'down']) A.move(d);
    } else if (Q === 'max') {
      w.maximize();
      A.setBoard([[2, 4, 8, 16], [32, 64, 128, 256], [512, 1024, 2048, 4096], [8192, 16384, 2, 0]], { score: 123456, best: 223456, moves: 321, keep: true });
    }
    await t.sleep(700);
    A.settle();
    await t.sleep(400);
  });
})();
