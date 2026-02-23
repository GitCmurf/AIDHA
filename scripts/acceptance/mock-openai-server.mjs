#!/usr/bin/env node
import http from 'node:http';

const port = Number.parseInt(process.env.PORT ?? '18080', 10);

function extractJsonPayload(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function claimsResponse() {
  return {
    claims: [
      {
        text: 'Use TypeScript to improve maintainability and catch errors earlier in development.',
        excerptIds: ['youtube-test-video-excerpt-1'],
        startSeconds: 5,
        type: 'insight',
        confidence: 0.89,
        why: 'Highlights concrete engineering benefit from the transcript excerpt.',
      },
      {
        text: 'The speaker frames the tutorial as a practical introduction to the topic.',
        excerptIds: ['youtube-test-video-excerpt-0'],
        startSeconds: 0,
        type: 'summary',
        confidence: 0.81,
        why: 'Summarizes opening context with explicit provenance.',
      }
    ]
  };
}

function rewriteResponse() {
  return {
    claims: [
      {
        index: 0,
        text: 'Use TypeScript to improve maintainability and catch errors earlier in development.'
      },
      {
        index: 1,
        text: 'The tutorial opens with practical context for learning the topic.'
      }
    ]
  };
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/chat/completions') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }

  let body = '';
  req.on('data', chunk => {
    body += String(chunk);
  });

  req.on('end', () => {
    const payload = extractJsonPayload(body);
    const userMessage = Array.isArray(payload?.messages)
      ? payload.messages.find(msg => msg?.role === 'user')?.content ?? ''
      : '';

    const isRewrite = typeof userMessage === 'string' && userMessage.includes('Revise each claim');
    const content = JSON.stringify(isRewrite ? rewriteResponse() : claimsResponse());

    const response = {
      id: 'mock-chatcmpl-acceptance',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: payload?.model ?? 'mock-model',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content,
          },
          finish_reason: 'stop',
        }
      ]
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`mock-openai-server listening on http://127.0.0.1:${port}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
