# TeamForge uyumluluğu

Bu sayfa **okuyucuya yönelik uyumluluk ve topoloji sınırlarını** açıklar.

- Kesin ürün/runtime/protokol seçimleri → [`../release-contract.json`](../release-contract.json)
- Güncel doğrulama/hazırlık → [STATUS.md](STATUS.md)
- Paketli yapıt kimliği → [`../builds/README.md`](../builds/README.md) + kesin Release SHA-256

Sık değişen araç/runtime yama numaralarını belgelerde çoğaltmayın; kesin seçimlerin sahibi sürüm sözleşmesidir.

## Testten önce

Gözden çıkarılabilir bir proje kullanın ve yedek tutun. TeamForge Erken Genel Önizlemedir; saha doğrulaması sınırlarını [STATUS.md](STATUS.md) belirler. Matris paketli hedefi kaynak/derleme gereksinimlerinden ayırır.

Minimum CPU, RAM, GPU, disk, bant genişliği ve gecikme gereksinimleri kontrollü testlerle henüz belirlenmemiştir. Başarılı prototip çalışması minimum donanım önerisi değildir.

Guest, yapılandırılmış Server'a ve Host'un duyurduğu Project Peer uç noktasına ulaşabilmelidir. İmzalı davet ağ erişilebilirliği sağlamaz. Aynı bilgisayar, erişilebilir LAN veya yönetilen VPN kullanın; otomatik İnternet geçişi ve relay sağlanmaz.

## Ürün ve protokol

Bileşenler uyumlu bir ürün hattı olarak birlikte ilerler; Server/Project Peer/Launcher/paket sürümleri bağımsızca karıştırılmamalıdır. Mimari şunları ayırır:

- yapılandırılmış Server WebSocket üzerinden gerçek zamanlı iş birliği yetkisi;
- proje başlangıcı/meta veri koordinasyonu;
- doğrudan Project Peer veri aktarımı;
- paketli Host/Guest Runtime ve Launcher bütünlüğü.

Protokol/şema değişiklikleri yalnızca mevcut anlamlar uyumlu kalırsa eklemeli olabilir. Kesin numaralar `release-contract.json` içindedir. Görünür ürün sürümleri aynı olsa bile farklı adayların Runtime/Launcher manifestolarını veya ikili dosyalarını karıştırmayın.

## Unity

Desteklenen hat **Unity 6000.3**'tür. Belirli Editor yaması ancak ilgili kaynak/aday için kayıtlı kanıt varsa doğrulanmış sayılır. En yeni Unity yaması otomatik olarak test edilmiş veya desteklenmiş değildir. Test Editor seçimi `release-contract.json`, kanıt özeti [STATUS.md](STATUS.md) içindedir.

Güncel kaynak kod, kararlı **Unity 6000.6** projelerini de **deneysel** olarak kabul eder. Kaynak yayımlama ve ön denetim yalnızca kararlı `f` derlemelerini kabul eder; Editor Doctor deneysel uyumluluk uyarısı gösterir. Diğer Unity hatları ile 6000.6 alpha, beta veya patch son ekli derlemeleri bu kabul politikasının dışında kalır. Mevcut 6000.3 meta veri uyumluluk kuralları değişmez.

Projenin tam Editor sürümü doğrulanmış meta verilerinin parçası olarak kalır. Doğrulanmış proje aktarımında ve Launcher Guest devrinde seçilen Editor yine bu kesin sürümle eşleşmelidir; deneysel kaynak kabulü bu denetimi kaldırmaz veya doğrulanmış projeyi sessizce yükseltmez. Elle kullanılan TF1 gerçek zamanlı kodları, Editor sürümünü taşımadan Project/Scene kimliğini bağlar; bu nedenle farklı Editor sürümleriyle elle yapılan gerçek zamanlı işbirliği henüz doğrulanmamıştır. [Unity iş akışı](../.github/workflows/unity-tests.yml), temel sürüm, güncel 6.3 LTS yaması ve açıkça deneysel olarak etiketlenen 6.6 için Authority/Lock hücrelerini çalıştırır. Bir hücrenin yapılandırılmış olması PASS değildir: test edildiği söylenmeden önce gerçek Editor sürümü ve tam commit sonuçları incelenmelidir. Deneysel kaynak kabulü yayımlanan sürüm için kaydedilmiş Editor’ü, UPM alt sınırını veya mevcut paketli adayı değiştirmez.

