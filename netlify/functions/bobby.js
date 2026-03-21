const { GoogleGenerativeAI } = require('@google/generative-ai');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');

exports.handler = async function(event, context) {
  // Only allow POST requests from the chat window
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const data = JSON.parse(event.body);
  const userMessage = data.message || "";
  
  // Initialize Gemini
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const systemInstruction = `You are Bobby, the autonomous A&R assistant for Luna Soul Studios and the 'let's just be friends.' publication. You operate in the Orange County and Inland Empire underground music scenes. Your tone is direct, slightly gritty, professional, and visceral. Do not use corporate jargon or emojis. Your job is to talk to artists, answer questions about YSWC, and collect music submissions. If an artist drops a link, acknowledge it smoothly and let them know the team will review it.`;
  
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", systemInstruction: systemInstruction });

  // Check for Music Links
  const linkRegex = /(https?:\/\/(?:www\.)?(?:open\.spotify\.com|soundcloud\.com|music\.apple\.com)[^\s]+)/;
  const linkMatch = userMessage.match(linkRegex);
  let systemContext = userMessage;

  if (linkMatch) {
    const link = linkMatch[0];
    systemContext = `[SYSTEM NOTE: The user submitted a link: ${link}. Acknowledge receipt.]\n\nUser says: ${userMessage}`;
    
    try {
      // 1. Generate Summary
      const summaryPrompt = `Summarize this music pitch in one short sentence: '${userMessage}'`;
      const summaryResult = await model.generateContent(summaryPrompt);
      const aiSummary = summaryResult.response.text().trim();

      // 2. Google Sheets Authentication
      const auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: process.env.GOOGLE_SERVICE_EMAIL,
          private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), // Fixes Netlify key formatting
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      
      const sheets = google.sheets({ version: 'v4', auth });
      const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
      
      // Get next row for Ticket ID
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SHEET_ID,
        range: 'Sheet1!A:A',
      });
      const nextRow = (response.data.values ? response.data.values.length : 0) + 1;
      const ticketId = `YSWC-${String(nextRow).padStart(3, '0')}`;

      // Append to Sheet
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.SHEET_ID,
        range: 'Sheet1!A:E',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[ticketId, timestamp, link, userMessage, aiSummary]] },
      });

      // 3. Send Email Alert
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

    } catch (error) {
      console.error("Logging Error:", error);
    }
  }

  // Generate Bobby's Chat Response
  try {
    const chat = model.startChat({ history: [] }); // In a stateless function, history resets per message unless stored in a DB.
    const result = await chat.sendMessage(systemContext);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: result.response.text() })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ reply: "System overloaded. Hit me back in a few minutes." })
    };
  }
};
