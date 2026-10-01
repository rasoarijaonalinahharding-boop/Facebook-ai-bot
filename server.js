const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(bodyParser.json());

// Alao ny Token sy ny Secret avy amin'ny Render Environment Variables
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Fanombohana an'ilay SDK vaovao Google Gen AI
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// Fizarana Webhook ho an'ny Meta (Facebook Messenger Verification)
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    } else {
        res.sendStatus(400);
    }
});

// Fizarana handraisana ny hafatra avy amin'ny mpampiasa
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        for (const entry of body.entry) {
            const webhookEvent = entry.messaging[0];
            const senderPsid = webhookEvent.sender.id;

            if (webhookEvent.message && webhookEvent.message.text) {
                const userPrompt = webhookEvent.message.text;
                
                try {
                    // Miantso an'i Gemini mampiasa ilay model marina
                    const response = await ai.models.generateContent({
                        model: 'gemini-2.0-flash',
                        contents: userPrompt,
                    });

                    const botReply = response.text || "Miala tsiny, tsy nahazo valiny aho.";
                    
                    // Mandefa ny valiny hiverinaany amin'ny mpampiasa ao amin'ny Messenger
                    await callSendAPI(senderPsid, botReply);
                } catch (error) {
                    console.error("Hadisoana tamin'ny AI:", error);
                    await callSendAPI(senderPsid, "Miala tsiny, nisy olana kely tamin'ny fiasan'ny AI tamin'ity indray mitoraka ity.");
                }
            }
        }
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// Asa mandefa ny hafatra any amin'ny Facebook Send API
async function callSendAPI(senderPsid, responseText) {
    const requestBody = {
        recipient: { id: senderPsid },
        message: { text: responseText }
    };

    try {
        await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, requestBody);
    } catch (error) {
        console.error("Tsy tafita ny hafatra any amin'ny Messenger:", error.response ? error.response.data : error.message);
    }
}

// Famelabelarana ny Serivisy
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Mandeha eo amin'ny Port ${PORT} ny Server-nao.`);
});
