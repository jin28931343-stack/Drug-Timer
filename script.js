// --- PWA 設定與 Manifest 生成 (自動執行) ---
(function() {
    // 1. 設定圖示路徑 (使用上傳的圖片)
    // 使用 URL 物件將相對路徑轉為絕對路徑，確保在 Blob Manifest 中能正確讀取
    const iconUrl = new URL('PIC/Drug-timer.png', window.location.href).href;

    // 2. 設定 Apple Touch Icon
    const linkApple = document.createElement('link');
    linkApple.rel = 'apple-touch-icon';
    linkApple.href = iconUrl;
    document.head.appendChild(linkApple);

    // 3. 設定 Favicon
    const linkFavicon = document.createElement('link');
    linkFavicon.rel = 'icon';
    linkFavicon.type = 'image/png'; // 修改為 PNG 格式
    linkFavicon.href = iconUrl;
    document.head.appendChild(linkFavicon);

    // 4. 定義 Manifest
    const manifest = {
        "name": "ACLS 急救給藥計時",
        "short_name": "ACLS Timer",
        "start_url": ".",
        "display": "standalone",
        "background_color": "#111827",
        "theme_color": "#1f2937",
        "orientation": "portrait",
        "icons": [{
            "src": iconUrl,
            "sizes": "192x192 512x512", // 設定常見尺寸
            "type": "image/png",
            "purpose": "any maskable"
        }]
    };

    // 5. 注入 Manifest
    const stringManifest = JSON.stringify(manifest);
    const blob = new Blob([stringManifest], {type: 'application/json'});
    const manifestURL = URL.createObjectURL(blob);
    const linkManifest = document.createElement('link');
    linkManifest.rel = 'manifest';
    linkManifest.href = manifestURL;
    document.head.appendChild(linkManifest);
})();


// --- 應用程式邏輯 ---

// 狀態變數
let state = {
    startTime: null,     // 急救開始時間
    lastMedTime: null,   // 上次給藥時間
    alertLevel: 0,       // 0:未警示, 1:已響過3分鐘, 2:已響過5分鐘
    shocks: 0,
    epiCount: 0,
    amioCount: 0,
    logs: [],
    timerInterval: null,
    wakeLock: null
};

// --- 音效控制 (Web Audio API) ---
let audioCtx = null;

function initAudio() {
    if (!audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

// 播放嗶聲
// times: 嗶幾聲
function playBeep(times = 1) {
    initAudio(); // 確保 AudioContext 已啟動

    const playTone = (i) => {
        if (i >= times) return;

        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.type = 'sine';
        oscillator.frequency.value = 880; // A5 音高 (880Hz)
        
        const now = audioCtx.currentTime;
        
        // 聲音包絡線 (Envelope) 避免爆音
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(1, now + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

        oscillator.start(now);
        oscillator.stop(now + 0.3); // 每個音長約 0.3 秒

        // 遞迴呼叫播放下一聲 (間隔 400ms)
        oscillator.onended = () => {
            setTimeout(() => playTone(i + 1), 100); 
        };
    };

    playTone(0);
}

// --- 螢幕常亮 ---
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            state.wakeLock = await navigator.wakeLock.request('screen');
            state.wakeLock.addEventListener('release', () => {
                console.log('螢幕常亮鎖定已釋放');
            });
        }
    } catch (err) {
        console.error(`無法啟動螢幕常亮: ${err.message}`);
    }
}

document.addEventListener('visibilitychange', async () => {
    if (state.wakeLock !== null && document.visibilityState === 'visible') {
        await requestWakeLock();
    }
});

// 啟動計時器 (如果是第一次操作)
function startSessionIfNeeded() {
    // 無論是否第一次，每次互動都嘗試啟動 AudioContext (這是瀏覽器限制)
    initAudio();

    if (!state.startTime) {
        state.startTime = new Date();
        state.timerInterval = setInterval(updateTimers, 1000);
        addLog('急救開始', 'System');
        requestWakeLock();
    }
}

// 更新頂部計時器
function updateTimers() {
    if (!state.startTime) return;

    const now = new Date();
    
    // 總時間
    const totalDiff = Math.floor((now - state.startTime) / 1000);
    document.getElementById('totalTimer').innerText = formatTime(totalDiff);

    // 距離上次給藥時間
    const lastMedDisplay = document.getElementById('lastMedTimer');
    const statusDisplay = document.getElementById('statusDisplay');
    const body = document.body;

    if (state.lastMedTime) {
        const medDiff = Math.floor((now - state.lastMedTime) / 1000);
        lastMedDisplay.innerText = formatTime(medDiff);
        
        // 移除舊的背景色 class
        body.classList.remove('bg-gray-900', 'bg-yellow-800', 'bg-red-900');

        // 狀態判斷與音效觸發
        if (medDiff >= 300) { 
            // >= 5 分鐘
            body.classList.add('bg-red-900');
            
            statusDisplay.innerText = "已超過給藥時間";
            statusDisplay.className = "flex-[2] text-center font-bold text-2xl sm:text-4xl leading-tight px-1 text-white animate-pulse tracking-widest";
            lastMedDisplay.classList.remove('text-yellow-400');
            lastMedDisplay.classList.add('text-white', 'alert-pulse');

            // 觸發 5 分鐘音效 (2聲)
            if (state.alertLevel < 2) {
                playBeep(2);
                state.alertLevel = 2; // 標記已響過
            }

        } else if (medDiff >= 180) {
            // >= 3 分鐘
            body.classList.add('bg-yellow-800');

            statusDisplay.innerText = "準備給藥";
            statusDisplay.className = "flex-[2] text-center font-bold text-2xl sm:text-4xl leading-tight px-1 text-white animate-pulse tracking-widest";
            lastMedDisplay.classList.remove('text-yellow-400', 'text-red-500');
            lastMedDisplay.classList.add('text-white', 'alert-pulse');

            // 觸發 3 分鐘音效 (1聲)
            if (state.alertLevel < 1) {
                playBeep(1);
                state.alertLevel = 1; // 標記已響過
            }

        } else {
            // < 3 分鐘
            body.classList.add('bg-gray-900');
            
            statusDisplay.innerText = "";
            statusDisplay.className = "flex-[2] text-center font-bold text-xl leading-tight px-1";
            lastMedDisplay.classList.add('text-yellow-400');
            lastMedDisplay.classList.remove('text-red-500', 'text-white', 'alert-pulse');
        }
    } else {
        lastMedDisplay.innerText = "--:--";
        statusDisplay.innerText = "";
        if (!body.classList.contains('bg-gray-900')) {
            body.classList.remove('bg-yellow-800', 'bg-red-900');
            body.classList.add('bg-gray-900');
        }
    }
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

// --- 模態框控制 ---
function openMedicationModal() {
    startSessionIfNeeded(); // 確保點擊時有初始化音效
    document.getElementById('medModal').classList.remove('hidden');
}

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}

