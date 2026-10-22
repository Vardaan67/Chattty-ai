
import express from 'express';

const app = express();
const port = Number(process.env.PORT || 3000);
const gpt4allUrl = 'http://127.0.0.1:4891/v1';

app.use(express.json({ limit: '32kb' }));
app.use(express.static('.'));

async function searchWikipedia(query) {
  try {
    const url = new URL('https://en.wikipedia.org/w/api.php');
    url.search = new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrsearch: query,
      gsrlimit: '3',
      prop: 'extracts',
      exintro: '1',
      explaintext: '1',
      exchars: '1200',
      format: 'json',
      origin: '*'
    }).toString();

    const response = await fetch(url, {
      headers: { 'User-Agent': 'ChatttyAI/1.0 (personal chatbot)' },
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) return '';

    const data = await response.json();
    const pages = Object.values(data.query?.pages || {});

    return pages.map(page =>
      `Article: ${page.title}\n${page.extract || ''}`
    ).join('\n\n').slice(0, 5000);
  } catch (error) {
    console.error('Wikipedia lookup failed:', error.message);
    return '';
  }
}

app.get('/api/health', async (_req, res) => {
  try {
    const response = await fetch(`${gpt4allUrl}/models`);
    const data = await response.json();

    res.json({
      ok: response.ok,
      aiConfigured: response.ok,
      models: data.data?.map(model => model.id) || []
    });
  } catch {
    res.status(503).json({
      ok: false,
      aiConfigured: false,
      error: 'Open GPT4All and enable its Local API Server.'
    });
  }
});

app.post('/api/chat', async (req, res) => {
  const messages = req.body?.messages;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Please send a message first.' });
  }

  const safeMessages = messages.slice(-20).map(message => {
    if (
      !message ||
      !['user', 'assistant'].includes(message.role) ||
      typeof message.content !== 'string'
    ) {
      return null;
    }

    return {
      role: message.role,
      content: message.content.slice(0, 4000)
    };
  });

  if (
    safeMessages.some(message => message === null) ||
    !safeMessages.some(message => message.role === 'user')
  ) {
    return res.status(400).json({
      error: 'The chat message format was not valid.'
    });
  }

  try {
    const modelsResponse = await fetch(`${gpt4allUrl}/models`);

    if (!modelsResponse.ok) {
      throw new Error('Could not retrieve GPT4All models.');
    }

    const modelsData = await modelsResponse.json();
    const model = modelsData.data?.[0]?.id;

    if (!model) {
      throw new Error('No model is loaded in GPT4All.');
    }

    const lastUserMessage = [...safeMessages]
      .reverse()
      .find(message => message.role === 'user');

    const searchTerms = lastUserMessage.content
      .replace(/https?:\/\/\S+/g, '')
      .slice(0, 200);

    const webContext = await searchWikipedia(searchTerms);

    const systemMessage = {
      role: 'system',
      content:
        'You are Chattty AI, a friendly, helpful chatbot. Answer clearly and accurately. ' +
        'If the supplied reference information answers the question, use it. ' +
        'Reference information may be incomplete or outdated; never invent facts. ' +
        'If it does not answer the question, be honest about uncertainty. ' +
        'Keep answers appropriate for a general audience.\n\n' +
        'Reference information from Wikipedia search:\n' +
        (webContext || 'No relevant Wikipedia information was found. Do not pretend a search succeeded.')
    };

    const response = await fetch(`${gpt4allUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [systemMessage, ...safeMessages],
        max_tokens: 1024,
        temperature: 0.7,
        stream: false
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('GPT4All error:', JSON.stringify(data));
      return res.status(502).json({
        error: 'GPT4All could not generate a reply. Check that your model is loaded.'
      });
    }

    return res.json({
      reply: data.choices?.[0]?.message?.content ||
        'Sorry, I could not create a reply this time.'
    });
  } catch (error) {
    console.error('Chattty request failed:', error.message);

    return res.status(502).json({
      error: 'Could not connect to GPT4All. Make sure the app is open and its Local API Server is enabled.'
    });
  }
});

app.listen(port, () => {
  console.log(`Chattty AI is running at http://localhost:${port}`);
});
