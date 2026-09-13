# TeamForge nasıl çalışır

Bu sayfa **Host olma, katılma, proje aktarma, Scene düzenleme, bağlantı kesilmesi ve hatadan kurtarma sırasında olanları** açıklar. Tam protokol tanımı veya kaynak dosya haritası değil, yönlendirilmiş bir açıklamadır.

Yetenek/engel: [Durum](STATUS.tr.md); topoloji/güven sınırları: [architecture](architecture.md); dosyalar: [CODEMAP](../CODEMAP.md); karar gerekçeleri: [architecture-decisions](architecture-decisions.md). Çevrilmemiş ayrıntılar İngilizcedir; anlam için [English](HOW_IT_WORKS.md) esastır.

## 60 saniyelik model

Bilerek ayrı tutulan iki veri yolu:

- Host/Guest Unity Editor, WebSocket ile Server Session Authority'ye realtime işlemler gönderir.
- Host Unity, Host Project Peer/Seed'i; Guest Launcher, Guest Project Peer'i kullanır. Proje baytları Peer'ler arasında doğrudan HTTP ile taşınır; Guest Peer doğrulanmış Active projesini Guest Unity'ye devreder.
- Server iki Peer ile imzalı metaveri koordine eder, proje dosyası relay'i olmaz.
- Guest içeriği ancak güven, bütünlük, etkinleştirme ve Unity devir denetimleri geçince açar.

Büyük aktarım, gecikmeye duyarlı işbirliği trafiğinden ayrılır; tek ve açık realtime otoritesi kalır.

## Ana süreçler

### Unity Editor paketi

Host akışını, bağlantı yaşam döngüsünü, Presence'ı, desteklenen Transform/Lock ve aynı Scene Hierarchy işbirliğini, tanılama/kurtarma sunumunu ve onaylı uzak durumun yerel Scene'e uygulanmasını sağlar. İstemci **otoriteyi gözlemler**; bir yerel değer yalnızca Editor'de bulunduğu için yetkili olmaz.

### TeamForge Server

**Session Authority** üyelik, ortak revizyon/sıra, lock/lease, tutulan destekli Scene durumu, replay/idempotency koruması ve realtime etkilerden sorumludur. **Project Coordinator** imzalı Project/Publisher/baseline/Peer koordinasyon metaverisini yönetir. Server normal Manifest/File/Chunk yükünü saklamaz veya relay etmez.

### Project Peer

İmzalı davet doğrulama, deterministik manifest/hash, doğrudan HTTP, doğrulanmış devam, staging, değişmez Active revizyonları, dosya sistemi/yol güvenliği ve Project/Publisher güvenini yönetir. Başarılı indirme tek başına etkinleştirme değildir; tüm doğrulama ve güven yolu geçilmelidir.

### Windows Guest Launcher

Yeni Guest'in açacağı proje henüz olmayabileceğinden Unity dışında başlar. Launcher paket Runtime'ını, daveti ve güveni doğrular; Peer üzerinden alır; son Active ile gereken Unity sürümünü doğrulayıp Unity'ye devreder. Normal paket Guest'leri sistem Node.js/npm kurup elle yönetmek zorunda değildir.

Güncel Launcher kaynağı **elle oluşturulan yerel destek paketi** de üretebilir: sınırlı, hassas verileri ayıklanmış gözlem ZIP'i. Otomatik yüklenmez, otorite vermez, davet/güven/etkinleştirme/Runtime/yol/Unity devir denetimlerini aşmaz. Bir pakette bulunması birebir çıktıya bağlıdır; [Durum](STATUS.tr.md) ve [builds](../builds/README.md) kaynak ile paketi ayırır.

## Host işbirliğini başlatır

1. **Publish & Start** seçilir.
2. Unity yerel proje ve kaydedilmiş Scene önkoşullarını denetler.
3. Peer deterministik baseline hazırlar; dosya/chunk bütünlük kimlikleri oluşur.
4. Host Peer doğrudan aktarım Seed'ini başlatır.
5. Project/Publisher/baseline/Peer metaverisi Server ile koordine edilir.
6. İmzalı Collaboration Invite oluşur; Host Guest'lere hazırdır.

