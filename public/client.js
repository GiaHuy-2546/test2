const socket = io();
let myId = null;
let currentGameState = null;
let selectedHeroTemp = null;
let myTeam = null;

const HEROES = [
  "Jett",
  "Reyna",
  "Omen",
  "Sova",
  "Sage",
  "Phoenix",
  "Killjoy",
  "Cypher",
  "Brimstone",
  "Viper",
  "Raze",
  "Breach",
  "Skye",
  "Yoru",
  "Astra",
  "KayO",
  "Chamber",
  "Neon",
  "Fade",
  "Harbor",
  "Gekko",
  "Deadlock",
  "Iso",
  "Clove",
  "Veto",
  "Vise",
  "Waylay",
  "Tejo",
];

const fileCache = {};
function getImageUrl(folder, name, callback) {
  if (!name) return;
  const cacheKey = `${folder}/${name}`;
  if (fileCache[cacheKey]) {
    callback(`/images/${folder}/${name}.${fileCache[cacheKey]}`);
    return;
  }
  const imgPng = new Image();
  imgPng.src = `/images/${folder}/${name}.png`;
  imgPng.onload = () => {
    fileCache[cacheKey] = "png";
    callback(imgPng.src);
  };
  imgPng.onerror = () => {
    const imgJpg = new Image();
    imgJpg.src = `/images/${folder}/${name}.jpg`;
    imgJpg.onload = () => {
      fileCache[cacheKey] = "jpg";
      callback(imgJpg.src);
    };
    imgJpg.onerror = () => {
      callback(`/images/${folder}/${name}.jpeg`);
    };
  };
}

function setElementBg(element, folder, name) {
  getImageUrl(folder, name, (url) => {
    element.style.backgroundImage = `url('${url}')`;
  });
}

// --- SOCKET EVENTS ---
socket.on("connect", () => {
  myId = socket.id;
});

socket.on("updateState", (state) => {
  currentGameState = state;
  renderApp(state);
});

// Lệnh bắt buộc reload trang (Dùng khi reset)
socket.on("forceReload", () => {
  window.location.reload();
});

function joinGame() {
  const name = document.getElementById("username").value;
  if (name) {
    socket.emit("join", name);
    document.getElementById("login-screen").classList.add("hidden");
  }
}
function joinTeam(t) {
  socket.emit("joinTeam", t);
}
function randomize() {
  socket.emit("randomizeTeams");
}
function startMapVote() {
  socket.emit("startMapVote");
}
function finishMapVote() {
  socket.emit("finishMapVote");
}
function finalizeFun() {
  socket.emit("finalizeFunMode");
}
function resetGame() {
  socket.emit("reset");
} // Nút reset chủ động
function toggleMode() {
  socket.emit("setMode");
}

function renderApp(state) {
  ["login-screen", "lobby-screen", "vote-screen", "game-screen"].forEach(
    (id) => {
      document.getElementById(id).classList.add("hidden");
    }
  );
  if (!myId) {
    document.getElementById("login-screen").classList.remove("hidden");
    return;
  }

  if (state.phase === "LOBBY") {
    // Reset background về mặc định nếu đang ở Lobby
    selectedHeroTemp = null;
    document.body.style.backgroundImage = `url("https://media.valorant-api.com/maps/2bee0dc9-4ffe-519b-1cbd-7fbe763a6047/splash.png")`;

    document.getElementById("lobby-screen").classList.remove("hidden");
    document.getElementById("mode-btn").innerText = "MODE: " + state.mode;
    renderLobby(state.users);
  } else if (state.phase === "MAP_VOTE") {
    document.getElementById("vote-screen").classList.remove("hidden");
    renderMapVote(state.mapVotes);
  } else if (state.phase === "BAN_PICK" || state.phase === "RESULT") {
    document.getElementById("game-screen").classList.remove("hidden");
    renderGame(state);
  }
}

function renderLobby(users) {
  const dList = document.getElementById("defend-list");
  const aList = document.getElementById("attack-list");
  dList.innerHTML = "";
  aList.innerHTML = "";

  // --- THÊM ĐOẠN NÀY: Tạo bản sao và sắp xếp theo thời gian Join ---
  // Logic: Ai có teamJoinTime nhỏ (bấm trước) xếp trước, lớn (bấm sau) xếp sau
  const sortedUsers = [...users].sort((a, b) => {
    const timeA = a.teamJoinTime || 0;
    const timeB = b.teamJoinTime || 0;
    return timeA - timeB;
  });
  // ------------------------------------------------------------------

  // Sửa vòng lặp bên dưới để dùng 'sortedUsers' thay vì 'users'
  sortedUsers.forEach((u) => {
    const li = document.createElement("li");
    li.innerText = u.name;
    if (u.team === "defend") dList.appendChild(li);
    else if (u.team === "attack") aList.appendChild(li);
  });
}

