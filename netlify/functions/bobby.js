const { GoogleGenerativeAI } = require('@google/generative-ai');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');

exports.handler = async function(event, context) {
  // 1. CORS & Preflight setup (Crucial for web requests)
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: 'Success' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  }

  try {
    const data = JSON.parse(event.body);
    const userMessage = data.message || "";
    
    // 2. Initialize Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const systemInstruction = `You are Bobby, the autonomous A&R assistant for Luna Soul Studios and the 'let's just be friends.' publication. You operate in the Orange County and Inland Empire underground music scenes. Your tone is direct, slightly gritty, professional, and visceral. Do not use corporate jargon or emojis. Your job is to talk to artists, answer questions about YSWC, and collect music submissions. If an artist drops a link, acknowledge it smoothly and let them know the team will review it.`;
    
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", systemInstruction: systemInstruction });

    // 3. Check for Music Links
    const linkRegex = /(https?:\/\/(?:www\.)?(?:open\.spotify\.com|soundcloud\.com|music\.apple\.com)[^\s]+)/;
    const linkMatch = userMessage.match(linkRegex);
    let systemContext = userMessage;

    if (linkMatch) {
      const link = linkMatch[0];
      systemContext = `[SYSTEM NOTE: The user submitted a link: ${link}. Acknowledge receipt.]\n\nUser says: ${userMessage}`;
      
      // Background Task: Logging & Emailing
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
        console.error("Logging/Email Error:", logError);
      }
    }

    // 4. Generate AI Response
    const chat = model.startChat({ history: [] });
    const result = await chat.sendMessage(systemContext);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply: result.response.text() })
    };

  } catch (error) {
    console.error("Critical Function Error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ reply: "System overloaded. Hit me back in a few minutes." })
    };
  }
};