Ek fail-closed denetimleri vardır. **Host Ready, açık bir porttan fazlasıdır**: Guest için gereken aktarım ve realtime oturum sözleşmeleri kurulmuştur. Davet erişim kodu, özel imza anahtarı veya keyfî yerel proje yolu taşımak için değildir. Kullanılıyorsa erişim kodu ayrı paylaşılır.

## Yeni Guest katılır

1. Windows Guest Launcher açılır, paket Runtime'ı doğrulanır.
2. Davet yüklenir/yapıştırılır; yapı ve imza doğrulanır.
3. Project/Owner/Publisher kimliği ve güveni incelenir.
4. Koordine Host/Seed'e ulaşılır; descriptor/manifest/inventory alınır.
5. Yalnızca gerekli chunk'lar indirilir; chunk/dosya/manifest/proje bütünlüğü doğrulanır.
6. Staging'de oluşturulur ve tam aday doğrulanır.
7. Değişmez Active revizyonu yaratılır; küçük güncel proje işaretçisi taşınır.
8. Gereken Unity çalıştırılabilir dosyası ve son devir doğrulanır; doğrulanmış proje açılır.

Kısmen indirilmiş keyfî dizin güncel proje sayılmaz. Yeni revizyon alınırken veya etkinleştirme başarısızken önceki doğrulanmış Active kullanılabilir kalabilir.

### Doğrulama temelli devam

Aktarım sözleşmesi izin verdiği yerde doğrulanmış içerik yeniden kullanılabilir. Diskte rastgele bulunan dosyaya güvenmek değildir; hash'ler ve etkinleştirme sözleşmesi bağlayıcı kalır.

## Desteklenen Scene nesnesini düzenleme

1. Kullanıcı GameObject'i taşır; Unity Transform hizmeti değişimi gözlemler.
2. Otoritenin kanonik nesne kimliği çözümlenir.
3. Lock/lease ve güncel bağlantı otoritesi denetlenir; WebSocket üzerinden Transform gönderilir.
4. Server işlemi doğrular; sıra/revizyon/idempotency uygular.
5. Onaylı etki diğer istemcilere yayımlanır.
6. Alıcı Authority View'ı günceller; Unity onaylı uzak Transform'u güvenle uygular.

**Kimlik:** iki Editor aynı mantıksal nesneyi kastetmelidir; aynı ad/Hierarchy yolu yeterli değildir. Kaydedilmiş Scene nesneleri kararlı Unity kimliği kullanır; desteklenen oturum nesneleri yetkili bağlamadan sonra TeamForge kimliği alabilir. Belirsizlikte ad, kardeş indeksi veya yoldan tahmin yerine fail-closed uygulanır.

**Otorite:** Server kabul edilen ortak realtime durumu belirler. İstemciler niyet bildirip sonuç uygular; bağımsız rakip doğrular tutmaz.

**Revizyon/sıra:** kabul edilen işlemler ortak sırayı ilerletir. Revizyonlar eski durum, geç katılım, replay ve beklenen duruma göre değerlendirmeyi anlamaya yarar.

**Lock/lease:** otorite kontrollü kilitler eşzamanlı sessiz üzerine yazmayı önler. İstemci kaybolunca lease süresi dolar, kalıcı kilit olmaz.

**Replay/idempotency:** aynı işlemin meşru retry'ı ile kimliği yeniden kullanan farklı işlem ayrılır. Mesajın iki kez ulaşması durumu iki kez değiştirmemelidir.

## Hierarchy değişiklikleri

Aynı Scene oluştur/sil/adlandır/üst öğe değiştir/kardeş sırası işlemleri Transform gibi davranmak yerine ayrı yetkili yol kullanır. Transform yapıya görelidir: üst öğe/kimlik farklıysa aynı yerel sayılar farklı Scene üretebilir. Genel Component/Inspector/Prefab/Asset eşitlemesi veya keyfî Scene'ler arası yapı desteği çıkarılamaz; [Durum](STATUS.tr.md)'a bakın.

## Yeniden bağlantı ve bağlantı dönemleri

