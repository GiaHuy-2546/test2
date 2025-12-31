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
  turnIndex: 0,
  turnQueue: [],
};

// ... (Hàm generateTurnQueue giữ nguyên không đổi) ...
function generateTurnQueue(defendCount, attackCount, mode) {
  let queue = [];
  if (mode === "STANDARD") {
    const BAN_LIMIT = 3; // Ví dụ 3 lượt ban
    for (let i = 0; i < BAN_LIMIT; i++) {
      let defIndex = defendCount > 0 ? i % defendCount : 0;
      let attIndex = attackCount > 0 ? i % attackCount : 0;
      queue.push({ team: "defend", action: "BAN", memberIndex: defIndex });
      queue.push({ team: "attack", action: "BAN", memberIndex: attIndex });
    }
    const max = Math.max(defendCount, attackCount);
    for (let i = 0; i < max; i++) {
      if (i < defendCount)
        queue.push({ team: "defend", action: "PICK", memberIndex: i });
      if (i < attackCount)
        queue.push({ team: "attack", action: "PICK", memberIndex: i });
    }
  } else {
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
  if (forceReload) io.emit("forceReload");
  else io.emit("updateState", gameState);
}

// --- HÀM XỬ LÝ KẾT THÚC VOTE MAP (Mới) ---
function finalizeMapSelection() {
  // Tìm map có số phiếu cao nhất
  let maxVotes = -1;
  let candidates = []; // Danh sách các map bằng phiếu nhau cao nhất

  for (const [map, count] of Object.entries(gameState.mapVotes)) {
    if (count > maxVotes) {
      maxVotes = count;
      candidates = [map];
    } else if (count === maxVotes) {
      candidates.push(map);
    }
  }

  // Nếu không ai vote hoặc lỗi -> Random toàn bộ
  if (candidates.length === 0) candidates = [...REAL_MAPS];

  // Chọn ngẫu nhiên trong danh sách candidates (Xử lý hòa phiếu)
  let winner = candidates[Math.floor(Math.random() * candidates.length)];

  // Nếu winner là nút "Random" -> Random lại một lần nữa trong REAL_MAPS
  if (winner === "Random") {
    gameState.selectedMap =
      REAL_MAPS[Math.floor(Math.random() * REAL_MAPS.length)];
  } else {
    gameState.selectedMap = winner;
  }

  // --- KHỞI TẠO TURN QUEUE ---
  const defUsers = gameState.users.filter((u) => u.team === "defend");
  const attUsers = gameState.users.filter((u) => u.team === "attack");
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
}

io.on("connection", (socket) => {
  socket.emit("updateState", gameState); // Gửi state ngay khi connect

  socket.on("join", (data) => {
    // Xử lý tương thích ngược nếu client cũ chỉ gửi string
    const name = typeof data === "object" ? data.name : data;
    const token = typeof data === "object" ? data.token : null;

    if (!name || !token) return; // Bắt buộc phải có token (Client mới đã có)

    // 1. Tìm xem tên này đã tồn tại chưa
    const existingUser = gameState.users.find((u) => u.name === name);

    if (existingUser) {
      // A. ĐÃ CÓ TÊN NÀY TRONG DANH SÁCH

      // Kiểm tra Token xem có đúng là chủ nhân không
      if (existingUser.token === token) {
        // -> ĐÚNG CHỦ (Reconnect)
        console.log(`User ${name} reconnected (Device Verified)!`);
        existingUser.id = socket.id; // Cập nhật socket mới
        socket.emit("updateState", gameState);
      } else {
        // -> SAI CHỦ (Người khác cố tình nhập trùng tên)
        console.log(`Blocked duplicate login attempt for name: ${name}`);
        socket.emit(
          "joinError",
          "Tên này đã có người sử dụng! Vui lòng chọn tên khác."
        );
      }
    } else {
      // B. NGƯỜI CHƠI MỚI (Chưa có tên trong list)
      const user = {
        id: socket.id,
        name: name,
        token: token, // Lưu token lại để so sánh lần sau
        team: null,
        hero: null,
      };
      gameState.users.push(user);
      io.emit("updateState", gameState);
    }
  });

  socket.on("joinTeam", (team) => {
    const user = gameState.users.find((u) => u.id === socket.id);
    if (user) {
      user.team = team;
      user.teamJoinTime = Date.now();
    }
    io.emit("updateState", gameState);
  });

  // --- [THÊM MỚI] XỬ LÝ ĐỔI TÊN ---
  socket.on("rename", (newName) => {
    // 1. Tìm người chơi
    const user = gameState.users.find((u) => u.id === socket.id);
    if (!user) return;

    // 2. Kiểm tra trùng tên
    const isNameTaken = gameState.users.find((u) => u.name === newName);
    if (isNameTaken) {
      socket.emit("renameError", "Tên này đã có người sử dụng!");
      return;
    }

    // 3. Đổi tên và báo về
    user.name = newName;
    socket.emit("renameSuccess", newName);
    io.emit("updateState", gameState);
  });

  // --- CÁC HÀM ADMIN GỌI ---
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
    gameState.userMapVotes = {}; // Reset phiếu user
    MAP_OPTIONS.forEach((m) => (gameState.mapVotes[m] = 0));
    io.emit("updateState", gameState);
  });

  socket.on("voteMap", (mapName) => {
    if (gameState.mapVotes[mapName] === undefined) return;

    // Logic vote cũ
    const oldVote = gameState.userMapVotes[socket.id];
    if (oldVote) gameState.mapVotes[oldVote]--;
    gameState.mapVotes[mapName]++;
    gameState.userMapVotes[socket.id] = mapName;

    io.emit("updateState", gameState);

    // --- LOGIC MỚI: Tự động chuyển phase nếu tất cả đã vote ---
    const totalVotedUsers = Object.keys(gameState.userMapVotes).length;
    const totalUsers = gameState.users.length;

    // Nếu tất cả mọi người đã vote -> Chốt luôn
    if (totalUsers > 0 && totalVotedUsers === totalUsers) {
      // Đợi 1 chút (1s) để client kịp nhìn thấy mình vừa vote rồi mới chuyển
      setTimeout(() => {
        // Kiểm tra lại lần nữa phase để tránh conflict
        if (gameState.phase === "MAP_VOTE") finalizeMapSelection();
      }, 1000);
    }
  });

  socket.on("finishMapVote", () => {
    // Admin ép dừng
    finalizeMapSelection();
  });

  // ... (Phần selectHero, nextTurn, handleFunMode giữ nguyên) ...
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
      // --- LOGIC STANDARD ---
      const currentTurn = gameState.turnQueue[gameState.turnIndex];
      if (!currentTurn) return;
      if (user.team !== currentTurn.team) return;

      const teamUsers = gameState.users.filter((u) => u.team === user.team);
      if (
        !teamUsers[currentTurn.memberIndex] ||
        teamUsers[currentTurn.memberIndex].id !== user.id
      )
        return;

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
    } else {
      // --- LOGIC FUN ---
      const currentTurn = gameState.turnQueue[gameState.turnIndex];
      if (!currentTurn) return;
      if (user.team !== currentTurn.team) return;

      const teamUsers = gameState.users.filter((u) => u.team === user.team);
      if (
        !teamUsers[currentTurn.memberIndex] ||
        teamUsers[currentTurn.memberIndex].id !== user.id
      )
        return;

      gameState.funPicks[targetId] = heroName;
      if (!gameState.completedFunPicks.includes(user.id)) {
        gameState.completedFunPicks.push(user.id);
      }
      nextTurn();
    }
  });

  function nextTurn() {
    gameState.turnIndex++;
    io.emit("updateState", gameState);
  }

  socket.on("finalizeFunMode", () => {
    gameState.users.forEach((u) => {
      if (gameState.funPicks[u.id]) u.hero = gameState.funPicks[u.id];
    });
    gameState.phase = "RESULT";
    io.emit("updateState", gameState);
  });

  socket.on("reset", () => {
    resetToLobby(false);
  });

  socket.on("setMode", () => {
    gameState.mode = gameState.mode === "STANDARD" ? "FUN" : "STANDARD";
    io.emit("updateState", gameState);
  });

  socket.on("disconnect", () => {
    const user = gameState.users.find((u) => u.id === socket.id);
    if (user) {
      console.log(`User ${user.name} disconnected (Waiting for reconnect...)`);
      // QUAN TRỌNG: Không dòng code xóa user ở đây (gameState.users = filter...)
      // Chúng ta giữ nguyên user trong mảng để họ quay lại.
    }
    // Không cần emit updateState nếu không muốn giao diện bị nháy
  });
});

const PORT = 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`http://localhost:3000/?admin=true`);
});
