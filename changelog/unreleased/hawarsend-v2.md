> ⚠️ **Breaking:** The instance is now branded HawarSend and starts on the Midnight theme in dark mode with a blue accent. Set CUSTOM_TITLE, DEFAULT_THEME, DEFAULT_COLOR_SCHEME or CUSTOM_COLOR to keep the old look.

### ✨ Features

- **server**: A web admin API at /api/admin lists, counts and deletes shares while ADMIN_PASSWORD is set, behind a password lockout and an HttpOnly session cookie.
- **web**: An admin panel at /admin shows the stats, the shares, the notes, the file requests and the server settings of the instance.
- **web**: Turkish is now available as a language.

### 🎨 Improvements

- **web**: The Midnight theme has navy tinted dark surfaces and a new HawarSend logo.

### 🔒 Security

- **server**: The admin login refuses bodies over 16 KB and stops all logins after 30 failures in an hour from any address.
- **server**: An admin logout now ends the session on the server, and admin sessions last two hours by default.
- **server**: ADMIN_ALLOWED_IPS limits the admin API to listed addresses or networks.
- **server**: Responses carry a Permissions-Policy that turns off camera, microphone, location and similar browser features.
- **docker**: Nested env files stay out of the Docker build context.

### 🔧 CI/CD

- **infra**: A publish workflow builds the image for amd64 and arm64 and pushes it to the GitHub Container Registry.
- **infra**: A one-command installer sets up Docker, HTTPS through Caddy, an admin password and HawarSend.
