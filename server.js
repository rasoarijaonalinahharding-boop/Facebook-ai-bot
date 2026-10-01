const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = "safidy_token_123";
const PAGE_ACCESS_TOKEN = "EAATZByEgoNvkBSj9zsQACNj6QBI05K4CyBbE9fRIZCtDF5HOBLRSpKt4IMKC2fulalqrvhrahT1MZCw3vkD2ghV3pCZBqY60dvz67ESeqBcD6fWz6IMMwjD3uVo9X58J3gs9xhi0ZCUjZAvFKInp65KqlJmYatNB9JQLCFbeGdtqsWmz1cyofE5o61qPoic5ASuosVP3HcmwZDZD";

// Mampiasa ny Environment Variable voatahiry ao amin'ny Render
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.get('/webhook', (req, res) => {
    let mode = req.query['hub.mode'];
    let token = req.query['hub.verify_token'];
    let challenge = req.query['hub.challenge'];
    if (mode && token === VERIFY_TOKEN) {
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        for (let entry of body.entry) {
            let webhookEvent = entry.messaging[0];
            let senderPsid = webhookEvent.sender.id;

            if (webhookEvent.postback && webhookEvent.postback.payload === 'GET_STARTED_PAYLOAD') {
                await sendIntroduction(senderPsid);
            } 
            else if (webhookEvent.message) {
                await handleUserMessage(senderPsid, webhookEvent.message);
            }
        }
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

async function sendIntroduction(senderPsid) {
    const introText = 
        `👋 Tonga soa eto amin'ny AI Bot!\n\n` +
        `Ity bot ity dia mampiasa AI matanjaka be! Afaka miresaka aminy ianao na mandefa fanontaniana rehetra tiany ho valiana. 🤖✨\n\n` +
        `Andao ary hanomboka! Manorata hafatra na fanontaniana eto.`;
    
    await sendTextMessage(senderPsid, introText);
}

async function handleUserMessage(senderPsid, message) {
    if (message.text) {
        const userPrompt = message.text;
        
        try {
            // Mampiasa ny gemini-1.5-flash izy izao mba ho azo antoka fa mandeha tsara
            const response = await ai.models.generateContent({
                model: 'gemini-1.5-flash',
                contents: userPrompt,
            });

            const aiReply = response.text || "Tsy nahazo valiny mazava aho.";
            await sendTextMessage(senderPsid, aiReply);

        } catch (error) {
            console.error("Hadisoana tamin'ny AI:", error);
            await sendTextMessage(senderPsid, "Miala tsiny, nisy olana kely tamin'ny fiasan'ny AI tamin'ity indray mitoraka ity.");
        }
    }
}

async function sendTextMessage(recipientPsid, messageText) {
    try {
        await axios.post('https://graph.facebook.com/v18.0/me/messages?access_token=' + PAGE_ACCESS_TOKEN, {
            recipient: { id: recipientPsid },
            message: { text: messageText }
        });
    } catch (error) {
        console.error("Tsy tafita ilay hafatra:", error.response?.data || error.message);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Mandeha ny bot AI eo amin'ny port ${PORT}`);
});
