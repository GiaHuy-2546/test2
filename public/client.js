const socket = io();
let myId = null;
let currentGameState = null;
let selectedHeroTemp = null;
let myTeam = null;

// --- TẠO TOKEN ĐỊNH DANH THIẾT BỊ ---
// Token này sẽ đi theo trình duyệt này mãi mãi, không đổi khi F5
let deviceToken = localStorage.getItem("device_token");
if (!deviceToken) {
  deviceToken = "token_" + Math.random().toString(36).substr(2) + Date.now();
  localStorage.setItem("device_token", deviceToken);
}

// Check Admin
const urlParams = new URLSearchParams(window.location.search);
const isAdmin = urlParams.get("admin") === "true";

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

  // Tự động Reconnect với Token
  const savedName = localStorage.getItem("valorant_username");
  if (savedName) {
    console.log("Auto reconnecting as", savedName);
    // Gửi cả tên và token lên server
    socket.emit("join", { name: savedName, token: deviceToken });
    // Tạm ẩn login screen
    document.getElementById("login-screen").classList.add("hidden");
  }
});

socket.on("joinError", (message) => {
  alert(message); // Hiện thông báo lỗi
  document.getElementById("login-screen").classList.remove("hidden"); // Hiện lại bảng nhập tên
  localStorage.removeItem("valorant_username"); // Xóa tên cũ đi để nhập lại
});

socket.on("updateState", (state) => {
  currentGameState = state;
  renderApp(state);
});

socket.on("forceReload", () => {
  window.location.reload();
});

