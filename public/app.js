// アプリの状態管理空間
let appState = {
  tasks: [],
  genres: [],
  sortKeys: {
    incomplete: { column: "remaining_time", asc: true }, // 初期ソートは残り時間が短い順
  },
};

// 閲覧パスワードの管理状態
let currentReadPassword = "";
const CORRECT_READ_PASS = "Yomitori"; // ※表示判定用

// テキストを伏字化するヘルパー関数
function maskText(str) {
  if (str === null || str === undefined || str === "") return "";
  const stringified = String(str);
  if (currentReadPassword === CORRECT_READ_PASS) {
    return stringified; // パスワード一致時はそのまま表示
  }
  return "●".repeat(Math.min(Math.max(stringified.length, 4), 10)); // パスワード不一致時は伏字
}

// 画面全体の再描画（伏字状態の切り替え時などに実行）
function refreshAllViews() {
  updateGenreDropdowns();
  renderIncompleteTasks();
  renderAllDynamicGenreViews();
  renderGenreManagementList();
  drawTimelineChart();
  drawPieChart();
}

document.addEventListener("DOMContentLoaded", () => {
  const readPassInput = document.getElementById("read-password-input");
  const readStatus = document.getElementById("read-auth-status");

  if (readPassInput) {
    readPassInput.addEventListener("input", (e) => {
      currentReadPassword = e.target.value;
      if (currentReadPassword === CORRECT_READ_PASS) {
        if (readStatus) {
          readStatus.textContent = "🔓 解除済み";
          readStatus.style.color = "#2ecc71";
        }
      } else {
        if (readStatus) {
          readStatus.textContent = "🔒 伏字表示中";
          readStatus.style.color = "#e74c3c";
        }
      }
      // 再描画して伏字・解除状態を反映
      refreshAllViews();
    });
  }

  // アプリの初期化呼び出し
  initializeApp();
});

async function initializeApp() {
  await fetchGenres();
  await fetchTasks();

  const taskForm = document.getElementById("task-form");
  if (taskForm) taskForm.addEventListener("submit", handleTaskSubmit);

  const genreForm = document.getElementById("genre-form");
  if (genreForm) genreForm.addEventListener("submit", handleGenreSubmit);

  const addGenreBtn = document.getElementById("add-genre-view-btn");
  if (addGenreBtn)
    addGenreBtn.addEventListener("click", createDynamicGenreView);

  setupTableSort("incomplete-tasks-table", "incomplete", renderIncompleteTasks);
}

/* ==========================================
   1. 残り時間 ＆ 超過時間の計算アルゴリズム
   ========================================== */
function calculateRemainingTime(dueDateStr, dueTimeStr) {
  const timePart = dueTimeStr ? dueTimeStr : "23:59:59";
  const targetDate = new Date(`${dueDateStr}T${timePart}`);
  const now = new Date();

  const diffMs = targetDate.getTime() - now.getTime();
  const absDiff = Math.abs(diffMs);
  const isOverdue = diffMs < 0;

  let displayText = "";
  const oneHour = 60 * 60 * 1000;
  const oneDay = 24 * oneHour;
  const oneWeek = 7 * oneDay;

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
    diffMs: diffMs,
  };
}

/* ==========================================
   2. API通信処理
   ========================================== */

// 書き込みパスワードの取得用ヘルパー
function getWritePassword() {
  const el = document.getElementById("write-password");
  if (el && el.value) return el.value;
  return prompt("書き込みパスワードを入力してください:") || "";
}

async function fetchGenres() {
  try {
    const response = await fetch("/api/genres");
    if (!response.ok) throw new Error("ジャンル取得に失敗しました");
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
    if (!response.ok) throw new Error("タスク取得に失敗しました");
    appState.tasks = await response.json();

    renderIncompleteTasks();
    renderAllDynamicGenreViews();

    // グラフ更新
    drawTimelineChart();
    drawPieChart();
  } catch (err) {
    console.error("タスク取得失敗:", err);
  }
}

