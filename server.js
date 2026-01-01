const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

// --- DATA ---
// Cần danh sách có Role ở Server để tính toán logic ưu tiên
const HERO_DATA = [
  { name: "Astra", role: "Controller" },
  { name: "Brimstone", role: "Controller" },
  { name: "Clove", role: "Controller" },
  { name: "Harbor", role: "Controller" },
  { name: "Omen", role: "Controller" },
  { name: "Viper", role: "Controller" },
  { name: "Iso", role: "Duelist" },
  { name: "Jett", role: "Duelist" },
  { name: "Neon", role: "Duelist" },
  { name: "Phoenix", role: "Duelist" },
  { name: "Raze", role: "Duelist" },
  { name: "Reyna", role: "Duelist" },
  { name: "Yoru", role: "Duelist" },
  { name: "Waylay", role: "Duelist" },
  { name: "Breach", role: "Initiator" },
  { name: "Fade", role: "Initiator" },
  { name: "Gekko", role: "Initiator" },
  { name: "KayO", role: "Initiator" },
  { name: "Skye", role: "Initiator" },
  { name: "Sova", role: "Initiator" },
  { name: "Tejo", role: "Initiator" },
  { name: "Chamber", role: "Sentinel" },
  { name: "Cypher", role: "Sentinel" },
  { name: "Deadlock", role: "Sentinel" },
  { name: "Killjoy", role: "Sentinel" },
  { name: "Sage", role: "Sentinel" },
  { name: "Vise", role: "Sentinel" },
  { name: "Veto", role: "Sentinel" },
];
const HERO_NAMES = HERO_DATA.map((h) => h.name);

// --- STATE ---
let gameState = {
  users: [],
  phase: "LOBBY", // LOBBY, MAP_VOTE, BAN_PICK, RESULT
  mode: "STANDARD", // STANDARD, RANDOM_DRAFT (Mới)
  mapVotes: {},
  selectedMap: "Ascent",
  turnQueue: [], // { team: 'attack'|'defend', memberIndex: 0, action: 'BAN'|'PICK' }
  turnIndex: 0,
  bans: [],
  picks: {}, // { userId: heroName }
  funPicks: {}, // { targetId: heroName } cho chế độ cũ (nếu giữ)

  // State cho chế độ RANDOM_DRAFT
  draftOptions: {}, // { userId: [HeroA, HeroB] }
  rerollsUsed: {}, // { userId: true/false }
};

// Cấu hình đội hình chuẩn
const COMP_TARGET = {
  Duelist: 2,
  Sentinel: 1,
  Controller: 1,
  Initiator: 1,
};

// --- HELPER FUNCTIONS ---

function getMissingRoles(teamName) {
  // Lấy danh sách tướng team đã pick
  const teamUsers = gameState.users.filter((u) => u.team === teamName);
  const currentRoles = { Duelist: 0, Sentinel: 0, Controller: 0, Initiator: 0 };

  teamUsers.forEach((u) => {
    const heroName = gameState.picks[u.id];
    if (heroName) {
      const h = HERO_DATA.find((x) => x.name === heroName);
      if (h && currentRoles[h.role] !== undefined) {
        currentRoles[h.role]++;
      }
    }
  });

  // Tìm role còn thiếu so với Target
  const missing = [];
  for (const [role, count] of Object.entries(COMP_TARGET)) {
    if (currentRoles[role] < count) {
      missing.push(role);
    }
  }
  return missing;
}

function generateDraftOptions(userId, existingOptions = []) {
  const user = gameState.users.find((u) => u.id === userId);
  if (!user) return ["Jett", "Reyna"]; // Fallback

  const picked = Object.values(gameState.picks);
  const banned = gameState.bans;
  const currentOptionsNames = existingOptions; // Những con đang hiện trên màn hình (để tránh random trùng lại)

  // Pool khả dụng: Không bị Ban, không bị Pick, không nằm trong option hiện tại
  let available = HERO_DATA.filter(
    (h) =>
      !picked.includes(h.name) &&
      !banned.includes(h.name) &&
      !currentOptionsNames.includes(h.name)
  );

  const missingRoles = getMissingRoles(user.team);

  // Chia pool thành 2 nhóm: Ưu tiên (Role thiếu) và Còn lại
  const highPriority = available.filter((h) => missingRoles.includes(h.role));
  const lowPriority = available.filter((h) => !missingRoles.includes(h.role));

  function pickRandom(count) {
    const result = [];
    for (let i = 0; i < count; i++) {
      // Ưu tiên lấy High Priority trước
      if (highPriority.length > 0) {
        const idx = Math.floor(Math.random() * highPriority.length);
        result.push(highPriority[idx].name);
        highPriority.splice(idx, 1);
      } else if (lowPriority.length > 0) {
        const idx = Math.floor(Math.random() * lowPriority.length);
        result.push(lowPriority[idx].name);
        lowPriority.splice(idx, 1);
      }
    }
    return result;
  }

  return pickRandom(existingOptions.length === 1 ? 1 : 2); // Nếu cần 1 thì lấy 1, cần 2 lấy 2
}

