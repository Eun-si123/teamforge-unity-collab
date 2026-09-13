# Status TeamForge saat ini

[English](STATUS.md) · [Cara kerja](HOW_IT_WORKS.id.md)

_Tinjauan dokumentasi asli: 2026-09-10 UTC. Diselaraskan dengan sumber `main` yang memuat penguatan jaringan Windows, diagnostik, dan identitas Project setelah r5, artefak r5 yang diterbitkan, serta hasil pengujian fisik r5 yang persis pada 2026-08-31. Bukti paket tetap terpisah dari bukti sumber yang lebih baru._

> **Pratinjau Publik Awal — jangan jadikan TeamForge satu-satunya salinan atau mekanisme pemulihan proyek Unity penting.** Penghambat Windows WP5.1 awal telah mendapat banyak pengujian fisik pada r5 yang persis, tetapi perilaku jaringan/identitas tambahan pada `main` belum diuji bersama sebagai satu paket pengganti yang persis di PC fisik. Simpan cadangan dan utamakan proyek uji yang boleh dibuang.

[English](STATUS.md) adalah sumber kanonis bagi manusia tentang kemampuan dan kesiapan rilis. Dokumen lain merujuk ke sana, bukan memelihara daftar penghambat tandingan. Pilihan versi tepat: [release-contract.json](../release-contract.json); identitas byte dan aturan build lama: [builds/README.md](../builds/README.md); diskusi bug dan reproduksi historis: GitHub Issues. Dokumen mendalam yang belum diterjemahkan tetap berbahasa Inggris.

## Ringkasan keadaan