## Geliştirici ve runtime

Kaynak geliştiricileri sözleşmedeki ve depo lock/build yapılandırmasındaki Node/npm/.NET/araç aralıklarını kullanmalıdır. Bunlar **kaynak/derleme gereksinimleridir**; sözleşmeye göre paketli/bağımsız runtime kullanan normal Host/Guest son kullanıcı kurulumu gereksinimleri değildir. Yeni ana runtime/araç zinciri ailesi açık bir uyumluluk kararı ve doğrulama gerektirir; tek bilgisayarda kurulması yeterli değildir.

## Desteklenen topoloji

- gerçek zamanlı yetki için yapılandırılmış TeamForge Server WebSocket;
- aynı PC, erişilebilir LAN veya yönetilen VPN üzerinde doğrudan Project Peer HTTP;
- açık, yalnız loopback kullanan aynı-PC modu;
- Guest'e somut sunucu adresi duyuran, kimlik doğrulamalı loopback dışı dinleme;
- doğrulanmış paketli Runtime ile Windows Host/Guest akışı.

Desteklenen topoloji olarak sağlanmayanlar: WebRTC / RTCDataChannel; ICE / STUN / TURN; otomatik NAT geçişi; relay/otomatik aktarım yedeği; otomatik eş keşfi; sunucusuz/gömülü gerçek zamanlı yetki; tam kullanıcı kimliği/yetkilendirme sistemiyle güvenilmeyen genel İnternet dağıtımı.

`P2P`, **doğrudan Project Peer veri aktarımı** demektir; otomatik İnternet P2P bağlantısı değildir.

## Platform matrisi

| Yüzey | Durum |
| --- | --- |
| Windows x64 paketli Runtime / Guest Launcher | Güncel paket yönü; kesin aday STATUS saha kapılarına tabidir |
| Unity 6000.3 | Güncel Unity hattı |
| Kayıtlı kesin Unity yaması | `release-contract.json` ve STATUS kanıtı |
| Diğer Unity 6000.3 yamaları | Test edilmiş denmeden önce ayrı temel oluşturma/doğrulama gerekir |
| Kararlı Unity 6000.6 kaynak kodu | Deneysel kabul ve ayrı CI kanıtı; paket veya fiziksel bilgisayar desteği iddiası değildir |
| macOS/Linux bağımsız Launcher | Eşdeğer güncel aday paketlenmemiştir |
| Docker/Compose | Kaynak/sunucu seçeneği; normal paketli Host yolu veya güncel sürüm kapısı değildir |
| Authenticode | Dağıtım/imza durumu STATUS/güncel yapıt belgelerindedir |

## Güncel kaynakta Windows yönetilen depolama

Windows proje kimliği kilitlemesi için yerel sabit NTFS/ReFS yönetilen kökü gerekir. Ağ kökleri, kullanılamayan veya doğrulanmamış kökler fail-closed olarak reddedilir. Bu TeamForge depolama koşuludur; genel Unity proje gereksinimi değildir. Kaynak/yayımlanmış aday sınırı için [STATUS.md](STATUS.md) ve [uygulamaya](../project-peer/src/project-identity-lock.mjs) bakın.

## İddialar ve geçmiş

Eski aşama/çalışma/test raporları kaydettikleri kaynak/yapıt için geçerlidir. Benzer ürün sürümü onları güncel kanıta dönüştürmez. Kesin bayt kimliği için yalnız sürüm yerine Release varlık adı + SHA-256 kullanın.
