// --- 1. KHỞI TẠO KẾT NỐI MQTT ---
const client = mqtt.connect(
'wss://3d949df5092f4e10aea3a539a9faa670.s1.eu.hivemq.cloud:8884/mqtt',
{
    username: 'ThanhLy',
    password: 'ThanhLy*101#'
});

client.on('connect', function () {
    console.log("MQTT Connected");

    client.subscribe("toWEB_Data", (error) => {
        if(error) {
            console.error("Subscribe error:", error);
        }
    });

    client.subscribe("toWEB_Mode", (error) => {
        if(error) {
            console.error("Subscribe error:", error);
        }
    });
});

client.on('error', function (error) {
    console.error("MQTT Connection Error:", error);
});
client.on('reconnect', function () {
    console.log("MQTT Reconnecting...");
});

// --- 2. KHAI BÁO BIẾN TOÀN CỤC (ĐÃ THÊM BỘ LƯU TRỮ THEO NGÀY) ---
let allDaysStorage = {}; 
let currentViewingDate = ""; 

let database = [];
let totalMassGrams = 0;
let counts = { red: 0, blue: 0, yellow: 0 };
let massPerColor = { red: 0, blue: 0, yellow: 0 };
let isRunning = true;
let isReset = false;
let flagReset = false;

let lastPongTime = Date.now();
let resetTimer = null;
let monitorPingPong = false;
let resetWaiting = false;

// --- 3. KHỞI CHẠY ĐỒNG BỘ BAN ĐẦU KHI TẢI TRANG ---
const dateInput = document.getElementById('exportDate');
const tzOffset = (new Date()).getTimezoneOffset() * 60000; 
const localISOTime = (new Date(Date.now() - tzOffset)).toISOString().split('T')[0];

currentViewingDate = localISOTime; 

if (dateInput) {
    dateInput.value = localISOTime;
}

// Gọi hàm loadData ngay sau khi xác định được ngày
loadData();

// LẮNG NGHE SỰ KIỆN THAY ĐỔI Ô CHỌN NGÀY VÀ ĐỔI DỮ LIỆU THỜI GIAN THỰC
if (dateInput) {
    dateInput.addEventListener('change', function() {
        currentViewingDate = this.value;
        console.log(`Thay đổi ngày hiển thị sang: ${currentViewingDate}`);
        switchDateView(currentViewingDate);
    });
}

// HÀM HIỂN THỊ THÔNG BÁO THẢ XUỐNG ĐỘC LẬP
function showExportNotification(message, isSuccess) {
    const toast = document.getElementById('exportToast');
    if (!toast) return;
    toast.innerText = message;
    
    toast.className = "export-notification"; // Reset class
    if (isSuccess) {
        toast.classList.add('noti-export-success');
    } else {
        toast.classList.add('noti-export-error');
    }
    
    toast.classList.add('show'); // Thả xuống
    
    setTimeout(() => {
        toast.classList.remove('show'); // Thu lên sau 3 giây
    }, 3000);
}

// HÀM XỬ LÝ NHẬN SẢN PHẨM MỚI TỪ MQTT
function receiveData(color, weight) {
    if (!isRunning) return;
    
    const now = new Date();
    const todayStr = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
    const timeStr = now.toLocaleTimeString();

    // SANG NGÀY MỚI HOẶC CHẠY XUYÊN ĐÊM: Tự động nhảy giao diện về ngày mới, reset bộ đếm hiển thị về 0
    if (currentViewingDate !== todayStr) {
        currentViewingDate = todayStr;
        if (dateInput) dateInput.value = todayStr;
        switchDateView(todayStr);
    }

    const year2Dig = now.getFullYear().toString().slice(-2);
    const month2Dig = String(now.getMonth() + 1).padStart(2, '0');
    const day2Dig = String(now.getDate()).padStart(2, '0');
    const hourSpecific = String(now.getHours()).padStart(2, '0') + 
                         String(now.getMinutes()).padStart(2, '0') + 
                         String(now.getSeconds()).padStart(2, '0');

    const batchId = `B-${year2Dig}${month2Dig}${day2Dig}-${hourSpecific}`;

    const newItem = { date: todayStr, time: timeStr, color: color, weight: weight, batch: batchId };
    database.push(newItem);

    totalMassGrams += weight;
    if(color === "RED") { counts.red++; massPerColor.red += weight; }
    if(color === "BLUE") { counts.blue++; massPerColor.blue += weight; }
    if(color === "YELLOW") { counts.yellow++; massPerColor.yellow += weight; }
    updateUI();

    const tbody = document.querySelector("#logTable tbody");
    if (tbody) {
        const row = `<tr>
            <td>${newItem.date}</td>
            <td>${newItem.time}</td>
            <td>${newItem.color}</td>
            <td>${newItem.weight}</td>
            <td>${newItem.batch}</td>
        </tr>`;
        tbody.insertAdjacentHTML('afterbegin', row);
    }

    saveData();
}

