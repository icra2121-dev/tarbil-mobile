# TKGM kamu Parsel Sorgu entegrasyonu

CBS ekranı, TKGM'nin kamuya açık Parsel Sorgu istemcisinin kullandığı resmî
koordinat sorgusunu kullanır:

`https://cbsapi.tkgm.gov.tr/megsiswebapi.v3.1/api/parsel/{enlem}/{boylam}/`

Bu uç nokta API anahtarı istemez. Mobil pakete TKGM parolası, tokenı veya başka
bir servise ait anahtar eklenmez. Gerekirse yalnızca taban adresi
`EXPO_PUBLIC_TKGM_PARCEL_API_URL` ile değiştirilebilir.

## Doğruluk ve kullanım sınırı

Parsel Sorgu geometrilerinin konum hassasiyeti TKGM tarafından düşürülmüştür.
Uygulama bu veriyi `source=tkgm_public_approx` ve
`source_accuracy=public_reduced_precision` değerleriyle saklar ve arayüzde
"yaklaşık" olarak gösterir. Veri ölçme, aplikasyon veya tapu sınırı belirleme
amacıyla kullanılmaz.

## Saha akışı

1. Denetçi CBS haritasında saha konumuna gider.
2. Haritaya uzun basar veya harita merkezini sol üstteki poligon düğmesiyle
   sorgular.
3. Uygulama yalnızca bu kullanıcı eylemi üzerine parseli sorgular; ülke çapında
   toplu tarama yapmaz.
4. Geometri, kaynak metadatasıyla `cbs_units` tablosuna önbelleklenir.
5. Parsel seçilerek Re'sen veya Sınıflandırma görevi açılır.
6. Görev içindeki poligon editöründe sahada görülen ve KOBÜKS/CBS kaydı olmayan
   sera sınırı çizilip `cbs_units.greenhouse_polygon` ile
   `greenhouse_units.greenhouse_polygon` alanlarına kaydedilir.

İstek 15 saniyede kesilir. 404, servis limiti ve geçersiz geometri durumları
kullanıcıya ayrı hata olarak gösterilir. Otomatik kaydırma veya arka planda
sürekli API sorgusu yapılmaz.
