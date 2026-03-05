/**
 * FIREBASE MANAGER MODULE
 * Handles Firebase authentication, database operations, and security
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, onValue, query, orderByChild, equalTo, remove, get, push, set, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { firebaseConfig } from "../config/firebase-config.js";

// ============================================
// SECURITY CONFIGURATION
// ============================================
const SECURITY_CONFIG = {
    MAX_NAME_LENGTH: 20,
    MIN_NAME_LENGTH: 1,
    MAX_SEED_LENGTH: 50,
    MIN_SEED_LENGTH: 1,
    MIN_SCORE: 10,
    MAX_SCORE: 100000,
    SUBMISSION_COOLDOWN_MS: 5000,
    MAX_PEER_CONNECTIONS: 8,
    ALLOWED_SEED_PATTERN: /^[A-Za-z0-9_-]+$/,
    ALLOWED_NAME_PATTERN: /^[A-Za-z0-9_\-\s]+$/
};

// ============================================
// INPUT SANITIZATION FUNCTIONS
// ============================================

/**
 * Sanitizes HTML to prevent XSS attacks
 * @param {string} str - Input string
 * @returns {string} Sanitized string
 */
export function sanitizeHTML(str) {
    const temp = document.createElement('div');
    temp.textContent = str;
    return temp.innerHTML;
}

/**
 * Validates and sanitizes player name
 * @param {string} name - Player name
 * @returns {string|null} Sanitized name or null if invalid
 */
export function sanitizeName(name) {
    if (typeof name !== 'string') return null;
    name = name.trim().substring(0, SECURITY_CONFIG.MAX_NAME_LENGTH);
    if (name.length < SECURITY_CONFIG.MIN_NAME_LENGTH) return null;
    if (!SECURITY_CONFIG.ALLOWED_NAME_PATTERN.test(name)) return null;
    return sanitizeHTML(name);
}

/**
 * Validates and sanitizes seed string
 * @param {string} seed - Game seed
 * @returns {string|null} Sanitized seed or null if invalid
 */
export function sanitizeSeed(seed) {
    if (typeof seed !== 'string') return null;
    seed = seed.trim().substring(0, SECURITY_CONFIG.MAX_SEED_LENGTH);
    if (seed.length < SECURITY_CONFIG.MIN_SEED_LENGTH) return null;
    if (!SECURITY_CONFIG.ALLOWED_SEED_PATTERN.test(seed)) return null;
    return seed;
}

/**
 * Validates score value
 * @param {number} score - Score to validate
 * @returns {boolean} True if valid
 */
export function validateScore(score) {
    if (typeof score !== 'number' || !Number.isFinite(score)) return false;
    return score >= SECURITY_CONFIG.MIN_SCORE && score <= SECURITY_CONFIG.MAX_SCORE;
}

// Note: Rate limiting is now handled server-side by Cloud Functions
// Client-side checks removed to prevent redundant validation
// The Cloud Function enforces 5-second cooldown at the database level

/**
 * Renders a leaderboard row with rank, name, and score
 * @param {Object} entry - Leaderboard entry
 * @param {number} index - Row index (0-based)
 * @param {boolean} isTopRank - Whether this is rank 1
 * @returns {string} HTML string
 */
export function renderLeaderboardRow(entry, index, isTopRank = false) {
    const safeName = sanitizeHTML(entry.name || 'Unknown');
    const safeScore = Math.floor(entry.score || 0);
    const color = isTopRank ? 'var(--gold)' : 'inherit';
    return `<div style="display:flex; justify-content:space-between; font-size:11px; padding:4px 0; color:${color}">
        <span>${index + 1}. ${safeName}</span><b>${safeScore}</b>
    </div>`;
}

// ============================================
// FIREBASE INITIALIZATION
// ============================================

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth();

window.seedTop1Score = 0;
window.seedTop10Score = 0;
window.seedScoresCount = 0;
window.currentUser = null;
window.authStatus = "CONNECTING";

// Auth State Listener - handles authentication and re-authentication
onAuthStateChanged(auth, (user) => {
    if (user) {
        window.currentUser = user;
        window.authStatus = "AUTHENTICATED";
        console.log("✅ Firebase Auth: Authenticated with UID:", user.uid);
        updateAuthUI();
        window.updateSeedSidebar();
    } else {
        window.authStatus = "NOT_AUTHENTICATED";
        console.log("🔄 Firebase Auth: Attempting anonymous sign-in...");
        updateAuthUI();
        signInAnonymously(auth).catch((error) => {
            console.error("❌ Firebase Auth Error:", error);
            window.authStatus = "AUTH_FAILED";
            updateAuthUI();
        });
    }
});

function updateAuthUI() {
    const authContainer = document.getElementById('auth-status-container');
    if (authContainer) {
        const statusColors = {
            "AUTHENTICATED": "#00ff00",
            "CONNECTING": "var(--neon)",
            "NOT_AUTHENTICATED": "#ffaa00",
            "AUTH_FAILED": "var(--warning)"
        };
        const statusText = window.authStatus === "AUTHENTICATED"
            ? `AUTH: ${window.currentUser?.uid?.substring(0, 8)}...`
            : `AUTH: ${window.authStatus}`;
        authContainer.innerHTML = statusText;
        authContainer.style.color = statusColors[window.authStatus] || "white";
    }
}

