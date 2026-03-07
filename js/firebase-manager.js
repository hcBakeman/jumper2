/**
 * FIREBASE MANAGER MODULE
 * Handles Firebase authentication, database operations, and security
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, onValue, query, orderByChild, equalTo, push, set, get, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
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
    MIN_SCORE: 1, // Changed from 10 to 1 to allow low scores
    MAX_SCORE: 100000,
    SUBMISSION_COOLDOWN_MS: 5000, // 5 seconds
    MAX_PEER_CONNECTIONS: 8,
    ALLOWED_SEED_PATTERN: /^[A-Za-z0-9_-]+$/,
    ALLOWED_NAME_PATTERN: /^[A-Za-z0-9_\-\s]+$/,
    MAX_SCORE_RATE: 100, // max points per second (tightened from 200)
    CHALLENGE_MAX_AGE_MS: 3600000 // 1 hour max game duration for challenge validity
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
 * @param {string} challengeId - Unique challenge nonce (one-time-use)
 * @returns {Promise<string>} 64-char hex string checksum (SHA-256)
 */
async function generateScoreChecksum(name, score, seed, telemetry, uid, challengeId) {
    const data = `${challengeId}|${name}|${score}|${seed}|${telemetry.jumps}|${telemetry.platforms}|${telemetry.duration}|${telemetry.integrityToken}|${uid}`;

    // Require crypto.subtle (HTTPS or localhost) — no weak fallback
    if (window.crypto && window.crypto.subtle) {
        try {
            const encoder = new TextEncoder();
            const dataBuffer = encoder.encode(data);
            const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (error) {
            console.error('❌ crypto.subtle failed:', error);
        }
    }

    // No fallback — SHA-256 is required for score submission
    console.error('❌ SHA-256 not available. Score submission requires HTTPS or localhost.');
    throw new Error('SHA-256 required for score submission. Please use HTTPS.');
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
    // Server rule: (platforms + 5) * 15 >= score
    // So minimum platforms = ceil(score / 15) - 5
    const expectedMinPlatforms = Math.max(0, Math.ceil(score / 15) - 5);  // Match server rule exactly
    const expectedMaxPlatforms = Math.max(score + 20, Math.ceil(score * 2));  // Very generous upper bound
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

    // Max score rate: points per second (server rule: score <= duration * 100)
    const maxPossibleScore = telemetry.duration * SECURITY_CONFIG.MAX_SCORE_RATE;
    if (score > maxPossibleScore) {
        console.warn(`⚠️ Score too high for duration: ${score} in ${telemetry.duration}s (max ${maxPossibleScore})`);
        return false;
    }

    // Minimum duration proportional to score (server rule: duration >= score / 100)
    const minDuration = Math.ceil(score / SECURITY_CONFIG.MAX_SCORE_RATE);
    if (telemetry.duration < minDuration) {
        console.warn(`⚠️ Duration too short for score: ${telemetry.duration}s for score ${score} (min ${minDuration}s)`);
        return false;
    }

    // Minimum jumps proportional to score (server rule: jumps >= score / 20)
    const minJumps = Math.ceil(score / 20);
    if (telemetry.jumps < minJumps) {
        console.warn(`⚠️ Too few jumps for score: ${telemetry.jumps} for score ${score} (min ${minJumps})`);
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

// ============================================
// CHALLENGE TOKEN SYSTEM (Anti-Replay)
// ============================================

/**
 * Creates a one-time-use challenge token before a game starts.
 * The challenge must exist and be unused for the score submission to be accepted.
 * Challenges expire after 1 hour (enforced server-side).
 * @returns {Promise<string|null>} Challenge ID or null if creation failed
 */
export async function createGameChallenge() {
    const user = auth.currentUser;
    if (!user) {
        console.warn("⚠️ Cannot create challenge: not authenticated");
        return null;
    }

    try {
        // Generate a unique challenge ID (crypto.randomUUID or fallback)
        const challengeId = (crypto.randomUUID && crypto.randomUUID()) ||
            ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
                (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
            );

        const challengeRef = ref(db, `score_challenges/${user.uid}/${challengeId}`);
        await set(challengeRef, {
            createdAt: serverTimestamp(),
            used: false
        });

        console.log(`🎫 Challenge created: ${challengeId}`);
        return challengeId;
    } catch (error) {
        console.error("❌ Failed to create challenge:", error);
        return null;
    }
}

/**
 * Marks a challenge token as used after successful score submission.
 * Prevents the same challenge from being reused.
 * @param {string} challengeId - The challenge ID to mark as used
 * @returns {Promise<boolean>} True if marked successfully
 */
async function markChallengeUsed(challengeId) {
    const user = auth.currentUser;
    if (!user || !challengeId) return false;

    try {
        const challengeRef = ref(db, `score_challenges/${user.uid}/${challengeId}`);
        const snap = await get(challengeRef);
        if (!snap.exists()) {
            console.warn("⚠️ Challenge not found:", challengeId);
            return false;
        }

        // Preserve createdAt, only flip used to true
        await set(challengeRef, {
            createdAt: snap.val().createdAt,
            used: true
        });

        console.log(`🎫 Challenge marked as used: ${challengeId}`);
        return true;
    } catch (error) {
        console.error("❌ Failed to mark challenge as used:", error);
        return false;
    }
}

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

// Enable Cloud Functions for enhanced security
// Automatically disabled on localhost to avoid CORS issues
// Also disabled in production until Cloud Functions are deployed to avoid CORS warnings
const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const USE_CLOUD_FUNCTIONS = false; // Set to true after deploying Cloud Functions with Blaze plan

if (isLocalhost) {
    console.log('🏠 Running on localhost: Cloud Functions disabled, using direct database writes');
} else if (USE_CLOUD_FUNCTIONS) {
    console.log('🌐 Running in production: Cloud Functions enabled for enhanced validation');
} else {
    console.log('🌐 Running in production: Using direct database writes with Firebase Security Rules');
}

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

        document.getElementById('seed-list-content').innerHTML = list.slice(0, 25).map((e, i) =>
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
        document.getElementById('global-list-content').innerHTML = list.slice(0, 25).map((e,i) => {
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

    // Validate challenge ID (must be created before game started)
    const challengeId = telemetry?.challengeId;
    if (!challengeId || typeof challengeId !== 'string' || challengeId.length < 20) {
        console.warn("⚠️ Missing or invalid challenge ID — score rejected");
        showValidationError('Score rejected: no valid game challenge. Please restart the game.');
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
        // Generate anti-cheat checksum (bound to challengeId nonce)
        const checksum = await generateScoreChecksum(sanitizedName, s, sanitizedSeed, telemetry, user.uid, challengeId);

        // OPTION 1: Use Cloud Functions for enhanced server-side validation (requires Blaze plan)
        if (USE_CLOUD_FUNCTIONS) {
            try {
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
            } catch (cloudError) {
                // If Cloud Functions fail (CORS, not deployed, or internal error), fall back to direct DB write
                console.warn('⚠️ Cloud Functions unavailable, falling back to direct database write:', cloudError.code || cloudError.message);
                // Continue to OPTION 2 below
            }
        }

        // OPTION 2: Direct database write with Firebase Security Rules validation (free tier)

        // 1. Verify challenge exists and is unused
        const challengeRef = ref(db, `score_challenges/${user.uid}/${challengeId}`);
        const challengeSnap = await get(challengeRef);
        if (!challengeSnap.exists() || challengeSnap.val().used !== false) {
            console.warn("⚠️ Challenge is missing or already used:", challengeId);
            showValidationError('Score rejected: game challenge expired or already used.');
            return false;
        }

        // 2. Check cooldown before attempting the write
        const cooldownRef = ref(db, `user_cooldowns/${user.uid}`);
        const cooldownSnap = await get(cooldownRef);
        if (cooldownSnap.exists()) {
            const lastSubmission = cooldownSnap.val();
            const elapsed = Date.now() - lastSubmission;
            if (elapsed < SECURITY_CONFIG.SUBMISSION_COOLDOWN_MS) {
                const remaining = Math.ceil((SECURITY_CONFIG.SUBMISSION_COOLDOWN_MS - elapsed) / 1000);
                console.warn(`⚠️ Cooldown active: ${remaining}s remaining`);
                showCooldownMessage(remaining);
                return false;
            }
        }

        // 3. Write the score entry
        const highscoresRef = ref(db, 'highscores');
        const newScoreRef = push(highscoresRef);

        const floorScore = Math.floor(s);
        const floorDuration = Math.floor(telemetry.duration) || 1; // Ensure minimum 1
        const floorPlatforms = Math.floor(telemetry.platforms) || 1; // Ensure minimum 1
        const floorJumps = Math.floor(telemetry.jumps) || 1; // Ensure minimum 1
        const floorMaxFall = Math.min(1000, Math.max(0, Math.floor(telemetry.maxFall) || 0)); // Ensure 0-1000, guard against NaN

        const scoreData = {
            name: sanitizedName,
            score: floorScore,
            seed: sanitizedSeed,
            timestamp: serverTimestamp(),
            uid: user.uid,
            checksum: checksum,
            challengeId: challengeId,
            telemetry: {
                jumps: floorJumps,
                platforms: floorPlatforms,
                duration: floorDuration,
                maxFall: floorMaxFall
            }
        };

        // Log data for debugging rule failures
        console.log('📝 Score data to submit:', JSON.stringify({
            ...scoreData,
            timestamp: '<serverTimestamp>'
        }, null, 2));

        // ---- Comprehensive pre-check mirroring EVERY security rule condition ----
        let preCheckFailed = false;

        // Field type/range checks (mirror security rules exactly)
        if (typeof sanitizedName !== 'string' || sanitizedName.length < 1 || sanitizedName.length > 20) {
            console.warn(`⚠️ Pre-check fail: name length=${sanitizedName?.length} (must be 1-20)`);
            preCheckFailed = true;
        }
        if (!/^[A-Za-z0-9_\-\s]+$/.test(sanitizedName)) {
            console.warn(`⚠️ Pre-check fail: name "${sanitizedName}" doesn't match allowed pattern`);
            preCheckFailed = true;
        }
        if (floorScore < 1 || floorScore > 100000 || floorScore % 1 !== 0) {
            console.warn(`⚠️ Pre-check fail: score=${floorScore} (must be integer 1-100000)`);
            preCheckFailed = true;
        }
        if (typeof sanitizedSeed !== 'string' || sanitizedSeed.length < 1 || sanitizedSeed.length > 50) {
            console.warn(`⚠️ Pre-check fail: seed length=${sanitizedSeed?.length} (must be 1-50)`);
            preCheckFailed = true;
        }
        if (!/^[A-Za-z0-9_\-]+$/.test(sanitizedSeed)) {
            console.warn(`⚠️ Pre-check fail: seed "${sanitizedSeed}" doesn't match allowed pattern`);
            preCheckFailed = true;
        }
        if (typeof checksum !== 'string' || checksum.length !== 64) {
            console.warn(`⚠️ Pre-check fail: checksum length=${checksum?.length} (must be 64 — SHA-256 required)`);
            preCheckFailed = true;
        }
        if (typeof challengeId !== 'string' || challengeId.length < 20 || challengeId.length > 36) {
            console.warn(`⚠️ Pre-check fail: challengeId length=${challengeId?.length} (must be 20-36)`);
            preCheckFailed = true;
        }

        // Telemetry range checks
        if (floorJumps < 1 || floorJumps > 10000) {
            console.warn(`⚠️ Pre-check fail: jumps=${floorJumps} (must be 1-10000)`);
            preCheckFailed = true;
        }
        if (floorPlatforms < 1 || floorPlatforms > 10000) {
            console.warn(`⚠️ Pre-check fail: platforms=${floorPlatforms} (must be 1-10000)`);
            preCheckFailed = true;
        }
        if (floorDuration < 1 || floorDuration > 3600) {
            console.warn(`⚠️ Pre-check fail: duration=${floorDuration} (must be 1-3600)`);
            preCheckFailed = true;
        }
        if (floorMaxFall < 0 || floorMaxFall > 1000) {
            console.warn(`⚠️ Pre-check fail: maxFall=${floorMaxFall} (must be 0-1000)`);
            preCheckFailed = true;
        }

        // Correlation checks (match tightened server rules)
        if (floorScore > floorDuration * SECURITY_CONFIG.MAX_SCORE_RATE) {
            console.warn(`⚠️ Pre-check fail: score(${floorScore}) > duration(${floorDuration}) * ${SECURITY_CONFIG.MAX_SCORE_RATE} = ${floorDuration * SECURITY_CONFIG.MAX_SCORE_RATE}`);
            preCheckFailed = true;
        }
        if (floorDuration < Math.ceil(floorScore / SECURITY_CONFIG.MAX_SCORE_RATE)) {
            console.warn(`⚠️ Pre-check fail: duration(${floorDuration}) < score(${floorScore}) / ${SECURITY_CONFIG.MAX_SCORE_RATE}`);
            preCheckFailed = true;
        }
        if (floorJumps < Math.ceil(floorScore / 20)) {
            console.warn(`⚠️ Pre-check fail: jumps(${floorJumps}) < score(${floorScore}) / 20 = ${Math.ceil(floorScore / 20)}`);
            preCheckFailed = true;
        }
        if ((floorPlatforms + 5) * 15 < floorScore) {
            console.warn(`⚠️ Pre-check fail: (platforms(${floorPlatforms}) + 5) * 15 = ${(floorPlatforms + 5) * 15} < score(${floorScore})`);
            preCheckFailed = true;
        }
        if (floorJumps - floorPlatforms > 10) {
            console.warn(`⚠️ Pre-check fail: jumps(${floorJumps}) - platforms(${floorPlatforms}) = ${floorJumps - floorPlatforms} > 10`);
            preCheckFailed = true;
        }
        if (floorPlatforms - floorJumps > 10) {
            console.warn(`⚠️ Pre-check fail: platforms(${floorPlatforms}) - jumps(${floorJumps}) = ${floorPlatforms - floorJumps} > 10`);
            preCheckFailed = true;
        }

        // Cooldown check (client-side approximation — server uses its own clock)
        if (cooldownSnap.exists()) {
            const serverCooldownAge = Date.now() - cooldownSnap.val();
            console.log(`🔍 Cooldown age (client estimate): ${serverCooldownAge}ms (rule requires > 5000ms)`);
            if (serverCooldownAge < SECURITY_CONFIG.SUBMISSION_COOLDOWN_MS) {
                console.warn(`⚠️ Pre-check fail: cooldown not elapsed (${serverCooldownAge}ms < ${SECURITY_CONFIG.SUBMISSION_COOLDOWN_MS}ms)`);
                preCheckFailed = true;
            }
        } else {
            console.log('🔍 No cooldown entry — first submission for this user');
        }


        if (preCheckFailed) {
            console.warn('⚠️ Score would be rejected by security rules — aborting submission');
            showValidationError('Score data failed anti-cheat validation checks. Not submitted.');
            return false;
        }

        await set(newScoreRef, scoreData);

        // 4. Mark the challenge as used (prevents replay)
        await markChallengeUsed(challengeId);

        // 5. Store detailed telemetry for audit (optional, 7-day retention)
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

        // 6. Update cooldown timestamp (AFTER highscore write - rules check cooldown is old/null)
        await set(cooldownRef, serverTimestamp());

        console.log(`✅ Score submitted: ${sanitizedName} - ${s} points on ${sanitizedSeed} (ID: ${newScoreRef.key})`);
        console.log(`📊 Telemetry: ${telemetry.jumps} jumps, ${telemetry.platforms} platforms, ${telemetry.duration}s`);
        return true;
    } catch (error) {
        console.error("❌ Score submission failed:", error);

        // Handle Cloud Functions errors
        if (USE_CLOUD_FUNCTIONS && error.code) {
            switch (error.code) {
                case 'unauthenticated':
                    console.warn("⚠️ Authentication required. Please reload the page.");
                    break;
                case 'invalid-argument':
                    console.warn(`⚠️ Invalid data: ${error.message}`);
                    break;
                case 'permission-denied':
                    console.warn(`⚠️ Validation failed: ${error.message}`);
                    showValidationError(error.message);
                    break;
                case 'resource-exhausted':
                    console.warn(`⚠️ ${error.message}`);
                    const match = error.message.match(/(\d+) seconds/);
                    if (match) showCooldownMessage(parseInt(match[1]));
                    break;
                default:
                    console.warn(`⚠️ Submission error: ${error.message || 'Please try again'}`);
            }
        } else if (error.code === 'PERMISSION_DENIED' || (error.message && error.message.includes('Permission denied'))) {
            // Handle Firebase Security Rules rejections
            console.warn("⚠️ Permission denied by Firebase Security Rules. Possible causes:");
            console.warn("   - Challenge ID missing, expired, or already used");
            console.warn("   - Cooldown not elapsed (5s between submissions)");
            console.warn("   - Score count limit reached (max 500 per user, 10 per seed)");
            console.warn("   - Telemetry-score correlation mismatch");
            console.warn("   - Invalid data format or extra fields");
            console.warn("   - SHA-256 checksum required (64 chars)");
            console.warn("   - Security rules not deployed (run deploy-rules.bat)");
            showValidationError("Score rejected by server validation. Please wait and try again.");
            showCooldownMessage(Math.ceil(SECURITY_CONFIG.SUBMISSION_COOLDOWN_MS / 1000));
        } else {
            console.warn("⚠️ Submission error. Please try again.");
        }

        return false;
    }
};

/**
 * Shows cooldown message to user
 */
function showCooldownMessage(seconds = 5) {
    const overlay = document.getElementById('overlay');
    if (overlay && overlay.style.display === 'flex') {
        const cooldownMsg = document.createElement('div');
        cooldownMsg.style.cssText = 'color: var(--warning); font-size: 12px; margin-top: 10px;';
        cooldownMsg.textContent = `⏱ COOLDOWN: Wait ${seconds}s between submissions`;
        overlay.appendChild(cooldownMsg);
        setTimeout(() => cooldownMsg.remove(), 3000);
    }
}

/**
 * Shows validation error message to user
 */
function showValidationError(message) {
    const overlay = document.getElementById('overlay');
    if (overlay && overlay.style.display === 'flex') {
        const errorMsg = document.createElement('div');
        errorMsg.style.cssText = 'color: var(--warning); font-size: 11px; margin-top: 10px; max-width: 300px;';
        errorMsg.textContent = `⚠️ ${message}`;
        overlay.appendChild(errorMsg);
        setTimeout(() => errorMsg.remove(), 5000);
    }
}

// ============================================
// DEVELOPER CONSOLE LOADER
// ============================================
// Developer functions moved to js_admin/dev-console.js
// Load conditionally with: ?debug=1 on localhost only

const urlParams = new URLSearchParams(window.location.search);
const debugToken = urlParams.get('debug');
// isLocalhost already defined above (line 189)

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