function renderMapVote(votes) {
  const container = document.getElementById("map-list");
  container.innerHTML = "";
  for (const [map, count] of Object.entries(votes)) {
    const div = document.createElement("div");
    div.className = "map-card";
    setElementBg(div, "maps", map);
    div.innerHTML = `<span>${map}: ${count}</span>`;
    div.onclick = () => socket.emit("voteMap", map);
    container.appendChild(div);
  }
}

function renderGame(state) {
  document.getElementById("map-name").innerText = state.selectedMap;
  const info = document.getElementById("phase-info");
  const heroGridContainer = document.getElementById("hero-grid");
  const finalizeBtn = document.getElementById("finalize-btn");
  const lockBtn = document.getElementById("lock-in-btn");

  const me = state.users.find((u) => u.id === myId);
  myTeam = me ? me.team : null;
  let isMyTurn = false;
  let actionText = "WAITING...";

  // Ẩn mặc định các nút
  finalizeBtn.classList.add("hidden");
  lockBtn.classList.add("hidden");

  // --- LOGIC TÍNH TOÁN LƯỢT (Dùng chung cho cả Standard và Fun) ---
  const turn = state.turnQueue[state.turnIndex];

  if (turn) {
    // Vẫn còn lượt đi -> Đang trong quá trình Ban/Pick
    const turnTeamUsers = state.users.filter((u) => u.team === turn.team);
    const activeUser = turnTeamUsers[turn.memberIndex];
    const activeName = activeUser ? activeUser.name : "...";

    // Xác định Text hiển thị
    if (state.mode === "STANDARD") {
      actionText = `${turn.team.toUpperCase()} - ${
        turn.action
      } (${activeName})`;
    } else {
      // Fun Mode
      actionText = `GÁN TƯỚNG CHO ĐỐI THỦ (${activeName})`;
    }

    // Kiểm tra có phải lượt của mình không
    if (activeUser && activeUser.id === myId) {
      isMyTurn = true;
      actionText += " (BẠN)";
    }

    info.innerText = `LƯỢT: ${actionText}`;
    info.style.color =
      turn.team === "attack" ? "var(--red)" : "var(--defend-color)";

    // Hiện nút Lock (Standard) HOẶC Grid (Fun) nếu đúng lượt
    if (isMyTurn) {
      if (state.mode === "STANDARD" && selectedHeroTemp) {
        lockBtn.classList.remove("hidden");
        lockBtn.innerText = turn.action === "BAN" ? "CẤM NGAY" : "KHOÁ CHỌN";
        lockBtn.className =
          turn.action === "BAN"
            ? "btn-warning lock-btn"
            : "btn-primary lock-btn";
      }
      // Fun mode không dùng nút Lock, mà click vào tướng -> chọn đối thủ -> xong luôn
    }
  } else {
    // HẾT LƯỢT (Queue đã chạy hết)
    if (state.mode === "STANDARD") {
      info.innerText = "HOÀN TẤT";
    } else {
      // FUN MODE: Hết lượt chọn -> Hiện nút Công Bố
      info.innerText = "CHỜ CÔNG BỐ KẾT QUẢ...";
      if (state.phase !== "RESULT") {
        finalizeBtn.classList.remove("hidden"); // Hiện nút công bố
      } else {
        info.innerText = "KẾT QUẢ";
      }
    }
  }

  // --- ẨN/HIỆN DANH SÁCH TƯỚNG ---
  if (state.phase === "RESULT") {
    heroGridContainer.classList.add("hidden");
  } else {
    // Chỉ hiện Grid khi ĐẾN LƯỢT MÌNH (áp dụng cả 2 mode)
    if (isMyTurn) {
      heroGridContainer.classList.remove("hidden");
      renderHeroGrid(state, isMyTurn);
    } else {
      heroGridContainer.classList.add("hidden");
      // Có thể hiển thị thông báo chờ
      heroGridContainer.innerHTML = `<div class="waiting-message">VUI LÒNG CHỜ NGƯỜI KHÁC...</div>`;
    }
  }

  // ... (Phần render background, ban list, team side giữ nguyên như code trước) ...
  // Lưu ý: Phần renderTeamSide vẫn dùng logic highlight khung đã làm ở bước trước
  if (state.picks[myId]) {
    getImageUrl("agents", state.picks[myId], (url) => {
      document.body.style.backgroundImage = `url('${url}')`;
      document.body.style.backgroundPosition = "center top";
      document.body.style.backgroundRepeat = "no-repeat";
      document.body.style.backgroundSize = "cover";
    });
  }

  // Render Ban List (Giữ nguyên)
  const leftBan = document.getElementById("ban-list-left");
  const rightBan = document.getElementById("ban-list-right");
  leftBan.innerHTML = "";
  rightBan.innerHTML = "";
  state.bans.forEach((hero, index) => {
    const div = document.createElement("div");
    div.className = "ban-slot";
    setElementBg(div, "agents", hero);
    if (index % 2 === 0) leftBan.appendChild(div);
    else rightBan.appendChild(div);
  });

  // Render Team (Giữ nguyên logic cũ)
  renderTeamSide("defend", state, state.turnQueue[state.turnIndex]);
  renderTeamSide("attack", state, state.turnQueue[state.turnIndex]);
}

