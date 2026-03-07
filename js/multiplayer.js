/**
 * MULTIPLAYER MODULE
 * Handles PeerJS connections, lobby management, and multiplayer state
 */

import { sanitizeName, sanitizeSeed, createGameChallenge } from './firebase-manager.js';

const peer = new Peer();
let conns = [], hostConn = null;
export let isHost = true, isConnected = false;
export let opponents = {};

const MAX_CONNECTIONS = 8;
const CONNECTION_TIMEOUT = 30000; // 30 seconds
const connectionTimestamps = new Map();

/**
 * Validates peer data to prevent malicious inputs
 */
function validatePeerData(data) {
    if (!data || typeof data !== 'object') return false;
    if (!data.type || typeof data.type !== 'string') return false;

    // Validate based on message type
    switch(data.type) {
        case 'name':
            return typeof data.name === 'string' && data.name.length >= 1 && data.name.length <= 20;
        case 'pos':
        case 'opp_pos':
            return typeof data.x === 'number' && typeof data.absY === 'number' &&
                   typeof data.score === 'number' && typeof data.dead === 'boolean';
        case 'sync_seed':
        case 'start':
            return typeof data.seed === 'string' && /^[A-Za-z0-9_-]{1,50}$/.test(data.seed);
        default:
            return ['lobby_update', 'back_to_lobby', 'kicked'].includes(data.type);
    }
}

/**
 * Sanitizes peer name (uses shared sanitizeName from Firebase module)
 */
function sanitizePeerName(name) {
    const sanitized = sanitizeName(name);
    return sanitized || 'Unknown';
}

/**
 * Cleans up inactive connections
 */
function cleanupInactiveConnections() {
    const now = Date.now();
    conns = conns.filter(c => {
        const timestamp = connectionTimestamps.get(c.peer);
        if (timestamp && now - timestamp > CONNECTION_TIMEOUT) {
            console.log(`🔌 Closing inactive connection: ${c.peer}`);
            c.close();
            return false;
        }
        return true;
    });
}

/**
 * Validates and clamps position/score data from peers
 */
function validateAndClampPositionData(data) {
    return {
        x: Math.max(0, Math.min(400, data.x || 0)),
        absY: Math.max(-10000, Math.min(10000, data.absY || 0)),
        score: Math.max(0, Math.min(100000, data.score || 0)),
        dead: !!data.dead
    };
}

setInterval(cleanupInactiveConnections, 10000); // Check every 10 seconds

peer.on('open', id => {
    document.getElementById('my-id-container').innerText = "YOUR ID: " + id;
});

export function copyMyID() {
    const idText = document.getElementById('my-id-container').innerText.replace("YOUR ID: ", "");
    if(idText === "CONNECTING...") return;
    navigator.clipboard.writeText(idText);
    const original = document.getElementById('my-id-container').innerText;
    document.getElementById('my-id-container').innerText = "COPIED!";
    document.getElementById('my-id-container').style.color = "#00ff00";
    setTimeout(() => {
        document.getElementById('my-id-container').innerText = original;
        document.getElementById('my-id-container').style.color = "var(--neon)";
    }, 1500);
}

peer.on('connection', c => {
    // Check connection limit
    if (conns.length >= MAX_CONNECTIONS) {
        console.warn(`⚠️ Connection limit reached. Rejecting: ${c.peer}`);
        c.close();
        return;
    }

    isHost = true;
    isConnected = true;
    conns.push(c);
    connectionTimestamps.set(c.peer, Date.now());

    setupHostConnection(c);
    c.on('open', () => {
        const seed = document.getElementById('seed-input').value || "MISSION_1";
        c.send({ type: 'sync_seed', seed: seed });
    });

    c.on('close', () => {
        connectionTimestamps.delete(c.peer);
    });
});

function setupHostConnection(c) {
    c.on('data', data => {
        // Validate all incoming data
        if (!validatePeerData(data)) {
            console.warn(`⚠️ Invalid peer data from ${c.peer}:`, data);
            return;
        }

        // Update connection timestamp
        connectionTimestamps.set(c.peer, Date.now());

        if(data.type === 'name') {
            const safeName = sanitizePeerName(data.name);
            opponents[c.peer] = {
                name: safeName,
                x: 185,
                absY: 520,
                score: 0,
                dead: false,
                el: createOpponentElement(c.peer, safeName)
            };
            updateLobbyUI();
            broadcast({ type: 'lobby_update', players: getLobbyData() });
        }
        if(data.type === 'pos') {
            if(opponents[c.peer]) {
                const validated = validateAndClampPositionData(data);
                opponents[c.peer].x = validated.x;
                opponents[c.peer].absY = validated.absY;
                opponents[c.peer].score = validated.score;
                opponents[c.peer].dead = validated.dead;
            }
            broadcast({
                type: 'opp_pos',
                id: c.peer,
                x: opponents[c.peer].x,
                absY: opponents[c.peer].absY,
                score: opponents[c.peer].score,
                dead: opponents[c.peer].dead,
                name: opponents[c.peer]?.name
            }, c.peer);
        }
    });
}

