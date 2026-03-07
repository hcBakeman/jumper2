/**
 * GAME ENGINE MODULE
 * Core game logic, physics, and rendering
 */

import { opponents, sendPositionUpdate, isHost } from './multiplayer.js';

export let player = { x: 185, y: 520, vx: 0, vy: 0, name: "" };
export let platforms = [], cameraY = 0, highestWorldY = 600, keys = {}, globalSeed = 0;
export let gameTime = 0, lastTime = 0;
export let isRunning = false, isGameOver = false;
export let myAbsHeight = 0;

// Telemetry tracking for anti-cheat
export let gameTelemetry = {
    jumps: 0,
    platformTouches: 0,
    maxFallDistance: 0,
    gameStartTime: 0,
    lastJumpY: 0,
    events: [],
    integrityToken: 0,
    challengeId: null
};

window.player = player;
window.cameraY = cameraY;
window.myAbsHeight = myAbsHeight;

/**
 * Generates a platform at the specified Y position
 */
function generatePlatform(y, isFirst = false) {
    let rand = Math.sin(y + globalSeed) * 10000;
    rand -= Math.floor(rand);
    let score = Math.abs(y) / 10;
    let w, x;

    if (isFirst) {
        w = 180;
        x = 110;
    } else {
        w = 70 + rand * 30;
        x = rand * (400 - w);
    }

    let mvSpeed = (!isFirst && score > 20) ? (rand > 0.5 ? 1 : -1) * (50 + score) : 0;

    const el = document.createElement('div');
    el.className = 'platform';
    el.style.width = w + 'px';
    document.getElementById('game-container').appendChild(el);

    platforms.push({ x, worldY: y, w, el, mvSpeed, seedOffset: rand * 10 });
}

export function initGame(seed, challengeId = null) {
    globalSeed = seed.split('').reduce((a,b) => (a << 5) - a + b.charCodeAt(0), 0);
    isRunning = true;
    isGameOver = false;
    player.x = 185;
    player.y = 520;
    player.vx = 0;
    player.vy = 0;
    myAbsHeight = 0;
    window.myAbsHeight = 0;
    cameraY = 0;
    window.cameraY = 0;
    highestWorldY = 600;
    gameTime = 0;
    lastTime = performance.now();
    platforms = [];

    // Reset telemetry
    gameTelemetry.jumps = 0;
    gameTelemetry.platformTouches = 0;
    gameTelemetry.maxFallDistance = 0;
    gameTelemetry.gameStartTime = Date.now();
    gameTelemetry.lastJumpY = 0;
    gameTelemetry.events = [];
    gameTelemetry.integrityToken = Math.floor(Math.random() * 1000000);
    gameTelemetry.challengeId = challengeId; // One-time-use nonce for anti-replay

    document.querySelectorAll('.platform').forEach(p => p.remove());
    for(let id in opponents) {
        opponents[id].dead = false;
        opponents[id].score = 0;
        opponents[id].absY = 520;
    }

    generatePlatform(550, true);
    while(highestWorldY > -100) {
        highestWorldY -= 80;
        generatePlatform(highestWorldY);
    }

    document.getElementById('setup-menu').style.display = 'none';
    document.getElementById('game-wrapper').style.display = 'block';
    document.getElementById('overlay').style.display = 'none';
    document.getElementById('my-name-tag').innerText = player.name;
    requestAnimationFrame(gameLoop);
}

function gameLoop(t) {
    if (!isRunning) return;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if(dt > 0.1) dt = 0.016;
    updateLogic(dt);
    render();
    requestAnimationFrame(gameLoop);
}

