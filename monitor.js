// DVSA Slot Monitor - Main Script
// London Test Centres Data

const LONDON_CENTRES = [
    { code: 'LDC', name: 'Loughton', address: 'Loughton, Essex, IG10 1RB', lat: 51.643, lng: 0.055 },
    { code: 'HOU', name: 'Hounslow', address: 'Hounslow, TW3 1NL', lat: 51.468, lng: -0.362 },
    { code: 'MIH', name: 'Mill Hill', address: 'Mill Hill, NW7 3HU', lat: 51.612, lng: -0.237 },
    { code: 'TOD', name: 'Toddington', address: 'Toddington, LU5 6HR', lat: 51.952, lng: -0.536 },
    { code: 'WOG', name: 'Wood Green', address: 'Wood Green, N22 6UJ', lat: 51.597, lng: -0.109 },
    { code: 'YEL', name: 'Yelverton', address: 'Yelverton, NW10 7LJ', lat: 51.514, lng: -0.205 },
    { code: 'MOR', name: 'Morden', address: 'Morden, SM4 5BH', lat: 51.398, lng: -0.195 },
    { code: 'ERP', name: 'Erith', address: 'Erith, DA8 1QD', lat: 51.482, lng: 0.177 },
    { code: 'GOO', name: 'Goodmayes', address: 'Goodmayes, IG3 9UB', lat: 51.565, lng: 0.112 }
];

// State Management
let monitorState = {
    isRunning: true,
    lastCheck: null,
    centresStatus: {},
    alertHistory: [],
    alertCount: 0,
    checkInterval: 15,
    intervalId: null,
    soundEnabled: true,
    notificationsEnabled: false
};

// DOM Elements
let elements = {};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initializeDOM();
    loadSavedState();
    setupEventListeners();
    startMonitoring();
    updateFooterTime();
});

function initializeDOM() {
    elements = {
        monitorStatus: document.getElementById('monitorStatus'),
        lastCheck: document.getElementById('lastCheck'),
        nextCheck: document.getElementById('nextCheck'),
        refreshBtn: document.getElementById('refreshBtn'),
        intervalSelect: document.getElementById('intervalSelect'),
        notifyBtn: document.getElementById('notifyBtn'),
        soundToggle: document.getElementById('soundToggle'),
        totalCentres: document.getElementById('totalCentres'),
        availableCount: document.getElementById('availableCount'),
        totalSlots: document.getElementById('totalSlots'),
        alertsSent: document.getElementById('alertsSent'),
        centresGrid: document.getElementById('centresGrid'),
        historyList: document.getElementById('historyList'),
        footerTime: document.getElementById('footerTime')
    };
    
    elements.totalCentres.textContent = LONDON_CENTRES.length;
}

function loadSavedState() {
    // Load from localStorage
    const saved = localStorage.getItem('dvsaMonitor');
    if (saved) {
        const data = JSON.parse(saved);
        monitorState.alertHistory = data.alertHistory || [];
        monitorState.alertCount = data.alertCount || 0;
        monitorState.checkInterval = data.checkInterval || 15;
        monitorState.soundEnabled = data.soundEnabled !== false;
        monitorState.notificationsEnabled = data.notificationsEnabled || false;
        
        elements.intervalSelect.value = monitorState.checkInterval;
        elements.soundToggle.checked = monitorState.soundEnabled;
        
        if (monitorState.alertHistory.length > 0) {
            updateHistoryDisplay();
        }
        
        if (monitorState.alertCount > 0) {
            elements.alertsSent.textContent = monitorState.alertCount;
        }
    }
}

function saveState() {
    const toSave = {
        alertHistory: monitorState.alertHistory,
        alertCount: monitorState.alertCount,
        checkInterval: monitorState.checkInterval,
        soundEnabled: monitorState.soundEnabled,
        notificationsEnabled: monitorState.notificationsEnabled
    };
    localStorage.setItem('dvsaMonitor', JSON.stringify(toSave));
}

