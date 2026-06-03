# 04 — Installation & Deployment

## 4.1 Prerequisites

| Software | Minimum version | Notes |
|---|---|---|
| Python | 3.11 (3.13 recommended) | Backend runtime |
| Node.js | 20 LTS | Frontend tooling |
| npm | 10+ | Bundled with Node |
| MySQL | 8.0+ | Single database, `utf8mb4` |
| Git | any recent | For cloning |

## 4.2 Local Development Setup

### Step 1 — Clone

```bash
git clone <repository-url> bvc24-erp
cd bvc24-erp
```

### Step 2 — Database

Create a MySQL database (the application will create tables and apply auto-migrations on first run):

```sql
CREATE DATABASE bvc24
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER 'bvc24'@'localhost' IDENTIFIED BY 'CHANGE_ME';
GRANT ALL PRIVILEGES ON bvc24.* TO 'bvc24'@'localhost';
FLUSH PRIVILEGES;
```

### Step 3 — Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate      # macOS / Linux

pip install -r requirements.txt

# Configure .env (see §4.4 for full list)
cp .env.example .env             # or create manually
# edit .env with database + service credentials

# First run — creates tables and applies auto-migration
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

The backend will:

1. Read `.env`
2. Open a SQLAlchemy connection to MySQL
3. Run `Base.metadata.create_all()` to create any missing tables
4. Run the pending-migrations loop (idempotent `ALTER TABLE ... IF NOT EXISTS`)
5. Mount static file serving for `static/`
6. Start listening on port 8001

Verify:

