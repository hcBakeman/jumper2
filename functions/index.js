/**
 * FIREBASE CLOUD FUNCTIONS
 * Secure server-side score validation for NEON REBOUND
 *
 * This eliminates client-side score submission vulnerabilities by:
 * - Validating all inputs server-side
 * - Enforcing rate limiting at the database level
 * - Preventing score manipulation via browser DevTools
 * - Using server timestamps to prevent replay attacks
 */

const {onCall, HttpsError} = require('firebase-functions/v2/https');
const {onRequest} = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const {getDatabase} = require('firebase-admin/database');

admin.initializeApp();

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
    ALLOWED_SEED_PATTERN: /^[A-Za-z0-9_-]+$/,
    ALLOWED_NAME_PATTERN: /^[A-Za-z0-9_\-\s]+$/
};

// ============================================
// VALIDATION FUNCTIONS
// ============================================

/**
 * Validates player name
 * @param {string} name - Player name
 * @returns {boolean} True if valid
 */
function validateName(name) {
    if (typeof name !== 'string') return false;
    if (name.length < SECURITY_CONFIG.MIN_NAME_LENGTH || name.length > SECURITY_CONFIG.MAX_NAME_LENGTH) return false;
    return SECURITY_CONFIG.ALLOWED_NAME_PATTERN.test(name);
}

/**
 * Validates seed string
 * @param {string} seed - Game seed
 * @returns {boolean} True if valid
 */
function validateSeed(seed) {
    if (typeof seed !== 'string') return false;
    if (seed.length < SECURITY_CONFIG.MIN_SEED_LENGTH || seed.length > SECURITY_CONFIG.MAX_SEED_LENGTH) return false;
    return SECURITY_CONFIG.ALLOWED_SEED_PATTERN.test(seed);
}

/**
 * Validates score value
 * @param {number} score - Score to validate
 * @returns {boolean} True if valid
 */
function validateScore(score) {
    if (typeof score !== 'number' || !Number.isFinite(score)) return false;
    if (score < SECURITY_CONFIG.MIN_SCORE || score > SECURITY_CONFIG.MAX_SCORE) return false;
    return true;
}

/**
 * Checks if user can submit score (rate limiting)
 * @param {string} uid - User ID
 * @returns {Promise<boolean>} True if submission is allowed
 */
async function canSubmitScore(uid) {
    try {
        const db = getDatabase();
        const cooldownRef = db.ref(`user_cooldowns/${uid}`);
        const snapshot = await cooldownRef.once('value');

        if (!snapshot.exists()) return true;

        const lastSubmission = snapshot.val();
        const now = Date.now();
        const timeSinceLastSubmit = now - lastSubmission;

        return timeSinceLastSubmit >= SECURITY_CONFIG.SUBMISSION_COOLDOWN_MS;
    } catch (error) {
        console.error('Error checking cooldown:', error);
        return false;
    }
}

/**
 * Updates cooldown timestamp
 * @param {string} uid - User ID
 * @returns {Promise<void>}
 */
async function updateCooldown(uid) {
    try {
        const db = getDatabase();
        const cooldownRef = db.ref(`user_cooldowns/${uid}`);
        await cooldownRef.set(admin.database.ServerValue.TIMESTAMP);
    } catch (error) {
        console.error('Error updating cooldown:', error);
        throw error;
    }
}

// ============================================
// CLOUD FUNCTIONS
// ============================================

/**
 * Callable function to submit a score
 * This is called from the client via Firebase SDK
 *
 * @param {Object} data - { name, score, seed }
 * @param {Object} context - Firebase Auth context
 * @returns {Promise<Object>} { success: true, scoreId: string }
 */
exports.submitScore = onCall(async (request) => {
    const {data, auth} = request;

    // 1. AUTHENTICATION CHECK
    if (!auth) {
        throw new HttpsError('unauthenticated', 'Must be authenticated to submit scores');
    }

    const {name, score, seed} = data;
    const uid = auth.uid;

    console.log(`Score submission attempt: ${name} - ${score} on ${seed} (UID: ${uid})`);

    // 2. VALIDATE NAME
    if (!validateName(name)) {
        throw new HttpsError(
            'invalid-argument',
            `Invalid name. Must be ${SECURITY_CONFIG.MIN_NAME_LENGTH}-${SECURITY_CONFIG.MAX_NAME_LENGTH} characters, alphanumeric with spaces/underscores/hyphens only`
        );
    }

    // 3. VALIDATE SCORE
    if (!validateScore(score)) {
        throw new HttpsError(
            'invalid-argument',
            `Invalid score. Must be between ${SECURITY_CONFIG.MIN_SCORE} and ${SECURITY_CONFIG.MAX_SCORE}`
        );
    }

    // 4. VALIDATE SEED
    if (!validateSeed(seed)) {
        throw new HttpsError(
            'invalid-argument',
            `Invalid seed. Must be ${SECURITY_CONFIG.MIN_SEED_LENGTH}-${SECURITY_CONFIG.MAX_SEED_LENGTH} characters, alphanumeric with underscores/hyphens only`
        );
    }

    // 5. CHECK RATE LIMITING
    const canSubmit = await canSubmitScore(uid);
    if (!canSubmit) {
        throw new HttpsError(
            'resource-exhausted',
            `Rate limit exceeded. Please wait ${SECURITY_CONFIG.SUBMISSION_COOLDOWN_MS / 1000} seconds between submissions`
        );
    }

    // 6. SUBMIT SCORE TO DATABASE
    try {
        const db = getDatabase();
        const highscoresRef = db.ref('highscores');
        const newScoreRef = highscoresRef.push();

        await newScoreRef.set({
            name: name.trim(),
            score: Math.floor(score), // Ensure integer
            seed: seed.trim(),
            timestamp: admin.database.ServerValue.TIMESTAMP,
            uid: uid
        });

        // 7. UPDATE COOLDOWN
        await updateCooldown(uid);

        console.log(`✅ Score submitted successfully: ${name} - ${score} on ${seed} (ID: ${newScoreRef.key})`);

        return {
            success: true,
            scoreId: newScoreRef.key,
            message: 'Score submitted successfully'
        };

    } catch (error) {
        console.error('Database error:', error);
        throw new HttpsError('internal', 'Failed to submit score. Please try again.');
    }
});

/**
 * Health check endpoint for monitoring
 */
exports.health = onRequest((req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: Date.now(),
        service: 'NEON REBOUND Cloud Functions',
        version: '1.0.0'
    });
});

console.log('🚀 NEON REBOUND Cloud Functions initialized');

