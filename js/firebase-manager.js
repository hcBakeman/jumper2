/**
 * FIREBASE MANAGER MODULE
 * Handles Firebase authentication, database operations, and security
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, onValue, query, orderByChild, equalTo, push, set, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js";
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
    SUBMISSION_COOLDOWN_MS: 30000, // Increased to 30 seconds
    MAX_PEER_CONNECTIONS: 8,
    ALLOWED_SEED_PATTERN: /^[A-Za-z0-9_-]+$/,
    ALLOWED_NAME_PATTERN: /^[A-Za-z0-9_\-\s]+$/
};

// ============================================
// ANTI-CHEAT FUNCTIONS
// ============================================

/**
 * Generates a SHA-256 checksum for score validation
 * @param {string} name - Player name
 * @param {number} score - Score value
 * @param {string} seed - Game seed
 * @param {Object} telemetry - Game telemetry data
 * @param {string} uid - User ID
 * @returns {Promise<string>} Hex string checksum
 */
async function generateScoreChecksum(name, score, seed, telemetry, uid) {
    const data = `${name}|${score}|${seed}|${telemetry.jumps}|${telemetry.platforms}|${telemetry.duration}|${telemetry.integrityToken}|${uid}`;
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Validates telemetry data for reasonableness
 * @param {number} score - Score value
 * @param {Object} telemetry - Game telemetry data
 * @returns {boolean} True if telemetry is reasonable
 */
export function validateTelemetry(score, telemetry) {
    // Basic sanity checks
    if (telemetry.jumps < 1 || telemetry.platforms < 1) return false;
    if (telemetry.duration < 1 || telemetry.duration > 3600) return false;

    // Score should roughly correlate with platforms
    // Score = height/10, platforms spawn every 80 units, so ideal ratio is ~8 points/platform
    // BUT players can bounce on platforms without height gain, or fall and re-climb
    // Real gameplay shows 2-15 points per platform is realistic
    const expectedMinPlatforms = Math.floor(score / 15);  // Very skilled, efficient climb
    const expectedMaxPlatforms = Math.ceil(score / 2);    // Lots of bouncing, falling, re-climbing
    if (telemetry.platforms < expectedMinPlatforms || telemetry.platforms > expectedMaxPlatforms) {
        console.warn(`⚠️ Telemetry mismatch: score=${score}, platforms=${telemetry.platforms} (expected ${expectedMinPlatforms}-${expectedMaxPlatforms})`);
        return false;
    }

    // Jumps should equal platforms (one jump per platform)
    // Allow tolerance for missed platforms or double-bounces
    if (Math.abs(telemetry.jumps - telemetry.platforms) > 10) {
        console.warn(`⚠️ Jump/platform mismatch: jumps=${telemetry.jumps}, platforms=${telemetry.platforms}`);
        return false;
    }

    // Max score rate: ~200 points/second (very generous)
    const maxPossibleScore = telemetry.duration * 200;
    if (score > maxPossibleScore) {
        console.warn(`⚠️ Score too high for duration: ${score} in ${telemetry.duration}s`);
        return false;
    }

    return true;
}

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
const functions = getFunctions(app);

// Enable Cloud Functions for enhanced security (optional, requires Blaze plan)
const USE_CLOUD_FUNCTIONS = false; // Set to true to use Cloud Functions validation

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
        authContainer.innerHTML = window.authStatus === "AUTHENTICATED"
            ? `AUTH: ${window.currentUser?.uid?.substring(0, 8)}...`
            : `AUTH: ${window.authStatus}`;
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

window.submitGlobalScore = async function(n, s, seed, telemetry = null) {
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

    // Validate telemetry data
    if (!telemetry || !validateTelemetry(s, telemetry)) {
        console.warn("⚠️ Invalid or missing telemetry data");
        return false;
    }

    try {
        // Generate anti-cheat checksum
        const checksum = await generateScoreChecksum(sanitizedName, s, sanitizedSeed, telemetry, user.uid);

        // OPTION 1: Use Cloud Functions for enhanced server-side validation (requires Blaze plan)
        if (USE_CLOUD_FUNCTIONS) {
            const submitScoreFunction = httpsCallable(functions, 'submitScore');
            await submitScoreFunction({
                name: sanitizedName,
                score: Math.floor(s),
                seed: sanitizedSeed,
                checksum: checksum,
                telemetry: {
                    jumps: telemetry.jumps,
                    platforms: telemetry.platforms,
                    duration: telemetry.duration,
                    maxFall: telemetry.maxFall,
                    integrityToken: telemetry.integrityToken
                },
                events: telemetry.events
            });

            console.log(`✅ Score submitted via Cloud Functions: ${sanitizedName} - ${s} points on ${sanitizedSeed}`);
            console.log(`📊 Telemetry: ${telemetry.jumps} jumps, ${telemetry.platforms} platforms, ${telemetry.duration}s`);
            return true;
        }

        // OPTION 2: Direct database write with Firebase Security Rules validation (free tier)
        const highscoresRef = ref(db, 'highscores');
        const newScoreRef = push(highscoresRef);

        await set(newScoreRef, {
            name: sanitizedName,
            score: Math.floor(s), // Ensure integer
            seed: sanitizedSeed,
            timestamp: serverTimestamp(),
            uid: user.uid,
            checksum: checksum,
            telemetry: {
                jumps: telemetry.jumps,
                platforms: telemetry.platforms,
                duration: telemetry.duration,
                maxFall: telemetry.maxFall
            }
        });

        // Store detailed telemetry for audit (optional, 7-day retention)
        if (telemetry.events && telemetry.events.length > 0) {
            const telemetryRef = ref(db, `score_telemetry/${newScoreRef.key}`);
            await set(telemetryRef, {
                uid: user.uid,
                seed: sanitizedSeed,
                score: Math.floor(s),
                events: telemetry.events,
                integrityToken: telemetry.integrityToken,
                timestamp: serverTimestamp()
            });
        }

        // Update cooldown timestamp
        const cooldownRef = ref(db, `user_cooldowns/${user.uid}`);
        await set(cooldownRef, serverTimestamp());

        console.log(`✅ Score submitted: ${sanitizedName} - ${s} points on ${sanitizedSeed} (ID: ${newScoreRef.key})`);
        console.log(`📊 Telemetry: ${telemetry.jumps} jumps, ${telemetry.platforms} platforms, ${telemetry.duration}s`);
        return true;
    } catch (error) {
        console.error("❌ Score submission failed:", error);

        // Handle specific error types
        if (error.code === 'PERMISSION_DENIED') {
            // Check common causes
            if (error.message && error.message.includes('cooldown')) {
                console.warn("⚠️ Rate limit: Please wait 30 seconds between submissions");
                showCooldownMessage(30);
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
function showCooldownMessage(seconds = 30) {
    const overlay = document.getElementById('overlay');
    if (overlay && overlay.style.display === 'flex') {
        const cooldownMsg = document.createElement('div');
        cooldownMsg.style.cssText = 'color: var(--warning); font-size: 12px; margin-top: 10px;';
        cooldownMsg.textContent = `⏱ COOLDOWN: Wait ${seconds}s between submissions`;
        overlay.appendChild(cooldownMsg);
        setTimeout(() => cooldownMsg.remove(), 3000);
    }
}

// ============================================
// DEVELOPER CONSOLE LOADER
// ============================================
// Developer functions moved to js_admin/dev-console.js
// Load conditionally with: ?debug=1 on localhost only

const urlParams = new URLSearchParams(window.location.search);
const debugToken = urlParams.get('debug');
const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

if (debugToken === '1' && isLocalhost) {
    // Dynamically load dev console module
    import('../js_admin/dev-console.js')
        .then(() => {
            console.log("🔧 Developer console loaded");
        })
        .catch((error) => {
            console.error("❌ Failed to load developer console:", error);
        });
} else if (debugToken === '1' && !isLocalhost) {
    console.warn("⚠️ Debug mode disabled: Only available on localhost");
}

// Export for use in other modules
export { auth, db, SECURITY_CONFIG };