- Swagger UI: `http://127.0.0.1:8001/docs`
- Health check: `http://127.0.0.1:8001/me` (returns 401 — that's correct without a token)

### Step 4 — Seed initial data

Run these endpoints once via Swagger UI or `curl` to bootstrap a working environment:

```
POST /seed-org           — creates Vendor 1, departments, designations, roles, permissions
POST /seed-admin         — creates a default admin account
POST /seed-employees     — creates demo employees with login credentials
POST /seed-bvc24         — full BVC24 demo seed (catalog + employees + customers + projects)
POST /seed-materials     — material catalog
POST /seed-project-templates  — project category + sub-project templates
```

After `/seed-bvc24` you can log in with the admin credentials shown in the response.

### Step 5 — Frontend

```bash
cd frontend
npm install
npm run dev
```

Vite serves the app at `http://localhost:5173`. The Axios base URL is hard-coded to `http://127.0.0.1:8001` in `src/services/api.js` — change there if your backend runs elsewhere.

## 4.3 Production Deployment

### Single-VM topology (recommended for current scale)

```
                        Internet
                           │
                       ┌───┴────┐
                       │ Nginx  │  ← reverse proxy, TLS termination
                       └───┬────┘
                ┌──────────┴───────────┐
                │                      │
        ┌───────┴───────┐      ┌───────┴───────┐
        │ /api/* → 8001 │      │ / → /dist/    │
        │   (Uvicorn)   │      │   (static)    │
        └───────┬───────┘      └───────────────┘
                │
        ┌───────┴───────┐
        │     MySQL     │
        │   localhost   │
        └───────────────┘
```

### Step-by-step

1. **Provision** a VM (AWS EC2 t3.medium / Azure B2s / similar, 4 vCPU 8 GB RAM).
2. **Install** Python 3.13, Node 20, MySQL 8, Nginx, Git.
3. **Clone** the repository to `/opt/bvc24-erp`.
4. **Backend**:
   - `cd /opt/bvc24-erp/backend && python -m venv venv && venv/bin/pip install -r requirements.txt`
   - Create `/opt/bvc24-erp/backend/.env` with production secrets.
   - Create a systemd unit (`/etc/systemd/system/bvc24-backend.service`):

     ```ini
     [Unit]
     Description=BVC24 Backend
     After=network.target mysql.service

     [Service]
     Type=simple
     User=www-data
     WorkingDirectory=/opt/bvc24-erp/backend
     ExecStart=/opt/bvc24-erp/backend/venv/bin/uvicorn app.main:app \
               --host 127.0.0.1 --port 8001 --workers 2
     Restart=always

     [Install]
     WantedBy=multi-user.target
     ```

   - `systemctl daemon-reload && systemctl enable --now bvc24-backend`.

5. **Frontend**:
   - `cd /opt/bvc24-erp/frontend && npm ci && npm run build`
   - Edit `src/services/api.js` so the base URL points to `/api` (relative) before building.
   - The build output is `frontend/dist/`.

6. **Nginx** (`/etc/nginx/sites-available/bvc24`):

   ```nginx
   server {
       listen 80;
       server_name erp.bvc24.in;

       # Frontend static
       root /opt/bvc24-erp/frontend/dist;
       index index.html;
       try_files $uri /index.html;

       # Backend API
       location /api/ {
           proxy_pass http://127.0.0.1:8001/;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_read_timeout 120;
       }

       # File uploads served by FastAPI under /static
       location /static/ {
           proxy_pass http://127.0.0.1:8001/static/;
       }
   }
   ```

7. **TLS** via Certbot: `certbot --nginx -d erp.bvc24.in`.

8. **First run**:
   - Hit `https://erp.bvc24.in/api/seed-bvc24` (with auth or while seed endpoints are still open).
   - Disable seed endpoints in production by guarding them with `ENVIRONMENT=production` check (recommended hardening, not yet enforced — see Appendix D Roadmap).

## 4.4 Environment Variables

See [Appendix C — Environment Variables](./appendix/C-environment-variables.md) for the complete list. The minimum required for the backend to start successfully:

```env
# Database
MY_SQL=localhost:3306
DB_NAME=bvc24

# JWT
SECRET_KEY=<generate-a-random-32-char-string>
ALGORITHM=HS256

# Email (one of Resend or SMTP)
RESEND_API_KEY=re_...
# or
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-account@gmail.com
SMTP_PASSWORD=<app-password>
SMTP_FROM=erp@bvc24.in
SMTP_FROM_NAME=BVC24 ERP

# Approver (for leave / task approval emails)
APPROVER_EMAIL=md@bvc24.in
APPROVER_NAME=Managing Director

# URLs
FRONTEND_URL=https://erp.bvc24.in
BACKEND_URL=https://erp.bvc24.in/api

# Optional WhatsApp (MD alerts)
CALLMEBOT_API_KEY=...
MD_WHATSAPP_NUMBER=+91...
# or full Cloud API
WHATSAPP_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...

# Optional Gemini chatbot
GEMINI_API_KEY=...
```

## 4.5 File Uploads

User-uploaded files (employee photos, BOM images, resume photos) are stored on the backend filesystem:

```
backend/app/static/
├── employee/        ← employee photos
├── bom/             ← BOM line images
└── (other folders auto-created on demand)
```

These are served by FastAPI's `StaticFiles` mount at `/static/`. In production, Nginx can proxy these directly or serve them from disk for better performance.

**Backup recommendation**: schedule a daily tarball of `backend/app/static/` alongside the database dump.

## 4.6 Database Backups

Daily mysqldump (cron):

```bash
0 2 * * * /usr/bin/mysqldump \
  --single-transaction --routines \
  -u bvc24 -p<password> bvc24 \
  | gzip > /var/backups/bvc24-$(date +\%F).sql.gz
```

Retain 30 days of daily backups + 1 monthly archive.

## 4.7 Upgrade Procedure

A production upgrade is:

```bash
cd /opt/bvc24-erp
git pull origin main
cd backend && venv/bin/pip install -r requirements.txt
cd ../frontend && npm ci && npm run build
sudo systemctl restart bvc24-backend
```

The backend startup will:

1. Apply any new auto-migrations idempotently.
2. Resume serving on port 8001.

No manual schema scripts to run. No frontend cache clear required (Vite uses content-hashed filenames; browsers pick up the new bundle on next page load).

## 4.8 Common Issues

| Symptom | Likely cause | Fix |
|---|---|---|
| `OperationalError: (1045) Access denied` | Wrong DB credentials in `.env` | Verify `MY_SQL`, `DB_NAME`, and that the MySQL user has privileges |
| `Email send failed: invalid Resend key` | Missing `RESEND_API_KEY` | Set either Resend or SMTP env vars |
| `CORS error in browser` | Frontend URL not in `main.py` allowed origins | Edit `app.add_middleware(CORSMiddleware, allow_origins=[...])` |
| 401 on every API call | JWT expired or `SECRET_KEY` changed | Log out & log in again |
| WhatsApp test fails | Token expired or phone not registered | Use `GET /whatsapp/diagnose` to inspect; CallMeBot needs initial WhatsApp "join" message |
| Auto-migration error on a column | Old DB has incompatible existing data | Inspect the SQL exception; the migration is `IF NOT EXISTS`, so most re-runs are no-ops |

---

Next: [05 — Security & Authentication](./05-security-and-authentication.md)