- Lini produk: `0.5.1`; garis sumber: `0.5.1-wp5.1-path-resilience`.
- Kandidat paket terbit terbaru: `v0.5.1-prealpha-wp5.1-r5`.
- Commit sumber/tag r5: `a97b6ba5649e2888b909bf3c99c64acfd7042ba6`.
- ZIP Windows: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r5-win-x64.zip`.
- SHA-256: `5944abf2263502ee40f49d0ac2c8a9826a809dc4cd1b20c9edf82f94ba35f8cc`.
- Target paket: Windows x64; kesiapan rilis: **FIELD BLOCKED**, persyaratan lapangan belum terpenuhi.
- Lini Unity: `6000.3`; Editor uji kandidat yang tercatat: `6000.3.21f1`.
- Realtime Protocol, Project Transfer Protocol, Project Manifest Schema: masing-masing **v1**.

## Sumber dibandingkan kandidat paket

Perbaikan WP5.1 awal untuk #67, #68/#74, #69, #70, dan #71 digabung melalui PR #81. r5 berasal dari commit di atas dan mencakup perbaikan tersebut serta integrasi Launcher **Save support bundle** setelah r4.

Pada 2026-08-31, r5 yang persis diuji di dua PC Windows fisik: sambung ulang Guest setelah menyimpan, Guest baru bergabung terlambat dengan snapshot Transform, penghentian penerimaan/resume berulang, handoff execution alias untuk jalur panjang/dalam, dan pemulihan konflik terlindungi akibat kontensi lock usang. Setelah izin firewall tersedia, Host Stop/Start yang mengikat ulang Seed TCP `5091` dan transfer Project Guest nyata juga terverifikasi.

Skenario tersebut tidak lagi menunggu pengulangan fisik r5 pertama. Bukti ini tidak memasukkan perubahan baru ke r5 dan tidak menjadikan produk alpha yang dapat dipasang secara umum. Klaim paket memakai r5 dan bukti 2026-08-31; r5 tidak setara byte/perilaku dengan `main`. Jangan menganggap skenario r5 yang selesai masih tertunda hanya karena teks lama. Untuk menjadikan `main` kandidat pengganti, terbitkan artefak baru yang tidak dapat diubah dan uji perilaku tambahan setelah r5 pada artefak itu.

## Penguatan sumber setelah r5

- Penyiapan firewall LAN Windows dapat membuat aturan masuk Coordinator/Seed yang sempit setelah persetujuan eksplisit pengguna dan UAC, terbatas pada Private dan LocalSubnet, dengan rekonsiliasi/pembersihan aturan milik TeamForge. Pengujian r5 masih memerlukan izin manual; jalur baru membutuhkan bukti fisik paket yang persis.
- Jika port Seed pilihan/default sibuk atau tidak tersedia, termasuk `EACCES` saat bind Windows, Host mencoba sekali lagi dengan port pemberian OS dan mengumumkan endpoint terpilih. Ada cakupan otomatis Windows Project Peer, tetapi perilaku ini lebih baru daripada r5.
- Pembuatan identitas Project diserialkan; pemulihan crash Windows memakai live lock named-pipe milik OS serta pagar kompatibilitas permanen bagi penulis lama. Suite crash/konkurensi Windows Node 22/24 lulus; belum ada paket terbit dengan perubahan ini yang mendapat bukti lapangan fisik persis.
- Pembersihan penolakan Coordinator, penguatan pembatalan/tenggat HTTP, konteks diagnostik Host, log peran klien WebSocket, serta pembedaan undangan Launcher dari kode koneksi `TF1`.

Ini fakta sumber/otomasi, bukan perilaku paket r5. Pemulihan lock identitas usang Linux/macOS juga berada di luar perubahan khusus Windows ini.

## Kemampuan

| Area | Keadaan sumber | Batas bukti |
| --- | --- | --- |
| Kehadiran pengguna terhubung | Diimplementasikan/diuji | Baseline dua PC fisik bekerja; pengujian eksternal lebih luas berguna |
| Seleksi/konteks Editor | Diimplementasikan/diuji | Pengujian eksternal lebih luas berguna |
| Sinkronisasi Transform | Diimplementasikan/distabilkan | Late-join dan pemulihan kontensi r5 PASS; cakupan lapangan dan UX lanjutan masih perlu |
| Lock/ownership dasar | Diimplementasikan/distabilkan | Kontensi/pemulihan r5 PASS; UX penyuntingan saat lock dimiliki pihak lain: #79 |
| Hierarchy satu Scene: buat/hapus/ubah nama/parent/urutan | Diimplementasikan/distabilkan | Subset didemonstrasikan secara fisik; cakupan lebih luas berguna |
| Bootstrap Project/Collaboration Invite | Diimplementasikan/distabilkan | Guest tersimpan r5 PASS; pemulihan identitas baru belum punya bukti paket/lapangan |
| Transfer Project P2P langsung | Diimplementasikan/distabilkan | r5 `5091` Stop/Start dan transfer PASS; firewall/port baru belum punya bukti paket pengganti |
| Diagnostik/UX pemulihan | Diimplementasikan/distabilkan | r5 menyertakan support bundle yang menjaga privasi; penyempurnaan berikutnya hanya sumber relatif terhadap r5 |
| Ketahanan jalur Windows/execution alias | Diimplementasikan/distabilkan | Handoff panjang/dalam r5 PASS; penolakan alias berbahaya/tidak terkait dicakup otomatis secara fail-closed |
| Component/Inspector | Direncanakan | Tambah/hapus Component umum dan sinkronisasi `SerializedProperty` belum didukung |
| Prefab/Asset umum | Direncanakan | Bukan alur kerja yang didukung saat ini |
| Pemulihan persisten setelah restart server/sesi | Direncanakan | Authority/status sesi tetap di memori |
| NAT traversal Internet/relay otomatis | Riset/masa depan | Tidak ada WebRTC, ICE, STUN, TURN, relay, discovery, atau NAT traversal otomatis |

## Penutupan fisik pada r5 yang persis

Tabel ini menggantikan pernyataan lama bahwa penghambat awal masih menunggu pengujian fisik.

| Issue | Hasil dan batas sekarang |
| --- | --- |
| [#67](https://github.com/Eun-si123/teamforge-unity-collab/issues/67) | **PASS**: edit/simpan kolaboratif sah → tutup Unity Guest → buka kembali Active Project terverifikasi yang sama → masuk realtime tanpa `guest_handoff_mismatch`. Penolakan identitas baru/belum terverifikasi tetap dilindungi implementasi ketat dan regresi otomatis |
| [#68](https://github.com/Eun-si123/teamforge-unity-collab/issues/68) | **PASS**: Guest baru menerima Hierarchy/Transform/Lock otoritatif serta Transform berikutnya tanpa konflik terlindungi palsu. Skenario luas masih berguna; penghambat awal ditutup |
| [#74](https://github.com/Eun-si123/teamforge-unity-collab/issues/74) | **PASS**: pihak yang kalah kontensi kembali ke status otoritatif dan kolaborasi tetap dapat digunakan. UX lock pihak lain terpisah di #79 |
| [#69](https://github.com/Eun-si123/teamforge-unity-collab/issues/69) | **PASS**: Launcher dihentikan paksa berulang saat menerima; data parsial terverifikasi dipakai ulang dan resume selesai tanpa galat CLR/aplikasi awal. Pertahankan regresi untuk perubahan Runtime berikutnya |
| [#70](https://github.com/Eun-si123/teamforge-unity-collab/issues/70) | **SEBAGIAN UNTUK SASARAN r5 / PASS UNTUK SEED STABIL**: Host Stop/Start mengikat ulang TCP `5091`, transfer nyata berhasil setelah izin firewall. Onboarding otomatis baru dan fallback port perlu bukti fisik paket pengganti yang persis |
| [#71](https://github.com/Eun-si123/teamforge-unity-collab/issues/71) | **PASS**: tujuan panjang/dalam memicu optimasi jalur, Unity terbuka dan kolaborasi berjalan. Penolakan alias berbahaya/tidak terkait/dialihkan tetap bukti fail-closed otomatis |

Linimasa rinci ada di Issues; STATUS memiliki makna dampak rilis terkini.

## Bukti otomatis dan lokal

Sebelum PR #81 digabung, head terpadu lulus gate yang dicatat dalam `docs/MAIN_PATCH_STATUS_2026-08-27.md`:

- CI #216: Server, Project Peer, pemuat Runtime Launcher, Windows Launcher, kontrak sumber publik **PASS**.
- Dependency Review #140 **PASS**.
- Unity Tests #73: Unity Lock Contention E2E, Unity Realtime Authority E2E, Realtime Authority Chaos E2E, Project Transfer Resume E2E **PASS**.
- Unity Test Runner lokal sebelumnya: **143/143 tes yang dapat dijalankan lokal PASS**; dua tes server nyata khusus CI sengaja diabaikan secara lokal.
- Pemulihan kontensi A/B pada mesin sama **PASS**; konvergensi Hierarchy/Transform late-join A/B/C **PASS**, nol konflik terlindungi dalam run tercatat.

Penguatan berikutnya diuji oleh tes terfokus Project Peer/Launcher/Unity dan gate normal repositori. Suite identitas Windows lulus pada lini Node 22/24 yang didukung; regresi port Seed tidak tersedia lulus seluruh suite Project Peer pada lingkungan Windows yang direproduksi. Ini memperkuat keyakinan terhadap sumber, bukan bukti paket dengan byte yang diterbitkan sebelum perbaikan.

## Bukti dua PC fisik

Baseline 2026-08-22: Host → undangan bertanda tangan → Guest baru → autentikasi → transfer langsung → kepercayaan Publisher → Active terverifikasi → realtime Unity; Presence dan Transform dua arah; kontensi lock normal; buat/ubah nama/parent/urutan saudara/hapus pada Scene sama. Guest keluar/buka lagi tanpa menyimpan memulihkan Hierarchy/Transform/Lock dari sesi yang masih hidup. TCP Coordinator terputus → retry → sambung otomatis tanpa restart Unity.

Pada 2026-08-31, pasangan ZIP/SHA r5 yang persis menutup skenario di atas pada dua PC Windows fisik. Seed `5091` Stop/Start serta transfer LAN nyata lulus; izin awal firewall masih manual saat itu.

## Batas bukti

Hasil hanya membuktikan yang diuji. CI sumber tidak membuktikan ZIP. Otomasi Unity tidak mereproduksi semua urutan input SceneView, kondisi proses Windows, LAN/firewall, atau waktu mesin kedua. Tes satu mesin berbagi OS, stack jaringan, lingkungan waktu, perangkat keras. Bukti r5 tidak membuktikan `main` yang lebih baru. Versi bukan identitas byte: nama artefak dan SHA-256 persis diperlukan. Bug tertutup tidak otomatis memberi bukti paket/lapangan bagi perubahan subsistem berikutnya. Catatan historis berlaku bagi snapshot-nya, tidak mengalahkan STATUS terkini.

## Syarat kesiapan rilis yang tersisa

Sebelum mempromosikan alpha yang dapat dipasang secara umum:

1. Pertahankan hasil r5 #67/#68/#69/#71/#74 sebagai selesai.
2. Untuk distribusi `main`, terbitkan kandidat baru yang tidak dapat diubah.
3. Pada pengganti persis, uji firewall awal, lingkup/siklus aturan sempit, fallback port pilihan sibuk/tidak tersedia, keterjangkauan Seed yang diumumkan, Host Stop/Start dan transfer Guest baru.
4. Uji pemulihan identitas Windows setelah proses hilang, termasuk restart aman dan penanganan fail-closed identitas ambigu/bertentangan.
5. Jalankan smoke Host hasil ekstraksi baru → Guest baru → kolaborasi realtime pada paket pengganti; jangan mengasumsikan pewarisan bukti r5.
6. Simpan nama/SHA/identitas sumber persis dan catat hanya skenario yang dijalankan.
7. Lanjutkan panduan instalasi/update/uninstalasi dan dapatkan tes/review selain dari pembuat proyek sebelum klaim keandalan luas.

Restart proses server saat ini berarti **putus/fail-closed/pemulihan sesi baru**, bukan tes persistensi: pemulihan authority/sesi yang tahan restart belum diimplementasikan.

## Pemilik informasi

Kemampuan/penghambat: [English](STATUS.md); versi: [kontrak](../release-contract.json); byte aktif/lama: [builds](../builds/README.md) + SHA Release; alur: [Cara kerja](HOW_IT_WORKS.id.md); rencana: [ROADMAP](ROADMAP.md); struktur: [architecture](architecture.md); alasan: [architecture-decisions](architecture-decisions.md); skenario: [TEST_LAB](TEST_LAB.md); bug: Issues; pengujian lama: catatan bertanggal. Detail belum diterjemahkan tetap dalam bahasa Inggris.
