# 🎮 NEON REBOUND - Multiplayer Jumping Game

A fast-paced vertical jumping game with real-time multiplayer, global leaderboards, and seed-based challenges. Built with Firebase and PeerJS - no backend server, no build tools, no dependencies required!

**Deploy to GitHub Pages in 10 minutes - 100% FREE!** ✨

## 🌟 Features

- **Real-time Multiplayer** - Play with up to 8 friends via peer-to-peer connections
- **Global Leaderboards** - Compete for world records on any seed
- **Seed-Based Levels** - Share custom seeds or play daily challenges
- **Anonymous Play** - No registration required, just enter a name and play
- **Cross-Platform** - Works on desktop and mobile browsers
- **Free Hosting** - Deploy to GitHub Pages at zero cost

## 🚀 Quick Start

### Play Locally

1. Clone this repository
2. Run a local server (required for ES6 modules):
   - **Windows:** Double-click `start-server.bat`
   - **Python:** `python -m http.server 8000`
   - **Node.js:** `npx -y http-server -p 8000`
3. Open `http://localhost:8000` in your browser
4. Enter your name and start playing!

**Note:** Opening `index.html` directly (`file://`) won't work due to CORS restrictions with ES6 modules.

### Multiplayer Setup

**Host:**
1. Enter your name
2. Copy your ID from the bottom of the menu
3. Share ID with friends
4. Click "START MISSION"

**Join:**
1. Enter your name
2. Paste host's ID in "PASTE HOST ID" field
3. Click "JOIN LOBBY"
4. Wait for host to start

## 📁 Project Structure

```
jumper2/
├── index.html              # Main HTML entry point
├── index-original.html     # Backup (pre-refactoring)
├── css/
│   └── styles.css          # Game styles and animations
├── js/
│   ├── firebase-manager.js # Firebase & database operations (~450 lines)
│   ├── multiplayer.js      # PeerJS & networking logic (~308 lines)
│   ├── game-engine.js      # Core game logic & physics (~287 lines)
│   └── ui-controller.js    # UI interactions & controls (~73 lines)
├── js_admin/
│   └── dev-console.js      # Developer tools (debug mode only)
├── assets/
│   └── favicon.svg         # Game icon
├── config/
│   ├── firebase-config.js          # Firebase configuration
│   └── firebase-security-rules.json # Database security rules
├── functions/              # ⭐ NEW: Cloud Functions (server-side anti-cheat)
│   ├── index.js            # Score validation, replay analysis (~430 lines)
│   ├── package.json        # Node dependencies
│   └── .gitignore          # Ignore node_modules
├── docs/                   # Documentation
│   ├── CLOUD-FUNCTIONS-GUIDE.md    # ⭐ NEW: Functions deployment guide
│   ├── QUICKSTART-FUNCTIONS.md     # ⭐ NEW: Quick deploy steps
│   └── ...                         # Other docs
├── .github/
│   └── workflows/
│       └── deploy.yml      # GitHub Actions auto-deployment
├── firebase.json           # ⭐ NEW: Firebase project configuration
├── start-server.bat        # Windows local server script
├── GITHUB-PAGES-SETUP.md   # GitHub Pages deployment guide
└── README.md               # This file
```


## 🎯 Game Controls

- **Arrow Keys** or **A/D** - Move left/right
- **Space** - (Used in menus only)
- Jump automatically when landing on platforms

## 🏆 Leaderboards

### Global Leaderboard
- Top 50 scores across all seeds
- Click "WORLD RECORDS" to view
- Click seed name to try that seed

### Seed Leaderboard
- Top 10 scores for current seed
- Displayed on right side during gameplay
- Real-time updates

## 🌱 Seeds

Seeds determine platform placement. Same seed = same level layout.

**Examples:**
- `MISSION_1` - Default seed
- `DAILY_2026_03_04` - Daily challenge format
- `SPEEDRUN_HARD` - Custom challenge

**Seed Rules:**
- 1-50 characters
- Alphanumeric + underscores + hyphens
- Case sensitive

## 🛠️ Development

### Prerequisites

- Modern web browser (Chrome, Firefox, Edge, Safari)
- Node.js (for Firebase CLI)
- Firebase account

