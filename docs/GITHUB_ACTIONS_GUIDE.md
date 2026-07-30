# LDS YSA Connect — GitHub Actions CI/CD Guide

## What These Pipelines Do

### CI pipeline (ci.yml) — runs on every push and pull request
1. Runs all 66 backend Jest tests against a real PostgreSQL + Redis
2. Checks Flutter Dart code for errors
3. Builds the Docker image to confirm nothing is broken

### CD pipeline (deploy.yml) — runs on merges to main and version tags
1. Builds and pushes the Docker image to GitHub Container Registry
2. SSHes into your production server and pulls + restarts the backend
3. Runs database health check to confirm deployment succeeded
4. On version tags (v1.0.0, v1.1.0, etc.): builds Android APK + App Bundle
5. Creates a GitHub Release with downloadable APK files

---

## Setting Up GitHub Secrets

Go to your GitHub repository → Settings → Secrets and variables → Actions.
Add these secrets:

### For deployment (deploy.yml)
| Secret name                  | Value |
|------------------------------|-------|
| `PROD_SERVER_HOST`           | Your server's IP address or domain |
| `PROD_SERVER_USER`           | SSH username (usually `ubuntu` or `root`) |
| `PROD_SERVER_SSH_KEY`        | Contents of your SSH private key (`cat ~/.ssh/id_rsa`) |

### For Android signing (deploy.yml build-android job)
| Secret name                  | Value |
|------------------------------|-------|
| `ANDROID_KEYSTORE_BASE64`    | Base64-encoded keystore: `base64 ~/lds-ysa-release.jks` |
| `KEYSTORE_STORE_PASSWORD`    | Your keystore password |
| `KEYSTORE_KEY_PASSWORD`      | Your key password |
| `KEYSTORE_KEY_ALIAS`         | Your key alias (`lds-ysa-key`) |

---

## How to Create Your First Release

1. Merge all your changes into `main`
2. Tag the release:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
3. GitHub Actions will automatically:
   - Test everything
   - Build the Docker image and deploy to your server
   - Build Android APK + App Bundle
   - Create a GitHub Release with download links

---

## How to Push to GitHub (First Time)

```bash
# Create a new repository on github.com first
cd lds-ysa-app

git init
git add .
git commit -m "Initial commit — LDS YSA Connect v1.0"

git remote add origin https://github.com/YOUR_USERNAME/lds-ysa-connect.git
git branch -M main
git push -u origin main
```

---

## Monitoring Deployments

View live deployment logs:
1. Go to your GitHub repository
2. Click the "Actions" tab
3. Click on any workflow run to see step-by-step logs

If a deployment fails, the pipeline will not proceed to the next step,
protecting your production server from broken deployments.

---

## Branch Strategy

| Branch     | Purpose                          | Auto-deploy |
|------------|----------------------------------|-------------|
| `main`     | Production-ready code            | Yes (server) |
| `develop`  | Integration testing              | No |
| `feature/*`| New features (pull requests)     | No |

Workflow:
```
feature/voice-notes  →  develop  →  main  →  deploy
```
