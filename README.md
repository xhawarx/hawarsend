<div align="center">

<img src="apps/web/public/logo.svg" width="96" height="96" alt="HawarSend" />

# HawarSend

**Uçtan uca şifreli, kendi sunucunda çalışan dosya ve not paylaşımı.**
**End-to-end encrypted, self-hosted file and note sharing.**

[Canlı demo](https://send.hawar.dev) · [Kurulum](#-tek-komutla-kurulum) · [Admin paneli](#-admin-paneli) · [Güvenlik](#-güvenlik) · [English](#-english)

</div>

---

Dosyalar ve notlar tarayıcıdan çıkmadan önce şifrelenir. Anahtar linkin `#` işaretinden sonraki
kısmında durur ve tarayıcılar o kısmı sunucuya hiç göndermez. Sunucu yalnızca şifreli veriyi
saklar: dosya adını, içeriği ya da anahtarı göremez.

## ✨ Özellikler

- **Dosya paylaşımı:** Çoklu dosya ve klasör, büyük dosyalar için parça parça ve WebSocket ile yükleme.
- **Notlar:** Metin, parola, kod ve SSH anahtarı blokları. Okunduktan sonra kendini silen notlar.
- **Dosya istekleri:** Birine yükleme linki ver, gönderdikleri yalnızca senin için şifrelensin.
- **Kendini silen paylaşımlar:** Süre ve indirme sınırı, hangisi önce dolarsa.
- **Parola koruması:** İsteğe bağlı, Argon2id ile türetilir.
- **Admin paneli:** İstatistikler, paylaşım listeleri, silme, temizlik, sunucu ayarları.
- **Siyah ve mavi tema**, açık ve koyu mod, Türkçe dahil 16 dil.
- **Depolama:** Yerel disk ya da S3 uyumlu her şey (AWS S3, Cloudflare R2, MinIO).
- **İsteğe bağlı OIDC girişi:** Kimlerin paylaşım yapabileceğini sen belirlersin.
- **Tek container, SQLite.** Ek veritabanı ya da Redis gerekmez.

## 🚀 Tek komutla kurulum

Docker kurulu olmayan boş bir Linux sunucuda bile tek komut yeter:

```bash
curl -fsSL https://raw.githubusercontent.com/xhawarx/hawarsend/hawarsend-v2/install.sh | sudo bash
```

Betik şunları yapar:

1. Docker'ı kurar (yoksa).
2. Domain sorar. Domain verirsen Caddy ile otomatik HTTPS (Let's Encrypt) kurar.
3. Güçlü bir admin şifresi üretir, ayarları `/opt/hawarsend/.env` içine yazar.
4. HawarSend'i başlatır ve adresi, admin şifresini ekrana yazar.

Domain'in DNS A kaydını sunucunun IP'sine yönlendirmeyi unutma. Soru sormadan kurmak için:

```bash
curl -fsSL https://raw.githubusercontent.com/xhawarx/hawarsend/hawarsend-v2/install.sh | sudo HAWARSEND_DOMAIN=send.ornek.com HAWARSEND_NONINTERACTIVE=1 bash
```

Güncellemek ve kaldırmak:

```bash
curl -fsSL https://raw.githubusercontent.com/xhawarx/hawarsend/hawarsend-v2/install.sh | sudo bash -s update
```

```bash
curl -fsSL https://raw.githubusercontent.com/xhawarx/hawarsend/hawarsend-v2/install.sh | sudo bash -s uninstall
```

Kaldırma yalnızca container'ları durdurur, verilerin `/opt/hawarsend` içinde kalır.

### Docker Compose ile elle kurulum

```yaml
services:
  hawarsend:
    image: ghcr.io/xhawarx/hawarsend:edge
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
      - ./uploads:/uploads
    environment:
      - BASE_URL=https://send.ornek.com
      - ADMIN_PASSWORD=en-az-12-karakterlik-guclu-bir-sifre
      - TRUST_PROXY=true
```

Şifreleme tarayıcının Web Crypto API'sini kullanır ve bu API yalnızca HTTPS ya da `localhost`
üzerinde çalışır. Önüne Caddy, Nginx ya da Traefik gibi HTTPS sağlayan bir ters vekil koy.

### Coolify

Depoyu "Docker Compose" uygulaması olarak ekle, compose dosyası `/docker-compose.yml`. Domain'i
`skysend` servisine ver ve ortam değişkenlerine `ADMIN_PASSWORD` ekle. `BASE_URL` Coolify'ın
verdiği adresten otomatik alınır.

## 🛡️ Admin paneli

`ADMIN_PASSWORD` tanımlıysa panel `https://<domain>/admin` adresinde açılır. Tanımlı değilse
panel ve API'si tamamen kapalıdır.

- Aktif dosya paylaşımları, notlar, açık istekler ve kullanılan depolama.
- Kimliğe göre arama, aktif ya da süresi dolmuş filtresi, onaylı silme.
- Süresi dolanları tek tuşla temizleme, sunucu ayarlarını görüntüleme.

Panel de sunucu gibi kördür: yalnızca kimlik, boyut, sayaç ve tarih görür. Dosya adlarını,
içerikleri ve anahtarları göremez.

| Değişken | Varsayılan | Açıklama |
| :--- | :--- | :--- |
| `ADMIN_PASSWORD` | yok | Panelin şifresi, en az 12 karakter. Boşsa panel kapalı. |
| `ADMIN_SESSION_DURATION` | `7200` | Oturum süresi, saniye. |
| `ADMIN_ALLOWED_IPS` | herkes | Paneli yalnızca bu IP ya da ağlara aç, örnek `203.0.113.7,10.0.0.0/8`. Diğerleri 404 alır. |

Tüm ayarlar için: [ortam değişkenleri](docs/user-guide/configuration/environment-variables.md).

## 🔒 Güvenlik

- AES-256-GCM ile tarayıcıda şifreleme, HKDF-SHA256 ile anahtar türetme, Argon2id parolalar.
- Anahtar URL'nin `#` kısmında, sunucuya ve loglara asla ulaşmaz.
- IP başına hız sınırı ve yükleme kotası, IP'ler yalnızca HMAC ile karıştırılmış olarak tutulur.
- Parola denemelerinde kilitleme. Admin girişinde ayrıca tüm IP'ler için toplam deneme sınırı.
- Admin oturumu: HttpOnly, SameSite=Strict çerez, çıkışta sunucu tarafında sonlandırılır.
- Sıkı CSP, HSTS, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`.
- Container root olmayan bir kullanıcıyla çalışır.

Bir güvenlik açığı bulursan lütfen herkese açık bir issue yerine GitHub'ın
[özel güvenlik bildirimi](https://github.com/xhawarx/hawarsend/security/advisories/new) özelliğini kullan.

## 🧑‍💻 Geliştirme

```bash
pnpm install
cp .env.dev.example .env.dev
pnpm dev
```

Web arayüzü `http://localhost:5173`, API `http://localhost:3000` adresinde açılır.
`pnpm validate` lint, tip kontrolü ve testleri çalıştırır.

## 🌍 English

HawarSend encrypts files and notes in the browser before upload. The key lives in the part of the
link after `#`, which browsers never send, so the server only ever stores ciphertext.

Install on any Linux server with one command:

```bash
curl -fsSL https://raw.githubusercontent.com/xhawarx/hawarsend/hawarsend-v2/install.sh | sudo bash
```

It installs Docker if needed, asks for a domain, sets up automatic HTTPS with Caddy, generates an
admin password and starts everything. The admin panel lives at `/admin` once `ADMIN_PASSWORD` is
set, and it sees only IDs, sizes, counters and times, never names, contents or keys.

## 📝 Lisans ve teşekkür

HawarSend, [Skyfay](https://github.com/Skyfay) tarafından geliştirilen açık kaynak
[SkySend](https://github.com/Skyfay/SkySend) projesinin bir çatalıdır. Şifreleme altyapısı ve
güvenlik tasarımı SkySend'den gelir. Teşekkürler!

[GNU Affero General Public License v3.0](LICENSE) ile lisanslanmıştır. HawarSend'i değiştirip
herkese açık bir sunucuda çalıştırırsan, değiştirdiğin kaynak kodunu da kullanıcılarına açman gerekir.