export function kickPlayer(id) {
    const conn = conns.find(c => c.peer === id);
    if(conn) {
        conn.send({ type: 'kicked' });
        setTimeout(() => conn.close(), 100);
        conns = conns.filter(c => c.peer !== id);
        if(opponents[id]) {
            if(opponents[id].el) opponents[id].el.remove();
            delete opponents[id];
        }
        updateLobbyUI();
        broadcast({ type: 'lobby_update', players: getLobbyData() });
    }
}

export function connectToPeer(player) {
    if (!player.name || player.name.length < 2) {
        document.getElementById('name-warning').style.display = 'block';
        return;
    }
    const joinId = document.getElementById('join-id').value.trim();
    if (!joinId) return;

    hostConn = peer.connect(joinId);
    isHost = false;

    hostConn.on('open', () => {
        hostConn.send({ type: 'name', name: player.name });

        hostConn.on('data', data => {
            // Validate all incoming data
            if (!validatePeerData(data)) {
                console.warn(`⚠️ Invalid data from host:`, data);
                return;
            }

            if(data.type === 'lobby_update') {
                if (Array.isArray(data.players)) {
                    renderGuestLobby(data.players);
                }
            }
            if(data.type === 'sync_seed') {
                const safeSeed = sanitizeSeed(data.seed);
                if (safeSeed) {
                    document.getElementById('seed-input').value = safeSeed;
                    window.updateSeedSidebar();
                }
            }
            if(data.type === 'start') {
                const safeSeed = sanitizeSeed(data.seed);
                if (safeSeed) {
                    // Guest also needs a challenge for their own score submission
                    createGameChallenge().then(challengeId => {
                        window.initGame(safeSeed, challengeId);
                    });
                }
            }
            if(data.type === 'opp_pos') {
                if(!opponents[data.id]) {
                    const safeName = sanitizePeerName(data.name);
                    opponents[data.id] = {
                        name: safeName,
                        el: createOpponentElement(data.id, safeName)
                    };
                }
                const validated = validateAndClampPositionData(data);
                opponents[data.id].x = validated.x;
                opponents[data.id].absY = validated.absY;
                opponents[data.id].score = validated.score;
                opponents[data.id].dead = validated.dead;
            }
            if(data.type === 'back_to_lobby') window.resetToLobby();
            if(data.type === 'kicked') {
                alert("YOU WERE KICKED BY THE HOST!");
                location.reload();
            }
        });
    });
}

export function broadcast(data, skipId = null) {
    conns.forEach(c => {
        if(c.peer !== skipId) c.send(data);
    });
}

function createOpponentElement(id, name) {
    const el = document.createElement('div');
    el.className = 'player-box opponent';
    const safeName = sanitizePeerName(name);
    const nameTag = document.createElement('div');
    nameTag.className = 'name-tag';
    nameTag.textContent = safeName; // Use textContent to prevent XSS
    el.appendChild(nameTag);
    document.getElementById('game-container').appendChild(el);
    return el;
}

function getLobbyData() {
    let list = [{ name: window.player.name, id: peer.id, isHost: true }];
    for(let id in opponents) list.push({ name: opponents[id].name, id: id, isHost: false });
    return list;
}

function renderLobbyUI(players = null, showKickButtons = true) {
    const playerList = players || getLobbyData();
    const myId = peer.id;

    document.getElementById('lobby-list-content').innerHTML = playerList.map(p => {
        const isMe = (p.id === myId) || (players && p.name === window.player.name);
        const color = isMe ? 'var(--neon)' : 'var(--magenta)';
        const kickBtn = (showKickButtons && isHost && !isMe) ? `<button class="kick-btn" onclick="kickPlayer('${p.id}')">KICK</button>` : '';
        return `<div style="color:${color}; display:flex; align-items:center; justify-content:center; margin-bottom:4px;">● ${p.name} ${kickBtn}</div>`;
    }).join('');
}

function updateLobbyUI() {
    renderLobbyUI(null, true);
}

function renderGuestLobby(players) {
    renderLobbyUI(players, false);
}

export function sendPositionUpdate(player, myAbsHeight, isGameOver) {
    const myData = {
        type: (isHost ? 'opp_pos' : 'pos'),
        id: peer.id,
        name: player.name,
        x: player.x,
        absY: player.y - window.cameraY,
        score: Math.floor(myAbsHeight),
        dead: isGameOver,
        gameTime: window.gameTime // LISÄTTY: Lähetetään nykyinen peliaika
    };
    if(isHost) broadcast(myData);
    else if(hostConn) hostConn.send(myData);
}

export function sendStartGame(seed) {
    if (isHost) broadcast({ type: 'start', seed: seed });
}

export function sendBackToLobby() {
    if(isHost) broadcast({ type: 'back_to_lobby' });
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isConnected) {
        console.log("Back online! Resyncing...");
        
        // Haetaan tuoreimmat tiedot globaalista ikkunasta
        const p = window.player;
        const h = window.myAbsHeight;
        const g = window.isGameOver;

        if (p) {
            sendPositionUpdate(p, h, g);
        }
    }
});

// Export peer for access
export { peer };