function updateUI() {
    const safeTotalMass = (typeof totalMassGrams === 'number' && !isNaN(totalMassGrams)) ? totalMassGrams : 0;
    const totalElem = document.getElementById('total');
    if (totalElem) {
        totalElem.innerText = safeTotalMass.toFixed(2) + " g";
    }

    if(document.getElementById('count-red')) document.getElementById('count-red').innerText = counts?.red || 0;
    if(document.getElementById('count-blue')) document.getElementById('count-blue').innerText = counts?.blue || 0;
    if(document.getElementById('count-yellow')) document.getElementById('count-yellow').innerText = counts?.yellow || 0;

    const mRed = massPerColor?.red || 0;
    const mBlue = massPerColor?.blue || 0;
    const mYellow = massPerColor?.yellow || 0;

    if(document.getElementById('mass-red')) document.getElementById('mass-red').innerText = mRed.toFixed(2);
    if(document.getElementById('mass-blue')) document.getElementById('mass-blue').innerText = mBlue.toFixed(2);
    if(document.getElementById('mass-yellow')) document.getElementById('mass-yellow').innerText = mYellow.toFixed(2);

    const totalMass = mRed + mBlue + mYellow;
    if(totalMass > 0) {
        const pRed = Math.round((mRed / totalMass) * 100);
        const pBlue = Math.round((mBlue / totalMass) * 100);
        const pYellow = 100 - pRed - pBlue;

        if(document.getElementById('ratioText')) {
            document.getElementById('ratioText').innerText = `Đỏ: ${pRed}% | Xanh: ${pBlue}% | Vàng: ${pYellow}%`;
        }
        
        const slice1 = pRed;
        const slice2 = pRed + pBlue;
        const pieChart = document.getElementById('pieChart');
        if(pieChart) {
            pieChart.style.background = `conic-gradient(var(--danger) 0% ${slice1}%, var(--primary) ${slice1}% ${slice2}%, var(--warning) ${slice2}% 100%)`;
        }
    } else {
        if(document.getElementById('ratioText')) document.getElementById('ratioText').innerText = "Đỏ: 0% | Xanh: 0% | Vàng: 0%";
        if(document.getElementById('pieChart')) document.getElementById('pieChart').style.background = "#ddd";
    }
}

function handleStart() {
    client.publish("fromWEB_Mode", "START");
    console.log("Đã gửi lệnh START đến STM32.Đang chờ phản hồi...");
}

function handleStop() {
    client.publish("fromWEB_Mode", "STOP");
    console.log("Đã gửi lệnh STOP đến STM32.Đang chờ phản hồi...");
}

function handleReset() {
    confirmReset();

    if(flagReset) {
        flagReset = false;
        client.publish("fromWEB_Mode", "RESET");
        console.log("Đã gửi lệnh RESET đến STM32. Đang chờ phản hồi...");

        resetWaiting = true;
        monitorPingPong = false;
        if(resetTimer){
            clearTimeout(resetTimer);
        }
        resetTimer = setTimeout(() => {
            if(resetWaiting) {
                console.warn("STM32 không phản hồi sau lệnh RESET! Update không thành công!");
                resetWaiting = false;
                monitorPingPong = true;
            }
        }, 6000);
    }
}

function updateStart() {
    isRunning = true;
    console.log("Hệ thống bắt đầu chạy...");

    const notice = document.getElementById('screenNotice');
    if (notice) {
        notice.innerText = "THÔNG BÁO: HỆ THỐNG ĐÃ KHỞI ĐỘNG CHẠY!";
        notice.style.backgroundColor = "#e6f4ea";
        notice.style.color = "var(--success)";
        notice.style.borderColor = "var(--success)";
    }
}

