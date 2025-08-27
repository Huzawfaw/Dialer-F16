const express = require('express');
const twilio = require('twilio');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Twilio configuration
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const apiKey = process.env.TWILIO_API_KEY;
const apiSecret = process.env.TWILIO_API_SECRET;
const appSid = process.env.TWILIO_APP_SID;

const client = twilio(accountSid, authToken);
const { jwt } = twilio;
const { AccessToken } = jwt;
const { VoiceGrant } = AccessToken;

// Company phone numbers
const phoneNumbers = {
    connectiv: process.env.CONNECTIV_PHONE,
    booksnpayroll: process.env.BOOKSNPAYROLL_PHONE
};

// Generate access token
app.post('/api/token', (req, res) => {
    try {
        const { identity, company } = req.body;

        console.log('🔑 Token request:', { identity, company });

        // Validate required parameters
        if (!identity || !company) {
            return res.status(400).json({ 
                error: 'Missing identity or company' 
            });
        }

        // Validate environment variables
        if (!accountSid || !apiKey || !apiSecret || !appSid) {
            console.error('❌ Missing Twilio credentials');
            return res.status(500).json({ 
                error: 'Server configuration error' 
            });
        }

        // Create access token
        const accessToken = new AccessToken(
            accountSid,
            apiKey,
            apiSecret,
            {
                identity: identity,
                ttl: 3600 // 1 hour
            }
        );

        // Create voice grant
        const voiceGrant = new VoiceGrant({
            outgoingApplicationSid: appSid,
            incomingAllow: true
        });

        // Add grant to token
        accessToken.addGrant(voiceGrant);

        // Generate JWT
        const token = accessToken.toJwt();

        console.log('✅ Token generated for:', identity);

        res.json({
            token: token,
            identity: identity,
            company: company
        });

    } catch (error) {
        console.error('❌ Token generation error:', error);
        res.status(500).json({ 
            error: 'Failed to generate token',
            details: error.message 
        });
    }
});

// Voice webhook - handles outgoing calls
app.post('/api/voice', (req, res) => {
    try {
        const { To, From } = req.body;
        console.log('📞 Voice webhook:', { To, From });

        const twiml = new twilio.twiml.VoiceResponse();

        if (To) {
            // Outgoing call
            console.log('📤 Outgoing call to:', To);
            twiml.dial({
                callerId: From
            }, To);
        } else {
            // Fallback
            twiml.say('Hello from Twilio');
        }

        res.type('text/xml');
        res.send(twiml.toString());

    } catch (error) {
        console.error('❌ Voice webhook error:', error);
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say('Sorry, there was an error processing your call.');
        res.type('text/xml');
        res.send(twiml.toString());
    }
});

// Incoming call webhook
app.post('/api/incoming', (req, res) => {
    try {
        const { From, To } = req.body;
        console.log('📞 Incoming call:', { From, To });

        const twiml = new twilio.twiml.VoiceResponse();

        // Determine company based on called number
        let company = 'unknown';
        if (To === phoneNumbers.connectiv) {
            company = 'connectiv';
        } else if (To === phoneNumbers.booksnpayroll) {
            company = 'booksnpayroll';
        }

        console.log('🏢 Company identified:', company);

        // Route to available agents
        const dial = twiml.dial({
            timeout: 30,
            record: 'record-from-ringing'
        });

        // Try to connect to available extensions
        if (company === 'connectiv') {
            dial.client('ext_101'); // Reception
        } else if (company === 'booksnpayroll') {
            dial.client('ext_201'); // Accounting
        } else {
            // Fallback
            twiml.say('Thank you for calling. Please hold while we connect you.');
            dial.client('ext_101');
        }

        res.type('text/xml');
        res.send(twiml.toString());

    } catch (error) {
        console.error('❌ Incoming webhook error:', error);
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say('Sorry, we cannot connect you at the moment. Please try again later.');
        res.type('text/xml');
        res.send(twiml.toString());
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        env: {
            hasAccountSid: !!accountSid,
            hasAuthToken: !!authToken,
            hasApiKey: !!apiKey,
            hasApiSecret: !!apiSecret,
            hasAppSid: !!appSid
        }
    });
});

// Test endpoint
app.get('/api/test', (req, res) => {
    res.json({ 
        message: 'Twilio Dialer API is running',
        timestamp: new Date().toISOString()
    });
});

// Start server
app.listen(port, () => {
    console.log(`🚀 Twilio Dialer Server running on port ${port}`);
    console.log('📋 Environment check:');
    console.log('  - Account SID:', accountSid ? '✅' : '❌');
    console.log('  - Auth Token:', authToken ? '✅' : '❌');
    console.log('  - API Key:', apiKey ? '✅' : '❌');
    console.log('  - API Secret:', apiSecret ? '✅' : '❌');
    console.log('  - App SID:', appSid ? '✅' : '❌');
    console.log('  - Connectiv Phone:', phoneNumbers.connectiv || '❌');
    console.log('  - Books&Payroll Phone:', phoneNumbers.booksnpayroll || '❌');
});

module.exports = app;
