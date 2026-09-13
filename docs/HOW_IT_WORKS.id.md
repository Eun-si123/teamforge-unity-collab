# Cara kerja TeamForge

Halaman ini menjelaskan **apa yang terjadi saat seseorang menjadi Host, bergabung, mentransfer proyek, mengedit Scene, terputus, atau pulih dari kegagalan**. Ini penjelasan terpandu, bukan spesifikasi protokol lengkap atau peta kode sumber.

Kemampuan/penghambat: [Status](STATUS.id.md); topologi dan batas kepercayaan: [architecture](architecture.md); file implementasi: [CODEMAP](../CODEMAP.md); alasan keputusan: [architecture-decisions](architecture-decisions.md). Detail belum diterjemahkan tetap berbahasa Inggris; [English](HOW_IT_WORKS.md) menentukan makna.

## Model 60 detik

Dua jalur data sengaja dipisahkan:

- Unity Editor Host/Guest mengirim operasi realtime lewat WebSocket ke Session Authority Server.
- Host Unity memakai Host Project Peer/Seed; Guest Launcher memakai Guest Project Peer. Payload proyek bergerak langsung lewat HTTP antarsesama Peer, lalu Guest Peer menyerahkan Active terverifikasi ke Guest Unity.
- Server mengoordinasikan metadata bertanda tangan dengan keduanya, bukan menjadi relay file proyek.
- Guest baru membuka konten setelah pemeriksaan kepercayaan, integritas, aktivasi, dan handoff Unity lulus.

Transfer besar terpisah dari lalu lintas kolaborasi peka latensi, dengan satu otoritas realtime yang jelas.

## Proses utama

### Paket Unity Editor

Mengelola alur Host, siklus koneksi, Presence, Transform/Lock yang didukung dan kolaborasi Hierarchy dalam Scene sama, diagnostik/pemulihan, serta penerapan status jarak jauh yang disetujui. Klien **mengamati otoritas**: nilai lokal tidak menjadi otoritatif hanya karena ada di satu Editor.

### TeamForge Server

**Session Authority** mengelola keanggotaan, revisi/urutan bersama, lock/lease, status Scene yang didukung dan dipertahankan, perlindungan replay/idempotensi, dan efek realtime. **Project Coordinator** mengelola metadata koordinasi Project/Publisher/baseline/Peer bertanda tangan. Server tidak menyimpan atau merelay payload Manifest/File/Chunk normal.

### Project Peer

Bertanggung jawab atas validasi undangan bertanda tangan, manifest/hash deterministik, HTTP langsung, resume terverifikasi, staging, revisi Active tetap, keamanan filesystem/jalur, serta kepercayaan Project/Publisher. Download berhasil saja tidak cukup untuk aktivasi; seluruh jalur verifikasi/kepercayaan harus lulus.

### Windows Guest Launcher

Guest baru mulai di luar Unity karena proyek mungkin belum ada. Launcher memverifikasi Runtime bawaan, undangan dan kepercayaan, menerima melalui Peer, memvalidasi Active akhir serta versi Unity yang diperlukan, lalu menyerahkan ke Unity. Guest paket normal tidak perlu menginstal atau mengoperasikan Node.js/npm sistem secara manual.

Sumber Launcher juga dapat membuat **support bundle lokal manual**: ZIP observasional terbatas dengan data sensitif disamarkan. Tidak diunggah otomatis, tidak memberi otoritas, dan tidak melewati validasi undangan, kepercayaan, aktivasi, Runtime, jalur, atau handoff Unity. Ketersediaan pada paket bergantung artefak persis; [Status](STATUS.id.md) dan [builds](../builds/README.md) membedakan sumber/paket.

## Saat Host memulai kolaborasi

1. Pilih **Publish & Start**.
2. Unity memeriksa proyek lokal dan prasyarat Scene tersimpan.
3. Peer menyiapkan baseline deterministik; file/chunk mendapat identitas integritas.
4. Host Peer memulai Seed transfer langsung.
5. Metadata Project/Publisher/baseline/Peer dikoordinasikan dengan Server.
6. Collaboration Invite bertanda tangan dibuat; Host siap menerima Guest.