Yeniden bağlanmak eski otoritenin hâlâ geçerli olduğunu kanıtlamaz: bağlantı kaybı → bağlantı kapsamındaki otoriteye güveni durdur → reconnect/handshake → güncel müzakere edilmiş yetenekler ve yetkili durum → yeni dönem için nesne bağlarını yenile → gerekli durum hazır olunca devam et. Kalıcı alias/yerel kimlik önbelleği çözümlemeye yardım edebilir, tek başına otorite vermez.

## Hata ve kurtarma

Bilinmeyeni zorlamak yerine doğrulanmış durum korunur:

- bozuk Runtime: doğrulanmamış kod yürütülmeden dur;
- geçersiz/çelişkili davet: mevcut Project bağını değiştirme;
- aktarım hatası: izin verilen doğrulanmış ilerlemeyi koru;
- etkinleştirme hatası: önceki doğrulanmış Active'i değiştirme;
- Unity yol sorunu: yalnızca ayrıca doğrulanmış TeamForge yol stratejisi;
- baseline/kimlik uyuşmazlığı: tahmin yerine uzlaştırma/güncelleme iste;
- gereken porttaki bilinmeyen süreç: TeamForge portu istiyor diye sonlandırma.

Kurtarma **duruma bağlıdır**. Retry, Paste New Invite, Use Latest Project, Open Existing Verified Project ve Choose Unity yalnızca tanımlı güvenli anlamları olan durumlarda sunulur.

**Tanılama gözlemdir, kurtarma otoritesi değildir.** Kopyalanan tanılama ve elle ZIP mevcut çalışmayı anlatır. Kaydetmek Project seçmez, retry yapmaz, Publisher'a güvenmez, içerik etkinleştirmez veya güvenlik denetimini gevşetmez. Geniş proje/makine verisi yerine sınırlı güvenli durum görünümü toplar; yine de herkese açık paylaşmadan önce incelenmelidir.

## Aktarım ve realtime neden ayrı?

Realtime küçük sıralı otorite mesajlarından yararlanır. Project bootstrap birçok dosya, büyük akışlar, retry, devam, hash, staging ve disk işi içerir. Ayrım gizli Server darboğazını önler ve güvenlik/hata sınırlarını anlaşılır kılar.

Buna karşılık Guest, Host Peer'e gerçekten ulaşabilmelidir. Aynı PC, erişilebilir LAN veya yönetilen VPN uygundur. Otomatik Internet discovery/NAT geçişi/relay ayrı bir gelecek aktarım problemidir; P2P sözcüğünün örtülü vaadi değildir.

## Durumun yeri ve ömrü

| Durum | Sahibi/ömrü |
| --- | --- |
| Realtime Session Authority | Canlı oturum için Server belleği |
| Project koordinasyon kaydı | Server belleği |
| İstemci Authority View | Güncel Unity bağlantısı |
| Aktarım içeriği/staging | Yönetilen Project Peer depolaması |
| Doğrulanmış Active revizyonları | Kalıcı yönetilen Project depolaması |
| Güncel Active işaretçisi | Küçük kalıcı metaveri |
| Launcher tanılama geçmişi | Sınırlı mevcut çalışma geçmişi |
| Elle destek paketi | Kullanıcının oluşturduğu yerel sınırlı/ayıklanmış ZIP; otomatik yükleme yok |

Kalıcı indirilmiş proje, kalıcı realtime authority geçmişi demek değildir; tanılama çıktısı otoriteye dönüşmez. Restart, reconnect, devam ve kurtarmada bu ayrım önemlidir.

## Davranıştan kaynak koda

Kesin dosya/test adlarını [CODEMAP](../CODEMAP.md) tutar. Tipik yollar: bağlantı → Unity `TeamForgeConnectionService` + Server WebSocket host; Transform/Lock → Transform hizmeti + Authority View + Session Authority; Hierarchy → Unity hizmeti + Server Hierarchy modeli/Session Authority; bootstrap/aktarım → Peer Host/Guest orkestratörleri + doğrudan kaynak + içerik deposu; Guest başlangıç/kurtarma → Windows Launcher + Launcher Core + Guest orkestratörü; destek → tanılama UI + Core bundle/ayıklama; yol dayanıklılığı → Launcher Core + ortak Project Peer sözleşmesi. Dosya adlarını burada çoğaltmamak açıklamayı refactoring sonrasında da yararlı tutar.
