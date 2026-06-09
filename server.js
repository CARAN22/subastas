const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

function giftImage(fileName) {
    return `/gift-images/${encodeURIComponent(fileName)}`;
}

const BATTLE_GIFTS = {
    enemy: [
        { name: 'Corazon coreano', coins: 5, image: giftImage('Corazón Coreano.png'), tokens: ['corazon coreano', 'corazón coreano'] },
        { name: 'Rosa grande', coins: 10, image: giftImage('Rosa Grande.png'), tokens: ['rosa grande', 'rosa', 'rose'] },
        { name: 'Rosquilla', coins: 30, image: giftImage('Dona.png'), tokens: ['rosquilla', 'dona', 'donut'] },
        { name: 'Control', coins: 100, image: giftImage('Control.png'), tokens: ['control'] },
        { name: 'Pistola de dinero', coins: 500, image: giftImage('Pistola de Diamantes.png'), tokens: ['pistola de dinero', 'pistola de diamantes', 'money gun'] },
        { name: 'Galaxia', coins: 1000, image: giftImage('Galaxia.png'), tokens: ['galaxia'] }
    ],
    hero: [
        { name: 'Fuegos artificiales', coins: 5, image: giftImage('Fuegos Artificiales.png'), tokens: ['fuegos artificiales'] },
        { name: 'Corazon', coins: 10, image: giftImage('Corazón.png'), tokens: ['corazon', 'corazón'] },
        { name: 'Capibara', coins: 30, image: giftImage('Capibara.png'), tokens: ['capibara'] },
        { name: 'Super GG', coins: 100, image: giftImage('GG.png'), tokens: ['super gg'] },
        { name: 'Inmersion en tu musica', coins: 500, image: giftImage('Música agradable.png'), tokens: ['inmersion en tu musica', 'inmersión en tu música', 'musica agradable', 'música agradable'] },
        { name: 'Sandia enamorada', coins: 1000, image: giftImage('Sandía enamorada.png'), tokens: ['sandia enamorada', 'sandía enamorada'] }
    ]
};

app.use(express.json());
app.use((req, res, next) => {
    if (req.path === '/wins.html' || req.path === '/comments.html' || req.path === '/battle.html' || req.path === '/battle-overlay.html' || req.path.startsWith('/api/wins') || req.path.startsWith('/api/comments') || req.path.startsWith('/api/battle')) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
    }
    next();
});
app.use('/gift-images', express.static(path.join(__dirname, 'REGALOS DE TIK TOK PNG By Adbra')));
app.use(express.static('public'));

let tiktokConnection = null;

// Estado global de la subasta para sincronizar Panel y Overlay
let auctionState = {
    participants: [],
    timeLeft: 0,
    initTimeConfig: 60,
    delayTimeConfig: 10, // Tiempo extra fijo al final
    minCoins: 100,
    isAuctionActive: false,
    hasWinner: false,
    isRouletteRunning: false,
    themeColor: '#bc13fe',
    // Nuevos campos para Subasta Clásica
    mode: 'elimination', // 'elimination' o 'classic'
    classicParticipants: {}, // { username: { nickname, photo, coins } }
    likeParticipants: {}, // { username: { name, photo, likes } }
    totalLikes: 0,
    wins: { goal: 50, current: 0, adjust: 15 },
    comments: [],
    battle: {
        heroScore: 0,
        enemyScore: 0,
        heroLabel: 'HEROES',
        enemyLabel: 'ENEMIGOS',
        heroGifts: BATTLE_GIFTS.hero,
        enemyGifts: BATTLE_GIFTS.enemy,
        roundSeconds: 60,
        slowFinalMs: 1800,
        timerDuration: 60,
        timerStartedAt: 0,
        timerRunning: false,
        lastSide: '',
        lastGiftName: '',
        lastGiftImage: '',
        lastGiftCoins: 0,
        lastDonor: '',
        lastAmount: 0,
        lastEventId: 0
    },
    extraTimePerCoin: 0 // Cambiado a 0 según pedido (usaremos delay fijo)
};

function numberOr(value, fallback) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function textOr(value, fallback) {
    const parsed = String(value ?? '').trim();
    return parsed || fallback;
}

function setWinsState(wins) {
    const previous = auctionState.wins || { goal: 50, current: 0, adjust: 15 };
    auctionState.wins = {
        goal: Math.max(1, numberOr(wins.goal, previous.goal)),
        current: numberOr(wins.current, previous.current),
        adjust: numberOr(wins.adjust, previous.adjust)
    };
    return auctionState.wins;
}

function getBattleState() {
    return {
        ...auctionState.battle,
        serverNow: Date.now()
    };
}

