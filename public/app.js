// アプリの状態管理空間
let appState = {
  tasks: [],
  genres: [],
  sortKeys: {
    incomplete: { column: "remaining_time", asc: true }, // 初期ソートは残り時間が短い順
  },
};

document.addEventListener("DOMContentLoaded", () => {
  initializeApp();

  // ウィンドウのリサイズ時にグラフを鮮明に保ちつつ再描画
  window.addEventListener("resize", () => {
    drawTimelineChart();
    drawPieChart();
  });
});

async function initializeApp() {
  await fetchGenres();
  await fetchTasks();

  document
    .getElementById("task-form")
    .addEventListener("submit", handleTaskSubmit);
  document
    .getElementById("genre-form")
    .addEventListener("submit", handleGenreSubmit);
  document
    .getElementById("add-genre-view-btn")
    .addEventListener("click", createDynamicGenreView);

  setupTableSort("incomplete-tasks-table", "incomplete", renderIncompleteTasks);
}

/* ==========================================
   1. 残り時間 ＆ 超過時間の計算アルゴリズム（時・分・日・週）
   ========================================== */
function calculateRemainingTime(dueDateStr, dueTimeStr) {
  // 時刻が省略されていたら「その日の終わり（23:59:59）」に補正
  const timePart = dueTimeStr ? dueTimeStr : "23:59:59";
  const targetDate = new Date(`${dueDateStr}T${timePart}`);
  const now = new Date();

  const diffMs = targetDate.getTime() - now.getTime(); // ミリ秒単位の差分
  const absDiff = Math.abs(diffMs);
  const isOverdue = diffMs < 0;

  let displayText = "";
  const oneHour = 60 * 60 * 1000;
  const oneDay = 24 * oneHour;
  const oneWeek = 7 * oneDay;

  // 条件分岐：1週間以上、1日以上、1日未満（時分）
  if (absDiff >= oneWeek) {
    displayText = "1週間以上";
  } else if (absDiff >= oneDay) {
    const days = Math.floor(absDiff / oneDay);
    displayText = `${days}日`;
  } else {
    const hours = Math.floor(absDiff / oneHour);
    const mins = Math.floor((absDiff % oneHour) / (60 * 1000));
    displayText = `${hours}時間${mins}分`;
  }

  return {
    text: isOverdue ? `${displayText}遅れ` : displayText,
    isOverdue: isOverdue,
    diffMs: diffMs, // ソートで使用するミリ秒の生データ
  };
}

/* ==========================================
   2. API通信処理
   ========================================== */

async function fetchGenres() {
  try {
    const response = await fetch("/api/genres");
    appState.genres = await response.json();
    updateGenreDropdowns();
    renderGenreManagementList();
  } catch (err) {
    console.error("ジャンル取得失敗:", err);
  }
}

async function fetchTasks() {
  try {
    const response = await fetch("/api/tasks");
    appState.tasks = await response.json();

    renderIncompleteTasks();
    renderAllDynamicGenreViews();

    // タスクが更新されたら分析グラフも最新データで更新
    drawTimelineChart();
    drawPieChart();
  } catch (err) {
    console.error("タスク取得失敗:", err);
  }
}

async function handleTaskSubmit(e) {
  e.preventDefault();
  const data = {
    title: document.getElementById("task-title").value,
    due_date: document.getElementById("task-date").value,
    due_time: document.getElementById("task-time").value || null,
    genre_id: document.getElementById("task-genre").value || null,
    priority: document.getElementById("task-priority").value,
    comment: document.getElementById("task-comment").value || null,
  };

  try {
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (response.ok) {
      document.getElementById("task-form").reset();
      await fetchTasks();
    }
  } catch (err) {
    console.error("タスク登録失敗:", err);
  }
}

async function handleGenreSubmit(e) {
  e.preventDefault();
  const name = document.getElementById("new-genre-name").value;
  const color = document.getElementById("new-genre-color").value; // 新規カラー

  try {
    const response = await fetch("/api/genres", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color }),
    });
    if (response.ok) {
      document.getElementById("new-genre-name").value = "";
      document.getElementById("new-genre-color").value = "#3498db";
      await fetchGenres();
      await fetchTasks();
    }
  } catch (err) {
    console.error("ジャンル追加失敗:", err);
  }
}

