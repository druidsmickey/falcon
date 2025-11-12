# Deployment Guide to DigitalOcean

## Prerequisites
1. GitHub repository with your code (repo: druidsmickey/falcon)
2. DigitalOcean account

## Method 1: DigitalOcean App Platform (Recommended)

### Step 1: Push Your Code to GitHub
```bash
git add .
git commit -m "Add DigitalOcean deployment configuration"
git push origin main
```

### Step 2: Create App on DigitalOcean
1. Go to [DigitalOcean App Platform](https://cloud.digitalocean.com/apps)
2. Click "Create App"
3. Choose "GitHub" as source
4. Select your repository: `druidsmickey/falcon`
5. Choose branch: `main`
6. Choose "Autodeploy" for automatic deployments

### Step 3: Configure Resources
The system will auto-detect your configuration from `.do/app.yaml`, or you can configure manually:

#### Frontend (Static Site):
- **Type**: Static Site
- **Source Directory**: `/` (root)
- **Build Command**: `npm install && npm run build:prod`
- **Output Directory**: `dist/games`
- **HTTP Routes**: `/` (catch all)

#### Backend (Service):
- **Type**: Service
- **Source Directory**: `backend`
- **Build Command**: `npm install`
- **Run Command**: `npm start`
- **HTTP Port**: 8080
- **HTTP Routes**: `/api`
- **Environment Variables**:
  - `NODE_ENV=production`
  - `PORT=8080`

### Step 4: Deploy
1. Review the configuration
2. Click "Create Resources"
3. Wait for deployment (5-10 minutes)

### Step 5: Update Frontend API URL
After deployment, you'll get URLs like:
- Frontend: `https://your-app-name.ondigitalocean.app`
- Backend: `https://your-app-name-backend.ondigitalocean.app`

Update `src/environments/environment.prod.ts` with the actual backend URL and redeploy.

## Method 2: DigitalOcean Droplets (VPS)

### Step 1: Create a Droplet
1. Create a new Droplet with Ubuntu 22.04
2. Choose your preferred size (Basic $6/month is sufficient for testing)
3. Add your SSH key

### Step 2: Setup Server
```bash
# Connect to your droplet
ssh root@your_droplet_ip

# Update system
apt update && apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt-get install -y nodejs

# Install Nginx
apt install nginx -y

# Install PM2 for process management
npm install -g pm2

# Clone your repository
git clone https://github.com/druidsmickey/falcon.git
cd falcon
```

### Step 3: Setup Backend
```bash
cd backend
npm install
pm2 start npm --name "games-backend" -- start
pm2 save
pm2 startup
```

### Step 4: Build and Setup Frontend
```bash
cd ..
npm install
npm run build:prod

# Copy built files to nginx
cp -r dist/games/* /var/www/html/
```

### Step 5: Configure Nginx
```bash
# Edit nginx configuration
nano /etc/nginx/sites-available/default
```

Add this configuration:
```nginx
server {
    listen 80;
    server_name your_domain_or_ip;

    # Frontend
    location / {
        root /var/www/html;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:3030;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Test and restart nginx
nginx -t
systemctl restart nginx
```

## Method 3: Docker on DigitalOcean

### Step 1: Create Container Registry
1. Go to DigitalOcean Container Registry
2. Create a new registry
3. Follow the authentication setup

### Step 2: Build and Push Images
```bash
# Build frontend
docker build -f Dockerfile.frontend -t registry-name/games-frontend .

# Build backend
docker build -f Dockerfile.backend -t registry-name/games-backend .

# Push images
docker push registry-name/games-frontend
docker push registry-name/games-backend
```

### Step 3: Deploy via App Platform
Create app using container images instead of source code.

## Cost Estimates

### App Platform:
- Static Site: $0/month (first 3 sites)
- Backend Service: $5/month (Basic plan)
- **Total: ~$5/month**

### Droplet:
- Basic Droplet: $6/month
- **Total: ~$6/month**

## Production Checklist

- [ ] Environment variables configured
- [ ] HTTPS enabled (automatic with App Platform)
- [ ] Database setup (if needed)
- [ ] Domain name configured
- [ ] Monitoring setup
- [ ] Backup strategy
- [ ] Error tracking

## Troubleshooting

### Common Issues:
1. **Build fails**: Check Node.js version compatibility
2. **API not accessible**: Verify CORS settings and routes
3. **Static files not loading**: Check output directory in build config

### Logs:
- App Platform: View in DigitalOcean dashboard
- Droplet: `pm2 logs` for backend, `nginx error.log` for frontend

## Next Steps

1. Set up a custom domain
2. Configure SSL certificate (automatic with App Platform)
3. Set up monitoring and alerts
4. Consider adding a database (DigitalOcean Managed Database)
5. Set up CI/CD for automatic deployments