Ada pemeriksaan fail-closed tambahan. **Host Ready lebih dari sekadar port terbuka**: kontrak transfer dan sesi yang diperlukan Guest sudah terbentuk. Undangan tidak dimaksudkan membawa kode akses, kunci penandatanganan privat, atau jalur proyek lokal sembarang. Kode akses, jika dipakai, dibagikan terpisah.

## Saat Guest baru bergabung

1. Buka Windows Guest Launcher dan verifikasi Runtime bawaan.
2. Muat/tempel undangan; validasi struktur dan tanda tangan.
3. Periksa identitas serta kepercayaan Project/Owner/Publisher.
4. Hubungi Host/Seed terkoordinasi, terima descriptor/manifest/inventory.
5. Unduh hanya chunk diperlukan; verifikasi integritas chunk/file/manifest/proyek.
6. Bangun di staging dan verifikasi kandidat lengkap.
7. Buat revisi Active yang tidak dapat diubah; pindahkan pointer proyek aktif yang kecil.
8. Validasi executable Unity yang diperlukan dan handoff akhir; buka proyek terverifikasi.

Direktori yang baru terunduh sebagian tidak dianggap proyek aktif. Revisi Active sebelumnya yang terverifikasi dapat tetap tersedia selama penerimaan baru atau aktivasi gagal.

### Resume berdasarkan verifikasi

Konten terverifikasi dapat dipakai ulang sesuai kontrak transfer. Ini bukan mempercayai sembarang file di disk: hash dan kontrak aktivasi tetap menentukan.

## Mengedit objek Scene yang didukung

1. Pengguna menggerakkan GameObject; layanan Transform Unity mengamati perubahan.
2. Tentukan identitas objek kanonis menurut otoritas.
3. Periksa lock/lease dan otoritas koneksi, kirim operasi Transform lewat WebSocket.
4. Server memvalidasi dan menerapkan aturan urutan/revisi/idempotensi.
5. Efek yang disetujui dikirim ke klien lain.
6. Penerima memperbarui Authority View; Unity menerapkan Transform jarak jauh yang disetujui dengan aman.

**Identitas:** kedua Editor harus merujuk objek logis yang sama, bukan sekadar nama/jalur Hierarchy sama. Objek Scene tersimpan memakai identitas Unity stabil; objek sesi yang didukung dapat diberi identitas TeamForge setelah binding otoritatif. Ambiguitas ditolak secara fail-closed, bukan menebak dari nama, indeks saudara, atau jalur.

**Otoritas:** Server menentukan status realtime bersama yang diterima. Klien melaporkan niat dan menerapkan hasil, bukan memelihara kebenaran tandingan.

**Revisi/urutan:** operasi yang diterima memajukan urutan bersama. Revisi membantu menilai status usang, late join, replay, dan apakah operasi diperiksa terhadap status yang diharapkan.

**Lock/lease:** dikontrol otoritas agar dua pengguna tidak diam-diam menimpa objek bersamaan. Lease kedaluwarsa saat klien hilang, bukan menjadi lock permanen.

**Replay/idempotensi:** retry sah dari operasi sama dibedakan dari operasi berbeda yang memakai ulang identitas. Pesan terkirim dua kali tidak boleh memutasi dua kali.

## Perubahan Hierarchy

Buat/hapus/ubah nama/parent/urutan saudara dalam Scene sama memakai jalur otoritatif terpisah, bukan disamarkan sebagai Transform. Transform relatif terhadap struktur: parent/identitas berbeda dapat menghasilkan Scene berbeda meski angka lokal identik. Jangan menyimpulkan dukungan umum Component/Inspector/Prefab/Asset atau struktur lintas Scene sembarang; lihat [Status](STATUS.id.md).

## Sambung ulang dan epoch koneksi