async function deleteGenre(id) {
  if (
    !confirm(
      "本当にこのジャンルを削除しますか？ タスク側は「未設定」に置き換わります。",
    )
  )
    return;
  try {
    const response = await fetch(`/api/genres/${id}`, { method: "DELETE" });
    if (response.ok) {
      await fetchGenres();
      await fetchTasks();
    }
  } catch (err) {
    console.error("ジャンル削除失敗:", err);
  }
}

async function toggleTaskStatus(id, currentStatus) {
  const nextStatus = currentStatus === 1 ? 0 : 1;
  try {
    const response = await fetch(`/api/tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_completed: nextStatus }),
    });
    if (response.ok) {
      await fetchTasks();
    }
  } catch (err) {
    console.error("更新失敗:", err);
  }
}

async function deleteTask(id) {
  if (!confirm("削除しますか？")) return;
  try {
    const response = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    if (response.ok) {
      await fetchTasks();
    }
  } catch (err) {
    console.error("削除失敗:", err);
  }
}

/* ==========================================
   3. レンダリング & ソート定義
   ========================================== */

function updateGenreDropdowns() {
  const select = document.getElementById("task-genre");
  select.innerHTML = '<option value="">(ジャンル未設定)</option>';
  appState.genres.forEach((genre) => {
    const opt = document.createElement("option");
    opt.value = genre.id;
    opt.textContent = genre.name;
    select.appendChild(opt);
  });

  const dynamicSelects = document.querySelectorAll(".dynamic-genre-select");
  dynamicSelects.forEach((sel) => {
    const val = sel.value;
    sel.innerHTML = '<option value="">-- ジャンルを選択 --</option>';
    appState.genres.forEach((genre) => {
      const opt = document.createElement("option");
      opt.value = genre.id;
      opt.textContent = genre.name;
      sel.appendChild(opt);
    });
    sel.value = val;
  });
}

function renderGenreManagementList() {
  const list = document.getElementById("genre-management-list");
  list.innerHTML = "";
  appState.genres.forEach((genre) => {
    const li = document.createElement("li");
    // 各ジャンルの隣に、割り当てられた色のインジケータ（丸い円）を表示
    li.innerHTML = `
            <div>
                <span class="genre-color-indicator" style="background-color: ${genre.color}"></span>
                <span>${escapeHTML(genre.name)}</span>
            </div>
            <button class="btn btn-danger" onclick="deleteGenre(${genre.id})">削除</button>
        `;
    list.appendChild(li);
  });
}

// ソート関数
function sortTasksArray(tasksArray, sortKey, ascending) {
  return [...tasksArray].sort((a, b) => {
    let valA, valB;

    if (sortKey === "remaining_time") {
      // 残り時間でソート（超過ミリ秒数。期限超過のマイナス値が先頭に来るように評価）
      valA = calculateRemainingTime(a.due_date, a.due_time).diffMs;
      valB = calculateRemainingTime(b.due_date, b.due_time).diffMs;
    } else if (sortKey === "due_date") {
      const tA = a.due_time || "23:59:59";
      const tB = b.due_time || "23:59:59";
      valA = `${a.due_date}T${tA}`;
      valB = `${b.due_date}T${tB}`;
    } else {
      valA = a[sortKey];
      valB = b[sortKey];
    }

    if (typeof valA === "number" && typeof valB === "number") {
      return ascending ? valA - valB : valB - valA;
    }

    valA = valA ? String(valA).toLowerCase() : "";
    valB = valB ? String(valB).toLowerCase() : "";

    return ascending
      ? valA.localeCompare(valB, "ja")
      : valB.localeCompare(valA, "ja");
  });
}

function setupTableSort(tableId, stateKey, renderFn) {
  const table = document.getElementById(tableId);
  if (!table) return;

  table.querySelectorAll("th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const column = th.getAttribute("data-sort");
      const currentSort = appState.sortKeys[stateKey];

      if (currentSort && currentSort.column === column) {
        currentSort.asc = !currentSort.asc;
      } else {
        appState.sortKeys[stateKey] = { column: column, asc: true };
      }
      renderFn();
    });
  });
}

// 共通TR行のHTML生成
function createRowHTML(task) {
  const priorityText =
    ["低 (1)", "やや低 (2)", "中 (3)", "高 (4)", "緊急 (5)"][
      task.priority - 1
    ] || task.priority;
  const isChecked = task.is_completed === 1 ? "checked" : "";

  // 残り時間・超過情報の取得
  const timeInfo = calculateRemainingTime(task.due_date, task.due_time);

  // クラス切り替えのロジック
  // 未完了で、かつ期限を過ぎていたら 'is-overdue' クラスを付与
  const overdueRowClass =
    task.is_completed === 0 && timeInfo.isOverdue ? "is-overdue" : "";
  const completedRowClass =
    task.is_completed === 1 ? "is-completed" : "is-incomplete";

  // 残り時間のセルの内訳
  const remainingCellHTML =
    task.is_completed === 1
      ? '<span class="remaining-time">—</span>'
      : timeInfo.isOverdue
        ? `<span class="remaining-time overdue-highlight">${escapeHTML(timeInfo.text)}</span>`
        : `<span class="remaining-time">${escapeHTML(timeInfo.text)}</span>`;

  // ジャンルタグの背景色を、DBに格納された色に置換
  const badgeColor = task.genre_color || "#94a3b8";

  return `
        <tr class="task-row priority-${task.priority} ${completedRowClass} ${overdueRowClass}" data-task-id="${task.id}">
            <td><strong>${escapeHTML(task.title)}</strong></td>
            <td>
                ${escapeHTML(task.due_date)} 
                <span style="color:#64748b; font-size:0.85rem;">${task.due_time ? escapeHTML(task.due_time) : ""}</span>
            </td>
            <td>${remainingCellHTML}</td>
            <td>
                <span class="genre-tag" style="background-color: ${badgeColor};">
                    ${escapeHTML(task.genre_name || "未分類")}
                </span>
            </td>
            <td>${priorityText}</td>
            <td><small>${escapeHTML(task.comment || "")}</small></td>
            <td>
                <input type="checkbox" ${isChecked} onchange="toggleTaskStatus(${task.id}, ${task.is_completed})">
                <button class="btn btn-danger" onclick="deleteTask(${task.id})">削除</button>
            </td>
        </tr>
    `;
}

function renderIncompleteTasks() {
  const list = document.getElementById("incomplete-tasks-list");
  list.innerHTML = "";

  let incompleteList = appState.tasks.filter((t) => t.is_completed === 0);
  const sortConfig = appState.sortKeys["incomplete"] || {
    column: "remaining_time",
    asc: true,
  };
  incompleteList = sortTasksArray(
    incompleteList,
    sortConfig.column,
    sortConfig.asc,
  );

  if (incompleteList.length === 0) {
    list.innerHTML =
      '<tr><td colspan="7" style="text-align: center; color: #7f8c8d;">未完了のタスクはありません🎉</td></tr>';
    return;
  }

  incompleteList.forEach((task) => {
    list.insertAdjacentHTML("beforeend", createRowHTML(task));
  });
}

/* ==========================================
   4. ジャンル別タスク一覧（複数配置）
   ========================================== */

let dynamicViewCounter = 0;

function createDynamicGenreView() {
  dynamicViewCounter++;
  const containerId = `genre-view-${dynamicViewCounter}`;
  const tableId = `genre-table-${dynamicViewCounter}`;
  const selectId = `genre-select-${dynamicViewCounter}`;
  const tbodyId = `genre-tbody-${dynamicViewCounter}`;

  appState.sortKeys[containerId] = { column: "remaining_time", asc: true };

  const html = `
        <div class="dynamic-genre-box" id="${containerId}">
            <div class="dynamic-genre-box-header">
                <div>
                    <strong>🔍 表示ジャンル：</strong>
                    <select id="${selectId}" class="dynamic-genre-select">
                        <option value="">-- ジャンルを選択 --</option>
                    </select>
                </div>
                <button class="btn btn-danger" onclick="removeDynamicGenreView('${containerId}')">× ビューを閉じる</button>
            </div>
            
            <div class="table-wrapper">
                <table id="${tableId}">
                    <thead>
                        <tr>
                            <th data-sort="title">タイトル ⇅</th>
                            <th data-sort="due_date">期限 ⇅</th>
                            <th data-sort="remaining_time">残り時間 ⇅</th>
                            <th data-sort="genre_name">ジャンル ⇅</th>
                            <th data-sort="priority">重要度 ⇅</th>
                            <th data-sort="comment">コメント ⇅</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody id="${tbodyId}">
                        <tr><td colspan="7" style="text-align: center; color: #7f8c8d;">ジャンルを選択してください。</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;

  document
    .getElementById("dynamic-genre-containers")
    .insertAdjacentHTML("beforeend", html);
  updateGenreDropdowns();

  const selectEl = document.getElementById(selectId);
  selectEl.addEventListener("change", () => {
    renderSpecificGenreView(containerId, selectEl.value, tbodyId);
  });

  setupTableSort(tableId, containerId, () => {
    renderSpecificGenreView(containerId, selectEl.value, tbodyId);
  });
}

function renderAllDynamicGenreViews() {
  const boxes = document.querySelectorAll(".dynamic-genre-box");
  boxes.forEach((box) => {
    const selectEl = box.querySelector(".dynamic-genre-select");
    const tbodyEl = box.querySelector("tbody");
    if (selectEl && tbodyEl) {
      renderSpecificGenreView(box.id, selectEl.value, tbodyEl.id);
    }
  });
}

function renderSpecificGenreView(containerId, genreId, tbodyId) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!genreId) {
    tbody.innerHTML =
      '<tr><td colspan="7" style="text-align: center; color: #7f8c8d;">ジャンルを選択してください。</td></tr>';
    return;
  }

  let filtered = appState.tasks.filter((t) => t.genre_id === parseInt(genreId));
  const sortConfig = appState.sortKeys[containerId] || {
    column: "remaining_time",
    asc: true,
  };
  filtered = sortTasksArray(filtered, sortConfig.column, sortConfig.asc);

  if (filtered.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="7" style="text-align: center; color: #7f8c8d;">このジャンルのタスクは現在ありません。</td></tr>';
    return;
  }

  filtered.forEach((task) => {
    tbody.insertAdjacentHTML("beforeend", createRowHTML(task));
  });
}

