# Status TeamForge saat ini

[English](STATUS.md) · [Cara kerja](HOW_IT_WORKS.id.md)

_Terjemahan pratinjau ini telah dibandingkan dengan dokumen kanonis bahasa Inggris `STATUS.md` versi 2026-10-04. Untuk bukti rinci, Issues, dan keputusan terbaru, versi bahasa Inggris tetap menjadi acuan._

> **Pratinjau publik awal: jangan gunakan TeamForge sebagai satu-satunya salinan atau satu-satunya mekanisme pemulihan untuk Unity Project penting.** Tetap simpan backup dan sebaiknya gunakan Project uji yang boleh dibuang.

## Ringkasan saat ini

- Lini produk: `0.5.1`
- Source lineage: `0.5.1-wp5.1-path-resilience`
- Kandidat terbaru yang dipublikasikan: `v0.5.1-prealpha-wp5.1-r7`
- Source commit r7: `d88ca4c41ecf1f9cc7aa5d349960f407f158ce9a`
- ZIP Windows: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r7-win-x64.zip`
- SHA-256: `a710acd3cd7189c3f44ae1b4ee46a15239313c850ad7f6982e3a58f2492a13aa`
- Target: Windows x64
- Kesiapan release: **FIELD BLOCKED**
- Lini Unity: `6000.3` (Editor pengujian tercatat: `6000.3.21f1`)
- Realtime / Project Transfer / Project Manifest: **v1**

## Batas bukti r7

r7 dipublikasikan pada 2026-10-03 dari commit di atas lalu lulus **Exact Release Validation** Windows. Otomasi mengunduh ulang ZIP Release, memverifikasi SHA-256 dan setiap hash pada release manifest, melakukan ekstraksi baru ke path yang memuat karakter Korea dan spasi dari working directory lain, lalu memverifikasi Runtime/Node terpaket, perilaku fail-closed Launcher, Windows path resilience, dan junction nyata.

Ini adalah **bukti otomatis untuk paket yang persis dipublikasikan**. Pada uji fisik berikutnya dengan Host r6 dan Guest r7 exact, Guest memakai kembali managed root lama tanpa `destination_contains_unmanaged_content`; setelah profil LAN tepercaya Host diubah dari Public ke Private, alur berlanjut melalui Publisher trust, Project receive, dan pembukaan Unity sampai pengguna melaporkan TeamForge tersambung. Ini masih belum membuktikan exact r7 pada kedua PC, onboarding UAC baru tanpa elevasi, fallback port Seed, atau pemulihan Project identity fisik setelah kehilangan process abnormal. Karena itu status tetap FIELD BLOCKED.

Bukti fisik r5 pada 2026-08-31 tetap berlaku untuk skenario yang benar-benar dijalankan saat itu: reconnect, late join, receive/resume, long path, lock contention, serta Seed `5091`/transfer. Publikasi r7 tidak mengubah bytes atau hasil historis r5.

## Cakupan saat ini

Presence, Selection, sinkronisasi Transform, lock/ownership dasar, operasi Same-Scene Hierarchy yang didukung, Project transfer P2P langsung, UX diagnosis/pemulihan, dan Windows path resilience telah diimplementasikan atau sedang distabilkan. r7 juga mencakup Windows firewall onboarding post-r5, fallback Seed port sibuk/tidak tersedia, Windows Project identity crash recovery, diagnostics tambahan, dan feedback SceneView `TeamForge · Locked by <owner>`.

Sinkronisasi Component/Inspector umum, Prefab/Asset umum, persistent server/session restart recovery, serta Internet NAT traversal/relay otomatis belum didukung.

## Validasi fisik yang tersisa

1. Ekstrak **r7 persis** secara bersih di dua PC Windows dan uji Firewall onboarding/UAC, rule sempit Private + `LocalSubnet`, serta lifecycle-nya.
2. Paksa konflik/ketidaktersediaan Seed port pilihan; pastikan endpoint yang benar-benar diumumkan setelah fallback dapat dijangkau, lalu uji Host Stop/Start dan Fresh Guest transfer.
3. Simulasikan kehilangan process abnormal selama Project identity dan pastikan recovery aman serta tetap fail closed untuk identity ambigu/konflik.
4. Jalankan Fresh Host → Fresh Guest → Unity realtime smoke; pastikan feedback foreign-lock mudah dipahami dan hilang setelah release/takeover.
5. Pertahankan #182 sebagai pemantauan CI intermiten tanpa menutupinya dengan retry/skip; #79 tetap menjadi UX follow-up untuk gerakan SceneView sementara.

## Sumber acuan

Rincian kemampuan, blocker, dan bukti: [English STATUS](STATUS.md); pilihan versi/runtime/protokol yang tepat: [`release-contract.json`](../release-contract.json); identitas byte publikasi: [`builds/README.md`](../builds/README.md) dan SHA-256 GitHub Release.
