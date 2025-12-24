const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

// --- DANH SÁCH MAP ---
// "Random" là lựa chọn đặc biệt
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

  // Logic Vote Map Mới
  mapVotes: {}, // {MapName: số_lượng_vote}
  userMapVotes: {}, // {SocketID: 'MapName'} -> Để biết user đang vote map nào
  selectedMap: null,

  mode: "STANDARD",
  bans: [],
  picks: {},
  turn: { team: "defend", action: "BAN", count: 0 },
  funPicks: {},
};

io.on("connection", (socket) => {
  // 1. Join
  socket.on("join", (name) => {
    const user = { id: socket.id, name, team: null, hero: null };
    gameState.users.push(user);
    io.emit("updateState", gameState);
  });

  // 2. Join Team
  socket.on("joinTeam", (team) => {
    const user = gameState.users.find((u) => u.id === socket.id);
    if (user) user.team = team;
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

  // 3. Map Vote (LOGIC MỚI: CHO PHÉP ĐỔI VOTE)
  socket.on("startMapVote", () => {
    gameState.phase = "MAP_VOTE";
    gameState.mapVotes = {};
    gameState.userMapVotes = {}; // Reset ai vote gì
    MAP_OPTIONS.forEach((m) => (gameState.mapVotes[m] = 0));
    io.emit("updateState", gameState);
  });

  socket.on("voteMap", (mapName) => {
    if (gameState.mapVotes[mapName] === undefined) return;

    // Nếu user đã vote trước đó -> Trừ vote cũ đi
    const oldVote = gameState.userMapVotes[socket.id];
    if (oldVote) {
      gameState.mapVotes[oldVote]--;
    }

    // Cộng vote mới
    gameState.mapVotes[mapName]++;
    gameState.userMapVotes[socket.id] = mapName; // Lưu lại lựa chọn mới

    io.emit("updateState", gameState);
  });

  socket.on("finishMapVote", () => {
    let max = -1;
    let winner = REAL_MAPS[0];

    // Tìm map thắng cử
    for (const [map, count] of Object.entries(gameState.mapVotes)) {
      if (count > max) {
        max = count;
        winner = map;
      } else if (count === max) {
        // Nếu bằng phiếu thì random giữa các map bằng phiếu (hoặc ưu tiên cái nào cũng đc)
      }
    }

    // Xử lý nếu winner là "Random" -> Chọn 1 map thật
    if (winner === "Random") {
      const randomIndex = Math.floor(Math.random() * REAL_MAPS.length);
      gameState.selectedMap = REAL_MAPS[randomIndex];
    } else {
      gameState.selectedMap = winner;
    }

    gameState.phase = "BAN_PICK";
    // Reset data game
    gameState.bans = [];
    gameState.picks = {};
    gameState.funPicks = {};
    gameState.turn = { team: "defend", action: "BAN", count: 0 };
    io.emit("updateState", gameState);
  });

  // 4. Ban/Pick
  socket.on("selectHero", (heroName) => {
    const user = gameState.users.find((u) => u.id === socket.id);
    if (!user) return;

    if (gameState.mode === "STANDARD") {
      handleStandardMode(user, heroName);
    } else {
      handleFunMode(user, heroName);
    }
  });

  function handleStandardMode(user, heroName) {
    const { team, action } = gameState.turn;
    if (action === "BAN" && user.team === team) {
      if (!gameState.bans.includes(heroName)) {
        gameState.bans.push(heroName);
        gameState.turn.count++;
        gameState.turn.team = team === "defend" ? "attack" : "defend";
        if (gameState.turn.count >= 6) {
          // Tổng 6 lượt ban
          gameState.turn.action = "PICK";
          gameState.turn.count = 0;
          gameState.turn.team = "defend";
        }
        io.emit("updateState", gameState);
      }
    } else if (action === "PICK" && user.team === team) {
      const isPicked = Object.values(gameState.picks).includes(heroName);
      const isBanned = gameState.bans.includes(heroName);
      if (!isBanned && !isPicked) {
        gameState.picks[user.id] = heroName;
        user.hero = heroName;
        gameState.turn.team = team === "defend" ? "attack" : "defend";
        io.emit("updateState", gameState);
      }
    }
  }

  function handleFunMode(user, heroName) {
    gameState.funPicks[user.id] = heroName;
    io.emit("updateState", gameState);
  }

  socket.on("finalizeFunMode", () => {
    const defendUsers = gameState.users.filter((u) => u.team === "defend");
    const attackUsers = gameState.users.filter((u) => u.team === "attack");
    const defendPicks = defendUsers
      .map((u) => gameState.funPicks[u.id])
      .filter((x) => x);
    const attackPicks = attackUsers
      .map((u) => gameState.funPicks[u.id])
      .filter((x) => x);

    const shuffle = (arr) => arr.sort(() => Math.random() - 0.5);
    const shuffledDefPicks = shuffle([...defendPicks]);
    const shuffledAttPicks = shuffle([...attackPicks]);

    attackUsers.forEach((u, i) => {
      if (shuffledDefPicks[i]) u.hero = shuffledDefPicks[i];
    });
    defendUsers.forEach((u, i) => {
      if (shuffledAttPicks[i]) u.hero = shuffledAttPicks[i];
    });

    gameState.phase = "RESULT";
    io.emit("updateState", gameState);
  });

  socket.on("reset", () => {
    gameState.phase = "LOBBY";
    gameState.users.forEach((u) => {
      u.hero = null;
      u.team = null;
    });
    gameState.bans = [];
    gameState.picks = {};
    gameState.userMapVotes = {};
    io.emit("updateState", gameState);
  });

  socket.on("setMode", () => {
    gameState.mode = gameState.mode === "STANDARD" ? "FUN" : "STANDARD";
    io.emit("updateState", gameState);
  });

  socket.on("disconnect", () => {
    gameState.users = gameState.users.filter((u) => u.id !== socket.id);
    io.emit("updateState", gameState);
  });
});

const PORT = 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server chạy tại http://localhost:${PORT}`);
});