function removeDynamicGenreView(containerId) {
  const el = document.getElementById(containerId);
  if (el) {
    el.remove();
    delete appState.sortKeys[containerId];
  }
}

/* ==========================================
   5. Canvas描画：統計区画
   ========================================== */

// --- グラフ1：今後の負荷タイムライン（前日から1週間、6時間区切り） ---
function drawTimelineChart() {
  const canvas = document.getElementById("timeline-chart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  // 高解像度ディスプレイ（Retina）でぼやけるのを防ぐ
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;
  ctx.clearRect(0, 0, width, height);

  const activeTasks = appState.tasks.filter((t) => t.is_completed === 0);

  // 時間スケールの準備
  const now = Date.now();
  const startMs = now - 24 * 60 * 60 * 1000; // 前日（24時間前）
  const binSizeMs = 6 * 60 * 60 * 1000; // 6時間単位
  const totalBins = 32; // 24h + (7 * 24h) = 192h / 6 = 32 区間

  // 32個の「ビン（時間区切り）」の箱を作る
  const bins = Array.from({ length: totalBins }, (_, i) => {
    const bStart = startMs + i * binSizeMs;
    const bEnd = bStart + binSizeMs;
    return {
      start: bStart,
      end: bEnd,
      weights: {}, // ジャンルごとの重要度蓄積（genre_id: priority_sum）
      total: 0,
    };
  });

  // 各未完了タスクを該当するビンへ分類
  activeTasks.forEach((task) => {
    const timePart = task.due_time || "23:59:59";
    const taskTime = new Date(`${task.due_date}T${timePart}`).getTime();

    const binIdx = Math.floor((taskTime - startMs) / binSizeMs);
    if (binIdx >= 0 && binIdx < totalBins) {
      const gId = task.genre_id || 0; // 0 は未分類
      bins[binIdx].weights[gId] =
        (bins[binIdx].weights[gId] || 0) + task.priority;
      bins[binIdx].total += task.priority;
    }
  });

  // 描画マージン設定
  const padL = 35;
  const padR = 15;
  const padT = 20;
  const padB = 30;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;

  // Y軸の最大値判定（重要度の合計の最大。最低目盛り5を確保）
  let maxVal = Math.max(...bins.map((b) => b.total), 5);

  // 1. グリッドとY軸目盛りの描画
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#64748b";
  ctx.font = "9px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  const gridLines = 4;
  for (let i = 0; i <= gridLines; i++) {
    const val = Math.round((maxVal / gridLines) * i);
    const y = padT + chartH - (i / gridLines) * chartH;

    ctx.fillText(val, padL - 6, y);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(width - padR, y);
    ctx.stroke();
  }

  // 2. 積み上げ棒グラフの描画
  const barWidth = Math.max(1, chartW / totalBins - 2);

  bins.forEach((bin, idx) => {
    if (bin.total === 0) return;

    const x = padL + idx * (chartW / totalBins) + 1;
    let currentY = padT + chartH;

    // ジャンルごとに色分けして積み上げる
    Object.entries(bin.weights).forEach(([gId, weight]) => {
      const genre = appState.genres.find((g) => g.id === parseInt(gId));
      const color = genre ? genre.color : "#cbd5e1"; // 未分類は灰色
      const barH = (weight / maxVal) * chartH;

      ctx.fillStyle = color;
      ctx.fillRect(x, currentY - barH, barWidth, barH);
      currentY -= barH; // 上へと積み上げる
    });
  });

  // 3. X軸の目盛り（24時間＝4つのビンごとに日付を描画）
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  for (let i = 0; i < totalBins; i += 4) {
    const bTime = new Date(startMs + i * binSizeMs);
    const label = `${bTime.getMonth() + 1}/${bTime.getDate()}`;
    const x = padL + i * (chartW / totalBins) + barWidth / 2;

    ctx.fillStyle = "#64748b";
    ctx.fillText(label, x, padT + chartH + 6);

    ctx.strokeStyle = "#94a3b8";
    ctx.beginPath();
    ctx.moveTo(x, padT + chartH);
    ctx.lineTo(x, padT + chartH + 4);
    ctx.stroke();
  }
}

// --- グラフ2：当日の残りタスクのジャンル割合円グラフ ---
function drawPieChart() {
  const canvas = document.getElementById("today-pie-chart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;
  ctx.clearRect(0, 0, width, height);

  // 今日のローカル日付（YYYY-MM-DD 形式）の取得
  const todayStr = new Date().toLocaleDateString("sv-SE"); // "YYYY-MM-DD"

  // 今日の未完了タスクだけにフィルタ
  const todayTasks = appState.tasks.filter(
    (t) => t.due_date === todayStr && t.is_completed === 0,
  );

  if (todayTasks.length === 0) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("今日が期限の未完了タスクは", width / 2, height / 2 - 10);
    ctx.fillText("現在ありません！🎉", width / 2, height / 2 + 10);
    return;
  }

  // ジャンルごとの件数集計
  const counts = {};
  todayTasks.forEach((task) => {
    const gId = task.genre_id || 0;
    counts[gId] = (counts[gId] || 0) + 1;
  });

  const total = todayTasks.length;
  const centerX = width * 0.35; // 円グラフ本体は左寄り
  const centerY = height / 2;
  const radius = Math.min(width * 0.22, height * 0.35);

  let startAngle = -Math.PI / 2; // 時計の12時の位置から開始

  const legendX = width * 0.68; // 右側に凡例を描く
  let legendY = 25;

  ctx.font = "10px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  Object.entries(counts).forEach(([gId, count]) => {
    const genre = appState.genres.find((g) => g.id === parseInt(gId));
    const color = genre ? genre.color : "#cbd5e1";
    const name = genre ? genre.name : "未分類";
    const sliceAngle = (count / total) * 2 * Math.PI;

    // 1. パイの扇形を描画
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    startAngle += sliceAngle;

    // 2. 凡例を描画（色四角 ＋ 件数）
    ctx.fillStyle = color;
    ctx.fillRect(legendX, legendY - 5, 10, 10);

    ctx.fillStyle = "#334155";
    const displayName = name.length > 6 ? name.substring(0, 5) + ".." : name;
    ctx.fillText(`${displayName} (${count}件)`, legendX + 15, legendY);

    legendY += 18;
  });
}

/* ==========================================
   6. サニタイジング関数 (XSS防止)
   ========================================== */
function escapeHTML(str) {
  if (!str) return "";
  return str.replace(/[&<>'"]/g, (match) => {
    const escapeMap = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    };
    return escapeMap[match];
  });
}