// --- 動作邏輯 ---

// 1. 給藥
function confirmMed(drugName) {
    closeModal('medModal'); 
    showConfirm(`確認給予 <span class="text-red-600">${drugName}</span> ?`, () => {
        startSessionIfNeeded();
        
        if (drugName === 'Epinephrine') {
            state.epiCount++;
            document.getElementById('epiCount').innerText = state.epiCount;
            
            // 重置給藥計時與警示狀態
            state.lastMedTime = new Date();
            state.alertLevel = 0; // 重置警示等級，讓下一次計時能再次觸發聲音
            
        } else if (drugName === 'Amiodarone') {
            state.amioCount++;
            document.getElementById('amioCount').innerText = state.amioCount;
        }
        
        addLog(`給藥: ${drugName}`, 'Medication');
    });
}

// 2. 電擊
function confirmShock() {
    showConfirm(`確認執行 <span class="text-yellow-600">電擊 (Shock)</span> ?`, () => {
        startSessionIfNeeded();
        state.shocks++;
        document.getElementById('shockCount').innerText = state.shocks;
        addLog(`執行電擊 (第 ${state.shocks} 次)`, 'Shock');
    });
}

// 3. 重置
function confirmReset() {
    showConfirm('確認結束急救並清除所有資料?', () => {
        location.reload();
    });
}

// 通用確認視窗邏輯
function showConfirm(messageHTML, actionCallback) {
    const modal = document.getElementById('confirmModal');
    const msgEl = document.getElementById('confirmMessage');
    const btn = document.getElementById('confirmBtnAction');

    msgEl.innerHTML = messageHTML;
    modal.classList.remove('hidden');

    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    newBtn.onclick = () => {
        actionCallback();
        closeModal('confirmModal');
    };
}

// --- 紀錄系統 ---
function addLog(action, type) {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0]; 
    
    let elapsedStr = "00:00";
    if (state.startTime) {
        const diff = Math.floor((now - state.startTime) / 1000);
        elapsedStr = "+" + formatTime(diff);
    }

    const logEntry = { time: timeStr, elapsed: elapsedStr, action: action, type: type };
    state.logs.push(logEntry);
    renderLogs();
}

function renderLogs() {
    const container = document.getElementById('logContainer');
    if (state.logs.length === 0) return;

    container.innerHTML = state.logs.slice().reverse().map(log => {
        let borderClass = 'border-gray-600';
        let icon = '<i class="fa-solid fa-circle-info"></i>';
        let textClass = 'text-white';

        if (log.type === 'Shock') {
            borderClass = 'border-yellow-500 bg-yellow-900/20';
            icon = '<i class="fa-solid fa-bolt text-yellow-500"></i>';
            textClass = 'text-yellow-100';
        } else if (log.type === 'Medication') {
            borderClass = 'border-blue-500 bg-blue-900/20';
            icon = '<i class="fa-solid fa-syringe text-blue-400"></i>';
            textClass = 'text-blue-100';
        }

        return `
            <div class="flex items-center p-3 rounded-lg border-l-4 ${borderClass} bg-gray-700/50">
                <div class="w-16 text-xs text-gray-400 font-mono text-center">
                    <div>${log.time}</div>
                    <div>${log.elapsed}</div>
                </div>
                <div class="mx-3 text-lg">${icon}</div>
                <div class="flex-1 font-bold ${textClass}">${log.action}</div>
            </div>
        `;
    }).join('');
}

function openHistory() {
    renderLogs();
    document.getElementById('historyModal').classList.remove('hidden');
}

async function copyHistory() {
    if (state.logs.length === 0) return;
    
    let text = "急救紀錄 (ACLS Log):\n";
    text += `開始時間: ${state.startTime ? state.startTime.toLocaleString() : 'N/A'}\n`;
    text += "------------------------\n";
    state.logs.forEach(log => {
        text += `[${log.time}] (${log.elapsed}) ${log.action}\n`;
    });
    text += "------------------------\n";
    text += `統計: 電擊 ${state.shocks} 次, Epi ${state.epiCount} 次, Amio ${state.amioCount} 次`;

    try {
        await navigator.clipboard.writeText(text);
        alert('紀錄已複製到剪貼簿！');
    } catch (err) {
        alert('複製失敗，請手動截圖。');
    }
}