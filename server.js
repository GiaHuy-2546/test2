const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const REAL_MAPS = [
  "Ascent",
  "Bind",
  "Haven",
  "Split",
  "Icebox",
  "Breeze",
  "Fracture",
  "Pearl",
  "Lotus",
  "Sunset",
  "Abyss",
];
const MAP_OPTIONS = [...REAL_MAPS, "Random"];

let gameState = {
  phase: "LOBBY",
  users: [],
  mapVotes: {},
  userMapVotes: {},
  selectedMap: null,
  mode: "STANDARD",
  bans: [],
  picks: {},
  funPicks: {},
  completedFunPicks: [],
  // Logic Turn mới: Sử dụng Queue
  turnIndex: 0,
  turnQueue: [], // Mảng chứa các object { team: 'defend'/'attack', action: 'BAN'/'PICK', memberIndex: 0/1/2... }
};

function generateTurnQueue(defendCount, attackCount, mode) {
  let queue = [];

  if (mode === "STANDARD") {
    // SỐ LƯỢT BAN MỖI ĐỘI (Ví dụ: 3)
    const BAN_LIMIT = 3;

    for (let i = 0; i < BAN_LIMIT; i++) {
      // Dùng toán tử % để xoay vòng người cấm
      // Nếu team Defend có người, chia lượt. Nếu không (0 người) thì gán tạm 0 để tránh lỗi NaN
      let defIndex = defendCount > 0 ? i % defendCount : 0;
      let attIndex = attackCount > 0 ? i % attackCount : 0;

      queue.push({ team: "defend", action: "BAN", memberIndex: defIndex });
      queue.push({ team: "attack", action: "BAN", memberIndex: attIndex });
    }

    // Giai đoạn PICK (Giữ nguyên)
    const max = Math.max(defendCount, attackCount);
    for (let i = 0; i < max; i++) {
      if (i < defendCount)
        queue.push({ team: "defend", action: "PICK", memberIndex: i });
      if (i < attackCount)
        queue.push({ team: "attack", action: "PICK", memberIndex: i });
    }
  } else {
    // --- FUN MODE (Chỉ Chọn) ---
    // Mỗi người được 1 lượt để chọn tướng cho đối thủ
    const max = Math.max(defendCount, attackCount);
    for (let i = 0; i < max; i++) {
      if (i < defendCount)
        queue.push({ team: "defend", action: "FUN_PICK", memberIndex: i });
      if (i < attackCount)
        queue.push({ team: "attack", action: "FUN_PICK", memberIndex: i });
    }
  }

  return queue;
}

// Reset toàn bộ
function resetToLobby(forceReload = false) {
  gameState.phase = "LOBBY";
  gameState.bans = [];
  gameState.picks = {};
  gameState.funPicks = {};
  gameState.completedFunPicks = [];
  gameState.mapVotes = {};
  gameState.userMapVotes = {};
  gameState.selectedMap = null;
  gameState.turnIndex = 0;
  gameState.turnQueue = [];

  gameState.users.forEach((u) => {
    u.hero = null;
    u.team = null;
  });

  if (forceReload) {
    io.emit("forceReload"); // Lệnh bắt client F5
  } else {
    io.emit("updateState", gameState);
  }
}

