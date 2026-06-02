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

document.getElementById('exportDate').valueAsDate = new Date();
loadData();

// HÀM HIỂN THỊ THÔNG BÁO THẢ XUỐNG ĐỘC LẬP
function showExportNotification(message, isSuccess) {
    const toast = document.getElementById('exportToast');
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

function receiveData(color, weight) {
    if (!isRunning) return;
    
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toLocaleTimeString();

    const year2Dig = now.getFullYear().toString().slice(-2);
    const month2Dig = String(now.getMonth() + 1).padStart(2, '0');
    const day2Dig = String(now.getDate()).padStart(2, '0');
    const hourSpecific = String(now.getHours()).padStart(2, '0') + 
                         String(now.getMinutes()).padStart(2, '0') + 
                         String(now.getSeconds()).padStart(2, '0');

    const batchId = `B-${year2Dig}${month2Dig}${day2Dig}-${hourSpecific}`;

    const newItem = { date: dateStr, time: timeStr, color: color, weight: weight, batch: batchId };
    database.push(newItem);

    totalMassGrams += weight;
    if(color === "RED") { counts.red++; massPerColor.red += weight; }
    if(color === "BLUE") { counts.blue++; massPerColor.blue += weight; }
    if(color === "YELLOW") { counts.yellow++; massPerColor.yellow += weight; }
    updateUI();

    const tbody = document.querySelector("#logTable tbody");
    const row = `<tr>
        <td>${newItem.date}</td>
        <td>${newItem.time}</td>
        <td>${newItem.color}</td>
        <td>${newItem.weight}</td>
        <td>${newItem.batch}</td>
    </tr>`;
    tbody.insertAdjacentHTML('afterbegin', row);

    saveData();
}

function updateUI() {
    // Đảm bảo totalMassGrams luôn là số trước khi dùng toFixed
    const safeTotalMass = (typeof totalMassGrams === 'number' && !isNaN(totalMassGrams)) ? totalMassGrams : 0;
    
    // Kiểm tra xem phần tử HTML có tồn tại không trước khi gán dữ liệu
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
    notice.innerText = "THÔNG BÁO: HỆ THỐNG ĐÃ KHỞI ĐỘNG CHẠY!";
    notice.style.backgroundColor = "#e6f4ea";
    notice.style.color = "var(--success)";
    notice.style.borderColor = "var(--success)";
}

function updateStop() {
    isRunning = false;
    isReset = false;
    console.log("Hệ thống tạm dừng.");

    const notice = document.getElementById('screenNotice');
    notice.innerText = "THÔNG BÁO: HỆ THỐNG ĐÃ TẠM DỪNG HOẠT ĐỘNG!";
    notice.style.backgroundColor = "#fce8e6";
    notice.style.color = "var(--danger)";
    notice.style.borderColor = "var(--danger)";
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
    document.getElementById('ratioText').innerText = "Đỏ: 0% | Xanh: 0% | Vàng: 0%";
    document.getElementById('pieChart').style.background = "#ddd";
    document.querySelector("#logTable tbody").innerHTML = "";
    const notice = document.getElementById('screenNotice');
    notice.innerText = "THÔNG BÁO: ĐÃ XOÁ SẠCH TOÀN BỘ SỐ LIỆU VỀ 0!";
    notice.style.backgroundColor = "#fef7e0";
    notice.style.color = "#b06000";
    notice.style.borderColor = "var(--warning)";
}

function handleExport() {
    const selectedDate = document.getElementById('exportDate').value;
    const filteredData = database.filter(item => item.date === selectedDate);

    if (filteredData.length === 0) {
        showExportNotification(`Thất bại: Không có dữ liệu của ngày ${selectedDate}!`, false);
        return;
    }

    showExportNotification("Đang tải tệp báo cáo lô hàng...", true);

    let csvContent = "\ufeff"

    const redMass = filteredData
    .filter(i => i.color === "RED")
    .reduce((sum, valWeight) => sum + parseFloat(valWeight.weight),0);

    const blueMass = filteredData
        .filter(i => i.color === "BLUE")
        .reduce((sum, valWeight) => sum + parseFloat(valWeight.weight), 0);

    const yellowMass = filteredData
        .filter(i => i.color === "YELLOW")
        .reduce((sum, valWeight) => sum + parseFloat(valWeight.weight), 0);

    const totalMass = redMass + blueMass + yellowMass;

    csvContent += `TỔNG KẾT NGÀY:,,${selectedDate}\n`; 
    csvContent += `Màu,Đỏ,Xanh,Vàng\n`; 
    csvContent +=
    `Khối lượng mỗi màu (g),` +
    `${redMass.toFixed(2)},` +
    `${blueMass.toFixed(2)},` +
    `${yellowMass.toFixed(2)}\n`;
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

function saveData() {
    const data = {
        database: database,
        totalMassGrams: totalMassGrams,
        counts: counts,
        massPerColor: massPerColor,
        isRunning,
        isReset
    };
    localStorage.setItem("iotData", JSON.stringify(data));
}

function loadData() {
    const savedData = localStorage.getItem("iotData");
    if(!savedData) return;

    const data = JSON.parse(savedData);
    database = data.database || [];
    totalMassGrams = data.totalMassGrams || 0;
    counts = data.counts || { red: 0, blue: 0, yellow: 0 };
    massPerColor = data.massPerColor || { red: 0, blue: 0, yellow: 0 };
    isRunning = data.isRunning || false;
    isReset = data.isReset || false;
    updateUI();

    const tableBody = document.querySelector("#logTable tbody");
    tableBody.innerHTML = ""; 

    database.forEach(item => {
        const row = `<tr>
            <td>${item.date}</td>
            <td>${item.time}</td>
            <td>${item.color}</td>
            <td>${item.weight}</td>
            <td>${item.batch}</td>
        </tr>`;
        tableBody.insertAdjacentHTML('beforeend', row); 
    });

    if(isRunning) {
        updateStart();
    } else if(!isRunning && !isReset) {
        updateStop();
    } else if(isReset) {
        updateReset();
    }
}

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
        let msg = message.toString(); 
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

setInterval(() => {
    if(!client.connected) {
        return;
    }
    if (!resetWaiting) {
         monitorPingPong = true;
    }
    client.publish("fromWEB_Mode", "PING");
}, 3000);

setInterval(() => {
    if(!monitorPingPong) {
        return;
    }
    if(Date.now() - lastPongTime > 10000) {
        console.warn("STM32 OFFLINE! Kiểm tra kết nối và khởi động lại thiết bị nếu cần!");
    }
}, 500);