async function handleTaskSubmit(e) {
  e.preventDefault();
  const writePassword = getWritePassword();
  if (!writePassword) {
    alert("書き込みパスワードを入力してください。");
    return;
  }

  const data = {
    title: document.getElementById("task-title").value,
    due_date: document.getElementById("task-date").value,
    due_time: document.getElementById("task-time").value || null,
    genre_id: document.getElementById("task-genre").value || null,
    priority: document.getElementById("task-priority").value,
    comment: document.getElementById("task-comment").value || null,
    repeat_days: document.getElementById("repeat-days")?.value || 0,
    repeat_hours: document.getElementById("repeat-hours")?.value || 0,
    repeat_minutes: document.getElementById("repeat-minutes")?.value || 0,
    repeat_times: document.getElementById("repeat-times")?.value || 1,
  };

  try {
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-write-password": writePassword,
      },
      body: JSON.stringify(data),
    });

    const resData = await response.json();
    if (response.ok) {
      document.getElementById("task-form").reset();
      await fetchTasks();
    } else {
      alert(`エラー: ${resData.error || "登録に失敗しました"}`);
    }
  } catch (err) {
    console.error("タスク登録失敗:", err);
  }
}

async function handleGenreSubmit(e) {
  e.preventDefault();
  const writePassword = getWritePassword();
  if (!writePassword) {
    alert("書き込みパスワードを入力してください。");
    return;
  }

  const name = document.getElementById("new-genre-name").value;
  const color = document.getElementById("new-genre-color").value;

  try {
    const response = await fetch("/api/genres", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-write-password": writePassword,
      },
      body: JSON.stringify({ name, color }),
    });

    const resData = await response.json();
    if (response.ok) {
      document.getElementById("new-genre-name").value = "";
      document.getElementById("new-genre-color").value = "#3498db";
      await fetchGenres();
      await fetchTasks();
    } else {
      alert(`エラー: ${resData.error || "ジャンル追加に失敗しました"}`);
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

  const writePassword = getWritePassword();
  if (!writePassword) return;

  try {
    const response = await fetch(`/api/genres/${id}`, {
      method: "DELETE",
      headers: { "x-write-password": writePassword },
    });
    const resData = await response.json();
    if (response.ok) {
      await fetchGenres();
      await fetchTasks();
    } else {
      alert(`エラー: ${resData.error || "削除に失敗しました"}`);
    }
  } catch (err) {
    console.error("ジャンル削除失敗:", err);
  }
}