function setBattleConfig(config) {
    const previous = auctionState.battle;
    auctionState.battle = {
        ...previous,
        heroLabel: textOr(config.heroLabel, previous.heroLabel),
        enemyLabel: textOr(config.enemyLabel, previous.enemyLabel),
        heroGifts: BATTLE_GIFTS.hero,
        enemyGifts: BATTLE_GIFTS.enemy,
        roundSeconds: Math.max(1, numberOr(config.roundSeconds, previous.roundSeconds)),
        slowFinalMs: Math.max(1000, numberOr(config.slowFinalMs, previous.slowFinalMs))
    };

    if (!auctionState.battle.timerRunning) {
        auctionState.battle.timerDuration = auctionState.battle.roundSeconds;
    }

    return getBattleState();
}

function resetBattleState() {
    auctionState.battle.heroScore = 0;
    auctionState.battle.enemyScore = 0;
    auctionState.battle.timerDuration = auctionState.battle.roundSeconds;
    auctionState.battle.timerStartedAt = 0;
    auctionState.battle.timerRunning = false;
    auctionState.battle.lastSide = '';
    auctionState.battle.lastGiftName = '';
    auctionState.battle.lastGiftImage = '';
    auctionState.battle.lastGiftCoins = 0;
    auctionState.battle.lastDonor = '';
    auctionState.battle.lastAmount = 0;
    auctionState.battle.lastEventId = Date.now();
    return getBattleState();
}

function startBattleTimer(seconds) {
    auctionState.battle.timerDuration = Math.max(1, numberOr(seconds, auctionState.battle.roundSeconds));
    auctionState.battle.timerStartedAt = Date.now();
    auctionState.battle.timerRunning = true;
    return getBattleState();
}

function stopBattleTimer() {
    auctionState.battle.timerRunning = false;
    return getBattleState();
}

function battleTimerTotalMs() {
    const battle = auctionState.battle;
    const duration = Math.max(1, numberOr(battle.timerDuration, battle.roundSeconds));
    const slow = Math.max(1000, numberOr(battle.slowFinalMs, 1800));
    const normalSeconds = Math.max(0, duration - 2);
    const finalMs = duration === 1 ? slow : slow * 2;
    return (normalSeconds * 1000) + finalMs;
}

function isBattleTimerDone() {
    const battle = auctionState.battle;
    if (!battle.timerRunning || !battle.timerStartedAt) return true;
    return Date.now() - battle.timerStartedAt >= battleTimerTotalMs();
}

function normalizeGiftText(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}

function giftTokens(value) {
    if (Array.isArray(value)) {
        return value.map((item) => normalizeGiftText(item)).filter(Boolean);
    }

    return String(value ?? '')
        .split(/[,;\n]+/)
        .map((item) => normalizeGiftText(item))
        .filter(Boolean);
}

function giftValues(data) {
    return [
        data.giftName,
        data.giftId,
        data.gift?.name,
        data.gift?.id,
        data.extendedGiftInfo?.name,
        data.extendedGiftInfo?.giftName,
        data.extendedGiftInfo?.giftId
    ].filter((value) => value !== undefined && value !== null);
}

function firstText(values, fallback) {
    for (const value of values) {
        const text = String(value ?? '').trim();
        if (text) return text;
    }

    return fallback;
}

function positiveNumber(values, fallback = 0) {
    for (const value of values) {
        const parsed = parseInt(value, 10);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }

    return fallback;
}

const KNOWN_REAL_GIFT_COINS = new Map([
    ['rosa', 1],
    ['rose', 1],
    ['control', 100]
]);

function knownRealGiftCoins(data) {
    const values = giftValues(data).map((value) => normalizeGiftText(value)).filter(Boolean);
    for (const value of values) {
        if (KNOWN_REAL_GIFT_COINS.has(value)) return KNOWN_REAL_GIFT_COINS.get(value);
    }

    return 0;
}

function realGiftCoins(data) {
    // The battle cards are only visual; never use their displayed value as a score fallback.
    return positiveNumber([
        data.diamondCount,
        data.diamond_count,
        data.diamondCost,
        data.gift?.diamondCount,
        data.gift?.diamond_count,
        data.gift?.diamondCost,
        data.giftInfo?.diamondCount,
        data.giftInfo?.diamond_count,
        data.giftInfo?.diamondCost,
        data.giftDetails?.diamondCount,
        data.giftDetails?.diamond_count,
        data.giftDetails?.diamondCost,
        data.extendedGiftInfo?.diamondCount,
        data.extendedGiftInfo?.diamond_count,
        data.extendedGiftInfo?.diamondCost
    ], knownRealGiftCoins(data));
}

