# PandaOS — Plan

Tarayıcıda çalışan, kurulum gerektirmeyen (index.html'e çift tıkla) sahte bir işletim sistemi.
Saf HTML/CSS/JavaScript; framework, CDN, derleme adımı yok. `file://` üzerinden çalışır.

## Mimari

```
index.html            → tüm katmanlar + script sırası (çekirdek → arayüz → kabuk → uygulamalar → boot)
css/theme.css         → tema değişkenleri (açık/koyu), sıfırlama, katman düzeni      [plan]
js/core/kernel.js     → PandaOS ad alanı, olay yolu, ayarlar, depolama, tema, uygulama kaydı [plan]
js/boot.js            → açılış sırası + URL parametreleri (fast, open, test, reset)  [plan]
js/core/vfs.js        → localStorage tabanlı sanal dosya sistemi + çöp kutusu        [ajan C1]
js/core/wm.js         → pencere yöneticisi (taşı, boyutlandır, küçült, büyüt, kapat, yasla) [ajan C2]
js/shell/*            → açılış ekranı, kilit ekranı, masaüstü, duvar kağıtları       [ajan C3a]
js/shell/*            → görev çubuğu, başlat menüsü, saat/takvim, bildirim merkezi   [ajan C3b]
js/ui/*               → sağ tık menüsü, bildirimler, diyaloglar, dosya seçici, sesler, bileşen CSS [ajan C4]
js/core/icons.js      → tüm SVG ikonlar + panda logosu                                [ajan C5]
js/apps/<id>.js       → her uygulama ayrı ajan                                        [ajan A1..A11]
tests/                → tarayıcı içi test düzeneği + her modülün testleri
tools/test.sh, shot.sh→ headless Chrome ile test çalıştırma / ekran görüntüsü
```

Sözleşmenin tamamı: [API.md](API.md).

## Uygulamalar

| id | Ad | Not |
|---|---|---|
| files | Dosyalar | klasör oluştur/sil/yeniden adlandır, kes/kopyala/yapıştır, sürükle-bırak, çöp kutusu görünümü |
| terminal | Terminal | ls, cd, cat, mkdir, rm, help + pwd, touch, echo >, mv, cp, tree, ps, kill, open, neofetch… |
| notepad | Not Defteri | aç/kaydet/farklı kaydet, kaydedilmemiş uyarısı, bul, satır/sütun |
| calculator | Hesap Makinesi | standart + bilimsel, klavye, geçmiş |
| music | Müzik Çalar | Web Audio ile sentezlenen şarkılar, görselleştirici, .pmus dosyaları |
| minesweeper | Mayın Tarlası | 3 zorluk, bayrak, akor açma, süre, rekorlar |
| game2048 | 2048 | animasyonlu karolar, klavye/kaydırma, geri al, rekor |
| **settings** | Ayarlar | *(eklendi)* tema, vurgu rengi, duvar kağıdı, ses, bildirimler, depolama, sıfırlama |
| **paint** | Çizim | *(eklendi)* fırça, silgi, şekiller, kova, geri al; .png olarak dosya sistemine kaydet |
| **taskmanager** | Görev Yöneticisi | *(eklendi)* açık pencereler, görevi sonlandır, CPU/RAM grafikleri, depolama |
| **clock** | Saat | *(eklendi)* dünya saatleri, kronometre, zamanlayıcı (bitince bildirim) |

## Aşamalar

1. **Plan + sözleşme** (ben): API.md, kernel.js, boot.js, theme.css, index.html, test araçları.
2. **Çekirdek** (6 paralel alt ajan, Sonnet 5.5) → entegrasyon ajanı → 2 gözden geçirici → düzeltici.
3. **Uygulamalar** (11 paralel alt ajan, Sonnet 5.5) → her uygulamaya bağımsız QA ajanı → düzeltici.
4. **Birleştirme ve test**: uygulamalar arası senaryolar (terminal ↔ dosyalar ↔ not defteri ↔ çöp kutusu),
   açık/koyu tema görsel kontrolü, tarayıcıda uçtan uca deneme.
