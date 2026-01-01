const socket = io();
let myId = null;
let currentGameState = null;
let selectedHeroTemp = null;
let myTeam = null;

// --- TOKEN ---
let deviceToken = localStorage.getItem("device_token");
if (!deviceToken) {
  deviceToken = "token_" + Math.random().toString(36).substr(2) + Date.now();
  localStorage.setItem("device_token", deviceToken);
}

const urlParams = new URLSearchParams(window.location.search);
const isAdmin = urlParams.get("admin") === "true";

// --- HERO DATA (Client dùng để lấy Role cho filter) ---
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
HERO_DATA.sort((a, b) => a.name.localeCompare(b.name));

let currentFilter = "ALL";
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
  const savedName = localStorage.getItem("valorant_username");
  if (savedName) {
    socket.emit("join", { name: savedName, token: deviceToken });
    document.getElementById("login-screen").classList.add("hidden");
  }
});
socket.on("joinError", (msg) => {
  alert(msg);
  document.getElementById("login-screen").classList.remove("hidden");
});
socket.on("updateState", (state) => {
  currentGameState = state;
  renderApp(state);
});
socket.on("renameSuccess", (n) => localStorage.setItem("valorant_username", n));
socket.on("renameError", (m) => alert(m));

function joinGame() {
  const name = document.getElementById("username").value;
  if (name) {
    localStorage.setItem("valorant_username", name);
    socket.emit("join", { name: name, token: deviceToken });
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
function resetGame() {
  if (isAdmin) socket.emit("reset");
}
function toggleMode() {
  if (isAdmin) socket.emit("setMode");
}
function changeName() {
  const newName = prompt("Nhập tên mới:");
  if (newName) socket.emit("rename", newName.trim());
}

// --- LOGIC MỚI CHO RANDOM DRAFT ---
function rerollDraft(slotIndex) {
  socket.emit("rerollDraft", slotIndex);
}

function selectDraftHero(heroName) {
  if (confirm(`Chọn ${heroName}?`)) {
    socket.emit("selectHero", heroName);
  }
}

function setFilter(role) {
  currentFilter = role;
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.role === role);
  });
  if (currentGameState) {
    // Chỉ render lại grid nếu đang ở Standard Mode
    if (currentGameState.mode === "STANDARD") {
      const me = currentGameState.users.find((u) => u.id === myId);
      const turn = currentGameState.turnQueue[currentGameState.turnIndex];
      let isMyTurn = false;
      if (turn && me && me.team === turn.team) {
        const teamUsers = currentGameState.users.filter(
          (u) => u.team === turn.team
        );
        if (
          teamUsers[turn.memberIndex] &&
          teamUsers[turn.memberIndex].id === myId
        )
          isMyTurn = true;
      }
      renderHeroGrid(currentGameState, isMyTurn);
    }
  }
}

