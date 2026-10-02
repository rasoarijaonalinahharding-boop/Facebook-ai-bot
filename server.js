const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = "safidy_token_123";
const PAGE_ACCESS_TOKEN = "EAATZByEgoNvkBSj9zsQACNj6QBI05K4CyBbE9fRIZCtDF5HOBLRSpKt4IMKC2fulalqrvhrahT1MZCw3vkD2ghV3pCZBqY60dvz67ESeqBcD6fWz6IMMwjD3uVo9X58J3gs9xhi0ZCUjZAvFKInp65KqlJmYatNB9JQLCFbeGdtqsWmz1cyofE5o61qPoic5ASuosVP3HcmwZDZD";
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Fitahirizana resaka (Memory) vonjimaika ho an'ny mpanjifa tsirairay (PSID)
const userSessions = {};

// 1. Webhook Verification
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

// 2. Fandraisana ny Event rehetra (Messenger sy Comments)
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        for (let entry of body.entry) {
            
            // A. Hafatra ao amin'ny Messenger
            if (entry.messaging) {
                let webhookEvent = entry.messaging[0];
                let senderPsid = webhookEvent.sender.id;

                if (webhookEvent.message && webhookEvent.message.text) {
                    let userText = webhookEvent.message.text.trim();
                    
                    // Fitehirizana ny tantaran'ny resaka (Memory)
                    if (!userSessions[senderPsid]) {
                        userSessions[senderPsid] = [
                            {
                                role: "system",
                                content: "Ianao dia i 'Safidy', bot mpivarotra sady mpanampy malagasy namoronin'i Safidy. Valio amin'ny teny Malagasy mazava, tsara fanahy ary fantaro ny resaka teo aloha."
                            }
                        ];
                    }
                    
                    userSessions[senderPsid].push({ role: "user", content: userText });

                    // Tazonina ho 10 farany fotsiny ny resaka mba tsy ho be loatra
                    if (userSessions[senderPsid].length > 11) {
                        userSessions[senderPsid].splice(1, 2);
                    }

                    let aiReply = await chat_groq(userSessions[senderPsid]);
                    userSessions[senderPsid].push({ role: "assistant", content: aiReply });

                    await sendTextMessage(senderPsid, aiReply);
                }
            }

            // B. Fanehoan-kevitra (Comments) + Private Reply otomatika
            if (entry.changes) {
                for (let change of entry.changes) {
                    if (change.field === 'feed' && change.value.item === 'comment' && change.value.verb === 'add') {
                        let commentId = change.value.comment_id;
                        let commentText = change.value.message;
                        let commenterId = change.value.from.id;

                        // Manao Like ny comment
                        await sendCommentReaction(commentId);

                        // Mandefa Private Reply any amin'ny Messenger an'ilay nanao comment
                        await sendPrivateReply(commenterId, `Misaotra anao naneho hevitra tamin'ny hoe: "${commentText}". Mba hanampianay anao haingana, inona no azontsika resahina?`);
                    }
                }
            }
        }
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// 3. Fiantsoana ny Groq API miaraka amin'ny Memory
async function chat_groq(messagesHistory) {
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "openai/gpt-oss-120b",
            messages: messagesHistory,
            temperature: 0.7
        }, {
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data.choices[0].message.content.trim();
    } catch (error) {
        console.error("Hadisoana tamin'ny Groq API:", error.response?.data || error.message);
        return `Miala tsiny tompoko, nisy olana kely tamin'ny rafitra. Afaka averinao indray ve ilay hafatra?`;
    }
}

// 4. Like Comment
async function sendCommentReaction(commentId) {
    try {
        await axios.post(`https://graph.facebook.com/v18.0/${commentId}/reactions?reaction_type=LIKE&access_token=${PAGE_ACCESS_TOKEN}`);
    } catch (error) {
        console.error("Tsy tafita ny reaction:", error.message);
    }
}

// 5. Mandefa Hafatra tsotra na misy Buttons ao amin'ny Messenger
async function sendTextMessage(recipientPsid, messageText) {
    try {
        await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: recipientPsid },
            message: { 
                text: messageText,
                // Ohatra amin'ny fampidirana buttons raha ilaina
                quick_replies: [
                    { content_type: "text", title: "Vokatra misy", payload: "PRODUIT" },
                    { content_type: "text", title: "Vidiny", payload: "PRIX" },
                    { content_type: "text", title: "Mifandray", payload: "CONTACT" }
                ]
            }
        });
    } catch (error) {
        console.error("Tsy tafita ilay hafatra:", error.response?.data || error.message);
    }
}

// 6. Mandefa Private Message ho setrin'ny Comment
async function sendPrivateReply(recipientId, messageText) {
    try {
        await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: recipientId },
            message: { text: messageText }
        });
    } catch (error) {
        console.error("Tsy tafita ny Private Reply:", error.response?.data || error.message);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Mandeha ny bot Safidy AI miaraka amin'ny Memory sy Private Reply eo amin'ny port ${PORT}`);
});