function setupEventListeners() {
    elements.refreshBtn.addEventListener('click', () => {
        manualRefresh();
    });
    
    elements.intervalSelect.addEventListener('change', (e) => {
        monitorState.checkInterval = parseInt(e.target.value);
        saveState();
        restartMonitoring();
        updateNextCheckTime();
    });
    
    elements.soundToggle.addEventListener('change', (e) => {
        monitorState.soundEnabled = e.target.checked;
        saveState();
    });
    
    elements.notifyBtn.addEventListener('click', async () => {
        if ('Notification' in window) {
            const permission = await Notification.requestPermission();
            monitorState.notificationsEnabled = permission === 'granted';
            saveState();
            
            if (permission === 'granted') {
                elements.notifyBtn.textContent = '✅ Notifications Enabled';
                elements.notifyBtn.style.background = '#00703c';
                new Notification('DVSA Slot Monitor', {
                    body: 'Notifications enabled! You will be alerted when slots become available.',
                    icon: 'https://www.gov.uk/assets/images/govuk-logo.png'
                });
            } else {
                elements.notifyBtn.textContent = '🔔 Enable Notifications';
                elements.notifyBtn.style.background = '';
            }
        } else {
            alert('Notifications not supported in this browser');
        }
    });
}

function startMonitoring() {
    // Initial check
    checkAllCentres();
    
    // Set up interval
    if (monitorState.intervalId) {
        clearInterval(monitorState.intervalId);
    }
    
    const intervalMs = monitorState.checkInterval * 60 * 1000;
    monitorState.intervalId = setInterval(() => {
        if (monitorState.isRunning) {
            checkAllCentres();
        }
    }, intervalMs);
    
    monitorState.isRunning = true;
    elements.monitorStatus.textContent = '● Active';
    elements.monitorStatus.className = 'status-value running';
    
    updateNextCheckTime();
}

function restartMonitoring() {
    if (monitorState.intervalId) {
        clearInterval(monitorState.intervalId);
    }
    startMonitoring();
}

function stopMonitoring() {
    if (monitorState.intervalId) {
        clearInterval(monitorState.intervalId);
        monitorState.intervalId = null;
    }
    monitorState.isRunning = false;
    elements.monitorStatus.textContent = '● Stopped';
    elements.monitorStatus.className = 'status-value';
}

function manualRefresh() {
    checkAllCentres();
    updateNextCheckTime();
}

async function checkAllCentres() {
    console.log('Checking all London test centres...');
    elements.lastCheck.textContent = new Date().toLocaleTimeString();
    
    let availableCount = 0;
    let totalSlotsFound = 0;
    
    // Simulate checking each centre
    for (const centre of LONDON_CENTRES) {
        const result = await checkCentreSlots(centre);
        
        monitorState.centresStatus[centre.code] = result;
        
        if (result.hasSlots) {
            availableCount++;
            totalSlotsFound += result.slots.length;
        }
        
        // Add delay between checks to be respectful
        await delay(1500);
    }
    
    // Update UI
    elements.availableCount.textContent = availableCount;
    elements.totalSlots.textContent = totalSlotsFound;
    
    renderCentresGrid();
    updateFooterTime();
    saveState();
}

async function checkCentreSlots(centre) {
    // Simulated slot checking
    // In production, this would call DVSA's actual API
    return new Promise((resolve) => {
        // Random availability for demonstration
        // Replace with actual API call in production
        const randomHasSlots = Math.random() < 0.3;
        
        let slots = [];
        if (randomHasSlots) {
            const slotCount = Math.floor(Math.random() * 5) + 1;
            for (let i = 0; i < slotCount; i++) {
                const date = new Date();
                date.setDate(date.getDate() + Math.floor(Math.random() * 14) + 1);
                slots.push({
                    date: date.toISOString().split('T')[0],
                    times: ['09:17', '11:32', '14:47'].slice(0, Math.floor(Math.random() * 3) + 1)
                });
            }
        }
        
        resolve({
            centre: centre,
            hasSlots: randomHasSlots,
            slots: slots,
            lastChecked: new Date().toISOString()
        });
    });
}

