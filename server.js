const express = require('express');
const puppeteer = require('puppeteer');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// State management
let monitorState = {
    isRunning: false,
    lastCheck: null,
    centresData: {},
    alertsSent: [],
    slotsFound: []
};

// DVSA London Test Centres
const LONDON_CENTRES = [
    { code: 'LDC', name: 'Loughton', id: 1 },
    { code: 'HOU', name: 'Hounslow', id: 2 },
    { code: 'MIH', name: 'Mill Hill', id: 3 },
    { code: 'TOD', name: 'Toddington', id: 4 },
    { code: 'WOG', name: 'Wood Green', id: 5 },
    { code: 'YEL', name: 'Yelverton', id: 6 },
    { code: 'MOR', name: 'Morden', id: 7 },
    { code: 'ERP', name: 'Erith', id: 8 },
    { code: 'GOO', name: 'Goodmayes', id: 9 }
];

// Email configuration
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

// Middleware
app.use(express.json());
app.use(express.static('public'));

/**
 * Check DVSA for available slots
 */
async function checkDVSASlots() {
    console.log(`\n🔍 Checking DVSA slots at ${new Date().toLocaleTimeString()}...`);
    
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });

        // Set realistic user agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

        // Navigate to DVSA booking system
        console.log('📍 Navigating to DVSA booking system...');
        await page.goto('https://driverpracticaltest.dvsa.gov.uk/booking', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        // Check each test centre
        for (const centre of LONDON_CENTRES) {
            try {
                const slots = await checkCentreSlots(page, centre);
                monitorState.centresData[centre.code] = {
                    name: centre.name,
                    hasSlots: slots.length > 0,
                    slots: slots,
                    lastChecked: new Date().toISOString(),
                    slotsCount: slots.length
                };

                if (slots.length > 0) {
                    console.log(`✅ ${centre.name}: ${slots.length} slot(s) found!`);
                    await sendAlert(centre.name, slots);
                } else {
                    console.log(`❌ ${centre.name}: No slots available`);
                }

                // Small delay between checks
                await new Promise(r => setTimeout(r, 1500));
            } catch (error) {
                console.error(`Error checking ${centre.name}:`, error.message);
                monitorState.centresData[centre.code] = {
                    name: centre.name,
                    hasSlots: false,
                    error: error.message,
                    lastChecked: new Date().toISOString()
                };
            }
        }

        await browser.close();
        monitorState.lastCheck = new Date().toISOString();

    } catch (error) {
        console.error('❌ DVSA Check Error:', error);
        if (browser) await browser.close();
    }
}

/**
 * Check individual centre for available slots
 */
async function checkCentreSlots(page, centre) {
    try {
        // This would need actual DVSA API endpoint or form submission
        // For now, returning mock data - replace with actual integration
        
        // Try to find available dates by querying DVSA's API
        const response = await page.evaluate((centreId) => {
            return fetch(`https://driverpracticaltest.dvsa.gov.uk/api/slots?testCentreId=${centreId}`)
                .then(r => r.json())
                .catch(() => []);
        }, centre.id);

        return response || [];
    } catch (error) {
        console.log(`Could not check ${centre.name}: ${error.message}`);
        return [];
    }
}

/**
 * Send alert notifications
 */
async function sendAlert(centreName, slots) {
    const alert = {
        centre: centreName,
        slotsCount: slots.length,
        timestamp: new Date().toISOString(),
        slots: slots
    };

    monitorState.alertsSent.push(alert);

    // Email notification
    if (process.env.ALERT_EMAIL) {
        try {
            await transporter.sendMail({
                from: process.env.EMAIL_USER,
                to: process.env.ALERT_EMAIL,
                subject: `🎉 DVSA Slots Available at ${centreName}!`,
                html: `
                    <h2>✅ Test Slots Available!</h2>
                    <p><strong>Centre:</strong> ${centreName}</p>
                    <p><strong>Available Slots:</strong> ${slots.length}</p>
                    <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
                    <p>
                        <a href="https://driverpracticaltest.dvsa.gov.uk/booking" 
                           style="background-color: #00703c; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
                            Book Now
                        </a>
                    </p>
                    <hr>
                    <p><small>DVSA Slot Monitor</small></p>
                `
            });
            console.log(`📧 Email sent for ${centreName}`);
        } catch (error) {
            console.error('Email error:', error);
        }
    }

    // Console notification
    console.log(`\n🎉 ALERT SENT FOR ${centreName}`);
    console.log(`📊 Found ${slots.length} available slot(s)`);
}

// API Routes
app.get('/api/status', (req, res) => {
    res.json({
        isRunning: monitorState.isRunning,
        lastCheck: monitorState.lastCheck,
        centresData: monitorState.centresData,
        alertsSent: monitorState.alertsSent.slice(-10),
        totalAlertsCount: monitorState.alertsSent.length
    });
});

app.get('/api/centres', (req, res) => {
    res.json(monitorState.centresData);
});

app.post('/api/check-now', async (req, res) => {
    console.log('Manual check requested');
    await checkDVSASlots();
    res.json({ 
        success: true, 
        message: 'Check completed',
        centresData: monitorState.centresData
    });
});

app.post('/api/start-monitor', (req, res) => {
    const interval = req.body.interval || 15; // minutes

    if (monitorState.isRunning) {
        return res.json({ success: false, message: 'Monitor already running' });
    }

    monitorState.isRunning = true;
    
    // Run immediately
    checkDVSASlots();

    // Schedule recurring checks
    cron.schedule(`*/${interval} * * * *`, () => {
        if (monitorState.isRunning) {
            checkDVSASlots();
        }
    });

    res.json({ 
        success: true, 
        message: `Monitor started - checking every ${interval} minutes`,
        interval: interval
    });
});

app.post('/api/stop-monitor', (req, res) => {
    monitorState.isRunning = false;
    res.json({ success: true, message: 'Monitor stopped' });
});

app.get('/api/alerts', (req, res) => {
    res.json({
        total: monitorState.alertsSent.length,
        recent: monitorState.alertsSent.slice(-20)
    });
});

// Serve static files
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// Start server
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║   🚗 DVSA SLOT MONITOR SERVER          ║
║   Listening on http://localhost:${PORT}    ║
╚════════════════════════════════════════╝
    `);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n✋ Shutting down gracefully...');
    monitorState.isRunning = false;
    process.exit(0);
});

module.exports = { checkDVSASlots, monitorState };