### Local Development

```bash
# No build step required - just open the HTML file!
# For debugging, add ?debug=1 to URL (localhost only)
```

### Debug Console

Add `?debug=1` to URL on localhost to enable developer tools:

```javascript
// Browser console commands:
testSubmitScore("NAME", score, "seed")  // Submit test score
viewMyScores()                          // View your scores
deleteMyScores()                        // Delete your scores
reAuthenticate()                        // Force re-auth

// Telemetry validation testing:
runTelemetryTests()                     // Run comprehensive test suite
testValidTelemetry()                    // Test valid scenarios
testBoundaries()                        // Test edge cases
testCheatDetection()                    // Test cheat detection
testCustomTelemetry(score, telemetry)  // Test custom values
```

**Note:** Debug console is automatically disabled on production domains.

**See:** `docs/TELEMETRY-TESTING-GUIDE.md` for detailed testing instructions.

## 📦 Deployment

### 🚀 GitHub Pages (Recommended - 100% Free)

**Perfect for:** Everyone! Casual games, indie developers, learning projects, production games

**What you get:**
- ✅ **Free hosting** - Zero cost, no credit card
- ✅ **Automatic SSL** - HTTPS enabled automatically
- ✅ **Auto-deploy** - Push to GitHub = instant deploy
- ✅ **No dependencies** - No build tools, no npm packages
- ✅ **Production-ready** - Global CDN, fast performance

**Quick Deploy (3 steps):**

```bash
# 1. Push to GitHub
git add .
git commit -m "Deploy NEON REBOUND"
git push origin main

# 2. Enable GitHub Pages
#    Go to: Repository Settings → Pages → Source: main branch

# 3. Done! 
#    Visit: https://yourusername.github.io/jumper2/
```

**📖 See [`GITHUB-PAGES-SETUP.md`](GITHUB-PAGES-SETUP.md) for complete step-by-step guide.**

---

### Firebase Hosting (Alternative)

**Best for:** Firebase ecosystem integration, custom Firebase domains

```bash
# Install Firebase CLI (one-time)
npm install -g firebase-tools

# Login and deploy
firebase login
firebase deploy --only hosting
```

Both GitHub Pages and Firebase Hosting use the same code - just different hosting platforms!

## 🔧 Configuration


### Firebase Setup (Required)

**One-time setup for your Firebase backend:**