function renderCentresGrid() {
    const grid = elements.centresGrid;
    grid.innerHTML = '';
    
    for (const centre of LONDON_CENTRES) {
        const status = monitorState.centresStatus[centre.code];
        const hasSlots = status?.hasSlots || false;
        const slots = status?.slots || [];
        
        const card = document.createElement('div');
        card.className = `centre-card ${hasSlots ? 'has-slots' : 'no-slots'}`;
        
        let slotsHtml = '';
        if (hasSlots && slots.length > 0) {
            slotsHtml = `
                <div class="slot-list">
                    ${slots.map(slot => `
                        <div class="slot-item">
                            <span class="slot-date">📅 ${slot.date}</span>
                            <span>${slot.times.join(', ')}</span>
                            <a href="https://driverpracticaltest.dvsa.gov.uk/booking" target="_blank" class="book-btn">Book →</a>
                        </div>
                    `).join('')}
                </div>
            `;
        }
        
        card.innerHTML = `
            <div class="centre-header">
                <span class="centre-name">${centre.name}</span>
                <span class="slot-badge ${hasSlots ? 'available' : 'unavailable'}">
                    ${hasSlots ? '✅ Available' : '❌ No Slots'}
                </span>
            </div>
            <div class="centre-body">
                <div class="centre-address">📍 ${centre.address}</div>
                ${slotsHtml}
                ${!hasSlots ? '<div class="slot-list" style="color: #666;">No test slots currently available. Checking regularly...</div>' : ''}
            </div>
        `;
        
        grid.appendChild(card);
    }
}

function updateHistoryDisplay() {
    const historyList = elements.historyList;
    const history = monitorState.alertHistory;
    
    if (history.length === 0) {
        historyList.innerHTML = '<div class="empty-history">No alerts yet. Monitor will show slots here.</div>';
        return;
    }
    
    historyList.innerHTML = history.map(alert => `
        <div class="history-item">
            <span class="history-time">${new Date(alert.timestamp).toLocaleString()}</span>
            <span class="history-message">${alert.message}</span>
            <span class="slot-badge available">${alert.slotCount} slots</span>
        </div>
    `).join('');
}

function addAlert(centreName, slotCount, slots) {
    const alert = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        centre: centreName,
        slotCount: slotCount,
        message: `🎉 New slots available at ${centreName}! ${slotCount} slot(s) found.`,
        slots: slots
    };
    
    monitorState.alertHistory.unshift(alert);
    
    // Keep only last 50 alerts
    if (monitorState.alertHistory.length > 50) {
        monitorState.alertHistory.pop();
    }
    
    monitorState.alertCount++;
    elements.alertsSent.textContent = monitorState.alertCount;
    
    updateHistoryDisplay();
    
    // Show notification
    if (monitorState.notificationsEnabled && Notification.permission === 'granted') {
        new Notification('🎉 DVSA Slot Alert!', {
            body: `${centreName} has ${slotCount} new test slots available!`,
            icon: 'https://www.gov.uk/assets/images/govuk-logo.png',
            requireInteraction: true
        });
    }
    
    // Play sound
    if (monitorState.soundEnabled) {
        playAlertSound();
    }
    
    // Celebrate!
    celebrate();
}

function playAlertSound() {
    // Create a simple beep sound using Web Audio API
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = 880;
        gainNode.gain.value = 0.5;
        
        oscillator.start();
        gainNode.gain.exponentialRampToValueAtTime(0.00001, audioContext.currentTime + 1);
        oscillator.stop(audioContext.currentTime + 0.5);
    } catch (e) {
        console.log('Sound play failed');
    }
}

function celebrate() {
    canvasConfetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#00703c', '#1d70b8', '#d4351c']
    });
    
    // Add animation to the header
    const header = document.querySelector('.header');
    if (header) {
        header.classList.add('alert-animation');
        setTimeout(() => {
            header.classList.remove('alert-animation');
        }, 1500);
    }
}

function updateNextCheckTime() {
    if (monitorState.intervalId) {
        const nextTime = new Date(Date.now() + monitorState.checkInterval * 60 * 1000);
        elements.nextCheck.textContent = nextTime.toLocaleTimeString();
    }
}

function updateFooterTime() {
    elements.footerTime.textContent = new Date().toLocaleString();
    setInterval(() => {
        if (document.hasFocus()) {
            elements.footerTime.textContent = new Date().toLocaleString();
        }
    }, 1000);
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Export for debugging
window.dvsaMonitor = {
    checkAllCentres,
    stopMonitoring,
    startMonitoring,
    getState: () => monitorState
};
