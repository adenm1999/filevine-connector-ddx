# Deployment Guide — Render + Domo Embed

## Option A: Deploy to Render (Recommended)

### 1. Push to GitHub
```bash
cd filevine-connector-ddx
git init
git add .
git commit -m "Filevine Connector v6"
git remote add origin https://github.com/YOUR_USER/filevine-connector-ddx.git
git push -u origin main
```

### 2. Deploy on Render
1. Go to [render.com](https://render.com) → **New** → **Web Service**
2. Connect your GitHub repo
3. Settings:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** Free (or Starter for always-on)
4. Click **Create Web Service**
5. Your app will be live at `https://filevine-connector-XXXX.onrender.com`

Or use the included `render.yaml` for one-click blueprint deploy.

### 3. Surface in Domo

**Option 1 — HTML Embed Card (simplest):**
1. Open any Domo dashboard
2. **+ Add Card** → choose **Doc Card** or **Notebook** card type
3. Use an iframe embed:
   ```html
   <iframe src="https://filevine-connector-XXXX.onrender.com" 
           width="100%" height="900" frameborder="0"></iframe>
   ```

**Option 2 — DDX Custom App (proper integration):**
1. Install Domo CLI: `npm install -g @domoinc/ryuu`
2. `domo login` → enter `filevine-springslawgroup.domo.com`
3. From the project directory: `domo init` (first time)
4. `domo publish`
5. Add to dashboard via **+ Add Card** → **Custom App** → **Filevine Connector**

Note: If using DDX, the app can also call Render's proxy endpoints instead of localhost. Update the fetch URLs in index.html to point to your Render URL.

---

## Option B: Domo DDX Only (No External Hosting)

If you want to run entirely inside Domo without an external server:

1. The DDX proxy (configured in `manifest.json`) handles Filevine API calls
2. Domo API calls use `domo.js` which is auto-injected
3. However, the PAT→Bearer token exchange requires a server-side call to `identity.filevine.com` which the DDX proxy doesn't support directly

**Workaround:** Keep the Render proxy running just for the token exchange endpoint, and route everything else through Domo's proxy.

---

## Environment Variables (Optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `ALLOWED_ORIGIN` | `*` | CORS origin (set to your Domo instance URL for security) |
| `NODE_ENV` | — | Set to `production` on Render |

---

## After Deployment

1. Open your Render URL in a browser
2. Go to **Settings** → connect Domo + Filevine as usual
3. The new **Filevine Browse** page shows cached dependency counts
4. All parameterized endpoints auto-resolve IDs from cache
