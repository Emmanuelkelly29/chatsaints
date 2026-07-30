# LDS YSA Connect — Docker Deployment Guide

## What Docker Does for You

Docker packages the entire app (Node.js backend, PostgreSQL database, Redis,
and Nginx) into containers. You run ONE command and everything starts together,
pre-configured and connected.

---

## Prerequisites

Install Docker on your server:
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # Add yourself to docker group
newgrp docker                   # Apply without logout
docker --version                # Confirm installation
```

Install Docker Compose:
```bash
sudo apt install docker-compose-plugin
docker compose version
```

---

## Step 1 — Prepare your environment file

```bash
cd lds-ysa-app/backend
cp .env.example .env
nano .env
```

Fill in at minimum:
```
DB_PASSWORD=choose_a_strong_database_password
JWT_SECRET=choose_a_random_64_char_string_for_jwt_signing
FCM_SERVER_KEY=get_this_from_firebase_console
```

Everything else can be left as-is for the first run.

---

## Step 2 — Update your domain name

In `nginx/nginx.conf`, replace every occurrence of `api.yourdomain.com`
with your actual domain name:
```bash
sed -i 's/api.yourdomain.com/api.YOURACTUALDOMAINHERE.com/g' nginx/nginx.conf
```

---

## Step 3 — Start everything (development / first run)

Start without SSL first to confirm everything works:
```bash
# From the lds-ysa-app/ folder
docker compose up --build -d
```

This will:
1. Pull PostgreSQL 16 and Redis 7 images
2. Build the Node.js backend image
3. Run all 4 database migration files automatically
4. Start all services and connect them

Check they are running:
```bash
docker compose ps
```

You should see all services as "healthy".

Test the API:
```bash
curl http://YOUR_SERVER_IP:4000/health
# Should return: {"status":"ok","app":"LDS YSA Connect"}
```

---

## Step 4 — Enable SSL (production)

Point your domain's DNS A record to your server IP first.
Then run Certbot to get a free SSL certificate:

```bash
docker compose --profile ssl-setup up certbot
```

After the certificate is obtained, restart Nginx:
```bash
docker compose restart nginx
```

Test HTTPS:
```bash
curl https://api.yourdomain.com/health
```

---

## Step 5 — Update your Flutter app

Open `frontend/lib/utils/constants.dart` and update:
```dart
static const String baseUrl = 'https://api.yourdomain.com';
static const String wsUrl   = 'wss://api.yourdomain.com/ws';
```

Then rebuild your Flutter app:
```bash
cd frontend
flutter build apk --release    # Android
flutter build ios --release    # iOS
```

---

## Daily Management Commands

```bash
# View live logs from all services
docker compose logs -f

# View logs from backend only
docker compose logs -f backend

# Restart a specific service (after code change)
docker compose restart backend

# Rebuild and restart after code changes
docker compose up --build -d backend

# Stop everything
docker compose down

# Stop and remove all data (CAUTION: deletes database!)
docker compose down -v

# Check database
docker compose exec postgres psql -U lds_admin -d lds_ysa_db

# Run a migration manually
docker compose exec postgres psql -U lds_admin -d lds_ysa_db \
  -f /docker-entrypoint-initdb.d/003_reactions_and_groups.sql
```

---

## Automatic Database Backup

Add this to your server's crontab (`crontab -e`):

```bash
# Backup database every day at 2:00 AM
0 2 * * * docker compose -f /path/to/lds-ysa-app/docker-compose.yml \
  exec -T postgres pg_dump -U lds_admin lds_ysa_db \
  > /backups/lds_ysa_$(date +\%Y\%m\%d).sql

# Keep only last 30 days of backups
0 3 * * * find /backups -name "lds_ysa_*.sql" -mtime +30 -delete
```

Create the backups folder:
```bash
sudo mkdir -p /backups
sudo chmod 755 /backups
```

---

## Scaling for High Traffic

When your user base grows, scale the backend horizontally:

```bash
# Run 3 backend instances behind Nginx load balancer
docker compose up --scale backend=3 -d
```

Update nginx.conf upstream block:
```nginx
upstream backend_pool {
  least_conn;
  server backend_1:4000;
  server backend_2:4000;
  server backend_3:4000;
}
```

For very large deployments (10,000+ concurrent users), consider:
- Managed PostgreSQL (AWS RDS, DigitalOcean Managed Databases)
- Managed Redis (AWS ElastiCache, Upstash)
- Kubernetes with auto-scaling (AWS EKS, Google GKE)

---

## Monitoring

Check container resource usage:
```bash
docker stats
```

Check disk space used by Docker:
```bash
docker system df
```

Clean up unused images and containers (safe to run anytime):
```bash
docker system prune -f
```
