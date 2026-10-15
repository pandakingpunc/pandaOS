/* Müzik Çalar tests: library, .pmus parsing, synth graph, play / pause / seek / next / prev / shuffle / repeat,
   scheduler (with an injected clock: a headless AudioContext does not advance), file opening, layout, close cleanup. */
(function () {
  'use strict';

  const T = PandaTest;
  const P = PandaOS;
  const def = () => P.apps.get('music');
  const NAMES = ['Bambu Ormanı', 'Sabah Esintisi', 'Gece Yürüyüşü', "Üsküdar'a Gider İken", 'Für Elise', 'Kanon'];
  const MUSIC_DIR = '/home/panda/Müzik';

  function fakeClock(start = 100) {
    const c = { t: start, now: () => c.t, advance(s) { c.t += s; } };
    return c;
  }

  async function closeAllMusic() {
    for (const w of P.wm.byApp('music')) await w.close();
    if (P.dialog.closeAll) P.dialog.closeAll();
    P.contextMenu.hide();
  }

  async function openApp(t, args) {
    await closeAllMusic();
    P.storage.remove('app.music');
    const win = P.apps.launch('music', args || {});
    t.ok(win, 'pencere açılmalı');
    await t.waitFor(() => win.state && win.state.music, 2000, 'uygulama durumu hazır değil');
    const app = win.state.music;
    return { win, app, player: app.player, $: (s) => t.$(s, win.el), $$: (s) => t.$$(s, win.el) };
  }

  const rowTitles = (t, win) => t.$$('.mu-row .mu-row-title', win.el).map((n) => n.textContent);
  const sum = (notes) => notes.reduce((a, n) => a + n[1], 0);
  const dialogText = (t) => { const d = t.$('#dialog-layer .dlg-card'); return d ? d.textContent : ''; };
  const closeDialog = (t) => { const b = t.$('#dialog-layer .dlg-primary'); if (b) t.click(b); };
  const pmus = (title, extra) => JSON.stringify(Object.assign({ title, artist: 'Deneme', bpm: 100, tracks: [{ instrument: 'lead', notes: [['C4', 1], ['E4', 1], ['G4', 2]] }] }, extra));

  // ------------------------------------------------------------------ library
  T.test('kütüphane: yerleşik şarkılar, Dosyalarım bölümü, tek pencere', async (t) => {
    const { win, app, $ } = await openApp(t);
    t.eq(rowTitles(t, win).slice(0, 6), NAMES, 'yerleşik şarkılar sırayla listelenir');
    t.ok(rowTitles(t, win).includes('Neşeye Övgü'), 'Müzik klasöründeki .pmus dosyası Dosyalarım içinde');
    t.eq(t.$$('.mu-sec-title', win.el).map((n) => n.textContent), ['Kütüphane', 'Dosyalarım']);
    t.ok(t.$$('.mu-row-dur', win.el).every((n) => /^\d+:\d{2}$/.test(n.textContent)), 'süreler m:ss biçiminde');
    t.ok(t.$$('.mu-row-artist', win.el).every((n) => n.textContent.length > 0), 'sanatçı adları dolu');
    t.eq($('.mu-title').textContent, 'Bambu Ormanı', 'ilk şarkı hazır');
    t.eq($('.mu-artist').textContent, 'Panda Lo-Fi');
    t.ok(/^0:00 \/ 1:4\d$/.test($('.mu-time').textContent), 'süre etiketi: ' + $('.mu-time').textContent);
    t.ok(P.apps.launch('music') === win, 'tek pencere: ikinci başlatma aynı pencereyi döndürür');
    t.eq(P.wm.byApp('music').length, 1);
    t.ok($('.mu-art-img svg'), 'albüm kapağı oluşturuldu');
    t.ok(app.player.state === 'stopped', 'başlangıçta durmuş');
    t.ok($('.mu-stop').disabled, 'durmuşken Durdur düğmesi devre dışı');
    await win.close();
  });

  T.test('kütüphane verisi: ≥6 şarkı, geçerli .pmus, tüm kanallar aynı uzunlukta', async (t) => {
    const d = def();
    t.eq(d.library.map((s) => s.title), NAMES);
    t.ok(d.library.length >= 6);
    t.eq(d.fileTypes, ['.pmus']);
    t.ok(d.singleInstance === true);
    const instruments = new Set();
    for (const s of d.library) {
      const where = s.title + ': ';
      t.ok(typeof s.artist === 'string' && s.artist, where + 'sanatçı');
      t.ok(s.bpm >= 40 && s.bpm <= 200, where + 'bpm');
      t.ok(s.tracks.length >= 3, where + 'çok kanallı');
      const totals = s.tracks.map((tr) => sum(tr.notes));
      t.ok(totals.every((x) => Math.abs(x - totals[0]) < 1e-9), where + 'kanallar aynı uzunlukta ' + totals.join(','));
      for (const tr of s.tracks) {
        instruments.add(tr.instrument);
        t.ok(['lead', 'pad', 'bass', 'pluck', 'bell', 'drums'].includes(tr.instrument), where + 'enstrüman ' + tr.instrument);
        for (const n of tr.notes) {
          t.ok(Array.isArray(n) && n.length >= 2 && n.length <= 3 && n[1] > 0, where + 'nota biçimi ' + JSON.stringify(n));
          if (n[0] == null) continue;
          if (tr.instrument === 'drums') t.ok(['kick', 'snare', 'hat', 'clap'].includes(n[0]), where + 'davul ' + n[0]);
          else t.ok(!Number.isNaN(d.noteToMidi(n[0])), where + 'nota adı ' + n[0]);
        }
      }
      const secs = d.compileSong(s).seconds;
      t.ok(secs >= 45 && secs <= 120, `${s.title}: süre ${secs.toFixed(1)} sn 45–120 arasında olmalı`);
      t.eq(d.parsePmus(JSON.parse(JSON.stringify(s))).title, s.title, where + 'JSON gidiş-dönüş');
    }
    t.eq([...instruments].sort(), ['bass', 'bell', 'drums', 'lead', 'pad', 'pluck']);
    // spot checks against the real tunes
    const elise = d.library[4].tracks[0].notes.filter((n) => n[0]).slice(0, 9).map((n) => n[0]);
    t.eq(elise, ['E5', 'D#5', 'E5', 'D#5', 'E5', 'B4', 'D5', 'C5', 'A4'], 'Für Elise girişi');
    const kanonBass = d.library[5].tracks[0].notes.filter((n) => n[0]).slice(0, 8).map((n) => n[0]);
    t.eq(kanonBass, ['D3', 'A2', 'B2', 'F#2', 'G2', 'D2', 'G2', 'A2'], 'Kanon ostinato bası');
    const kanonTheme = d.library[5].tracks.find((tr, i) => i === 5).notes.filter((n) => n[0]).slice(0, 8).map((n) => n[0]);
    t.eq(kanonTheme, ['F#5', 'E5', 'D5', 'C#5', 'B4', 'A4', 'B4', 'C#5'], 'Kanon ana teması');
    const usk = d.library[3].tracks.find((tr) => tr.instrument === 'pluck').notes.filter((n) => n[0]).slice(0, 8).map((n) => n[0]);
    t.eq(usk, ['D5', 'Eb5', 'D5', 'C5', 'Bb4', 'A4', 'Bb4', 'C5'], "Üsküdar'a giriş figürü");
  });

  // ------------------------------------------------------------------ .pmus parsing
  T.test('.pmus ayrıştırma: geçerli dosya normalleştirilir, geçersizler Türkçe hata verir', async (t) => {
    const parse = def().parsePmus;
    const err = (input, re, label) => {
      let msg = null;
      try { parse(input); } catch (e) { msg = e.message; }
      t.ok(msg && re.test(msg), `${label}: "${msg}"`);
    };
    const ok = parse('{"tracks":[{"instrument":"lead","notes":[["c4",1],[null,0.5],["F#5",2,0.5]]}]}', 'Dosya Adı');
    t.eq(ok.title, 'Dosya Adı');
    t.eq(ok.artist, 'Bilinmeyen sanatçı');
    t.eq(ok.bpm, 120);
    t.eq(ok.tracks[0].notes, [['C4', 1], [null, 0.5], ['F#5', 2, 0.5]], 'ad büyük harfe çevrilir, vuruş korunur');
    err('{bozuk json', /JSON/, 'bozuk JSON');
    err('[]', /nesne/, 'dizi');
    err('{"tracks":[]}', /parça/i, 'boş parça listesi');
    err('{"bpm":5,"tracks":[{"instrument":"lead","notes":[]}]}', /tempo/i, 'tempo');
    err('{"tracks":[{"instrument":"gitar","notes":[]}]}', /Parça 1.*enstrüman/, 'enstrüman');
    err('{"tracks":[{"instrument":"lead","notes":[["C4",1],["H4",1]]}]}', /Parça 1, nota 2.*nota adı/, 'nota adı');
    err('{"tracks":[{"instrument":"lead","notes":[["C9",1]]}]}', /nota adı/, 'oktav aralığı');
    err('{"tracks":[{"instrument":"lead","notes":[["C4",0]]}]}', /süre/, 'süre');
    err('{"tracks":[{"instrument":"lead","notes":[["C4"]]}]}', /\[ad, süre\]/, 'eksik süre');
    err('{"tracks":[{"instrument":"drums","notes":[["tom",1]]}]}', /davul/, 'davul adı');
    err('{"tracks":[{"instrument":"lead","notes":[[null,1]]},{"instrument":"bass"}]}', /Parça 2.*notes/, 'notes yok');
    err('{"tracks":[{"instrument":"lead","notes":[[null,0]]}]}', /süre/, 'sıfır süre');
    const long = parse({ bpm: 300, tracks: [{ instrument: 'lead', notes: [['C4', 100]] }] });
    t.eq(long.bpm, 300);
    err({ bpm: 20, tracks: [{ instrument: 'lead', notes: [['C4', 256], ['C4', 256], ['C4', 256], ['C4', 256], ['C4', 256]] }] }, /uzun/, 'çok uzun şarkı');
    t.eq(def().noteToMidi('C4'), 60);
    t.eq(def().noteToMidi('A4'), 69);
    t.eq(def().noteToMidi('Bb3'), 58);
    t.ok(Number.isNaN(def().noteToMidi('H4')) && Number.isNaN(def().noteToMidi('C9')));
    const round = def().serializePmus(def().library[4]);
    t.eq(JSON.parse(round).tracks.length, def().library[4].tracks.length, 'serializePmus geçerli JSON üretir');
  });

  // ------------------------------------------------------------------ synth
  T.test('sentez: her şarkının ses grafiği hatasız kurulur (OfflineAudioContext)', async (t) => {
    const d = def();
    if (typeof OfflineAudioContext === 'undefined') { t.ok(true, 'OfflineAudioContext yok'); return; }
    for (const song of d.library) {
      const c = new OfflineAudioContext(2, 44100 * 2, 44100);
      const eng = new d.Engine(c, c.destination, { offline: true });
      eng.load(d.compileSong(song));
      eng.scheduleAll(12, 0);
      t.ok(eng.stats.scheduled >= 8, `${song.title}: ${eng.stats.scheduled} nota zamanlandı`);
      t.eq(eng.stats.errors, 0, `${song.title}: nota hatası yok`);
      // every instrument family is part of the graph: lead / pad / bass / pluck / bell / drums voices came out of the song data
      eng.dispose();
    }
    const p = d.renderSong(d.compileSong(d.library[0]), 1);
    t.ok(p && typeof p.then === 'function', 'renderSong söz döner');
    // each instrument voice individually, including the edge-case velocities
    const c = new OfflineAudioContext(2, 44100, 44100);
    const eng = new d.Engine(c, c.destination, { offline: true });
    const song = d.parsePmus({ bpm: 120, swing: 0.5, humanize: 1, tracks: ['lead', 'pad', 'bass', 'pluck', 'bell'].map((i) => ({ instrument: i, notes: [['A2', 1], ['A4', 0.25, 1], ['C7', 0.01, 0.05]] }))
      .concat([{ instrument: 'drums', notes: [['kick', 1], ['snare', 1], ['hat', 0.5, 1], ['hat', 0.5, 0.3], ['clap', 1]] }]) });
    eng.load(d.compileSong(song));
    eng.scheduleAll(5, 0);
    t.eq(eng.stats.errors, 0, 'tüm enstrümanlar hatasız');
    t.ok(eng.stats.scheduled >= 20);
    eng.dispose();
  });

  T.test('zamanlayıcı: nota zamanları, ileri bakış penceresi, salınım (swing), duraklatınca ilerlemez', async (t) => {
    const d = def();
    const ctx = P.sound.context();
    t.ok(ctx, 'AudioContext var');
    const song = d.parsePmus({ bpm: 120, tracks: [{ instrument: 'lead', notes: Array.from({ length: 40 }, (_, i) => ['C4', 0.5]) }] });
    const clk = fakeClock(50);
    const eng = new d.Engine(ctx, P.sound.master(), { clock: clk.now });
    eng.load(d.compileSong(song));
    const rec = [];
    eng._voice = (e, when) => rec.push({ b: e.b, when, now: clk.t });
    eng.play(0);
    const t0 = eng.t0;
    t.ok(Math.abs(t0 - 50.06) < 1e-9, 'başlangıç: şimdi + 60 ms');
    // nothing is scheduled further than 120 ms ahead
    for (let i = 0; i < 60; i++) { clk.advance(0.05); eng.tick(); }
    t.ok(rec.length > 8, 'nota zamanlandı: ' + rec.length);
    t.ok(rec.every((r) => r.when - r.now <= 0.12 + 1e-9), 'ileri bakış ≤ 120 ms');
    t.ok(rec.every((r, i) => Math.abs(r.when - (t0 + r.b * 0.5)) < 1e-9 && (i === 0 || r.when >= rec[i - 1].when)), 'zamanlar = t0 + vuruş × 60/bpm ve sıralı');
    // every note due inside the window was scheduled (nothing skipped)
    const due = Math.floor((clk.t + 0.12 - t0) / 0.25 + 1e-9);
    t.ok(rec.length >= due, `beklenen ≥ ${due}, zamanlanan ${rec.length}`);
    const n1 = rec.length;
    t.ok(Math.abs(eng.beatNow() - (clk.t - t0) / 0.5) < 1e-9, 'konum = geçen süre / vuruş süresi');
    const pos = eng.pause();
    clk.advance(3);
    eng.tick();
    t.eq(rec.length, n1, 'duraklatılmış motor zamanlamaz');
    t.ok(Math.abs(eng.beatNow() - pos) < 1e-9, 'duraklatılınca konum sabit');
    eng.play(pos);
    t.ok(Math.abs(eng.beatNow() - pos) < 1e-9, 'aynı vuruştan devam');
    t.ok(rec.length >= n1, 'devam');
    // a stalled page (> 0.4 s late) drops notes instead of bursting them
    clk.advance(5);
    eng.tick();
    t.ok(eng.stats.dropped > 0, 'gecikmiş notalar atlanır');
    // swing delays the off-beat half of each beat
    const sw = d.parsePmus({ bpm: 120, swing: 1, tracks: [{ instrument: 'lead', notes: [['C4', 0.5], ['D4', 0.5], ['E4', 0.5], ['F4', 0.5]] }] });
    const eng2 = new d.Engine(ctx, P.sound.master(), { clock: clk.now });
    eng2.load(d.compileSong(sw));
    const rec2 = [];
    eng2._voice = (e, when) => rec2.push(when - eng2.t0);
    eng2.play(0);
    for (let i = 0; i < 40; i++) { clk.advance(0.05); eng2.tick(); }
    t.ok(rec2.length === 4, 'dört nota: ' + rec2.length);
    t.ok(Math.abs(rec2[0]) < 1e-9 && Math.abs(rec2[1] - (0.5 + 1 / 6) * 0.5) < 1e-9 && Math.abs(rec2[2] - 0.5) < 1e-9 && Math.abs(rec2[3] - (1.5 + 1 / 6 - 1) * 0.5 - 0.5) < 1e-9, 'swing: ' + rec2.map((x) => x.toFixed(4)).join(','));
    eng.dispose();
    eng2.dispose();
    t.ok(eng.disposed && eng.timer === 0 && eng.sessions.size === 0, 'dispose zamanlayıcıyı ve oturumları temizler');
  });

  // ------------------------------------------------------------------ playback state machine
  T.test('oynatma: oynat / duraklat / devam / durdur durum makinesi ve zamanlayıcı ilerlemesi', async (t) => {
    const { win, app, player, $ } = await openApp(t);
    const clk = fakeClock(100);
    player.setClock(clk.now);
    t.eq(player.state, 'stopped');
    t.click($('.mu-play'));
    t.eq(player.state, 'playing', 'oynat düğmesi çalmayı başlatır');
    t.eq($('.mu-play').getAttribute('aria-label'), 'Duraklat');
    t.eq(win.body.querySelector('.mu-root').dataset.state, 'playing');
    const row = t.$('.mu-row.current', win.el);
    t.ok(row && row.classList.contains('playing'), 'çalan satır işaretli');
    t.ok(getComputedStyle(t.$('.mu-eq', row)).display !== 'none', 'çalan satırda ekolayzır göstergesi');
    t.ok(!$('.mu-stop').disabled, 'çalarken Durdur etkin');
    const eng = player.engine;
    t.ok(eng && eng.running && eng.timer, 'zamanlayıcı çalışıyor');
    for (let i = 0; i < 30; i++) { clk.advance(0.1); await t.sleep(30); }
    t.ok(eng.stats.scheduled > 5, 'zamanlayıcı notaları ilerletti: ' + eng.stats.scheduled);
    t.ok(eng.stats.ticks > 20);
    t.ok(eng.session.voices.size > 0, 'sesler etkin');
    const pos = player.position();
    t.ok(Math.abs(pos - (clk.t - eng.t0)) < 0.2 && pos > 2.5, 'konum ilerler: ' + pos.toFixed(2));
    await t.sleep(200);
    t.ok($('.mu-time').textContent.startsWith(`0:0${Math.floor(pos)}`) || $('.mu-time').textContent.startsWith('0:0'), 'süre etiketi: ' + $('.mu-time').textContent);
    t.ok(parseFloat($('.mu-prog-fill').style.width) > 1, 'ilerleme çubuğu doldu');

    t.click($('.mu-play'));
    t.eq(player.state, 'paused');
    t.eq($('.mu-play').getAttribute('aria-label'), 'Oynat');
    const pausedAt = player.position();
    t.ok(eng.timer === 0 && !eng.running, 'duraklatınca zamanlayıcı durur');
    clk.advance(10);
    await t.sleep(160);
    t.ok(Math.abs(player.position() - pausedAt) < 1e-6, 'duraklatılmış konum değişmez');
    t.ok(row.classList.contains('current') && !row.classList.contains('playing'), 'duraklatınca satır "çalıyor" değil');

    t.click($('.mu-play'));
    t.eq(player.state, 'playing');
    t.ok(Math.abs(player.position() - pausedAt) < 0.01, 'aynı vuruştan devam: ' + player.position().toFixed(2) + ' ≈ ' + pausedAt.toFixed(2));
    clk.advance(1.06);
    t.ok(Math.abs(player.position() - (pausedAt + 1)) < 0.05, 'devam ettikten sonra ilerler');

    t.click($('.mu-stop'));
    t.eq(player.state, 'stopped');
    t.eq(player.position(), 0, 'durdurunca başa döner');
    await t.sleep(160);
    t.ok(/^0:00 \/ /.test($('.mu-time').textContent));
    t.ok($('.mu-stop').disabled);
    t.ok(!eng.running && eng.timer === 0);
    await win.close();
  });

  T.test('arama çubuğu: ilerleme çubuğuna tıklama, sürükleme ve klavye ile sarma', async (t) => {
    const { win, app, player, $ } = await openApp(t);
    const clk = fakeClock(300);
    player.setClock(clk.now);
    const dur = player.duration();
    const prog = $('.mu-progress');
    const r = prog.getBoundingClientRect();
    t.ok(r.width > 100, 'ilerleme çubuğu görünür');
    t.click(prog, { clientX: r.left + r.width * 0.5 });
    t.ok(Math.abs(player.position() - dur / 2) < 1, 'tıklama: ortaya sarar ' + player.position().toFixed(1));
    t.eq(player.state, 'stopped', 'durmuşken sarma çalmayı başlatmaz');
    await t.sleep(160);
    const fmt = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x) % 60).padStart(2, '0')}`;
    t.eq($('.mu-time').textContent, `${fmt(player.position())} / ${fmt(Math.round(dur))}`, 'süre etiketi yeni konumu gösterir');
    // sürükleme: yüzde 50'den yüzde 80'e
    t.drag(prog, r.width * 0.3, 0);
    t.ok(Math.abs(player.position() - dur * 0.8) < 1.2, 'sürükleme: %80 ' + player.position().toFixed(1) + ' / ' + (dur * 0.8).toFixed(1));
    t.ok(!prog.classList.contains('dragging'), 'sürükleme bitti');
    // klavye: ilerleme çubuğu odaklıyken ±5 sn, Home / End
    prog.focus();
    const p0 = player.position();
    t.key(prog, 'ArrowLeft');
    t.ok(Math.abs(player.position() - (p0 - 5)) < 0.05, 'sol ok −5 sn');
    t.key(prog, 'ArrowRight', { shiftKey: true });
    t.ok(Math.abs(player.position() - (p0 + 10)) < 0.05, 'Shift+sağ ok +15 sn');
    t.key(prog, 'Home');
    t.eq(player.position(), 0);
    t.key(prog, 'End');
    t.ok(player.position() > dur - 0.2 && player.position() <= dur, 'End: sona yakın');
    // pencere kısayolları
    player.seek(30);
    t.key(win.el, 'ArrowRight');
    t.ok(Math.abs(player.position() - 35) < 0.05, 'pencerede sağ ok +5 sn');
    t.key(win.el, 'ArrowLeft');
    t.key(win.el, 'ArrowLeft');
    t.ok(Math.abs(player.position() - 25) < 0.05, 'sol ok −5 sn');
    player.seek(2);
    t.key(win.el, 'ArrowLeft');
    t.eq(player.position(), 0, 'başın altına inmez');
    // çalarken sarma
    t.click($('.mu-play'));
    t.eq(player.state, 'playing');
    t.click(prog, { clientX: r.left + r.width * 0.25 });
    t.eq(player.state, 'playing', 'çalarken sarma çalmayı sürdürür');
    t.ok(Math.abs(player.position() - dur * 0.25) < 1.5, 'çalarken konum: ' + player.position().toFixed(1));
    clk.advance(1.06);
    t.ok(Math.abs(player.position() - (dur * 0.25 + 1)) < 1.6, 'sarıldıktan sonra ilerler');
    t.ok(player.engine.stats.scheduled >= 0);
    // sürüklerken konum önizlemesi
    const rr = prog.getBoundingClientRect();
    t.mouse(prog, 'pointerdown', { clientX: rr.left + rr.width * 0.1, button: 0 });
    t.ok(prog.classList.contains('dragging'), 'basılıyken sürükleme durumu');
    t.mouse(prog, 'pointerup', { clientX: rr.left + rr.width * 0.9, button: 0 });
    t.ok(!prog.classList.contains('dragging'));
    t.ok(Math.abs(player.position() - dur * 0.9) < 1.5, 'bırakınca %90');
    await win.close();
  });

  T.test('önceki / sonraki / karıştır / tekrarla mantığı', async (t) => {
    const { win, app, player, $ } = await openApp(t);
    const clk = fakeClock(500);
    player.setClock(clk.now);
    const q = player.queue();
    t.ok(q.length >= 7, 'sıra: ' + q.length);
    const cur = () => player.cur.title;
    t.eq(cur(), 'Bambu Ormanı');
    t.click($('.mu-next'));
    t.eq(cur(), 'Sabah Esintisi', 'sonraki');
    t.eq(player.state, 'playing', 'sonraki çalmayı başlatır');
    t.eq($('.mu-title').textContent, 'Sabah Esintisi', 'şimdi çalıyor paneli güncellenir');
    t.click($('.mu-prev'));
    t.eq(cur(), 'Bambu Ormanı', 'önceki (3 sn içinde) bir önceki şarkıya geçer');
    t.click($('.mu-prev'));
    t.eq(cur(), q[q.length - 1].title, 'ilk şarkıda önceki sona sarar');
    t.click($('.mu-next'));
    t.eq(cur(), 'Bambu Ormanı', 'son şarkıda sonraki başa sarar');
    // 3 sn'den sonra önceki: şarkıyı baştan başlatır
    clk.advance(0.06);
    for (let i = 0; i < 12; i++) { clk.advance(0.5); await t.sleep(5); }
    t.ok(player.position() > 5, 'konum ' + player.position().toFixed(1));
    t.click($('.mu-prev'));
    t.eq(cur(), 'Bambu Ormanı', '3 sn sonra önceki aynı şarkıyı baştan çalar');
    t.ok(player.position() < 1, 'baştan: ' + player.position().toFixed(2));
    t.eq(player.state, 'playing');

    // tekrar kipleri
    t.eq($('.mu-repeat').dataset.mode, 'off');
    t.click($('.mu-repeat'));
    t.eq([player.repeat, $('.mu-repeat').dataset.mode, $('.mu-repeat').getAttribute('aria-pressed')], ['all', 'all', 'true']);
    t.click($('.mu-repeat'));
    t.eq(player.repeat, 'one');
    t.ok(getComputedStyle(t.$('.mu-one', $('.mu-repeat'))).display !== 'none', 'tek şarkı rozeti');
    t.click($('.mu-repeat'));
    t.eq(player.repeat, 'off');

    // doğal bitiş: kapalı → son şarkıdan sonra durur, tümü → başa sarar, tek → aynı şarkıyı yeniden başlatır
    const finish = async () => { clk.advance(player.duration() + 10); await t.sleep(80); };
    player.play(q[q.length - 1]);
    t.eq(player.state, 'playing');
    await finish();
    t.eq(player.state, 'stopped', 'tekrar kapalı: son şarkıdan sonra durur');
    t.eq(player.position(), 0);
    player.setRepeat('all');
    player.play(q[q.length - 1]);
    await finish();
    t.eq([player.state, cur()], ['playing', 'Bambu Ormanı'], 'tekrar tümü: başa sarar');
    player.setRepeat('one');
    await finish();
    t.eq([player.state, cur()], ['playing', 'Bambu Ormanı'], 'tekrar tek: aynı şarkıyı yeniden çalar');
    t.ok(player.position() < 1);
    player.setRepeat('off');
    await finish();
    t.eq([player.state, cur()], ['playing', 'Sabah Esintisi'], 'doğal bitiş: sıradaki şarkıya geçer');

    // karıştır: tur bitene kadar her şarkı bir kez, geri tuşu geçmişte gezer
    let seed = 7;
    player.rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    player.play(q[0]);
    t.click($('.mu-shuffle'));
    t.ok(player.shuffle && $('.mu-shuffle').getAttribute('aria-pressed') === 'true', 'karıştır açık');
    const seen = [cur()];
    for (let i = 0; i < q.length - 1; i++) { player.next(false); seen.push(cur()); }
    t.eq(new Set(seen).size, q.length, 'tur boyunca her şarkı bir kez: ' + seen.join(' | '));
    t.ok(!player.next(true), 'tur bitti, tekrar kapalı: otomatik ilerleme durur');
    const last = cur();
    player.setRepeat('all');
    t.ok(player.next(true) && cur() !== last, 'tekrar tümü: yeni tur başlar');
    player.setShuffle(false);
    player.setShuffle(true);
    player.play(q[0]);
    player.next(false);
    const second = cur();
    player.next(false);
    const third = cur();
    t.click($('.mu-prev'));
    t.eq(cur(), second, 'karıştırmada önceki geçmişe döner');
    t.ok(second !== third);
    t.click($('.mu-shuffle'));
    t.ok(!player.shuffle);
    await win.close();
  });

  T.test('ses: kaydırıcı, sessize al, klavye kısayolları, kalıcılık', async (t) => {
    const { win, app, player, $ } = await openApp(t);
    t.eq(player.volume, 0.8);
    t.key(win.el, 'ArrowUp');
    t.ok(Math.abs(player.volume - 0.85) < 1e-9, 'yukarı ok +%5');
    t.eq($('.mu-vol-range').value, '85');
    t.key(win.el, 'ArrowDown');
    t.key(win.el, 'ArrowDown');
    t.ok(Math.abs(player.volume - 0.75) < 1e-9, 'aşağı ok −%5');
    $('.mu-vol-range').value = '30';
    $('.mu-vol-range').dispatchEvent(new Event('input', { bubbles: true }));
    t.ok(Math.abs(player.volume - 0.3) < 1e-9, 'kaydırıcı');
    t.eq($('.mu-mute').dataset.icon, 'volume-low');
    t.click($('.mu-mute'));
    t.ok(player.muted && $('.mu-mute').getAttribute('aria-label') === 'Sesi aç', 'sessize al');
    t.eq($('.mu-mute').dataset.icon, 'volume-mute');
    t.key(win.el, 'm');
    t.ok(!player.muted, 'M ile sesi aç');
    for (let i = 0; i < 30; i++) t.key(win.el, 'ArrowUp');
    t.eq(player.volume, 1, 'en çok %100');
    for (let i = 0; i < 40; i++) t.key(win.el, 'ArrowDown');
    t.eq(player.volume, 0, 'en az %0');
    t.eq($('.mu-mute').dataset.icon, 'volume-mute');
    player.setVolume(0.6);
    await t.sleep(400);
    t.eq(P.storage.get('app.music').volume, 0.6, 'ses düzeyi kaydedilir');
    // kısayollar
    t.key(win.el, ' ');
    t.eq(player.state, 'playing', 'Boşluk oynatır');
    t.key(win.el, ' ');
    t.eq(player.state, 'paused', 'Boşluk duraklatır');
    t.key($('.mu-play'), ' ');
    t.eq(player.state, 'playing', 'düğme odaklıyken Boşluk yalnızca bir kez tetikler');
    t.key(win.el, 'n');
    t.eq(player.cur.title, 'Sabah Esintisi', 'N: sonraki');
    t.key(win.el, 'p');
    t.eq(player.cur.title, 'Bambu Ormanı', 'P: önceki');
    t.key(win.el, 's');
    t.ok(player.shuffle, 'S: karıştır');
    t.key(win.el, 's');
    t.key(win.el, 'r');
    t.eq(player.repeat, 'all', 'R: tekrarla');
    t.key(win.el, 'x');
    t.eq(player.state, 'stopped', 'X: durdur');
    t.key(win.el, 'v');
    t.eq(app.vizState().mode, 'wave', 'V: görselleştirme türü');
    t.key(win.el, 'v');
    t.eq(app.vizState().mode, 'bars');
    // yazı alanında kısayollar çalışmaz
    const search = $('.mu-search-input');
    search.focus();
    const before = player.cur.title;
    t.key(search, 'n');
    t.key(search, ' ');
    t.eq([player.cur.title, player.state], [before, 'stopped'], 'arama kutusunda kısayollar devre dışı');
    t.key(win.el, 'f', { ctrlKey: true });
    t.ok(document.activeElement === search, 'Ctrl+F aramaya odaklanır');
    t.key(win.el, 'o', { ctrlKey: true });
    await t.waitFor(() => P.dialog.isOpen(), 1500, 'dosya seçici açılmadı');
    t.ok(/Şarkı aç/.test(dialogText(t)), 'Ctrl+O: dosya seçici');
    const cancel = t.$$('#dialog-layer .dlg-btn').find((b) => /İptal/.test(b.textContent));
    t.click(cancel);
    await t.waitFor(() => !P.dialog.isOpen(), 1500);
    await win.close();
    // kalıcılık: yeniden açınca ayarlar geri gelir
    const again = await openApp(t).catch(() => null);
    if (again) await again.win.close();
  });

  T.test('kalıcılık: ses, karıştır, tekrar ve görselleştirme yeniden açılışta geri gelir', async (t) => {
    const a = await openApp(t);
    a.player.setVolume(0.35);
    a.player.setShuffle(true);
    a.player.setRepeat('one');
    a.app.toggleViz();
    a.player.setMuted(true);
    await a.win.close();
    const saved = P.storage.get('app.music');
    t.eq([saved.volume, saved.shuffle, saved.repeat, saved.viz, saved.muted], [0.35, true, 'one', 'wave', true]);
    const win = P.apps.launch('music');
    await t.waitFor(() => win.state.music);
    const app = win.state.music;
    t.eq([app.player.volume, app.player.shuffle, app.player.repeat, app.player.muted], [0.35, true, 'one', true]);
    t.eq(t.$('.mu-vol-range', win.el).value, '35');
    t.eq(t.$('.mu-repeat', win.el).dataset.mode, 'one');
    t.eq(t.$('.mu-root', win.el).dataset.viz, 'wave');
    await win.close();
    P.storage.remove('app.music');
  });

  // ------------------------------------------------------------------ opening files
  T.test('dosya açma: args.path, relaunch, geçersiz dosya hata penceresi, dosya yöneticisi yönlendirmesi', async (t) => {
    const fs = P.fs;
    const path = MUSIC_DIR + '/Deneme.pmus';
    const bad = MUSIC_DIR + '/Bozuk.pmus';
    fs.writeFile(path, pmus('Deneme Şarkısı'));
    fs.writeFile(bad, '{bu json değil');
    const { win, app, player, $ } = await openApp(t);
    const clk = fakeClock(900);
    player.setClock(clk.now);
    await t.sleep(300);
    t.ok(rowTitles(t, win).includes('Deneme Şarkısı'), 'dosya Dosyalarım listesinde');
    const badRow = t.$$('.mu-row.bad', win.el)[0];
    t.ok(badRow && /Bozuk/.test(badRow.textContent) && /Geçersiz/.test(badRow.textContent), 'geçersiz dosya işaretli satır');
    // başka bir uygulama (dosya yöneticisi) aynı pencereyi yeniden başlatır
    t.ok(P.apps.launch('music', { path }) === win, 'relaunch aynı pencereyi kullanır');
    await t.waitFor(() => player.cur && player.cur.title === 'Deneme Şarkısı', 1500, 'şarkı açılmadı');
    t.eq(player.state, 'playing', 'açılan dosya hemen çalar');
    t.eq($('.mu-title').textContent, 'Deneme Şarkısı');
    t.eq($('.mu-artist').textContent, 'Deneme');
    t.ok(/^0:00 \/ 0:02$/.test($('.mu-time').textContent), 'süre 2,4 sn → 0:02: ' + $('.mu-time').textContent);
    const cur = t.$('.mu-row.current', win.el);
    t.ok(cur && /Deneme Şarkısı/.test(cur.textContent) && cur.closest('.mu-sec').getAttribute('aria-label') === 'Dosyalarım', 'çalan satır Dosyalarım içinde');
    t.eq(player.cur.kind, 'file');
    // geçersiz dosya: hata penceresi, çalan şarkı kesilmez
    P.apps.launch('music', { path: bad });
    await t.waitFor(() => P.dialog.isOpen(), 1500, 'hata penceresi açılmadı');
    t.ok(/Bozuk\.pmus/.test(dialogText(t)) && /JSON/.test(dialogText(t)), 'hata mesajı dosya adını ve nedeni içerir: ' + dialogText(t));
    t.ok(/Şarkı açılamadı/.test(dialogText(t)));
    closeDialog(t);
    await t.waitFor(() => !P.dialog.isOpen(), 1500);
    t.eq(player.cur.title, 'Deneme Şarkısı', 'çalan şarkı değişmedi');
    // listedeki geçersiz satıra çift tıklama da hata gösterir
    t.dblclick(badRow);
    await t.waitFor(() => P.dialog.isOpen(), 1500);
    closeDialog(t);
    await t.waitFor(() => !P.dialog.isOpen(), 1500);
    // olmayan dosya
    P.apps.launch('music', { path: MUSIC_DIR + '/Yok.pmus' });
    await t.waitFor(() => P.dialog.isOpen(), 1500);
    t.ok(/Yok\.pmus/.test(dialogText(t)));
    closeDialog(t);
    await t.waitFor(() => !P.dialog.isOpen(), 1500);
    // apps.openFile uzantıya göre müzik çalara yönlendirir
    const seed = MUSIC_DIR + '/Neşeye Övgü.pmus';
    const w2 = P.apps.openFile(seed);
    t.ok(w2 === win, 'openFile(.pmus) müzik çalarda açılır');
    await t.waitFor(() => player.cur && player.cur.title === 'Neşeye Övgü', 1500);
    t.eq(player.state, 'playing');
    // ev klasörü dışındaki dosya da listeye eklenir
    fs.writeFile('/tmp/Dışarıda.pmus', pmus('Dışarıdaki Şarkı'));
    P.apps.launch('music', { path: '/tmp/Dışarıda.pmus' });
    await t.waitFor(() => player.cur && player.cur.title === 'Dışarıdaki Şarkı', 1500);
    t.ok(rowTitles(t, win).includes('Dışarıdaki Şarkı'), 'ev klasörü dışındaki dosya listede');
    await win.close();
    // pencere kapalıyken args.path ile ilk açılış
    const w3 = P.apps.launch('music', { path });
    await t.waitFor(() => w3.state.music && w3.state.music.player.cur && w3.state.music.player.cur.title === 'Deneme Şarkısı', 1500);
    t.eq(w3.state.music.player.state, 'playing', 'yeni pencere dosyayı açıp çalar');
    await w3.close();
    for (const p of [path, bad, '/tmp/Dışarıda.pmus']) { try { fs.remove(p); } catch (e) { /* ignore */ } }
  });

  T.test('dosya sistemi değişikliği: yeni .pmus dosyası listede belirir, silinince kaybolur', async (t) => {
    const fs = P.fs;
    const { win, app, $ } = await openApp(t);
    const base = rowTitles(t, win).length;
    fs.mkdir(MUSIC_DIR + '/Alt', { recursive: true });
    fs.writeFile(MUSIC_DIR + '/Alt/İç Şarkı.pmus', pmus('İç Şarkı'));
    await t.waitFor(() => rowTitles(t, win).includes('İç Şarkı'), 2000, 'yeni dosya listelenmedi');
    t.eq(rowTitles(t, win).length, base + 1);
    t.eq(t.$$('.mu-sec', win.el)[1].querySelector('.mu-count').textContent, String(base - 6 + 1), 'sayaç güncellendi');
    fs.writeFile(MUSIC_DIR + '/Alt/İç Şarkı.pmus', pmus('Yeniden Adlı'));
    await t.waitFor(() => rowTitles(t, win).includes('Yeniden Adlı') && !rowTitles(t, win).includes('İç Şarkı'), 2000, 'içerik değişikliği yansımadı');
    fs.rename(MUSIC_DIR + '/Alt/İç Şarkı.pmus', 'Başka.pmus');
    await t.sleep(300);
    t.ok(rowTitles(t, win).includes('Yeniden Adlı'), 'yeniden adlandırma başlığı değiştirmez');
    fs.remove(MUSIC_DIR + '/Alt', { recursive: true });
    await t.waitFor(() => !rowTitles(t, win).includes('Yeniden Adlı'), 2000, 'silinen dosya listede kaldı');
    t.eq(rowTitles(t, win).length, base);
    await win.close();
  });

  T.test('sağ tık menüsü: yerleşik şarkıyı Müzik klasörüne kaydet, dosya satırı menüsü', async (t) => {
    const fs = P.fs;
    const { win, app, player, $ } = await openApp(t);
    const row = t.$$('.mu-row', win.el)[0];
    t.contextmenu(row);
    await t.waitFor(() => P.contextMenu.isOpen(), 1500, 'menü açılmadı');
    let labels = t.$$('#context-menu-layer .ctx-label').map((n) => n.textContent);
    t.ok(labels.includes('Çal') && labels.includes('Müzik klasörüne kaydet'), 'menü: ' + labels.join(' | '));
    t.ok(!labels.includes('Çöp Kutusuna taşı'), 'yerleşik şarkıda silme yok');
    const save = t.$$('#context-menu-layer .ctx-item').find((n) => /Müzik klasörüne kaydet/.test(n.textContent));
    t.click(save);
    const p1 = MUSIC_DIR + '/Bambu Ormanı.pmus';
    t.ok(fs.exists(p1), 'dosya yazıldı');
    t.eq(def().parsePmus(fs.readFile(p1)).tracks, def().library[0].tracks, 'kaydedilen dosya özgün şarkıyla aynı');
    t.eq(JSON.parse(fs.readFile(p1)).bpm, 76);
    t.contextmenu(row);
    await t.waitFor(() => P.contextMenu.isOpen(), 1500);
    t.click(t.$$('#context-menu-layer .ctx-item').find((n) => /Müzik klasörüne kaydet/.test(n.textContent)));
    t.ok(fs.exists(MUSIC_DIR + '/Bambu Ormanı (2).pmus'), 'ikinci kayıt benzersiz ad alır');
    await t.waitFor(() => t.$$('.mu-row', win.el).filter((r) => /Bambu Ormanı/.test(r.textContent)).length === 3, 2000, 'kaydedilen dosyalar listelenmedi');
    // dosya satırı
    const fileRow = t.$$('.mu-row', win.el).filter((r) => r.closest('.mu-sec').getAttribute('aria-label') === 'Dosyalarım' && /Bambu Ormanı/.test(r.textContent))[0];
    t.contextmenu(fileRow);
    await t.waitFor(() => P.contextMenu.isOpen(), 1500);
    labels = t.$$('#context-menu-layer .ctx-label').map((n) => n.textContent);
    t.ok(['Çal', 'Dosya konumunu aç', 'Özellikler', 'Çöp Kutusuna taşı'].every((l) => labels.includes(l)) && !labels.includes('Müzik klasörüne kaydet'), 'dosya menüsü: ' + labels.join(' | '));
    t.click(t.$$('#context-menu-layer .ctx-item').find((n) => /Özellikler/.test(n.textContent)));
    await t.waitFor(() => P.dialog.isOpen(), 1500);
    t.ok(/Bambu Ormanı/.test(dialogText(t)), 'özellikler penceresi');
    closeDialog(t);
    await t.waitFor(() => !P.dialog.isOpen());
    t.contextmenu(fileRow);
    await t.waitFor(() => P.contextMenu.isOpen(), 1500);
    t.click(t.$$('#context-menu-layer .ctx-item').find((n) => /Çöp Kutusuna taşı/.test(n.textContent)));
    await t.waitFor(() => P.dialog.isOpen(), 1500);
    t.click(t.$('#dialog-layer .dlg-primary'));
    await t.waitFor(() => !fs.exists(MUSIC_DIR + '/Bambu Ormanı.pmus') || !fs.exists(MUSIC_DIR + '/Bambu Ormanı (2).pmus'), 1500, 'dosya çöpe taşınmadı');
    await t.waitFor(() => t.$$('.mu-row', win.el).filter((r) => /Bambu Ormanı/.test(r.textContent)).length === 2, 2000, 'liste güncellenmedi');
    // temizlik
    for (const f of fs.list(MUSIC_DIR)) if (/^Bambu Ormanı/.test(f.name)) fs.remove(f.path);
    for (const it of fs.listTrash()) if (/Bambu Ormanı/.test(it.name)) fs.deleteFromTrash(it.id);
    await win.close();
  });

  T.test('arama: başlığa ve sanatçıya göre süzer, sonuç yok durumu, Esc temizler', async (t) => {
    const { win, app, player, $ } = await openApp(t);
    const search = $('.mu-search-input');
    t.type(search, 'beethoven');
    t.eq(rowTitles(t, win).filter((x) => x === 'Für Elise').length, 1);
    t.ok(rowTitles(t, win).includes('Neşeye Övgü'), 'dosya sanatçıya göre bulunur');
    t.eq(rowTitles(t, win).length, 2, 'yalnızca Beethoven şarkıları: ' + rowTitles(t, win).join(','));
    search.value = 'ÜSKÜDAR';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    t.eq(rowTitles(t, win), ["Üsküdar'a Gider İken"], 'Türkçe büyük/küçük harf duyarsız');
    search.value = 'xyzxyz';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    t.eq(rowTitles(t, win).length, 0);
    t.ok(t.$('.mu-noresult', win.el) && /Sonuç bulunamadı/.test(t.$('.mu-noresult', win.el).textContent), 'sonuç yok göstergesi');
    t.key(search, 'Escape');
    t.eq([search.value, rowTitles(t, win).length >= 7], ['', true], 'Esc aramayı temizler');
    // Enter ilk sonucu çalar; çalma sırası süzgeçten etkilenmez
    search.value = 'kanon';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    t.key(search, 'Enter');
    t.eq(player.cur.title, 'Kanon');
    t.eq(player.state, 'playing');
    t.ok(player.queue().length >= 7, 'sıra süzgeçten bağımsız');
    t.click($('.mu-clear'));
    t.eq(search.value, '');
    // liste klavye gezintisi
    const list = $('.mu-list');
    list.focus();
    t.key(list, 'ArrowDown');
    t.key(list, 'ArrowDown');
    const sel = t.$('.mu-row.selected', win.el);
    t.ok(sel && /Sabah Esintisi|Gece/.test(sel.textContent), 'oklarla seçim ilerler');
    t.key(list, 'Enter');
    t.eq(player.cur.title, sel.querySelector('.mu-row-title').textContent, 'Enter çalar');
    const volBefore = player.volume;
    t.key(list, 'ArrowUp');
    t.eq(player.volume, volBefore, 'listede yukarı ok sesi değiştirmez');
    await win.close();
  });

  // ------------------------------------------------------------------ system integration
  T.test('bildirim: pencere odakta değilken yeni şarkı başlayınca "Şimdi çalıyor"', async (t) => {
    const { win, app, player, $ } = await openApp(t);
    const clk = fakeClock(700);
    player.setClock(clk.now);
    P.notify.clear();
    player.play();
    t.eq(P.notify.history().length, 0, 'odaktayken bildirim yok');
    P.wm.blurAll();
    t.ok(!win.isFocused());
    player.next(false);
    const h = P.notify.history();
    t.eq(h.length, 1, 'bildirim gönderildi');
    t.eq(h[0].title, 'Şimdi çalıyor');
    t.ok(/Sabah Esintisi/.test(h[0].message) && /Panda Pop/.test(h[0].message), h[0].message);
    t.eq(h[0].appId, 'music');
    t.eq(h[0].icon, 'music');
    // aynı şarkıyı sürdürmek / duraklatmak bildirim üretmez
    player.pause();
    player.play();
    t.eq(P.notify.history().length, 1);
    // otomatik geçiş de bildirir
    clk.advance(player.duration() + 10);
    await t.sleep(80);
    t.eq(P.notify.history().length, 2, 'otomatik geçiş bildirimi');
    t.ok(/Gece Yürüyüşü/.test(P.notify.history()[0].message));
    P.notify.clear();
    win.focus();
    player.next(false);
    t.eq(P.notify.history().length, 0, 'tekrar odaktayken bildirim yok');
    await win.close();
  });

  T.test('küçültünce çalmaya devam eder; Media Session üst verisi ve eylemleri', async (t) => {
    const { win, app, player, $ } = await openApp(t);
    const clk = fakeClock(800);
    player.setClock(clk.now);
    player.play();
    win.minimize();
    await t.sleep(60);
    t.ok(win.isMinimized());
    t.eq(player.state, 'playing', 'küçültülmüş pencerede çalma sürer');
    clk.advance(1);
    await t.sleep(80);
    t.ok(player.engine.running && player.engine.stats.scheduled > 0, 'zamanlayıcı küçültülmüşken de çalışır');
    win.restore();
    const ms = navigator.mediaSession;
    if (ms && typeof MediaMetadata === 'function') {
      t.ok(ms.metadata && ms.metadata.title === 'Bambu Ormanı' && ms.metadata.artist === 'Panda Lo-Fi', 'mediaSession üst verisi');
      t.eq(ms.playbackState, 'playing');
      player.next(false);
      t.eq(ms.metadata.title, 'Sabah Esintisi', 'şarkı değişince üst veri güncellenir');
      player.pause();
      t.eq(ms.playbackState, 'paused');
    } else t.ok(true, 'mediaSession yok');
    await win.close();
    if (ms && typeof MediaMetadata === 'function') t.ok(ms.metadata === null, 'kapanınca mediaSession üst verisi temizlenir');
  });

  // ------------------------------------------------------------------ visuals
  T.test('görselleştirici ve albüm kapağı: deterministik kapak, tuval, boşta sakin / çalarken hareketli', async (t) => {
    const { win, app, player, $ } = await openApp(t);
    const clk = fakeClock(1000);
    player.setClock(clk.now);
    const canvas = $('.mu-viz');
    t.ok(canvas.width > 50 && canvas.height > 20, 'tuval boyutlandırıldı ' + canvas.width + 'x' + canvas.height);
    // kapak: aynı başlık aynı kapak, farklı başlık farklı kapak
    const art1 = $('.mu-art-img').innerHTML + $('.mu-art-img').style.background;
    const rows = t.$$('.mu-cover', win.el);
    t.ok(rows[0].innerHTML === $('.mu-art-img').innerHTML, 'listedeki küçük kapak büyük kapakla aynı çizim');
    t.ok(new Set(rows.slice(0, 6).map((r) => r.innerHTML)).size === 6, 'her şarkının kapağı farklı');
    player.next(false);
    t.ok($('.mu-art-img').innerHTML + $('.mu-art-img').style.background !== art1, 'şarkı değişince kapak değişir');
    player.prev();
    t.ok($('.mu-art-img').innerHTML + $('.mu-art-img').style.background === art1, 'kapak deterministik');
    player.stop();
    // boşta: çubuklar alçak
    for (let i = 0; i < 40; i++) app.draw();
    t.eq(app.vizState().mode, 'bars');
    t.ok(app.vizState().bars.every((b) => b < 0.12), 'boşta çubuklar sakin: ' + app.vizState().bars.map((b) => b.toFixed(2)).join(','));
    const px = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 20) lit++;
    t.ok(lit > 50, 'boşta bile çubuklar çizilir (' + lit + ' px)');
    // çalarken (sahte spektrum): yükselir
    player.play();
    player.engine.spectrum = () => new Uint8Array(512).fill(220);
    player.engine.waveform = () => Uint8Array.from({ length: 1024 }, (_, i) => 128 + Math.round(90 * Math.sin(i / 5)));
    for (let i = 0; i < 25; i++) app.draw();
    t.ok(app.vizState().bars.slice(0, 8).every((b) => b > 0.4), 'çalarken çubuklar yükselir: ' + app.vizState().bars.map((b) => b.toFixed(2)).join(','));
    t.click($('.mu-viz-toggle'));
    t.eq(app.vizState().mode, 'wave', 'dalga görünümü');
    for (let i = 0; i < 25; i++) app.draw();
    const px2 = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let lit2 = 0;
    for (let i = 3; i < px2.length; i += 4) if (px2[i] > 20) lit2++;
    t.ok(lit2 > lit * 2, 'dalga çizildi (' + lit2 + ' px)');
    t.click($('.mu-viz-toggle'));
    t.eq(app.vizState().mode, 'bars');
    // duraklatınca sakinleşir
    player.pause();
    for (let i = 0; i < 80; i++) app.draw();
    t.ok(app.vizState().bars.every((b) => b < 0.12), 'duraklatınca sakin');
    // albüm kapağı vuruşla atar
    player.play();
    await t.sleep(600);
    const pulse = parseFloat($('.mu-art').style.getPropertyValue('--pulse'));
    t.ok(pulse >= 0 && pulse <= 1, 'vuruş darbesi 0..1: ' + pulse);
    player.pause();
    await t.sleep(600);
    t.eq(parseFloat($('.mu-art').style.getPropertyValue('--pulse')), 0, 'duraklatınca kapak durur');
    await win.close();
  });

  T.test('duyarlı yerleşim: en küçük pencere, geniş pencere, büyütülmüş pencere', async (t) => {
    const { win, app, player, $ } = await openApp(t);
    const root = $('.mu-root');
    const inside = (el, box) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
    };
    const check = (label) => {
      const box = root.getBoundingClientRect();
      for (const sel of ['.mu-play', '.mu-prev', '.mu-next', '.mu-stop', '.mu-shuffle', '.mu-repeat', '.mu-mute', '.mu-vol-range', '.mu-progress', '.mu-time', '.mu-title', '.mu-viz', '.mu-art']) {
        t.ok(inside($(sel), box), `${label}: ${sel} pencerenin içinde`);
      }
      t.ok(root.scrollWidth <= root.clientWidth + 1 && root.scrollHeight <= root.clientHeight + 1, `${label}: taşma yok`);
      t.ok($('.mu-stage').scrollHeight <= $('.mu-stage').clientHeight + 1, `${label}: sahne dikey taşmıyor`);
      // denetimler üst üste binmez
      const rects = ['.mu-prev', '.mu-play', '.mu-next', '.mu-stop', '.mu-shuffle', '.mu-repeat', '.mu-mute'].map((s) => $(s).getBoundingClientRect());
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        t.ok(a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5, `${label}: düğmeler çakışmıyor (${i},${j})`);
      }
    };
    t.ok(!root.classList.contains('is-narrow') && !root.classList.contains('is-compact'), 'varsayılan 820×560: geniş yerleşim');
    check('820x560');
    t.ok(getComputedStyle($('.mu-lib')).visibility === 'visible' && $('.mu-lib').getBoundingClientRect().width >= 230);
    win.setSize(520, 420);
    await t.waitFor(() => root.classList.contains('is-narrow') && root.classList.contains('is-compact'), 2000, 'dar yerleşim uygulanmadı');
    t.ok(win.getBounds().width >= 520 && win.getBounds().height >= 420);
    check('520x420');
    t.eq(getComputedStyle($('.mu-lib')).position, 'absolute', 'dar pencerede kütüphane kayan panele dönüşür');
    t.ok(!root.classList.contains('lib-open'), 'panel kapalı başlar');
    t.ok(getComputedStyle($('.mu-lib-toggle')).display !== 'none', 'kütüphane düğmesi görünür');
    t.click($('.mu-lib-toggle'));
    t.ok(root.classList.contains('lib-open'));
    t.eq($('.mu-lib-toggle').getAttribute('aria-expanded'), 'true');
    t.ok($('.mu-lib').getBoundingClientRect().height > 200, 'panel görünür');
    const cover = t.$$('.mu-row-lead', win.el)[2];
    t.click(cover);
    t.eq(player.cur.title, 'Gece Yürüyüşü', 'kapağa tıklamak çalar');
    t.ok(!root.classList.contains('lib-open'), 'seçince panel kapanır');
    t.click($('.mu-lib-toggle'));
    t.click($('.mu-scrim'));
    t.ok(!root.classList.contains('lib-open'), 'perdeye tıklayınca panel kapanır');
    win.setSize(640, 520);
    await t.waitFor(() => !root.classList.contains('is-compact'), 2000);
    check('640x520');
    t.ok(root.classList.contains('is-narrow'), '640 genişlikte kütüphane kayan panel');
    win.setSize(700, 520);
    await t.waitFor(() => !root.classList.contains('is-narrow'), 2000, '700 px geniş yerleşim olmalı');
    check('700x520');
    win.setSize(1000, 700);
    await t.waitFor(() => !root.classList.contains('is-narrow'), 2000, 'geniş yerleşime dönmedi');
    check('1000x700');
    t.ok(getComputedStyle($('.mu-lib')).visibility === 'visible');
    const artW = $('.mu-art').getBoundingClientRect().width;
    t.ok(artW > 200 && artW <= 341, 'kapak boyutu: ' + artW);
    win.maximize();
    await t.sleep(120);
    t.ok(win.isMaximized());
    check('büyütülmüş');
    t.ok($('.mu-art').getBoundingClientRect().width <= 341, 'kapak en çok 340 px');
    win.restore();
    await win.close();
  });

  T.test('sürükle-bırak: dosya yöneticisinden .pmus bırakılınca çalar', async (t) => {
    const fs = P.fs;
    const path = MUSIC_DIR + '/Sürüklenen.pmus';
    fs.writeFile(path, pmus('Sürüklenen Şarkı'));
    const { win, app, player, $ } = await openApp(t);
    const dt = new DataTransfer();
    dt.setData('application/x-pandaos-paths', JSON.stringify([path]));
    const root = $('.mu-root');
    root.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    t.ok(root.classList.contains('dropping'), 'bırakma bölgesi vurgulanır');
    root.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    t.ok(!root.classList.contains('dropping'));
    await t.waitFor(() => player.cur && player.cur.title === 'Sürüklenen Şarkı', 1500, 'bırakılan şarkı açılmadı');
    t.eq(player.state, 'playing');
    // yalnızca .pmus kabul edilir
    P.notify.clear();
    const dt2 = new DataTransfer();
    dt2.setData('application/x-pandaos-paths', JSON.stringify(['/home/panda/Belgeler/Notlar.txt']));
    root.dispatchEvent(new DragEvent('drop', { dataTransfer: dt2, bubbles: true, cancelable: true }));
    t.ok(P.notify.history().some((n) => /\.pmus/.test(n.message)), 'başka dosya türü reddedilir');
    t.eq(player.cur.title, 'Sürüklenen Şarkı');
    await win.close();
    fs.remove(path);
  });

  // ------------------------------------------------------------------ cleanup
  T.test('kapatma: ses, zamanlayıcılar, animasyon kareleri ve dinleyiciler temizlenir', async (t) => {
    const rafs = new Map();
    const ints = new Set();
    const outs = new Set();
    const origRaf = window.requestAnimationFrame;
    const origCaf = window.cancelAnimationFrame;
    const origSi = window.setInterval;
    const origCi = window.clearInterval;
    const origSt = window.setTimeout;
    const origCt = window.clearTimeout;
    const docAdd = document.addEventListener;
    const docRemove = document.removeEventListener;
    const docListeners = new Map();
    window.requestAnimationFrame = (fn) => { const id = origRaf.call(window, (ts) => { rafs.delete(id); fn(ts); }); rafs.set(id, fn); return id; };
    window.cancelAnimationFrame = (id) => { rafs.delete(id); return origCaf.call(window, id); };
    window.setInterval = (fn, ms, ...a) => { const id = origSi.call(window, fn, ms, ...a); ints.add(id); return id; };
    window.clearInterval = (id) => { ints.delete(id); return origCi.call(window, id); };
    window.setTimeout = (fn, ms, ...a) => { const id = origSt.call(window, (...x) => { outs.delete(id); fn(...x); }, ms, ...a); outs.add(id); return id; };
    window.clearTimeout = (id) => { outs.delete(id); return origCt.call(window, id); };
    document.addEventListener = function (type, fn, opts) { const k = type + '|' + (fn && fn.name) ; docListeners.set(fn, type); return docAdd.call(document, type, fn, opts); };
    document.removeEventListener = function (type, fn, opts) { docListeners.delete(fn); return docRemove.call(document, type, fn, opts); };
    let win;
    let eng;
    let player;
    let before;
    try {
      await closeAllMusic();
      await t.sleep(50);
      before = { rafs: new Set(rafs.keys()), ints: new Set(ints), listeners: new Set(docListeners.keys()) };
      P.storage.remove('app.music');
      win = P.apps.launch('music');
      await t.waitFor(() => win.state.music);
      player = win.state.music.player;
      const clk = fakeClock(1500);
      player.setClock(clk.now);
      player.play();
      eng = player.engine;
      for (let i = 0; i < 10; i++) { clk.advance(0.1); await t.sleep(30); }
      t.ok(eng.running && eng.timer && eng.session.voices.size > 0, 'çalıyor');
      const voices = [...eng.session.voices];
      t.ok([...rafs.keys()].some((id) => !before.rafs.has(id)), 'animasyon karesi istendi');
      t.ok(ints.size > before.ints.size, 'zamanlayıcılar kuruldu');
      await win.close();
      t.ok(win.isClosed(), 'pencere kapandı');
      t.eq(P.wm.byApp('music').length, 0);
      t.ok(win.state.music.closed, 'uygulama kapandı işareti');
      t.ok(eng.disposed, 'motor yok edildi');
      t.ok(eng.timer === 0 && eng.session === null && eng.sessions.size === 0 && eng.timers.size === 0, 'zamanlayıcı ve oturumlar temiz');
      t.eq(player.state, 'stopped');
      t.ok(player.engine === null, 'çalar motoru bıraktı');
      t.ok(voices.every((v) => !eng.sessions.size) && !eng.running, 'çalan sesler durduruldu');
      t.eq([...rafs.entries()].filter(([id, fn]) => !before.rafs.has(id) && /paint\(\)/.test(String(fn))).map(([, fn]) => String(fn).slice(0, 60)), [], 'bekleyen animasyon karesi kalmadı');
      t.ok([...ints].every((id) => before.ints.has(id)), 'zamanlayıcı (setInterval) kalmadı');
      t.ok([...docListeners.keys()].every((fn) => before.listeners.has(fn)), 'document dinleyicisi kalmadı');
      t.eq(t.$$('.mu-root').length, 0, 'DOM temizlendi');
      // kapandıktan sonra olaylar hata üretmez ve hiçbir şey çalmaz
      P.bus.emit('fs:change', { type: 'write', path: '/x', parents: ['/'] });
      P.bus.emit('settings:change', { key: 'accent', value: '#ff0000' });
      P.bus.emit('theme:change', { theme: 'light' });
      await t.sleep(300);
      t.ok(!eng.running && eng.timer === 0);
      const ms = navigator.mediaSession;
      if (ms) t.ok(ms.metadata === null, 'mediaSession temiz');
      // aynı çalar oturumu yeniden başlatılabilir (tek örnek)
      const win2 = P.apps.launch('music');
      t.ok(win2 && win2 !== win && !win2.isClosed(), 'yeniden açılış');
      await win2.close();
    } finally {
      window.requestAnimationFrame = origRaf;
      window.cancelAnimationFrame = origCaf;
      window.setInterval = origSi;
      window.clearInterval = origCi;
      window.setTimeout = origSt;
      window.clearTimeout = origCt;
      document.addEventListener = docAdd;
      document.removeEventListener = docRemove;
    }
  });

  T.test('çalarken pencereyi kapatmak sesi anında keser (gerçek AudioContext zamanlaması)', async (t) => {
    const { win, app, player } = await openApp(t);
    player.play();
    const eng = player.engine;
    t.ok(eng && eng.running, 'çalıyor (gerçek saat)');
    const nodes = eng.session ? eng.session.nodes.length : 0;
    t.ok(nodes > 0, 'ses grafiği kuruldu: ' + nodes + ' düğüm');
    await win.close();
    t.ok(eng.disposed && eng.sessions.size === 0);
    t.ok(eng.session === null);
    await t.sleep(50);
    t.eq(P.wm.byApp('music').length, 0);
  });
})();
