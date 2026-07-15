// アプリケーション内のデータを一時格納するメモリ空間（状態管理）
let appState = {
  tasks: [], // APIから取得したタスク全件
  genres: [], // APIから取得したジャンル全件
  sortKeys: {
    // テーブルごとの現在のソートキーと昇順/降順管理
    incomplete: { column: "due_date", asc: true },
    // 動的に追加されるジャンルテーブルのソート状態もここに追加されます
  },
};

// ページが読み込まれたら開始
document.addEventListener("DOMContentLoaded", () => {
  initializeApp();
});

// 初期化処理
async function initializeApp() {
  await fetchGenres(); // まずジャンルを取得（タスクにジャンル名が必要なため）
  await fetchTasks(); // タスクの取得と描画

  // イベントリスナーの登録
  document
    .getElementById("task-form")
    .addEventListener("submit", handleTaskSubmit);
  document
    .getElementById("genre-form")
    .addEventListener("submit", handleGenreSubmit);
  document
    .getElementById("add-genre-view-btn")
    .addEventListener("click", createDynamicGenreView);

  // デフォルトで未完了タスクテーブルのヘッダーにソートイベントを設定
  setupTableSort("incomplete-tasks-table", "incomplete", renderIncompleteTasks);
}

/* ==========================================
   1. API通信（バックエンドとの非同期データ送受信）
   ========================================== */

// バックエンドから全ジャンルを取得
async function fetchGenres() {
  try {
    const response = await fetch("/api/genres");
    appState.genres = await response.json();
    updateGenreDropdowns();
    renderGenreManagementList();
  } catch (err) {
    console.error("ジャンルの取得に失敗しました:", err);
  }
}

// バックエンドから全タスクを取得
async function fetchTasks() {
  try {
    const response = await fetch("/api/tasks");
    appState.tasks = await response.json();

    // 各画面部品の再レンダリングを実行
    renderIncompleteTasks();
    renderAllDynamicGenreViews();
  } catch (err) {
    console.error("タスクの取得に失敗しました:", err);
  }
}

// タスク登録のハンドラ
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
      await fetchTasks(); // 成功したら一覧を更新
    } else {
      const err = await response.json();
      alert("タスク登録に失敗しました: " + err.error);
    }
  } catch (err) {
    console.error("登録時通信エラー:", err);
  }
}

// 新規ジャンル登録のハンドラ
async function handleGenreSubmit(e) {
  e.preventDefault();
  const name = document.getElementById("new-genre-name").value;

  try {
    const response = await fetch("/api/genres", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (response.ok) {
      document.getElementById("new-genre-name").value = "";
      await fetchGenres(); // ジャンルリストを更新
      await fetchTasks(); // ジャンル名変更を反映するためタスクも再読込
    } else {
      const err = await response.json();
      alert("ジャンル登録に失敗しました: " + err.error);
    }
  } catch (err) {
    console.error("ジャンル登録エラー:", err);
  }
}

// ジャンル削除
async function deleteGenre(id) {
  if (
    !confirm(
      "本当にこのジャンルを削除しますか？ このジャンルが割り当てられていたタスクは「ジャンル未設定」に更新されます。",
    )
  )
    return;
  try {
    const response = await fetch(`/api/genres/${id}`, { method: "DELETE" });
    if (response.ok) {
      await fetchGenres();
      await fetchTasks(); // タスクのジャンル表示も連動して更新するため
    }
  } catch (err) {
    console.error("ジャンル削除失敗:", err);
  }
}

// タスクの完了トグル（未完了↔完了の変更）
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
    console.error("ステータス更新失敗:", err);
  }
}

// タスク削除
async function deleteTask(id) {
  if (!confirm("このタスクを削除してよろしいですか？")) return;
  try {
    const response = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    if (response.ok) {
      await fetchTasks();
    }
  } catch (err) {
    console.error("タスク削除失敗:", err);
  }
}

/* ==========================================
   2. ドロップダウン & UIパーツ更新
   ========================================== */

// タスク登録フォームのジャンル一覧セレクトボックスを更新
function updateGenreDropdowns() {
  const select = document.getElementById("task-genre");
  select.innerHTML = '<option value="">(ジャンル未設定)</option>';
  appState.genres.forEach((genre) => {
    const opt = document.createElement("option");
    opt.value = genre.id;
    opt.textContent = genre.name;
    select.appendChild(opt);
  });

  // 既に作成されている「動的ジャンルビュー」の中のドロップダウンも同期して更新する
  const dynamicSelects = document.querySelectorAll(".dynamic-genre-select");
  dynamicSelects.forEach((sel) => {
    const currentVal = sel.value; // 現在選択中の値を保持
    sel.innerHTML = '<option value="">-- ジャンルを選択 --</option>';
    appState.genres.forEach((genre) => {
      const opt = document.createElement("option");
      opt.value = genre.id;
      opt.textContent = genre.name;
      sel.appendChild(opt);
    });
    sel.value = currentVal; // 値を戻す
  });
}

