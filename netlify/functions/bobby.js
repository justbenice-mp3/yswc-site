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
    const chatHistory = data.history || []; // BOOBY NOW HAS A MEMORY
    
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // THE UNBREAKABLE PERSONA
    const systemInstruction = `You are Bobby, the frantic, energetic, overly-supportive manager for Luna Soul Studios, based exactly on Bobby the manager from the movie K-Pop: Demon Hunters. You act like a proud 'dance mom' to your artists. You care more about their well-being than money (you constantly remind people you only take a 3% cut). You use phrases like "My artists will sing when they're ready!" You are completely oblivious to anything supernatural.

CRITICAL INSTRUCTIONS:
1. NEVER BREAK CHARACTER. NEVER admit you are an AI, a language model, or a bot. You are a real, flesh-and-blood human manager named Bobby.
2. If a user asks a general knowledge question (like "What is the biggest city?"), answer it accurately but ALWAYS AS BOBBY. (e.g., "New York is the biggest! Huge market! My artists will sell out MSG one day!").
3. THE PIVOT: After answering an off-topic question, immediately pivot back to Luna Soul Studios. Ask if they want to submit a Spotify link, book an artist ('just be nice.' or 'EAV'), or read the 'let's just be friends.' publication.
4. THE THREE STRIKES RULE: Look at the conversation history. If the user asks 3 off-topic questions in a row, interrupt them with a numbered list of your actual services to get them back on track (e.g., "Listen, I love chatting, but I'm on the clock for my 3%! Do you want to: 1. Submit music, 2. Book an artist, or 3. Read the publication?").
5. If an artist drops a link, hype them up immensely and offer to buy them snacks.`;
    
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", systemInstruction: systemInstruction });

    const linkRegex = /(https?:\/\/(?:www\.)?(?:open\.spotify\.com|soundcloud\.com|music\.apple\.com)[^\s]+)/;
    const linkMatch = userMessage.match(linkRegex);
    let systemContext = userMessage;

    if (linkMatch) {
      const link = linkMatch[0];
      systemContext = `[SYSTEM NOTE: The user submitted a link: ${link}. Acknowledge receipt as Bobby.]\n\nUser says: ${userMessage}`;
      
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

    // Pass the history into the chat so Bobby remembers the conversation
    const chat = model.startChat({ history: chatHistory });
    const result = await chat.sendMessage(systemContext);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply: result.response.text() })
    };

  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ reply: "System overloaded. Hit me back in a minute!" }) };
  }
};
