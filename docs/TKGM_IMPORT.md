# Yetkili TKGM parsel geometrisi aktarımı

Kamuya açık, konum hassasiyeti düşürülmüş Parsel Sorgu akışı için
`TKGM_PUBLIC_PARCELS.md` belgesine bakın. Bu belge yalnızca protokol kapsamında
alınan, daha yüksek doğruluklu kurumsal veri aktarımını açıklar.

Uygulama, TKGM parsel geometrilerini mobil pakette bir API anahtarı taşımadan
`cbs_units` tablosundan okur. Yetkili veri, sunucu/CI ortamında
`tools/import-tkgm-parcels.mjs` ile Supabase'e aktarılır.

## Veri kaynağı

TKGM, MEGSİS WFS/WMS servislerini protokol kapsamında kurum, kuruluş ve
belediyelerle paylaşır. Herkese açık Parsel Sorgu geometrileri konumsal
hassasiyeti düşürülmüş bilgilendirme verisidir; resmî saha/kadastro geometrisi
olarak içe aktarılmamalıdır.

- MEGSİS: https://www.tkgm.gov.tr/megsis-1
- Harita servisleri: https://www.tkgm.gov.tr/projeler/mekansal-gayrimenkul-sistemi-megsis
- Veri paylaşımı tarifesi: https://www.tkgm.gov.tr/sites/default/files/2025-12/2026%20tarife%20ctv.pdf

TKGM'nin kuruma verdiği servis URL'si, katman adı ve kimlik bilgisi sunucu
ortamına eklenmelidir. Depoda veya `EXPO_PUBLIC_*` değişkenlerinde gizli anahtar
tutulmaz.

## Yapılandırma

1. `.env.example` dosyasını güvenli CI/sunucu secret ayarlarına temel alın.
2. `SUPABASE_SERVICE_ROLE_KEY` ve yetkili TKGM WFS kimlik bilgilerini yalnızca
   sunucu ortamında tanımlayın.
3. Kurumdan dosya teslim edildiyse EPSG:4326 GeoJSON yolunu
   `TKGM_GEOJSON_PATH` ile verin. WFS kullanılıyorsa `TKGM_WFS_URL` ve
   `TKGM_WFS_TYPENAME` zorunludur.
4. İlk çalıştırmada `TKGM_IMPORT_DRY_RUN=true` kullanın:

   ```powershell
   node tools/import-tkgm-parcels.mjs
   ```

5. Okunan/geçerli/hatalı sayıları kontrol ettikten sonra
   `TKGM_IMPORT_DRY_RUN=false` ile aktarımı başlatın.

İçe aktarıcı WFS sayfalamasını yapar, `Polygon` ve `MultiPolygon` geometrilerini
doğrular, özgün GeoJSON geometrisini `source_geometry` alanında saklar ve mobil
haritanın kullanacağı dış halkayı `parcel_polygon` alanına yazar. Kayıtlar
`tkgm_parcel_id` üzerinden tekrar çalıştırılabilir biçimde güncellenir.

## Kapsam

Tüm ülke verisi çok büyük olduğundan ilk kabul testi için TKGM'nin verdiği
filtre/BBOX kullanılmalıdır. Kurumsal servis kapasitesi doğrulandıktan sonra
filtre kaldırılarak sayfalı tam aktarım yapılabilir. İçe aktarıcı varsayılan
olarak özellik sayısını sınırlamaz; `TKGM_IMPORT_MAX_FEATURES` kabul testinde
geçici sınır koymak için kullanılabilir.
