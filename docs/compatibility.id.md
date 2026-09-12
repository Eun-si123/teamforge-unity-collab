# Kompatibilitas TeamForge

Halaman ini menjelaskan **batas kompatibilitas dan topologi bagi pembaca**.

- Pilihan tepat produk/runtime/protokol → [`../release-contract.json`](../release-contract.json)
- Validasi/kesiapan saat ini → [STATUS.md](STATUS.md) (Inggris)
- Identitas artefak paket → [`../builds/README.md`](../builds/README.md) + SHA-256 Release yang tepat

Jangan menyalin nomor patch alat/runtime yang cepat berubah ke banyak dokumen. Kontrak rilis memiliki pilihan tepat tersebut.

## Sebelum pengujian

Gunakan proyek yang boleh dibuang dan simpan cadangan. TeamForge adalah Pratinjau Publik Awal; [STATUS.md](STATUS.md) menetapkan batas validasi lapangan. Matriks membedakan target paket dari persyaratan sumber/build.

Persyaratan minimum CPU, RAM, GPU, disk, bandwidth, dan latensi belum ditetapkan melalui pengujian terkontrol. Prototipe yang berhasil berjalan bukan rekomendasi perangkat keras minimum.

Guest harus dapat menjangkau Server yang dikonfigurasi dan endpoint Project Peer yang diumumkan Host. Undangan bertanda tangan tidak menciptakan keterjangkauan jaringan. Gunakan komputer yang sama, LAN yang terjangkau, atau VPN terkelola; penembusan Internet otomatis dan relay tidak disediakan.

## Produk dan protokol

Komponen bergerak sebagai satu lini produk yang kompatibel, bukan campuran bebas versi Server/Project Peer/Launcher/paket. Arsitektur memisahkan:

- otoritas kolaborasi waktu nyata melalui WebSocket Server yang dikonfigurasi;
- koordinasi inisialisasi proyek dan metadata;
- transfer payload Project Peer langsung;
- integritas Runtime Host/Guest dan Launcher yang dipaketkan.

Kompatibilitas protokol/skema bersifat aditif hanya jika semantik lama tetap kompatibel. Nomor tepat berada di `release-contract.json`. Jangan mencampur manifest atau biner Runtime/Launcher dari kandidat berbeda hanya karena versi produk yang terlihat sama.

## Unity

Lini yang didukung saat ini adalah **Unity 6000.3**. Patch Editor tertentu baru dianggap tervalidasi jika ada bukti tercatat untuk sumber/kandidat terkait. Patch terbaru Unity tidak otomatis teruji atau didukung. Pilihan Editor pengujian ada di `release-contract.json`; bukti dirangkum dalam [STATUS.md](STATUS.md).

## Pengembang dan runtime

Pengembang sumber harus memakai rentang Node/npm/.NET/alat dari kontrak dan konfigurasi lock/build repositori. Ini **persyaratan sumber/build**, bukan persyaratan instalasi pengguna biasa jalur Host/Guest paket yang menggunakan runtime bawaan/mandiri sesuai kontrak. Keluarga utama runtime/toolchain baru memerlukan keputusan kompatibilitas dan validasi yang disengaja; satu instalasi berhasil tidak cukup.

## Topologi yang didukung

- WebSocket Server TeamForge terkonfigurasi untuk otoritas waktu nyata;
- HTTP Project Peer langsung pada PC yang sama, LAN terjangkau, atau VPN terkelola;
- mode satu PC eksplisit khusus loopback;
- listener non-loopback terautentikasi dengan host konkret yang diumumkan kepada Guest;
- alur Windows Host/Guest paket dengan Runtime bawaan terverifikasi.

Belum disediakan sebagai topologi yang didukung: WebRTC / RTCDataChannel; ICE / STUN / TURN; penembusan NAT otomatis; relay/fallback transport otomatis; penemuan peer otomatis; otoritas waktu nyata serverless/tertanam; penerapan Internet publik tak tepercaya dengan sistem identitas/otorisasi pengguna lengkap.

`P2P` berarti **transfer payload Project Peer langsung**, bukan konektivitas P2P Internet otomatis.

## Matriks platform

| Area | Status |
| --- | --- |
| Runtime bawaan Windows x64 / Guest Launcher | Arah paket saat ini; kandidat tepat tetap mengikuti gerbang lapangan STATUS |
| Unity 6000.3 | Lini Unity saat ini |
| Patch Unity tepat yang tercatat | `release-contract.json` dan bukti STATUS |
| Patch Unity 6000.3 lainnya | Memerlukan baseline/validasi terpisah sebelum disebut teruji |
| Launcher mandiri macOS/Linux | Tidak dipaketkan sebagai kandidat saat ini yang setara |
| Docker/Compose | Opsi sumber/server, bukan jalur Host paket biasa atau gerbang rilis saat ini |
| Authenticode | Status distribusi/penandatanganan ada di STATUS/dokumen artefak saat ini |

## Penyimpanan terkelola Windows pada sumber saat ini

Sumber saat ini memerlukan root terkelola lokal pada drive tetap NTFS/ReFS untuk kunci identitas proyek Windows. Root jaringan, tak tersedia, atau tak terverifikasi ditolak secara fail-closed. Ini syarat penyimpanan TeamForge, bukan syarat umum proyek Unity. Lihat [STATUS.md](STATUS.md) untuk batas sumber/kandidat terbit dan [implementasinya](../project-peer/src/project-identity-lock.mjs).

## Klaim dan riwayat

Laporan historis fase/pekerjaan/pengujian berlaku untuk sumber/artefak yang dicatatnya. Kemiripan versi produk tidak menjadikannya bukti terkini. Untuk identitas byte yang tepat, gunakan nama aset Release + SHA-256, bukan versi saja.
