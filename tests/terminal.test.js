/* Terminal tests. Run: bash tools/test.sh terminal
   Katman 1: saf kabuk çekirdeği (PandaOS.apps.get('terminal')._shell) — shell.capture(...) ile
   Katman 2: gerçek arayüz (yaz + Enter, Tab, geçmiş, yapıştır, Ctrl+C ...) */
(function () {
  'use strict';

  const P = window.PandaOS;
  const T = window.PandaTest;
  const fs = P.fs;
  const S = () => P.apps.get('terminal')._shell;

  // başka uygulamalara bağımlı olmamak için küçük bir test uygulaması
  P.apps.register({
    id: 'termtest', name: 'Terminal Testi', icon: 'terminal', category: 'utilities', showInStartMenu: false, description: 'Terminal testleri için',
    window: { width: 320, height: 220 },
    launch(win) { win.body.textContent = 'termtest'; }
  });

  // ------------------------------------------------------------------ yardımcılar
  let seq = 0;
  /** /tmp altında geçici bir çalışma klasörü; test sonunda silinir. */
  function sandbox(files) {
    const dir = `/tmp/tt-${Date.now().toString(36)}-${++seq}`;
    fs.mkdir(dir);
    for (const [name, content] of Object.entries(files || {})) {
      if (content === null) fs.mkdir(`${dir}/${name}`, { recursive: true });
      else {
        const parent = fs.dirname(`${dir}/${name}`);
        if (!fs.exists(parent)) fs.mkdir(parent, { recursive: true });
        fs.writeFile(`${dir}/${name}`, content);
      }
    }
    return dir;
  }
  const cleanup = (dir) => { try { fs.remove(dir, { recursive: true }); } catch (e) { /* ignore */ } };
  const shellAt = (cwd) => S().createShell({ cwd: cwd || fs.HOME });
  /** Çalıştır, { out, err, status } döndür (renk yok, 80 sütun). */
  const run = (sh, line, opts) => sh.capture(line, opts || {});
  const outOf = async (sh, line, opts) => (await run(sh, line, opts)).out;

  function openTerm(args) {
    const win = P.apps.launch('terminal', args || {});
    const term = win.state.terminal;
    return { win, term, input: term.input, root: win.body };
  }
  const typeLine = (term, text) => T.type(term.input, text);
  async function enter(term, text) {
    if (text) typeLine(term, text);
    T.key(term.input, 'Enter');
    await T.waitFor(() => !term.isBusy() && !term.shell.__q, 4000);
    await T.sleep(20);
    await T.waitFor(() => !term.isBusy(), 4000);
  }
  async function submit(term, line) {
    await term.run(line);
  }
  const textOf = (term) => term.text();
  const activeText = (term) => term.activeEl.textContent;

  async function withTerm(args, fn) {
    const o = openTerm(args);
    try { await fn(o); } finally { o.win.forceClose(); }
  }

  // ------------------------------------------------------------------ katman 1: sözdizimi
  T.test('lex: tırnaklar, kaçışlar, işleçler, değişkenler', (t) => {
    const flat = (line) => S().lex(line).map((k) => (k.type === 'op' ? k.op : k.parts.map((p) => p.items.map((i) => (typeof i === 'string' ? i : `$${i.v}`)).join('')).join('')));
    t.eq(flat('echo "a b" \'c d\' e\\ f'), ['echo', 'a b', 'c d', 'e f']);
    t.eq(flat('ls -la | grep x && echo ok; cat a > b >> c < d'), ['ls', '-la', '|', 'grep', 'x', '&&', 'echo', 'ok', ';', 'cat', 'a', '>', 'b', '>>', 'c', '<', 'd']);
    t.eq(flat('echo $HOME ${USER} "$?" \'$x\' \\$y'), ['echo', '$HOME', '$USER', '$?', '$x', '$y']);
    t.eq(flat('echo a#b #comment here'), ['echo', 'a#b']);
    t.eq(flat('a 2>/dev/null 2>&1 &> f'), ['a', '2>', '/dev/null', '2>&1', '&>', 'f']);
    t.eq(flat('echo ""'), ['echo', '']);
    t.eq(flat('echo "x\\"y" "a\\\\b"'), ['echo', 'x"y', 'a\\b']);
    t.eq(flat(''), []);
    t.throws(() => S().lex("echo 'abc"), undefined);
  });

  T.test('parse: boru hatları, zincirler, yönlendirme, sözdizimi hataları', async (t) => {
    const ast = S().parse(S().lex('a | b && c ; d || e > f'));
    t.eq(ast.map((x) => x.sep), [';', '&&', ';', '||']);
    t.eq(ast[0].pipeline.cmds.length, 2);
    t.eq(ast[3].pipeline.cmds[0].redirs.map((r) => r.op), ['>']);
    const sh = shellAt();
    for (const bad of ['ls |', '| ls', 'echo hi >', 'ls && ', '; ls', 'echo "abc', "echo 'abc"]) {
      const r = await run(sh, bad);
      t.eq(r.status, 2, `${bad} → 2`);
      t.ok(/^pandash: /.test(r.err), `${bad} → hata iletisi: ${r.err}`);
    }
    t.eq((await run(shellAt(), '   ')).status, 0, 'boş satır durumu değiştirmez');
    t.eq((await run(shellAt(), '# yalnızca yorum')).out, '');
    t.eq(S().parse(S().lex('')), []);
  });

  T.test('değişkenler: $HOME $USER $? $PWD, atamalar, export/unset/env', async (t) => {
    const sh = shellAt(`${fs.HOME}/Belgeler`);
    t.eq(await outOf(sh, 'echo $HOME $USER $PWD ~'), '/home/panda panda /home/panda/Belgeler /home/panda\n');
    t.eq(await outOf(sh, 'echo "~" ~/x a~b'), '~ /home/panda/x a~b\n');
    t.eq(await outOf(sh, 'false; echo $?'), '1\n');
    t.eq(await outOf(sh, 'true; echo $?'), '0\n');
    t.eq(await outOf(sh, 'foo_yok; echo $?'), '127\n');
    await run(sh, 'AD=Panda');
    t.eq(await outOf(sh, 'echo Merhaba $AD ${AD}!'), 'Merhaba Panda Panda!\n');
    t.eq(await outOf(sh, 'echo "$AD  x"'), 'Panda  x\n', 'çift tırnakta boşluklar korunur');
    t.eq(await outOf(sh, "echo '$AD'"), '$AD\n');
    await run(sh, 'export RENK=mavi X=1');
    t.ok((await outOf(sh, 'env')).includes('RENK=mavi'));
    await run(sh, 'unset RENK');
    t.ok(!(await outOf(sh, 'env')).includes('RENK='));
    t.eq(await outOf(sh, 'echo $YOKTUR| wc -w'), '0\n');
    t.eq(await outOf(sh, 'echo a $YOKTUR b'), 'a b\n');
    t.eq(await outOf(sh, 'T=1 echo $T'), '\n', 'ön ek atama o komutun kendi argümanlarını etkilemez (bash ile aynı)');
    t.eq(sh.getVar('T'), '', 'ön ek atama kalıcı değildir');
  });

  T.test('zincirler: && || ; ve çıkış durumu', async (t) => {
    const sh = shellAt();
    t.eq(await outOf(sh, 'echo a && echo b'), 'a\nb\n');
    t.eq(await outOf(sh, 'false && echo b'), '');
    t.eq(await outOf(sh, 'false || echo c'), 'c\n');
    t.eq(await outOf(sh, 'true || echo c'), '');
    t.eq(await outOf(sh, 'false && echo b || echo c'), 'c\n');
    t.eq(await outOf(sh, 'echo 1; echo 2 ; echo 3'), '1\n2\n3\n');
    t.eq(await outOf(sh, 'cat /yok 2>/dev/null; echo $?'), '1\n');
    const r = await run(sh, 'echo x && cat /yok');
    t.eq([r.out, r.status], ['x\n', 1]);
    t.eq((await run(sh, 'true; false')).status, 1);
  });

  T.test('yönlendirme: > >> < 2> &> /dev/null', async (t) => {
    const dir = sandbox({ 'a.txt': 'bir\niki\n' });
    try {
      const sh = shellAt(dir);
      t.eq((await run(sh, 'echo merhaba > x.txt')).out, '', 'yönlendirilen çıktı ekrana düşmez');
      t.eq(fs.readFile(`${dir}/x.txt`), 'merhaba\n');
      await run(sh, 'echo ikinci >> x.txt');
      t.eq(fs.readFile(`${dir}/x.txt`), 'merhaba\nikinci\n');
      await run(sh, 'echo yeni > x.txt');
      t.eq(fs.readFile(`${dir}/x.txt`), 'yeni\n', '> dosyayı keser');
      await run(sh, 'echo -n bos > y.txt; echo -n "" > y.txt');
      t.eq(fs.readFile(`${dir}/y.txt`), '', 'boş çıktı dosyayı yine keser/oluşturur');
      t.eq(await outOf(sh, 'sort -r < a.txt'), 'iki\nbir\n');
      const r = await run(sh, 'cat yok.txt 2> hata.txt');
      t.eq([r.out, r.err, r.status], ['', '', 1]);
      t.ok(fs.readFile(`${dir}/hata.txt`).includes('Böyle bir dosya ya da dizin yok'));
      const r2 = await run(sh, 'cat yok.txt > hepsi.txt 2>&1');
      t.eq(r2.err, '');
      t.ok(fs.readFile(`${dir}/hepsi.txt`).includes('cat: yok.txt'));
      const r3 = await run(sh, 'ls . yok2 &> hem.txt');
      t.eq([r3.out, r3.err], ['', '']);
      t.ok(fs.readFile(`${dir}/hem.txt`).includes('a.txt') && fs.readFile(`${dir}/hem.txt`).includes('yok2'));
      t.eq((await run(sh, 'echo gizli > /dev/null')).out, '');
      t.eq(fs.exists('/dev/null'), false);
      const r4 = await run(sh, 'echo x > yok-klasor/f.txt');
      t.eq(r4.status, 1);
      t.ok(/pandash: yok-klasor\/f\.txt: Böyle bir dosya ya da dizin yok/.test(r4.err), r4.err);
      const r5 = await run(sh, 'echo x > .');
      t.ok(/Bir dizin/.test(r5.err), r5.err);
      const r6 = await run(sh, 'cat < yok.txt');
      t.eq(r6.status, 1);
      t.ok(/yok\.txt: Böyle bir dosya/.test(r6.err));
      await run(sh, 'echo "boşluklu ad" > "Beni Oku.txt"');
      t.eq(fs.readFile(`${dir}/Beni Oku.txt`), 'boşluklu ad\n');
      t.eq(fs.stat(`${dir}/Beni Oku.txt`).type, 'file');
    } finally { cleanup(dir); }
  });

  T.test('borular: stdout sonraki komutun stdin\'i olur', async (t) => {
    const dir = sandbox({ 'meyve.txt': 'elma\narmut\nkiraz\nbanan\nelma\n', 'sayi.txt': '10\n9\n100\n2\n' });
    try {
      const sh = shellAt(dir);
      t.eq(await outOf(sh, 'cat meyve.txt | wc -l'), '5\n');
      t.eq(await outOf(sh, 'cat meyve.txt | grep a | head -2'), 'elma\narmut\n');
      t.eq(await outOf(sh, 'cat meyve.txt | sort | uniq'), 'armut\nbanan\nelma\nkiraz\n');
      t.eq(await outOf(sh, 'cat meyve.txt | sort | uniq -c | sort -rn | head -1'), '      2 elma\n');
      t.eq(await outOf(sh, 'sort -n sayi.txt | tail -1'), '100\n');
      t.eq(await outOf(sh, 'ls | wc -l'), '2\n');
      t.eq(await outOf(sh, 'echo merhaba dünya | wc -w'), '2\n');
      t.eq(await outOf(sh, 'echo a b c | tr_yok 2>/dev/null; echo $?'), '127\n');
      t.eq(await outOf(sh, 'cat meyve.txt | tail -n 1 | cat'), 'elma\n');
      // stderr boruya girmez
      const r = await run(sh, 'cat yok.txt | wc -l');
      t.eq(r.out, '0\n');
      t.ok(/cat: yok\.txt/.test(r.err));
      // 2>&1 ile hata da boruya girer
      t.eq(await outOf(sh, 'cat yok.txt 2>&1 | wc -l'), '1\n');
      t.eq((await run(sh, 'false | true')).status, 0, 'boru hattının durumu son komutun durumudur');
      t.eq((await run(sh, 'true | false')).status, 1);
      // boruda renk yok
      const colored = await run(sh, 'ls | cat', { tty: true });
      t.ok(!/\x1b\[/.test(colored.out), 'boru çıktısında ANSI kaçışı olmamalı');
      // boru + dosya
      await run(sh, 'sort meyve.txt | uniq > uniq.txt');
      t.eq(fs.readFile(`${dir}/uniq.txt`), 'armut\nbanan\nelma\nkiraz\n');
    } finally { cleanup(dir); }
  });

  T.test('joker karakterler: * ? [..], gizli dosyalar, eşleşme yoksa olduğu gibi', async (t) => {
    const dir = sandbox({ 'a.txt': '', 'b.txt': '', 'c.md': '', '.gizli.txt': '', 'alt/d.txt': '', 'alt/e.log': '', 'Beni Oku.txt': '' });
    try {
      const sh = shellAt(dir);
      t.eq(await outOf(sh, 'echo *.txt'), 'a.txt b.txt Beni Oku.txt\n');
      t.eq(await outOf(sh, 'echo ?.txt'), 'a.txt b.txt\n');
      t.eq(await outOf(sh, 'echo [ab].txt'), 'a.txt b.txt\n');
      t.eq(await outOf(sh, 'echo [!a].txt'), 'b.txt\n');
      t.eq(await outOf(sh, 'echo */*.txt'), 'alt/d.txt\n');
      t.eq(await outOf(sh, 'echo .g*'), '.gizli.txt\n');
      t.eq(await outOf(sh, 'echo *.yok'), '*.yok\n');
      t.eq(await outOf(sh, 'echo "*.txt"'), '*.txt\n');
      t.eq(await outOf(sh, "echo '*.txt'"), '*.txt\n');
      t.eq(await outOf(sh, 'echo \\*.txt'), '*.txt\n');
      t.eq(await outOf(sh, 'echo */'), 'alt/\n');
      t.eq(await outOf(sh, `echo ${dir}/a*`), `${dir}/a.txt ${dir}/alt\n`);
      t.eq(await outOf(sh, 'ls *.md'), 'c.md\n');
      await run(sh, 'rm *.txt');
      t.eq(fs.exists(`${dir}/a.txt`), false);
      t.eq(fs.exists(`${dir}/.gizli.txt`), true, 'gizli dosyaya joker dokunmaz');
      t.eq(fs.exists(`${dir}/alt/d.txt`), true);
      // globToRegex
      t.ok(S().globToRegex('*.txt').test('x.txt') && !S().globToRegex('*.txt').test('x.md'));
      t.ok(S().globToRegex('A*', true).test('abc') && !S().globToRegex('A*').test('abc'));
    } finally { cleanup(dir); }
  });

  T.test('bilinmeyen komut: 127, öneri, yol ile çalıştırma', async (t) => {
    const sh = shellAt();
    const r = await run(sh, 'foo');
    t.eq(r.status, 127);
    t.ok(r.err.includes('pandash: komut bulunamadı: foo'), r.err);
    const r2 = await run(sh, 'lss');
    t.ok(r2.err.includes('pandash: komut bulunamadı: lss') && /ls/.test(r2.err.split('\n')[1] || ''), r2.err);
    const r3 = await run(sh, './yok.app');
    t.eq(r3.status, 127);
    const r4 = await run(sh, 'Belgeler/Notlar.txt');
    t.eq(r4.status, 126);
    const r5 = await run(sh, '/etc');
    t.ok(/Bir dizin/.test(r5.err));
    // Object.prototype anahtarları komut/takma ad/değişken sanılmaz
    for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
      const r = await run(sh, name);
      t.eq(r.status, 127, `${name} → komut bulunamadı`);
      t.ok(r.err.includes(`komut bulunamadı: ${name}`) && !r.err.includes('iç hata'), r.err);
      t.eq((await run(sh, `help ${name}`)).status, 1);
      t.eq((await run(sh, `which ${name}`)).status, 1);
      t.eq((await run(sh, `theme ${name}`)).status, 2);
      t.eq((await run(sh, `calc "${name}(1)"`)).status, 1);
      t.eq(await outOf(sh, `echo "[$${name}]"`), '[]\n', 'tanımsız değişken boş');
    }
    t.eq((await run(sh, 'export __proto__=x')).status, 0);
    t.eq(await outOf(sh, 'echo $__proto__'), 'x\n');
    t.eq(Object.getPrototypeOf(sh.env), null);
    t.eq(await outOf(sh, 'echo ok'), 'ok\n');
  });

  // ------------------------------------------------------------------ katman 1: komutlar
  T.test('ls: sade, -a, -l, -la, -h, -1, -d, çoklu yol, hata, boru', async (t) => {
    const d2 = sandbox({ 'a.txt': 'x'.repeat(2048), 'Zeta': null, '.gizli': 'g', 'Zeta/ic.txt': 'i', 'Beni Oku.txt': 'b' });
    try {
      const sh = shellAt(d2);
      // renksiz (tty olmayan) ls: bir satıra bir öğe, '/' yok; klasörler önce
      t.eq(await outOf(sh, 'ls'), 'Zeta\na.txt\nBeni Oku.txt\n');
      t.eq(await outOf(sh, 'ls -a'), '.\n..\nZeta\n.gizli\na.txt\nBeni Oku.txt\n');
      const all = (await outOf(sh, 'ls -a')).split('\n').filter(Boolean);
      t.ok(all.includes('.') && all.includes('..') && all.includes('.gizli'), 'ls -a gizli dosyaları ve . .. gösterir');
      t.ok(!(await outOf(sh, 'ls')).includes('.gizli'));
      t.eq((await outOf(sh, 'ls -A')).includes('.gizli'), true);
      t.eq((await outOf(sh, 'ls -A')).split('\n').includes('.'), false);
      // -l
      const long = (await outOf(sh, 'ls -l')).split('\n').filter(Boolean);
      t.eq(long.length, 3);
      t.ok(/^drwxr-xr-x\s+panda\s+4096\s+\d\d [A-ZÇĞİÖŞÜa-zçğıöşü]{3} \d\d:\d\d\s+Zeta$/.test(long[0]), long[0]);
      t.ok(/^-rw-r--r--\s+panda\s+2048\s+\d\d [A-ZÇĞİÖŞÜa-zçğıöşü]{3} \d\d:\d\d\s+a\.txt$/.test(long[1]), long[1]);
      t.ok(/Beni Oku\.txt$/.test(long[2]));
      const lh = await outOf(sh, 'ls -lh a.txt');
      t.ok(/2 KB\s+.*a\.txt$/.test(lh.trim()), lh);
      t.eq((await outOf(sh, 'ls -la')).split('\n').filter(Boolean).length, 6);
      t.eq((await outOf(sh, 'ls -al')).split('\n').filter(Boolean).length, 6);
      // dosya argümanı, -d, çoklu yol
      t.eq(await outOf(sh, 'ls a.txt'), 'a.txt\n');
      t.eq(await outOf(sh, 'ls -d Zeta'), 'Zeta\n');
      const multi = await outOf(sh, 'ls Zeta a.txt .');
      t.ok(multi.startsWith('a.txt\n\n') && multi.includes('Zeta:\nic.txt') && multi.includes('.:\nZeta'), multi);
      t.eq(await outOf(sh, 'ls Zeta'), 'ic.txt\n');
      t.eq(await outOf(sh, 'ls -r'), 'Beni Oku.txt\na.txt\nZeta\n');
      t.eq((await outOf(sh, 'ls -S')).split('\n')[1], 'a.txt');
      // hatalar
      const e1 = await run(sh, 'ls /yok');
      t.eq(e1.status, 2);
      t.eq(e1.err, "ls: '/yok' erişilemiyor: Böyle bir dosya ya da dizin yok\n");
      const e2 = await run(sh, 'ls -z');
      t.eq(e2.status, 2);
      t.ok(e2.err.includes("tanınmayan seçenek -- 'z'"));
      const e3 = await run(sh, 'ls a.txt /yok Zeta');
      t.eq(e3.status, 2);
      t.ok(e3.out.includes('a.txt') && e3.out.includes('ic.txt') && e3.err.includes('/yok'));
    } finally { cleanup(d2); }
  });

  T.test('ls: renkler (tty) ve sütun yerleşimi', async (t) => {
    const names = Array.from({ length: 12 }, (_, i) => `dosya-${String(i + 1).padStart(2, '0')}.txt`);
    const files = { alt: null, '.hid': 'x', 'Uygulama.app': '{"appId":"files"}', 'foto.png': 'x' };
    for (const n of names) files[n] = '';
    const dir = sandbox(files);
    try {
      const sh = shellAt(dir);
      const col = await run(sh, 'ls', { tty: true, cols: 80 });
      t.ok(col.out.includes('\x1b[1;34malt/\x1b[0m'), 'klasör kalın mavi + "/"');
      t.ok(col.out.includes('\x1b[1;32mUygulama.app\x1b[0m'), '.app yeşil');
      t.ok(col.out.includes('\x1b[35mfoto.png\x1b[0m'), 'resim macenta');
      t.ok(!col.out.includes('.hid'), 'gizli dosya -a olmadan görünmez');
      const hidden = await run(sh, 'ls -a', { tty: true, cols: 80 });
      t.ok(hidden.out.includes('\x1b[2m.hid\x1b[0m'), 'gizli dosya soluk');
      // genişlik
      const plainWide = S().stripAnsi((await run(sh, 'ls', { tty: true, cols: 200 })).out).split('\n').filter(Boolean);
      t.eq(plainWide.length, 1, 'çok geniş terminalde tek satır');
      const narrow = S().stripAnsi((await run(sh, 'ls', { tty: true, cols: 40 })).out).split('\n').filter(Boolean);
      t.ok(narrow.length > 3, `dar terminalde çok satır (${narrow.length})`);
      t.ok(narrow.every((l) => [...l].length <= 40), 'hiçbir satır sütun sayısını aşmaz: ' + narrow.map((l) => [...l].length).join(','));
      // sütunlar hizalı: her satırda ilk ad aynı sütundan başlar, ikinci sütun aynı hizada
      const mid = S().stripAnsi((await run(sh, 'ls', { tty: true, cols: 60 })).out).split('\n').filter(Boolean);
      const starts = mid.filter((l) => l.length > 20).map((l) => l.indexOf('dosya-', 1));
      t.ok(new Set(starts).size <= 2, 'sütun başlangıçları hizalı: ' + starts.join(','));
      // layoutColumns doğrudan
      const lines = S().layoutColumns(['a', 'bb', 'ccc', 'dddd', 'e'].map((x) => ({ plain: x, colored: x })), 12);
      t.ok(lines.length >= 2 && lines.every((l) => l.length <= 12), JSON.stringify(lines));
      t.eq(S().layoutColumns([], 80), []);
    } finally { cleanup(dir); }
  });

  T.test('cd / pwd: ~, -, .., hatalar, boşluklu adlar', async (t) => {
    const dir = sandbox({ 'Boşluklu Klasör/x.txt': 'x', 'dosya.txt': 'd' });
    try {
      const sh = shellAt(dir);
      t.eq(await outOf(sh, 'pwd'), dir + '\n');
      await run(sh, 'cd "Boşluklu Klasör"');
      t.eq(sh.cwd, `${dir}/Boşluklu Klasör`);
      t.eq(sh.promptPath(), `${dir}/Boşluklu Klasör`);
      await run(sh, 'cd ..');
      t.eq(sh.cwd, dir);
      await run(sh, 'cd Boşluklu\\ Klasör');
      t.eq(sh.cwd, `${dir}/Boşluklu Klasör`);
      const back = await run(sh, 'cd -');
      t.eq([sh.cwd, back.out], [dir, dir + '\n']);
      await run(sh, 'cd');
      t.eq([sh.cwd, sh.promptPath()], ['/home/panda', '~']);
      await run(sh, 'cd ~/Belgeler');
      t.eq(sh.promptPath(), '~/Belgeler');
      await run(sh, 'cd /');
      t.eq(sh.promptPath(), '/');
      await run(sh, 'cd ~');
      t.eq(sh.cwd, '/home/panda');
      await run(sh, 'cd Belgeler/Projeler');
      t.eq(sh.cwd, '/home/panda/Belgeler/Projeler');
      await run(sh, 'cd ../..');
      t.eq(sh.cwd, '/home/panda');
      await run(sh, 'cd ./Belgeler/../Resimler');
      t.eq(sh.cwd, '/home/panda/Resimler');
      // hatalar
      await run(sh, 'cd /');
      const e1 = await run(sh, 'cd yok');
      t.eq([e1.status, e1.err], [1, 'cd: yok: Böyle bir dosya ya da dizin yok\n']);
      const e2 = await run(sh, 'cd etc/hostname');
      t.eq([e2.status, e2.err], [1, 'cd: etc/hostname: Bir dizin değil\n']);
      t.eq(sh.cwd, '/', 'başarısız cd çalışma klasörünü değiştirmez');
      t.eq((await run(sh, 'cd a b')).status, 1);
      // oturum kapalı klasör silinirse üste çekilir
      const d3 = sandbox({ 'x/y/z.txt': '' });
      const sh3 = shellAt(`${d3}/x/y`);
      fs.remove(`${d3}/x`, { recursive: true });
      await run(sh3, 'pwd');
      t.eq(sh3.cwd, d3, 'silinen çalışma klasöründen en yakın üst klasöre çekilir');
      cleanup(d3);
    } finally { cleanup(dir); }
  });

  T.test('cat: çoklu dosya, stdin, -n, hata, klasör, ikili dosya', async (t) => {
    const dir = sandbox({ 'a.txt': 'bir\niki\n', 'b.txt': 'üç\n', 'k': null, 'resim.png': 'data:image/png;base64,' + 'A'.repeat(200) });
    try {
      const sh = shellAt(dir);
      t.eq(await outOf(sh, 'cat a.txt'), 'bir\niki\n');
      t.eq(await outOf(sh, 'cat a.txt b.txt'), 'bir\niki\nüç\n');
      t.eq(await outOf(sh, 'cat -n a.txt'), '     1  bir\n     2  iki\n');
      t.eq(await outOf(sh, 'echo selam | cat'), 'selam\n');
      t.eq(await outOf(sh, 'echo selam | cat a.txt - b.txt'), 'bir\niki\nselam\nüç\n');
      const e = await run(sh, 'cat a.txt yok.txt b.txt');
      t.eq(e.out, 'bir\niki\nüç\n');
      t.eq(e.err, 'cat: yok.txt: Böyle bir dosya ya da dizin yok\n');
      t.eq(e.status, 1);
      t.eq((await run(sh, 'cat k')).err, 'cat: k: Bir dizin\n');
      const bin = await run(sh, 'cat resim.png');
      t.eq(bin.status, 1);
      t.ok(/ikili dosya/.test(bin.err) && /open resim\.png/.test(bin.err), bin.err);
      const none = await run(sh, 'cat');
      t.eq(none.status, 1);
      t.ok(/dosya adı/.test(none.err));
      t.eq(await outOf(sh, 'cat ~/Belgeler/Notlar.txt | head -1'), 'Notlar\n');
      t.eq(await outOf(sh, 'cat /etc/hostname'), 'pandaos', 'cat sonuna satır sonu eklemez');
    } finally { cleanup(dir); }
  });

  T.test('mkdir / rmdir / touch', async (t) => {
    const dir = sandbox({ 'dolu/x.txt': 'x', 'bos': null });
    try {
      const sh = shellAt(dir);
      t.eq((await run(sh, 'mkdir yeni')).status, 0);
      t.eq(fs.isDir(`${dir}/yeni`), true);
      t.eq((await run(sh, 'mkdir a1 "a 2" a3')).status, 0);
      t.ok(fs.isDir(`${dir}/a 2`) && fs.isDir(`${dir}/a3`));
      const dup = await run(sh, 'mkdir yeni');
      t.eq(dup.status, 1);
      t.eq(dup.err, "mkdir: 'yeni' dizini oluşturulamıyor: Dosya mevcut\n");
      const noParent = await run(sh, 'mkdir x/y/z');
      t.eq(noParent.status, 1);
      t.ok(noParent.err.includes('Böyle bir dosya ya da dizin yok'));
      t.eq((await run(sh, 'mkdir -p x/y/z')).status, 0);
      t.eq(fs.isDir(`${dir}/x/y/z`), true);
      t.eq((await run(sh, 'mkdir -p x/y/z')).status, 0, '-p var olan için hata vermez');
      t.eq((await run(sh, 'mkdir')).status, 2);
      t.ok((await outOf(sh, 'mkdir -v v1')).includes("'v1' klasörü oluşturuldu"));
      // rmdir
      t.eq((await run(sh, 'rmdir bos')).status, 0);
      t.eq(fs.exists(`${dir}/bos`), false);
      const nonEmpty = await run(sh, 'rmdir dolu');
      t.eq(nonEmpty.status, 1);
      t.ok(nonEmpty.err.includes('Dizin boş değil'), nonEmpty.err);
      t.ok((await run(sh, 'rmdir dolu/x.txt')).err.includes('Bir dizin değil'));
      t.ok((await run(sh, 'rmdir yok')).err.includes('Böyle bir dosya ya da dizin yok'));
      t.ok((await run(sh, 'rmdir ~')).err.includes('korumalı'));
      // touch
      t.eq((await run(sh, 'touch t1.txt t2.txt')).status, 0);
      t.eq([fs.readFile(`${dir}/t1.txt`), fs.isFile(`${dir}/t2.txt`)], ['', true]);
      fs.writeFile(`${dir}/t1.txt`, 'kalmalı');
      const before = fs.stat(`${dir}/t1.txt`).modified;
      await T.sleep(5);
      await run(sh, 'touch t1.txt');
      t.eq(fs.readFile(`${dir}/t1.txt`), 'kalmalı', 'touch içeriği silmez');
      t.ok(fs.stat(`${dir}/t1.txt`).modified > before, 'touch zamanı günceller');
      const bad = await run(sh, 'touch yok/klasor/dosya.txt');
      t.eq(bad.status, 1);
      t.ok(bad.err.includes('dokunulamıyor'), bad.err);
    } finally { cleanup(dir); }
  });

  T.test('rm: çöp kutusuna taşır, -r gerekir, -f, korumalı yollar, joker', async (t) => {
    const dir = sandbox({ 'a.txt': 'içerik', 'k/i.txt': 'i', 'bos': null });
    try {
      const sh = shellAt(dir);
      const before = fs.trashCount();
      const r = await run(sh, 'rm a.txt');
      t.eq([r.out, r.err, r.status], ['', '', 0], 'rm başarıda hiçbir şey yazmaz');
      t.eq(fs.exists(`${dir}/a.txt`), false);
      t.eq(fs.trashCount(), before + 1, 'çöp kutusuna taşındı');
      const entry = fs.listTrash()[0];
      t.eq(entry.originalPath, `${dir}/a.txt`);
      // klasör -r ister
      const nr = await run(sh, 'rm k');
      t.eq(nr.status, 1);
      t.ok(nr.err.includes("rm: 'k' silinemiyor: Bir dizin") && nr.err.includes('-r'), nr.err);
      t.eq(fs.exists(`${dir}/k`), true);
      t.eq((await run(sh, 'rm -r k')).status, 0);
      t.eq(fs.exists(`${dir}/k`), false);
      t.eq(fs.trashCount(), before + 2);
      t.eq((await run(sh, 'rm -rf bos')).status, 0);
      // olmayan dosya
      const miss = await run(sh, 'rm yok.txt');
      t.eq([miss.status, miss.err], [1, "rm: 'yok.txt' silinemiyor: Böyle bir dosya ya da dizin yok\n"]);
      t.eq((await run(sh, 'rm -f yok.txt')).status, 0, '-f olmayanı yok sayar');
      t.eq((await run(sh, 'rm')).status, 2);
      // korumalı
      const root = await run(sh, 'rm -rf /');
      t.eq(root.status, 1);
      t.eq(root.err, "rm: '/' silinemez — bu iyi bir fikir değil 🐼\n");
      t.ok(fs.isDir('/home/panda/Belgeler'));
      const home = await run(sh, 'rm -rf ~');
      t.ok(home.err.includes('korumalı') && home.err.includes('🐼'), home.err);
      t.ok(fs.isDir('/home/panda'));
      t.ok((await run(sh, 'rm -r /home')).err.includes('korumalı'));
      t.ok((await run(sh, 'rm -r ~/Masaüstü')).err.includes('korumalı'));
      t.ok((await run(sh, 'rm -r .')).err.includes("'.' ya da '..'"));
      t.ok((await run(sh, 'rm -r ..')).err.includes("'.' ya da '..'"));
      t.ok(fs.isDir(dir));
      // -v
      fs.writeFile(`${dir}/v.txt`, '');
      t.ok((await outOf(sh, 'rm -v v.txt')).includes("'v.txt' çöp kutusuna taşındı"));
      // geri yüklenebilir
      const id = fs.listTrash().find((e) => e.originalPath === `${dir}/v.txt`).id;
      t.eq(fs.restore(id), `${dir}/v.txt`);
    } finally { cleanup(dir); }
  });

  T.test('mv / cp: yeniden adlandır, taşı, kopyala, -r, üzerine yazma, hatalar', async (t) => {
    const dir = sandbox({ 'a.txt': 'A', 'b.txt': 'B', 'k/i.txt': 'I', 'hedef': null });
    try {
      const sh = shellAt(dir);
      // mv: yeniden adlandır
      t.eq((await run(sh, 'mv a.txt c.txt')).status, 0);
      t.eq([fs.exists(`${dir}/a.txt`), fs.readFile(`${dir}/c.txt`)], [false, 'A']);
      // mv: klasöre taşı
      t.eq((await run(sh, 'mv c.txt hedef')).status, 0);
      t.eq(fs.readFile(`${dir}/hedef/c.txt`), 'A');
      // mv: başka klasöre ve yeni adla
      t.eq((await run(sh, 'mv b.txt hedef/bb.txt')).status, 0);
      t.eq([fs.exists(`${dir}/b.txt`), fs.readFile(`${dir}/hedef/bb.txt`)], [false, 'B']);
      // mv: çoklu kaynak
      fs.writeFile(`${dir}/m1`, '1'); fs.writeFile(`${dir}/m2`, '2');
      t.eq((await run(sh, 'mv m1 m2 hedef/')).status, 0);
      t.ok(fs.exists(`${dir}/hedef/m1`) && fs.exists(`${dir}/hedef/m2`));
      // mv: dosyanın üzerine yazar (eski çöp kutusuna)
      fs.writeFile(`${dir}/x1`, 'yeni'); fs.writeFile(`${dir}/x2`, 'eski');
      const tb = fs.trashCount();
      t.eq((await run(sh, 'mv x1 x2')).status, 0);
      t.eq(fs.readFile(`${dir}/x2`), 'yeni');
      t.eq(fs.trashCount(), tb + 1, 'üzerine yazılan dosya çöp kutusuna gitti');
      // mv: hatalar
      const e1 = await run(sh, 'mv yok x');
      t.eq([e1.status, e1.err.includes('Böyle bir dosya ya da dizin yok')], [1, true]);
      const e2 = await run(sh, 'mv x2 hedef/c.txt k/yok-klasor/zzz');
      t.eq(e2.status, 1);
      t.ok(/mv: hedef/.test(e2.err), e2.err);
      t.ok((await run(sh, 'mv k k/alt')).err.includes('mv:'), 'klasör kendi içine taşınamaz');
      t.eq((await run(sh, 'mv')).status, 2);
      t.eq((await run(sh, 'mv x2')).status, 2);
      // cp: dosya
      t.eq((await run(sh, 'cp x2 kopya.txt')).status, 0);
      t.eq([fs.readFile(`${dir}/kopya.txt`), fs.readFile(`${dir}/x2`)], ['yeni', 'yeni']);
      t.eq((await run(sh, 'cp x2 hedef')).status, 0);
      t.eq(fs.readFile(`${dir}/hedef/x2`), 'yeni');
      fs.writeFile(`${dir}/x2`, 'değişti');
      t.eq((await run(sh, 'cp x2 hedef/x2')).status, 0);
      t.eq(fs.readFile(`${dir}/hedef/x2`), 'değişti', 'cp aynı adlı dosyanın üzerine yazar');
      // cp: klasör -r ister
      const nr = await run(sh, 'cp k yedek');
      t.eq(nr.status, 1);
      t.ok(nr.err.includes('-r belirtilmedi'), nr.err);
      t.eq((await run(sh, 'cp -r k yedek')).status, 0);
      t.eq(fs.readFile(`${dir}/yedek/i.txt`), 'I');
      t.eq((await run(sh, 'cp -r k hedef')).status, 0);
      t.eq(fs.readFile(`${dir}/hedef/k/i.txt`), 'I');
      t.ok((await run(sh, 'cp yok kopya2')).err.includes('Böyle bir dosya ya da dizin yok'));
      t.ok((await run(sh, 'cp x2 x2')).err.includes('aynı dosya'));
      t.eq((await run(sh, 'cp x2')).status, 2);
      t.ok((await run(sh, 'cp x2 kopya.txt yok/zzz')).err.includes('cp:'));
      t.ok((await outOf(sh, 'cp -v x2 v.txt')).includes("'x2' ->"));
    } finally { cleanup(dir); }
  });

  T.test('tree: ağaç karakterleri, -a -d -L, özet', async (t) => {
    const dir = sandbox({ 'a/b/c.txt': '', 'a/d.txt': '', 'e.txt': '', '.gizli/x': '', 'bos': null });
    try {
      const sh = shellAt(dir);
      const out = await outOf(sh, 'tree');
      const lines = out.split('\n');
      t.eq(lines[0], '.');
      t.ok(lines.includes('├── a') && lines.includes('│   ├── b') && lines.includes('│   │   └── c.txt') && lines.includes('│   └── d.txt'), out);
      t.ok(lines.includes('├── bos') && lines.includes('└── e.txt'), out);
      t.ok(!out.includes('.gizli'));
      t.eq(lines[lines.length - 2], '3 dizin, 3 dosya');
      t.ok((await outOf(sh, 'tree -a')).includes('.gizli'));
      const d = await outOf(sh, 'tree -d');
      t.ok(!d.includes('c.txt') && d.includes('└── bos') && d.trim().endsWith('3 dizin'), d);
      const L1 = await outOf(sh, 'tree -L 1');
      t.ok(!L1.includes('c.txt') && L1.includes('├── a') && !L1.includes('b\n'), L1);
      t.ok((await outOf(sh, `tree ${dir}/a`)).startsWith(`${dir}/a\n`));
      const e = await run(sh, 'tree /yok');
      t.eq(e.status, 2);
      t.ok(e.err.includes("tree: '/yok'"));
      const ff = await run(sh, 'tree a/d.txt');
      t.ok(ff.err.includes('Bir dizin değil'));
      const tty = await run(sh, 'tree', { tty: true });
      t.ok(tty.out.includes('\x1b[1;34ma/\x1b[0m'), 'tty: klasörler mavi');
    } finally { cleanup(dir); }
  });

  T.test('find: -name -iname -type -maxdepth, joker, yol biçimi', async (t) => {
    const dir = sandbox({ 'a.txt': '', 'B.TXT': '', 'sub/c.txt': '', 'sub/deep/d.txt': '', 'sub/e.md': '', 'x/y': null });
    try {
      const sh = shellAt(dir);
      const names = async (line) => (await outOf(sh, line)).split('\n').filter(Boolean).sort();
      t.eq(await names('find . -name "*.txt"'), ['./a.txt', './sub/c.txt', './sub/deep/d.txt']);
      t.eq(await names('find -name "*.md"'), ['./sub/e.md']);
      t.eq(await names('find . -iname "*.txt"'), ['./B.TXT', './a.txt', './sub/c.txt', './sub/deep/d.txt']);
      t.eq(await names('find . -name "?.txt"'), ['./a.txt', './sub/c.txt', './sub/deep/d.txt']);
      t.eq(await names('find sub -type d'), ['sub', 'sub/deep']);
      t.eq(await names('find sub -type f -name "*.txt"'), ['sub/c.txt', 'sub/deep/d.txt']);
      t.eq(await names('find . -maxdepth 1 -type f'), ['./B.TXT', './a.txt']);
      t.eq(await names('find sub -maxdepth 1'), ['sub', 'sub/c.txt', 'sub/deep', 'sub/e.md']);
      t.eq(await names(`find ${dir}/sub -name "d*"`), [`${dir}/sub/deep`, `${dir}/sub/deep/d.txt`]);
      t.eq(await names('find a.txt'), ['a.txt']);
      t.eq(await names('find / -name hostname'), ['/etc/hostname']);
      t.eq(await names('find ~/Belgeler -name "*.md"'), ['/home/panda/Belgeler/Projeler/PandaOS Fikirleri.md']);
      const e = await run(sh, 'find /yok');
      t.eq([e.status, e.err], [1, "find: '/yok': Böyle bir dosya ya da dizin yok\n"]);
      t.eq((await run(sh, 'find . -bilinmeyen')).status, 1);
      t.eq((await run(sh, 'find . -type z')).status, 1);
    } finally { cleanup(dir); }
  });

  T.test('grep: -i -n -v -c -l -w -F -r -o, birden çok dosya, stdin, renk', async (t) => {
    const dir = sandbox({
      'a.txt': 'Elma\narmut\nKiraz elma\nmuz\n',
      'b.txt': 'elma suyu\nportakal\n',
      'sub/c.txt': 'elmalı turta\nçilek\n',
      'ışık.txt': 'IŞIK yandı\n'
    });
    try {
      const sh = shellAt(dir);
      t.eq(await outOf(sh, 'grep elma a.txt'), 'Kiraz elma\n');
      t.eq(await outOf(sh, 'grep -i elma a.txt'), 'Elma\nKiraz elma\n');
      t.eq(await outOf(sh, 'grep -n armut a.txt'), '2:armut\n');
      t.eq(await outOf(sh, 'grep -in elma a.txt'), '1:Elma\n3:Kiraz elma\n');
      t.eq(await outOf(sh, 'grep -v a a.txt'), 'muz\n');
      t.eq(await outOf(sh, 'grep -v elma a.txt'), 'Elma\narmut\nmuz\n');
      t.eq(await outOf(sh, 'grep -c elma a.txt b.txt'), 'a.txt:1\nb.txt:1\n');
      t.eq(await outOf(sh, 'grep -l elma a.txt b.txt sub/c.txt'), 'a.txt\nb.txt\nsub/c.txt\n');
      t.eq(await outOf(sh, 'grep elma a.txt b.txt'), 'a.txt:Kiraz elma\nb.txt:elma suyu\n');
      t.eq(await outOf(sh, 'grep -w elma a.txt b.txt sub/c.txt'), 'a.txt:Kiraz elma\nb.txt:elma suyu\n');
      t.eq(await outOf(sh, 'grep -F "a.b" a.txt'), '');
      t.eq(await outOf(sh, 'grep "^a" a.txt'), 'armut\n');
      t.eq(await outOf(sh, 'grep -o "el[a-z]*" b.txt'), 'elma\n');
      const rec = (await outOf(sh, 'grep -r elma .')).split('\n').filter(Boolean).sort();
      t.eq(rec, ['./a.txt:Kiraz elma', './b.txt:elma suyu', './sub/c.txt:elmalı turta']);
      const rec2 = (await outOf(sh, 'grep -r elma')).split('\n').filter(Boolean).sort();
      t.eq(rec2, ['a.txt:Kiraz elma', 'b.txt:elma suyu', 'sub/c.txt:elmalı turta'], 'dosya verilmezse . kökünden, ön eksiz');
      t.eq(await outOf(sh, 'grep -ri "ışık" .'), './ışık.txt:IŞIK yandı\n', 'Türkçe harflerle -i (I/ı, İ/i ayrımı JS kurallarına göre)');
      t.eq(await outOf(sh, 'grep -h elma a.txt b.txt'), 'Kiraz elma\nelma suyu\n');
      t.eq(await outOf(sh, 'echo -e "bir\\niki" | grep iki'), 'iki\n');
      t.eq(await outOf(sh, 'cat a.txt | grep -i ELMA | wc -l'), '2\n');
      t.eq(await outOf(sh, 'grep -e armut a.txt'), 'armut\n');
      t.eq(await outOf(sh, 'grep -E "armut|muz" a.txt'), 'armut\nmuz\n');
      // durum kodları
      t.eq((await run(sh, 'grep elma a.txt')).status, 0);
      t.eq((await run(sh, 'grep yokyok a.txt')).status, 1);
      const nf = await run(sh, 'grep x yok.txt');
      t.eq([nf.status, nf.err], [2, 'grep: yok.txt: Böyle bir dosya ya da dizin yok\n']);
      t.eq((await run(sh, 'grep "(" a.txt')).status, 2);
      t.ok((await run(sh, 'grep x sub')).err.includes('Bir dizin'));
      t.eq((await run(sh, 'grep')).status, 2);
      // renk: tty'de eşleşme kalın kırmızı, borudakinde yok
      const colored = await run(sh, 'grep -n elma a.txt', { tty: true });
      t.ok(colored.out.includes('\x1b[1;31melma\x1b[0m') && colored.out.includes('\x1b[32m3\x1b[0m'), JSON.stringify(colored.out));
      const piped = await run(sh, 'grep elma a.txt | cat', { tty: true });
      t.ok(!/\x1b\[/.test(piped.out));
    } finally { cleanup(dir); }
  });

  T.test('head / tail: -n N, -N, +N, çoklu dosya, stdin', async (t) => {
    const dir = sandbox({ 'n.txt': Array.from({ length: 12 }, (_, i) => `satır ${i + 1}`).join('\n') + '\n', 'k.txt': 'x\ny\n' });
    try {
      const sh = shellAt(dir);
      const lines = (s) => s.split('\n').filter(Boolean);
      t.eq(lines(await outOf(sh, 'head n.txt')).length, 10);
      t.eq(lines(await outOf(sh, 'tail n.txt')).length, 10);
      t.eq(await outOf(sh, 'head -n 2 n.txt'), 'satır 1\nsatır 2\n');
      t.eq(await outOf(sh, 'head -2 n.txt'), 'satır 1\nsatır 2\n');
      t.eq(await outOf(sh, 'head -n2 n.txt'), 'satır 1\nsatır 2\n');
      t.eq(await outOf(sh, 'tail -n 2 n.txt'), 'satır 11\nsatır 12\n');
      t.eq(await outOf(sh, 'tail -3 n.txt'), 'satır 10\nsatır 11\nsatır 12\n');
      t.eq(await outOf(sh, 'tail -n +11 n.txt'), 'satır 11\nsatır 12\n');
      t.eq(lines(await outOf(sh, 'head -n -2 n.txt')).length, 10);
      t.eq(await outOf(sh, 'head -n 0 n.txt'), '');
      t.eq(await outOf(sh, 'tail -n 0 n.txt'), '');
      t.eq(await outOf(sh, 'head -n 1 n.txt k.txt'), '==> n.txt <==\nsatır 1\n\n==> k.txt <==\nx\n');
      t.eq(await outOf(sh, 'cat n.txt | head -n 1'), 'satır 1\n');
      t.eq(await outOf(sh, 'ls | head -1'), 'k.txt\n');
      t.eq(await outOf(sh, 'cat n.txt | tail -n 1'), 'satır 12\n');
      t.eq((await run(sh, 'head -n x n.txt')).status, 2);
      t.eq((await run(sh, 'head yok.txt')).err, 'head: yok.txt: Böyle bir dosya ya da dizin yok\n');
      t.eq((await run(sh, 'tail')).status, 1);
    } finally { cleanup(dir); }
  });

  T.test('wc / sort / uniq / tac / rev / tee / basename / dirname / seq', async (t) => {
    const dir = sandbox({ 'a.txt': 'bir iki\nüç\n', 'b.txt': 'z\ny\nx\ny\n' });
    try {
      const sh = shellAt(dir);
      t.eq((await outOf(sh, 'wc a.txt')).trim().split(/\s+/), ['2', '3', '13', 'a.txt']);
      t.eq((await outOf(sh, 'wc -l a.txt')).trim(), '2 a.txt');
      t.eq((await outOf(sh, 'wc -w a.txt')).trim(), '3 a.txt');
      t.eq((await outOf(sh, 'wc -c a.txt')).trim(), '13 a.txt', 'bayt sayısı UTF-8');
      t.eq((await outOf(sh, 'wc -m a.txt')).trim(), '11 a.txt', 'karakter sayısı');
      t.eq((await outOf(sh, 'wc -l a.txt b.txt')).trim().split('\n').map((l) => l.trim()), ['2 a.txt', '4 b.txt', '6 toplam']);
      t.eq(await outOf(sh, 'wc -l a.txt b.txt'), '2 a.txt\n4 b.txt\n6 toplam\n', 'sayılar aynı genişlikte hizalı');
      t.eq((await outOf(sh, 'echo bir iki üç | wc -w')).trim(), '3');
      t.eq((await outOf(sh, 'cat b.txt | wc -l')).trim(), '4');
      t.eq((await run(sh, 'wc')).status, 1);
      t.eq((await run(sh, 'wc yok')).err, 'wc: yok: Böyle bir dosya ya da dizin yok\n');
      // sort
      t.eq(await outOf(sh, 'sort b.txt'), 'x\ny\ny\nz\n');
      t.eq(await outOf(sh, 'sort -r b.txt'), 'z\ny\ny\nx\n');
      t.eq(await outOf(sh, 'sort -u b.txt'), 'x\ny\nz\n');
      fs.writeFile(`${dir}/n.txt`, '10\n9\n100\n2\n');
      t.eq(await outOf(sh, 'sort n.txt'), '10\n100\n2\n9\n');
      t.eq(await outOf(sh, 'sort -n n.txt'), '2\n9\n10\n100\n');
      t.eq(await outOf(sh, 'sort -nr n.txt'), '100\n10\n9\n2\n');
      fs.writeFile(`${dir}/tr.txt`, 'çilek\nzeytin\nara\nışık\niğne\n');
      t.eq(await outOf(sh, 'sort tr.txt'), 'ara\nçilek\nışık\niğne\nzeytin\n', 'Türkçe sıralama: ç c\'den sonra, ı i\'den önce');
      // uniq
      t.eq(await outOf(sh, 'sort b.txt | uniq'), 'x\ny\nz\n');
      t.eq((await outOf(sh, 'sort b.txt | uniq -c')).split('\n').filter(Boolean).map((l) => l.trim()), ['1 x', '2 y', '1 z']);
      t.eq(await outOf(sh, 'sort b.txt | uniq -d'), 'y\n');
      // tac / rev
      t.eq(await outOf(sh, 'tac b.txt'), 'y\nx\ny\nz\n');
      t.eq(await outOf(sh, 'echo merhaba | rev'), 'abahrem\n');
      // tee
      t.eq(await outOf(sh, 'echo selam | tee t1.txt t2.txt'), 'selam\n');
      t.eq([fs.readFile(`${dir}/t1.txt`), fs.readFile(`${dir}/t2.txt`)], ['selam\n', 'selam\n']);
      await run(sh, 'echo daha | tee -a t1.txt');
      t.eq(fs.readFile(`${dir}/t1.txt`), 'selam\ndaha\n');
      // basename / dirname
      t.eq(await outOf(sh, 'basename /home/panda/Belgeler/Notlar.txt'), 'Notlar.txt\n');
      t.eq(await outOf(sh, 'basename /a/b.txt .txt'), 'b\n');
      t.eq(await outOf(sh, 'dirname /home/panda/Belgeler/Notlar.txt'), '/home/panda/Belgeler\n');
      t.eq(await outOf(sh, 'dirname dosya.txt'), '.\n');
      // seq
      t.eq(await outOf(sh, 'seq 3'), '1\n2\n3\n');
      t.eq(await outOf(sh, 'seq 2 2 8'), '2\n4\n6\n8\n');
      t.eq(await outOf(sh, 'seq 5 -2 1'), '5\n3\n1\n');
      t.eq((await run(sh, 'seq x')).status, 2);
      t.eq((await outOf(sh, 'seq 1000')).split('\n').length, 1001);
    } finally { cleanup(dir); }
  });

  T.test('echo: -n -e, kaçışlar; true/false/which/alias/sudo/fortune', async (t) => {
    const sh = shellAt();
    t.eq(await outOf(sh, 'echo'), '\n');
    t.eq(await outOf(sh, 'echo -n merhaba'), 'merhaba');
    t.eq(await outOf(sh, 'echo -e "a\\tb\\nc"'), 'a\tb\nc\n');
    t.eq(await outOf(sh, 'echo -e "\\e[31mkırmızı\\e[0m"'), '\x1b[31mkırmızı\x1b[0m\n');
    t.eq(await outOf(sh, 'echo a\\nb'), 'anb\n');
    t.eq(await outOf(sh, 'echo --help'), '--help\n');
    t.eq(await outOf(sh, 'echo -x'), '-x\n');
    t.eq(await outOf(sh, 'echo   çok    boşluk'), 'çok boşluk\n');
    t.eq((await run(sh, 'true')).status, 0);
    t.eq((await run(sh, 'false')).status, 1);
    t.ok((await outOf(sh, 'which ls')).includes('yerleşik'));
    t.ok((await outOf(sh, 'which ll')).includes("'ls -l'"));
    t.eq((await run(sh, 'which yokkomut')).status, 1);
    t.ok((await outOf(sh, 'alias')).includes("alias ll='ls -l'"));
    const sudo = await run(sh, 'sudo rm -rf /');
    t.eq(sudo.status, 1);
    t.ok(sudo.err.includes('sudoers') && sudo.err.includes('🐼'), sudo.err);
    t.ok((await outOf(sh, 'fortune')).trim().length > 5);
    // takma adlar
    const dir = sandbox({ 'a.txt': 'x' });
    try {
      const s2 = shellAt(dir);
      t.eq((await outOf(s2, 'll')).split('\n').filter(Boolean).length, 1);
      t.ok(/^-rw-r--r--/.test(await outOf(s2, 'll')));
      await run(s2, 'mkdir -p yeni/ic');
      t.eq(fs.isDir(`${dir}/yeni/ic`), true);
      await run(s2, 'cd yeni');
      await run(s2, '..');
      t.eq(s2.cwd, dir);
    } finally { cleanup(dir); }
  });

  T.test('date / uname / uptime / whoami / hostname / stat / du / df', async (t) => {
    const sh = shellAt();
    t.eq(await outOf(sh, 'whoami'), 'panda\n');
    t.eq(await outOf(sh, 'hostname'), 'pandaos\n');
    t.eq(await outOf(sh, 'echo $HOSTNAME $USER'), 'pandaos panda\n');
    const now = new Date();
    t.eq(await outOf(sh, 'date +%Y'), `${now.getFullYear()}\n`);
    t.ok(/^\d{4}-\d\d-\d\d\n$/.test(await outOf(sh, 'date +%F')));
    t.ok(/^\d\d:\d\d:\d\d\n$/.test(await outOf(sh, 'date +%T')));
    t.eq(await outOf(sh, 'date "+%d.%m.%Y"'), `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}\n`);
    const d = await outOf(sh, 'date');
    t.ok(/(Pazartesi|Salı|Çarşamba|Perşembe|Cuma|Cumartesi|Pazar), \d{1,2} (Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık) \d{4} \d\d:\d\d:\d\d/.test(d), d);
    t.eq(await outOf(sh, 'uname'), 'PandaOS\n');
    const ua = await outOf(sh, 'uname -a');
    t.ok(/^PandaOS pandaos 1\.0\.0 /.test(ua), ua);
    t.eq(await outOf(sh, 'uname -r'), '1.0.0\n');
    t.eq(await outOf(sh, 'uname -n'), 'pandaos\n');
    const up = await outOf(sh, 'uptime');
    t.ok(/^\d\d:\d\d:\d\d  açık: (\d+ (gün|saat|dk|sn)(, )?)+,  1 kullanıcı\n$/.test(up), up);
    const st = await outOf(sh, 'stat ~/Belgeler/Notlar.txt');
    t.ok(st.includes('Dosya: Notlar.txt') && st.includes('düz dosya') && st.includes('Boyut:'), st);
    t.ok((await outOf(sh, 'stat ~/Belgeler')).includes('klasör'));
    t.eq((await run(sh, 'stat /yok')).status, 1);
    const du = await outOf(sh, 'du -sh ~/Belgeler');
    t.ok(/KB\s+\/home\/panda\/Belgeler$|B\s+\/home\/panda\/Belgeler$/.test(du.trim()), du);
    t.ok((await outOf(sh, 'du ~/Belgeler')).includes('/home/panda/Belgeler/Projeler'));
    const df = await outOf(sh, 'df');
    t.ok(df.includes('pandafs') && df.includes('Kullanılan') && /%\d+/.test(df), df);
  });

  T.test('help: gruplu liste, help <komut>, <komut> --help', async (t) => {
    const sh = shellAt();
    const h = await outOf(sh, 'help', { cols: 100 });
    for (const g of ['Dosya ve klasörler', 'Metin işleme', 'Sistem ve uygulamalar', 'Kabuk', 'Eğlence']) t.ok(h.includes(g), `grup: ${g}`);
    const required = ['help', 'ls', 'cd', 'cat', 'mkdir', 'rm', 'pwd', 'touch', 'echo', 'clear', 'mv', 'cp', 'rmdir', 'tree', 'find', 'grep', 'head', 'tail', 'wc', 'sort',
      'whoami', 'hostname', 'date', 'uname', 'uptime', 'history', 'neofetch', 'open', 'theme', 'ps', 'kill', 'apps', 'notify', 'trash', 'pandasay', 'calc', 'exit'];
    const descLines = h.split('\n');
    for (const c of required) {
      const line = descLines.find((l) => new RegExp(`^  ${c}\\s{2,}\\S`).test(l));
      t.ok(line, `help listesinde açıklamalı ${c}`);
    }
    // hizalama: tüm komut açıklamaları aynı sütunda başlar
    const cols = descLines.filter((l) => /^  [a-z]+\s{2,}\S/.test(l) && !/^  (cmd|a &&|\*\.txt|Tab|Ctrl)/.test(l)).map((l) => l.search(/\S\s{2,}\S/) && l.match(/^(  [a-z]+\s+)/)[1].length);
    t.eq(new Set(cols).size, 1, 'açıklamalar hizalı: ' + [...new Set(cols)].join(','));
    const g = await outOf(sh, 'help grep');
    t.ok(g.includes('grep — ') && g.includes('Kullanım:') && g.includes('Seçenekler:') && g.includes('Örnekler:') && g.includes('-i'), g);
    t.eq(await outOf(sh, 'ls --help'), (await outOf(sh, 'help ls')));
    t.ok((await outOf(sh, 'help ll')).includes('ls — '), 'takma ad için asıl komutun yardımı');
    const bad = await run(sh, 'help yokkomut');
    t.eq([bad.status, bad.err], [1, "help: 'yokkomut' adlı bir komut yok\n"]);
    for (const c of Object.keys(S().CMD)) {
      const r = await run(sh, `help ${c}`);
      t.eq(r.status, 0, `help ${c}`);
    }
  });

  T.test('neofetch: etiketler, sanat, dar terminalde alt alta', async (t) => {
    const sh = shellAt();
    const wide = await outOf(sh, 'neofetch', { cols: 100 });
    for (const label of ['OS: PandaOS 1.0 (Bambu)', 'Çekirdek: panda-kernel 1.0.0', 'Çalışma süresi:', 'Kabuk: pandash 1.0', 'Çözünürlük:', 'Tema:', 'Vurgu rengi:', 'Terminal:', 'Uygulamalar:', 'Depolama:', 'panda@pandaos']) {
      t.ok(wide.includes(label), `neofetch: ${label}`);
    }
    t.ok(/Çözünürlük: \d+x\d+/.test(wide));
    t.ok(/Depolama: .+ \/ .+ \(%\d+\)/.test(wide), wide);
    t.ok(new RegExp(`Uygulamalar: ${P.apps.list().length}\\b`).test(wide));
    t.ok(/Tema: (Koyu|Açık)/.test(wide));
    const tty = await run(sh, 'neofetch', { tty: true, cols: 100 });
    t.ok(tty.out.includes('38;2;') && tty.out.includes('▀'), 'renkli panda sanatı');
    t.ok(/\x1b\[4[0-7]m {3}\x1b\[0m/.test(tty.out) && /\x1b\[10[0-7]m {3}\x1b\[0m/.test(tty.out), 'renk blokları sırası');
    const art = S().pandaArt();
    t.eq(art.length, 12);
    t.ok(art.every((l) => S().stripAnsi(l).length === 24), 'sanat 24 sütun');
    const narrow = (await run(sh, 'neofetch', { tty: true, cols: 40 })).out.split('\n');
    const artRows = narrow.findIndex((l) => S().stripAnsi(l).includes('panda@pandaos'));
    t.ok(artRows >= 12, `dar terminalde bilgi sanatın altında (${artRows})`);
    const wideRows = (await run(sh, 'neofetch', { tty: true, cols: 100 })).out.split('\n');
    t.ok(wideRows.find((l) => l.includes('Çekirdek')).includes('38;2;'), 'geniş: sanat ve bilgi aynı satırda');
    t.ok(wideRows.length < narrow.length, 'geniş düzen daha az satır');
    P.theme.set('light');
    t.ok((await outOf(sh, 'neofetch')).includes('Tema: Açık'));
    P.theme.set('dark');
    t.ok((await outOf(sh, 'neofetch')).includes('Tema: Koyu'));
  });

  T.test('calc: aritmetik, işlevler, hatalar (eval yok)', async (t) => {
    const sh = shellAt();
    const c = async (e) => (await outOf(sh, `calc "${e}"`)).trim();
    t.eq(await c('2+3*4'), '14');
    t.eq(await c('(2+3)*4'), '20');
    t.eq(await c('10/4'), '2,5');
    t.eq(await c('2^10'), '1.024');
    t.eq(await c('2**3**2'), '512');
    t.eq(await c('-2^2'), '-4');
    t.eq(await c('2*-3'), '-6');
    t.eq(await c('10 % 3'), '1');
    t.eq(await c('sqrt(144)'), '12');
    t.eq(await c('sqrt(16)^2+1'), '17');
    t.eq(await c('max(3, 9, 4)'), '9');
    t.eq(await c('round(2.5)'), '3');
    t.eq(await c('5!'), '120');
    t.eq(await c('pi'), '3,14159265359');
    t.eq(await c('1000*1000'), '1.000.000');
    t.eq(await c('0.1+0.2'), '0,3');
    t.eq(await c('1e3 + .5'), '1.000,5');
    t.eq(await c('abs(-7)'), '7');
    t.eq((await outOf(sh, 'calc 1 + 2')).trim(), '3', 'argümanlar birleştirilir');
    t.eq((await outOf(sh, 'echo 6*7 | calc')).trim(), '42');
    const z = await run(sh, 'calc 1/0');
    t.eq([z.status, z.err], [1, 'calc: sıfıra bölme\n']);
    for (const bad of ['2+', '(1', 'foo(1)', 'xyz', '2 $ 3', '1)', 'sqrt(-1)', 'log(0)']) {
      const r = await run(sh, `calc "${bad}"`);
      t.eq(r.status, 1, `calc ${bad} hata vermeli`);
      t.ok(r.err.startsWith('calc: '), r.err);
    }
    t.eq((await run(sh, 'calc')).status, 2);
    // eval/Function çağrılmaz: kötü niyetli girdi sözdizimi hatası
    t.eq((await run(sh, 'calc "alert(1)"')).status, 1);
    t.eq((await run(sh, 'calc "constructor"')).status, 1);
    t.eq((await run(sh, 'calc "__proto__"')).status, 1);
    t.eq(S().calcEval('2+2'), 4);
    t.throws(() => S().calcEval('1/0'));
  });

  T.test('pandasay: balon, sarma, boru; sl statik; fortune boru', async (t) => {
    const sh = shellAt();
    const one = await outOf(sh, 'pandasay Merhaba');
    const lines = one.split('\n');
    t.eq(lines[0], ' _________');
    t.eq(lines[1], '< Merhaba >');
    t.eq(lines[2], ' ---------');
    t.ok(one.includes('@(o)@') && one.includes('\\'), 'panda sanatı');
    const long = await outOf(sh, 'pandasay "Bu çok uzun bir cümle ve balonun içinde birden çok satıra sarılmalı çünkü genişlik sınırlı"', { cols: 40 });
    const ll = long.split('\n');
    t.ok(ll[1].startsWith('/ ') && ll[1].endsWith(' \\'), ll[1]);
    t.ok(ll.some((l) => l.startsWith('| ') && l.endsWith(' |')), 'orta satırlar | ile');
    const lastBubble = ll.findIndex((l) => l.startsWith(' ---'));
    t.ok(ll[lastBubble - 1].startsWith('\\ ') && ll[lastBubble - 1].endsWith(' /'), ll[lastBubble - 1]);
    t.eq((await outOf(sh, 'echo selam | pandasay')).split('\n')[1], '< selam >');
    t.ok((await outOf(sh, 'cowsay hey')).includes('< hey >'));
    t.eq((await run(sh, 'pandasay')).status, 2);
    t.ok((await outOf(sh, 'fortune | pandasay')).includes(' ---'), 'fortune çıktısı balona girer');
    const sl = await outOf(sh, 'sl');
    t.ok(sl.includes('E K S P R E S'), 'sl: statik tren');
    // canlı animasyon: kareler çizilir, bitince temizlenir
    const frames = [];
    const r = await sh.capture('sl', { tty: true, cols: 40, live: (f) => frames.push(f) });
    t.eq(r.status, 0);
    t.ok(frames.length > 10 && frames[frames.length - 1] === null, `kare sayısı ${frames.length}`);
    t.ok(frames.slice(0, -1).every((f) => f.split('\n').every((l) => [...l].length <= 40)));
    // iptal
    const ac = new AbortController();
    const frames2 = [];
    const p = sh.capture('sl', { tty: true, cols: 80, live: (f) => { frames2.push(f); if (frames2.length === 3) ac.abort(); }, signal: ac.signal });
    const r2 = await p;
    t.eq(r2.status, 130);
    t.ok(frames2.length < 10);
  }, 30000);

  T.test('sleep: bekler, iptal edilir', async (t) => {
    const sh = shellAt();
    const t0 = Date.now();
    const r = await run(sh, 'sleep 0.2 && echo bitti');
    t.eq(r.out, 'bitti\n');
    t.ok(Date.now() - t0 >= 150);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 60);
    const t1 = Date.now();
    const r2 = await run(sh, 'sleep 30 && echo olmamali', { signal: ac.signal });
    t.eq([r2.status, r2.out], [130, '']);
    t.ok(Date.now() - t1 < 3000);
    t.eq((await run(sh, 'sleep abc')).status, 2);
  });

  T.test('komut yerine koyma $(…) `…` ve aritmetik $((…))', async (t) => {
    const dir = sandbox({ 'a.txt': 'bir\niki\n', 'b c.txt': 'x', 'alt/d.txt': 'd' });
    try {
      const sh = shellAt(dir);
      t.eq(await outOf(sh, 'echo $(echo merhaba)'), 'merhaba\n');
      t.eq(await outOf(sh, 'echo `echo ters tırnak`'), 'ters tırnak\n');
      t.eq(await outOf(sh, 'echo "[$(echo "a   b")]"'), '[a   b]\n', 'çift tırnakta boşluklar korunur');
      t.eq(await outOf(sh, 'echo [$(echo "a   b")]'), '[a b]\n', 'tırnaksızda sözcüklere bölünür');
      t.eq(await outOf(sh, 'echo $(echo $(echo iç iç))'), 'iç iç\n', 'iç içe');
      t.eq(await outOf(sh, "echo '$(echo literal)'"), '$(echo literal)\n', 'tek tırnakta açılım yok');
      t.eq(await outOf(sh, 'echo \\$(echo kaçış)'), '$(echo kaçış)\n');
      t.eq(await outOf(sh, 'cat "$(ls | tail -1)"'), 'x', 'tırnaklı yerine koyma boşluklu adı tek argüman yapar');
      t.eq((await run(sh, 'cat $(ls | tail -1)')).status, 1, 'tırnaksız: bash gibi sözcüklere bölünür');
      t.eq(await outOf(sh, 'wc -l $(echo a.txt)'), '2 a.txt\n');
      t.eq(await outOf(sh, 'ls $(pwd)'), 'alt\na.txt\nb c.txt\n');
      t.eq(await outOf(sh, 'echo $(ls | wc -l) dosya'), '3 dosya\n');
      // çıktıdaki özel karakterler komutu bozmaz
      t.eq(await outOf(sh, 'echo $(echo "a;b|c>d")'), 'a;b|c>d\n');
      t.eq(await outOf(sh, 'echo $(echo "*")'), '*\n', 'çıktıdaki * joker sayılmaz');
      // boşluklu dosya adı tırnaklanır
      t.eq(await outOf(sh, 'echo $(ls . | grep "b c") | wc -w'), '2\n');
      // alt kabuk: cd / atama dışarı sızmaz
      t.eq(await outOf(sh, 'echo $(cd /; pwd); pwd'), `/\n${dir}\n`);
      await run(sh, 'X=1; echo $(X=2; echo $X)');
      t.eq(sh.getVar('X'), '1');
      // aritmetik
      t.eq(await outOf(sh, 'echo $((2+3*4))'), '14\n');
      t.eq(await outOf(sh, 'echo $(( (1+2) * 3 ))'), '9\n');
      t.eq(await outOf(sh, 'echo $((10/4))'), '2.5\n');
      await run(sh, 'N=7');
      t.eq(await outOf(sh, 'echo $((N*2)) $(($N+1))'), '14 8\n');
      t.eq(await outOf(sh, 'echo "toplam: $((1+1))"'), 'toplam: 2\n');
      const bad = await run(sh, 'echo $((1/0))');
      t.eq(bad.status, 2);
      t.ok(bad.err.includes('aritmetik hata: sıfıra bölme'), bad.err);
      // hata akışı: iç komutun stderr'i görünür, çıktı boş
      const e = await run(sh, 'echo [$(cat yok.txt)]');
      t.eq(e.out, '[]\n');
      t.ok(e.err.includes('cat: yok.txt: Böyle bir dosya ya da dizin yok'));
      // eşleşmeyen
      const u1 = await run(sh, 'echo $(echo x');
      t.eq(u1.status, 2);
      t.ok(u1.err.includes('eşleşmeyen parantez'), u1.err);
      const u2 = await run(sh, 'echo `echo x');
      t.eq(u2.status, 2);
      // $? yerine koymadan etkilenmez
      t.eq(await outOf(sh, 'false; echo $(true) $?'), '1\n', 'komut yerine koyma $? değerini bozmaz');
      // komut yerine koyma + yönlendirme
      await run(sh, 'echo $(date +%Y) > yil.txt');
      t.eq(fs.readFile(`${dir}/yil.txt`), `${new Date().getFullYear()}\n`);
      // sondaki ya da tek başına $ sözcüğü yerine koyma sayılmaz
      t.eq(await outOf(sh, 'echo $ x$'), '$ x$\n');
      t.eq(await outOf(sh, 'echo fiyat: 5$ ve $(echo 6)$'), 'fiyat: 5$ ve 6$\n');
    } finally { cleanup(dir); }
  });

  T.test('geçmiş açılımı: !!, !N, !-N, !önek (tırnak içinde yok)', (t) => {
    const E = S().expandHistory;
    const h = ['ls -la', 'cd Belgeler', 'echo bir', 'pwd'];
    t.eq(E('!!', h), { line: 'pwd', changed: true });
    t.eq(E('sudo !!', h), { line: 'sudo pwd', changed: true });
    t.eq(E('!1', h), { line: 'ls -la', changed: true });
    t.eq(E('!-2', h), { line: 'echo bir', changed: true });
    t.eq(E('!cd', h), { line: 'cd Belgeler', changed: true });
    t.eq(E('!echo && !pwd', h), { line: 'echo bir && pwd', changed: true });
    t.eq(E('!! | wc', h).line, 'pwd | wc');
    t.eq(E('echo "çok güzel!!"', h), { line: 'echo "çok güzel!!"', changed: false }, 'çift tırnak içinde açılım yok');
    t.eq(E("echo 'a !!'", h).changed, false);
    t.eq(E('echo merhaba!', h).changed, false);
    t.eq(E('echo \\!!', h).changed, false, 'ters bölü ile kaçış');
    t.eq(E('echo !', h).changed, false);
    t.eq(E('düz komut', h), { line: 'düz komut', changed: false });
    t.eq(E('!yok', h), { error: '!yok: olay bulunamadı' });
    t.eq(E('!9', h), { error: '!9: olay bulunamadı' });
    t.eq(E('!!', []), { error: '!!: olay bulunamadı' });
  });

  T.test('printf / tr / cut', async (t) => {
    const dir = sandbox({ 'v.txt': 'ad,yaş,şehir\nAli,30,İzmir\nVeli,25,Ankara\n' });
    try {
      const sh = shellAt(dir);
      t.eq(await outOf(sh, 'printf "merhaba\\n"'), 'merhaba\n');
      t.eq(await outOf(sh, 'printf "%s yaşında %d%%\\n" Panda 3'), 'Panda yaşında 3%\n');
      t.eq(await outOf(sh, 'printf "%s\\n" a b c'), 'a\nb\nc\n', 'biçim argümanlar bitene kadar yinelenir');
      t.eq(await outOf(sh, 'printf "[%5s][%-5s]\\n" ab cd'), '[   ab][cd   ]\n');
      t.eq(await outOf(sh, 'printf "%05d %+d %x %X %o %c\\n" 42 7 255 255 8 xyz'), '00042 +7 ff FF 10 x\n');
      t.eq(await outOf(sh, 'printf "%.2f|%8.3f|%f\\n" 3.14159 2.5 1'), '3.14|   2.500|1.000000\n');
      t.eq(await outOf(sh, 'printf "%d\\n" abc'), '0\n');
      t.eq(await outOf(sh, 'printf "%s e %s\\n" tek'), 'tek e \n');
      t.eq(await outOf(sh, 'printf "%.3s\\n" Merhaba'), 'Mer\n');
      t.eq(await outOf(sh, 'printf "a\\tb\\n"'), 'a\tb\n');
      t.eq((await run(sh, 'printf')).status, 2);
      // tr
      t.eq(await outOf(sh, 'echo merhaba | tr a-z A-Z'), 'MERHABA\n');
      t.eq(await outOf(sh, 'echo merhaba | tr "[:lower:]" "[:upper:]"'), 'MERHABA\n');
      t.eq(await outOf(sh, 'echo hello | tr -d l'), 'heo\n');
      t.eq(await outOf(sh, 'echo "a   b    c" | tr -s " "'), 'a b c\n');
      t.eq(await outOf(sh, 'echo abc | tr abc x'), 'xxx\n', 'KÜME2 kısaysa son karakter tekrarlanır');
      t.eq(await outOf(sh, 'echo a-b | tr "-" "_"'), 'a_b\n');
      t.eq(await outOf(sh, 'echo "ab cd" | tr " " "\\n"'), 'ab\ncd\n');
      t.eq(await outOf(sh, 'echo 12ab | tr -d "[:digit:]"'), 'ab\n');
      t.eq((await run(sh, 'tr a')).status, 2);
      t.eq((await run(sh, 'tr a b')).status, 1, 'stdin yoksa');
      // cut
      t.eq(await outOf(sh, 'cut -d, -f1 v.txt'), 'ad\nAli\nVeli\n');
      t.eq(await outOf(sh, 'cut -d, -f2,3 v.txt'), 'yaş,şehir\n30,İzmir\n25,Ankara\n');
      t.eq(await outOf(sh, 'cut -d, -f2- v.txt | head -1'), 'yaş,şehir\n');
      t.eq(await outOf(sh, 'cut -d , -f 3 v.txt'), 'şehir\nİzmir\nAnkara\n');
      t.eq(await outOf(sh, 'cut -c 1-3 v.txt'), 'ad,\nAli\nVel\n');
      t.eq(await outOf(sh, 'echo a:b:c | cut -d: -f2'), 'b\n');
      t.eq(await outOf(sh, 'echo abc | cut -d: -f2'), 'abc\n', 'ayıraçsız satır olduğu gibi');
      t.eq(await outOf(sh, 'echo abc | cut -s -d: -f2'), '');
      t.eq(await outOf(sh, 'cat v.txt | cut -d, -f1 | sort | head -2'), 'ad\nAli\n', 'Türkçe sıralamada ad < Ali');
      t.eq((await run(sh, 'cut v.txt')).status, 2);
      t.eq((await run(sh, 'cut -f x v.txt')).status, 2);
    } finally { cleanup(dir); }
  });

  // ------------------------------------------------------------------ katman 1: sistem komutları
  T.test('open: dosya, klasör, uygulama kimliği, hatalar', async (t) => {
    const sh = shellAt();
    const calls = [];
    sh.host.openFile = (p) => { calls.push(['file', p]); return {}; };
    sh.host.launch = (id, a) => { calls.push(['app', id]); return {}; };
    t.eq((await run(sh, 'open Belgeler/Notlar.txt')).status, 0);
    t.eq((await run(sh, 'open Belgeler')).status, 0);
    t.eq((await run(sh, 'open .')).status, 0);
    t.eq((await run(sh, 'open termtest')).status, 0);
    t.eq((await run(sh, 'open ~/Masaüstü/Terminal.app')).status, 0);
    t.eq(calls, [['file', '/home/panda/Belgeler/Notlar.txt'], ['file', '/home/panda/Belgeler'], ['file', '/home/panda'], ['app', 'termtest'], ['file', '/home/panda/Masaüstü/Terminal.app']]);
    const e = await run(sh, 'open yokyok');
    t.eq(e.status, 1);
    t.ok(e.err.includes("open: 'yokyok'") && e.err.includes('uygulama yok'));
    t.eq((await run(sh, 'open')).status, 2);
  });

  T.test('open: gerçek uygulamalar (kernel üzerinden)', async (t) => {
    const sh = shellAt();
    const before = P.wm.list().length;
    t.eq((await run(sh, 'open terminal')).status, 0);
    t.eq(P.wm.list().length, before + 1, 'terminal kimliği yeni pencere açar');
    P.wm.byApp('terminal').slice(-1)[0].forceClose();
    // ~/Belgeler klasörünü Dosyalar'da aç (dosyalar uygulaması yoksa openFile bildirim verir ama çökmemeli)
    if (P.apps.get('files')) {
      const w = P.apps.launch('files', {});
      if (w) w.forceClose();
    }
  });

  T.test('theme: göster, light/dark/auto, Türkçe takma adlar, hata', async (t) => {
    const sh = shellAt();
    P.theme.set('dark');
    t.eq(await outOf(sh, 'theme'), 'Tema: Koyu\n');
    t.eq(await outOf(sh, 'theme light'), 'Tema açık olarak ayarlandı.\n');
    t.eq(P.theme.get(), 'light');
    t.eq(document.documentElement.dataset.theme, 'light');
    t.eq(await outOf(sh, 'theme'), 'Tema: Açık\n');
    await run(sh, 'theme dark');
    t.eq(P.theme.get(), 'dark');
    await run(sh, 'theme auto');
    t.eq(P.theme.mode(), 'auto');
    t.ok((await outOf(sh, 'theme')).includes('(otomatik)'));
    await run(sh, 'theme açık');
    t.eq(P.theme.mode(), 'light');
    await run(sh, 'theme koyu');
    t.eq(P.theme.mode(), 'dark');
    const bad = await run(sh, 'theme mor');
    t.eq(bad.status, 2);
    t.ok(bad.err.includes("geçersiz değer 'mor'"));
    P.theme.set('dark');
  });

  T.test('ps / kill / apps / notify', async (t) => {
    const sh = shellAt();
    const calc = P.apps.launch('termtest', {});
    try {
      const ps = await outOf(sh, 'ps');
      const rows = ps.split('\n').filter(Boolean);
      t.eq(rows[0].trim().split(/\s+/), ['PID', 'UYGULAMA', 'BAŞLIK', 'DURUM']);
      const pid = String(calc.id).replace('win-', '');
      const row = rows.find((r) => r.trim().split(/\s+/)[0] === pid);
      t.ok(row && row.includes('termtest') && row.includes('Terminal Testi'), `ps satırı: ${row}`);
      t.ok(/odakta|çalışıyor|küçültülmüş/.test(row));
      const k = await run(sh, `kill ${pid}`);
      t.eq([k.status, k.out, k.err], [0, '', '']);
      t.eq(calc.isClosed(), true, 'kill pencereyi kapattı');
      const again = await run(sh, `kill ${pid}`);
      t.eq(again.status, 1);
      t.ok(again.err.includes(`kill: (${pid}): Böyle bir işlem yok`), again.err);
      t.eq((await run(sh, 'kill')).status, 2);
      t.eq((await run(sh, 'kill abc')).status, 1);
      const w2 = P.wm.open({ appId: 'x', title: 'X', width: 200, height: 150 });
      t.eq((await run(sh, `kill -9 ${w2.id}`)).status, 0);
      t.eq(w2.isClosed(), true, 'win-N biçimi de kabul edilir');
    } finally { if (!calc.isClosed()) calc.forceClose(); }
    // apps
    const apps = await outOf(sh, 'apps');
    t.ok(apps.includes('KİMLİK') && apps.includes('terminal') && apps.includes('Terminal') && apps.includes('uygulama yüklü'), apps);
    // notify
    const n0 = P.notify.history().length;
    const nr = await run(sh, 'notify Kahve molası!');
    t.eq([nr.status, nr.out, nr.err], [0, '', '']);
    const h = P.notify.history();
    t.eq(h.length, n0 + 1);
    t.eq([h[0].title, h[0].message], ['Terminal', 'Kahve molası!']);
    await run(sh, 'notify -t Hatırlatma "Toplantı 15:00"');
    t.eq([P.notify.history()[0].title, P.notify.history()[0].message], ['Hatırlatma', 'Toplantı 15:00']);
    t.eq((await run(sh, 'notify')).status, 2);
    P.notify.clear();
  });

  T.test('trash: liste, restore, rm, empty -y', async (t) => {
    const dir = sandbox({ 'a.txt': 'A', 'k/i.txt': 'I', 'b.txt': 'B' });
    try {
      const sh = shellAt(dir);
      fs.emptyTrash();
      t.eq(await outOf(sh, 'trash'), 'Çöp kutusu boş.\n');
      t.eq((await run(sh, 'trash restore 1')).status, 1);
      await run(sh, 'rm a.txt');
      await T.sleep(3);
      await run(sh, 'rm -r k');
      await T.sleep(3);
      await run(sh, 'rm b.txt');
      const list = await outOf(sh, 'trash');
      const rows = list.split('\n').filter(Boolean);
      t.ok(rows[0].includes('AD') && rows[0].includes('ESKİ KONUM') && rows[0].includes('SİLİNME') && rows[0].includes('BOYUT'), rows[0]);
      t.ok(/^\s*1\s+b\.txt\s+/.test(rows[1]) && /^\s*2\s+k\/\s+/.test(rows[2]) && /^\s*3\s+a\.txt\s+/.test(rows[3]), rows.join('|'));
      t.ok(rows[1].includes(`${dir}/b.txt`));
      t.ok(rows[rows.length - 1].includes('3 öğe'));
      // restore: numara en yeniden eskiye
      const r = await run(sh, 'trash restore 1');
      t.eq(r.status, 0);
      t.eq(r.out, `'b.txt' geri yüklendi: ${dir}/b.txt\n`);
      t.eq(fs.readFile(`${dir}/b.txt`), 'B');
      t.eq(fs.trashCount(), 2);
      const bad = await run(sh, 'trash restore 9');
      t.eq(bad.status, 1);
      t.ok(bad.err.includes("'9'"));
      t.eq((await run(sh, 'trash restore')).status, 2);
      t.eq((await run(sh, 'trash restore hepsi')).status, 0);
      t.eq(fs.trashCount(), 0);
      t.eq([fs.isDir(`${dir}/k`), fs.exists(`${dir}/a.txt`)], [true, true]);
      // rm <n>
      await run(sh, 'rm a.txt');
      t.eq((await run(sh, 'trash rm 1')).status, 0);
      t.eq(fs.trashCount(), 0);
      // empty
      await run(sh, 'rm b.txt');
      const noY = await run(sh, 'trash empty');
      t.eq(noY.status, 1);
      t.ok(noY.err.includes('trash empty -y'));
      t.eq(fs.trashCount(), 1, '-y olmadan boşaltılmaz');
      const y = await run(sh, 'trash empty -y');
      t.eq([y.status, y.out], [0, 'Çöp kutusu boşaltıldı (1 öğe).\n']);
      t.eq(fs.trashCount(), 0);
      t.eq(await outOf(sh, 'trash empty -y'), 'Çöp kutusu zaten boş.\n');
      t.eq((await run(sh, 'trash foo')).status, 2);
    } finally { cleanup(dir); }
  });

  T.test('history komutu ve exit/clear kancaları', async (t) => {
    const sh = shellAt();
    let cleared = 0;
    let exited = 0;
    let hist = ['ls', 'cd ~', 'neofetch'];
    sh.host.history = () => hist;
    sh.host.clearHistory = () => { hist = []; };
    sh.host.clear = () => { cleared++; };
    sh.host.exit = () => { exited++; };
    t.eq(await outOf(sh, 'history'), '    1  ls\n    2  cd ~\n    3  neofetch\n');
    t.eq(await outOf(sh, 'history 2'), '    2  cd ~\n    3  neofetch\n');
    await run(sh, 'history -c');
    t.eq(hist, []);
    await run(sh, 'clear');
    await run(sh, 'cls');
    t.eq(cleared, 2);
    await run(sh, 'exit');
    t.eq([exited, sh.exited], [1, true]);
    t.eq((await run(sh, 'history x')).status, 2);
  });

  // ------------------------------------------------------------------ katman 1: tamamlama ve renklendirme
  T.test('complete: komut adları, yollar, boşluk kaçışı, dizin "/", ortak önek, tırnak', async (t) => {
    const dir = sandbox({
      'Beni Oku.txt': '', 'Belgeler/a.txt': '', 'Belgeler/b.txt': '', 'Belge-yedek/x': '', 'foto.png': '', 'foto2.png': '',
      '.gizli': '', 'tek/ic.txt': '', 'Uygulama.app': '{}'
    });
    try {
      const sh = shellAt(dir);
      const C = (line, caret) => S().complete(sh, line, caret);
      // komut adları
      let r = C('neof');
      t.eq([r.unique, r.replacement], [true, 'neofetch ']);
      r = C('gre');
      t.eq(r.replacement, 'grep ');
      r = C('tre');
      t.eq(r.replacement, 'tree ');
      r = C('pand');
      t.ok(r.cands.map((c) => c.full).sort().join() === 'pandasay', JSON.stringify(r.cands.map((c) => c.full)));
      r = C('he');
      t.ok(r.cands.map((c) => c.full).includes('head') && r.cands.map((c) => c.full).includes('help'));
      t.eq(r.replacement, null, 'ortak önek zaten yazıldı: değişiklik yok');
      t.eq(C('xyzq').cands.length, 0);
      r = C('l');
      t.ok(r.cands.length > 2 && r.cands.every((c) => c.full.startsWith('l')), 'l ile başlayanlar');
      // boru sonrası da komut adı
      t.eq(C('ls | wc').cands.map((c) => c.full).sort().join(), 'wc');
      t.eq(C('echo a && gre').replacement, 'grep ');
      t.eq(C('echo a ; neof').replacement, 'neofetch ');
      // yol: tek aday, dosya → boşluk ekler; kaçış
      r = C('cat Beni');
      t.eq(r.replacement, 'cat_'.slice(4) + 'Beni\\ Oku.txt '.slice(0));
      t.eq(r.unique, true);
      // dizin → "/" ve boşluk yok
      r = C('cd tek');
      t.eq(r.replacement, 'tek/');
      t.eq(r.unique, true);
      r = C('cd tek/');
      t.eq(r.cands.length, 0, 'cd yalnızca klasör tamamlar');
      r = C('ls tek/');
      t.eq(r.replacement, 'tek/ic.txt ');
      // ortak önek: foto ve foto2.png
      r = C('ls foto');
      t.eq(r.unique, false);
      t.eq(r.cands.map((c) => c.full), ['foto.png', 'foto2.png']);
      t.eq(r.replacement, null);
      r = C('ls Bel');
      t.eq(r.cands.map((c) => c.full).sort(), ['Belge-yedek/', 'Belgeler/']);
      t.eq(r.replacement, 'Belge', 'ortak öneke kadar uzar');
      // büyük/küçük harf duyarsız yedek
      r = C('cd belgel');
      t.eq(r.replacement, 'Belgeler/');
      // gizli dosyalar yalnızca nokta ile
      t.ok(!C('ls ').cands.some((c) => c.name.startsWith('.')));
      t.ok(C('ls .').cands.some((c) => c.name === '.gizli'));
      // ~ ve ~/
      t.eq(C('cd ~').replacement, '~/');
      const home = C('cd ~/Bel');
      t.eq(home.replacement, '~/Belgeler/');
      t.eq(C('ls ~/Belgeler/Pro').replacement, '~/Belgeler/Projeler/');
      t.eq(C('ls /et').replacement, '/etc/');
      t.eq(C('cat /etc/host').replacement, '/etc/hostname ');
      // tırnak içinde
      r = C('cat "Beni');
      t.eq(r.replacement, '"Beni Oku.txt" ');
      r = C("cat 'Beni");
      t.eq(r.replacement, "'Beni Oku.txt' ");
      // imleç ortada: sonrasındaki metin korunur, çift boşluk eklenmez
      r = C('cat Beni  yok.txt', 8);
      t.eq(r.replacement, 'Beni\\ Oku.txt');
      // argüman bağlamları
      t.eq(C('help gre').replacement, 'grep ');
      t.eq(C('theme li').replacement, 'light ');
      t.eq(C('trash res').replacement, 'restore ');
      t.ok(C('open cal').cands.some((c) => c.full === 'calculator'), 'open uygulama kimliği önerir');
      // yönlendirme hedefi yol
      t.eq(C('echo x > fot').cands.length, 2);
      t.eq(C('echo x > tek/i').replacement, 'tek/ic.txt ');
      // .app dosyaları
      t.ok(C('open Uyg').cands[0].ext === '.app');
      // boş satır: komutlar
      t.ok(C('').cands.length === shellAt().commandNames().length);
      // bölünmüş: caret 0
      t.ok(C('ls', 0).cands.length > 10);
    } finally { cleanup(dir); }
  });

  T.test('highlightClasses: komut, seçenek, dize, işleç', (t) => {
    const sh = shellAt();
    const cls = (line) => S().highlightClasses(line, sh);
    const c1 = cls('ls -la "a b" | grep x && foo');
    t.eq(c1.length, 'ls -la "a b" | grep x && foo'.length);
    t.eq(c1[0], 'hc');
    t.eq(c1[3], 'ho');
    t.eq(c1[7], 'hs');
    t.eq(c1[13], 'hp');
    t.eq(c1[15], 'hc');
    const line = 'ls -la "a b" | grep x && foo';
    t.eq(c1[line.indexOf('foo')], '', 'bilinmeyen komut renklendirilmez');
    t.eq(c1[line.indexOf('&&')], 'hp');
    t.eq(cls('echo $HOME')[6], 'hv');
    t.eq(cls('')[0], undefined);
    t.eq(cls('cat > out.txt')[4], 'hp');
    t.eq(cls('cat > out.txt')[6], '', 'yönlendirme hedefi komut sayılmaz');
  });

  T.test('ANSI → HTML: renkler, kalın, soluk, tersine, 256/truecolor, blok, kaçış', (t) => {
    const A = S();
    const h = (s) => A.ansiLineToHtml(s, A.newAnsiState());
    t.eq(h('düz'), 'düz');
    t.eq(h('<b>&'), '&lt;b&gt;&amp;');
    t.eq(h('\x1b[31mkırmızı\x1b[0m son'), '<span class="f1">kırmızı</span> son');
    t.eq(h('\x1b[1;34mdizin/\x1b[0m'), '<span class="b f4">dizin/</span>');
    t.eq(h('\x1b[2mgizli\x1b[22m'), '<span class="d">gizli</span>');
    t.eq(h('\x1b[92mparlak\x1b[0m'), '<span class="f10">parlak</span>');
    t.eq(h('\x1b[42m \x1b[0m'), '<span class="g2"> </span>');
    t.eq(h('\x1b[7mters\x1b[0m'), '<span class="inv-fg inv-bg">ters</span>');
    t.ok(h('\x1b[38;2;10;20;30mx').includes('color:rgb(10,20,30)'));
    t.ok(h('\x1b[48;5;196mx').includes('background:rgb(255,0,0)'));
    t.ok(h('\x1b[38;5;3mx').includes('class="f3"'));
    t.eq(h('\x1b[4;3;9mx'), '<span class="i u s">x</span>');
    t.ok(h('\x1b[38;2;1;2;3;48;2;4;5;6m▀').includes('linear-gradient(rgb(1,2,3) 50%,rgb(4,5,6) 50%)'), 'yarım blok degrade');
    t.ok(h('\x1b[31m█').includes('background:var(--c1)'));
    t.eq(h('\x1b[2J\x1b[Hmetin'), 'metin', 'imleç dizileri atılır');
    // durum satırlar arasında taşınır
    const st = A.newAnsiState();
    t.eq(A.ansiLineToHtml('\x1b[32milk', st), '<span class="f2">ilk</span>');
    t.eq(A.ansiLineToHtml('ikinci', st), '<span class="f2">ikinci</span>');
    t.eq(A.ansiLineToHtml('\x1b[0mson', st), 'son');
    t.eq(A.ansiToHtml('a\nb'), '<div class="t-line">a</div><div class="t-line">b</div>');
    t.eq(A.stripAnsi('\x1b[1;31mA\x1b[0mB'), 'AB');
  });

  T.test('yardımcılar: shQuote, strftime, fmtLsDate, wrapText, splitLines', (t) => {
    const A = S();
    t.eq(A.shQuote('düz.txt'), 'düz.txt');
    t.eq(A.shQuote('Beni Oku.txt'), 'Beni\\ Oku.txt');
    t.eq(A.shQuote("a'b"), "a\\'b");
    t.eq(A.shQuote('~x'), '\\~x');
    t.eq(A.shQuote(''), "''");
    t.eq(A.splitLines('a\nb\n'), ['a', 'b']);
    t.eq(A.splitLines(''), []);
    t.eq(A.splitLines('a\r\nb'), ['a', 'b']);
    t.eq(A.joinLines(['a', 'b']), 'a\nb\n');
    t.eq(A.wrapText('bir iki üç dört', 7), ['bir iki', 'üç dört']);
    t.eq(A.wrapText('abcdefghij', 4), ['abcd', 'efgh', 'ij']);
    t.eq(A.strftime('%Y-%m-%d %H:%M:%S', new Date(2026, 9, 8, 14, 5, 9)), '2026-10-08 14:05:09');
    t.eq(A.strftime('%A %B', new Date(2026, 9, 8)), 'Perşembe Ekim');
    t.eq(A.fmtLsDate(new Date(2026, 9, 8, 19, 42).getTime() - 0 + (Date.now() - new Date(2026, 9, 8, 19, 42).getTime() > 182 * 86400000 ? 0 : 0)).length, 12);
    t.ok(/^\d\d [A-Za-zÇĞİÖŞÜçğıöşü]{3} \d\d:\d\d$/.test(A.fmtLsDate(Date.now() - 3600000)));
    t.ok(/^\d\d [A-Za-zÇĞİÖŞÜçğıöşü]{3}  \d{4}$/.test(A.fmtLsDate(Date.now() - 400 * 86400000)));
    t.eq(A.fmtDuration(0), '0 dk');
    t.eq(A.fmtDuration(125 * 60000), '2 saat, 5 dk');
    t.eq(A.fmtDuration(90000000), '1 gün, 1 saat');
  });

  // ------------------------------------------------------------------ katman 2: gerçek arayüz
  const typeAtCaret = (term, ch) => {
    const i = term.input;
    i.setRangeText(ch, i.selectionStart, i.selectionEnd, 'end');
    i.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
  };
  const key = (term, k, init) => T.key(term.input, k, init);
  const clearSelection = () => { const s = window.getSelection(); if (s) s.removeAllRanges(); };
  const lineEl = (term, needle) => Array.from(term.linesEl.children).find((el) => el.textContent.includes(needle));
  const selectNode = (el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  };
  const fakeClipboard = (initial) => {
    const state = { text: initial || '', written: null };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: async () => state.text,
        writeText: async (v) => { state.written = v; }
      }
    });
    state.restore = () => { try { delete navigator.clipboard; } catch (e) { /* ignore */ } };
    return state;
  };

  T.test('arayüz: açılış — motd, istem, başlık, odak, pencere boyutu', async (t) => {
    await withTerm({}, async ({ win, term, input, root }) => {
      t.ok(root.classList.contains('app-terminal') && root.classList.contains('wm-body'));
      const txt = textOf(term);
      t.ok(txt.includes('PandaOS 1.0 (Bambu) sistemine hoş geldin!'), 'motd yazıldı');
      t.ok(txt.includes("Komutların listesi için 'help' yazın."));
      t.eq(activeText(term), 'panda@pandaos:~$ ');
      t.eq(win.getTitle(), 'Terminal — ~');
      t.eq(document.activeElement, input, 'giriş kutusu odakta');
      t.ok(root.classList.contains('tm-focused'));
      t.eq(win.getBounds().width, 780);
      t.eq(win.getBounds().height, 500);
      t.eq([win.minWidth, win.minHeight], [420, 260]);
      t.eq(P.apps.get('terminal').singleInstance, false);
      t.eq(P.apps.get('terminal').name, 'Terminal');
      t.eq(P.apps.get('terminal').icon, 'terminal');
      t.eq(activeText(term).length, 'panda@pandaos:~$ '.length);
      t.eq(term.activeEl.querySelectorAll('.tm-cursor').length, 1);
      t.ok(term.activeEl.querySelector('.tm-cursor.tm-eol'), 'satır sonunda imleç');
      t.eq(getComputedStyle(root).backgroundColor, 'rgb(15, 17, 21)', 'kendi koyu renk düzeni');
    });
  });

  T.test('arayüz: açılış klasörü (cwd), dosya yolu, geçersiz yol, command argümanı', async (t) => {
    await withTerm({ cwd: '/home/panda/Belgeler' }, async ({ win, term }) => {
      t.eq(activeText(term), 'panda@pandaos:~/Belgeler$ ');
      t.eq(win.getTitle(), 'Terminal — ~/Belgeler');
      await term.run('pwd');
      t.ok(textOf(term).endsWith('/home/panda/Belgeler'));
    });
    await withTerm({ cwd: '/home/panda/Belgeler/Notlar.txt' }, async ({ win, term }) => {
      t.eq(term.shell.cwd, '/home/panda/Belgeler', 'dosya yolu verilirse klasörü');
    });
    await withTerm({ cwd: '/yok/boyle/bir/yer' }, async ({ term }) => {
      t.eq(term.shell.cwd, '/home/panda', 'geçersiz cwd → ev klasörü');
    });
    await withTerm({ cwd: '/etc' }, async ({ win, term }) => {
      t.eq(activeText(term), 'panda@pandaos:/etc$ ');
      t.eq(win.getTitle(), 'Terminal — /etc');
    });
    await withTerm({ command: 'echo selam' }, async ({ term }) => {
      await T.waitFor(() => textOf(term).includes('\nselam'));
      t.ok(textOf(term).includes('panda@pandaos:~$ echo selam'));
    });
  });

  T.test('arayüz: yaz + Enter → çıktı, istem, başlık cwd takibi, hata rengi, $ rengi', async (t) => {
    await withTerm({}, async ({ win, term, input }) => {
      typeLine(term, 'echo merhaba');
      t.eq(input.value, 'echo merhaba');
      t.eq(activeText(term), 'panda@pandaos:~$ echo merhaba');
      await enter(term);
      t.ok(textOf(term).includes('panda@pandaos:~$ echo merhaba\nmerhaba'), textOf(term).slice(-120));
      t.eq(input.value, '');
      t.eq(activeText(term), 'panda@pandaos:~$ ');
      await enter(term, 'cd Belgeler');
      t.eq(win.getTitle(), 'Terminal — ~/Belgeler');
      t.eq(activeText(term), 'panda@pandaos:~/Belgeler$ ');
      await enter(term, 'cd Projeler');
      t.eq(win.getTitle(), 'Terminal — ~/Belgeler/Projeler');
      await enter(term, 'cd /');
      t.eq(win.getTitle(), 'Terminal — /');
      await enter(term, 'cd');
      t.eq(win.getTitle(), 'Terminal — ~');
      // hata: kırmızı satır, $ kırmızı
      t.ok(!term.activeEl.querySelector('.tm-pd.tm-fail'));
      await enter(term, 'cat yok.txt');
      const errLine = lineEl(term, 'cat: yok.txt: Böyle bir dosya ya da dizin yok');
      t.ok(errLine && errLine.querySelector('.f9'), 'hata satırı parlak kırmızı');
      t.ok(term.activeEl.querySelector('.tm-pd.tm-fail'), 'başarısız komuttan sonra $ kırmızı');
      await enter(term, 'echo ok');
      t.ok(!term.activeEl.querySelector('.tm-pd.tm-fail'), 'başarılı komuttan sonra $ normal');
      // bilinmeyen komut
      await enter(term, 'foo');
      t.ok(textOf(term).includes('pandash: komut bulunamadı: foo'));
      await enter(term, 'echo $?');
      t.ok(textOf(term).endsWith('127\npanda@pandaos:~$ '.slice(0, 4)) || textOf(term).includes('echo $?\n127'), 'echo $? → 127');
      // boş Enter: yalnızca istem
      const n = term.lines();
      await enter(term);
      t.eq(term.lines(), n + 1);
      // renkli çıktı: ls klasörleri kalın mavi
      await enter(term, 'ls');
      const blue = term.linesEl.querySelector('.b.f4');
      t.ok(blue, 'ls: kalın mavi öğe');
      t.ok(Array.from(term.linesEl.querySelectorAll('.b.f4')).some((e) => e.textContent === 'Belgeler/'));
      // sözdizimi renkleri
      typeLine(term, 'ls -la "x y"');
      t.eq(term.activeEl.querySelector('.hc').textContent, 'ls');
      t.eq(term.activeEl.querySelector('.ho').textContent, '-la');
      t.eq(term.activeEl.querySelector('.hs').textContent, '"x y"');
      key(term, 'u', { ctrlKey: true });
      t.eq(input.value, '');
    });
  });

  T.test('arayüz: satır düzenleme — oklar, Home/End, Backspace/Delete, Ctrl+A/E/U/K/W, sözcük atlama', async (t) => {
    await withTerm({}, async ({ term, input }) => {
      const mirror = () => activeText(term);
      typeLine(term, 'abcdef');
      key(term, 'ArrowLeft'); key(term, 'ArrowLeft');
      t.eq(input.selectionStart, 4);
      typeAtCaret(term, 'X');
      t.eq(input.value, 'abcdXef');
      t.eq(mirror(), 'panda@pandaos:~$ abcdXef', 'ekran satırı girişi yansıtır');
      t.eq(input.selectionStart, 5);
      t.eq(term.activeEl.querySelector('.tm-cursor').textContent, 'e', 'imleç, imleçteki karakterin üstünde');
      key(term, 'Home');
      t.eq(input.selectionStart, 0);
      key(term, 'Delete');
      t.eq(input.value, 'bcdXef');
      key(term, 'End');
      t.eq(input.selectionStart, 6);
      key(term, 'Backspace');
      t.eq(input.value, 'bcdXe');
      key(term, 'ArrowRight');
      t.eq(input.selectionStart, 5, 'sağ ok sondan öteye geçmez');
      key(term, 'a', { ctrlKey: true });
      t.eq(input.selectionStart, 0);
      key(term, 'e', { ctrlKey: true });
      t.eq(input.selectionStart, 5);
      key(term, 'Backspace');
      key(term, 'Backspace');
      key(term, 'Backspace');
      key(term, 'Backspace');
      key(term, 'Backspace');
      key(term, 'Backspace');
      t.eq(input.value, '', 'boşken Backspace zarar vermez');
      // sözcükler
      typeLine(term, 'echo hello world');
      key(term, 'ArrowLeft', { ctrlKey: true });
      t.eq(input.selectionStart, 11);
      key(term, 'ArrowLeft', { ctrlKey: true });
      t.eq(input.selectionStart, 5);
      key(term, 'ArrowRight', { ctrlKey: true });
      t.eq(input.selectionStart, 10);
      key(term, 'End');
      key(term, 'w', { ctrlKey: true });
      t.eq(input.value, 'echo hello ');
      key(term, 'Backspace', { ctrlKey: true });
      t.eq(input.value, 'echo ');
      typeLine(term, 'abc def');
      key(term, 'Home');
      for (let i = 0; i < 8; i++) key(term, 'ArrowRight');
      key(term, 'Home');
      for (let i = 0; i < 3; i++) key(term, 'ArrowRight');
      key(term, 'k', { ctrlKey: true });
      t.eq(input.value, 'ech', 'Ctrl+K imleçten sona siler');
      key(term, 'u', { ctrlKey: true });
      t.eq(input.value, '', 'Ctrl+U imleçten başa siler');
      typeLine(term, 'komut argüman');
      key(term, 'ArrowLeft', { ctrlKey: true });
      key(term, 'u', { ctrlKey: true });
      t.eq(input.value, 'argüman', 'Ctrl+U yalnızca imlecin solunu siler');
      key(term, 'End');
      key(term, 'Escape');
      t.eq(input.value, '', 'Esc satırı temizler');
      // seçim silme
      typeLine(term, '0123456789');
      input.setSelectionRange(2, 5);
      key(term, 'Backspace');
      t.eq(input.value, '0156789');
      input.setSelectionRange(1, 3);
      key(term, 'Delete');
      t.eq(input.value, '06789');
      key(term, 'a', { ctrlKey: true });
      key(term, 'Delete', { ctrlKey: true });
      t.eq(input.value, '', 'Ctrl+Delete sonraki sözcüğü siler');
      // seçili metin varken sol/sağ ok seçimin kenarına gider
      typeLine(term, 'abcdef');
      input.setSelectionRange(2, 4);
      key(term, 'ArrowLeft');
      t.eq([input.selectionStart, input.selectionEnd], [2, 2]);
      input.setSelectionRange(2, 4);
      key(term, 'ArrowRight');
      t.eq([input.selectionStart, input.selectionEnd], [4, 4]);
      // emoji (vekil çift) tek karakter gibi silinir ve atlanır
      key(term, 'u', { ctrlKey: true }); key(term, 'k', { ctrlKey: true });
      input.value = '';
      typeLine(term, 'a😀b');
      key(term, 'ArrowLeft');
      key(term, 'ArrowLeft');
      t.eq(input.selectionStart, 1, 'emoji tek adımda atlanır');
      key(term, 'ArrowRight');
      key(term, 'Backspace');
      t.eq(input.value, 'ab', 'Backspace emojiyi bütün siler');
      // AltGr (= Ctrl+Alt) ile yazılan karakterler (Türkçe Q klavye: [ ] { } @) kısayol sanılmaz
      for (const ch of ['[', ']', '{', '}', '@', '\\', '|']) {
        const ev = T.key(input, ch, { ctrlKey: true, altKey: true });
        t.ok(!ev.defaultPrevented, `AltGr+${ch} doğal yazıma bırakılır`);
      }
      const keep = input.value;
      t.ok(!T.key(input, 'u', { ctrlKey: true, altKey: true }).defaultPrevented && input.value === keep, 'AltGr+U satırı silmez');
      t.ok(!T.key(input, 'c', { ctrlKey: true, altKey: true }).defaultPrevented, 'AltGr+C satırı iptal etmez');
      t.ok(!T.key(input, 'a', { ctrlKey: true, altKey: true }).defaultPrevented, 'AltGr+A imleci başa götürmez');
      // seçim vurgusu
      input.setSelectionRange(0, 1);
      key(term, 'Shift');
      input.dispatchEvent(new Event('select'));
      t.ok(term.activeEl.querySelector('.tm-sel'), 'seçili aralık vurgulanır');
      // uzun satır sarılır, yatay kaydırma olmaz
      input.setSelectionRange(2, 2);
      key(term, 'u', { ctrlKey: true }); key(term, 'k', { ctrlKey: true });
      typeLine(term, 'x'.repeat(400));
      t.ok(term.screen.scrollWidth <= term.screen.clientWidth + 1, 'yatay taşma yok');
      t.ok(term.activeEl.getBoundingClientRect().height > 40, 'uzun satır birden çok satıra sarıldı');
      key(term, 'c', { ctrlKey: true });
    });
  });

  T.test('arayüz: geçmiş — ↑/↓, taslak, kalıcılık, tekrar yok, 200 sınırı, history komutu', async (t) => {
    P.storage.remove('app.terminal.history');
    await withTerm({}, async ({ term, input }) => {
      await enter(term, 'echo bir');
      await enter(term, 'echo iki');
      await enter(term, 'echo iki');
      await enter(term, 'pwd');
      t.eq(P.storage.get('app.terminal.history'), ['echo bir', 'echo iki', 'pwd'], 'ardışık yinelenenler eklenmez');
      key(term, 'ArrowUp');
      t.eq(input.value, 'pwd');
      key(term, 'ArrowUp');
      t.eq(input.value, 'echo iki');
      key(term, 'ArrowUp');
      t.eq(input.value, 'echo bir');
      key(term, 'ArrowUp');
      t.eq(input.value, 'echo bir', 'en eskide durur');
      key(term, 'ArrowDown');
      t.eq(input.value, 'echo iki');
      key(term, 'ArrowDown');
      key(term, 'ArrowDown');
      t.eq(input.value, '', 'en sona gelince taslak (boş) geri gelir');
      // taslak korunur
      typeLine(term, 'yarım');
      key(term, 'ArrowUp');
      t.eq(input.value, 'pwd');
      key(term, 'ArrowDown');
      t.eq(input.value, 'yarım', 'yazılan taslak geri gelir');
      key(term, 'u', { ctrlKey: true });
      // Ctrl+P / Ctrl+N
      key(term, 'p', { ctrlKey: true });
      t.eq(input.value, 'pwd');
      key(term, 'n', { ctrlKey: true });
      t.eq(input.value, '');
      // geçmişten çalıştır
      key(term, 'ArrowUp');
      await enter(term);
      t.ok(textOf(term).endsWith('panda@pandaos:~$ pwd\n/home/panda'), 'geçmişten gelen komut çalıştı');
      // history komutu
      await enter(term, 'history');
      t.ok(/\n +1 {2}echo bir\n +2 {2}echo iki\n +3 {2}pwd\n +4 {2}pwd\n? ?/.test(textOf(term)) || textOf(term).includes('    1  echo bir'), 'history listesi');
      await enter(term, 'history | tail -1');
      t.ok(textOf(term).includes('history | tail -1\n') );
      await enter(term, 'history -c');
      t.eq(P.storage.get('app.terminal.history'), []);
      key(term, 'ArrowUp');
      t.eq(input.value, '', 'temizlenen geçmişte yukarı ok bir şey getirmez');
    });
    // 200 sınırı
    P.storage.set('app.terminal.history', Array.from({ length: 250 }, (_, i) => `echo ${i}`));
    await withTerm({}, async ({ term }) => {
      await term.run('echo yeni');
      const h = P.storage.get('app.terminal.history');
      t.eq(h.length, 200);
      t.eq(h[199], 'echo yeni');
      t.eq(h[0], 'echo 51');
    });
    // kalıcılık: yeni pencere önceki komutlara ↑ ile ulaşır
    await withTerm({}, async ({ term, input }) => {
      key(term, 'ArrowUp');
      t.eq(input.value, 'echo yeni');
      key(term, 'ArrowUp');
      t.eq(input.value, 'echo 249');
    });
    P.storage.remove('app.terminal.history');
  });

  T.test('arayüz: gri öneri (fish tarzı) — → / End ile kabul, metne karışmaz', async (t) => {
    P.storage.set('app.terminal.history', ['echo bir', 'ls -la ~/Belgeler', 'echo iki']);
    await withTerm({}, async ({ term, input }) => {
      typeLine(term, 'ls');
      const g = term.activeEl.querySelector('.tm-ghost');
      t.ok(g, 'öneri gösterilir');
      t.eq(g.dataset.ghost, ' -la ~/Belgeler');
      t.eq(activeText(term), 'panda@pandaos:~$ ls', 'öneri satırın metnine karışmaz');
      t.eq(getComputedStyle(g, '::before').content, '" -la ~/Belgeler"');
      key(term, 'ArrowRight');
      t.eq(input.value, 'ls -la ~/Belgeler', '→ öneriyi kabul eder');
      t.ok(!term.activeEl.querySelector('.tm-ghost'), 'kabulden sonra öneri yok');
      key(term, 'u', { ctrlKey: true });
      typeLine(term, 'ec');
      t.eq(term.activeEl.querySelector('.tm-ghost').dataset.ghost, 'ho iki', 'en yeni eşleşme');
      key(term, 'End');
      t.eq(input.value, 'echo iki', 'End de kabul eder');
      key(term, 'u', { ctrlKey: true });
      typeLine(term, 'echo bir');
      t.ok(!term.activeEl.querySelector('.tm-ghost'), 'tam eşleşmede öneri yok');
      key(term, 'ArrowLeft');
      t.ok(!term.activeEl.querySelector('.tm-ghost'), 'imleç satır sonunda değilken öneri yok');
      key(term, 'End');
      t.eq(input.value, 'echo bir', 'öneri yokken End yalnızca sona gider');
      key(term, 'u', { ctrlKey: true });
      typeLine(term, 'zzz');
      t.ok(!term.activeEl.querySelector('.tm-ghost'));
      key(term, 'c', { ctrlKey: true });
      // sorgusuz satırda öneri yok
      t.ok(!term.activeEl.querySelector('.tm-ghost'));
    });
    P.storage.remove('app.terminal.history');
  });

  T.test('arayüz: Ctrl+R geçmiş araması — bul, tekrar, Enter çalıştırır, → düzenlemeye alır, Esc geri alır', async (t) => {
    P.storage.set('app.terminal.history', ['echo bir', 'ls -la ~/Belgeler', 'echo iki', 'pwd', 'echo üç']);
    await withTerm({}, async ({ term, input }) => {
      typeLine(term, 'yarım');
      key(term, 'r', { ctrlKey: true });
      t.eq(input.value, '', 'sorgu boş başlar');
      t.ok(activeText(term).startsWith('(geçmiş-ara)'), activeText(term));
      typeLine(term, 'echo');
      t.eq(activeText(term), "(geçmiş-ara)'echo': echo üç");
      t.eq(term.activeEl.querySelector('.tm-hit').textContent, 'echo');
      key(term, 'r', { ctrlKey: true });
      t.eq(activeText(term), "(geçmiş-ara)'echo': echo iki", 'Ctrl+R bir önceki eşleşmeye geçer');
      key(term, 'r', { ctrlKey: true });
      t.eq(activeText(term), "(geçmiş-ara)'echo': echo bir");
      key(term, 'r', { ctrlKey: true });
      t.eq(activeText(term), "(başarısız geçmiş-ara)'echo': ", 'daha eski eşleşme yok');
      t.ok(term.activeEl.querySelector('.tm-search.tm-fail'));
      // sorguyu düzenle: yeniden en yeniden başlar
      key(term, 'Backspace');
      t.eq(input.value, 'ech');
      t.eq(activeText(term), "(geçmiş-ara)'ech': echo üç");
      // Esc: eski satır geri gelir
      key(term, 'Escape');
      t.eq(input.value, 'yarım');
      t.ok(!activeText(term).includes('geçmiş-ara'));
      key(term, 'u', { ctrlKey: true }); key(term, 'k', { ctrlKey: true });
      // → ile satıra al (çalıştırma)
      key(term, 'r', { ctrlKey: true });
      typeLine(term, 'Belge');
      t.eq(activeText(term), "(geçmiş-ara)'Belge': ls -la ~/Belgeler");
      key(term, 'ArrowRight');
      t.eq(input.value, 'ls -la ~/Belgeler');
      t.ok(!activeText(term).includes('geçmiş-ara'));
      t.ok(!textOf(term).includes('Projeler'), 'çalıştırılmadı');
      key(term, 'u', { ctrlKey: true });
      // Enter çalıştırır
      key(term, 'r', { ctrlKey: true });
      typeLine(term, 'pwd');
      key(term, 'Enter');
      await T.waitFor(() => !term.isBusy() && textOf(term).includes('panda@pandaos:~$ pwd'), 3000);
      t.ok(textOf(term).endsWith('panda@pandaos:~$ pwd\n/home/panda'));
      t.eq(input.value, '');
      // Ctrl+C aramayı iptal eder, satırı değil
      typeLine(term, 'abc');
      key(term, 'r', { ctrlKey: true });
      key(term, 'c', { ctrlKey: true });
      t.eq(input.value, 'abc');
      t.ok(!textOf(term).includes('abc^C'));
      key(term, 'u', { ctrlKey: true });
      // eşleşme yokken Enter hiçbir şey çalıştırmaz
      key(term, 'r', { ctrlKey: true });
      typeLine(term, 'hiçbirşeyyok');
      const n = term.lines();
      key(term, 'Enter');
      await T.sleep(20);
      t.eq(term.lines(), n);
      t.eq(input.value, '');
      // Ctrl+R tarayıcıyı yenilemez
      const ev = T.key(input, 'r', { ctrlKey: true });
      t.ok(ev.defaultPrevented);
      key(term, 'Escape');
    });
    P.storage.remove('app.terminal.history');
  });

  T.test('arayüz: !! geçmiş açılımı, $(…) ve $((…)) gerçek arayüzde', async (t) => {
    P.storage.set('app.terminal.history', []);
    await withTerm({}, async ({ term }) => {
      await term.run('echo ilk');
      await term.run('!!');
      t.ok(textOf(term).includes('panda@pandaos:~$ !!\necho ilk\nilk'), 'açılan komut ekrana yazılır');
      await term.run('!ec');
      t.ok(textOf(term).endsWith('!ec\necho ilk\nilk'));
      t.eq(P.storage.get('app.terminal.history'), ['echo ilk'], 'geçmişe açılmış komut yazılır (ardışık yineleme yok)');
      const bad = await term.run('!yokboyle');
      t.eq(bad, 1);
      const errRow = lineEl(term, 'pandash: !yokboyle: olay bulunamadı');
      t.ok(errRow && errRow.querySelector('.f9'));
      await term.run('echo "yıl: $(date +%Y)"');
      t.ok(textOf(term).endsWith(`yıl: ${new Date().getFullYear()}`));
      await term.run('cd Belgeler && echo $(pwd)');
      t.ok(textOf(term).endsWith('/home/panda/Belgeler'), 'cd sonrası $(pwd) güncel klasörü verir');
      await term.run('echo $((6*7))');
      t.ok(textOf(term).endsWith('\n42'));
      await term.run('echo $((1/0))');
      t.ok(textOf(term).includes('pandash: aritmetik hata: sıfıra bölme'));
      await term.run('echo $(echo x');
      t.ok(textOf(term).includes('eşleşmeyen parantez'));
    });
    P.storage.remove('app.terminal.history');
  });

  T.test('arayüz: Ctrl+C satırı iptal eder (^C), Ctrl+L ekranı temizler, clear komutu', async (t) => {
    clearSelection();
    await withTerm({}, async ({ term, input }) => {
      await enter(term, 'echo bir');
      typeLine(term, 'yarım komut');
      key(term, 'c', { ctrlKey: true });
      t.eq(input.value, '');
      t.ok(textOf(term).includes('panda@pandaos:~$ yarım komut^C'), 'ekranda ^C görünür');
      const hist = P.storage.get('app.terminal.history', []);
      t.ok(!hist.includes('yarım komut'), 'iptal edilen satır geçmişe girmez');
      await enter(term, 'echo $?');
      t.ok(textOf(term).includes('echo $?\n130'), '$? 130');
      // Ctrl+L
      typeLine(term, 'abc');
      t.ok(term.lines() > 3);
      key(term, 'l', { ctrlKey: true });
      t.eq(term.lines(), 0, 'ekran temizlendi');
      t.eq(input.value, 'abc', 'yazılan satır korunur');
      t.eq(activeText(term), 'panda@pandaos:~$ abc');
      key(term, 'u', { ctrlKey: true });
      await enter(term, 'echo x');
      t.ok(term.lines() >= 2);
      await enter(term, 'clear');
      t.eq(term.lines(), 0, 'clear komutu');
      t.eq(activeText(term), 'panda@pandaos:~$ ');
      await enter(term, 'cls');
      t.eq(term.lines(), 0);
    });
  });

  T.test('arayüz: çalışan komut — istem gizlenir, Ctrl+C keser, ileri yazma kuyruğa girer', async (t) => {
    await withTerm({}, async ({ win, term, input, root }) => {
      typeLine(term, 'sleep 30');
      key(term, 'Enter');
      await T.waitFor(() => term.isBusy());
      t.ok(root.classList.contains('tm-busy'));
      t.eq(getComputedStyle(term.activeEl).display, 'none', 'çalışırken istem gizli');
      key(term, 'c', { ctrlKey: true });
      await T.waitFor(() => !term.isBusy(), 3000);
      t.ok(textOf(term).includes('^C'));
      t.eq(term.shell.status, 130);
      t.ok(!root.classList.contains('tm-busy'));
      t.eq(getComputedStyle(term.activeEl).display, 'block', 'istem geri geldi');
      // ileri yazma: komut çalışırken yazılan satır sırayla çalışır
      typeLine(term, 'sleep 0.3');
      key(term, 'Enter');
      await T.waitFor(() => term.isBusy());
      typeLine(term, 'echo ileri');
      t.eq(input.value, 'echo ileri', 'çalışırken yazılabilir');
      key(term, 'Enter');
      t.eq(input.value, '');
      await T.waitFor(() => !term.isBusy() && textOf(term).includes('\nileri'), 4000);
      t.ok(textOf(term).includes('panda@pandaos:~$ echo ileri'));
      // Ctrl+C boştayken yalnızca satırı iptal eder
      key(term, 'c', { ctrlKey: true });
      t.eq(term.isBusy(), false);
      // sl: Ctrl+C ile durur
      typeLine(term, 'sl');
      key(term, 'Enter');
      await T.waitFor(() => term.isBusy());
      await T.sleep(150);
      t.ok(!term.linesEl.nextElementSibling.hidden, 'animasyon alanı görünür');
      key(term, 'c', { ctrlKey: true });
      await T.waitFor(() => !term.isBusy(), 3000);
      t.ok(term.linesEl.nextElementSibling.hidden, 'animasyon bitince alan gizlenir');
    });
  });

  T.test('arayüz: Tab — komut, yol, boşluk kaçışı, dizin, çift Tab ile aday listesi', async (t) => {
    const dir = sandbox({ 'Beni Oku.txt': '', 'Belgeler/a.txt': '', 'Belge-yedek/x': '', 'foto.png': '', 'foto2.png': '', 'tek/ic.txt': '' });
    try {
      await withTerm({ cwd: dir }, async ({ term, input }) => {
        typeLine(term, 'neof');
        key(term, 'Tab');
        t.eq(input.value, 'neofetch ');
        key(term, 'u', { ctrlKey: true });
        typeLine(term, 'cat Ben');
        key(term, 'Tab');
        t.eq(input.value, 'cat Beni\\ Oku.txt ');
        t.eq(input.selectionStart, input.value.length);
        key(term, 'u', { ctrlKey: true });
        typeLine(term, 'cd te');
        key(term, 'Tab');
        t.eq(input.value, 'cd tek/', 'klasör: sonuna / eklenir, boşluk yok');
        key(term, 'u', { ctrlKey: true });
        typeLine(term, 'ls foto');
        const before = term.lines();
        key(term, 'Tab');
        t.eq(input.value, 'ls foto', 'belirsiz: ilk Tab değiştirmez');
        t.eq(term.lines(), before, 'ilk Tab liste yazmaz');
        key(term, 'Tab');
        t.eq(input.value, 'ls foto');
        t.ok(term.lines() > before, 'çift Tab aday listesi yazar');
        const listing = textOf(term).split('\n').slice(-3).join('\n');
        t.ok(textOf(term).split('\n').some((l) => l.endsWith('$ ls foto')), 'komut satırı aday listesinden önce yeniden yazılır');
        t.ok(listing.includes('foto.png') && listing.includes('foto2.png'), listing);
        // ortak önek: Bel → Belge, ikinci Tab liste
        key(term, 'u', { ctrlKey: true });
        typeLine(term, 'ls Bel');
        key(term, 'Tab');
        t.eq(input.value, 'ls Belge');
        key(term, 'Tab');
        const tail = textOf(term).split('\n').slice(-3).join('\n');
        t.ok(tail.includes('Belge-yedek/') && tail.includes('Belgeler/'), tail);
        // liste renkli: klasörler kalın mavi
        t.ok(Array.from(term.linesEl.querySelectorAll('.b.f4')).some((e) => e.textContent === 'Belgeler/'));
        key(term, 'u', { ctrlKey: true });
        // aday yok: sessiz
        typeLine(term, 'ls zzzz');
        const n = term.lines();
        key(term, 'Tab'); key(term, 'Tab');
        t.eq([input.value, term.lines()], ['ls zzzz', n]);
        key(term, 'u', { ctrlKey: true });
        // imleç ortada: sonrasını korur
        typeLine(term, 'cat Beni yok');
        input.setSelectionRange(8, 8);
        key(term, 'Tab');
        t.eq(input.value, 'cat Beni\\ Oku.txt yok');
        key(term, 'u', { ctrlKey: true }); key(term, 'k', { ctrlKey: true });
        // tırnak içi
        typeLine(term, 'cat "Beni');
        key(term, 'Tab');
        t.eq(input.value, 'cat "Beni Oku.txt" ');
        key(term, 'u', { ctrlKey: true });
        // Tab sonrası komutu çalıştır
        typeLine(term, 'cat Beni');
        key(term, 'Tab');
        await enter(term);
        t.ok(!textOf(term).includes('Böyle bir dosya'), 'tamamlanan yol gerçekten var');
        t.eq(term.shell.status, 0);
      });
    } finally { cleanup(dir); }
  });

  T.test('arayüz: yapıştırma — Ctrl+V olayı, çok satır, imleç konumu', async (t) => {
    await withTerm({}, async ({ term, input }) => {
      const paste = (text) => {
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        input.dispatchEvent(ev);
        return ev;
      };
      const ev = paste('echo yapıştırıldı');
      t.ok(ev.defaultPrevented);
      t.eq(input.value, 'echo yapıştırıldı');
      key(term, 'u', { ctrlKey: true });
      // imleç ortada
      typeLine(term, 'echo ');
      typeLine(term, 'son');
      input.setSelectionRange(5, 5);
      paste('orta ');
      t.eq(input.value, 'echo orta son');
      t.eq(input.selectionStart, 10, 'imleç yapıştırılan metnin sonunda');
      key(term, 'u', { ctrlKey: true }); key(term, 'k', { ctrlKey: true });
      input.value = '';
      // çok satır: ilk satırlar çalışır, sonuncusu satırda kalır
      paste('echo bir\necho iki\necho üç');
      await T.waitFor(() => !term.isBusy() && textOf(term).includes('\niki'), 4000);
      t.ok(textOf(term).includes('echo bir\nbir') && textOf(term).includes('echo iki\niki'));
      t.eq(input.value, 'echo üç', 'son satır çalıştırılmadan bekler');
      key(term, 'u', { ctrlKey: true });
      // sondaki satır sonu: hepsi çalışır
      paste('echo a\r\necho b\r\n');
      await T.waitFor(() => !term.isBusy() && textOf(term).includes('echo b\nb'), 4000);
      t.eq(input.value, '');
      // boş yapıştırma
      paste('');
      t.eq(input.value, '');
      // term.pasteText doğrudan
      term.pasteText('abc');
      t.eq(input.value, 'abc');
      key(term, 'c', { ctrlKey: true });
    });
  });

  T.test('arayüz: kopyalama — seçili çıktı + Ctrl+Shift+C / Ctrl+C, seçim varken Ctrl+C iptal etmez', async (t) => {
    const clip = fakeClipboard();
    try {
      await withTerm({}, async ({ win, term, input }) => {
        await enter(term, 'echo kopyalanacak metin');
        const el = lineEl(term, 'kopyalanacak metin\n'.trim());
        const out = Array.from(term.linesEl.children).find((c) => c.textContent === 'kopyalanacak metin');
        selectNode(out);
        key(term, 'C', { ctrlKey: true, shiftKey: true });
        t.eq(term.lastClip(), 'kopyalanacak metin');
        await T.waitFor(() => clip.written === 'kopyalanacak metin');
        // Ctrl+C seçim varken kopyalar, satırı iptal etmez
        typeLine(term, 'yazılan');
        selectNode(out);
        term.lastClip();
        key(term, 'c', { ctrlKey: true });
        t.eq(input.value, 'yazılan', 'seçim varken Ctrl+C satırı silmez');
        t.ok(!textOf(term).includes('yazılan^C'));
        clearSelection();
        // Ctrl+Insert
        selectNode(out);
        key(term, 'Insert', { ctrlKey: true });
        t.eq(term.lastClip(), 'kopyalanacak metin');
        clearSelection();
        // seçim yok → Ctrl+C iptal eder
        key(term, 'c', { ctrlKey: true });
        t.eq(input.value, '');
        t.ok(textOf(term).includes('yazılan^C'));
        // giriş satırındaki seçim de kopyalanır
        typeLine(term, 'abcdef');
        input.setSelectionRange(1, 4);
        key(term, 'C', { ctrlKey: true, shiftKey: true });
        t.eq(term.lastClip(), 'bcd');
        key(term, 'c', { ctrlKey: true });
        // odak input dışındayken (win.el) kısayol çalışır
        selectNode(out);
        win.el.focus();
        t.eq(document.activeElement, win.el);
        T.key(win.el, 'C', { ctrlKey: true, shiftKey: true });
        t.eq(term.lastClip(), 'kopyalanacak metin');
        clearSelection();
      });
    } finally { clip.restore(); clearSelection(); }
  });

  T.test('arayüz: fare — tıklama girişe odaklar, seçim varken odak çalınmaz, dışarıdan yazma', async (t) => {
    await withTerm({}, async ({ win, term, input }) => {
      await enter(term, 'echo seçilebilir');
      const out = Array.from(term.linesEl.children).find((c) => c.textContent === 'seçilebilir');
      input.blur();
      clearSelection();
      T.mouse(term.screen, 'mouseup', { button: 0 });
      t.eq(document.activeElement, input, 'boş yere tıklama girişe odaklar');
      // seçim varken tıklama bırakma odağı bozmaz
      input.blur();
      win.el.focus();
      selectNode(out);
      T.mouse(term.screen, 'mouseup', { button: 0 });
      t.ok(document.activeElement !== input, 'seçim varken giriş odağı çalınmaz');
      t.eq(window.getSelection().toString(), 'seçilebilir');
      // odak pencere gövdesindeyken tuş girişe yönlenir
      clearSelection();
      T.key(win.el, 'Enter');
      await T.sleep(10);
      t.eq(document.activeElement, input, 'tuşa basınca giriş odaklanır');
      win.el.focus();
      T.key(win.el, 'x');
      t.eq(document.activeElement, input, 'yazdırılabilir tuş girişi odaklar');
      // pencere odak olayı
      win.el.focus();
      win.focus();
      win.blur && win.blur();
    });
  });

  T.test('arayüz: bağlam menüsü — Kopyala/Yapıştır/Tümünü seç/Temizle/Yazı boyutu', async (t) => {
    const clip = fakeClipboard('echo menüden');
    try {
      await withTerm({}, async ({ win, term, input }) => {
        await enter(term, 'echo menü testi');
        clearSelection();
        t.eq(P.contextMenu.isOpen(), false);
        T.contextmenu(term.screen);
        const menu = T.$('#context-menu-layer .ctx-menu');
        t.ok(menu, 'sağ tık menü açar');
        const labels = T.$$('.ctx-item > .ctx-label', menu).map((e) => e.textContent);
        t.eq(labels, ['Kopyala', 'Yapıştır', 'Tümünü seç', 'Ekranı temizle', 'Yazı boyutu', 'Komut geçmişini temizle']);
        const copyItem = T.$$('.ctx-item', menu)[0];
        t.ok(copyItem.classList.contains('disabled'), 'seçim yokken Kopyala pasif');
        // Yapıştır
        const pasteItem = T.$$('.ctx-item', menu).find((e) => e.textContent.includes('Yapıştır'));
        t.ok(pasteItem.textContent.includes('Ctrl+Shift+V'));
        T.click(pasteItem);
        await T.waitFor(() => input.value === 'echo menüden', 2000);
        t.eq(P.contextMenu.isOpen(), false, 'seçimden sonra menü kapanır');
        key(term, 'u', { ctrlKey: true });
        // Tümünü seç + Kopyala etkin
        T.contextmenu(term.screen);
        let m2 = T.$('#context-menu-layer .ctx-menu');
        T.click(T.$$('.ctx-item', m2).find((e) => e.textContent.includes('Tümünü seç')));
        t.ok(window.getSelection().toString().includes('menü testi'), 'tüm çıktı seçildi');
        T.contextmenu(term.screen);
        m2 = T.$('#context-menu-layer .ctx-menu');
        const copyEnabled = T.$$('.ctx-item', m2)[0];
        t.ok(!copyEnabled.classList.contains('disabled'), 'seçim varken Kopyala etkin');
        T.click(copyEnabled);
        t.ok(term.lastClip().includes('menü testi'));
        clearSelection();
        // Yazı boyutu alt menüsü
        T.contextmenu(term.screen);
        m2 = T.$('#context-menu-layer .ctx-menu');
        const sizeItem = T.$$('.ctx-item', m2).find((e) => e.textContent.includes('Yazı boyutu'));
        t.ok(sizeItem.getAttribute('aria-haspopup') === 'menu');
        P.contextMenu.hide();
        // Ekranı temizle
        T.contextmenu(term.screen);
        m2 = T.$('#context-menu-layer .ctx-menu');
        T.click(T.$$('.ctx-item', m2).find((e) => e.textContent.includes('Ekranı temizle')));
        t.eq(term.lines(), 0);
        // Geçmiş temizle
        t.ok(P.storage.get('app.terminal.history', []).length > 0);
        T.contextmenu(term.screen);
        m2 = T.$('#context-menu-layer .ctx-menu');
        T.click(T.$$('.ctx-item', m2).find((e) => e.textContent.includes('geçmişini temizle')));
        t.eq(P.storage.get('app.terminal.history'), []);
        await T.sleep(30);
        t.eq(document.activeElement, input, 'menü kapanınca odak girişe döner');
      });
    } finally { clip.restore(); clearSelection(); P.contextMenu.hide(); }
  });

  T.test('arayüz: yazı boyutu — Ctrl +/-/0, Ctrl+tekerlek, sınırlar, kalıcılık', async (t) => {
    P.storage.remove('app.terminal');
    await withTerm({}, async ({ term, root }) => {
      t.eq(term.fontSize(), 14);
      t.eq(getComputedStyle(term.screen).fontSize, '14px');
      key(term, '=', { ctrlKey: true });
      t.eq(term.fontSize(), 15);
      t.eq(getComputedStyle(term.screen).fontSize, '15px');
      key(term, '+', { ctrlKey: true, shiftKey: true });
      t.eq(term.fontSize(), 16);
      key(term, '-', { ctrlKey: true });
      t.eq(term.fontSize(), 15);
      t.eq(P.storage.get('app.terminal').fontSize, 15);
      term.screen.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true }));
      t.eq(term.fontSize(), 16);
      const wheel = new WheelEvent('wheel', { deltaY: 100, ctrlKey: true, bubbles: true, cancelable: true });
      term.screen.dispatchEvent(wheel);
      t.ok(wheel.defaultPrevented, 'Ctrl+tekerlek tarayıcı yakınlaştırmasını engeller');
      t.eq(term.fontSize(), 15);
      const plain = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
      term.screen.dispatchEvent(plain);
      t.eq([plain.defaultPrevented, term.fontSize()], [false, 15], 'Ctrl yokken tekerlek kaydırır');
      for (let i = 0; i < 30; i++) key(term, '=', { ctrlKey: true });
      t.eq(term.fontSize(), 28, 'üst sınır');
      for (let i = 0; i < 40; i++) key(term, '-', { ctrlKey: true });
      t.eq(term.fontSize(), 10, 'alt sınır');
      key(term, '0', { ctrlKey: true });
      t.eq(term.fontSize(), 14);
      key(term, '=', { ctrlKey: true });
      key(term, '=', { ctrlKey: true });
      t.eq(term.fontSize(), 16);
    });
    await withTerm({}, async ({ term }) => {
      t.eq(term.fontSize(), 16, 'yeni pencere kayıtlı boyutu kullanır');
      key(term, '0', { ctrlKey: true });
    });
    P.storage.remove('app.terminal');
  });

  T.test('arayüz: kaydırma geçmişi 2000 satırla sınırlı, uzun çıktı donmaz, otomatik alta kaydırma', async (t) => {
    await withTerm({}, async ({ term }) => {
      const t0 = Date.now();
      await term.run('seq 3000');
      t.ok(Date.now() - t0 < 5000, `3000 satır ${Date.now() - t0} ms`);
      t.eq(term.lines(), 2000, 'en fazla 2000 satır');
      const rows = Array.from(term.linesEl.children);
      t.eq(rows[rows.length - 1].textContent, '3000');
      t.eq(rows[0].textContent, '1001', 'en eski satırlar atıldı');
      t.ok(term.screen.scrollTop + term.screen.clientHeight >= term.screen.scrollHeight - 4, 'en alta kaydırıldı');
      await term.run('seq 100000 | tail -3');
      t.eq(term.lines(), 2000);
      const t1 = Date.now();
      await term.run('seq 100000');
      t.ok(Date.now() - t1 < 8000, `100000 satır ${Date.now() - t1} ms`);
      t.eq(term.lines(), 2000);
      t.eq(term.linesEl.lastElementChild.textContent, '100000');
      t.ok(Array.from(term.linesEl.children).length === term.lines());
      // yukarı kaydırınca yeni çıktı konumu bozmaz
      term.screen.scrollTop = 0;
      term.screen.dispatchEvent(new Event('scroll'));
      await T.sleep(10);
      // yazmaya başlayınca alta iner
      typeLine(term, 'a');
      t.ok(term.screen.scrollTop + term.screen.clientHeight >= term.screen.scrollHeight - 4, 'yazınca alta iner');
      key(term, 'c', { ctrlKey: true });
      // PageUp / PageDown
      term.screen.scrollTop = 1000;
      key(term, 'PageUp');
      t.ok(term.screen.scrollTop < 1000);
      key(term, 'PageDown');
      key(term, 'Home', { ctrlKey: true });
      t.eq(term.screen.scrollTop, 0);
      key(term, 'End', { ctrlKey: true });
      t.ok(term.screen.scrollTop > 0);
    });
  }, 60000);

  T.test('arayüz: pencere boyutları — en küçük/büyük/ekranı kaplayan; sütun ölçümü; yatay taşma yok', async (t) => {
    await withTerm({}, async ({ win, term }) => {
      await term.run('ls -l ~/Belgeler');
      win.setSize(420, 260);
      const b = win.getBounds();
      t.eq([b.width, b.height], [420, 260], 'en küçük boyut');
      await T.sleep(30);
      const small = term.measureCols();
      t.ok(small >= 40 && small < 60, `küçük pencere sütunları: ${small}`);
      t.ok(term.screen.scrollWidth <= term.screen.clientWidth + 1, 'küçük pencerede yatay taşma yok');
      await term.run('ls ~');
      const lsRows = Array.from(term.linesEl.children).slice(-3).map((e) => e.textContent);
      t.ok(lsRows.every((l) => [...l].length <= small), 'ls küçük pencerede sütun sayısına sığar: ' + lsRows.map((l) => [...l].length).join(','));
      win.setSize(1300, 800);
      await T.sleep(30);
      const big = term.measureCols();
      t.ok(big > small * 2, `büyük pencere sütunları: ${big}`);
      await term.run('ls ~');
      const wide = Array.from(term.linesEl.children).slice(-2);
      t.ok(wide.filter((e) => e.textContent.includes('Belgeler/')).length === 1, 'geniş pencerede ls tek satır');
      win.maximize();
      await T.sleep(30);
      t.ok(win.isMaximized());
      t.ok(term.measureCols() >= big - 2);
      t.ok(term.screen.getBoundingClientRect().height > 600, 'ekran gövdeyi doldurur');
      win.restore();
      win.setSize(780, 500);
    });
  });

  T.test('arayüz: iki pencere birbirinden bağımsız; dosya sistemi ve geçmiş ortak; fs:change olayları', async (t) => {
    const dir = sandbox({ 'x.txt': 'x' });
    const events = [];
    const off = P.bus.on('fs:change', (e) => events.push(e));
    try {
      const A = openTerm({ cwd: dir });
      const B = openTerm({});
      try {
        t.ok(A.win !== B.win && A.term.shell !== B.term.shell);
        t.eq(A.win.getTitle().startsWith('Terminal — /tmp/'), true);
        t.eq(B.win.getTitle(), 'Terminal — ~');
        await A.term.run('touch yeni.txt && mkdir kl');
        t.ok(events.some((e) => e.type === 'create' && e.path === `${dir}/yeni.txt`), 'touch fs:change yayar');
        t.ok(events.some((e) => e.type === 'mkdir' && e.path === `${dir}/kl`), 'mkdir fs:change yayar');
        await B.term.run(`ls ${dir}`);
        t.ok(textOf(B.term).includes('yeni.txt') && textOf(B.term).includes('kl'), 'B, A\'nın değişikliğini görür');
        // cwd bağımsız
        await A.term.run('cd kl');
        t.eq(A.win.getTitle().endsWith('/kl'), true);
        t.eq(B.win.getTitle(), 'Terminal — ~');
        // geçmiş ortak
        await A.term.run('echo ortak-geçmiş');
        T.key(B.input, 'ArrowUp');
        t.eq(B.input.value, 'echo ortak-geçmiş');
        T.key(B.input, 'u', { ctrlKey: true });
        // dosya yöneticisi gibi dışarıdan silinen çalışma klasörü: istem ve başlık güncellenir
        fs.remove(`${dir}/kl`, { recursive: true });
        await T.waitFor(() => A.win.getTitle() === `Terminal — ${dir}`, 2000);
        t.eq(A.term.shell.cwd, dir);
        t.eq(activeText(A.term), `panda@pandaos:${dir}$ `);
      } finally { A.win.forceClose(); B.win.forceClose(); }
    } finally { off(); cleanup(dir); }
  });

  T.test('arayüz: dosya sürükle-bırak yolu komut satırına ekler', async (t) => {
    await withTerm({}, async ({ term, input }) => {
      const mk = (paths) => {
        const dt = new DataTransfer();
        dt.setData('application/x-pandaos-paths', JSON.stringify(paths));
        dt.setData('text/plain', paths.join('\n'));
        return dt;
      };
      const over = new DragEvent('dragover', { dataTransfer: mk(['/x']), bubbles: true, cancelable: true });
      term.screen.dispatchEvent(over);
      t.ok(over.defaultPrevented, 'dosya sürüklemeye izin verir');
      typeLine(term, 'cat ');
      const drop = new DragEvent('drop', { dataTransfer: mk(['/home/panda/Belgeler/Notlar.txt', '/home/panda/Belgeler/Alışveriş Listesi.txt', '/etc/motd']), bubbles: true, cancelable: true });
      term.screen.dispatchEvent(drop);
      t.ok(drop.defaultPrevented);
      t.eq(input.value, 'cat ~/Belgeler/Notlar.txt ~/Belgeler/Alışveriş\\ Listesi.txt /etc/motd ');
      await enter(term);
      t.ok(textOf(term).includes('Notlar\n======'), 'eklenen yollarla komut çalışır');
      // metin sürüklemeyi (dosya değil) yok sayar
      const dt = new DataTransfer();
      dt.setData('text/plain', 'düz metin');
      const over2 = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true });
      term.screen.dispatchEvent(over2);
      t.ok(!over2.defaultPrevented);
    });
  });

  T.test('arayüz: komutlar gerçek arayüzde — help, neofetch, tree, pandasay, hata iletileri', async (t) => {
    await withTerm({}, async ({ term }) => {
      await term.run('help');
      t.ok(textOf(term).includes('Dosya ve klasörler') && textOf(term).includes('Metin işleme'));
      await term.run('neofetch');
      t.ok(term.linesEl.querySelectorAll('.blk').length > 100, 'piksel panda blokları');
      t.ok(textOf(term).includes('Çekirdek: panda-kernel 1.0.0'));
      t.ok(term.linesEl.querySelector('.g1') && term.linesEl.querySelector('.g15') || term.linesEl.querySelector('.g9'), 'renk blokları');
      await term.run('tree -L 1 ~');
      t.ok(textOf(term).includes('├── Belgeler') && textOf(term).includes('└── Resimler') || textOf(term).includes('└── Müzik'));
      await term.run('pandasay Merhaba!');
      t.ok(textOf(term).includes('< Merhaba! >'));
      await term.run('ls /yok');
      t.ok(textOf(term).includes("ls: '/yok' erişilemiyor: Böyle bir dosya ya da dizin yok"));
      await term.run('echo "tırnak kapanmadı');
      t.ok(textOf(term).includes('pandash: eşleşmeyen tırnak: "'));
      await term.run('rm -rf /');
      t.ok(textOf(term).includes("rm: '/' silinemez — bu iyi bir fikir değil 🐼"));
      await term.run('echo -e "\\e[1;31mkalın kırmızı\\e[0m"');
      t.ok(Array.from(term.linesEl.querySelectorAll('.b.f1')).some((e) => e.textContent === 'kalın kırmızı'), 'echo -e ANSI renkleri');
    });
  });

  T.test('arayüz: sl animasyonu çizilir ve temizlenir', async (t) => {
    await withTerm({}, async ({ term }) => {
      const live = term.linesEl.nextElementSibling;
      let seen = 0;
      const mo = new MutationObserver(() => { if (!live.hidden && live.textContent.includes('E K S P R E S')) seen++; });
      mo.observe(live, { childList: true, characterData: true, attributes: true, subtree: true });
      await term.run('sl');
      mo.disconnect();
      t.ok(seen >= 3, `animasyon kareleri: ${seen}`);
      t.ok(live.hidden && live.textContent === '');
      t.eq(term.shell.status, 0);
    });
  }, 60000);

  T.test('arayüz: exit pencereyi kapatır; Ctrl+D boş satırda çıkar', async (t) => {
    const a = openTerm({});
    await a.term.run('exit');
    await T.waitFor(() => a.win.isClosed(), 2000);
    t.ok(a.win.isClosed());
    const b = openTerm({});
    key(b.term, 'd', { ctrlKey: true });
    await T.waitFor(() => b.win.isClosed(), 2000);
    t.ok(b.win.isClosed(), 'Ctrl+D boş satırda kapatır');
    const c = openTerm({});
    typeLine(c.term, 'abc');
    key(c.term, 'Home');
    key(c.term, 'd', { ctrlKey: true });
    t.eq(c.input.value, 'bc', 'Ctrl+D dolu satırda karakter siler');
    t.ok(!c.win.isClosed());
    c.win.forceClose();
  });

  T.test('arayüz: kapatma temizliği — çalışan komut iptal olur, dinleyiciler kalkar, hata yok', async (t) => {
    const errBefore = (window.__pandaErrors || []).length;
    const o = openTerm({ cwd: '/tmp' });
    typeLine(o.term, 'sleep 30');
    key(o.term, 'Enter');
    await T.waitFor(() => o.term.isBusy());
    o.win.forceClose();
    await T.sleep(60);
    t.ok(o.win.isClosed());
    t.eq(o.term.isBusy(), false, 'çalışan komut kapanışta iptal edildi');
    // fs:change dinleyicisi kalktı: çalışma klasörünü bozup olay yayınlayınca durum değişmez
    o.term.shell.cwd = '/tmp/yok-boyle-bir-yer';
    P.bus.emit('fs:change', { type: 'write', path: '/tmp', parents: ['/tmp'] });
    t.eq(o.term.shell.cwd, '/tmp/yok-boyle-bir-yer', 'kapalı pencere fs:change dinlemez');
    // kapanıştan sonra gelen çıktı DOM'a yazılmaz / hata vermez
    await o.term.run('echo kapali').catch(() => {});
    t.eq((window.__pandaErrors || []).length, errBefore, 'yeni JS hatası yok');
    // başka bir pencere etkilenmez
    await withTerm({}, async ({ term }) => {
      await term.run('echo canlı');
      t.ok(textOf(term).includes('canlı'));
    });
    // art arda aç/kapa: sızıntı yok
    for (let i = 0; i < 8; i++) {
      const w = openTerm({});
      await w.term.run('echo ' + i);
      w.win.forceClose();
    }
    t.eq(P.wm.byApp('terminal').length, 0);
  });

  T.test('arayüz: çıktı ANSI renkleri tema değişse de sabit koyu düzen; açık temada okunur', async (t) => {
    await withTerm({}, async ({ term, root }) => {
      await term.run('ls ~');
      P.theme.set('light');
      await T.sleep(20);
      const cs = getComputedStyle(root);
      t.eq(cs.backgroundColor, 'rgb(15, 17, 21)', 'açık OS temasında da koyu terminal');
      t.eq(cs.color, 'rgb(213, 216, 223)');
      const dir = Array.from(term.linesEl.querySelectorAll('.b.f4')).find((e) => e.textContent === 'Belgeler/');
      t.ok(dir);
      t.eq(getComputedStyle(dir).color, 'rgb(110, 168, 247)');
      t.eq(getComputedStyle(dir).fontWeight, '700');
      P.theme.set('dark');
      await T.sleep(20);
      t.eq(getComputedStyle(root).backgroundColor, 'rgb(15, 17, 21)');
    });
  });

  T.test('arayüz: erişilebilirlik ve yapı — roller, etiketler, gizli giriş kutusu', async (t) => {
    await withTerm({}, async ({ term, input, root }) => {
      t.eq(term.screen.getAttribute('role'), 'log');
      t.ok(term.screen.getAttribute('aria-label'));
      t.ok(input.getAttribute('aria-label'));
      t.eq(input.getAttribute('autocomplete'), 'off');
      t.eq(input.getAttribute('spellcheck'), 'false');
      t.eq(getComputedStyle(input).opacity, '0');
      t.eq(getComputedStyle(input).pointerEvents, 'none');
      t.ok(!root.querySelector('[title]'), 'yerel title özniteliği kullanılmıyor');
      t.eq(root.querySelectorAll('input').length, 1);
      // kök dışına sızan sınıf yok: tüm sınıflar tm- ile başlar ya da ANSI renk sınıfı
      const bad = Array.from(root.querySelectorAll('[class]')).map((e) => e.className).join(' ').split(/\s+/).filter((c) => c && !/^(tm-|f\d+$|g\d+$|b$|d$|i$|u$|s$|inv-|blk$|h[cosv]$|app-|wm-|selectable$)/.test(c));
      t.eq(bad, [], 'beklenmeyen sınıflar');
    });
  });
})();