io.on("connection", (socket) => {
  socket.on("join", (name) => {
    // Nếu game đang chạy mà có người mới vào -> Reset để tránh lỗi
    if (gameState.phase !== "LOBBY") {
      resetToLobby(true);
    }
    const user = { id: socket.id, name, team: null, hero: null };
    gameState.users.push(user);
    io.emit("updateState", gameState);
  });

  socket.on("joinTeam", (team) => {
    const user = gameState.users.find((u) => u.id === socket.id);
    if (user) {
      user.team = team;
      user.teamJoinTime = Date.now();
    }
    io.emit("updateState", gameState);
  });

  socket.on("randomizeTeams", () => {
    let users = gameState.users;
    for (let i = users.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [users[i], users[j]] = [users[j], users[i]];
    }
    const mid = Math.ceil(users.length / 2);
    users.forEach((u, index) => {
      u.team = index < mid ? "defend" : "attack";
    });
    io.emit("updateState", gameState);
  });

  socket.on("startMapVote", () => {
    gameState.phase = "MAP_VOTE";
    gameState.mapVotes = {};
    MAP_OPTIONS.forEach((m) => (gameState.mapVotes[m] = 0));
    io.emit("updateState", gameState);
  });

  socket.on("voteMap", (mapName) => {
    if (gameState.mapVotes[mapName] === undefined) return;
    const oldVote = gameState.userMapVotes[socket.id];
    if (oldVote) gameState.mapVotes[oldVote]--;
    gameState.mapVotes[mapName]++;
    gameState.userMapVotes[socket.id] = mapName;
    io.emit("updateState", gameState);
  });

  socket.on("finishMapVote", () => {
    // Xử lý map thắng
    let max = -1;
    let winner = REAL_MAPS[0];
    for (const [map, count] of Object.entries(gameState.mapVotes)) {
      if (count > max) {
        max = count;
        winner = map;
      }
    }
    gameState.selectedMap =
      winner === "Random"
        ? REAL_MAPS[Math.floor(Math.random() * REAL_MAPS.length)]
        : winner;

    // --- KHỞI TẠO TURN QUEUE ---
    const defUsers = gameState.users.filter((u) => u.team === "defend");
    const attUsers = gameState.users.filter((u) => u.team === "attack");

    // Truyền thêm gameState.mode vào
    gameState.turnQueue = generateTurnQueue(
      defUsers.length,
      attUsers.length,
      gameState.mode
    );
    gameState.turnIndex = 0;

    gameState.phase = "BAN_PICK";
    gameState.bans = [];
    gameState.picks = {};
    gameState.funPicks = {};
    gameState.completedFunPicks = [];

    io.emit("updateState", gameState);
  });

  socket.on("selectHero", (data) => {
    let heroName = data;
    let targetId = null;
    if (typeof data === "object") {
      heroName = data.hero;
      targetId = data.targetId;
    }

    const user = gameState.users.find((u) => u.id === socket.id);
    if (!user) return;

    if (gameState.mode === "STANDARD") {
      handleStandardMode(user, heroName);
    } else {
      if (targetId) handleFunMode(user, heroName, targetId);
    }
  });

  function handleStandardMode(user, heroName) {
    const currentTurn = gameState.turnQueue[gameState.turnIndex];
    if (!currentTurn) return; // Hết lượt

    // 1. Kiểm tra đúng Team
    if (user.team !== currentTurn.team) return;

    // 2. Kiểm tra đúng người (Member Index)
    // Lấy danh sách user của team hiện tại
    const teamUsers = gameState.users.filter((u) => u.team === user.team);

    // Nếu người gửi request KHÔNG PHẢI là người được chỉ định trong lượt này -> Chặn
    if (
      !teamUsers[currentTurn.memberIndex] ||
      teamUsers[currentTurn.memberIndex].id !== user.id
    ) {
      return;
    }

    // 3. Xử lý Logic (Code cũ giữ nguyên logic push vào mảng)
    if (currentTurn.action === "BAN") {
      if (!gameState.bans.includes(heroName)) {
        gameState.bans.push(heroName);
        nextTurn();
      }
    } else if (currentTurn.action === "PICK") {
      const isPicked = Object.values(gameState.picks).includes(heroName);
      const isBanned = gameState.bans.includes(heroName);
      if (!isBanned && !isPicked) {
        gameState.picks[user.id] = heroName;
        user.hero = heroName;
        nextTurn();
      }
    }
  }

  function nextTurn() {
    gameState.turnIndex++;
    if (gameState.turnIndex >= gameState.turnQueue.length) {
      // Hết lượt -> Có thể chuyển qua phase Ingame hoặc kết thúc
      // Ở đây mình cứ để im trạng thái cuối
    }
    io.emit("updateState", gameState);
  }

  function handleFunMode(user, heroName, targetId) {
    const currentTurn = gameState.turnQueue[gameState.turnIndex];
    if (!currentTurn) return; // Hết lượt

    // Kiểm tra đúng Team
    if (user.team !== currentTurn.team) return;

    // Kiểm tra đúng người (Member Index)
    const teamUsers = gameState.users.filter((u) => u.team === user.team);
    if (
      !teamUsers[currentTurn.memberIndex] ||
      teamUsers[currentTurn.memberIndex].id !== user.id
    ) {
      return;
    }

    // Logic lưu tướng (Vẫn ẩn trong funPicks, chưa đưa vào user.hero)
    gameState.funPicks[targetId] = heroName;

    // Đánh dấu người này đã chọn xong (để logic client hiển thị)
    if (!gameState.completedFunPicks.includes(user.id)) {
      gameState.completedFunPicks.push(user.id);
    }

    // Chuyển lượt
    nextTurn();
  }

  socket.on("finalizeFunMode", () => {
    gameState.users.forEach((u) => {
      if (gameState.funPicks[u.id]) u.hero = gameState.funPicks[u.id];
    });
    gameState.phase = "RESULT";
    io.emit("updateState", gameState);
  });

  socket.on("reset", () => {
    resetToLobby(false); // Force reload tất cả
  });

  socket.on("setMode", () => {
    gameState.mode = gameState.mode === "STANDARD" ? "FUN" : "STANDARD";
    io.emit("updateState", gameState);
  });

  socket.on("disconnect", () => {
    const wasUser = gameState.users.find((u) => u.id === socket.id);
    gameState.users = gameState.users.filter((u) => u.id !== socket.id);

    // NẾU ĐANG TRONG GAME -> RESET & RELOAD TẤT CẢ
    if (wasUser && gameState.phase !== "LOBBY") {
      console.log(`User ${wasUser.name} disconnected. Force resetting...`);
      resetToLobby(false);
    } else {
      io.emit("updateState", gameState);
    }
  });
});

const PORT = 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
