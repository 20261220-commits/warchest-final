const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, '/')));

const rooms = {};
const disconnectTimers = {}; // key: `${roomId}:${team}` -> setTimeout handle (재접속 유예 타이머)

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

    // 4. 게임 전장(game.html) 입장 및 데이터 공유
    //    소켓이 순간적으로 끊겼다가 자동 재연결된 경우에도 다시 호출되므로,
    //    같은 팀 슬롯이 이미 있으면 소켓 id만 최신으로 갱신해서 자리를 이어받게 한다.
    socket.on('joinGameField', ({ roomId, team, pickedUnits, userName }) => {
        socket.join(roomId);
        if (!rooms[roomId]) {
            rooms[roomId] = { roomId, players: [], gameState: null };
        }
        const room = rooms[roomId];

        const existing = room.players.find(p => p.team === team);
        if (existing) {
            existing.id = socket.id; // 재접속: 같은 팀 자리를 새 소켓으로 이어받음
        } else {
            room.players.push({ id: socket.id, name: userName || (team === 'blue' ? '파란팀' : '빨간팀'), team });
        }

        // 이 팀에 대한 '이탈 예정' 타이머가 대기 중이었다면 취소 (순간적인 끊김이었을 뿐 재접속 성공)
        const timerKey = `${roomId}:${team}`;
        if (disconnectTimers[timerKey]) {
            clearTimeout(disconnectTimers[timerKey]);
            delete disconnectTimers[timerKey];
            io.to(roomId).emit('playerReconnected', { team });
        }

        if (!room.picked) room.picked = {};
        room.picked[team] = pickedUnits;

        // 두 팀의 픽 정보가 모두 준비되면 게임 시작 신호 전송
        if (room.picked.blue && room.picked.red) {
            io.to(roomId).emit('initGameField', room.picked);
        }
    });

    // 5. 인게임 플레이어 행동 동기화 (이동/공격/배치/점령/패스 등)
    socket.on('gameAction', ({ roomId, actionData }) => {
        // 상대방에게 플레이어의 행동을 방송(broadcast)
        socket.to(roomId).emit('onGameAction', actionData);
    });

    socket.on('disconnect', () => {
        console.log(`플레이어 접속 해제: ${socket.id}`);

        // 이 소켓이 속해있던 방을 찾는다
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const idx = room.players.findIndex(p => p.id === socket.id);
            if (idx !== -1) {
                const leftPlayer = room.players[idx];
                const timerKey = `${roomId}:${leftPlayer.team}`;

                // 곧바로 '나갔다'고 처리하지 않고 8초 유예를 준다.
                // 그 사이에 같은 팀이 joinGameField로 재접속하면 위에서 타이머를 취소하므로,
                // 순간적인 네트워크 끊김/자동 재연결은 상대방에게 알리지 않고 조용히 넘어간다.
                disconnectTimers[timerKey] = setTimeout(() => {
                    const stillIdx = room.players.findIndex(p => p.id === socket.id);
                    if (stillIdx !== -1) {
                        room.players.splice(stillIdx, 1);

                        if (room.players.length > 0) {
                            io.to(roomId).emit('playerLeft', { team: leftPlayer.team, name: leftPlayer.name });
                            io.to(roomId).emit('roomStateUpdate', room);
                        } else {
                            // 방에 아무도 없으면 메모리에서 완전히 제거
                            delete rooms[roomId];
                        }
                    }
                    delete disconnectTimers[timerKey];
                }, 8000);
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