Sambung ulang tidak membuktikan otoritas lama masih berlaku: koneksi hilang → berhenti mempercayai otoritas lingkup koneksi → reconnect/handshake → terima kapabilitas ternegosiasi dan status otoritatif terkini → ikat ulang objek untuk epoch baru → lanjut hanya setelah status wajib siap. Alias persisten/cache identitas boleh membantu resolusi tetapi tidak memberi otoritas sendiri.

## Kegagalan dan pemulihan

Pertahankan status terverifikasi, jangan memaksa status tak dikenal:

- Runtime rusak: hentikan sebelum kode paket belum terverifikasi berjalan;
- undangan tidak valid/bertentangan: binding proyek lama tetap;
- transfer gagal: simpan kemajuan terverifikasi yang boleh dipakai ulang;
- aktivasi gagal: jangan ganti Active lama yang terverifikasi;
- masalah jalur Unity: hanya strategi jalur milik TeamForge yang divalidasi terpisah;
- baseline/identitas tidak cocok: minta rekonsiliasi/update, jangan menebak;
- proses tak dikenal pada port diperlukan: jangan membunuhnya hanya karena TeamForge menginginkan port.

Tindakan **berdasarkan status**: Retry, Paste New Invite, Use Latest Project, Open Existing Verified Project, Choose Unity hanya ditawarkan pada status dengan makna aman yang ditentukan.

**Diagnostik adalah pengamatan, bukan otoritas pemulihan.** Salinan diagnostik/bundle manual mendeskripsikan run. Menyimpan ZIP tidak mengubah Project terpilih, mencoba ulang, mempercayai Publisher, mengaktifkan konten, atau melonggarkan pemeriksaan. Bundle mengambil tampilan status aman terbatas, bukan data luas proyek/mesin; tetap tinjau sebelum dibagikan ke publik.

## Mengapa transfer dan realtime terpisah

Realtime membutuhkan pesan otoritatif kecil dan terurut. Bootstrap proyek melibatkan banyak file, aliran byte besar, retry, resume, hash, staging, dan disk. Pemisahan mencegah bottleneck Server tersembunyi dan memperjelas batas keamanan/kegagalan.

Konsekuensinya Host Peer harus benar-benar terjangkau Guest. Transfer langsung cocok untuk PC sama, LAN terjangkau, atau VPN terkelola. Discovery Internet/NAT traversal/relay otomatis adalah persoalan transport masa depan terpisah, bukan janji dari istilah P2P.

## Tempat dan umur status

| Status | Pemilik/umur |
| --- | --- |
| Session Authority realtime | Memori Server selama sesi hidup |
| Registri koordinasi Project | Memori Server |
| Authority View klien | Koneksi Unity saat ini |
| Konten transfer/staging | Penyimpanan terkelola Project Peer |
| Revisi Active terverifikasi | Penyimpanan Project terkelola yang persisten |
| Pointer Active saat ini | Metadata kecil persisten |
| Riwayat diagnostik Launcher | Terbatas pada run saat ini |
| Support bundle manual | ZIP lokal terbatas/disamarkan buatan pengguna; tanpa unggahan otomatis |

Proyek unduhan persisten tidak berarti riwayat otoritas realtime persisten; artefak diagnostik tidak menjadi otoritas. Ini penting untuk restart, reconnect, resume, dan pemulihan.

## Menelusuri perilaku ke kode

[CODEMAP](../CODEMAP.md) memelihara nama file/test tepat. Jalur umum: koneksi → Unity `TeamForgeConnectionService` + host WebSocket Server; Transform/Lock → layanan Transform + Authority View + Session Authority; Hierarchy → layanan Unity + model Hierarchy Server/Session Authority; bootstrap/transfer → orkestrator Host/Guest Peer + sumber langsung + content store; awal/pemulihan Guest → Windows Launcher + Launcher Core + orkestrator Guest; support → UI diagnostik + bundle/redaksi Core; ketahanan jalur → Launcher Core + kontrak bersama Project Peer. Rujuk peta kode agar penjelasan tetap berguna setelah refaktor.
