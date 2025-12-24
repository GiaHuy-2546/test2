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
  users.forEach((u) => {
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

  const me = state.users.find((u) => u.id === myId);
  myTeam = me ? me.team : null;
  let isMyTurn = false;
  let actionText = "WAITING...";

  document.getElementById("finalize-btn").classList.add("hidden");
  const lockBtn = document.getElementById("lock-in-btn");
  lockBtn.classList.add("hidden");

  // --- LOGIC HIỂN THỊ TURN (STANDARD) ---
  if (state.mode === "STANDARD") {
    const turn = state.turnQueue[state.turnIndex];
    if (turn) {
      actionText = `${turn.team.toUpperCase()} - ${turn.action}`;

      // Kiểm tra xem có phải lượt của mình không
      if (turn.team === myTeam) {
        if (turn.action === "BAN") {
          isMyTurn = true; // Ai trong team cũng ban được (đơn giản hoá)
        } else if (turn.action === "PICK") {
          // Phải đúng người thứ n trong team
          const myTeamUsers = state.users.filter((u) => u.team === myTeam);
          if (
            myTeamUsers[turn.memberIndex] &&
            myTeamUsers[turn.memberIndex].id === myId
          ) {
            isMyTurn = true;
            actionText += " (BẠN)";
          } else {
            const pickerName = myTeamUsers[turn.memberIndex]
              ? myTeamUsers[turn.memberIndex].name
              : "...";
            actionText += ` (${pickerName})`;
          }
        }
      }

      info.innerText = `LƯỢT: ${actionText}`;
      info.style.color =
        turn.team === "attack" ? "var(--red)" : "var(--defend-color)";

      // Hiện nút Lock nếu đúng lượt
      if (isMyTurn && selectedHeroTemp) {
        lockBtn.classList.remove("hidden");
        lockBtn.innerText = turn.action === "BAN" ? "CẤM NGAY" : "KHOÁ CHỌN";
        lockBtn.className =
          turn.action === "BAN"
            ? "btn-warning lock-btn"
            : "btn-primary lock-btn";
      }
    } else {
      info.innerText = "HOÀN TẤT";
    }
  } else {
    // FUN MODE
    info.innerText = "CHẾ ĐỘ GIẢI TRÍ";
    const done =
      state.completedFunPicks && state.completedFunPicks.includes(myId);
    if (!done) isMyTurn = true;
    if (state.phase !== "RESULT")
      document.getElementById("finalize-btn").classList.remove("hidden");
  }

  // --- THAY ĐỔI BACKGROUND NẾU MÌNH ĐÃ PICK ---
  if (state.picks[myId]) {
    // Tìm ảnh agent và set body background
    getImageUrl("agents", state.picks[myId], (url) => {
      document.body.style.backgroundImage = `url('${url}')`;
      document.body.style.backgroundPosition = "center top";
      document.body.style.backgroundRepeat = "no-repeat";
      document.body.style.backgroundSize = "cover";
    });
  }

  // RENDER BAN
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

  // RENDER TEAM
  renderTeamSide("defend", state, state.turnQueue[state.turnIndex]);
  renderTeamSide("attack", state, state.turnQueue[state.turnIndex]);

  // RENDER GRID
  const heroGridContainer = document.getElementById("hero-grid");
  if (state.phase === "RESULT") {
    heroGridContainer.classList.add("hidden");
    lockBtn.classList.add("hidden");
  } else {
    heroGridContainer.classList.remove("hidden");
    renderHeroGrid(state, isMyTurn);
  }
}

function renderTeamSide(team, state, currentTurn) {
  const container = document.getElementById(`${team}-display`);
  container.innerHTML = "";
  const teamUsers = state.users.filter((u) => u.team === team);

  teamUsers.forEach((u, index) => {
    const div = document.createElement("div");
    div.className = "player-card";

    // Highlight người đang pick
    if (
      state.mode === "STANDARD" &&
      currentTurn &&
      currentTurn.team === team &&
      currentTurn.action === "PICK" &&
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
