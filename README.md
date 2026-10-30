# 🐼 PandaOS

Tarayıcıda çalışan, gerçek bir masaüstü işletim sistemi gibi hissettiren sahte bir işletim sistemi.
Kurulum yok, sunucu yok, internet yok: **`index.html` dosyasına çift tıkla.**

🌐 **Canlı dene:** https://pandakingpunc.github.io/pandaOS/

Tüm dosyaların ve ayarların tarayıcının `localStorage` alanında saklanır; sayfayı kapatıp açsan da kalır.

## 📱 PandamOS — mobil sürüm

PandaOS'un telefon hali **PandamOS** (Panda Mobile OS) de bu depoda. Masaüstü kilit ekranının sol altındaki
**Mobil** düğmesiyle geçersin; telefonun kilit ekranındaki **💻 Masaüstü** düğmesi seni geri getirir.
Doğrudan açmak için: `mobile/index.html` ([canlı](https://pandakingpunc.github.io/pandaOS/mobile/)).

Kilit ekranı, hızlı ayarlar, son uygulamalar, güç/ses tuşları ve 14 uygulama içerir (Telefon, Mesajlar, Kamera,
Galeri, Müzik, Hava Durumu, Saat, Takvim, Notlar, Çizim, Yılan, Tarayıcı, Hesap Makinesi, Ayarlar).

- Kaynak: `mobile-src/` (React + TypeScript + Vite + Tailwind)
- Derlenmiş tek dosya: `mobile/index.html` (internetsiz, çift tıkla açılır)
- Değişiklikten sonra yeniden derle: `cd mobile-src && npm ci && npm run build`

## Neler var?

- **Açılış ekranı ve kilit ekranı** — saat, tarih, panda avatarı (şifre gerekmez, Enter yeter). `Ctrl+Alt+L` ile kilitle.
- **Masaüstü** — duvar kağıtları, sürüklenebilir simgeler, çift tıklayınca açılan kısayollar, seçim dikdörtgeni,
  sağ tık menüsü, Çöp Kutusu. Masaüstü aslında `/home/panda/Masaüstü` klasörüdür.
- **Pencereler** — taşı, kenarlardan/köşelerden boyutlandır, küçült, ekranı kapla, kapat; ekran kenarına sürükleyerek
  yarıya/tam ekrana yasla.
- **Görev çubuğu** — başlat menüsü (arama dahil), sabitlenmiş ve açık uygulamalar, hızlı ayarlar (ses, parlaklık, tema),
  bildirim merkezi, saat ve takvim.
- **Açık/koyu tema, vurgu rengi, bildirimler, sistem sesleri.**

### Uygulamalar

| | |
|---|---|
| Dosyalar | klasör oluştur, yeniden adlandır, kes/kopyala/yapıştır, sürükle-bırak, çöp kutusu (geri yükle / boşalt) |
| Terminal | `help`, `ls`, `cd`, `cat`, `mkdir`, `rm` ve çok daha fazlası (`tree`, `grep`, `neofetch`, `ps`, `kill`, `pandasay`…) — Dosyalar ile aynı dosya sistemi |
| Not Defteri | aç / kaydet / farklı kaydet, bul-değiştir, kaydedilmemiş değişiklik uyarısı |
| Hesap Makinesi | standart ve bilimsel mod, geçmiş, klavye desteği |
| Müzik Çalar | şarkılar Web Audio ile gerçek zamanlı sentezlenir; görselleştirici, `.pmus` şarkı dosyaları |
| Mayın Tarlası | üç zorluk + özel, bayrak, akor açma, rekorlar |
| 2048 | animasyonlu karolar, geri al, en iyi skor |
| Ayarlar | tema, vurgu rengi, duvar kağıdı, ses, bildirimler, depolama, fabrika ayarları |
| Çizim | fırça, silgi, şekiller, kova, metin; resmini kaydet ve duvar kağıdı yap |
| Görev Yöneticisi | açık uygulamalar, görevi sonlandır, canlı performans grafikleri |
| Saat | dünya saatleri, alarm, zamanlayıcı, kronometre |

## Geliştirme

- Mimari ve modül sözleşmesi: [docs/PLAN.md](docs/PLAN.md), [docs/API.md](docs/API.md)
- Testler headless Chrome ile çalışır:

```bash
bash tools/test.sh smoke,vfs,wm,desktop,taskbar,ui,icons,integration
```

- Ekran görüntüsü: `bash tools/shot.sh /tmp/masaustu.png "fast=1&theme=light"`
- Faydalı URL parametreleri: `?fast=1` (açılış/kilit ekranını atla), `?reset=1` (fabrika ayarları),
  `?open=terminal,files` (uygulamaları aç), `?theme=light`.

## Lisans

MIT — ayrıntı için [LICENSE](LICENSE). Kullanılan açık kaynak paketler kendi lisanslarıyla gelir (mobil sürüme gömülü React, clsx ve tailwind-merge de MIT).