// ジャンル改廃エリアの一覧を再表示
function renderGenreManagementList() {
  const list = document.getElementById("genre-management-list");
  list.innerHTML = "";
  appState.genres.forEach((genre) => {
    const li = document.createElement("li");
    li.innerHTML = `
            <span>${escapeHTML(genre.name)}</span>
            <button class="btn btn-danger" onclick="deleteGenre(${genre.id})">削除</button>
        `;
    list.appendChild(li);
  });
}

/* ==========================================
   3. レンダリング ＆ ソートロジック
   ========================================== */

// テーブルソート共通ロジック
function sortTasksArray(tasksArray, sortKey, ascending) {
  return [...tasksArray].sort((a, b) => {
    let valA = a[sortKey];
    let valB = b[sortKey];

    // 期限日時のマージ比較（日付 + 時刻でソートできるように補正）
    if (sortKey === "due_date") {
      const timeA = a.due_time || "23:59:59";
      const timeB = b.due_time || "23:59:59";
      valA = `${a.due_date}T${timeA}`;
      valB = `${b.due_date}T${timeB}`;
    }

    // 数値・文字列別の比較
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

// ヘッダーにクリックソート用のイベントを付与する関数
function setupTableSort(tableId, stateKey, renderFn) {
  const table = document.getElementById(tableId);
  if (!table) return;

  table.querySelectorAll("th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const column = th.getAttribute("data-sort");
      const currentSort = appState.sortKeys[stateKey];

      if (currentSort && currentSort.column === column) {
        // 同じ列なら昇順・降順を反転
        currentSort.asc = !currentSort.asc;
      } else {
        // 違う列なら新しく登録
        appState.sortKeys[stateKey] = { column: column, asc: true };
      }
      renderFn();
    });
  });
}

// 行全体のHTML組み立て（後からスタイル設定できるように重要度クラス・完了状態をクラスに付与）
function createRowHTML(task) {
  const priorityText =
    ["低 (1)", "やや低 (2)", "中 (3)", "高 (4)", "緊急 (5)"][
      task.priority - 1
    ] || task.priority;
  const isCompletedChecked = task.is_completed === 1 ? "checked" : "";

  // スタイルクラス設計
  // - .priority-${task.priority}：重要度に応じてCSSで個別に色付け可能
  // - .is-completed / .is-incomplete：完了状態に応じて取り消し線など制御可能
  return `
        <tr class="task-row priority-${task.priority} ${task.is_completed === 1 ? "is-completed" : "is-incomplete"}" data-task-id="${task.id}">
            <td><strong>${escapeHTML(task.title)}</strong></td>
            <td>
                ${escapeHTML(task.due_date)} 
                <span class="text-secondary">${task.due_time ? escapeHTML(task.due_time) : ""}</span>
            </td>
            <td><span class="genre-tag">${escapeHTML(task.genre_name || "未分類")}</span></td>
            <td>${priorityText}</td>
            <td><small>${escapeHTML(task.comment || "")}</small></td>
            <td>
                <input type="checkbox" ${isCompletedChecked} onchange="toggleTaskStatus(${task.id}, ${task.is_completed})" title="完了を切り替え">
                <button class="btn btn-danger" onclick="deleteTask(${task.id})">削除</button>
            </td>
        </tr>
    `;
}

// 全ての未完了タスクテーブルの描画
function renderIncompleteTasks() {
  const list = document.getElementById("incomplete-tasks-list");
  list.innerHTML = "";

  // 未完了(is_completed === 0)のみにフィルタリング
  let incompleteList = appState.tasks.filter((t) => t.is_completed === 0);

  // ソートキーに基づいて並び替え
  const sortConfig = appState.sortKeys["incomplete"] || {
    column: "due_date",
    asc: true,
  };
  incompleteList = sortTasksArray(
    incompleteList,
    sortConfig.column,
    sortConfig.asc,
  );

  if (incompleteList.length === 0) {
    list.innerHTML =
      '<tr><td colspan="6" style="text-align: center; color: #7f8c8d;">未完了のタスクはありません🎉</td></tr>';
    return;
  }

  incompleteList.forEach((task) => {
    list.insertAdjacentHTML("beforeend", createRowHTML(task));
  });
}