function renderTeamSide(team, state, currentTurn) {
  const container = document.getElementById(`${team}-display`);
  container.innerHTML = "";
  const teamUsers = state.users.filter((u) => u.team === team);

  teamUsers.forEach((u, index) => {
    const div = document.createElement("div");
    div.className = "player-card";

    // LOGIC HIGHLIGHT:
    // Kiểm tra nếu đúng team VÀ đúng vị trí index (memberIndex)
    if (
      state.mode === "STANDARD" &&
      currentTurn &&
      currentTurn.team === team &&
      currentTurn.memberIndex === index // So sánh chính xác index người chơi
    ) {
      div.classList.add("picking-active"); // Class này đã có trong CSS của bạn
    } else {
      div.classList.remove("picking-active");
    }

    // ... (Phần hiển thị Hero/Tên giữ nguyên như cũ)
    let heroDisplay = "";
    if (state.mode === "STANDARD") {
      if (state.picks[u.id]) heroDisplay = state.picks[u.id];
    } else {
      if (state.phase === "RESULT") heroDisplay = u.hero;
      else if (state.funPicks[u.id]) heroDisplay = "LOCKED";
    }

    if (heroDisplay && heroDisplay !== "LOCKED") {
      setElementBg(div, "agents", heroDisplay);
      div.style.backgroundColor = "transparent";
    } else if (heroDisplay === "LOCKED") {
      div.style.backgroundColor = "#111";
    }

    div.innerHTML = `<div class="player-info"><span>${u.name}</span></div>`;
    container.appendChild(div);
  });
}

function renderHeroGrid(state, isMyTurn) {
  const grid = document.getElementById("hero-grid");
  grid.innerHTML = "";

  HEROES.forEach((hero) => {
    const div = document.createElement("div");
    div.className = "hero-select-item";
    setElementBg(div, "agents", hero);
    div.innerHTML = `<div class="hero-name-label">${hero}</div>`;

    const isBanned = state.bans.includes(hero);
    const isPicked = Object.values(state.picks).includes(hero);

    if (state.mode === "STANDARD" && (isBanned || isPicked)) {
      div.classList.add("disabled");
    }

    if (selectedHeroTemp === hero) div.classList.add("selected");

    if (isMyTurn && !div.classList.contains("disabled")) {
      div.onclick = () => {
        selectedHeroTemp = hero;
        if (state.mode === "STANDARD") renderGame(state);
        else showEnemySelector(hero, state);
      };
    }
    grid.appendChild(div);
  });
}

function confirmStandardSelection() {
  if (selectedHeroTemp) {
    socket.emit("selectHero", selectedHeroTemp);
    selectedHeroTemp = null;
  }
}

function showEnemySelector(hero, state) {
  const modal = document.getElementById("enemy-selector-modal");
  const list = document.getElementById("enemy-list");
  list.innerHTML = "";
  const enemies = state.users.filter((u) => u.team !== myTeam);

  enemies.forEach((enemy) => {
    const btn = document.createElement("div");
    btn.className = "enemy-btn";
    const isAssigned = state.funPicks[enemy.id];
    if (isAssigned) {
      btn.innerText = `${enemy.name} (Đã có)`;
      btn.style.opacity = "0.5";
      btn.style.pointerEvents = "none";
    } else {
      btn.innerText = `Gán cho: ${enemy.name}`;
      btn.onclick = () => {
        socket.emit("selectHero", { hero: hero, targetId: enemy.id });
        closeEnemyModal();
        selectedHeroTemp = null;
      };
    }
    list.appendChild(btn);
  });
  modal.classList.remove("hidden");
}

function closeEnemyModal() {
  document.getElementById("enemy-selector-modal").classList.add("hidden");
  selectedHeroTemp = null;
  if (currentGameState) renderGame(currentGameState);
}