function generateTurnQueue() {
  const attack = gameState.users.filter((u) => u.team === "attack");
  const defend = gameState.users.filter((u) => u.team === "defend");
  const queue = [];

  // PHASE 1: BAN (Giống nhau cho cả 2 chế độ)
  // Mỗi team ban 1 lượt xen kẽ (giả sử leader hoặc random người ban)
  // Ở đây giữ logic cũ: Ai cũng có thể click Ban nếu đến lượt team?
  // Để đơn giản, code cũ hình như không chia lượt Ban cụ thể cho từng người,
  // mà chia lượt cho TEAM. Nhưng turnQueue cần memberIndex.
  // Ta sẽ cho người đầu tiên của mỗi team đại diện Ban.

  if (attack.length > 0)
    queue.push({ team: "attack", memberIndex: 0, action: "BAN" });
  if (defend.length > 0)
    queue.push({ team: "defend", memberIndex: 0, action: "BAN" });
  if (attack.length > 0)
    queue.push({ team: "attack", memberIndex: 0, action: "BAN" });
  if (defend.length > 0)
    queue.push({ team: "defend", memberIndex: 0, action: "BAN" });

  // PHASE 2: PICK
  const maxLen = Math.max(attack.length, defend.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < attack.length)
      queue.push({ team: "attack", memberIndex: i, action: "PICK" });
    if (i < defend.length)
      queue.push({ team: "defend", memberIndex: i, action: "PICK" });
  }
  return queue;
}

function checkTurn() {
  const turn = gameState.turnQueue[gameState.turnIndex];
  if (!turn) {
    gameState.phase = "RESULT";
    io.emit("updateState", gameState);
    return;
  }

  // Nếu là chế độ RANDOM_DRAFT và là lượt PICK -> Sinh trước 2 options cho người chơi
  if (gameState.mode === "RANDOM_DRAFT" && turn.action === "PICK") {
    const teamUsers = gameState.users.filter((u) => u.team === turn.team);
    const user = teamUsers[turn.memberIndex];
    if (user && !gameState.draftOptions[user.id]) {
      gameState.draftOptions[user.id] = generateDraftOptions(user.id); // Sinh 2 con
    }
  }
}