/* ==========================================
   4. ジャンル別タスク一覧（複数配置の動的ビュー）
   ========================================== */

let dynamicViewCounter = 0; // 複数配置されるビューに一意のIDを与えるカウンター

// 動的なジャンル表示ビュー（コンテナ）を作成
function createDynamicGenreView() {
  dynamicViewCounter++;
  const containerId = `genre-view-${dynamicViewCounter}`;
  const tableId = `genre-table-${dynamicViewCounter}`;
  const selectId = `genre-select-${dynamicViewCounter}`;
  const tbodyId = `genre-tbody-${dynamicViewCounter}`;

  // ソートの初期定義
  appState.sortKeys[containerId] = { column: "due_date", asc: true };

  const html = `
        <div class="dynamic-genre-box" id="${containerId}">
            <div class="dynamic-genre-box-header">
                <div>
                    <strong>🔍 抽出条件：</strong>
                    <select id="${selectId}" class="dynamic-genre-select">
                        <option value="">-- ジャンルを選択 --</option>
                        <!-- ここにジャンルが自動挿入されます -->
                    </select>
                </div>
                <button class="btn btn-danger" onclick="removeDynamicGenreView('${containerId}')">× このビューを閉じる</button>
            </div>
            
            <div class="table-wrapper">
                <table id="${tableId}">
                    <thead>
                        <tr>
                            <th data-sort="title">タイトル ⇅</th>
                            <th data-sort="due_date">期限 ⇅</th>
                            <th data-sort="genre_name">ジャンル ⇅</th>
                            <th data-sort="priority">重要度 ⇅</th>
                            <th data-sort="comment">コメント ⇅</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody id="${tbodyId}">
                        <tr><td colspan="6" style="text-align: center; color: #7f8c8d;">上のメニューからジャンルを選んでください。</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;

  document
    .getElementById("dynamic-genre-containers")
    .insertAdjacentHTML("beforeend", html);

  // 新たに作られたセレクトボックスに値を反映
  updateGenreDropdowns();

  // セレクトボックス変更時に、自動で該当ジャンルを描画
  const selectEl = document.getElementById(selectId);
  selectEl.addEventListener("change", () => {
    renderSpecificGenreView(containerId, selectEl.value, tbodyId);
  });

  // 新テーブルのヘッダーにクリックソートをバインド
  setupTableSort(tableId, containerId, () => {
    renderSpecificGenreView(containerId, selectEl.value, tbodyId);
  });
}

// 登録されている全ての動的ジャンルビューを一斉リフレッシュ
function renderAllDynamicGenreViews() {
  const boxes = document.querySelectorAll(".dynamic-genre-box");
  boxes.forEach((box) => {
    const containerId = box.id;
    const selectEl = box.querySelector(".dynamic-genre-select");
    const tbodyEl = box.querySelector("tbody");
    if (selectEl && tbodyEl) {
      renderSpecificGenreView(containerId, selectEl.value, tbodyEl.id);
    }
  });
}

// 指定のジャンルビューにフィルタリングされたテーブルを描画
function renderSpecificGenreView(containerId, genreId, tbodyId) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!genreId) {
    tbody.innerHTML =
      '<tr><td colspan="6" style="text-align: center; color: #7f8c8d;">ジャンルが選択されていません。</td></tr>';
    return;
  }

  // 特定のジャンルIDで絞り込む
  let filtered = appState.tasks.filter((t) => t.genre_id === parseInt(genreId));

  // ソートを適用
  const sortConfig = appState.sortKeys[containerId] || {
    column: "due_date",
    asc: true,
  };
  filtered = sortTasksArray(filtered, sortConfig.column, sortConfig.asc);

  if (filtered.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="6" style="text-align: center; color: #7f8c8d;">このジャンルのタスクは現在ありません。</td></tr>';
    return;
  }

  filtered.forEach((task) => {
    tbody.insertAdjacentHTML("beforeend", createRowHTML(task));
  });
}

// 動的に作成した表示コンテナを消去する
function removeDynamicGenreView(containerId) {
  const element = document.getElementById(containerId);
  if (element) {
    element.remove();
    delete appState.sortKeys[containerId]; // 使用していたソート定義の削除
  }
}

/* ==========================================
   5. セキュリティ対策用（XSS防止サニタイジング）
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
