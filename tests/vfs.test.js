/* VFS (PandaOS.fs) test suite — bash tools/test.sh vfs */
(function () {
  'use strict';

  const fs = PandaOS.fs;
  const HOME = '/home/panda';
  const DESK = HOME + '/Masaüstü';
  const RAW = 'pandaos.fs';

  /** every test starts from the factory tree */
  function fresh() {
    fs.reset();
    PandaOS.storage.remove('fs.corrupt');
  }

  function record() {
    const events = [];
    const off = PandaOS.bus.on('fs:change', (e) => events.push(JSON.parse(JSON.stringify(e))));
    return { events, stop: off };
  }

  function expectEvent(t, e, want) {
    t.ok(e, 'olay gelmedi');
    t.eq(e.type, want.type, 'olay türü');
    t.eq(e.path, want.path, 'olay yolu');
    if ('oldPath' in want) t.eq(e.oldPath, want.oldPath, 'olay eski yol');
    else t.ok(!('oldPath' in e), 'oldPath olmamalı');
    t.eq(e.parents, want.parents, 'olay üst klasörleri');
  }

  const utf8 = (s) => new TextEncoder().encode(s).length;

  /** full, order-independent snapshot of the in-memory state (tree + trash) */
  function dump() {
    const out = [['/', fs.stat('/').modified]];
    fs.walk('/', (s) => {
      out.push([s.path, s.type, s.size, s.created, s.modified, s.type === 'file' ? fs.readFile(s.path) : null]);
    });
    return JSON.stringify([out, fs.listTrash()]);
  }

  const stored = () => localStorage.getItem(RAW);

  // ---------------------------------------------------------------- path helpers
  PandaTest.test('normalize: ~, ., .., göreli yollar, eğik çizgiler', (t) => {
    t.eq(fs.HOME, HOME);
    t.eq(fs.normalize('~'), HOME);
    t.eq(fs.normalize('~/Belgeler'), HOME + '/Belgeler');
    t.eq(fs.normalize('~panda'), HOME + '/~panda', '~kullanıcı genişletilmez');
    t.eq(fs.normalize('/a/./b/../c'), '/a/c');
    t.eq(fs.normalize('/a/b/'), '/a/b');
    t.eq(fs.normalize('//a///b//'), '/a/b');
    t.eq(fs.normalize('/'), '/');
    t.eq(fs.normalize('///'), '/');
    t.eq(fs.normalize('/..'), '/');
    t.eq(fs.normalize('/../../x'), '/x');
    t.eq(fs.normalize('/a/b/../../..'), '/');
    t.eq(fs.normalize('Belgeler'), HOME + '/Belgeler');
    t.eq(fs.normalize('./Belgeler/../Müzik'), HOME + '/Müzik');
    t.eq(fs.normalize('../x'), '/home/x');
    t.eq(fs.normalize('x', '/etc'), '/etc/x');
    t.eq(fs.normalize('..', '/etc/foo'), '/etc');
    t.eq(fs.normalize('', '/tmp'), '/tmp');
    t.eq(fs.normalize('.', '/tmp'), '/tmp');
    t.eq(fs.normalize('', undefined), HOME);
    t.eq(fs.normalize('~/x', '/tmp'), HOME + '/x', 'mutlak ~ cwd’yi yok sayar');
    t.eq(fs.normalize('/abs', '/tmp'), '/abs');
    t.eq(fs.normalize('x', '~/Belgeler'), HOME + '/Belgeler/x');
    t.eq(fs.normalize('x', 'Belgeler'), HOME + '/Belgeler/x', 'göreli cwd HOME’a göre çözülür');
    t.eq(fs.normalize('/a/ş', '/'), '/a/ş', 'NFC birleştirme');
    t.eq(fs.normalize('/Masaüstü'), '/Masaüstü');
    t.eq(fs.normalize('/Ab Cd/ç ğ'), '/Ab Cd/ç ğ', 'boşluk ve Türkçe karakterler korunur');
  });

  PandaTest.test('join, dirname, basename, extname, stem, displayName', (t) => {
    t.eq(fs.join('/a', 'b', 'c.txt'), '/a/b/c.txt');
    t.eq(fs.join('/a/', '/b'), '/a/b');
    t.eq(fs.join('/a', '..', 'b'), '/b');
    t.eq(fs.join('/', 'x'), '/x');
    t.eq(fs.join('/a', '', 'b'), '/a/b');
    t.eq(fs.join('~', 'x'), HOME + '/x');
    t.eq(fs.join('/a', 'Alışveriş Listesi.txt'), '/a/Alışveriş Listesi.txt');

    t.eq(fs.dirname('/a/b/c.txt'), '/a/b');
    t.eq(fs.dirname('/a'), '/');
    t.eq(fs.dirname('/'), '/');
    t.eq(fs.dirname('/a/b/'), '/a');

    t.eq(fs.basename('/a/b/c.txt'), 'c.txt');
    t.eq(fs.basename('/a/b/'), 'b');
    t.eq(fs.basename('/'), '/');

    t.eq(fs.extname('/x/Foo.TXT'), '.txt');
    t.eq(fs.extname('/x/archive.tar.gz'), '.gz');
    t.eq(fs.extname('/x/.bashrc'), '');
    t.eq(fs.extname('/x/noext'), '');
    t.eq(fs.extname('/x/trailing.'), '');
    t.eq(fs.extname('/x/MIDI.PMUS'), '.pmus');
    t.eq(fs.extname('/'), '');

    t.eq(fs.stem('/x/a.b.txt'), 'a.b');
    t.eq(fs.stem('/x/.bashrc'), '.bashrc');
    t.eq(fs.stem('/x/noext'), 'noext');
    t.eq(fs.stem('/x/Müzik Çalar.app'), 'Müzik Çalar');

    t.eq(fs.displayName(DESK + '/Terminal.app'), 'Terminal');
    t.eq(fs.displayName(DESK + '/Müzik Çalar.app'), 'Müzik Çalar');
    t.eq(fs.displayName(DESK + '/Beni Oku.txt'), 'Beni Oku.txt');
    t.eq(fs.displayName(DESK + '/Büyük.APP'), 'Büyük');
    t.eq(fs.displayName(HOME + '/Belgeler'), 'Belgeler');
  });

  // ---------------------------------------------------------------- seed
  PandaTest.test('başlangıç ağacı (seed)', (t) => {
    fresh();
    const dirs = ['/bin', '/etc', '/tmp', '/home', HOME, DESK, HOME + '/Belgeler', HOME + '/Belgeler/Projeler',
      HOME + '/Resimler', HOME + '/Müzik', HOME + '/İndirilenler'];
    for (const d of dirs) t.ok(fs.isDir(d), `${d} klasör olmalı`);
    const files = ['/etc/hostname', '/etc/motd', '/etc/os-release', DESK + '/Beni Oku.txt',
      HOME + '/Belgeler/Notlar.txt', HOME + '/Belgeler/Alışveriş Listesi.txt',
      HOME + '/Belgeler/Projeler/PandaOS Fikirleri.md', HOME + '/Müzik/Neşeye Övgü.pmus'];
    for (const f of files) t.ok(fs.isFile(f), `${f} dosya olmalı`);

    t.eq(fs.readFile('/etc/hostname'), 'pandaos');
    const osr = fs.readFile('/etc/os-release');
    t.ok(osr.includes('NAME="PandaOS"') && osr.includes('VERSION="1.0 (Bambu)"') && osr.includes('ID=pandaos'), 'os-release');
    const motd = fs.readFile('/etc/motd');
    t.ok(motd.includes('PandaOS') && motd.includes('@'), 'motd panda çizimi + karşılama');

    t.eq(fs.list('/tmp'), []);
    t.eq(fs.list(HOME + '/Resimler'), []);
    t.eq(fs.list(HOME + '/İndirilenler'), []);

    const shortcuts = {
      'Dosyalar.app': 'files', 'Terminal.app': 'terminal', 'Not Defteri.app': 'notepad',
      'Hesap Makinesi.app': 'calculator', 'Müzik Çalar.app': 'music', 'Mayın Tarlası.app': 'minesweeper',
      '2048.app': 'game2048', 'Çizim.app': 'paint', 'Ayarlar.app': 'settings'
    };
    const names = fs.list(DESK).map((s) => s.name).sort();
    t.eq(names, Object.keys(shortcuts).concat('Beni Oku.txt').sort(), 'masaüstü içeriği');
    for (const [name, appId] of Object.entries(shortcuts)) {
      t.eq(JSON.parse(fs.readFile(`${DESK}/${name}`)), { appId }, name);
      t.eq(fs.readFile(`${DESK}/${name}`), JSON.stringify({ appId }), name + ' tam içerik');
    }

    const readme = fs.readFile(DESK + '/Beni Oku.txt');
    t.ok(readme.includes('PandaOS') && readme.includes('Ctrl + Alt + L') && readme.includes('localStorage') &&
      readme.includes('help') && readme.includes('Terminal'), 'Beni Oku içeriği');
    t.ok(/[çğıöşüÇĞİÖŞÜ]/.test(readme), 'Türkçe karakterler');
    t.ok(fs.readFile(HOME + '/Belgeler/Alışveriş Listesi.txt').includes('Bambu (çok)'));
    t.ok(fs.readFile(HOME + '/Belgeler/Notlar.txt').length > 100);
    const md = fs.readFile(HOME + '/Belgeler/Projeler/PandaOS Fikirleri.md');
    t.ok(md.startsWith('# ') && md.includes('## '), 'markdown başlıkları');

    const bin = fs.list('/bin').map((s) => s.name);
    for (const c of ['ls', 'cd', 'cat', 'mkdir', 'rm', 'help']) t.ok(bin.includes(c), `/bin/${c}`);
    for (const c of bin) {
      t.ok(fs.readFile('/bin/' + c).startsWith(`#!/bin/panda-sh\n# yerleşik komut: ${c}`), `/bin/${c} içeriği`);
    }
    t.ok(fs.usage().used > 5000 && fs.trashCount() === 0);
  });

  PandaTest.test('Neşeye Övgü.pmus: doğru melodi, eşit uzunlukta parçalar', (t) => {
    fresh();
    const song = JSON.parse(fs.readFile(HOME + '/Müzik/Neşeye Övgü.pmus'));
    t.eq(song.title, 'Neşeye Övgü');
    t.ok(/Beethoven/.test(song.artist));
    t.ok(song.bpm >= 100 && song.bpm <= 120, 'bpm ~110');
    const byName = Object.fromEntries(song.tracks.map((tr) => [tr.instrument, tr.notes]));
    t.eq(Object.keys(byName).sort(), ['bass', 'drums', 'lead']);

    const NOTE = /^[A-G](#|b)?[0-8]$/;
    const DRUMS = ['kick', 'snare', 'hat', 'clap'];
    const sums = {};
    for (const [instrument, notes] of Object.entries(byName)) {
      let sum = 0;
      for (const [name, beats] of notes) {
        t.ok(typeof beats === 'number' && beats > 0 && beats * 4 === Math.round(beats * 4), `${instrument}: süre ${beats}`);
        if (name !== null) {
          t.ok(instrument === 'drums' ? DRUMS.includes(name) : NOTE.test(name), `${instrument}: geçersiz nota ${name}`);
        }
        sum += beats;
      }
      sums[instrument] = sum;
    }
    t.eq(sums, { lead: 64, bass: 64, drums: 64 }, '16 ölçü = 64 vuruş, tüm parçalar eşit');

    // melody: 16 bars of the theme (A, A', B, A')
    const lead = byName.lead.map((n) => n[0]).join(' ');
    const a1 = 'E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4 D4 D4';
    const a2 = 'E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4 C4 C4';
    const b = 'D4 D4 E4 C4 D4 E4 F4 E4 C4 D4 E4 F4 E4 D4 C4 D4 G3';
    t.eq(lead, [a1, a2, b, a2].join(' '));
    // dotted rhythm in bars 4 and 8, half notes at the end of phrases
    t.eq(byName.lead.slice(12, 15), [['E4', 1.5], ['D4', 0.5], ['D4', 2]]);

    // every bar line of lead and drums lands on a note boundary (multiples of 4 beats)
    for (const inst of ['lead', 'drums']) {
      const marks = new Set();
      let at = 0;
      for (const n of byName[inst]) { at += n[1]; marks.add(at); }
      for (let bar = 1; bar <= 16; bar++) t.ok(marks.has(bar * 4), `${inst}: ${bar}. ölçü sonu`);
    }
    // bass: root notes only (C/G changes) on half-note boundaries
    t.ok(byName.bass.every((n) => (n[0] === 'C3' || n[0] === 'G2') && n[1] === 2), 'bas kök notalar');
    t.ok(byName.bass.some((n) => n[0] === 'G2') && byName.bass.some((n) => n[0] === 'C3'));
    t.eq(byName.bass[0][0], 'C3');
    t.eq(byName.bass[byName.bass.length - 1][0], 'C3', 'sonunda ana akora döner');
    const used = new Set(byName.drums.map((n) => n[0]).filter(Boolean));
    t.ok(used.has('kick') && used.has('hat') && used.has('snare'), 'davul: kick/hat/snare');
  });

  // ---------------------------------------------------------------- stat & list
  PandaTest.test('stat alanları, boyut ve zaman damgaları', (t) => {
    fresh();
    const st = fs.stat('/etc/hostname');
    t.eq([st.path, st.name, st.type, st.ext, st.size, st.hidden], ['/etc/hostname', 'hostname', 'file', '', 7, false]);
    t.ok(typeof st.created === 'number' && typeof st.modified === 'number' && st.modified >= st.created);
    t.ok(!('childCount' in st), 'dosyada childCount yok');

    const dir = fs.stat(HOME + '/Belgeler');
    t.eq([dir.type, dir.name, dir.ext, dir.childCount], ['dir', 'Belgeler', '', 3]);
    t.eq(dir.size, fs.list(HOME + '/Belgeler').reduce((a, s) => a + s.size, 0), 'klasör boyutu = çocukların toplamı');

    const total = fs.stat(HOME).size;
    let sum = 0;
    fs.walk(HOME, (s) => { if (s.type === 'file') sum += utf8(fs.readFile(s.path)); });
    t.eq(total, sum, 'HOME boyutu = tüm dosyaların UTF-8 bayt toplamı');

    const root = fs.stat('/');
    t.eq([root.path, root.name, root.type], ['/', '/', 'dir']);
    t.eq(fs.stat(DESK + '/Terminal.app').ext, '.app');
    t.eq(fs.stat('~').path, HOME);
    t.eq(fs.stat(HOME + '/Belgeler/').path, HOME + '/Belgeler', 'sondaki / yok sayılır');

    t.eq(fs.stat('/yok'), null);
    t.eq(fs.stat(''), null);
    t.eq(fs.stat(undefined), null);
    t.eq(fs.stat(null), null);
    t.eq(fs.stat('/etc/hostname/altinda'), null, 'dosyanın altı yok');
    t.ok(!fs.exists('') && !fs.exists(undefined) && !fs.exists('/yok'));
    t.ok(fs.exists('/etc') && fs.exists('~') && fs.exists('Belgeler'), 'göreli yol HOME’a göre');
    t.ok(fs.isDir('/etc') && !fs.isDir('/etc/motd') && !fs.isDir('/yok'));
    t.ok(fs.isFile('/etc/motd') && !fs.isFile('/etc') && !fs.isFile('/yok'));

    // returned stats are copies
    const copy = fs.stat('/etc/hostname');
    copy.size = 999;
    t.eq(fs.stat('/etc/hostname').size, 7);
  });

  PandaTest.test('list: klasörler önce, Türkçe sıralama, gizli dosyalar', (t) => {
    fresh();
    t.eq(fs.list(HOME + '/Belgeler').map((s) => s.name), ['Projeler', 'Alışveriş Listesi.txt', 'Notlar.txt']);
    t.eq(fs.list(HOME).map((s) => s.name), ['Belgeler', 'İndirilenler', 'Masaüstü', 'Müzik', 'Resimler']);

    for (const n of ['cb', 'çb', 'da', 'ha', 'ıa', 'ia', 'ja']) fs.writeFile('/tmp/' + n, '');
    t.eq(fs.list('/tmp').map((s) => s.name), ['cb', 'çb', 'da', 'ha', 'ıa', 'ia', 'ja'], 'Türkçe alfabe sırası');
    fs.reset();
    for (const n of ['dosya10.txt', 'dosya2.txt', 'Dosya1.txt']) fs.writeFile('/tmp/' + n, '');
    fs.mkdir('/tmp/zzz');
    t.eq(fs.list('/tmp').map((s) => s.name), ['zzz', 'Dosya1.txt', 'dosya2.txt', 'dosya10.txt'], 'sayısal sıralama, klasör önce');

    fs.reset();
    fs.writeFile('/tmp/.gizli', 'x');
    fs.mkdir('/tmp/.gizli-klasor');
    fs.writeFile('/tmp/gorunur.txt', 'y');
    t.eq(fs.list('/tmp').map((s) => s.name), ['gorunur.txt']);
    t.eq(fs.list('/tmp', { hidden: false }).length, 1);
    t.eq(fs.list('/tmp', { hidden: true }).map((s) => s.name), ['.gizli-klasor', '.gizli', 'gorunur.txt']);
    t.ok(fs.stat('/tmp/.gizli').hidden === true && fs.stat('/tmp/gorunur.txt').hidden === false);

    t.eq(fs.list('~/Masaüstü/').length, 10);
    t.throws(() => fs.list('/yok'), 'ENOENT');
    t.throws(() => fs.list('/etc/hostname'), 'ENOTDIR');
    t.throws(() => fs.list(''), 'EINVAL');
    t.throws(() => fs.list('/etc/hostname/x'), 'ENOTDIR');
  });

  // ---------------------------------------------------------------- mkdir
  PandaTest.test('mkdir: temel, EEXIST, ENOENT, ENOTDIR, recursive', (t) => {
    fresh();
    t.eq(fs.mkdir('/tmp/a'), '/tmp/a');
    t.ok(fs.isDir('/tmp/a'));
    t.throws(() => fs.mkdir('/tmp/a'), 'EEXIST');
    t.throws(() => fs.mkdir('/tmp/x/y'), 'ENOENT');
    t.ok(!fs.exists('/tmp/x'), 'ENOENT sonrası yarım klasör kalmamalı');
    t.throws(() => fs.mkdir('/etc/hostname'), 'EEXIST');
    t.throws(() => fs.mkdir('/etc/hostname/x'), 'ENOTDIR');
    t.throws(() => fs.mkdir('/'), 'EEXIST');
    t.throws(() => fs.mkdir(''), 'EINVAL');

    fs.mkdir('/tmp/p/q/r', { recursive: true });
    t.ok(fs.isDir('/tmp/p') && fs.isDir('/tmp/p/q') && fs.isDir('/tmp/p/q/r'));
    fs.mkdir('/tmp/p/q/r', { recursive: true }); // no error on existing dir
    fs.mkdir('/tmp/p/q/r/s', { recursive: true });
    t.ok(fs.isDir('/tmp/p/q/r/s'));
    t.throws(() => fs.mkdir('/etc/hostname', { recursive: true }), 'EEXIST');
    t.throws(() => fs.mkdir('/etc/hostname/x/y', { recursive: true }), 'ENOTDIR');
    t.ok(!fs.exists('/etc/hostname/x'));

    // relative paths resolve against HOME
    fs.mkdir('Yeni Deneme');
    t.ok(fs.isDir(HOME + '/Yeni Deneme'));
    fs.mkdir('Türkçe Ğüşiöç İ/ı', { recursive: true });
    t.ok(fs.isDir(HOME + '/Türkçe Ğüşiöç İ/ı'));
  });

  // ---------------------------------------------------------------- files
  PandaTest.test('writeFile / readFile / appendFile', (t) => {
    fresh();
    t.eq(fs.writeFile('/tmp/a.txt', 'merhaba'), '/tmp/a.txt');
    t.eq(fs.readFile('/tmp/a.txt'), 'merhaba');
    fs.writeFile('/tmp/a.txt', 'dünya');
    t.eq(fs.readFile('/tmp/a.txt'), 'dünya', 'üzerine yazar');
    fs.appendFile('/tmp/a.txt', ' ve panda');
    t.eq(fs.readFile('/tmp/a.txt'), 'dünya ve panda');
    fs.appendFile('/tmp/yeni.txt', 'ilk satır');
    t.eq(fs.readFile('/tmp/yeni.txt'), 'ilk satır', 'appendFile yoksa oluşturur');

    fs.writeFile('/tmp/bos.txt', '');
    t.eq(fs.readFile('/tmp/bos.txt'), '');
    t.eq(fs.stat('/tmp/bos.txt').size, 0);
    fs.writeFile('/tmp/sayi.txt', 42);
    t.eq(fs.readFile('/tmp/sayi.txt'), '42');
    fs.writeFile('/tmp/null.txt', null);
    t.eq(fs.readFile('/tmp/null.txt'), '');
    fs.writeFile('/tmp/undef.txt');
    t.eq(fs.readFile('/tmp/undef.txt'), '');

    fs.writeFile('/tmp/Şeker Çöreği İçin.txt', 'tarif: ığüşöç');
    t.eq(fs.readFile('/tmp/Şeker Çöreği İçin.txt'), 'tarif: ığüşöç');
    t.ok(fs.list('/tmp').some((s) => s.name === 'Şeker Çöreği İçin.txt'));

    const big = 'ö'.repeat(150000);
    fs.writeFile('/tmp/buyuk.txt', big);
    t.ok(fs.readFile('/tmp/buyuk.txt') === big, 'büyük içerik aynen geri gelir');
    t.eq(fs.stat('/tmp/buyuk.txt').size, 300000);

    // relative path -> HOME
    fs.writeFile('goreli.txt', 'g');
    t.eq(fs.readFile(HOME + '/goreli.txt'), 'g');
  });

  PandaTest.test('dosya hataları: EISDIR, ENOENT, ENOTDIR, EINVAL', (t) => {
    fresh();
    t.throws(() => fs.writeFile('/tmp', 'x'), 'EISDIR');
    t.throws(() => fs.writeFile('/', 'x'), 'EISDIR');
    t.throws(() => fs.appendFile('/tmp', 'x'), 'EISDIR');
    t.throws(() => fs.readFile('/tmp'), 'EISDIR');
    t.throws(() => fs.readFile('/yok'), 'ENOENT');
    t.throws(() => fs.readFile(''), 'EINVAL');
    t.throws(() => fs.writeFile('/yok/x.txt', 'a'), 'ENOENT');
    t.throws(() => fs.appendFile('/yok/x.txt', 'a'), 'ENOENT');
    t.throws(() => fs.writeFile('/etc/hostname/x.txt', 'a'), 'ENOTDIR');
    t.throws(() => fs.appendFile('/etc/hostname/x.txt', 'a'), 'ENOTDIR');
    t.throws(() => fs.readFile('/etc/hostname/x'), 'ENOTDIR');
    t.throws(() => fs.writeFile('', 'x'), 'EINVAL');
    t.throws(() => fs.writeFile(null, 'x'), 'EINVAL');
    t.throws(() => fs.writeFile(undefined, 'x'), 'EINVAL');
    t.throws(() => fs.writeFile('/tmp/' + 'a'.repeat(256), 'x'), 'EINVAL');
    fs.writeFile('/tmp/' + 'a'.repeat(255), 'x');
    t.eq(fs.readFile('/tmp/' + 'a'.repeat(255)), 'x', '255 karakter serbest');
    t.eq(fs.list('/tmp').length, 1);
  });

  PandaTest.test('size = UTF-8 bayt uzunluğu, dizinde toplam, önbellek tutarlı', (t) => {
    fresh();
    fs.writeFile('/tmp/u.txt', 'ışık');
    t.eq(fs.stat('/tmp/u.txt').size, 7);
    fs.writeFile('/tmp/u.txt', 'a€𝄞');
    t.eq(fs.stat('/tmp/u.txt').size, 8);
    fs.writeFile('/tmp/u.txt', 'abc');
    t.eq(fs.stat('/tmp/u.txt').size, 3, 'üzerine yazınca boyut güncellenir');
    fs.appendFile('/tmp/u.txt', 'ş');
    t.eq(fs.stat('/tmp/u.txt').size, 5);

    fs.mkdir('/tmp/d/e', { recursive: true });
    fs.writeFile('/tmp/d/e/f.txt', '12345');
    fs.writeFile('/tmp/d/g.txt', 'ğğ');
    t.eq(fs.stat('/tmp/d').size, 9);
    t.eq(fs.stat('/tmp/d/e').size, 5);
    fs.writeFile('/tmp/d/e/f.txt', '1');
    t.eq(fs.stat('/tmp/d').size, 5, 'üst klasör boyutu da güncellenir');
    fs.remove('/tmp/d/g.txt');
    t.eq(fs.stat('/tmp/d').size, 1);
    t.eq(fs.stat('/tmp/d').childCount, 2 - 1);
    t.eq(fs.stat('/tmp').size, 5 + 1);
  });

  PandaTest.test('zaman damgaları: created/modified ve üst klasörün modified değeri', (t) => {
    fresh();
    const m0 = fs.stat('/tmp').modified;
    fs.writeFile('/tmp/z.txt', '1');
    const a = fs.stat('/tmp/z.txt');
    const m1 = fs.stat('/tmp').modified;
    t.ok(m1 > m0, 'dosya oluşturunca klasörün modified değeri artar');
    t.eq(a.created, a.modified);

    fs.writeFile('/tmp/z.txt', '2');
    const b = fs.stat('/tmp/z.txt');
    const m2 = fs.stat('/tmp').modified;
    t.eq(b.created, a.created, 'created değişmez');
    t.ok(b.modified > a.modified, 'üzerine yazınca modified artar');
    t.ok(m2 > m1, 'üzerine yazınca klasör modified artar');

    fs.appendFile('/tmp/z.txt', '3');
    t.ok(fs.stat('/tmp/z.txt').modified > b.modified);

    const m3 = fs.stat('/tmp').modified;
    fs.mkdir('/tmp/zd');
    const m4 = fs.stat('/tmp').modified;
    t.ok(m4 > m3, 'mkdir');
    fs.rename('/tmp/zd', 'zd2');
    const m5 = fs.stat('/tmp').modified;
    t.ok(m5 > m4, 'rename');
    fs.remove('/tmp/zd2');
    t.ok(fs.stat('/tmp').modified > m5, 'remove');

    const e0 = fs.stat('/etc').modified;
    fs.move('/tmp/z.txt', '/etc');
    t.ok(fs.stat('/etc').modified > e0, 'move: hedef klasör');
    const t0 = fs.stat('/tmp').modified;
    fs.copy('/etc/z.txt', '/tmp');
    t.ok(fs.stat('/tmp').modified > t0, 'copy: hedef klasör');
    const c = fs.stat('/tmp/z.txt');
    t.ok(c.created >= fs.stat('/etc/z.txt').created && c.created === c.modified, 'kopya yeni damga alır');
  });

  PandaTest.test('geçersiz adlar: "", ".", "..", "/", >255, boşluk, denetim karakteri', (t) => {
    fresh();
    fs.writeFile('/tmp/ok.txt', 'x');
    fs.mkdir('/tmp/dir');
    for (const bad of ['', '.', '..', 'a/b', '/', 'x'.repeat(256), '   ', '\t', 'a\u0000b', 'a\nb']) {
      t.throws(() => fs.rename('/tmp/ok.txt', bad), 'EINVAL');
    }
    for (const bad of ['x'.repeat(256), '   ', 'a\u0000b']) {
      t.throws(() => fs.writeFile('/tmp/' + bad, 'x'), 'EINVAL');
      t.throws(() => fs.mkdir('/tmp/' + bad), 'EINVAL');
    }
    t.throws(() => fs.rename('/tmp/ok.txt', null), 'EINVAL');
    t.throws(() => fs.rename('/tmp/ok.txt', undefined), 'EINVAL');
    t.throws(() => fs.rename('/tmp/ok.txt', 42), 'EINVAL');
    t.throws(() => fs.mkdir('/tmp/' + 'x'.repeat(256) + '/y', { recursive: true }), 'EINVAL');
    t.ok(!fs.exists('/tmp/' + 'x'.repeat(256)));
    t.eq(fs.list('/tmp').map((s) => s.name), ['dir', 'ok.txt'], 'hiçbir geçersiz ad iz bırakmadı');

    fs.rename('/tmp/ok.txt', 'x'.repeat(255));
    t.ok(fs.exists('/tmp/' + 'x'.repeat(255)), '255 karakter geçerli');
    fs.writeFile('/tmp/ leading and trailing ', '1');
    t.ok(fs.exists('/tmp/ leading and trailing '), 'baş/son boşluklu ad serbest');
    for (const odd of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      fs.writeFile('/tmp/' + odd, odd + '!');
      t.eq(fs.readFile('/tmp/' + odd), odd + '!', odd);
    }
    fs.mkdir('/tmp/__proto__dir');
    fs.mkdir('/tmp/__proto__dir/__proto__');
    fs._reload();
    t.eq(fs.readFile('/tmp/__proto__'), '__proto__!', 'özel adlar kalıcı');
    t.ok(fs.isDir('/tmp/__proto__dir/__proto__'));
    t.ok(!fs.exists('/tmp/nonexistent') && !({}).polluted, 'prototip kirlenmedi');
  });

  // ---------------------------------------------------------------- rename
  PandaTest.test('rename', (t) => {
    fresh();
    fs.writeFile('/tmp/r1.txt', 'içerik');
    const before = fs.stat('/tmp/r1.txt');
    t.eq(fs.rename('/tmp/r1.txt', 'r2.txt'), '/tmp/r2.txt');
    t.ok(!fs.exists('/tmp/r1.txt') && fs.exists('/tmp/r2.txt'));
    t.eq(fs.readFile('/tmp/r2.txt'), 'içerik');
    t.eq(fs.stat('/tmp/r2.txt').created, before.created);

    fs.writeFile('/tmp/r3.txt', 'x');
    t.throws(() => fs.rename('/tmp/r2.txt', 'r3.txt'), 'EEXIST');
    t.eq(fs.readFile('/tmp/r2.txt'), 'içerik', 'başarısız rename dosyayı bozmaz');
    t.throws(() => fs.rename('/tmp/yok.txt', 'a.txt'), 'ENOENT');
    t.throws(() => fs.rename('/yok/yok.txt', 'a.txt'), 'ENOENT');
    t.throws(() => fs.rename('', 'a.txt'), 'EINVAL');
    t.throws(() => fs.rename('/tmp/r2.txt', 'a/b.txt'), 'EINVAL');

    // same name: no-op, no event
    const rec = record();
    t.eq(fs.rename('/tmp/r2.txt', 'r2.txt'), '/tmp/r2.txt');
    rec.stop();
    t.eq(rec.events.length, 0, 'aynı ad: olay yok');

    // case-only rename
    fs.rename('/tmp/r2.txt', 'R2.txt');
    t.ok(fs.exists('/tmp/R2.txt') && !fs.exists('/tmp/r2.txt'));

    // directories keep their children
    fs.mkdir('/tmp/kl/alt', { recursive: true });
    fs.writeFile('/tmp/kl/alt/f.txt', 'f');
    fs.rename('/tmp/kl', 'Klasör Ğ');
    t.eq(fs.readFile('/tmp/Klasör Ğ/alt/f.txt'), 'f');
    t.ok(!fs.exists('/tmp/kl'));

    // protected
    for (const p of ['/', '/home', HOME, DESK]) t.throws(() => fs.rename(p, 'baska'), 'EPERM');
    t.ok(fs.isDir(DESK) && fs.isDir(HOME));
    // children of protected folders are renameable
    fs.rename(DESK + '/Beni Oku.txt', 'Oku Beni.txt');
    t.ok(fs.exists(DESK + '/Oku Beni.txt'));
  });

  // ---------------------------------------------------------------- move
  PandaTest.test('move', (t) => {
    fresh();
    fs.mkdir('/tmp/m1');
    fs.mkdir('/tmp/m2');
    fs.writeFile('/tmp/m1/f.txt', 'taşı beni');
    const c0 = fs.stat('/tmp/m1/f.txt').created;
    t.eq(fs.move('/tmp/m1/f.txt', '/tmp/m2'), '/tmp/m2/f.txt');
    t.ok(!fs.exists('/tmp/m1/f.txt'));
    t.eq(fs.readFile('/tmp/m2/f.txt'), 'taşı beni');
    t.eq(fs.stat('/tmp/m2/f.txt').created, c0);

    fs.writeFile('/tmp/m1/f.txt', 'çakışan');
    t.throws(() => fs.move('/tmp/m1/f.txt', '/tmp/m2'), 'EEXIST');
    t.eq(fs.readFile('/tmp/m1/f.txt'), 'çakışan', 'başarısız taşıma kaynağı korur');
    t.eq(fs.readFile('/tmp/m2/f.txt'), 'taşı beni');

    // directory with children
    fs.mkdir('/tmp/m1/alt/derin', { recursive: true });
    fs.writeFile('/tmp/m1/alt/derin/x.txt', 'x');
    t.eq(fs.move('/tmp/m1/alt', '/tmp/m2'), '/tmp/m2/alt');
    t.eq(fs.readFile('/tmp/m2/alt/derin/x.txt'), 'x');
    t.ok(!fs.exists('/tmp/m1/alt'));

    // into itself / own subfolder
    fs.mkdir('/tmp/m2/alt/sub');
    t.throws(() => fs.move('/tmp/m2/alt', '/tmp/m2/alt'), 'EINVAL');
    t.throws(() => fs.move('/tmp/m2/alt', '/tmp/m2/alt/sub'), 'EINVAL');
    t.throws(() => fs.move('/tmp/m2/alt', '/tmp/m2/alt/derin/'), 'EINVAL');
    t.throws(() => fs.move('/tmp/m2', '/tmp/m2/alt/sub'), 'EINVAL');
    t.ok(fs.isDir('/tmp/m2/alt/sub') && fs.isDir('/tmp/m2/alt/derin'), 'ağaç bozulmadı');
    // prefix look-alike is NOT inside
    fs.mkdir('/tmp/ab');
    fs.mkdir('/tmp/abc');
    t.eq(fs.move('/tmp/ab', '/tmp/abc'), '/tmp/abc/ab');

    t.throws(() => fs.move('/tmp/yok', '/tmp/m2'), 'ENOENT');
    t.throws(() => fs.move('/tmp/m1/f.txt', '/tmp/yok'), 'ENOENT');
    t.throws(() => fs.move('/tmp/m1/f.txt', '/etc/hostname'), 'ENOTDIR');
    t.throws(() => fs.move('', '/tmp'), 'EINVAL');

    // already in destination: no-op
    const rec = record();
    t.eq(fs.move('/tmp/m1/f.txt', '/tmp/m1'), '/tmp/m1/f.txt');
    rec.stop();
    t.eq(rec.events.length, 0);

    for (const p of ['/', '/home', HOME, DESK]) t.throws(() => fs.move(p, '/tmp'), 'EPERM');
    // moving INTO a protected folder is fine
    t.eq(fs.move('/tmp/m1/f.txt', DESK), DESK + '/f.txt');
  });

  // ---------------------------------------------------------------- copy
  PandaTest.test('copy: yeniden adlandırma ve özyineleme', (t) => {
    fresh();
    fs.writeFile('/tmp/ad.txt', 'kopyalanacak');
    fs.mkdir('/tmp/hedef');
    t.eq(fs.copy('/tmp/ad.txt', '/tmp/hedef'), '/tmp/hedef/ad.txt', 'çakışma yoksa aynı ad');
    t.eq(fs.copy('/tmp/ad.txt', '/tmp'), '/tmp/ad (kopya).txt');
    t.eq(fs.copy('/tmp/ad.txt', '/tmp'), '/tmp/ad (kopya 2).txt');
    t.eq(fs.copy('/tmp/ad.txt', '/tmp'), '/tmp/ad (kopya 3).txt');
    t.eq(fs.copy('/tmp/ad (kopya).txt', '/tmp'), '/tmp/ad (kopya 4).txt', 'kopyanın kopyası ad (kopya) ekini katlamaz');
    t.eq(fs.readFile('/tmp/ad (kopya 2).txt'), 'kopyalanacak');
    t.eq(fs.readFile('/tmp/ad.txt'), 'kopyalanacak', 'kaynak yerinde');

    fs.writeFile('/tmp/Makefile', 'm');
    t.eq(fs.copy('/tmp/Makefile', '/tmp'), '/tmp/Makefile (kopya)');
    fs.writeFile('/tmp/.gizli', 'g');
    t.eq(fs.copy('/tmp/.gizli', '/tmp'), '/tmp/.gizli (kopya)');
    fs.writeFile('/tmp/arsiv.tar.gz', 'z');
    t.eq(fs.copy('/tmp/arsiv.tar.gz', '/tmp'), '/tmp/arsiv.tar (kopya).gz');

    // directories: recursive, independent of the original
    fs.mkdir('/tmp/Proje/alt', { recursive: true });
    fs.writeFile('/tmp/Proje/a.txt', 'A');
    fs.writeFile('/tmp/Proje/alt/b.txt', 'B');
    t.eq(fs.copy('/tmp/Proje', '/tmp'), '/tmp/Proje (kopya)');
    t.eq(fs.readFile('/tmp/Proje (kopya)/alt/b.txt'), 'B');
    t.eq(fs.copy('/tmp/Proje', '/tmp'), '/tmp/Proje (kopya 2)');
    fs.writeFile('/tmp/Proje (kopya)/a.txt', 'değişti');
    fs.remove('/tmp/Proje (kopya)/alt', { recursive: true });
    t.eq(fs.readFile('/tmp/Proje/a.txt'), 'A', 'kopyayı değiştirmek orijinali etkilemez');
    t.eq(fs.readFile('/tmp/Proje/alt/b.txt'), 'B');
    t.eq(fs.stat('/tmp/Proje (kopya 2)').size, 2);
    t.eq(fs.copy('/tmp/Proje', '/tmp/hedef'), '/tmp/hedef/Proje');

    // desktop shortcut
    t.eq(fs.copy(DESK + '/Terminal.app', DESK), DESK + '/Terminal (kopya).app');

    // errors
    t.throws(() => fs.copy('/tmp/Proje', '/tmp/Proje'), 'EINVAL');
    t.throws(() => fs.copy('/tmp/Proje', '/tmp/Proje/alt'), 'EINVAL');
    t.throws(() => fs.copy('/', '/tmp'), 'EINVAL');
    t.throws(() => fs.copy('/tmp/yok', '/tmp'), 'ENOENT');
    t.throws(() => fs.copy('/tmp/ad.txt', '/tmp/yok'), 'ENOENT');
    t.throws(() => fs.copy('/tmp/ad.txt', '/etc/hostname'), 'ENOTDIR');
    // copying a file into its own parent works, copying a dir into a sibling named like a prefix works
    fs.mkdir('/tmp/Pro');
    t.eq(fs.copy('/tmp/Pro', '/tmp/Proje'), '/tmp/Proje/Pro');
    // protected folders can be copied
    t.eq(fs.copy(DESK, '/tmp'), '/tmp/Masaüstü');
  });

  // ---------------------------------------------------------------- remove & protected
  PandaTest.test('remove: ENOTEMPTY, recursive, ENOENT', (t) => {
    fresh();
    fs.writeFile('/tmp/f.txt', 'x');
    fs.remove('/tmp/f.txt');
    t.ok(!fs.exists('/tmp/f.txt'));
    t.throws(() => fs.remove('/tmp/f.txt'), 'ENOENT');
    t.throws(() => fs.remove('/yok/f.txt'), 'ENOENT');
    t.throws(() => fs.remove(''), 'EINVAL');

    fs.mkdir('/tmp/d/e', { recursive: true });
    fs.writeFile('/tmp/d/e/f.txt', 'x');
    t.throws(() => fs.remove('/tmp/d'), 'ENOTEMPTY');
    t.throws(() => fs.remove('/tmp/d/e', { recursive: false }), 'ENOTEMPTY');
    t.ok(fs.exists('/tmp/d/e/f.txt'));
    fs.remove('/tmp/d', { recursive: true });
    t.ok(!fs.exists('/tmp/d'));

    fs.mkdir('/tmp/bos');
    fs.remove('/tmp/bos'); // empty directory needs no recursive flag
    t.ok(!fs.exists('/tmp/bos'));
    fs.writeFile('/tmp/g.txt', 'x');
    fs.remove('/tmp/g.txt', { recursive: true });
    t.ok(!fs.exists('/tmp/g.txt'));
    t.eq(fs.list('/tmp'), []);
  });

  PandaTest.test('korumalı yollar: EPERM (remove, trash, rename, move)', (t) => {
    fresh();
    const protectedPaths = ['/', '/home', HOME, DESK];
    for (const p of protectedPaths) {
      t.ok(fs.isProtected(p), p);
      t.throws(() => fs.remove(p), 'EPERM');
      t.throws(() => fs.remove(p, { recursive: true }), 'EPERM');
      t.throws(() => fs.trash(p), 'EPERM');
      t.throws(() => fs.rename(p, 'baska'), 'EPERM');
      t.throws(() => fs.move(p, '/tmp'), 'EPERM');
    }
    // alternative spellings of the same paths are protected too
    for (const p of ['/home/panda/', '/home/./panda', '/home/x/../panda', '~', '~/Masaüstü', '/home//panda//Masaüstü/', '/tmp/..']) {
      t.throws(() => fs.remove(p, { recursive: true }), 'EPERM');
      t.throws(() => fs.trash(p), 'EPERM');
    }
    t.ok(!fs.isProtected('/tmp') && !fs.isProtected(HOME + '/Belgeler') && !fs.isProtected(DESK + '/Terminal.app'));
    t.ok(!fs.isProtected('') && !fs.isProtected(null));
    t.ok(fs.isDir('/') && fs.isDir('/home') && fs.isDir(HOME) && fs.isDir(DESK), 'korumalı klasörler yerinde');
    t.eq(fs.trashCount(), 0);
    t.eq(fs.list(DESK).length, 10);

    // but their children can be deleted
    fs.remove(DESK + '/Beni Oku.txt');
    fs.remove(HOME + '/Belgeler', { recursive: true });
    t.ok(!fs.exists(HOME + '/Belgeler'));
    const id = fs.trash(DESK + '/Terminal.app');
    t.ok(!fs.exists(DESK + '/Terminal.app'));
    fs.restore(id);
    t.ok(fs.exists(DESK + '/Terminal.app'));
  });

  // ---------------------------------------------------------------- trash
  PandaTest.test('çöp kutusu: trash, listTrash, restore', (t) => {
    fresh();
    fs.writeFile('/tmp/t1.txt', 'içerik');
    const before = Date.now();
    const id = fs.trash('/tmp/t1.txt');
    t.ok(typeof id === 'string' && id.length > 0);
    t.ok(!fs.exists('/tmp/t1.txt'));
    t.eq(fs.trashCount(), 1);
    const [e] = fs.listTrash();
    t.eq([e.id, e.name, e.type, e.size, e.originalPath], [id, 't1.txt', 'file', 7, '/tmp/t1.txt']);
    t.ok(typeof e.deletedAt === 'number' && e.deletedAt >= before - 1000 && e.deletedAt < Date.now() + 5000);
    t.eq(Object.keys(e).sort(), ['deletedAt', 'id', 'name', 'originalPath', 'size', 'type']);

    t.eq(fs.restore(id), '/tmp/t1.txt');
    t.eq(fs.readFile('/tmp/t1.txt'), 'içerik');
    t.eq(fs.trashCount(), 0);
    t.eq(fs.listTrash(), []);
    t.throws(() => fs.restore(id), 'ENOENT');

    t.throws(() => fs.trash('/tmp/yok'), 'ENOENT');
    t.throws(() => fs.trash(''), 'EINVAL');
    t.throws(() => fs.restore('yok-id'), 'ENOENT');
    t.throws(() => fs.deleteFromTrash('yok-id'), 'ENOENT');
  });

  PandaTest.test('çöp kutusu: en yeni önce, klasörler, aynı yol iki kez', (t) => {
    fresh();
    for (const n of ['a.txt', 'b.txt', 'c.txt']) fs.writeFile('/tmp/' + n, n);
    const ids = ['a.txt', 'b.txt', 'c.txt'].map((n) => fs.trash('/tmp/' + n));
    t.eq(new Set(ids).size, 3, 'kimlikler benzersiz');
    t.eq(fs.listTrash().map((x) => x.name), ['c.txt', 'b.txt', 'a.txt'], 'en yeni önce');
    t.eq(fs.listTrash().map((x) => x.id), ids.slice().reverse());

    // same path trashed twice -> two entries
    fs.writeFile('/tmp/a.txt', 'ikinci');
    fs.trash('/tmp/a.txt');
    t.eq(fs.trashCount(), 4);
    t.eq(fs.listTrash()[0].name, 'a.txt');

    // directory with contents
    fs.mkdir('/tmp/Proje/alt', { recursive: true });
    fs.writeFile('/tmp/Proje/alt/x.txt', 'x');
    fs.writeFile('/tmp/Proje/y.txt', 'yy');
    const did = fs.trash('/tmp/Proje');
    t.ok(!fs.exists('/tmp/Proje'));
    const entry = fs.listTrash().find((x) => x.id === did);
    t.eq([entry.type, entry.size, entry.name], ['dir', 3, 'Proje']);
    t.eq(fs.restore(did), '/tmp/Proje');
    t.eq(fs.readFile('/tmp/Proje/alt/x.txt'), 'x');
    t.eq(fs.stat('/tmp/Proje').size, 3);

    // deleteFromTrash only touches that entry
    const before = fs.trashCount();
    fs.deleteFromTrash(ids[0]);
    t.eq(fs.trashCount(), before - 1);
    t.ok(!fs.listTrash().some((x) => x.id === ids[0]));
    t.ok(!fs.exists('/tmp/a.txt') || fs.readFile('/tmp/a.txt') !== 'a.txt', 'kalıcı silindi');
    fs.emptyTrash();
    t.eq(fs.trashCount(), 0);
    t.eq(fs.listTrash(), []);
    fs.emptyTrash(); // empty trash is fine
    t.eq(fs.trashCount(), 0);
  });

  PandaTest.test('restore: eksik üst klasörleri yeniden oluşturur', (t) => {
    fresh();
    fs.mkdir('/tmp/x/y', { recursive: true });
    fs.writeFile('/tmp/x/y/f.txt', 'derin');
    const id = fs.trash('/tmp/x/y/f.txt');
    fs.remove('/tmp/x', { recursive: true });
    t.ok(!fs.exists('/tmp/x'));
    const rec = record();
    t.eq(fs.restore(id), '/tmp/x/y/f.txt');
    rec.stop();
    t.eq(fs.readFile('/tmp/x/y/f.txt'), 'derin');
    t.ok(fs.isDir('/tmp/x') && fs.isDir('/tmp/x/y'));
    t.eq(rec.events.length, 1);
    t.eq(rec.events[0].type, 'restore');
    for (const p of ['/tmp', '/tmp/x', '/tmp/x/y']) t.ok(rec.events[0].parents.includes(p), `parents: ${p}`);

    // top-level folder missing too
    fs.mkdir('/tmp/q/w/e', { recursive: true });
    fs.writeFile('/tmp/q/w/e/g.txt', 'g');
    const id2 = fs.trash('/tmp/q/w/e/g.txt');
    fs.remove('/tmp/q', { recursive: true });
    t.eq(fs.restore(id2), '/tmp/q/w/e/g.txt');

    // folder trashed, parent removed
    fs.mkdir('/tmp/u/v/klasör', { recursive: true });
    fs.writeFile('/tmp/u/v/klasör/h.txt', 'h');
    const id3 = fs.trash('/tmp/u/v/klasör');
    fs.remove('/tmp/u', { recursive: true });
    t.eq(fs.restore(id3), '/tmp/u/v/klasör');
    t.eq(fs.readFile('/tmp/u/v/klasör/h.txt'), 'h');

    // a deleted desktop file whose parent still exists
    const sid = fs.trash(DESK + '/Ayarlar.app');
    t.eq(fs.restore(sid), DESK + '/Ayarlar.app');
  });

  PandaTest.test('restore: çakışmada uniqueName, engelli üst klasörde HOME’a düşer', (t) => {
    fresh();
    fs.writeFile('/tmp/c.txt', 'eski');
    const id = fs.trash('/tmp/c.txt');
    fs.writeFile('/tmp/c.txt', 'yeni');
    t.eq(fs.restore(id), '/tmp/c (2).txt');
    t.eq(fs.readFile('/tmp/c.txt'), 'yeni');
    t.eq(fs.readFile('/tmp/c (2).txt'), 'eski');

    // second collision continues the numbering
    fs.writeFile('/tmp/c.txt', 'x');
    const id2 = fs.trash('/tmp/c.txt');
    fs.writeFile('/tmp/c.txt', 'y');
    t.eq(fs.restore(id2), '/tmp/c (3).txt');

    // folder collision
    fs.mkdir('/tmp/Yeni Klasör');
    const fid = fs.trash('/tmp/Yeni Klasör');
    fs.mkdir('/tmp/Yeni Klasör');
    t.eq(fs.restore(fid), '/tmp/Yeni Klasör (2)');

    // a FILE took the place of the original folder -> restored into the home folder instead
    fs.mkdir('/tmp/blk');
    fs.writeFile('/tmp/blk/f.txt', 'f');
    const bid = fs.trash('/tmp/blk/f.txt');
    fs.remove('/tmp/blk', { recursive: true });
    fs.writeFile('/tmp/blk', 'ben artık bir dosyayım');
    const restored = fs.restore(bid);
    t.eq(restored, HOME + '/f.txt');
    t.eq(fs.readFile(restored), 'f');
    t.eq(fs.readFile('/tmp/blk'), 'ben artık bir dosyayım');
    t.eq(fs.trashCount(), 0);
  });

  // ---------------------------------------------------------------- uniqueName
  PandaTest.test('uniqueName', (t) => {
    fresh();
    t.eq(fs.uniqueName('/tmp', 'Yeni Klasör'), 'Yeni Klasör');
    fs.mkdir('/tmp/Yeni Klasör');
    t.eq(fs.uniqueName('/tmp', 'Yeni Klasör'), 'Yeni Klasör (2)');
    fs.mkdir('/tmp/Yeni Klasör (2)');
    t.eq(fs.uniqueName('/tmp', 'Yeni Klasör'), 'Yeni Klasör (3)');
    t.eq(fs.uniqueName('/tmp', 'Yeni Klasör (2)'), 'Yeni Klasör (3)', 'mevcut (n) eki katlanmaz');

    fs.writeFile('/tmp/a.txt', '');
    t.eq(fs.uniqueName('/tmp', 'a.txt'), 'a (2).txt');
    fs.writeFile('/tmp/a (2).txt', '');
    t.eq(fs.uniqueName('/tmp', 'a.txt'), 'a (3).txt');
    t.eq(fs.uniqueName('/tmp', 'a (2).txt'), 'a (3).txt');
    t.eq(fs.uniqueName('/tmp', 'b.txt'), 'b.txt', 'boşta olan ad aynen döner');

    fs.writeFile('/tmp/Makefile', '');
    t.eq(fs.uniqueName('/tmp', 'Makefile'), 'Makefile (2)');
    fs.writeFile('/tmp/.gizli', '');
    t.eq(fs.uniqueName('/tmp', '.gizli'), '.gizli (2)');
    fs.writeFile('/tmp/x.tar.gz', '');
    t.eq(fs.uniqueName('/tmp', 'x.tar.gz'), 'x.tar (2).gz');
    fs.writeFile('/tmp/İşlem Ğ.TXT', '');
    t.eq(fs.uniqueName('/tmp', 'İşlem Ğ.TXT'), 'İşlem Ğ (2).TXT');

    t.eq(fs.uniqueName('/yok', 'a.txt'), 'a.txt', 'olmayan klasörde çakışma yok');
    t.eq(fs.uniqueName('/etc/hostname', 'a.txt'), 'a.txt');
    // new-folder workflow
    const n1 = fs.uniqueName(HOME, 'Yeni Klasör');
    fs.mkdir(fs.join(HOME, n1));
    const n2 = fs.uniqueName(HOME, 'Yeni Klasör');
    t.eq([n1, n2], ['Yeni Klasör', 'Yeni Klasör (2)']);
    // never longer than 255
    const long = 'k'.repeat(255);
    fs.writeFile('/tmp/' + long, '');
    const u = fs.uniqueName('/tmp', long);
    t.ok(u.length <= 255 && u.endsWith(' (2)') && u !== long, 'uzun ad kısaltılır');
    fs.writeFile('/tmp/' + u, '');
    t.ok(fs.exists('/tmp/' + u));
  });

  // ---------------------------------------------------------------- search & walk
  PandaTest.test('search: Türkçe büyük/küçük harf duyarsız', (t) => {
    fresh();
    const names = (res) => res.map((s) => s.name);
    const r = fs.search('NOT');
    t.ok(names(r).includes('Notlar.txt'), '"NOT" -> Notlar.txt');
    t.ok(names(r).includes('Not Defteri.app'));
    t.eq(names(fs.search('not')), names(r));
    t.eq(names(fs.search('nOT')), names(r));
    t.ok(r.every((s) => s.path.startsWith(HOME + '/')) && r.every((s) => typeof s.size === 'number' && s.type));
    t.eq(fs.search('notlar')[0].path, HOME + '/Belgeler/Notlar.txt');
    t.eq(names(fs.search('alışveriş')), ['Alışveriş Listesi.txt']);
    t.eq(names(fs.search('ALIŞVERİŞ')), ['Alışveriş Listesi.txt'], 'İ -> i');
    t.eq(names(fs.search('Müzik')).sort(), ['Müzik', 'Müzik Çalar.app']);
    t.eq(names(fs.search('MÜZİK')).sort(), ['Müzik', 'Müzik Çalar.app']);

    fs.writeFile('/tmp/IŞIK.txt', '1');
    fs.writeFile('/tmp/ışık notu.txt', '2');
    fs.writeFile('/tmp/ılık.txt', '3');
    fs.writeFile('/tmp/İŞ.txt', '4');
    fs.writeFile('/tmp/iş.log', '5');
    fs.writeFile('/tmp/Index.txt', '6');
    const inTmp = (q) => names(fs.search(q, { root: '/tmp' })).sort();
    t.eq(inTmp('ışık'), ['IŞIK.txt', 'ışık notu.txt']);
    t.eq(inTmp('IŞIK'), ['IŞIK.txt', 'ışık notu.txt']);
    // Turkish folding gives iş.log + İŞ.txt; the plain-lowercase fallback (which makes 'index' find
    // 'Index.txt') additionally lets the ASCII spelling "iş" match 'IŞIK' (I -> i).
    t.eq(inTmp('iş'), ['IŞIK.txt', 'iş.log', 'İŞ.txt']);
    t.eq(inTmp('İŞ'), ['iş.log', 'İŞ.txt'], 'noktalı İ yalnızca noktalı i ile eşleşir');
    t.eq(inTmp('işl'), [], 'işl hiçbir adda geçmiyor');
    t.eq(inTmp('iş.'), ['iş.log', 'İŞ.txt']);
    t.eq(inTmp('ILIK'), ['ılık.txt'], 'I -> ı');
    t.eq(inTmp('ilik'), [], 'i ile ı ayrı harfler');
    t.eq(inTmp('index'), ['Index.txt'], 'ASCII adlarda i/I de eşleşir');
    t.eq(inTmp('INDEX'), ['Index.txt']);
    t.eq(inTmp('ındex'), ['Index.txt']);
  });

  PandaTest.test('search: sınır, kök, gizli, adla eşleşme, sıralama', (t) => {
    fresh();
    for (let i = 1; i <= 5; i++) fs.writeFile(`${HOME}/lim${i}.txt`, '');
    t.eq(fs.search('lim').length, 5);
    t.eq(fs.search('lim', { limit: 3 }).length, 3);
    t.eq(fs.search('lim', { limit: 0 }), []);
    t.eq(fs.search(''), []);
    t.eq(fs.search(null), []);
    t.eq(fs.search('lim', { root: '/yok' }), []);
    t.eq(fs.search('lim', { root: '/etc/hostname' }), []);

    // default limit 50
    for (let i = 0; i < 60; i++) fs.writeFile(`/tmp/ç${i}.txt`, '');
    t.eq(fs.search('ç', { root: '/tmp' }).length, 50);
    t.eq(fs.search('ç', { root: '/tmp', limit: 100 }).length, 60);

    // root defaults to HOME
    fs.writeFile('/tmp/disarida_zzz.txt', '');
    t.eq(fs.search('disarida_zzz').length, 0);
    t.eq(fs.search('disarida_zzz', { root: '/' }).length, 1);
    t.eq(fs.search('disarida_zzz', { root: '/tmp' }).length, 1);
    t.eq(fs.search('hostname', { root: '/' })[0].path, '/etc/hostname');

    // hidden entries
    fs.writeFile('/tmp/.gizlidosya', '');
    fs.mkdir('/tmp/.hd');
    fs.writeFile('/tmp/.hd/icerde_x.txt', '');
    t.eq(fs.search('gizlidosya', { root: '/tmp' }).length, 0);
    t.eq(fs.search('gizlidosya', { root: '/tmp', hidden: true }).length, 1);
    t.eq(fs.search('icerde_x', { root: '/tmp' }).length, 0, 'gizli klasörün içine girilmez');
    t.eq(fs.search('icerde_x', { root: '/tmp', hidden: true }).length, 1);

    // only names match, not the path
    const res = fs.search('Belgeler');
    t.ok(res.length >= 1 && res.every((s) => s.name.toLocaleLowerCase('tr').includes('belgeler')), 'yalnızca ad eşleşir');
    t.ok(!res.some((s) => s.name === 'Notlar.txt'));

    // ranking: exact < prefix < contains
    fs.writeFile('/tmp/zz-abc.txt', '');
    fs.writeFile('/tmp/abcdef.txt', '');
    fs.writeFile('/tmp/abc.txt', '');
    t.eq(fs.search('abc', { root: '/tmp' }).map((s) => s.name), ['abc.txt', 'abcdef.txt', 'zz-abc.txt']);
    // folders are searchable too
    t.eq(fs.search('Projeler')[0].type, 'dir');
  });

  PandaTest.test('walk: derinlik öncelikli, false alt ağacı atlar', (t) => {
    fresh();
    const seen = [];
    fs.walk(HOME + '/Belgeler', (s) => { seen.push(s.path); });
    t.eq(seen, [
      HOME + '/Belgeler/Projeler',
      HOME + '/Belgeler/Projeler/PandaOS Fikirleri.md',
      HOME + '/Belgeler/Alışveriş Listesi.txt',
      HOME + '/Belgeler/Notlar.txt'
    ]);

    const skipped = [];
    fs.walk(HOME + '/Belgeler', (s) => { skipped.push(s.name); return s.name === 'Projeler' ? false : undefined; });
    t.eq(skipped, ['Projeler', 'Alışveriş Listesi.txt', 'Notlar.txt']);

    fs.writeFile(HOME + '/Belgeler/.gizli', '');
    const all = [];
    fs.walk(HOME + '/Belgeler', (s) => { all.push(s.name); });
    t.ok(all.includes('.gizli'), 'walk gizli dosyaları da gezer');

    // the start folder itself is not reported; stats have the full shape
    fs.walk('/etc', (s) => { t.ok(s.path !== '/etc' && s.type && typeof s.size === 'number'); });
    // callbacks may delete things while walking
    fs.mkdir('/tmp/w');
    for (const n of ['1', '2', '3']) fs.writeFile('/tmp/w/' + n, n);
    const visited = [];
    fs.walk('/tmp/w', (s) => { visited.push(s.name); if (s.name === '1') fs.remove('/tmp/w/2'); });
    t.eq(visited, ['1', '3']);

    t.throws(() => fs.walk('/yok', () => {}), 'ENOENT');
    t.throws(() => fs.walk('/etc/hostname', () => {}), 'ENOTDIR');
    let threw = false;
    try { fs.walk('/etc'); } catch (e) { threw = e instanceof TypeError; }
    t.ok(threw, 'işlev yoksa TypeError');
    let count = 0;
    fs.walk('/', () => { count++; });
    t.ok(count > 30, 'tüm ağaç gezilir');
  });

  // ---------------------------------------------------------------- usage
  PandaTest.test('usage', (t) => {
    fresh();
    const u0 = fs.usage();
    t.eq(u0.quota, 5 * 1024 * 1024);
    t.eq(u0.used, stored().length + RAW.length, 'used = depolanan belgenin uzunluğu');
    fs.writeFile('/tmp/buyuk.txt', 'x'.repeat(100000));
    const u1 = fs.usage();
    t.ok(u1.used >= u0.used + 100000 && u1.used < u0.used + 101000, 'yazınca artar');
    t.eq(u1.used, stored().length + RAW.length);
    fs.remove('/tmp/buyuk.txt');
    t.ok(fs.usage().used < u1.used - 99000, 'silince azalır');
    fs.writeFile('/tmp/k.txt', 'ışık');
    const id = fs.trash('/tmp/k.txt');
    t.ok(fs.usage().used > 0 && fs.usage().used === stored().length + RAW.length, 'çöp de sayılır');
    fs.deleteFromTrash(id);
  });

  // ---------------------------------------------------------------- persistence
  PandaTest.test('kalıcılık: _reload() sonrası her şey yerinde', (t) => {
    fresh();
    fs.mkdir('/tmp/kalici/alt', { recursive: true });
    fs.writeFile('/tmp/kalici/alt/dosya.txt', 'kalıcı içerik ığüşöç');
    fs.writeFile('/tmp/__proto__x', 'p');
    fs.writeFile('/tmp/silinecek.txt', 'çöpe');
    const tid = fs.trash('/tmp/silinecek.txt');
    const dirStat = fs.stat('/tmp/kalici');
    const fileStat = fs.stat('/tmp/kalici/alt/dosya.txt');
    const trashBefore = fs.listTrash();
    const dumpBefore = dump();

    const doc = PandaOS.storage.get('fs');
    t.ok(doc && doc.root && doc.root.t === 'd' && Array.isArray(doc.trash), 'belge storage’da');

    fs._reload();
    t.eq(fs.readFile('/tmp/kalici/alt/dosya.txt'), 'kalıcı içerik ığüşöç');
    t.eq(fs.stat('/tmp/kalici'), dirStat);
    t.eq(fs.stat('/tmp/kalici/alt/dosya.txt'), fileStat, 'zaman damgaları korunur');
    t.eq(fs.listTrash(), trashBefore, 'çöp kutusu yeniden yüklemeden sağ çıkar');
    t.eq(dump(), dumpBefore);
    t.eq(fs.restore(tid), '/tmp/silinecek.txt');
    t.eq(fs.readFile('/tmp/silinecek.txt'), 'çöpe');

    // init() is idempotent: nothing changes, nothing is emitted
    const rec = record();
    const d1 = dump();
    fs.init();
    fs.init();
    rec.stop();
    t.eq(dump(), d1);
    t.eq(rec.events.length, 0);
    // survives a full cycle through JSON text (as in a real page reload)
    const text = stored();
    localStorage.setItem(RAW, text);
    fs._reload();
    t.eq(dump(), d1);
  });

  PandaTest.test('bozuk veri: yedeklenir ve yeniden tohumlanır', (t) => {
    fresh();
    fs.writeFile('/tmp/eski.txt', 'önemli');
    // 1) unparseable text
    localStorage.setItem(RAW, '{bozuk json ');
    fs._reload();
    t.ok(fs.exists('/etc/hostname') && !fs.exists('/tmp/eski.txt'), 'varsayılan ağaç geri geldi');
    const backup = PandaOS.storage.get('fs.corrupt');
    t.ok(backup && backup.raw === '{bozuk json ' && typeof backup.at === 'number', 'bozuk veri fs.corrupt’a yedeklendi');
    t.ok(PandaOS.storage.get('fs') && PandaOS.storage.get('fs').root, 'storage yeniden geçerli');
    fs.writeFile('/tmp/yeni.txt', 'çalışıyor');
    fs._reload();
    t.eq(fs.readFile('/tmp/yeni.txt'), 'çalışıyor');

    // 2) valid JSON, wrong structure
    const bad = [
      '{"v":1,"root":{"t":"f","c":1,"m":1,"d":"x"},"trash":[]}',
      '{"v":2,"root":{"t":"d","c":1,"m":1,"k":{}},"trash":[]}',
      '{"v":1,"root":{"t":"d","c":1,"m":1,"k":{"a":{"t":"f","c":1,"m":1}}},"trash":[]}',
      '{"v":1,"root":{"t":"d","c":1,"m":1,"k":{"a/b":{"t":"d","c":1,"m":1,"k":{}}}},"trash":[]}',
      '{"v":1,"root":{"t":"d","c":1,"m":1,"k":{"home":{"t":"f","c":1,"m":1,"d":"x"}}},"trash":[]}',
      '[1,2,3]', 'null', '"bir metin"', '42'
    ];
    for (const raw of bad) {
      PandaOS.storage.remove('fs.corrupt');
      localStorage.setItem(RAW, raw);
      fs._reload();
      t.ok(fs.exists('/etc/hostname') && fs.isDir(DESK), 'onarıldı: ' + raw.slice(0, 40));
      const b = PandaOS.storage.get('fs.corrupt');
      t.ok(b && typeof b.raw === 'string' && b.raw.length > 0, 'yedek var: ' + raw.slice(0, 40));
      t.eq(b.raw, raw === '"bir metin"' ? raw : raw, 'yedek aynen');
    }
    PandaOS.notify?.clear?.();
  });

  PandaTest.test('kendi kendini onarım: eksik sistem klasörleri, bozuk çöp girdileri', (t) => {
    fresh();
    fs.writeFile('/tmp/kalsin.txt', 'k');
    const doc = JSON.parse(stored());
    delete doc.root.k.home.k.panda.k['Masaüstü'];
    doc.trash = [
      { id: 'iyi', name: 'cop.txt', originalPath: '/tmp/cop.txt', deletedAt: 5, node: { t: 'f', c: 1, m: 1, d: 'cc' } },
      { id: 'bozuk1', name: 'x', originalPath: 'goreli', deletedAt: 1, node: { t: 'f', c: 1, m: 1, d: '' } },
      { id: 'bozuk2', name: 'y', originalPath: '/tmp/y', deletedAt: 1, node: { t: 'f' } },
      { name: 'z' }, null, 7
    ];
    localStorage.setItem(RAW, JSON.stringify(doc));
    fs._reload();
    t.ok(fs.isDir(DESK), 'Masaüstü yeniden oluşturuldu');
    t.eq(fs.readFile('/tmp/kalsin.txt'), 'k', 'diğer veriler korunur');
    t.eq(fs.listTrash().map((e) => e.id), ['iyi'], 'bozuk çöp girdileri atılır');
    t.ok(!PandaOS.storage.get('fs.corrupt'), 'bu bir bozulma sayılmaz');
    t.eq(fs.restore('iyi'), '/tmp/cop.txt');
  });

  PandaTest.test('başka sekme değişikliği (storage olayı) -> external', (t) => {
    fresh();
    fs.writeFile('/tmp/yerel.txt', 'yerel');
    const doc = JSON.parse(stored());
    const ts = Date.now();
    doc.root.k.tmp.k['uzak.txt'] = { t: 'f', c: ts, m: ts, d: 'başka sekmeden' };
    delete doc.root.k.tmp.k['yerel.txt'];
    localStorage.setItem(RAW, JSON.stringify(doc));

    const rec = record();
    window.dispatchEvent(new StorageEvent('storage', { key: 'pandaos.settings' }));
    t.eq(rec.events.length, 0, 'ilgisiz anahtar yok sayılır');
    t.ok(fs.exists('/tmp/yerel.txt'), 'henüz yüklenmedi');
    window.dispatchEvent(new StorageEvent('storage', { key: RAW, newValue: stored() }));
    rec.stop();
    t.eq(fs.readFile('/tmp/uzak.txt'), 'başka sekmeden');
    t.ok(!fs.exists('/tmp/yerel.txt'));
    t.eq(rec.events.length, 1);
    t.eq(rec.events[0].type, 'external');
    t.ok(Array.isArray(rec.events[0].parents));

    // the other tab cleared storage -> factory tree again
    localStorage.removeItem(RAW);
    window.dispatchEvent(new StorageEvent('storage', { key: RAW, newValue: null }));
    t.ok(fs.exists('/etc/hostname') && !fs.exists('/tmp/uzak.txt'));
    t.ok(PandaOS.storage.get('fs'), 'tohum yeniden yazıldı');
  });

  // ---------------------------------------------------------------- events
  PandaTest.test('fs:change olayları: tür, yol ve parents', (t) => {
    fresh();
    const rec = record();
    const last = () => rec.events[rec.events.length - 1];
    const count = () => rec.events.length;

    fs.mkdir('/tmp/e1');
    expectEvent(t, last(), { type: 'mkdir', path: '/tmp/e1', parents: ['/tmp'] });
    fs.mkdir('/tmp/e2/f/g', { recursive: true });
    expectEvent(t, last(), { type: 'mkdir', path: '/tmp/e2/f/g', parents: ['/tmp', '/tmp/e2', '/tmp/e2/f'] });
    fs.writeFile('/tmp/e1/a.txt', '1');
    expectEvent(t, last(), { type: 'create', path: '/tmp/e1/a.txt', parents: ['/tmp/e1'] });
    fs.writeFile('/tmp/e1/a.txt', '2');
    expectEvent(t, last(), { type: 'write', path: '/tmp/e1/a.txt', parents: ['/tmp/e1'] });
    fs.appendFile('/tmp/e1/a.txt', '3');
    expectEvent(t, last(), { type: 'write', path: '/tmp/e1/a.txt', parents: ['/tmp/e1'] });
    fs.appendFile('/tmp/e1/n.txt', 'x');
    expectEvent(t, last(), { type: 'create', path: '/tmp/e1/n.txt', parents: ['/tmp/e1'] });
    fs.rename('/tmp/e1/a.txt', 'b.txt');
    expectEvent(t, last(), { type: 'rename', path: '/tmp/e1/b.txt', oldPath: '/tmp/e1/a.txt', parents: ['/tmp/e1'] });
    fs.move('/tmp/e1/b.txt', '/tmp/e2');
    expectEvent(t, last(), { type: 'move', path: '/tmp/e2/b.txt', oldPath: '/tmp/e1/b.txt', parents: ['/tmp/e1', '/tmp/e2'] });
    fs.copy('/tmp/e2/b.txt', '/tmp/e1');
    expectEvent(t, last(), { type: 'copy', path: '/tmp/e1/b.txt', oldPath: '/tmp/e2/b.txt', parents: ['/tmp/e1'] });
    fs.remove('/tmp/e1/b.txt');
    expectEvent(t, last(), { type: 'delete', path: '/tmp/e1/b.txt', parents: ['/tmp/e1'] });
    fs.remove('/tmp/e2/f', { recursive: true });
    expectEvent(t, last(), { type: 'delete', path: '/tmp/e2/f', parents: ['/tmp/e2'] });

    const id = fs.trash('/tmp/e2/b.txt');
    expectEvent(t, last(), { type: 'trash', path: '/tmp/e2/b.txt', parents: ['/tmp/e2'] });
    fs.restore(id);
    expectEvent(t, last(), { type: 'restore', path: '/tmp/e2/b.txt', oldPath: '/tmp/e2/b.txt', parents: ['/tmp/e2'] });
    const id2 = fs.trash('/tmp/e2/b.txt');
    fs.writeFile('/tmp/e2/b.txt', 'yeni');
    fs.restore(id2);
    expectEvent(t, last(), { type: 'restore', path: '/tmp/e2/b (2).txt', oldPath: '/tmp/e2/b.txt', parents: ['/tmp/e2'] });
    const id3 = fs.trash('/tmp/e2/b (2).txt');
    fs.deleteFromTrash(id3);
    expectEvent(t, last(), { type: 'trashDelete', path: '/tmp/e2/b (2).txt', parents: [] });
    fs.trash('/tmp/e2/b.txt');
    fs.emptyTrash();
    t.eq(last().type, 'emptyTrash');
    t.eq(last().parents, []);

    // nothing happened -> no events
    const n = count();
    fs.emptyTrash();
    fs.mkdir('/tmp/e1', { recursive: true });
    fs.rename('/tmp/e1/n.txt', 'n.txt');
    fs.move('/tmp/e1/n.txt', '/tmp/e1');
    for (const f of [
      () => fs.mkdir('/tmp/e1'), () => fs.readFile('/yok'), () => fs.writeFile('/tmp', 'x'), () => fs.remove('/tmp'),
      () => fs.remove('/yok'), () => fs.trash('/yok'), () => fs.copy('/yok', '/tmp'), () => fs.rename('/tmp/e1', '/')
    ]) { try { f(); } catch (e) { /* expected */ } }
    t.eq(count(), n, 'başarısız/etkisiz işlemler olay üretmez');

    fs.reset();
    expectEvent(t, last(), { type: 'reset', path: '/', parents: ['/'] });
    rec.stop();
    for (const e of rec.events) t.ok(Array.isArray(e.parents) && typeof e.path === 'string' && e.type, 'olay şekli');
  });

  PandaTest.test('olaylar yalnızca kayıttan sonra gelir ve dinleyici hatası fs’i bozmaz', (t) => {
    fresh();
    let sawFile = null;
    const off = PandaOS.bus.on('fs:change', (e) => { if (e.type === 'create') sawFile = fs.exists(e.path) && fs.readFile(e.path); });
    fs.writeFile('/tmp/olay.txt', 'görüldü');
    off();
    t.eq(sawFile, 'görüldü', 'dinleyici güncel durumu görür');
    // a listener that mutates the fs re-entrantly
    let once = true;
    const off2 = PandaOS.bus.on('fs:change', (e) => {
      if (once && e.type === 'mkdir') { once = false; fs.writeFile('/tmp/tepki.txt', 'tepki'); }
    });
    fs.mkdir('/tmp/tetik');
    off2();
    t.eq(fs.readFile('/tmp/tepki.txt'), 'tepki');
    t.ok(fs.isDir('/tmp/tetik'));
  });

  // ---------------------------------------------------------------- ENOSPC
  function expectNoSpace(t, fn) {
    const e = t.throws(fn, 'ENOSPC');
    t.ok(e instanceof fs.FSError && /Depolama/.test(e.message), 'Türkçe ENOSPC mesajı: ' + e.message);
  }

  PandaTest.test('ENOSPC: storage.set false/throw -> geri alma, olay yok', (t) => {
    fresh();
    fs.mkdir('/tmp/dolu/alt', { recursive: true });
    fs.writeFile('/tmp/dolu/alt/a.txt', 'a');
    fs.writeFile('/tmp/dolu/b.txt', 'b');
    fs.writeFile('/tmp/c.txt', 'c');
    const trashId = fs.trash('/tmp/c.txt');
    fs.writeFile('/tmp/d.txt', 'd');
    const trashId2 = fs.trash('/tmp/d.txt');
    const memBefore = dump();
    const storedBefore = stored();
    const origSet = PandaOS.storage.set;
    const rec = record();
    const modes = {
      false: () => false,
      throw: () => { throw new Error('QuotaExceededError (simülasyon)'); }
    };
    try {
      for (const [mode, impl] of Object.entries(modes)) {
        PandaOS.storage.set = impl;
        const ops = [
          ['writeFile (yeni)', () => fs.writeFile('/tmp/yeni.txt', 'x')],
          ['writeFile (üzerine)', () => fs.writeFile('/tmp/dolu/b.txt', 'değişti')],
          ['appendFile', () => fs.appendFile('/tmp/dolu/b.txt', 'ek')],
          ['mkdir', () => fs.mkdir('/tmp/yeniklasor')],
          ['mkdir -p', () => fs.mkdir('/tmp/p/q/r', { recursive: true })],
          ['rename', () => fs.rename('/tmp/dolu/b.txt', 'baska.txt')],
          ['move', () => fs.move('/tmp/dolu/b.txt', '/etc')],
          ['copy', () => fs.copy('/tmp/dolu', '/tmp')],
          ['remove', () => fs.remove('/tmp/dolu', { recursive: true })],
          ['trash', () => fs.trash('/tmp/dolu/b.txt')],
          ['restore', () => fs.restore(trashId)],
          ['deleteFromTrash', () => fs.deleteFromTrash(trashId)],
          ['emptyTrash', () => fs.emptyTrash()],
          ['reset', () => fs.reset()]
        ];
        for (const [name, op] of ops) {
          expectNoSpace(t, op);
          t.eq(dump(), memBefore, `${mode}/${name}: bellekteki durum değişmedi`);
          t.ok(stored() === storedBefore, `${mode}/${name}: depolama değişmedi`);
        }
        t.eq(rec.events.length, 0, `${mode}: hiç olay yok`);
      }
    } finally {
      PandaOS.storage.set = origSet;
      rec.stop();
    }
    // everything still works afterwards
    t.eq(fs.trashCount(), 2);
    t.eq(fs.restore(trashId), '/tmp/c.txt');
    fs.deleteFromTrash(trashId2);
    fs.writeFile('/tmp/dolu/b.txt', 'şimdi oldu');
    t.eq(fs.readFile('/tmp/dolu/b.txt'), 'şimdi oldu');
    t.ok(!fs.exists('/tmp/yeni.txt') && !fs.exists('/tmp/p'));
  });

  PandaTest.test('ENOSPC: gerçek kota dolunca durum değişmeden kalır', (t) => {
    fresh();
    fs.writeFile('/tmp/onceki.txt', 'önceki');
    const chunk = 'x'.repeat(1024 * 1024);
    let failedAt = -1;
    let snapshot = null;
    try {
      for (let i = 0; i < 24; i++) {
        snapshot = dump();
        try {
          fs.writeFile(`/tmp/buyuk${i}.txt`, chunk);
        } catch (e) {
          t.eq(e.code, 'ENOSPC', 'yalnızca ENOSPC beklenir: ' + e.message);
          failedAt = i;
          break;
        }
      }
      t.ok(failedAt > 0 && failedAt < 24, 'kota dolmalı (en az bir parça sığmalı)');
      t.eq(dump(), snapshot, 'başarısız yazma hiçbir iz bırakmadı');
      t.ok(!fs.exists(`/tmp/buyuk${failedAt}.txt`));
      t.eq(fs.readFile('/tmp/onceki.txt'), 'önceki');
      t.eq(fs.readFile(`/tmp/buyuk${failedAt - 1}.txt`).length, chunk.length);
      // an in-place overwrite that grows the file also fails cleanly
      const sizeBefore = fs.stat(`/tmp/buyuk0.txt`).size;
      let grew = false;
      try { fs.writeFile('/tmp/buyuk0.txt', chunk + chunk + chunk); grew = true; } catch (e) { t.eq(e.code, 'ENOSPC'); }
      if (!grew) t.eq(fs.stat('/tmp/buyuk0.txt').size, sizeBefore, 'büyütme başarısızsa eski içerik kalır');
    } finally {
      fs.remove('/tmp', { recursive: true });
      fs.mkdir('/tmp');
    }
    fs.writeFile('/tmp/sonra.txt', 'yer açıldı');
    t.eq(fs.readFile('/tmp/sonra.txt'), 'yer açıldı', 'yer açılınca yazma yine çalışır');
    t.eq(fs.usage().used, stored().length + RAW.length);
  });

  PandaTest.test('depolama hiç yoksa bellekte çalışmaya devam eder', (t) => {
    fresh();
    fs.writeFile('/tmp/kalici-degil.txt', 'önce');
    const origSet = PandaOS.storage.set;
    const origWarn = console.warn;
    const warnings = [];
    console.warn = (...a) => warnings.push(a.join(' '));
    try {
      PandaOS.storage.set = () => false;
      localStorage.removeItem(RAW);
      fs._reload(); // first run with unusable storage
      t.ok(fs.exists('/etc/hostname'), 'tohum bellekte');
      t.ok(warnings.some((w) => w.includes('[fs]')), 'uyarı verildi');
      fs.writeFile('/tmp/bellek.txt', 'yalnızca bellekte'); // must not throw
      t.eq(fs.readFile('/tmp/bellek.txt'), 'yalnızca bellekte');
      fs.init(); // must not discard the memory-only copy
      t.eq(fs.readFile('/tmp/bellek.txt'), 'yalnızca bellekte');
    } finally {
      PandaOS.storage.set = origSet;
      console.warn = origWarn;
    }
    fs.writeFile('/tmp/geri-geldi.txt', 'depolama döndü');
    fs._reload();
    t.eq(fs.readFile('/tmp/geri-geldi.txt'), 'depolama döndü', 'depolama dönünce kalıcılık sürer');
    t.eq(fs.readFile('/tmp/bellek.txt'), 'yalnızca bellekte', 'bellekteki her şey birlikte yazıldı');
    // now that storage works again, quota errors are real errors again
    PandaOS.storage.set = () => false;
    try { expectNoSpace(t, () => fs.writeFile('/tmp/x.txt', 'x')); } finally { PandaOS.storage.set = origSet; }
  });

  // ---------------------------------------------------------------- misc
  PandaTest.test('reset: fabrika durumuna döner', (t) => {
    fresh();
    fs.writeFile('/tmp/ozel.txt', 'x');
    fs.writeFile(DESK + '/Beni Oku.txt', 'değiştirildi');
    fs.remove(HOME + '/Belgeler', { recursive: true });
    fs.trash(DESK + '/Terminal.app');
    t.eq(fs.trashCount(), 1);
    const rec = record();
    fs.reset();
    rec.stop();
    t.ok(!fs.exists('/tmp/ozel.txt') && fs.isDir(HOME + '/Belgeler'));
    t.ok(fs.readFile(DESK + '/Beni Oku.txt').startsWith("PandaOS'a Hoş Geldin!"));
    t.eq(fs.trashCount(), 0);
    t.ok(fs.exists(DESK + '/Terminal.app'));
    t.eq(rec.events.length, 1);
    t.eq(rec.events[0].type, 'reset');
    t.eq(JSON.parse(stored()).trash, []);
  });

  PandaTest.test('FSError: sınıf, kod ve Türkçe mesajlar', (t) => {
    const e = new fs.FSError('EPERM', 'deneme');
    t.ok(e instanceof Error && e instanceof fs.FSError);
    t.eq([e.code, e.message, e.name], ['EPERM', 'deneme', 'FSError']);

    fresh();
    const enoent = t.throws(() => fs.readFile('/yok/dosya'), 'ENOENT');
    t.eq(enoent.message, 'Böyle bir dosya ya da dizin yok: /yok/dosya');
    t.ok(enoent instanceof fs.FSError && enoent.path === '/yok/dosya');
    const cases = {
      EEXIST: () => fs.mkdir('/tmp'),
      ENOTDIR: () => fs.list('/etc/hostname'),
      EISDIR: () => fs.readFile('/tmp'),
      ENOTEMPTY: () => fs.remove(HOME),
      EINVAL: () => fs.rename('/etc/hostname', 'a/b'),
      EPERM: () => fs.remove('/')
    };
    cases.ENOTEMPTY = () => { fs.mkdir('/tmp/dolu'); fs.writeFile('/tmp/dolu/x', ''); fs.remove('/tmp/dolu'); };
    for (const [code, fn] of Object.entries(cases)) {
      const err = t.throws(fn, code);
      t.ok(err instanceof fs.FSError && typeof err.message === 'string' && err.message.length > 8, code + ' mesajı');
      t.ok(/[a-zçğıöşü]/i.test(err.message) && !/^E[A-Z]+$/.test(err.message), code + ' Türkçe mesaj: ' + err.message);
    }
    t.ok(/korumalı/.test(t.throws(() => fs.remove('/'), 'EPERM').message));
    t.ok(/kendi içine/.test(t.throws(() => fs.move(HOME + '/Belgeler', HOME + '/Belgeler/Projeler'), 'EINVAL').message));
    t.ok(/boş/.test(t.throws(() => fs.rename('/tmp/dolu', ''), 'EINVAL').message), 'boş ad mesajı');
  });

  PandaTest.test('PandaOS.fs yüzeyi sözleşmeyle uyumlu', (t) => {
    const names = ['init', 'reset', 'normalize', 'join', 'dirname', 'basename', 'extname', 'stem', 'displayName', 'exists',
      'isDir', 'isFile', 'stat', 'list', 'readFile', 'search', 'walk', 'usage', 'writeFile', 'appendFile', 'mkdir', 'rename',
      'move', 'copy', 'remove', 'uniqueName', 'trash', 'listTrash', 'restore', 'deleteFromTrash', 'emptyTrash', 'trashCount'];
    for (const n of names) t.eq(typeof fs[n], 'function', n);
    t.eq(typeof fs.FSError, 'function');
    t.eq(typeof fs._reload, 'function');
    t.eq(fs.HOME, '/home/panda');
    // the kernel's file opening relies on these working on seeded data
    t.ok(PandaOS.apps.forExtension && fs.extname(DESK + '/Terminal.app') === '.app');
  });

  // ---------------------------------------------------------------- fuzz
  function checkInvariants(t, label) {
    const all = [];
    fs.walk('/', (s) => { all.push(s); });
    const rootEntries = fs.list('/', { hidden: true });
    t.eq(fs.stat('/').childCount, rootEntries.length, label + ': kök childCount');
    for (const s of [fs.stat('/')].concat(all)) {
      t.ok(typeof s.created === 'number' && typeof s.modified === 'number' && s.modified >= s.created, `${label}: damga ${s.path}`);
      if (s.type === 'dir') {
        const kids = fs.list(s.path, { hidden: true });
        t.eq(s.childCount, kids.length, `${label}: childCount ${s.path}`);
        t.eq(s.size, kids.reduce((a, k) => a + k.size, 0), `${label}: boyut ${s.path}`);
        const firstFile = kids.findIndex((k) => k.type === 'file');
        t.ok(firstFile === -1 || kids.slice(firstFile).every((k) => k.type === 'file'), `${label}: klasörler önce ${s.path}`);
      } else {
        t.eq(s.size, utf8(fs.readFile(s.path)), `${label}: dosya boyutu ${s.path}`);
      }
    }
    for (const p of ['/', '/home', HOME, DESK]) t.ok(fs.isDir(p), `${label}: korumalı ${p} yok olmuş`);
    const ids = fs.listTrash().map((e) => e.id);
    t.eq(new Set(ids).size, ids.length, `${label}: çöp kimlikleri benzersiz`);
    t.eq(fs.trashCount(), ids.length);
  }

  PandaTest.test('rastgele işlem dizisi (fuzz): atomiklik, kalıcılık, tutarlılık, ENOSPC', (t) => {
    fresh();
    fs.mkdir('/tmp/fz');
    let seed = 20240607;
    const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    const names = ['a', 'b', 'c', 'Ş ö', 'a (2)', 'x.txt', 'y.txt', 'z.md', 'ğ', 'a (kopya)'];
    const origSet = PandaOS.storage.set;
    const stats = { ok: 0, failed: 0, nospc: 0, codes: new Set() };
    const OPS = ['mkdir', 'mkdirp', 'write', 'write', 'append', 'rename', 'move', 'copy', 'copy', 'remove', 'removeR',
      'trash', 'trash', 'restore', 'restore', 'delTrash', 'emptyTrash'];

    for (let i = 0; i < 450; i++) {
      const paths = [];
      fs.walk('/tmp/fz', (s) => { paths.push(s.path); });
      const dirs = ['/tmp/fz'].concat(paths.filter((p) => fs.isDir(p)));
      let op = pick(OPS);
      if (!paths.length && ['rename', 'move', 'copy', 'remove', 'removeR', 'trash'].includes(op)) op = 'write'; // never touch /tmp/fz itself
      const any = paths.length ? paths : dirs;
      const broken = rand() < 0.12;
      const before = dump();
      const run = () => {
        switch (op) {
          case 'mkdir': return fs.mkdir(fs.join(pick(dirs), pick(names)));
          case 'mkdirp': return fs.mkdir(fs.join(pick(dirs), pick(names), pick(names)), { recursive: true });
          case 'write': return fs.writeFile(fs.join(pick(dirs), pick(names)), 'içerik ' + i + ' ığü');
          case 'append': return fs.appendFile(fs.join(pick(dirs), pick(names)), '+' + i);
          case 'rename': return fs.rename(pick(any), pick(names));
          case 'move': return fs.move(pick(any), pick(dirs));
          case 'copy': return fs.copy(pick(any), pick(dirs));
          case 'remove': return fs.remove(pick(any));
          case 'removeR': return fs.remove(pick(any), { recursive: true });
          case 'trash': return fs.trash(pick(any));
          case 'restore': { const tr = fs.listTrash(); return tr.length ? fs.restore(pick(tr).id) : undefined; }
          case 'delTrash': { const tr = fs.listTrash(); return tr.length ? fs.deleteFromTrash(pick(tr).id) : undefined; }
          default: return rand() < 0.15 ? fs.emptyTrash() : undefined;
        }
      };
      let error = null;
      if (broken) PandaOS.storage.set = () => false;
      try { run(); } catch (e) { error = e; } finally { PandaOS.storage.set = origSet; }
      const label = `#${i} ${op}${broken ? ' (kota dolu)' : ''}`;

      if (error) {
        t.ok(error instanceof fs.FSError, `${label}: beklenmeyen hata: ${error && error.stack}`);
        stats.failed++;
        stats.codes.add(error.code);
        if (error.code === 'ENOSPC') stats.nospc++;
        t.eq(dump(), before, `${label}: hata (${error.code}) sonrası durum değişmemeli`);
      } else {
        stats.ok++;
        if (broken) t.eq(dump(), before, `${label}: kota doluyken hata vermeden değişiklik yapıldı`);
      }
      const now = dump();
      fs._reload();
      t.eq(dump(), now, `${label}: yeniden yükleme aynı durumu vermeli`);
      if (i % 10 === 0) checkInvariants(t, label);
    }
    checkInvariants(t, 'son');
    t.ok(stats.ok > 150, 'işlemlerin büyük kısmı başarılı olmalı: ' + stats.ok);
    t.ok(stats.failed > 30 && stats.nospc > 5, `hata yolları da denendi: ${stats.failed} / ENOSPC ${stats.nospc}`);
    for (const code of ['EEXIST', 'EINVAL', 'ENOTEMPTY']) t.ok(stats.codes.has(code), 'görülen hata kodu: ' + code);
    fs.remove('/tmp/fz', { recursive: true });
    fs.emptyTrash();
  });


  // ---- review fix: decomposed (NFD) names stay reachable ------------------------------------------------------------
  PandaTest.test('NFD (ayrışık) adlar: rename / uniqueName NFC\'ye çevirir, dosya erişilebilir kalır', (t) => {
    fs.mkdir('/tmp/nfd', { recursive: true });
    fs.writeFile('/tmp/nfd/a.txt', 'x');
    const nfd = 's\u0327.txt'; // "ş" typed as s + combining cedilla (macOS Finder, some IMEs)
    const np = fs.rename('/tmp/nfd/a.txt', nfd);
    t.eq(np, '/tmp/nfd/\u015f.txt', 'rename NFC yol döndürür');
    t.ok(fs.exists(np) && fs.exists('/tmp/nfd/' + nfd), 'her iki yazımla da bulunur');
    t.eq(fs.list('/tmp/nfd').map((s) => s.name), ['\u015f.txt'], 'listelenen ad NFC');
    t.eq(fs.readFile(fs.list('/tmp/nfd')[0].path), 'x');
    t.ok(fs.uniqueName('/tmp/nfd', 'o\u0308.txt') === '\u00f6.txt', 'uniqueName NFC döndürür');
    t.eq(fs.uniqueName('/tmp/nfd', nfd), '\u015f (2).txt', 'çakışma NFC üzerinden bulunur');
    const id = fs.trash(fs.list('/tmp/nfd')[0].path);
    t.ok(!fs.exists('/tmp/nfd/\u015f.txt'));
    t.eq(fs.restore(id), '/tmp/nfd/\u015f.txt');
    t.throws(() => fs.rename('/tmp/nfd/\u015f.txt', null), 'EINVAL');
    fs.remove('/tmp/nfd', { recursive: true });
  });
  PandaTest.test('temizlik: fabrika durumu', (t) => {
    fs.reset();
    PandaOS.storage.remove('fs.corrupt');
    t.ok(fs.exists('/etc/hostname') && fs.trashCount() === 0);
  });
})();