// --- SOCKET ---
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join", ({ name, token }) => {
    // Reconnect logic
    const existing = gameState.users.find((u) => u.token === token);
    if (existing) {
      existing.id = socket.id;
      existing.name = name;
      existing.active = true;
    } else {
      gameState.users.push({
        id: socket.id,
        token: token,
        name: name,
        team: null,
        hero: null,
        active: true,
      });
    }
    socket.emit("updateState", gameState);
    io.emit("updateState", gameState);
  });

  socket.on("joinTeam", (team) => {
    const user = gameState.users.find((u) => u.id === socket.id);
    if (user && gameState.phase === "LOBBY") {
      user.team = team;
      user.teamJoinTime = Date.now();
      io.emit("updateState", gameState);
    }
  });

  socket.on("rename", (newName) => {
    const user = gameState.users.find((u) => u.id === socket.id);
    if (user) {
      user.name = newName;
      io.emit("updateState", gameState);
      socket.emit("renameSuccess", newName);
    }
  });

  // --- ADMIN TOOLS ---
  socket.on("setMode", () => {
    // Toggle giữa STANDARD và RANDOM_DRAFT
    gameState.mode =
      gameState.mode === "STANDARD" ? "RANDOM_DRAFT" : "STANDARD";
    io.emit("updateState", gameState);
  });

  socket.on("randomizeTeams", () => {
    const users = gameState.users.filter((u) => u.team);
    // Shuffle
    for (let i = users.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [users[i], users[j]] = [users[j], users[i]];
    }
    const mid = Math.ceil(users.length / 2);
    users.forEach((u, idx) => {
      u.team = idx < mid ? "attack" : "defend";
    });
    io.emit("updateState", gameState);
  });

  socket.on("startMapVote", () => {
    gameState.phase = "MAP_VOTE";
    gameState.mapVotes = {
      Ascent: 0,
      Bind: 0,
      Haven: 0,
      Split: 0,
      Icebox: 0,
      Breeze: 0,
      Fracture: 0,
      Pearl: 0,
      Lotus: 0,
      Sunset: 0,
      Abyss: 0,
    };
    io.emit("updateState", gameState);
  });

  socket.on("voteMap", (mapName) => {
    if (
      gameState.phase === "MAP_VOTE" &&
      gameState.mapVotes[mapName] !== undefined
    ) {
      gameState.mapVotes[mapName]++;
      io.emit("updateState", gameState);
    }
  });

  socket.on("finishMapVote", () => {
    let max = -1;
    let selected = "Ascent";
    for (const [m, c] of Object.entries(gameState.mapVotes)) {
      if (c > max) {
        max = c;
        selected = m;
      }
    }
    gameState.selectedMap = selected;
    gameState.phase = "BAN_PICK";
    gameState.turnQueue = generateTurnQueue();
    gameState.turnIndex = 0;
    gameState.bans = [];
    gameState.picks = {};
    gameState.draftOptions = {};
    gameState.rerollsUsed = {};

    checkTurn();
    io.emit("updateState", gameState);
  });

  // --- GAME LOGIC ---

  // Logic Reroll (Chỉ cho RANDOM_DRAFT)
  socket.on("rerollDraft", (slotIndex) => {
    // slotIndex: 0 hoặc 1 (con muốn đổi)
    if (gameState.mode !== "RANDOM_DRAFT") return;

    const turn = gameState.turnQueue[gameState.turnIndex];
    if (!turn || turn.action !== "PICK") return;

    // Check đúng lượt
    const teamUsers = gameState.users.filter((u) => u.team === turn.team);
    const activeUser = teamUsers[turn.memberIndex];

    if (activeUser && activeUser.id === socket.id) {
      // Check đã reroll chưa
      if (gameState.rerollsUsed[socket.id]) return;

      const currentOpts = gameState.draftOptions[socket.id];
      if (!currentOpts || currentOpts.length < 2) return;

      // Logic: Giữ con không bị chọn, random con mới thay thế con kia
      const keepHero = currentOpts[slotIndex === 0 ? 1 : 0]; // Nếu đổi 0 thì giữ 1
      const newHeroArr = generateDraftOptions(socket.id, [keepHero]); // Truyền keepHero vào để hàm biết nó đang tồn tại

      // newHeroArr sẽ trả về 1 con mới
      if (newHeroArr.length > 0) {
        const finalOpts =
          slotIndex === 0
            ? [newHeroArr[0], keepHero]
            : [keepHero, newHeroArr[0]];
        gameState.draftOptions[socket.id] = finalOpts;
        gameState.rerollsUsed[socket.id] = true;
        io.emit("updateState", gameState);
      }
    }
  });

  socket.on("selectHero", (data) => {
    // data có thể là string (tên Hero - STANDARD)
    // hoặc object { hero: name, targetId: id } (FUN MODE cũ)
    // Với RANDOM_DRAFT, data là tên Hero chọn từ Option

    const turn = gameState.turnQueue[gameState.turnIndex];
    if (!turn) return;

    let heroName = typeof data === "string" ? data : data.hero;

    // Check user hiện tại
    const teamUsers = gameState.users.filter((u) => u.team === turn.team);
    const activeUser = teamUsers[turn.memberIndex];

    if (!activeUser || activeUser.id !== socket.id) return;

    if (turn.action === "BAN") {
      if (!gameState.bans.includes(heroName)) {
        gameState.bans.push(heroName);
        gameState.turnIndex++;
        checkTurn();
        io.emit("updateState", gameState);
      }
    } else if (turn.action === "PICK") {
      // Validate
      if (gameState.mode === "STANDARD") {
        if (
          !gameState.bans.includes(heroName) &&
          !Object.values(gameState.picks).includes(heroName)
        ) {
          gameState.picks[socket.id] = heroName;
          gameState.turnIndex++;
          checkTurn();
          io.emit("updateState", gameState);
        }
      } else if (gameState.mode === "RANDOM_DRAFT") {
        const opts = gameState.draftOptions[socket.id];
        if (opts && opts.includes(heroName)) {
          gameState.picks[socket.id] = heroName;
          gameState.turnIndex++;
          checkTurn();
          io.emit("updateState", gameState);
        }
      }
    }
  });

  socket.on("reset", () => {
    gameState.phase = "LOBBY";
    gameState.bans = [];
    gameState.picks = {};
    gameState.mapVotes = {};
    gameState.turnQueue = [];
    gameState.turnIndex = 0;
    gameState.draftOptions = {};
    gameState.rerollsUsed = {};
    io.emit("updateState", gameState);
  });

  socket.on("disconnect", () => {
    const u = gameState.users.find((u) => u.id === socket.id);
    if (u) {
      u.active = false;
      // setTimeout(() => {
      //   gameState.users = gameState.users.filter(x => x.id !== socket.id);
      //   io.emit('updateState', gameState);
      // }, 5000);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
