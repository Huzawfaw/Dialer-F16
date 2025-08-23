const express = require('express');
const twilio = require('twilio');
const path = require('path');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Twilio credentials
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twimlAppSid = process.env.TWILIO_TWIML_APP_SID;

const client = twilio(accountSid, authToken);
const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

// Store active connections and call states
const activeConnections = new Map();
const callStates = new Map();

// Company configurations
const companies = {
    connectiv: {
        name: 'Connectiv',
        phoneNumber: '+18562307373',
        extensions: {
            101: { name: 'Reception', available: true },
            102: { name: 'Sales', available: true },
            103: { name: 'Support', available: true },
            104: { name: 'Manager', available: true }
        }
    },
    booksnpayroll: {
        name: 'Books and Payroll',
        phoneNumber: '+18564053544',
        extensions: {
            201: { name: 'Accounting', available: true },
            202: { name: 'Payroll', available: true },
            203: { name: 'Bookkeeping', available: true },
            204: { name: 'Manager', available: true }
        }
    }
};

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        activeConnections: activeConnections.size,
        callStates: callStates.size
    });
});

// Generate access token for Twilio Device
app.post('/api/token', (req, res) => {
    try {
        const { identity, company } = req.body;
        
        if (!identity || !company) {
            return res.status(400).json({ error: 'Identity and company are required' });
        }

        if (!companies[company]) {
            return res.status(400).json({ error: 'Invalid company' });
        }

        // Create access token
        const accessToken = new AccessToken(accountSid, accountSid, authToken, {
            identity: identity,
            ttl: 3600 // 1 hour
        });

        // Create voice grant
        const voiceGrant = new VoiceGrant({
            outgoingApplicationSid: twimlAppSid,
            incomingAllow: true
        });

        accessToken.addGrant(voiceGrant);

        // Store connection info
        activeConnections.set(identity, {
            company: company,
            extension: identity.replace('ext_', ''),
            connectedAt: new Date(),
            available: true
        });

        console.log(`✅ Token generated for ${identity} (${company})`);

        res.json({
            token: accessToken.toJwt(),
            identity: identity,
            company: company
        });

    } catch (error) {
        console.error('❌ Token generation error:', error);
        res.status(500).json({ error: 'Failed to generate token' });
    }
});

// Handle outbound calls from dialer
app.post('/api/voice', (req, res) => {
    try {
        console.log('📞 Outbound call request:', req.body);
        
        const { To, From } = req.body;
        const callerIdentity = From || req.body.identity;
        
        const twiml = new twilio.twiml.VoiceResponse();
        
        if (To) {
            // Direct dial to external number
            console.log(`📞 Dialing ${To} from ${callerIdentity}`);
            
            const dial = twiml.dial({
                callerId: getCallerIdForIdentity(callerIdentity),
                record: 'record-from-answer',
                recordingStatusCallback: '/api/recording-status'
            });
            
            dial.number(To);
            
        } else {
            // No destination provided
            twiml.say({ voice: 'alice' }, 'Please specify a number to dial.');
        }

        res.type('text/xml');
        res.send(twiml.toString());
        
    } catch (error) {
        console.error('❌ Outbound call error:', error);
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
        
        const { From, CallSid } = req.body;
        const twiml = new twilio.twiml.VoiceResponse();
        
        // Store call state
        callStates.set(CallSid, {
            from: From,
            company: 'connectiv',
            startTime: new Date(),
            status: 'incoming'
        });
        
        // Create menu for caller
        const gather = twiml.gather({
            numDigits: 1,
            action: '/api/incoming/connectiv/menu',
            method: 'POST',
            timeout: 10
        });
        
        gather.say({ 
            voice: 'alice' 
        }, 'Hello! You have reached Connectiv. Press 1 for Reception, Press 2 for Sales, Press 3 for Support, or Press 4 for Manager. Or stay on the line to be connected to Reception.');
        
        // Default action if no input
        twiml.redirect('/api/incoming/connectiv/default');
        
        res.type('text/xml');
        res.send(twiml.toString());
        
    } catch (error) {
        console.error('❌ Incoming call error:', error);
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say({ voice: 'alice' }, 'Hello, thank you for calling Connectiv.');
        res.type('text/xml');
        res.send(twiml.toString());
    }
});

