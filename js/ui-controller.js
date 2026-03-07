/**
 * UI CONTROLLER MODULE
 * Handles UI interactions, menu controls, and user input
 */

import { sanitizeName, sanitizeSeed, createGameChallenge } from './firebase-manager.js';
import { player } from './game-engine.js';
import { connectToPeer, copyMyID, kickPlayer, sendStartGame, sendBackToLobby, isHost } from './multiplayer.js';

/**
 * Updates player name from input field
 */
export function updateMyName() {
    const input = document.getElementById('name-input').value;
    const sanitized = sanitizeName(input) || '';
    player.name = sanitized;
    document.getElementById('name-input').value = sanitized;

    if(player.name.length >= 2) {
        document.getElementById('name-warning').style.display = 'none';
    }
}

/**
 * Handles seed input changes
 */
export function onSeedInputChange() {
    const input = document.getElementById('seed-input').value;
    const sanitized = sanitizeSeed(input) || '';
    document.getElementById('seed-input').value = sanitized;

    if(isHost) {
        import('./multiplayer.js').then(module => {
            module.broadcast({ type: 'sync_seed', seed: sanitized });
        });
    }
    window.updateSeedSidebar();
}

/**
 * Requests game start — creates an anti-cheat challenge before launching
 */
export async function requestStart() {
    if (!player.name || player.name.length < 2) {
        document.getElementById('name-warning').style.display = 'block';
        return;
    }

    let seed = document.getElementById('seed-input').value || "MISSION_1";
    seed = sanitizeSeed(seed) || "MISSION_1";

    // Create a one-time-use challenge nonce BEFORE the game starts
    // The server will verify this challenge exists and is unused when the score is submitted
    const challengeId = await createGameChallenge();
    if (!challengeId) {
        console.warn("⚠️ Failed to create game challenge — game will start but scores may not submit");
    }

    sendStartGame(seed);
    window.initGame(seed, challengeId);
}

/**
 * Returns to lobby from game over screen
 */
export function backToLobby() {
    sendBackToLobby();
    window.resetToLobby();
}

/**
 * Dev console UI helper
 */
export function devSubmitTest() {
    const name = document.getElementById('dev-name').value || "TEST_USER";
    const score = parseInt(document.getElementById('dev-score').value) || 100;
    const seed = document.getElementById('dev-seed').value || document.getElementById('seed-input').value || "MISSION_1";
    window.testSubmitScore(name, score, seed);
}

// Expose functions to window for inline event handlers
window.updateMyName = updateMyName;
window.onSeedInputChange = onSeedInputChange;
window.requestStart = requestStart;
window.backToLobby = backToLobby;
window.devSubmitTest = devSubmitTest;
window.copyMyID = copyMyID;
window.kickPlayer = kickPlayer;
window.connectToPeer = () => connectToPeer(player);