function joinGame() {
  const name = document.getElementById("username").value;
  if (name) {
    localStorage.setItem("valorant_username", name);
    // Gửi object { name, token } thay vì chỉ gửi string name
    socket.emit("join", { name: name, token: deviceToken });
    document.getElementById("login-screen").classList.add("hidden");
  }
}
function joinTeam(t) {
  socket.emit("joinTeam", t);
}
function randomize() {
  if (isAdmin) socket.emit("randomizeTeams");
}
function startMapVote() {
  if (isAdmin) socket.emit("startMapVote");
}
function finishMapVote() {
  if (isAdmin) socket.emit("finishMapVote");
}
function finalizeFun() {
  if (isAdmin) socket.emit("finalizeFunMode");
}
function resetGame() {
  if (isAdmin) socket.emit("reset");
}
function toggleMode() {
  if (isAdmin) socket.emit("setMode");
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

  // Login Check
  const me = state.users.find((u) => u.id === myId);
  if (!me) {
    document.getElementById("login-screen").classList.remove("hidden");
    return;
  }

  // --- ẨN/HIỆN NÚT ADMIN ---
  // Tìm các thành phần chỉ Admin mới được thấy
  const lobbyControls = document.querySelector("#lobby-screen .top-controls");
  const voteControls = document.querySelector("#vote-screen .bottom-bar");
  const gameResetBtn = document.querySelector(
    "#game-screen .btn-outline.danger"
  ); // Nút Reset
  const gameFinalizeBtn = document.getElementById("finalize-btn"); // Nút Công bố

  if (!isAdmin) {
    if (lobbyControls) lobbyControls.classList.add("hidden");
    if (voteControls) voteControls.classList.add("hidden");
    if (gameResetBtn) gameResetBtn.classList.add("hidden");
    // Nút finalizeBtn sẽ được xử lý logic riêng bên dưới
  } else {
    if (lobbyControls) lobbyControls.classList.remove("hidden");
    if (voteControls) voteControls.classList.remove("hidden");
    if (gameResetBtn) gameResetBtn.classList.remove("hidden");
  }

  if (state.phase === "LOBBY") {
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

  const sortedUsers = [...users].sort(
    (a, b) => (a.teamJoinTime || 0) - (b.teamJoinTime || 0)
  );
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

    // Chỉ cho click vote nếu KHÔNG phải admin (Admin chỉ nhìn và bấm chốt)
    // Hoặc nếu bạn muốn Admin cũng được vote thì bỏ if (!isAdmin) đi.
    // Theo yêu cầu của bạn "Giao diện server để trộn team, bắt đầu...", tôi sẽ để Admin click thì không tính vote, hoặc vẫn tính tuỳ bạn.
    // Ở đây tôi cho phép Admin vote luôn nếu muốn test.
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

  // Logic hiển thị nút Finalize (Công bố) - Chỉ Admin mới thấy nút này
  if (
    state.mode !== "STANDARD" &&
    !state.turnQueue[state.turnIndex] &&
    state.phase !== "RESULT"
  ) {
    // Hết lượt Fun mode -> Chờ công bố
    if (isAdmin) finalizeBtn.classList.remove("hidden");
    else finalizeBtn.classList.add("hidden");
  } else {
    finalizeBtn.classList.add("hidden");
  }

  lockBtn.classList.add("hidden");

  const turn = state.turnQueue[state.turnIndex];
  if (turn) {
    const turnTeamUsers = state.users.filter((u) => u.team === turn.team);
    const activeUser = turnTeamUsers[turn.memberIndex];
    const activeName = activeUser ? activeUser.name : "...";

    if (state.mode === "STANDARD") {
      actionText = `${turn.team.toUpperCase()} - ${
        turn.action
      } (${activeName})`;
    } else {
      actionText = `GÁN TƯỚNG CHO ĐỐI THỦ (${activeName})`;
    }

    if (activeUser && activeUser.id === myId) {
      isMyTurn = true;
      actionText += " (BẠN)";
    }
    info.innerText = `LƯỢT: ${actionText}`;
    info.style.color =
      turn.team === "attack" ? "var(--red)" : "var(--defend-color)";

    if (isMyTurn) {
      if (state.mode === "STANDARD" && selectedHeroTemp) {
        lockBtn.classList.remove("hidden");
        lockBtn.innerText = turn.action === "BAN" ? "CẤM NGAY" : "KHOÁ CHỌN";
        lockBtn.className =
          turn.action === "BAN"
            ? "btn-warning lock-btn"
            : "btn-primary lock-btn";
      }
    }
  } else {
    // HẾT LƯỢT
    if (state.mode === "STANDARD") info.innerText = "HOÀN TẤT";
    else {
      info.innerText = state.phase === "RESULT" ? "KẾT QUẢ" : "CHỜ CÔNG BỐ...";
    }
  }

  // --- CHỈNH SỬA: Admin luôn thấy Grid Tướng để quan sát (nhưng không click chọn được cho người khác) ---
  // Hoặc theo yêu cầu "chỉ người chơi mới pick", thì Admin không cần thấy Grid cũng được.
  // Ở đây giữ logic cũ: Chỉ người có lượt mới thấy Grid để chọn.
  if (state.phase === "RESULT") {
    heroGridContainer.classList.add("hidden");
  } else {
    if (isMyTurn) {
      heroGridContainer.classList.remove("hidden");
      renderHeroGrid(state, isMyTurn);
    } else {
      heroGridContainer.classList.add("hidden");
      // Nếu là Admin, có thể hiện grid dạng view-only nếu muốn, nhưng hiện tại cứ ẩn cho gọn
      heroGridContainer.innerHTML = `<div class="waiting-message">VUI LÒNG CHỜ...</div>`;
    }
  }

  if (state.picks[myId]) {
    getImageUrl("agents", state.picks[myId], (url) => {
      document.body.style.backgroundImage = `url('${url}')`;
      document.body.style.backgroundPosition = "center top";
      document.body.style.backgroundRepeat = "no-repeat";
      document.body.style.backgroundSize = "cover";
    });
  }

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

    if (
      state.mode === "STANDARD" &&
      currentTurn &&
      currentTurn.team === team &&
      currentTurn.memberIndex === index
    ) {
      div.classList.add("picking-active");
    } else {
      div.classList.remove("picking-active");
    }

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
function changeName() {
  const newName = prompt("Nhập tên mới của bạn:");
  if (newName && newName.trim() !== "") {
    socket.emit("rename", newName.trim());
  }
}

// Khi đổi tên thành công -> Lưu ngay vào bộ nhớ để lần sau vào lại không bị sai
socket.on("renameSuccess", (newName) => {
  localStorage.setItem("valorant_username", newName);
});

// Khi có lỗi (trùng tên)
socket.on("renameError", (msg) => {
  alert(msg);
});