// Handle Connectiv menu selection
app.post('/api/incoming/connectiv/menu', (req, res) => {
    try {
        const { Digits, CallSid } = req.body;
        const twiml = new twilio.twiml.VoiceResponse();
        
        let extension;
        let extensionName;
        
        switch(Digits) {
            case '1':
                extension = '101';
                extensionName = 'Reception';
                break;
            case '2':
                extension = '102';
                extensionName = 'Sales';
                break;
            case '3':
                extension = '103';
                extensionName = 'Support';
                break;
            case '4':
                extension = '104';
                extensionName = 'Manager';
                break;
            default:
                extension = '101';
                extensionName = 'Reception';
        }
        
        console.log(`📞 Connecting to ${extensionName} (ext ${extension})`);
        
        twiml.say({ voice: 'alice' }, `Connecting you to ${extensionName}. Please hold.`);
        
        // Try to connect to extension
        const availableAgent = findAvailableAgent('connectiv', extension);
        
        if (availableAgent) {
            // Connect to available agent
            const dial = twiml.dial({
                timeout: 30,
                action: '/api/call-status',
                method: 'POST'
            });
            
            dial.client(availableAgent);
        } else {
            // No agents available, leave voicemail or callback
            twiml.say({ voice: 'alice' }, `Sorry, ${extensionName} is not available right now. Please leave a message after the beep.`);
            twiml.record({
                action: '/api/voicemail',
                method: 'POST',
                maxLength: 60,
                finishOnKey: '#'
            });
        }
        
        res.type('text/xml');
        res.send(twiml.toString());
        
    } catch (error) {
        console.error('❌ Menu selection error:', error);
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say({ voice: 'alice' }, 'Connecting you to our main line.');
        res.type('text/xml');
        res.send(twiml.toString());
    }
});

