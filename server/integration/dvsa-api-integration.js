/**
 * DVSA Slot Monitor - Server-Side Integration Layer
 * Handles authentication, session management, and API communication
 * with DVSA booking system
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { CookieJar } = require('tough-cookie');
const axiosCookieJarSupport = require('axios-cookiejar-support').default;
const { performance } = require('perf_hooks');

// Apply cookie jar support
axiosCookieJarSupport(axios);

class DVSAIntegration {
    constructor(config = {}) {
        this.config = {
            baseURL: 'https://driverpracticaltest.dvsa.gov.uk',
            timeout: 10000,
            retryAttempts: 3,
            retryDelay: 1000,
            ...config
        };

        this.cookieJar = new CookieJar();
        this.sessionId = null;
        this.lastAuthTime = null;
        this.authTimeout = 30 * 60 * 1000; // 30 minutes
        
        this.client = axios.create({
            baseURL: this.config.baseURL,
            timeout: this.config.timeout,
            withCredentials: true,
            jar: this.cookieJar,
            headers: this.getDefaultHeaders()
        });
    }

    /**
     * Get legitimate request headers that mimic browser behavior
     * DVSA checks for user-agent and referer headers
     */
    getDefaultHeaders() {
        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-GB,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Cache-Control': 'max-age=0'
        };
    }

    /**
     * Initialize session with DVSA
     * Retrieves CSRF tokens and establishes session cookies
     */
    async initializeSession() {
        try {
            console.log('[DVSA] Initializing new session...');
            const startTime = performance.now();

            const response = await this.client.get('/booking');
            const html = response.data;
            
            // Parse CSRF token from HTML
            const $ = cheerio.load(html);
            const csrfToken = $('input[name="_csrf"]').val();
            
            if (!csrfToken) {
                throw new Error('CSRF token not found - DVSA page structure may have changed');
            }

            this.sessionId = response.headers['set-cookie']?.[0];
            this.csrfToken = csrfToken;
            this.lastAuthTime = Date.now();

            const duration = (performance.now() - startTime).toFixed(2);
            console.log(`[DVSA] Session initialized successfully (${duration}ms)`);
            
            return {
                success: true,
                sessionId: this.sessionId,
                csrfToken: this.csrfToken
            };
        } catch (error) {
            console.error('[DVSA] Session initialization failed:', error.message);
            throw error;
        }
    }

    /**
     * Check if current session is still valid
     */
    isSessionValid() {
        if (!this.sessionId || !this.csrfToken) {
            return false;
        }

        const sessionAge = Date.now() - this.lastAuthTime;
        return sessionAge < this.authTimeout;
    }

    /**
     * Ensure valid session before API calls
     */
    async ensureValidSession() {
        if (!this.isSessionValid()) {
            await this.initializeSession();
        }
    }

    /**
     * Search for available test slots at specific test centres
     * Implements exponential backoff retry logic
     * 
     * @param {Array<string>} testCentres - Array of test centre codes
     * @param {Object} searchParams - Search parameters
     * @returns {Promise<Array>} Array of available slots
     */
    async searchSlots(testCentres, searchParams = {}) {
        try {
            await this.ensureValidSession();

            console.log(`[DVSA] Searching slots for centres: ${testCentres.join(', ')}`);
            const startTime = performance.now();

            const searchData = {
                testCentreIds: testCentres,
                dateOfTest: searchParams.dateOfTest || null,
                preferredDate: searchParams.preferredDate || new Date().toISOString().split('T')[0],
                licenceNumber: searchParams.licenceNumber || null,
                _csrf: this.csrfToken,
                // DVSA specific parameters
                version: '2.0',
                language: 'english'
            };

            const response = await this.retryRequest(
                () => this.client.post('/booking/search', searchData),
                this.config.retryAttempts
            );

            const slots = this.parseSlotResponse(response.data);
            const duration = (performance.now() - startTime).toFixed(2);

            console.log(`[DVSA] Slot search completed (${duration}ms) - Found ${slots.length} available slots`);

            return {
                success: true,
                slots: slots,
                timestamp: new Date().toISOString(),
                searchParams: searchParams
            };
        } catch (error) {
            console.error('[DVSA] Slot search failed:', error.message);
            return {
                success: false,
                error: error.message,
                slots: []
            };
        }
    }

    /**
     * Get detailed information for a specific test centre
     */
    async getTestCentreDetails(centreCode) {
        try {
            await this.ensureValidSession();

            const response = await this.retryRequest(
                () => this.client.get(`/booking/centre/${centreCode}`),
                this.config.retryAttempts
            );

            const centreInfo = this.parseCentreDetails(response.data);
            return {
                success: true,
                centre: centreInfo
            };
        } catch (error) {
            console.error(`[DVSA] Failed to fetch centre details for ${centreCode}:`, error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Parse slot information from DVSA response
     * Handles various response formats (HTML, JSON)
     */
    parseSlotResponse(responseData) {
        try {
            let slots = [];

            // Handle JSON response
            if (typeof responseData === 'object' && responseData.availableSlots) {
                slots = responseData.availableSlots.map(slot => ({
                    date: slot.date,
                    time: slot.time,
                    centreCode: slot.centreCode,
                    centreName: slot.centreName,
                    available: slot.available === true
                }));
            } 
            // Handle HTML response with parsing
            else if (typeof responseData === 'string') {
                const $ = cheerio.load(responseData);
                
                $('[data-slot]').each((index, element) => {
                    const $slot = $(element);
                    slots.push({
                        date: $slot.data('slot-date'),
                        time: $slot.data('slot-time'),
                        centreCode: $slot.data('centre-code'),
                        centreName: $slot.data('centre-name'),
                        available: $slot.data('available') === 'true'
                    });
                });
            }

            return slots.filter(slot => slot.available);
        } catch (error) {
            console.error('[DVSA] Error parsing slot response:', error.message);
            return [];
        }
    }

    /**
     * Parse test centre details from response
     */
    parseCentreDetails(responseData) {
        try {
            const $ = cheerio.load(responseData);
            
            return {
                code: $('[data-centre-code]').data('centre-code'),
                name: $('[data-centre-name]').text().trim(),
                address: $('[data-centre-address]').text().trim(),
                phone: $('[data-centre-phone]').text().trim(),
                email: $('[data-centre-email]').text().trim(),
                latitude: parseFloat($('[data-centre-lat]').data('centre-lat')),
                longitude: parseFloat($('[data-centre-lng]').data('centre-lng')),
                facilities: this.parseFacilities(responseData)
            };
        } catch (error) {
            console.error('[DVSA] Error parsing centre details:', error.message);
            return null;
        }
    }

    /**
     * Parse available facilities at test centre
     */
    parseFacilities(html) {
        const $ = cheerio.load(html);
        const facilities = [];

        $('[data-facility]').each((index, element) => {
            const facility = $(element).data('facility');
            if (facility) {
                facilities.push(facility);
            }
        });

        return facilities;
    }

    /**
     * Retry mechanism with exponential backoff
     * Handles rate limiting and transient failures
     */
    async retryRequest(requestFn, maxAttempts = 3) {
        let lastError;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await requestFn();
            } catch (error) {
                lastError = error;
                
                // Don't retry on 4xx client errors (except 429 rate limit)
                if (error.response?.status >= 400 && error.response?.status < 500 && error.response?.status !== 429) {
                    throw error;
                }

                if (attempt < maxAttempts) {
                    const delayMs = this.config.retryDelay * Math.pow(2, attempt - 1);
                    console.log(`[DVSA] Retry attempt ${attempt}/${maxAttempts} after ${delayMs}ms delay`);
                    await this.delay(delayMs);
                }
            }
        }

        throw lastError;
    }

    /**
     * Utility: delay execution
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get session statistics for monitoring
     */
    getSessionStats() {
        return {
            sessionActive: this.isSessionValid(),
            sessionAge: this.lastAuthTime ? Date.now() - this.lastAuthTime : 0,
            sessionTimeout: this.authTimeout,
            hasCSRFToken: !!this.csrfToken,
            cookieCount: this.cookieJar.getCookies(this.config.baseURL).length
        };
    }
}

module.exports = DVSAIntegration;