function updateStop() {
    isRunning = false;
    isReset = false;
    console.log("Hệ thống tạm dừng.");

    const notice = document.getElementById('screenNotice');
    if (notice) {
        notice.innerText = "THÔNG BÁO: HỆ THỐNG ĐÃ TẠM DỪNG HOẠT ĐỘNG!";
        notice.style.backgroundColor = "#fce8e6";
        notice.style.color = "var(--danger)";
        notice.style.borderColor = "var(--danger)";
    }
}

function confirmReset() {
    if(confirm("Bạn có chắc chắn muốn reset toàn bộ số liệu và bảng nhật ký hiện tại không?")){
        console.log("Hệ thống thực hiện Reset dữ liệu.");
        return flagReset = true;
    }
    return flagReset = false;
}

function updateReset() {
    isReset = true;
    database = [];
    totalMassGrams = 0;
    counts = { red: 0, blue: 0, yellow: 0 };
    massPerColor = { red: 0, blue: 0, yellow: 0 };
    
    updateUI();
    renderTable();
    
    const notice = document.getElementById('screenNotice');
    if (notice) {
        notice.innerText = "THÔNG BÁO: ĐÃ XOÁ SẠCH TOÀN BỘ SỐ LIỆU VỀ 0!";
        notice.style.backgroundColor = "#fef7e0";
        notice.style.color = "#b06000";
        notice.style.borderColor = "var(--warning)";
    }
    saveData();
}

// HÀM XUẤT FILE CSV THEO NGÀY ĐƯỢC CHỌN TRONG ALLDAYSSTORAGE
function handleExport() {
    const selectedDate = document.getElementById('exportDate').value;
    const dayData = allDaysStorage[selectedDate] || { database: [], totalMassGrams: 0, counts: {red:0,blue:0,yellow:0}, massPerColor: {red:0,blue:0,yellow:0} };
    const filteredData = dayData.database;

    if (filteredData.length === 0) {
        showExportNotification(`Thất bại: Không có dữ liệu của ngày ${selectedDate}!`, false);
        return;
    }

    showExportNotification("Đang tải tệp báo cáo lô hàng...", true);

    let csvContent = "\ufeff"

    const redMass = dayData.massPerColor.red || 0;
    const blueMass = dayData.massPerColor.blue || 0;
    const yellowMass = dayData.massPerColor.yellow || 0;
    const totalMass = dayData.totalMassGrams || 0;

    csvContent += `TỔNG KẾT NGÀY:,,${selectedDate}\n`; 
    csvContent += `Màu,Đỏ,Xanh,Vàng\n`; 
    csvContent += `Khối lượng mỗi màu (g),${redMass.toFixed(2)},${blueMass.toFixed(2)},${yellowMass.toFixed(2)}\n`;
    csvContent += `Tổng khối lượng (g),${totalMass.toFixed(2)}\n`;
    
    csvContent += `\n\nBẢNG DỮ LIỆU CHI TIẾT\n`;
    csvContent += `Ngày,Giờ,Màu sắc,Khối lượng (g),Mã Lô hàng\n`;
    filteredData.slice().reverse().forEach(item => {
        csvContent += `${item.date},${item.time},${item.color},${item.weight},${item.batch}\n`;
    });
    
    setTimeout(() => {
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `BaoCao_Ngay_${selectedDate}.csv`;
        link.click();

        const toast = document.getElementById('exportToast');
        if (toast) {
            toast.innerText = "Đã lưu báo cáo thành công vào máy tính!";
        }
    }, 500);
}

// --- 4. HÀM ĐIỀU KHIỂN ĐỔI NGÀY VÀ LƯU TRỮ NÂNG CAO ---
function saveData() {
allDaysStorage[currentViewingDate] = {
        database: database,
        totalMassGrams: totalMassGrams,
        counts: { ...counts }, // Dùng biệt thức clone tránh tham chiếu lỗi
        massPerColor: { ...massPerColor }
    };
    let khongGianLuuTru = {};
    try {
        const duLieuGoc = localStorage.getItem("iotData_v2");
        if (duLieuGoc) {
            khongGianLuuTru = JSON.parse(duLieuGoc).allDaysStorage || {};
        }
    } catch (e) {
        console.error("Lỗi đọc bộ nhớ đệm trước khi lưu:", e);
    }
    const systemState = {
        allDaysStorage: Object.assign({}, khongGianLuuTru, allDaysStorage),
        isRunning: isRunning,
        isReset: isReset
    };
    localStorage.setItem("iotData_v2", JSON.stringify(systemState));
}