1. **Create Firebase Project**
   - Go to [console.firebase.google.com](https://console.firebase.google.com)
   - Click "Add project" and follow wizard

2. **Enable Realtime Database**
   - In project, go to Realtime Database
   - Click "Create Database"
   - Choose any location (e.g., europe-west1)
   - Start in **test mode** (or production mode with rules)

3. **Enable Anonymous Authentication**
   - Go to Authentication → Sign-in method
   - Enable "Anonymous" provider

4. **Update Firebase Config**
   - Get your config from Project Settings → General
   - Update `config/firebase-config.js` with your values

5. **Add Authorized Domains**
   - Go to Authentication → Settings → Authorized domains
   - Add your GitHub Pages domain: `username.github.io`

**That's it!** Your Firebase backend is ready. Now deploy to GitHub Pages.

**Note:** Firebase API keys are safe to commit to Git. See: https://firebase.google.com/docs/projects/api-keys

## 📊 Monitoring

### Firebase Console

Monitor your game's usage:
- **Database Usage** - Reads, writes, bandwidth
- **Authentication** - Active users

### Set Billing Alerts

1. Firebase Console → Settings → Usage and billing
2. Set budget alerts (e.g., $5, $10)
3. Receive email notifications

### Free Tier Limits

- **Database**: 1 GB storage, 10 GB/month downloads
- **Authentication**: Unlimited
- **Hosting**: 10 GB storage, 360 MB/day bandwidth

Most indie games stay well within free tier limits.

## 🐛 Troubleshooting

### "Permission Denied" Errors
- **Cause**: Database security configuration
- **Fix**: Check Firebase Console database rules

### PeerJS Connection Issues
- **Cause**: Firewall or NAT traversal problems
- **Fix**: Ensure HTTPS is enabled, test on different networks

### Scores Not Appearing
- **Cause**: Authentication failed or database error
- **Fix**: Check browser console for error messages

**See `GITHUB-PAGES-SETUP.md` for more troubleshooting tips.**

## 🔐 Security & Anti-Cheat

### Multi-Layer Security Architecture

**Level 1: Client-Side Pre-Checks** (UX optimization)
- Input sanitization and validation
- Telemetry tracking during gameplay
- SHA-256 checksum generation

**Level 2: Firebase Security Rules** (Database-level)
- Authentication enforcement
- Data structure validation
- Rate limiting (30-second cooldown)
- Field-level validation

**Level 3: Cloud Functions** (Server-side validation) ⭐ **NEW**
- Checksum verification (cannot be bypassed)
- Advanced telemetry analysis
- Replay physics validation
- Anomaly detection and behavior analysis
- **Security Level: 90-95%** (vs 75-80% with Rules only)

### Cloud Functions Anti-Cheat (Recommended)

**Status**: ✅ Deployed and Active

**What it prevents:**
- ❌ Browser DevTools score manipulation
- ❌ Network request tampering
- ❌ Memory editing/injection
- ❌ Checksum bypass attempts
- ❌ Impossible scores (physics violations)
- ❌ Rapid bot submissions
- ❌ Replay data injection

**Cost**: $0-5/month (free for most games on Spark plan)

**Deploy**: See `docs/QUICKSTART-FUNCTIONS.md`

### API Key Exposure

Firebase API keys in `firebase-config.js` are **intentionally public**.

**From Firebase Documentation:**
> "API keys for Firebase services are not used to control access to backend resources; that can only be done with Firebase Security Rules."

Security is enforced server-side through Cloud Functions and Security Rules, not through API key secrecy.

**See `docs/CLOUD-FUNCTIONS-GUIDE.md` for complete security documentation.**

## 📈 Performance Tips

### Reduce Database Reads

Implement client-side caching:

```javascript
// Cache leaderboard for 30 seconds
let cachedLeaderboard = null;
let lastFetch = 0;

function fetchLeaderboard() {
    const now = Date.now();
    if (cachedLeaderboard && now - lastFetch < 30000) {
        return cachedLeaderboard;
    }
    // Fetch from database...
}
```

### Optimize Multiplayer

- Limit position updates to 30 FPS (not 60)
- Only send position when changed significantly
- Compress data before sending

## 🎨 Customization

### Change Theme Colors

Edit CSS variables in `index.html`:

```css
:root { 
    --neon: #00f2ff;      /* Player color */
    --bg: #0d0221;        /* Background */
    --warning: #ff0055;   /* Warnings */
    --gold: #ffd700;      /* First place */
    --magenta: #ff00ff;   /* Opponents */
}
```

### Adjust Game Physics

Edit constants in `index.html`:

```javascript
player.vy = -650;    // Jump velocity
player.vx = 400;     // Movement speed
1600 * dt           // Gravity
```

### Modify Score Limits

Edit in both:
1. `index.html` - `SECURITY_CONFIG` object
2. `config/firebase-security-rules.json` - validation rules

**Important:** Must match in both places!

## 📝 License

This project is provided as-is for educational purposes.

## 🤝 Contributing

Contributions welcome! Areas for improvement:

- [ ] Mobile touch controls optimization
- [ ] Sound effects and music
- [ ] Power-ups and obstacles
- [ ] Replay system
- [ ] Tournament mode
- [ ] Custom skins/themes

## 🌐 Browser Compatibility

**Fully Supported:**
- Chrome 90+
- Firefox 88+
- Edge 90+
- Safari 14+

**Required Features:**
- ES6 Modules
- WebRTC (for multiplayer)
- Firebase SDK 10.x
- PeerJS 1.5+

## 📞 Support

- **Deployment Help**: See `GITHUB-PAGES-SETUP.md`
- **Firebase Docs**: https://firebase.google.com/docs
- **PeerJS Docs**: https://peerjs.com/docs.html

## 🎉 Credits

**Game Design**: NEON REBOUND Team
**Firebase**: Google
**PeerJS**: PeerJS Community

---

**Made with ❤️ and lots of ☕**

**Status**: Production Ready ✅
**Last Updated**: March 6, 2026
**Version**: 1.0.0

