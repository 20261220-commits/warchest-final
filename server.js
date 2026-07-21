const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

io.on('connection', (socket) => {
    console.log(`플레이어 접속: ${socket.id}`);

    // 1. 방 참가 / 생성 처리
    socket.on('joinRoom', ({ roomId, userName }) => {
        socket.join(roomId);

        if (!rooms[roomId]) {
            rooms[roomId] = {
                roomId,
                players: [],
                gameState: null
            };
        }

        const room = rooms[roomId];

        if (room.players.length < 2) {
            const team = room.players.length === 0 ? 'blue' : 'red';
            room.players.push({ id: socket.id, name: userName, team });

            io.to(roomId).emit('roomStateUpdate', room);
        } else {
            socket.emit('roomFull', { message: '방이 가득 찼습니다!' });
        }
    });

    // 2. 매치 시작
    socket.on('startMatch', ({ roomId, isTimerEnabled }) => {
        io.to(roomId).emit('matchStarted', { isTimerEnabled });
    });

    // 3. 드래프트 타일 선택 동기화
    socket.on('selectTile', (data) => {
        io.to(data.roomId).emit('tileSelected', data);
    });

    // 4. [NEW] 게임 전장(game.html) 입장 및 데이터 공유
    socket.on('joinGameField', ({ roomId, team, pickedUnits }) => {
        socket.join(roomId);
        if (rooms[roomId]) {
            if (!rooms[roomId].picked) rooms[roomId].picked = {};
            rooms[roomId].picked[team] = pickedUnits;

            // 두 팀의 픽 정보가 모두 준비되면 게임 시작 신호 전송
            if (rooms[roomId].picked.blue && rooms[roomId].picked.red) {
                io.to(roomId).emit('initGameField', rooms[roomId].picked);
            }
        }
    });

    // 5. [NEW] 인게임 플레이어 행동 동기화 (이동/공격/배치/점령/패스 등)
    socket.on('gameAction', ({ roomId, actionData }) => {
        // 상대방에게 플레이어의 행동을 방송(broadcast)
        socket.to(roomId).emit('onGameAction', actionData);
    });

    socket.on('disconnect', () => {
        console.log(`플레이어 접속 해제: ${socket.id}`);

        // 이 소켓이 속해있던 방을 찾아서 정리하고, 남은 상대방에게 알림
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const idx = room.players.findIndex(p => p.id === socket.id);
            if (idx !== -1) {
                const leftPlayer = room.players[idx];
                room.players.splice(idx, 1);

                if (room.players.length > 0) {
                    io.to(roomId).emit('playerLeft', { team: leftPlayer.team, name: leftPlayer.name });
                    io.to(roomId).emit('roomStateUpdate', room);
                } else {
                    // 방에 아무도 없으면 메모리에서 완전히 제거
                    delete rooms[roomId];
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 워체스트 서버가 실행되었습니다! http://localhost:${PORT}`);
});
//fuser -k 3000/tcp
//node server.js