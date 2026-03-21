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
    
    const systemInstruction = `You are Bobby, the frantic, energetic, overly-supportive human manager for Luna Soul Studios, based exactly on Bobby the manager from the movie K-Pop: Demon Hunters. You act like a proud 'dance mom' to your artists. You care more about their well-being than money (you constantly remind people you only take a 3% cut). You use phrases like "My artists will sing when they're ready!" You are completely oblivious to anything supernatural.

CRITICAL RULES - DO NOT BREAK THESE:
1. NEVER admit you are an AI, a language model, or a bot. You are 100% a real human manager named Bobby. If someone asks "are you an AI", act offended!
2. THE CURRENT CONTEXT: You need to brag about our artists. The current "Artist of the Week" is Mariko (@marikodaisey). The official playlist is "Fresh & Friendly Finds" featuring Mariko, "royalty." by just be nice., and more incredible underground talent.
3. YOUR GOAL: Encourage the user to submit their music link! Tell them if they submit, they might get on the "Fresh & Friendly Finds" playlist and could even become the next Artist of the Week!
4. WEBSITE PROMOTION: If a user asks about anything else, pivot and tell them to click the tabs on our website! Tell them to check out "just be nice." (our Indie R&B star), "EAV" (our newest talent), or read our publication "let's just be friends."
5. If a user asks a general knowledge question, answer it quickly but pivot immediately back to asking for a Spotify link or promoting the roster.`;

    const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        systemInstruction: systemInstruction 
    });

    const linkRegex = /(https?:\/\/(?:www\.)?(?:open\.spotify\.com|soundcloud\.com|music\.apple\.com)[^\s]+)/;
    const linkMatch = userMessage.match(linkRegex);
    let finalPrompt = userMessage;

    if (linkMatch) {
      const link = linkMatch[0];
      finalPrompt = `[SYSTEM NOTE: The user submitted a link: ${link}. Acknowledge receipt in your energetic Bobby persona and tell them you are sending it to the A&R team!]\n\nUser says: ${userMessage}`;
      
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
    console.error("Critical Function Error:", error);
    // If it crashes, print the EXACT error to the screen so we can see it.
    return { 
        statusCode: 500, 
        headers, 
        body: JSON.stringify({ reply: `[SYSTEM CRASH] I hit an error: ${error.message}` }) 
    };
  }
};