function realGiftName(data, fallbackName) {
    return firstText([
        data.giftName,
        data.gift?.name,
        data.extendedGiftInfo?.name,
        data.extendedGiftInfo?.giftName
    ], fallbackName);
}

function findGiftRule(rules, data) {
    const values = giftValues(data).map((value) => normalizeGiftText(value)).filter(Boolean);
    return (rules || []).find((rule) => {
        const tokens = giftTokens(rule.tokens || rule.name);
        return tokens.some((token) => values.some((value) => value === token));
    });
}

function resolveBattleGift(data, forcedSide) {
    if (forcedSide === 'hero' || forcedSide === 'enemy') {
        const rules = BATTLE_GIFTS[forcedSide];
        return {
            side: forcedSide,
            rule: findGiftRule(rules, data) || rules[0]
        };
    }

    const enemyRule = findGiftRule(BATTLE_GIFTS.enemy, data);
    if (enemyRule) return { side: 'enemy', rule: enemyRule };

    const heroRule = findGiftRule(BATTLE_GIFTS.hero, data);
    if (heroRule) return { side: 'hero', rule: heroRule };

    return null;
}

function giftMatches(matchList, data) {
    const tokens = giftTokens(matchList);
    if (!tokens.length) return false;

    const values = giftValues(data).map((value) => normalizeGiftText(value));
    return tokens.some((token) => values.some((value) => value === token));
}

function applyBattleGift(data, repeatCount, forcedSide, unitCoinsOverride) {
    const battle = auctionState.battle;
    const gift = resolveBattleGift(data, forcedSide);

    if (!gift) return null;

    const { side, rule } = gift;
    const amount = Math.max(1, numberOr(repeatCount, 1));
    const unitCoins = positiveNumber([unitCoinsOverride], realGiftCoins(data));
    if (!unitCoins) return null;

    const points = amount * unitCoins;
    if (side === 'hero') battle.heroScore += points;
    else battle.enemyScore += points;

    battle.lastSide = side;
    battle.lastGiftName = realGiftName(data, rule.name);
    battle.lastGiftImage = rule.image;
    battle.lastGiftCoins = unitCoins;
    battle.lastDonor = textOr(data.nickname || data.uniqueId || data.userId, 'Usuario');
    battle.lastAmount = points;
    battle.lastEventId = Date.now();

    if (side === 'enemy' && isBattleTimerDone()) {
        startBattleTimer(battle.roundSeconds);
    }

    const payload = getBattleState();
    io.emit('battle-state-update', payload);
    return payload;
}

app.get('/api/wins', (req, res) => {
    res.json(auctionState.wins);
});

app.post('/api/wins', (req, res) => {
    const wins = setWinsState(req.body || {});
    io.emit('wins-update', wins);
    res.json(wins);
});

app.get('/api/battle', (req, res) => {
    res.json(getBattleState());
});

app.post('/api/battle/config', (req, res) => {
    const battle = setBattleConfig(req.body || {});
    io.emit('battle-state-update', battle);
    res.json(battle);
});

app.post('/api/battle/reset', (req, res) => {
    const battle = resetBattleState();
    io.emit('battle-state-update', battle);
    res.json(battle);
});

