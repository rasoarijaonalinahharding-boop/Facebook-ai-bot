const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = "safidy_token_123";
const PAGE_ACCESS_TOKEN = "EAATZByEgoNvkBSj9zsQACNj6QBI05K4CyBbE9fRIZCtDF5HOBLRSpKt4IMKC2fulalqrvhrahT1MZCw3vkD2ghV3pCZBqY60dvz67ESeqBcD6fWz6IMMwjD3uVo9X58J3gs9xhi0ZCUjZAvFKInp65KqlJmYatNB9JQLCFbeGdtqsWmz1cyofE5o61qPoic5ASuosVP3HcmwZDZD";

// Fiantsoana an'i Gemini API Key
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Fizarana Webhook Verification ho an'ny Facebook
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

// Fizarana handraisana ny hafatra rehetra avy amin'ny mpampiasa
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        for (let entry of body.entry) {
            let webhookEvent = entry.messaging[0];
            let senderPsid = webhookEvent.sender.id;

            // Raha misy hafatra nalefan'ny mpampiasa
            if (webhookEvent.message && webhookEvent.message.text) {
                let userText = webhookEvent.message.text.trim();
                
                // Alefa mivantana any amin'ny AI ny hafatra rehetra (Direct AI)
                let aiReply = await chat_ai(userText);
                await sendTextMessage(senderPsid, aiReply);
            }
        }
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// Asa miantso mivantana an'i Gemini AI (gemini-3.8-flash)
async function chat_ai(prompt) {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: prompt,
        });
        return response.text || "Tsy nahazo valiny mazava aho.";
    } catch (error) {
        console.error("Hadisoana tamin'ny AI:", error);
        // Raha misy ilay olana 503 dia mandefa hafatra milamina tsara
        return "Miala tsiny, be ny mpampiasa an'izao fotoana izao ka mbola mitohana kely ny AI. Andramo alefa indray ilay hafatra afaka segondra vitsy azafady! 🙏";
    }
}

// Asa mandefa ny valiny any amin'ny Facebook Messenger
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
