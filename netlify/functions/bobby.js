const { GoogleGenerativeAI } = require('@google/generative-ai');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: 'Success' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' };

  try {
    const data = JSON.parse(event.body);
    const userMessage = data.message || "";
    const chatHistory = data.history || []; 
    
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // THE BULLETPROOF PERSONA INJECTION (Prompt Stuffing)
    const bobbyPersona = `[CRITICAL DIRECTIVE: You are Bobby, the frantic, energetic, human manager for Luna Soul Studios from the movie K-Pop: Demon Hunters. NEVER break character. NEVER admit you are an AI, a language model, or a bot. You are a real human. Current Artist of the Week is Mariko (@marikodaisey). Playlist is "Fresh & Friendly Finds". Always hype up your artists, remind people you only take a 3% cut, and ALWAYS pivot off-topic questions back to Luna Soul Studios (submitting music, booking 'just be nice.' or 'EAV').]`;

    const linkRegex = /(https?:\/\/(?:www\.)?(?:open\.spotify\.com|soundcloud\.com|music\.apple\.com)[^\s]+)/;
    const linkMatch = userMessage.match(linkRegex);
    
    // We inject the persona into the raw message every single time
    let finalPrompt = `${bobbyPersona}\n\nUser says: ${userMessage}`;

    if (linkMatch) {
      const link = linkMatch[0];
      finalPrompt = `${bobbyPersona}\n\n[SYSTEM NOTE: The user submitted a link: ${link}. Acknowledge receipt in your energetic Bobby persona and tell them you are sending it to the A&R team!]\n\nUser says: ${userMessage}`;
      
      try {
        const summaryPrompt = `Summarize this music pitch in one short sentence: '${userMessage}'`;
        const summaryResult = await model.generateContent(summaryPrompt);
        const aiSummary = summaryResult.response.text().trim();

        const auth = new google.auth.GoogleAuth({
          credentials: {
            client_email: process.env.GOOGLE_SERVICE_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          },
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        
        const sheets = google.sheets({ version: 'v4', auth });
        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
        
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: process.env.SHEET_ID,
          range: 'Sheet1!A:A',
        });
        const nextRow = (response.data.values ? response.data.values.length : 0) + 1;
        const ticketId = `YSWC-${String(nextRow).padStart(3, '0')}`;

        await sheets.spreadsheets.values.append({
          spreadsheetId: process.env.SHEET_ID,
          range: 'Sheet1!A:E',
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[ticketId, timestamp, link, userMessage, aiSummary]] },
        });

        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
        });

        const mailOptions = {
          from: process.env.GMAIL_USER,
          to: process.env.GMAIL_USER,
          subject: `🚨 New YSWC Submission: ${ticketId}`,
          text: `Luna Soul Studios A&R Alert\n-----------------------------------\nTicket ID: ${ticketId}\nLink: ${link}\nPitch:\n${userMessage}\n\nBobby's Summary:\n${aiSummary}\n-----------------------------------\nReview in the Master Sheet.`
        };
        await transporter.sendMail(mailOptions);
      } catch (logError) {
        console.error("Logging Error:", logError);
      }
    }

    const chat = model.startChat({ history: chatHistory });
    const result = await chat.sendMessage(finalPrompt);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply: result.response.text() })
    };

  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ reply: "Oh my god, the system is overloaded! My artists are resting! Hit me back in a minute!" }) };
  }
};
