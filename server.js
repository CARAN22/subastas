const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use((req, res, next) => {
    if (req.path === '/wins.html' || req.path.startsWith('/api/wins')) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
    }
    next();
});
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
    extraTimePerCoin: 0 // Cambiado a 0 según pedido (usaremos delay fijo)
};
function numberOr(value, fallback) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
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

app.get('/api/wins', (req, res) => {
    res.json(auctionState.wins);
});

app.post('/api/wins', (req, res) => {
    const wins = setWinsState(req.body || {});
    io.emit('wins-update', wins);
    res.json(wins);
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

        tiktokConnection = new WebcastPushConnection(username);

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
                const diamondCount = parseInt(data.diamondCount, 10) || 0;
                const totalCoins = diamondCount * repeatCount;
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
        auctionState.likeParticipants = {};
        auctionState.totalLikes = 0;
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

    socket.on('disconnect', () => {
        console.log('Cliente desconectado');
    });
});

server.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