// Handle Connectiv default (no menu selection)
app.post('/api/incoming/connectiv/default', (req, res) => {
    const twiml = new twilio.twiml.VoiceResponse();
    
    twiml.say({ voice: 'alice' }, 'Connecting you to Reception.');
    
    const availableAgent = findAvailableAgent('connectiv', '101');
    
    if (availableAgent) {
        const dial = twiml.dial({ timeout: 30 });
        dial.client(availableAgent);
    } else {
        twiml.say({ voice: 'alice' }, 'All agents are busy. Please leave a message.');
        twiml.record({
            action: '/api/voicemail',
            method: 'POST',
            maxLength: 60
        });
    }
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// Handle incoming calls for BooksnPayroll
app.post('/api/incoming/booksnpayroll', (req, res) => {
    try {
        console.log('📞 Incoming call for BooksnPayroll:', req.body);
        
        const { From, CallSid } = req.body;
        const twiml = new twilio.twiml.VoiceResponse();
        
        callStates.set(CallSid, {
            from: From,
            company: 'booksnpayroll',
            startTime: new Date(),
            status: 'incoming'
        });
        
        const gather = twiml.gather({
            numDigits: 1,
            action: '/api/incoming/booksnpayroll/menu',
            method: 'POST',
            timeout: 10
        });
        
        gather.say({ 
            voice: 'alice' 
        }, 'Hello! You have reached Books and Payroll. Press 1 for Accounting, Press 2 for Payroll, Press 3 for Bookkeeping, or Press 4 for Manager.');
        
        twiml.redirect('/api/incoming/booksnpayroll/default');
        
        res.type('text/xml');
        res.send(twiml.toString());
        
    } catch (error) {
        console.error('❌ Incoming call error:', error);
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say({ voice: 'alice' }, 'Hello, thank you for calling Books and Payroll.');
        res.type('text/xml');
        res.send(twiml.toString());
    }
});

// Handle BooksnPayroll menu selection
app.post('/api/incoming/booksnpayroll/menu', (req, res) => {
    try {
        const { Digits } = req.body;
        const twiml = new twilio.twiml.VoiceResponse();
        
        let extension;
        let extensionName;
        
        switch(Digits) {
            case '1':
                extension = '201';
                extensionName = 'Accounting';
                break;
            case '2':
                extension = '202';
                extensionName = 'Payroll';
                break;
            case '3':
                extension = '203';
                extensionName = 'Bookkeeping';
                break;
            case '4':
                extension = '204';
                extensionName = 'Manager';
                break;
            default:
                extension = '201';
                extensionName = 'Accounting';
        }
        
        console.log(`📞 Connecting to ${extensionName} (ext ${extension})`);
        
        twiml.say({ voice: 'alice' }, `Connecting you to ${extensionName}.`);
        
        const availableAgent = findAvailableAgent('booksnpayroll', extension);
        
        if (availableAgent) {
            const dial = twiml.dial({ timeout: 30 });
            dial.client(availableAgent);
        } else {
            twiml.say({ voice: 'alice' }, `${extensionName} is not available. Please leave a message.`);
            twiml.record({
                action: '/api/voicemail',
                method: 'POST',
                maxLength: 60
            });
        }
        
        res.type('text/xml');
        res.send(twiml.toString());
        
    } catch (error) {
        console.error('❌ Menu selection error:', error);
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say({ voice: 'alice' }, 'Connecting you to our main line.');
        res.type('text/xml');
        res.send(twiml.toString());
    }
});

// Handle BooksnPayroll default
app.post('/api/incoming/booksnpayroll/default', (req, res) => {
    const twiml = new twilio.twiml.VoiceResponse();
    
    twiml.say({ voice: 'alice' }, 'Connecting you to Accounting.');
    
    const availableAgent = findAvailableAgent('booksnpayroll', '201');
    
    if (availableAgent) {
        const dial = twiml.dial({ timeout: 30 });
        dial.client(availableAgent);
    } else {
        twiml.say({ voice: 'alice' }, 'All agents are busy. Please leave a message.');
        twiml.record({
            action: '/api/voicemail',
            method: 'POST',
            maxLength: 60
        });
    }
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// Handle call status updates
app.post('/api/call-status', (req, res) => {
    console.log('📊 Call status update:', req.body);
    
    const { CallSid, CallStatus, Duration } = req.body;
    
    if (callStates.has(CallSid)) {
        const callState = callStates.get(CallSid);
        callState.status = CallStatus;
        callState.duration = Duration;
        callState.endTime = new Date();
        
        console.log(`📊 Call ${CallSid} status: ${CallStatus}, Duration: ${Duration}s`);
    }
    
    res.status(200).send('OK');
});

// Handle voicemail recordings
app.post('/api/voicemail', (req, res) => {
    console.log('📧 Voicemail received:', req.body);
    
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say({ voice: 'alice' }, 'Thank you for your message. We will get back to you soon. Goodbye.');
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// Handle recording status
app.post('/api/recording-status', (req, res) => {
    console.log('🎙️ Recording status:', req.body);
    res.status(200).send('OK');
});

// Get company extensions
app.get('/api/extensions/:company', (req, res) => {
    const { company } = req.params;
    
    if (!companies[company]) {
        return res.status(404).json({ error: 'Company not found' });
    }
    
    res.json({
        company: companies[company].name,
        extensions: companies[company].extensions
    });
});

// Update extension availability
app.post('/api/extensions/:company/:extension/status', (req, res) => {
    const { company, extension } = req.params;
    const { available } = req.body;
    
    if (!companies[company] || !companies[company].extensions[extension]) {
        return res.status(404).json({ error: 'Extension not found' });
    }
    
    companies[company].extensions[extension].available = available;
    
    res.json({
        extension: extension,
        available: available
    });
});

// Get active connections
app.get('/api/connections', (req, res) => {
    const connections = Array.from(activeConnections.entries()).map(([identity, data]) => ({
        identity,
        ...data
    }));
    
    res.json({ connections });
});

// Helper functions
function findAvailableAgent(company, preferredExtension) {
    // First, try to find someone logged into the preferred extension
    for (const [identity, connection] of activeConnections) {
        if (connection.company === company && 
            connection.extension === preferredExtension && 
            connection.available) {
            return identity;
        }
    }
    
    // If no one is on the preferred extension, find any available agent for this company
    for (const [identity, connection] of activeConnections) {
        if (connection.company === company && connection.available) {
            return identity;
        }
    }
    
    return null;
}

function getCallerIdForIdentity(identity) {
    const connection = activeConnections.get(identity);
    if (connection) {
        return companies[connection.company].phoneNumber;
    }
    return '+18562307373'; // Default
}

// Cleanup inactive connections periodically
setInterval(() => {
    const now = new Date();
    for (const [identity, connection] of activeConnections) {
        const timeDiff = now - connection.connectedAt;
        if (timeDiff > 4 * 60 * 60 * 1000) { // 4 hours
            console.log(`🧹 Cleaning up inactive connection: ${identity}`);
            activeConnections.delete(identity);
        }
    }
}, 30 * 60 * 1000); // Check every 30 minutes

app.listen(port, () => {
    console.log(`🚀 Twilio Dialer Server running on port ${port}`);
    console.log(`📞 Companies configured: ${Object.keys(companies).join(', ')}`);
});

module.exports = app;