window.updateSeedSidebar = function() {
    const seedInput = document.getElementById('seed-input').value || "MISSION_1";
    const seed = sanitizeSeed(seedInput);
    if (!seed) {
        console.warn("⚠️ Invalid seed format, using default");
        document.getElementById('seed-input').value = "MISSION_1";
        return;
    }

    document.getElementById('seed-title-tag').innerText = seed;
    onValue(query(ref(db, 'highscores'), orderByChild('seed'), equalTo(seed)), (snap) => {
        const list = [];
        if (snap.val()) Object.values(snap.val()).forEach(v => list.push(v));
        list.sort((a,b) => b.score - a.score);

        window.seedTop1Score = list[0]?.score || 0;
        window.seedTop10Score = list.length >= 10 ? list[9].score : (list.length > 0 ? list[list.length-1].score : 0);
        window.seedScoresCount = list.length;

        document.getElementById('seed-list-content').innerHTML = list.slice(0, 10).map((e, i) =>
            renderLeaderboardRow(e, i, i === 0)
        ).join('') || "No scores yet";
    });
};

window.openGlobalModal = function() {
    document.getElementById('global-highscore-modal').style.display = 'block';
    onValue(ref(db, 'highscores'), (snap) => {
        const list = [];
        if (snap.val()) Object.values(snap.val()).forEach(v => list.push(v));
        list.sort((a,b) => b.score - a.score);
        document.getElementById('global-list-content').innerHTML = list.slice(0, 50).map((e,i) => {
            const safeName = sanitizeHTML(e.name || 'Unknown');
            const safeSeed = sanitizeHTML(e.seed || 'UNKNOWN');
            const safeScore = Math.floor(e.score || 0);
            return `
            <div class="global-row">
                <span>${i+1}. <b>${safeName}</b> - ${safeScore}</span>
                <span class="seed-link" onclick="applyGlobalSeed('${safeSeed}')">[${safeSeed}]</span>
            </div>`;
        }).join('');
    });
};

window.applyGlobalSeed = function(s) {
    const safeSeed = sanitizeSeed(s);
    if (safeSeed) {
        document.getElementById('seed-input').value = safeSeed;
        window.onSeedInputChange();
        window.closeGlobalModal();
    }
};
window.closeGlobalModal = function() { document.getElementById('global-highscore-modal').style.display = 'none'; };

window.submitGlobalScore = async function(n, s, seed) {
    const user = auth.currentUser;
    if (!user) {
        console.warn("⚠️ Not authenticated");
        return false;
    }

    // Sanitize and validate name (client-side pre-check for better UX)
    const sanitizedName = sanitizeName(n);
    if (!sanitizedName) {
        console.warn("⚠️ Invalid name format");
        return false;
    }

    // Validate score (client-side pre-check for better UX)
    if (!validateScore(s)) {
        console.warn("⚠️ Invalid score value");
        return false;
    }

    // Sanitize and validate seed (client-side pre-check for better UX)
    const sanitizedSeed = sanitizeSeed(seed);
    if (!sanitizedSeed) {
        console.warn("⚠️ Invalid seed format");
        return false;
    }

    try {
        // Write directly to Firebase Realtime Database
        // Security is enforced by Firebase Security Rules
        const highscoresRef = ref(db, 'highscores');
        const newScoreRef = push(highscoresRef);

        await set(newScoreRef, {
            name: sanitizedName,
            score: Math.floor(s), // Ensure integer
            seed: sanitizedSeed,
            timestamp: serverTimestamp(),
            uid: user.uid
        });

        // Update cooldown timestamp
        const cooldownRef = ref(db, `user_cooldowns/${user.uid}`);
        await set(cooldownRef, serverTimestamp());

        console.log(`✅ Score submitted: ${sanitizedName} - ${s} points on ${sanitizedSeed} (ID: ${newScoreRef.key})`);
        return true;
    } catch (error) {
        console.error("❌ Score submission failed:", error);

        // Handle specific error types
        if (error.code === 'PERMISSION_DENIED') {
            // Check common causes
            if (error.message && error.message.includes('cooldown')) {
                console.warn("⚠️ Rate limit: Please wait 5 seconds between submissions");
                showCooldownMessage();
            } else {
                console.warn("⚠️ Permission denied. Check authentication or data validation.");
            }
        } else {
            console.warn("⚠️ Submission error. Please try again.");
        }

        return false;
    }
};

/**
 * Shows cooldown message to user
 */