function renderApp(state) {
  ["login-screen", "lobby-screen", "vote-screen", "game-screen"].forEach((id) =>
    document.getElementById(id).classList.add("hidden")
  );
  if (!myId) {
    document.getElementById("login-screen").classList.remove("hidden");
    return;
  }

  const me = state.users.find((u) => u.id === myId);
  if (!me) {
    document.getElementById("login-screen").classList.remove("hidden");
    return;
  }

  // Admin controls
  const adminControls = document.getElementById("admin-controls");
  const voteControls = document.querySelector("#vote-screen .bottom-bar");
  const gameResetBtn = document.querySelector(
    "#game-screen .btn-outline.danger"
  );

  if (!isAdmin) {
    if (adminControls) adminControls.classList.add("hidden");
    if (voteControls) voteControls.classList.add("hidden");
    if (gameResetBtn) gameResetBtn.classList.add("hidden");
  } else {
    if (adminControls) adminControls.classList.remove("hidden");
    if (voteControls) voteControls.classList.remove("hidden");
    if (gameResetBtn) gameResetBtn.classList.remove("hidden");
  }

  if (state.phase === "LOBBY") {
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
  users
    .sort((a, b) => (a.teamJoinTime || 0) - (b.teamJoinTime || 0))
    .forEach((u) => {
      const li = document.createElement("li");
      li.innerText = u.name;
      if (u.team === "defend") dList.appendChild(li);
      else if (u.team === "attack") aList.appendChild(li);
    });
}

function renderMapVote(votes) {
  const c = document.getElementById("map-list");
  c.innerHTML = "";
  for (const [map, count] of Object.entries(votes)) {
    const d = document.createElement("div");
    d.className = "map-card";
    setElementBg(d, "maps", map);
    d.innerHTML = `<span>${map}: ${count}</span>`;
    d.onclick = () => socket.emit("voteMap", map);
    c.appendChild(d);
  }
}

function renderGame(state) {
  document.getElementById("map-name").innerText = state.selectedMap;
  const info = document.getElementById("phase-info");

  // UI Containers
  const standardContainer = document.getElementById("standard-ui");
  const draftContainer = document.getElementById("draft-ui");
  const lockBtn = document.getElementById("lock-in-btn");

  const me = state.users.find((u) => u.id === myId);
  myTeam = me ? me.team : null;
  let isMyTurn = false;
  let actionText = "WAITING...";

  const turn = state.turnQueue[state.turnIndex];
  let activeUserId = null;

  if (turn) {
    const teamUsers = state.users.filter((u) => u.team === turn.team);
    const activeUser = teamUsers[turn.memberIndex];
    const activeName = activeUser ? activeUser.name : "...";
    activeUserId = activeUser ? activeUser.id : null;

    actionText = `${turn.team.toUpperCase()} - ${turn.action} (${activeName})`;
    if (activeUser && activeUser.id === myId) {
      isMyTurn = true;
      actionText += " (BẠN)";
    }
    info.innerText = `LƯỢT: ${actionText}`;
    info.style.color =
      turn.team === "attack" ? "var(--red)" : "var(--defend-color)";
  } else {
    info.innerText = "KẾT QUẢ";
  }

  // Handle Result Phase Background
  if (state.picks[myId]) {
    getImageUrl("agents", state.picks[myId], (url) => {
      document.body.style.backgroundImage = `url('${url}')`;
      document.body.style.backgroundPosition = "center top";
    });
  }

  // --- RENDER LOGIC THEO MODE ---

  // 1. Nếu là Ban phase: Luôn hiện grid (ẩn filter nếu muốn, hoặc hiện filter để dễ ban)
  if (turn && turn.action === "BAN") {
    standardContainer.classList.remove("hidden");
    draftContainer.classList.add("hidden");
    renderHeroGrid(state, isMyTurn); // Render grid để Ban
    if (isMyTurn) lockBtn.innerText = "CẤM NGAY";
  }
  // 2. Nếu là Pick phase
  else {
    if (state.mode === "STANDARD") {
      standardContainer.classList.remove("hidden");
      draftContainer.classList.add("hidden");
      if (state.phase !== "RESULT") renderHeroGrid(state, isMyTurn);
      else standardContainer.classList.add("hidden"); // Kết quả thì ẩn grid
    } else if (state.mode === "RANDOM_DRAFT") {
      // Ẩn Standard UI
      standardContainer.classList.add("hidden");

      if (state.phase !== "RESULT") {
        draftContainer.classList.remove("hidden");
        // Render 2 thẻ bài draft
        renderDraftUI(state, activeUserId, isMyTurn);
      } else {
        draftContainer.classList.add("hidden");
      }
    }
  }

  // Render danh sách ban
  const lb = document.getElementById("ban-list-left");
  const rb = document.getElementById("ban-list-right");
  lb.innerHTML = "";
  rb.innerHTML = "";
  state.bans.forEach((h, i) => {
    const d = document.createElement("div");
    d.className = "ban-slot";
    setElementBg(d, "agents", h);
    if (i % 2 === 0) lb.appendChild(d);
    else rb.appendChild(d);
  });

  renderTeamSide("defend", state, turn);
  renderTeamSide("attack", state, turn);
}

function renderDraftUI(state, activeUserId, isMyTurn) {
  const container = document.getElementById("draft-cards-container");
  container.innerHTML = "";

  const options = state.draftOptions[activeUserId];
  if (!options || options.length === 0) {
    container.innerHTML =
      "<div class='waiting-message'>ĐANG TẠO DỮ LIỆU...</div>";
    return;
  }

  const hasRerolled = state.rerollsUsed[activeUserId];

  options.forEach((hero, index) => {
    const card = document.createElement("div");
    card.className = "draft-card";

    // Background Image
    const bg = document.createElement("div");
    bg.className = "draft-card-bg";
    setElementBg(bg, "agents", hero);
    card.appendChild(bg);

    // Name
    const name = document.createElement("div");
    name.className = "draft-card-name";
    name.innerText = hero;
    card.appendChild(name);

    // Controls (Chỉ hiện nếu là lượt của mình)
    if (isMyTurn) {
      // Nút Chọn (Toàn bộ card click để chọn)
      card.onclick = (e) => {
        // Nếu click vào nút reroll thì không chọn
        if (e.target.closest(".reroll-btn")) return;
        selectDraftHero(hero);
      };

      card.classList.add("clickable");

      // Nút Reroll (Góc trên thẻ)
      if (!hasRerolled) {
        const rrBtn = document.createElement("button");
        rrBtn.className = "reroll-btn";
        rrBtn.innerHTML = "↻"; // Icon reload
        rrBtn.title = "Đổi tướng này (Chỉ 1 lần)";
        rrBtn.onclick = (e) => {
          e.stopPropagation();
          rerollDraft(index);
        };
        card.appendChild(rrBtn);
      }
    } else {
      // Người xem
      card.style.opacity = "0.8";
    }

    container.appendChild(card);

    // Thêm chữ "OR" ở giữa
    if (index === 0 && options.length > 1) {
      const or = document.createElement("div");
      or.className = "draft-or-text";
      or.innerText = "VS";
      container.appendChild(or);
    }
  });

  // Thông báo trạng thái reroll
  const statusDiv = document.getElementById("draft-status");
  if (isMyTurn) {
    statusDiv.innerText = hasRerolled
      ? "ĐÃ SỬ DỤNG QUYỀN ĐỔI"
      : "BẠN CÓ 1 LẦN ĐỔI (BẤM VÀO NÚT TRÊN GÓC ẢNH)";
    statusDiv.style.color = hasRerolled ? "#aaa" : "#4da6ff";
  } else {
    statusDiv.innerText = "ĐANG SUY NGHĨ...";
    statusDiv.style.color = "#aaa";
  }
}

function renderTeamSide(team, state, currentTurn) {
  const container = document.getElementById(`${team}-display`);
  container.innerHTML = "";
  state.users
    .filter((u) => u.team === team)
    .forEach((u, idx) => {
      const div = document.createElement("div");
      div.className = "player-card";

      if (
        state.mode &&
        currentTurn &&
        currentTurn.team === team &&
        currentTurn.memberIndex === idx
      ) {
        div.classList.add("picking-active");
      } else {
        div.classList.remove("picking-active");
      }

      let heroDisplay = "";
      // Cả 2 chế độ đều lưu vào picks
      if (state.picks[u.id]) heroDisplay = state.picks[u.id];

      if (heroDisplay) {
        setElementBg(div, "agents", heroDisplay);
        div.style.backgroundColor = "transparent";
      }
      div.innerHTML = `<div class="player-info"><span>${u.name}</span></div>`;
      container.appendChild(div);
    });
}

function renderHeroGrid(state, isMyTurn) {
  const grid = document.getElementById("hero-grid");
  grid.innerHTML = "";
  const lockBtn = document.getElementById("lock-in-btn");

  if (!isMyTurn) {
    lockBtn.classList.add("hidden");
    grid.innerHTML = `<div class="waiting-message">VUI LÒNG CHỜ...</div>`;
    return;
  }

  // FILTER
  const filteredHeroes = HERO_DATA.filter((h) => {
    if (currentFilter === "ALL") return true;
    return h.role === currentFilter;
  });

  filteredHeroes.forEach((heroObj) => {
    const hero = heroObj.name;
    const div = document.createElement("div");
    div.className = "hero-select-item";
    setElementBg(div, "agents", hero);
    div.innerHTML = `<div class="hero-name-label">${hero}</div>`;

    const isBanned = state.bans.includes(hero);
    const isPicked = Object.values(state.picks).includes(hero);
    if (isBanned || isPicked) div.classList.add("disabled");

    if (selectedHeroTemp === hero) div.classList.add("selected");

    if (!div.classList.contains("disabled")) {
      div.onclick = () => {
        selectedHeroTemp = hero;
        renderHeroGrid(state, isMyTurn); // Re-render border
        lockBtn.classList.remove("hidden");
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
