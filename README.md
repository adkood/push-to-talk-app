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
