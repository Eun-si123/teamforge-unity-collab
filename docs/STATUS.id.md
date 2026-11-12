# Status TeamForge saat ini

[English](STATUS.md) · [Cara kerja](HOW_IT_WORKS.id.md)

_Terjemahan pratinjau ini telah dibandingkan dengan dokumen kanonis bahasa Inggris `STATUS.md` versi 2026-11-11. Untuk bukti rinci, Issues, dan keputusan terbaru, versi bahasa Inggris tetap menjadi acuan._

> **Pratinjau publik awal: jangan gunakan TeamForge sebagai satu-satunya salinan atau satu-satunya mekanisme pemulihan untuk Unity Project penting.** Tetap simpan backup dan sebaiknya gunakan Project uji yang boleh dibuang.

> **2026-10-20 r9 field evidence:** Published r9 passed exact-release validation; user-reported two-PC basic collaboration and Guest reconnect PASS. Full recovery/negative field gate remains BLOCKED. [Current detail](https://github.com/Eun-si123/teamforge-unity-collab/blob/main/docs/STATUS.md).
> **2026-11-04 r10 user-reported two-PC field signal (not a package certification):** Basic Host/Guest collaboration, receive/reconnect, access-code rejection and one long destination were reported PASS; separate installed ZIP hashes were **not** checked on both machines. The published r10 ZIP passed [automated Exact Release Validation #41630492102](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/41630492102), but an actual Guest Wi-Fi/NIC outage was **NOT RUN** ([#457](https://github.com/Eun-si123/teamforge-unity-collab/issues/457)) and repeated Launcher startup exposed a defect (fixed in later source [#456](https://github.com/Eun-si123/teamforge-unity-collab/pull/456), **not** in r10). Full field readiness is **FIELD BLOCKED**. [Dated evidence](PHYSICAL_FIELD_EVIDENCE_2026-11-04_R10.md).

## Integrasi M1 dalam kode sumber: penyuntingan Collider bersama

M1 harus diaktifkan secara eksplisit dalam sumber dan tidak termasuk ZIP r10 yang dipublikasikan. Fitur ini membagikan trigger, center, dan size/radius BoxCollider/SphereCollider pada Scene tersimpan tanpa Prefab melalui jalur nyata: verifikasi byte Scene/meta bertanda tangan → Server Authority → WebSocket → Unity Editor. Setelah penerimaan awal, penyuntingan berulang tanpa menyimpan memakai ledger server, revision/history bersama, dan lock GameObject. Jendela Collider Collaboration menyediakan Undo/Redo bersyarat untuk perubahan sendiri dan kotak pemulihan untuk meninjau lalu mengirim ulang nilai lokal yang belum dikonfirmasi secara eksplisit. Commit server, laporan penerapan Editor, dan penyimpanan disk adalah status terpisah.

Bukti dibagi menjadi empat tahap. **Implementasi**: jalur sumber sudah ada; tinjauan akhir dan pemeriksaan PR tetap diperlukan. **Validasi otomatis**: pengujian Node WebSocket nyata untuk sukses, konflik, duplikat, late join, dan koneksi ulang serta sumber bertanda tangan lulus; hasil SHA akhir dicatat di PR. **Integrasi Unity**: lokal **NOT RUN** karena lingkungan ini tidak memiliki Unity Editor; hasil CI tertunda dengan satu Editor nyata dan peer Node bukan PASS. **Paket dan Windows fisik**: M1 **NOT RUN**, tanpa rilis atau promosi baru; bukti historis r10 dan FIELD BLOCKED dipertahankan.

Batas: satu Scene per Session, 128 Session disimpan dalam memori, 512 Collider/1536 properti, dan nilai berhingga ±100/0–100. Field yang tidak didukung tetap lokal. Penambahan/penghapusan Component, Prefab, serta penghapusan pemilik Collider yang diterima atau leluhurnya memerlukan M2 dan ditolak pada jalur M1 aktif. Penyunting harus menegosiasikan dan bergabung dengan kemampuan yang kompatibel. Ledger tetap di memori setelah semua peer terputus, tetapi **hilang saat server dimulai ulang**; pemulihan tahan restart adalah M4. Dua Unity Editor, late join tiga orang, simpan/buka ulang, delapan Editor selama satu jam, dan artefak Windows persis tetap memerlukan validasi terpisah. Berikutnya M2, siklus hidup Component. Lihat [STATUS bahasa Inggris](STATUS.md) dan [konfigurasi](../server/README.md).

## Ringkasan saat ini

- Lini produk: `0.5.1`
- Source lineage: `0.5.1-wp5.1-path-resilience`
- Kandidat terbaru yang dipublikasikan: `v0.5.1-prealpha-wp5.1-r10`
- Source commit r10: `693d3a9d647f9a511012f1ebba3209834531656e`
- ZIP Windows: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r10-win-x64.zip`
- SHA-256: `01afb269bd6235470bd75d1dda6a6c0119d0e21acea87087fe1115d0cd002f89`
- Target: Windows x64
- Kesiapan release: **FIELD BLOCKED**
- Lini Unity: `6000.3` (Editor pengujian tercatat: `6000.3.21f1`)
- Realtime / Project Transfer / Project Manifest: **v1**

## Rilis r8 dan batas bukti

r8 dirilis pada 2026-10-10 dan mencakup perbaikan PR #209 untuk kesehatan Direct Seed, peluncuran Existing-Active yang terverifikasi, serta penolakan akar proyek bertingkat. ZIP yang diterbitkan lulus Windows Exact Release Validation (run 38019297086), tetapi **r8 belum diuji secara fisik pada dua PC Windows**; status tetap **FIELD BLOCKED**. Hasil r7 di bawah adalah bukti historis, bukan bukti uji lapangan r8. PR #217 dan #219 digabungkan setelah r8 dibuat sehingga tidak ada di ZIP r8.

## Batas bukti r7

r7 dipublikasikan pada 2026-10-03 dari commit d88ca4c41ecf1f9cc7aa5d349960f407f158ce9a lalu lulus **Exact Release Validation** Windows. Otomasi mengunduh ulang ZIP Release, memverifikasi SHA-256 dan setiap hash pada release manifest, melakukan ekstraksi baru ke path yang memuat karakter Korea dan spasi dari working directory lain, lalu memverifikasi Runtime/Node terpaket, perilaku fail-closed Launcher, Windows path resilience, dan junction nyata.

Ini adalah **bukti otomatis untuk paket yang persis dipublikasikan**. Pada uji fisik berikutnya dengan Host r6 dan Guest r7 exact, Guest memakai kembali managed root lama tanpa `destination_contains_unmanaged_content`; setelah profil LAN tepercaya Host diubah dari Public ke Private, alur berlanjut melalui Publisher trust, Project receive, dan pembukaan Unity sampai pengguna melaporkan TeamForge tersambung. Ini masih belum membuktikan exact r7 pada kedua PC, onboarding UAC baru tanpa elevasi, fallback port Seed, atau pemulihan Project identity fisik setelah kehilangan process abnormal. Karena itu status tetap FIELD BLOCKED.

Bukti fisik r5 pada 2026-08-31 tetap berlaku untuk skenario yang benar-benar dijalankan saat itu: reconnect, late join, receive/resume, long path, lock contention, serta Seed `5091`/transfer. Publikasi r7 tidak mengubah bytes atau hasil historis r5.

## Penghambat r7-on-Host berikutnya dan pengujian ulang r8

Uji fisik berikutnya menemukan `baseline_unavailable` ketika Host tetap menampilkan Ready tanpa Direct Project Peer yang dapat ditemukan, `DirectoryNotFoundException` akibat path panjang saat membuka Project terverifikasi yang sudah ada. Tinjauan Source juga menemukan risiko UUID bertingkat ketika direktori satu Project dipilih sebagai Projects root.

PR #209 digabungkan ke `main` pada 2026-10-08; perbaikannya **termasuk dalam ZIP r8 yang diterbitkan**. r8 lulus Windows Exact Release Validation (run 38019297086), tetapi pengujian ulang pada dua PC Windows fisik masih diperlukan: mencabut Ready saat Direct Seed hilang, membuka kembali Existing-Active melalui jalur pendek, dan menolak direktori Project UUID sebagai Projects root. Penyebab awal hilangnya Seed belum dipastikan. PASS campuran r6/r7 sebelumnya hanya berlaku pada cakupan awalnya; status tetap **FIELD BLOCKED**.

[PR #209](https://github.com/Eun-si123/teamforge-unity-collab/pull/209) · [English evidence/status](https://eun-si123.github.io/teamforge-unity-collab/status/#later-r7-on-host-blockers-now-packaged-for-r8-retest)

## Cakupan saat ini

Presence, Selection, sinkronisasi Transform, lock/ownership dasar, operasi Same-Scene Hierarchy yang didukung, Project transfer P2P langsung, UX diagnosis/pemulihan, dan Windows path resilience telah diimplementasikan atau sedang distabilkan. r7 juga mencakup Windows firewall onboarding post-r5, fallback Seed port sibuk/tidak tersedia, Windows Project identity crash recovery, diagnostics tambahan, dan feedback SceneView `TeamForge · Locked by <owner>`.

Sinkronisasi Component/Inspector umum, Prefab/Asset umum, persistent server/session restart recovery, serta Internet NAT traversal/relay otomatis belum didukung.

## Validasi fisik yang tersisa

1. Ekstrak **r10 persis** secara bersih di dua PC Windows dan uji Firewall onboarding/UAC, rule sempit Private + `LocalSubnet`, serta lifecycle-nya.
2. Paksa konflik/ketidaktersediaan Seed port pilihan; pastikan endpoint yang benar-benar diumumkan setelah fallback dapat dijangkau, lalu uji Host Stop/Start dan Fresh Guest transfer.
3. Simulasikan kehilangan process abnormal selama Project identity dan pastikan recovery aman serta tetap fail closed untuk identity ambigu/konflik.
4. Jalankan Fresh Host → Fresh Guest → Unity realtime smoke; pastikan feedback foreign-lock mudah dipahami dan hilang setelah release/takeover.
5. Pertahankan #182 sebagai pemantauan CI intermiten tanpa menutupinya dengan retry/skip; #79 tetap menjadi UX follow-up untuk gerakan SceneView sementara.

## Sumber acuan

Rincian kemampuan, blocker, dan bukti: [English STATUS](STATUS.md); pilihan versi/runtime/protokol yang tepat: [`release-contract.json`](../release-contract.json); identitas byte publikasi: [`builds/README.md`](../builds/README.md) dan SHA-256 GitHub Release.
