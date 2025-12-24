const socket = io();
let myId = null;
let currentGameState = null;
let selectedHeroTemp = null; // Tướng đang chọn tạm (chưa Confirm)

// --- CONFIG ---
// Danh sách tướng (Phải trùng tên file ảnh)
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

// HÀM THÔNG MINH: Tự động tìm ảnh PNG hoặc JPG
function setElementBg(element, folder, name) {
  if (!name) return;

  const cacheKey = `${folder}/${name}`;

  // 1. Nếu đã từng kiểm tra file này rồi thì dùng luôn
  if (fileCache[cacheKey]) {
    element.style.backgroundImage = `url('/images/${folder}/${name}.${fileCache[cacheKey]}')`;
    return;
  }

  // 2. Nếu chưa, thử load PNG trước
  const imgPng = new Image();
  imgPng.src = `/images/${folder}/${name}.png`;

  imgPng.onload = () => {
    // Nếu PNG ok
    element.style.backgroundImage = `url('${imgPng.src}')`;
    fileCache[cacheKey] = "png";
  };

  imgPng.onerror = () => {
    // Nếu PNG lỗi -> Chuyển sang thử JPG
    const imgJpg = new Image();
    imgJpg.src = `/images/${folder}/${name}.jpg`;
    imgJpg.onload = () => {
      element.style.backgroundImage = `url('${imgJpg.src}')`;
      fileCache[cacheKey] = "jpg";
    };
    imgJpg.onerror = () => {
      // Nếu JPG cũng lỗi -> Thử JPEG
      element.style.backgroundImage = `url('/images/${folder}/${name}.jpeg')`;
      // Hoặc để trống/màu mặc định
    };
  };
}

socket.on("connect", () => {
  myId = socket.id;
});
socket.on("updateState", (state) => {
  currentGameState = state;
  renderApp(state);
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
}
function toggleMode() {
  socket.emit("setMode", "TOGGLE");
}

// --- RENDER LOGIC ---
function renderApp(state) {
  ["login-screen", "lobby-screen", "vote-screen", "game-screen"].forEach(
    (id) => {
      document.getElementById(id).classList.add("hidden");
      if (id === "login-screen" && !myId)
        document.getElementById(id).classList.remove("hidden");
    }
  );

  if (state.phase === "LOBBY") {
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
    // SỬ DỤNG HÀM MỚI Ở ĐÂY
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
  let isMyTurn = false;
  let actionText = "";

  if (state.mode === "STANDARD") {
    const isTeamTurn = state.turn.team === me?.team;
    actionText = state.turn.action;

    if (isTeamTurn) {
      if (actionText === "BAN") isMyTurn = true;
      if (actionText === "PICK" && !me.hero) isMyTurn = true;
    }

    info.innerText = `LƯỢT: ${state.turn.team.toUpperCase()} - ${actionText}`;
    info.style.color =
      state.turn.team === "attack" ? "var(--val-red)" : "#4da6ff";
  } else {
    info.innerText = "CHẾ ĐỘ GIẢI TRÍ (PICK XONG SWAP)";
    isMyTurn = !state.funPicks[myId];
    if (state.phase === "RESULT") isMyTurn = false;
    document.getElementById("finalize-btn").classList.remove("hidden");
  }

  const btnOpen = document.getElementById("open-pick-btn");
  if (isMyTurn) {
    btnOpen.classList.remove("hidden");
    btnOpen.innerText =
      state.mode === "STANDARD" && state.turn.action === "BAN"
        ? "CẤM TƯỚNG"
        : "CHỌN TƯỚNG";
    btnOpen.classList.remove("btn-primary", "btn-warning");
    btnOpen.classList.add(
      state.turn.action === "BAN" ? "btn-warning" : "btn-primary"
    );
  } else {
    btnOpen.classList.add("hidden");
    closeSelectionModal();
  }

  document.getElementById("ban-header").classList.remove("hidden");
  const leftBan = document.getElementById("ban-list-left");
  const rightBan = document.getElementById("ban-list-right");
  leftBan.innerHTML = "";
  rightBan.innerHTML = "";

  state.bans.forEach((hero, index) => {
    const div = document.createElement("div");
    div.className = "ban-slot";
    // SỬ DỤNG HÀM MỚI
    setElementBg(div, "agents", hero);

    if (index % 2 === 0) leftBan.appendChild(div);
    else rightBan.appendChild(div);
  });

  renderTeamCards("defend", state);
  renderTeamCards("attack", state);
}

function renderTeamCards(team, state) {
  const container = document.getElementById(`${team}-display`);
  container.innerHTML = "";

  state.users
    .filter((u) => u.team === team)
    .forEach((u) => {
      const card = document.createElement("div");
      card.className = "player-card";

      let heroName = u.hero;

      if (state.mode === "FUN" && state.phase !== "RESULT") {
        if (state.funPicks[u.id]) {
          heroName = "LOCKED";
        } else {
          heroName = "";
        }
      }

      if (heroName && heroName !== "LOCKED") {
        // SỬ DỤNG HÀM MỚI
        setElementBg(card, "agents", heroName);
      } else if (heroName === "LOCKED") {
        // Ảnh dấu chấm hỏi hoặc mặc định khi lock ẩn
        card.style.backgroundColor = "#333";
      } else {
        card.style.background = "rgba(255,255,255,0.05)";
      }

      card.innerHTML = `
            <div class="player-info">
                <span class="player-name">${u.name}</span>
                <span class="hero-name">${heroName || ""}</span>
            </div>
        `;
      container.appendChild(card);
    });
}

// --- MODAL & SELECTION LOGIC ---
function openSelectionModal() {
  document.getElementById("selection-modal").classList.remove("hidden");
  selectedHeroTemp = null;
  document.getElementById("confirm-hero-btn").disabled = true;
  document.getElementById("confirm-hero-btn").classList.add("disabled");

  const action =
    currentGameState.mode === "STANDARD" &&
    currentGameState.turn.action === "BAN"
      ? "CẤM (BAN)"
      : "CHỌN (PICK)";
  document.getElementById("modal-action-text").innerText = action;

  renderHeroGrid();
}

function closeSelectionModal() {
  document.getElementById("selection-modal").classList.add("hidden");
}

function renderHeroGrid() {
  const grid = document.getElementById("hero-grid");
  grid.innerHTML = "";

  HEROES.forEach((hero) => {
    const item = document.createElement("div");
    item.className = "hero-select-item";

    // SỬ DỤNG HÀM MỚI
    setElementBg(item, "agents", hero);

    const isBanned = currentGameState.bans.includes(hero);
    const isPicked = Object.values(currentGameState.picks).includes(hero);

    if (isBanned || isPicked) {
      item.classList.add("disabled");
    } else {
      item.onclick = () => selectHeroTemp(hero, item);
    }

    item.innerHTML = `<div class="hero-name-label">${hero}</div>`;
    grid.appendChild(item);
  });
}

function selectHeroTemp(hero, element) {
  document
    .querySelectorAll(".hero-select-item")
    .forEach((el) => el.classList.remove("selected"));
  element.classList.add("selected");
  selectedHeroTemp = hero;

  const btn = document.getElementById("confirm-hero-btn");
  btn.disabled = false;
  btn.classList.remove("disabled");
}

function confirmSelection() {
  if (selectedHeroTemp) {
    socket.emit("selectHero", selectedHeroTemp);
    closeSelectionModal();
  }
}