function updateLogic(dt) {
    gameTime += dt;
    platforms.forEach(p => {
        if (p.mvSpeed !== 0) {
            let range = (400 - p.w) / 2;
            p.x = (200 - p.w/2) + Math.sin(gameTime * (Math.abs(p.mvSpeed)/60) + p.seedOffset) * range;
        }
    });

    if (!isGameOver) {
        if (keys['ArrowLeft']) player.vx = -400;
        else if (keys['ArrowRight']) player.vx = 400;
        else player.vx *= 0.8;
        player.vy += 1600 * dt;
        player.x += player.vx * dt;
        player.y += player.vy * dt;
        if(player.x > 400) player.x = -25;
        if(player.x < -25) player.x = 400;

        platforms.forEach(p => {
            let screenY = p.worldY + cameraY;
            if(player.vy > 0 && player.x+25 > p.x && player.x < p.x+p.w && player.y+25 > screenY && player.y+25 < screenY+15) {
                player.vy = -650;

                // Track telemetry
                gameTelemetry.jumps++;
                gameTelemetry.platformTouches++;

                // Track fall distance
                const fallDist = Math.abs(screenY - gameTelemetry.lastJumpY);
                if (fallDist > gameTelemetry.maxFallDistance) {
                    gameTelemetry.maxFallDistance = fallDist;
                }
                gameTelemetry.lastJumpY = screenY;

                // Record event for replay validation
                if (gameTelemetry.events.length < 1000) {
                    gameTelemetry.events.push({
                        t: Math.floor(gameTime * 1000),
                        y: Math.floor(screenY),
                        x: Math.floor(player.x),
                        h: Math.floor(myAbsHeight)
                    });
                }

                // Update integrity token
                gameTelemetry.integrityToken = (gameTelemetry.integrityToken * 31 + Math.floor(screenY * 1000)) % 1000000;
            }
        });

        if (player.y < 300) {
            let diff = 300 - player.y;
            cameraY += diff;
            window.cameraY = cameraY;
            myAbsHeight += diff / 10;
            window.myAbsHeight = myAbsHeight;
            player.y = 300;
        }
        if(player.y + 25 > 600) {
            isGameOver = true;
            const seed = document.getElementById('seed-input').value || "MISSION_1";
            const duration = Math.floor((Date.now() - gameTelemetry.gameStartTime) / 1000);
            const finalScore = Math.floor(myAbsHeight);

            // Only submit if score is valid
            if (finalScore > 0 && Number.isFinite(finalScore)) {
                window.submitGlobalScore(player.name, finalScore, seed, {
                    jumps: gameTelemetry.jumps,
                    platforms: gameTelemetry.platformTouches,
                    duration: duration,
                    maxFall: Math.floor(gameTelemetry.maxFallDistance),
                    events: gameTelemetry.events.slice(0, 100), // Send first 100 events
                    integrityToken: gameTelemetry.integrityToken,
                    challengeId: gameTelemetry.challengeId
                });
            } else {
                console.warn('⚠️ Invalid final score, not submitting:', finalScore);
            }
        }
    } else {
        // DEATH CAM: Follow alive player with highest score
        let bestOpponent = null;
        let maxScore = -1;
        for(let id in opponents) {
            if(!opponents[id].dead && opponents[id].score > maxScore) {
                maxScore = opponents[id].score;
                bestOpponent = opponents[id];
            }
        }
        if(bestOpponent) {
            let targetScreenY = bestOpponent.absY + cameraY;
            let diff = 300 - targetScreenY;
            cameraY += diff;
            window.cameraY = cameraY;
        }
    }

    // Generate platforms based on camera (important for death cam too)
    while (highestWorldY > -cameraY - 100) {
        highestWorldY -= 80;
        generatePlatform(highestWorldY);
    }

    document.getElementById('score').innerText = Math.floor(myAbsHeight);

    platforms = platforms.filter(p => {
        if (p.worldY + cameraY > 800) {
            p.el.remove();
            return false;
        }
        return true;
    });

    sendPositionUpdate(player, myAbsHeight, isGameOver);
    updateLiveTracking();

    let anyoneAlive = !isGameOver;
    for(let id in opponents) if(!opponents[id].dead) anyoneAlive = true;
    if(!anyoneAlive && isRunning) showEndScreen();
}

function render() {
    document.getElementById('player').style.transform = `translate(${player.x}px, ${player.y}px)`;
    document.getElementById('player').style.display = isGameOver ? 'none' : 'block';
    for(let id in opponents) {
        let o = opponents[id];
        if(o.el) {
            o.el.style.transform = `translate(${o.x}px, ${o.absY + cameraY}px)`;
            o.el.style.opacity = o.dead ? "0.2" : "1";
        }
    }
    platforms.forEach(p => p.el.style.transform = `translate(${p.x}px, ${p.worldY + cameraY}px)`);
}

function updateLiveTracking() {
    let list = [{n: player.name, s: Math.floor(myAbsHeight), d: isGameOver}];
    for(let id in opponents) list.push({n: opponents[id].name, s: opponents[id].score, d: opponents[id].dead});
    list.sort((a,b) => b.s - a.s);
    document.getElementById('live-list-content-game').innerHTML = list.map(p => `<div style="color:${p.d?'#ff4444':'#00ff00'}">${p.n}: ${p.s}</div>`).join('');
}

function showEndScreen() {
    if (document.getElementById('overlay').style.display === 'flex') return;
    const myScore = Math.floor(myAbsHeight);
    const banner = document.getElementById('achievement-banner');
    const overlay = document.getElementById('overlay');
    overlay.style.display = 'flex';
    banner.innerHTML = "";

    if (myScore > 10) {
        if (myScore >= window.seedTop1Score || window.seedScoresCount === 0) {
            banner.innerHTML = `<div class="wr-banner">🏆 NEW WORLD RECORD! 🏆</div>`;
        } else if (myScore >= window.seedTop10Score || window.seedScoresCount < 10) {
            banner.innerHTML = `<div style="color:var(--neon); margin-bottom:10px; font-weight:bold;">🔥 TOP 10 REACHED! 🔥</div>`;
        }
    }

    let pilots = [{ name: player.name, score: myScore, isMe: true }];
    for(let id in opponents) pilots.push({ name: opponents[id].name, score: opponents[id].score, isMe: false });
    pilots.sort((a,b) => b.score - a.score);

    document.getElementById('winner-info').innerText = pilots.length > 1 ? `WINNER: ${pilots[0].name}` : "";
    document.getElementById('final-leaderboard').innerHTML = pilots.map(p => `<tr style="color:${p.isMe?'var(--neon)':'white'}"><td>${p.name}</td><td style="text-align:right;"><b>${p.score}</b></td></tr>`).join('');

    if(isHost) document.getElementById('host-restart-controls').style.display = 'block';
    else document.getElementById('guest-wait-info').style.display = 'block';
}

export function resetToLobby() {
    isRunning = false;
    document.getElementById('game-wrapper').style.display = 'none';
    document.getElementById('setup-menu').style.display = 'block';
    document.getElementById('overlay').style.display = 'none';
}

// Keyboard event listeners
window.addEventListener('keydown', e => keys[e.code] = true);
window.addEventListener('keyup', e => keys[e.code] = false);

// Expose functions to window for inline event handlers
window.initGame = initGame;
window.resetToLobby = resetToLobby;

