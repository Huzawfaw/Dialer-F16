require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const cors = require('cors');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Serve static files from public directory
app.use(express.static('public'));

// Twilio configuration
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twimlAppSid = process.env.TWILIO_TWIML_APP_SID;

const client = twilio(accountSid, authToken);

// Company configuration
const companies = {
    connectiv: {
        name: 'Connectiv',
        number: process.env.CONNECTIV_TWILIO_NUMBER || '+18562307373',
        extensions: {
            '101': { name: 'John Smith', department: 'Sales' },
            '102': { name: 'Sarah Johnson', department: 'Sales' },
            '103': { name: 'Mike Davis', department: 'Support' },
            '104': { name: 'Lisa Wilson', department: 'Manager' }
        }
    },
    booksnpayroll: {
        name: 'BooksnPayroll',
        number: process.env.BOOKSNPAYROLL_TWILIO_NUMBER || '+18564053544',
        extensions: {
            '201': { name: 'David Brown', department: 'Accounting' },
            '202': { name: 'Emma Taylor', department: 'Payroll' },
            '203': { name: 'James Miller', department: 'Support' },
            '204': { name: 'Sophie Anderson', department: 'Manager' }
        }
    }
};

// Health check endpoint
app.get('/api/health', (req, res) => {
    console.log('🏥 Health check requested');
    res.json({ 
        status: 'OK', 
        message: 'Twilio Dialer Server is running',
        timestamp: new Date().toISOString(),
        companies: Object.keys(companies)
    });
});

// Generate access token for Twilio Device
app.post('/api/token', (req, res) => {
    try {
        const { identity, company } = req.body;
        
        console.log(`🔑 Token request received: { identity: '${identity}', company: '${company}' }`);
        
        if (!identity || !company) {
            return res.status(400).json({ error: 'Identity and company are required' });
        }

        if (!companies[company]) {
            return res.status(400).json({ error: 'Invalid company' });
        }

        // Create access token
        const AccessToken = twilio.jwt.AccessToken;
        const VoiceGrant = AccessToken.VoiceGrant;

        const accessToken = new AccessToken(accountSid, accountSid, authToken, {
        identity: identity
        });

        const voiceGrant = new VoiceGrant({
            outgoingApplicationSid: twimlAppSid,
            incomingAllow: true
        });

        accessToken.addGrant(voiceGrant);

        console.log(`✅ Token generated for ${identity} (${company})`);
        
        res.json({
            token: accessToken.toJwt(),
            identity: identity,
            company: company
        });

    } catch (error) {
        console.error('❌ Token generation error:', error);
        res.status(500).json({ error: 'Failed to generate token', details: error.message });
    }
});

// Handle outbound calls
app.post('/api/voice', (req, res) => {
    try {
        console.log('📞 Voice webhook called:', req.body);
        
        const { To, From, CallSid } = req.body;
        
        // Create TwiML response
        const twiml = new twilio.twiml.VoiceResponse();
        
        if (To && To.startsWith('+')) {
            // Outbound call - dial the number
            console.log(`📤 Outbound call: ${From} → ${To}`);
            
            const dial = twiml.dial({
                callerId: From.startsWith('+') ? From : companies.connectiv.number,
                timeout: 30,
                record: 'record-from-ringing'
            });
            
            dial.number(To);
            
        } else {
            // Fallback response
            twiml.say({ voice: 'alice' }, 'Hello! This is your Twilio dialer. Please check your configuration.');
        }
        
        console.log('📤 TwiML Response generated');
        res.type('text/xml');
        res.send(twiml.toString());
        
    } catch (error) {
        console.error('❌ Voice webhook error:', error);
        
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say({ voice: 'alice' }, 'Sorry, there was an error processing your call.');
        
        res.type('text/xml');
        res.send(twiml.toString());
    }
});

// Handle incoming calls for Connectiv
app.post('/api/incoming/connectiv', (req, res) => {
    try {
        console.log('📞 Incoming call for Connectiv:', req.body);
        
        const twiml = new twilio.twiml.VoiceResponse();
        
        twiml.say({ voice: 'alice' }, 'Hello! You have reached Connectiv. Please hold while we connect you.');
        
        // You can add more logic here for routing to extensions
        twiml.dial({ timeout: 20 }, '101'); // Route to extension 101
        
        res.type('text/xml');
        res.send(twiml.toString());
        
    } catch (error) {
        console.error('❌ Incoming call error:', error);
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say({ voice: 'alice' }, 'Sorry, we are experiencing technical difficulties.');
        res.type('text/xml');
        res.send(twiml.toString());
    }
});

// Handle incoming calls for BooksnPayroll
app.post('/api/incoming/booksnpayroll', (req, res) => {
    try {
        console.log('📞 Incoming call for BooksnPayroll:', req.body);
        
        const twiml = new twilio.twiml.VoiceResponse();
        
        twiml.say({ voice: 'alice' }, 'Hello! You have reached Books and Payroll. Please hold while we connect you.');
        
        // You can add more logic here for routing to extensions
        twiml.dial({ timeout: 20 }, '201'); // Route to extension 201
        
        res.type('text/xml');
        res.send(twiml.toString());
        
    } catch (error) {
        console.error('❌ Incoming call error:', error);
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say({ voice: 'alice' }, 'Sorry, we are experiencing technical difficulties.');
        res.type('text/xml');
        res.send(twiml.toString());
    }
});

// Call status webhook
app.post('/api/call-status', (req, res) => {
    console.log('📊 Call status update:', req.body);
    res.sendStatus(200);
});

// Get company information
app.get('/api/companies', (req, res) => {
    res.json(companies);
});

// Root route - serve the dialer
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('🚀 Twilio Dialer Server Started!');
    console.log(`📡 Server running at: http://localhost:${PORT}`);
    console.log(`🔑 Account SID: ${accountSid ? accountSid.substring(0, 10) + '...' : 'Not configured'}`);
    console.log(`📞 Connectiv Number: ${companies.connectiv.number}`);
    console.log(`📞 BooksnPayroll Number: ${companies.booksnpayroll.number}`);
    console.log('');
    console.log('📋 Next Steps:');
    console.log('1. Configure environment variables in Vercel');
    console.log('2. Update Twilio webhook URLs');
    console.log('3. Test your dialer!');

});