function showCooldownMessage() {
    const overlay = document.getElementById('overlay');
    if (overlay && overlay.style.display === 'flex') {
        const cooldownMsg = document.createElement('div');
        cooldownMsg.style.cssText = 'color: var(--warning); font-size: 12px; margin-top: 10px;';
        cooldownMsg.textContent = '⏱ COOLDOWN: Wait 5s between submissions';
        overlay.appendChild(cooldownMsg);
        setTimeout(() => cooldownMsg.remove(), 3000);
    }
}

// ============================================
// DEVELOPER CONSOLE FUNCTIONS
// ============================================

// TEST FUNCTION: Submit a test score
window.testSubmitScore = function(name, score, seed) {
    name = name || "TEST_PLAYER";
    score = score || 100;
    seed = seed || document.getElementById('seed-input').value || "MISSION_1";

    console.log(`🧪 Testing score submission: ${name} - ${score} on ${seed}`);
    window.submitGlobalScore(name, score, seed);

    // Wait and update sidebar
    setTimeout(() => {
        window.updateSeedSidebar();
        console.log("✅ Test complete. Check seed leaderboard or global records.");
    }, 1000);
};

// VIEW MY SCORES: Display all scores by current user
window.viewMyScores = function() {
    if (!auth.currentUser) {
        console.error("❌ Not authenticated. Cannot view scores.");
        return;
    }

    const uid = auth.currentUser.uid;
    console.log(`🔍 Fetching scores for UID: ${uid}`);

    get(ref(db, 'highscores')).then((snapshot) => {
        if (snapshot.exists()) {
            const allScores = [];
            snapshot.forEach((child) => {
                const data = child.val();
                if (data.uid === uid) {
                    allScores.push({ key: child.key, ...data });
                }
            });

            if (allScores.length === 0) {
                console.log("📊 No scores found for your account.");
            } else {
                console.log(`📊 Found ${allScores.length} score(s):`);
                allScores.sort((a, b) => b.score - a.score);
                allScores.forEach((s, i) => {
                    console.log(`  ${i + 1}. ${s.name} - ${s.score} points (${s.seed}) [Key: ${s.key}]`);
                });
            }
            return allScores;
        } else {
            console.log("📊 No scores in database.");
            return [];
        }
    }).catch((error) => {
        console.error("❌ Error fetching scores:", error);
    });
};

// DELETE MY SCORES: Remove all scores by current user
window.deleteMyScores = function() {
    if (!auth.currentUser) {
        console.error("❌ Not authenticated. Cannot delete scores.");
        return;
    }

    const uid = auth.currentUser.uid;
    const confirmDelete = confirm(`⚠️ Delete ALL scores for UID: ${uid.substring(0, 12)}...?\n\nThis cannot be undone!`);

    if (!confirmDelete) {
        console.log("❌ Deletion cancelled.");
        return;
    }

    console.log(`🗑️ Deleting scores for UID: ${uid}`);

    get(ref(db, 'highscores')).then((snapshot) => {
        if (snapshot.exists()) {
            let deleteCount = 0;
            const deletePromises = [];

            snapshot.forEach((child) => {
                const data = child.val();
                if (data.uid === uid) {
                    deleteCount++;
                    deletePromises.push(remove(ref(db, `highscores/${child.key}`)));
                }
            });

            if (deleteCount === 0) {
                console.log("📊 No scores found to delete.");
            } else {
                Promise.all(deletePromises).then(() => {
                    console.log(`✅ Successfully deleted ${deleteCount} score(s).`);
                    window.updateSeedSidebar();
                }).catch((error) => {
                    console.error("❌ Error deleting scores:", error);
                });
            }
        }
    }).catch((error) => {
        console.error("❌ Error fetching scores:", error);
    });
};

// RE-AUTHENTICATE: Force re-authentication
window.reAuthenticate = function() {
    console.log("🔄 Re-authenticating...");
    signInAnonymously(auth).then(() => {
        console.log("✅ Re-authentication successful.");
    }).catch((error) => {
        console.error("❌ Re-authentication failed:", error);
    });
};

// Show console help
console.log(`
🎮 NEON REBOUND - Developer Console Commands:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 testSubmitScore(name, score, seed) - Submit test score
📋 viewMyScores() - View all your scores
🗑️ deleteMyScores() - Delete all your scores
🔄 reAuthenticate() - Force re-authentication
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Example: testSubmitScore("ACE", 500, "MISSION_1")

⚠️ SECURITY NOTICE:
- API keys are public by design (Firebase docs)
- Security enforced by Firebase Security Rules
- Rate limiting: 5 seconds between submissions
- All inputs are sanitized and validated
`);

// Enable dev console with security check
const urlParams = new URLSearchParams(window.location.search);
const debugToken = urlParams.get('debug');
const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

if (debugToken === '1' && isLocalhost) {
    const devConsole = document.getElementById('dev-console');
    if (devConsole) {
        devConsole.style.display = 'block';
        console.log("🔧 Developer console enabled (localhost only)");
    }
} else if (debugToken === '1' && !isLocalhost) {
    console.warn("⚠️ Debug mode disabled: Only available on localhost");
}

// Export for use in other modules
export { auth, db, SECURITY_CONFIG };