function pushComment(comment) {
    const text = String(comment.text || '').trim();
    if (!text) return null;

    const entry = {
        id: comment.id || `comment_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: String(comment.name || 'Usuario'),
        uniqueId: String(comment.uniqueId || ''),
        photo: String(comment.photo || ''),
        text,
        timestamp: Date.now()
    };

    auctionState.comments = [entry, ...(auctionState.comments || [])].slice(0, 25);
    io.emit('comments-update', {
        comments: auctionState.comments,
        newComment: entry
    });
    return entry;
}

app.get('/api/comments', (req, res) => {
    res.json({ comments: auctionState.comments || [] });
});

app.post('/api/comments/test', (req, res) => {
    const entry = pushComment(req.body || {});
    res.json({ comments: auctionState.comments || [], newComment: entry });
});

app.post('/api/comments/clear', (req, res) => {
    auctionState.comments = [];
    io.emit('comments-clear');
    io.emit('comments-update', { comments: auctionState.comments });
    res.json({ comments: auctionState.comments });
});

io.on('connection', (socket) => {
    console.log('Cliente conectado');
    
    socket.emit('sync-state', auctionState);

    socket.on('set-mode', (mode) => {
        auctionState.mode = mode;
        io.emit('mode-changed', mode);
    });

    socket.on('set-extra-time', (val) => {
        auctionState.extraTimePerCoin = val;
    });

    socket.on('set-tiktok-user', (username) => {
        if (tiktokConnection) {
            tiktokConnection.disconnect();
        }

        tiktokConnection = new WebcastPushConnection(username, {
            enableExtendedGiftInfo: true
        });

        tiktokConnection.connect().then(state => {
            console.info(`Conectado al live de ${username}`);
            auctionState.tiktokUser = username;
            auctionState.isConnected = true;
            io.emit('tiktok-connected', username);
            io.emit('sync-state', auctionState);
        }).catch(err => {
            console.error('Error TikTok:', err);
            auctionState.isConnected = false;
            socket.emit('tiktok-error', err.toString());
            io.emit('sync-state', auctionState);
        });

        tiktokConnection.on('gift', (data) => {
            if (!(data.giftType === 1 && !data.repeatEnd)) {
                const repeatCount = parseInt(data.repeatCount, 10) || 1;
                const unitCoins = realGiftCoins(data);
                const totalCoins = unitCoins * repeatCount;
                if (totalCoins <= 0) return;

                const donorId = data.uniqueId || data.userId || data.nickname || `donor_${Date.now()}`;

                if (!auctionState.classicParticipants[donorId]) {
                    auctionState.classicParticipants[donorId] = {
                        name: data.nickname,
                        photo: data.profilePictureUrl,
                        coins: 0
                    };
                }
                auctionState.classicParticipants[donorId].name = data.nickname;
                auctionState.classicParticipants[donorId].photo = data.profilePictureUrl;
                auctionState.classicParticipants[donorId].coins += totalCoins;

                io.emit('classic-update', {
                    participants: auctionState.classicParticipants,
                    newDonationId: donorId
                });

                applyBattleGift(data, repeatCount, undefined, unitCoins);
                
                if (auctionState.mode === 'elimination' || auctionState.mode === 'classic') {
                    const minRequired = parseInt(auctionState.minCoins) || 100;
                    let entries = Math.floor(totalCoins / minRequired);

                        // repeatCount múltiple para el mismo regalo.

                    if (entries > 0) {
                        for (let i = 0; i < entries; i++) {
                            io.emit('add-participant-broadcast', {
                                id: `gift_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                                name: data.nickname,
                                photo: data.profilePictureUrl,
                                coins: minRequired
                            });
                        }
                    }
                } if (false) {
                    // MODO CLÁSICO: Acumulativo y Ranking
                    if (!auctionState.classicParticipants[data.uniqueId]) {
                        auctionState.classicParticipants[data.uniqueId] = {
                            name: data.nickname,
                            photo: data.profilePictureUrl,
                            coins: 0
                        };
                    }
                    auctionState.classicParticipants[data.uniqueId].coins += totalCoins;
                    
                    io.emit('classic-update', {
                        participants: auctionState.classicParticipants,
                        newDonationId: data.uniqueId // Para efecto de agrandar/limpieza
                    });
                }
            }
        });

        tiktokConnection.on('like', (data) => {
            const likeCount = parseInt(data.likeCount, 10) || 1;
            if (likeCount <= 0) return;

            const likerId = data.uniqueId || data.userId || data.nickname || `like_${Date.now()}`;

            if (!auctionState.likeParticipants[likerId]) {
                auctionState.likeParticipants[likerId] = {
                    name: data.nickname || likerId,
                    photo: data.profilePictureUrl || '',
                    likes: 0
                };
            }

            auctionState.likeParticipants[likerId].name = data.nickname || auctionState.likeParticipants[likerId].name;
            auctionState.likeParticipants[likerId].photo = data.profilePictureUrl || auctionState.likeParticipants[likerId].photo;
            auctionState.likeParticipants[likerId].likes += likeCount;
            auctionState.totalLikes += likeCount;

            io.emit('likes-update', {
                participants: auctionState.likeParticipants,
                totalLikes: auctionState.totalLikes,
                newLikeId: likerId,
                newLikeCount: likeCount
            });
        });

        tiktokConnection.on('chat', (data) => {
            pushComment({
                id: data.msgId || data.commentId,
                name: data.nickname || data.uniqueId || 'Usuario',
                uniqueId: data.uniqueId || '',
                photo: data.profilePictureUrl || '',
                text: data.comment || data.msg || ''
            });
        });

        tiktokConnection.on('disconnected', () => {
            auctionState.isConnected = false;
            io.emit('tiktok-disconnected');
        });
    });

    // Comandos Admin (se mantienen y se añaden nuevos)
    socket.on('admin-start-auction', (config) => {
        auctionState.initTimeConfig = config.initTime;
        auctionState.delayTimeConfig = config.delayTime || 10;
        auctionState.minCoins = config.minCoins;
        auctionState.isAuctionActive = true;
        auctionState.hasWinner = false;
        if (auctionState.mode === 'classic') {
            auctionState.classicParticipants = {}; // Reset ranking al empezar
        }
        io.emit('start-auction-broadcast', config);
    });

    socket.on('admin-clear-all', () => {
        auctionState.participants = [];
        auctionState.classicParticipants = {};
        auctionState.isAuctionActive = false;
        auctionState.hasWinner = false;
        auctionState.isRouletteRunning = false;
        io.emit('clear-all-broadcast');
    });

    socket.on('admin-clear-donors', () => {
        auctionState.classicParticipants = {};
        io.emit('clear-donors-broadcast');
        io.emit('classic-update', {
            participants: auctionState.classicParticipants
        });
    });

    socket.on('admin-clear-likes', () => {
        auctionState.likeParticipants = {};
        auctionState.totalLikes = 0;
        io.emit('clear-likes-broadcast');
        io.emit('likes-update', {
            participants: auctionState.likeParticipants,
            totalLikes: auctionState.totalLikes
        });
    });

    socket.on('admin-change-theme', (color) => {
        auctionState.themeColor = color;
        io.emit('change-theme-broadcast', color);
    });

    socket.on('admin-add-test', (testData) => {
        io.emit('add-participant-broadcast', testData);
    });

    socket.on('admin-force-time', (newTime) => {
        io.emit('force-time-broadcast', newTime);
    });

    socket.on('admin-trigger-elimination', () => {
        io.emit('trigger-elimination-broadcast');
    });

    socket.on('admin-add-classic-test', (data) => {
        if (!auctionState.classicParticipants[data.uniqueId]) {
            auctionState.classicParticipants[data.uniqueId] = {
                name: data.nickname,
                photo: data.profilePictureUrl,
                coins: 0
            };
        }
        auctionState.classicParticipants[data.uniqueId].coins += data.totalCoins;
        io.emit('classic-update', {
            participants: auctionState.classicParticipants,
            newDonationId: data.uniqueId
        });
    });

    socket.on('admin-add-like-test', (data) => {
        const likeCount = parseInt(data.likeCount, 10) || 1;
        if (!auctionState.likeParticipants[data.uniqueId]) {
            auctionState.likeParticipants[data.uniqueId] = {
                name: data.nickname,
                photo: data.profilePictureUrl,
                likes: 0
            };
        }
        auctionState.likeParticipants[data.uniqueId].likes += likeCount;
        auctionState.totalLikes += likeCount;
        io.emit('likes-update', {
            participants: auctionState.likeParticipants,
            totalLikes: auctionState.totalLikes,
            newLikeId: data.uniqueId,
            newLikeCount: likeCount
        });
    });

    socket.on('admin-update-min', (min) => {
        auctionState.minCoins = min;
        io.emit('update-min-broadcast', min);
    });

    socket.on('admin-update-wins', (wins) => {
        io.emit('wins-update', setWinsState(wins || {}));
    });

    socket.on('admin-update-battle-config', (config) => {
        io.emit('battle-state-update', setBattleConfig(config || {}));
    });

    socket.on('admin-reset-battle', () => {
        io.emit('battle-state-update', resetBattleState());
    });

    socket.on('admin-battle-start-timer', (seconds) => {
        io.emit('battle-state-update', startBattleTimer(seconds));
    });

    socket.on('admin-battle-stop-timer', () => {
        io.emit('battle-state-update', stopBattleTimer());
    });

    socket.on('admin-battle-test-gift', (data) => {
        const side = data?.side === 'hero' ? 'hero' : 'enemy';
        const repeatCount = Math.max(1, numberOr(data?.repeatCount, 1));
        const rules = BATTLE_GIFTS[side];
        const ruleIndex = Math.max(0, Math.min(rules.length - 1, numberOr(data?.giftIndex, 0)));
        const rule = findGiftRule(rules, { giftName: data?.giftName }) || rules[ruleIndex];
        applyBattleGift({
            giftName: rule.name,
            nickname: data?.nickname || 'Test',
            uniqueId: `battle_test_${side}`
        }, repeatCount, side, rule.coins);
    });

    socket.on('admin-add-comment-test', (comment) => {
        pushComment(comment || {});
    });

    socket.on('admin-clear-comments', () => {
        auctionState.comments = [];
        io.emit('comments-clear');
        io.emit('comments-update', { comments: auctionState.comments });
    });

    socket.on('disconnect', () => {
        console.log('Cliente desconectado');
    });
});

server.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