async function toggleTaskStatus(id, currentStatus) {
  const writePassword = getWritePassword();
  if (!writePassword) return;

  const nextStatus = currentStatus === 1 ? 0 : 1;
  try {
    const response = await fetch(`/api/tasks/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-write-password": writePassword,
      },
      body: JSON.stringify({ is_completed: nextStatus }),
    });
    const resData = await response.json();
    if (response.ok) {
      await fetchTasks();
    } else {
      alert(`エラー: ${resData.error || "更新に失敗しました"}`);
      renderIncompleteTasks(); // 状態を戻すため再描画
    }
  } catch (err) {
    console.error("更新失敗:", err);
  }
}

async function deleteTask(id) {
  if (!confirm("削除しますか？")) return;

  const writePassword = getWritePassword();
  if (!writePassword) return;

  try {
    const response = await fetch(`/api/tasks/${id}`, {
      method: "DELETE",
      headers: { "x-write-password": writePassword },
    });
    const resData = await response.json();
    if (response.ok) {
      await fetchTasks();
    } else {
      alert(`エラー: ${resData.error || "削除に失敗しました"}`);
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
  if (select) {
    select.innerHTML = '<option value="">(ジャンル未設定)</option>';
    appState.genres.forEach((genre) => {
      const opt = document.createElement("option");
      opt.value = genre.id;
      opt.textContent = maskText(genre.name); // ジャンル選択肢も伏字化
      select.appendChild(opt);
    });
  }

  const dynamicSelects = document.querySelectorAll(".dynamic-genre-select");
  dynamicSelects.forEach((sel) => {
    const val = sel.value;
    sel.innerHTML = '<option value="">-- ジャンルを選択 --</option>';
    appState.genres.forEach((genre) => {
      const opt = document.createElement("option");
      opt.value = genre.id;
      opt.textContent = maskText(genre.name); // 動的ビューの選択肢も伏字化
      sel.appendChild(opt);
    });
    sel.value = val;
  });
}

function renderGenreManagementList() {
  const list = document.getElementById("genre-management-list");
  if (!list) return;
  list.innerHTML = "";
  appState.genres.forEach((genre) => {
    const li = document.createElement("li");
    const displayGenre = maskText(genre.name);
    li.innerHTML = `
            <div>
                <span class="genre-color-indicator" style="background-color: ${genre.color}"></span>
                <span>${escapeHTML(displayGenre)}</span>
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

  const overdueRowClass =
    task.is_completed === 0 && timeInfo.isOverdue ? "is-overdue" : "";
  const completedRowClass =
    task.is_completed === 1 ? "is-completed" : "is-incomplete";

  const displayTimeInfo = maskText(timeInfo.text);
  const remainingCellHTML =
    task.is_completed === 1
      ? '<span class="remaining-time">—</span>'
      : timeInfo.isOverdue
        ? `<span class="remaining-time overdue-highlight">${escapeHTML(displayTimeInfo)}</span>`
        : `<span class="remaining-time">${escapeHTML(displayTimeInfo)}</span>`;

  const badgeColor = task.genre_color || "#94a3b8";

  // 各テキスト項目の伏字変換
  const displayRIndex = maskText(task.repeat_index);
  const displayRCount = maskText(task.repeat_count);
  const displayTitle = maskText(task.title);
  const displayDueDate = maskText(task.due_date);
  const displayDueTime = maskText(task.due_time);
  const displayGenre = maskText(task.genre_name);
  const displayComment = maskText(task.comment);

  const repeatBadge =
    task.repeat_count && task.repeat_count > 1
      ? `<span class="repeat-tag" style="display:inline-block; margin-left:0.4rem; padding:0.1rem 0.4rem; background:#e0f2fe; color:#0369a1; border-radius:12px; font-size:0.75rem; font-weight:bold; border:1px solid #bae6fd;">🔁 ${displayRIndex}/${displayRCount}</span>`
      : "";

  return `
        <tr class="task-row priority-${task.priority} ${completedRowClass} ${overdueRowClass}" data-task-id="${task.id}">
            <td><strong>${escapeHTML(displayTitle)}</strong> ${repeatBadge}</td>
            <td>
                ${escapeHTML(displayDueDate)} 
                <span style="color:#64748b; font-size:0.85rem;">${displayDueTime ? escapeHTML(displayDueTime) : ""}</span>
            </td>
            <td>${remainingCellHTML}</td>
            <td>
                <span class="genre-tag" style="background-color: ${badgeColor};">
                    ${escapeHTML(displayGenre || "未分類")}
                </span>
            </td>
            <td>${priorityText}</td>
            <td><small>${escapeHTML(displayComment || "")}</small></td>
            <td>
                <input type="checkbox" ${isChecked} onchange="toggleTaskStatus(${task.id}, ${task.is_completed})">
                <button class="btn btn-danger" onclick="deleteTask(${task.id})">削除</button>
            </td>
        </tr>
    `;
}

function renderIncompleteTasks() {
  const list = document.getElementById("incomplete-tasks-list");
  if (!list) return;
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

  const container = document.getElementById("dynamic-genre-containers");
  if (container) {
    container.insertAdjacentHTML("beforeend", html);
    updateGenreDropdowns();

    const selectEl = document.getElementById(selectId);
    selectEl.addEventListener("change", () => {
      renderSpecificGenreView(containerId, selectEl.value, tbodyId);
    });

    setupTableSort(tableId, containerId, () => {
      renderSpecificGenreView(containerId, selectEl.value, tbodyId);
    });
  }
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

function drawTimelineChart() {
  const canvas = document.getElementById("timeline-chart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;
  ctx.clearRect(0, 0, width, height);

  const activeTasks = appState.tasks.filter((t) => t.is_completed === 0);

  const now = Date.now();
  const startMs = now - 24 * 60 * 60 * 1000;
  const binSizeMs = 6 * 60 * 60 * 1000;
  const totalBins = 32;

  const bins = Array.from({ length: totalBins }, (_, i) => {
    const bStart = startMs + i * binSizeMs;
    const bEnd = bStart + binSizeMs;
    return {
      start: bStart,
      end: bEnd,
      weights: {},
      total: 0,
    };
  });

  activeTasks.forEach((task) => {
    const timePart = task.due_time || "23:59:59";
    const taskTime = new Date(`${task.due_date}T${timePart}`).getTime();

    const binIdx = Math.floor((taskTime - startMs) / binSizeMs);
    if (binIdx >= 0 && binIdx < totalBins) {
      const gId = task.genre_id || 0;
      bins[binIdx].weights[gId] =
        (bins[binIdx].weights[gId] || 0) + task.priority;
      bins[binIdx].total += task.priority;
    }
  });

  const padL = 35;
  const padR = 15;
  const padT = 20;
  const padB = 30;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;

  let maxVal = Math.max(...bins.map((b) => b.total), 5);

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

  const barWidth = Math.max(1, chartW / totalBins - 2);

  bins.forEach((bin, idx) => {
    if (bin.total === 0) return;

    const x = padL + idx * (chartW / totalBins) + 1;
    let currentY = padT + chartH;

    Object.entries(bin.weights).forEach(([gId, weight]) => {
      const genre = appState.genres.find((g) => g.id === parseInt(gId));
      const color = genre ? genre.color : "#cbd5e1";
      const barH = (weight / maxVal) * chartH;

      ctx.fillStyle = color;
      ctx.fillRect(x, currentY - barH, barWidth, barH);
      currentY -= barH;
    });
  });

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

function drawPieChart() {
  const canvas = document.getElementById("today-pie-chart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;
  ctx.clearRect(0, 0, width, height);

  const todayStr = new Date().toLocaleDateString("sv-SE");

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

  const counts = {};
  todayTasks.forEach((task) => {
    const gId = task.genre_id || 0;
    counts[gId] = (counts[gId] || 0) + 1;
  });

  const total = todayTasks.length;
  const centerX = width * 0.35;
  const centerY = height / 2;
  const radius = Math.min(width * 0.22, height * 0.35);

  let startAngle = -Math.PI / 2;

  const legendX = width * 0.68;
  let legendY = 25;

  ctx.font = "10px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  Object.entries(counts).forEach(([gId, count]) => {
    const genre = appState.genres.find((g) => g.id === parseInt(gId));
    const color = genre ? genre.color : "#cbd5e1";
    const name = genre ? genre.name : "未分類";
    const sliceAngle = (count / total) * 2 * Math.PI;

    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    startAngle += sliceAngle;

    ctx.fillStyle = color;
    ctx.fillRect(legendX, legendY - 5, 10, 10);

    ctx.fillStyle = "#334155";
    const maskedGenreName = maskText(name);
    const displayName =
      maskedGenreName.length > 6
        ? maskedGenreName.substring(0, 5) + ".."
        : maskedGenreName;
    ctx.fillText(`${displayName} (${count}件)`, legendX + 15, legendY);

    legendY += 18;
  });
}

/* ==========================================
   6. サニタイジング関数 (XSS防止)
   ========================================== */
function escapeHTML(str) {
  if (!str) return "";
  return String(str).replace(/[&<>'"]/g, (match) => {
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