function loadData() {
const savedData = localStorage.getItem("iotData_v2");
    if (!savedData) {
        switchDateView(currentViewingDate);
        return;
    }
    try {
        const data = JSON.parse(savedData);
        allDaysStorage = data.allDaysStorage || {};
        
        isRunning = data.isRunning !== undefined ? data.isRunning : true;
        isReset = data.isReset !== undefined ? data.isReset : false;
        switchDateView(currentViewingDate);

        if (isRunning) {
            updateStart();
        } else if (!isRunning && !isReset) {
            updateStop();
        } else if (isReset) {
            updateReset();
        }
    } catch (e) {
        console.error("Lỗi cấu trúc dữ liệu LocalStorage khi nạp:", e);
        switchDateView(currentViewingDate);
    }
}

function switchDateView(targetDate) {
    if (!allDaysStorage[targetDate]) {
        database = [];
        totalMassGrams = 0;
        counts = { red: 0, blue: 0, yellow: 0 };
        massPerColor = { red: 0, blue: 0, yellow: 0 };
    } else {
        const dayData = allDaysStorage[targetDate];
        database = dayData.database || [];
        totalMassGrams = dayData.totalMassGrams || 0;
        counts = dayData.counts || { red: 0, blue: 0, yellow: 0 };
        massPerColor = dayData.massPerColor || { red: 0, blue: 0, yellow: 0 };
    }

    updateUI();
    renderTable();
}

function renderTable() {
    const tableBody = document.querySelector("#logTable tbody");
    if (!tableBody) return;
    tableBody.innerHTML = ""; 

    database.slice().reverse().forEach(item => {
        const row = `<tr>
            <td>${item.date}</td>
            <td>${item.time}</td>
            <td>${item.color}</td>
            <td>${item.weight}</td>
            <td>${item.batch}</td>
        </tr>`;
        tableBody.insertAdjacentHTML('beforeend', row); 
    });
}

// --- 5. LẮNG NGHE MQTT VÀ XỬ LÝ MESSAGE ---
client.on('message', function (topic, message) {
    console.log('Received topic [', topic, '] message:', message.toString());
    
    if (topic === "toWEB_Data") {
        try {
            const data = JSON.parse(message.toString());
            console.log("Parsed data:", data);
            const color = data.Color;
            const weight = data.Sload;
            receiveData(color, parseFloat(weight));
        }catch (error) {
            console.error("JSON error:", error);
        }
    }
    if(topic === "toWEB_Mode") {
        let msg = message.toString().trim(); 
        if(msg === "STARTED") {
            updateStart();
            saveData(); 
        }else if(msg === "STOPPED") {
            updateStop();
            saveData();
        }else if(msg === "RESETED") {
            updateReset();
            resetWaiting = false;
            monitorPingPong = true;
            saveData();
        }else if(msg === "PONG") {
            lastPongTime = Date.now();
        }
    }
});

// TIMER GỬI LỆNH PING GIỮ KẾT NỐI VỚI STM32
setInterval(() => {
    if(!client.connected) {
        return;
    }
    if (!resetWaiting) {
         monitorPingPong = true;
    }
    client.publish("fromWEB_Mode", "PING");
}, 3000);

// TIMER KIỂM TRA ĐỘ TRỄ PONG ĐỂ PHÁT HIỆN OFFLINE
setInterval(() => {
    if(!monitorPingPong) {
        return;
    }
    if(Date.now() - lastPongTime > 10000) {
        console.warn("STM32 OFFLINE! Kiểm tra kết nối và khởi động lại thiết bị nếu cần!");
    }
}, 500);

// CHẶN CHUỘT PHẢI
document.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    alert("Hệ thống đã được bảo mật! Không thể sử dụng chuột phải.");
});

// CHẶN PHÍM F12, CTRL+SHIFT+I, CTRL+SHIFT+C, CTRL+U (XEM SOURCE)
document.addEventListener('keydown', function(e) {
    // Chặn F12
    if (e.key === "F12") {
        e.preventDefault();
        return false;
    }
    // Chặn Ctrl + Shift + I hoặc Ctrl + Shift + C
    if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'C' || e.key === 'i' || e.key === 'c')) {
        e.preventDefault();
        return false;
    }
    // Chặn Ctrl + U (Xem nguồn trang)
    if (e.ctrlKey && (e.key === 'U' || e.key === 'u')) {
        e.preventDefault();
        return false;
    }
});
