# 1-on-1 Push-To-Talk Voice App

A streamlined, minimal real-time Push-To-Talk application where users enter their name, see who is online, and talk directly 1-on-1 with busy/in-call collision protection.

---

## ⚡ Core User Flow

1. **Enter Name**:
   - On opening the app, the user is prompted to enter their name (e.g., *Alice*, *Bob*).
2. **Online Users Lobby**:
   - View all currently connected users in real time.
   - Status indicators:
     - 🟢 **Available**: Ready to talk. Click **"Talk"** to start a 1-on-1 session.
     - 🔴 **In a Call (Busy)**: Already talking with someone else. Disabled with a busy badge.
3. **1-on-1 Push to Talk**:
   - Both users are paired in a direct 1-on-1 room with live WebRTC voice streaming.
   - Floor control: Only one person can speak at a time.
   - Hold button (or Spacebar) to talk; release to mute.
   - Click **"End Call"** to return both users to the lobby as **Available**.

---

## 🚀 How to Run

```bash
npm run dev
```

- **Web App:** [http://localhost:5173](http://localhost:5173)
- **Backend API & WebSockets:** [http://localhost:5000](http://localhost:5000)

To test on your phone simultaneously:
```bash
npm run tunnel
```

---

## 🌐 Deploy to Render

You can deploy the app to [Render](https://render.com) using either **Single Fullstack Service (Recommended)** or **Standalone Backend Service**.

### Option 1: Fullstack Service (Easiest - 1 URL on Free Tier)
Deploy both the React frontend and Node.js WebSocket backend together on a single Render Web Service:

1. Push your repository to GitHub / GitLab.
2. In the Render Dashboard, click **New +** -> **Web Service**.
3. Connect your repository.
4. Configure settings:
   - **Name**: `push-to-talk-app`
   - **Language**: `Node`
   - **Branch**: `main`
   - **Root Directory**: *(Leave empty)*
   - **Build Command**: `npm run build`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/health`
5. Click **Create Web Service**.
6. Once deployed, open your `https://your-service.onrender.com` URL in two browser windows or share it with a friend!

### Option 2: Standalone Backend Web Service
If you want to host the frontend separately (e.g., on Vercel, Netlify, or Render Static Sites):

1. In the Render Dashboard, create a **Web Service** with:
   - **Root Directory**: `server`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/health`
2. In your frontend environment variables (e.g. on Vercel), set:
   - `VITE_WS_URL`: `wss://your-service.onrender.com/ws`

### Option 3: Render Blueprint (1-Click)
Render detects `render.yaml` automatically when creating a **Blueprint** instance from your repository.

