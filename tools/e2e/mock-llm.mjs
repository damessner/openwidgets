#!/usr/bin/env node
// Mock LLM endpoint for the e2e suite (and local smoke tests).
// Speaks both provider dialects:
//   - OpenRouter: POST /api/v1/chat/completions
//   - Gemini:     POST /v1beta/models/<model>:generateContent
// Answers with canned, *valid* JSON depending on the prompt:
//   - "Ping"            -> {"ok":true}
//   - worksheet wizard  -> {title, description, items:[...]}
//   - tutor feedback    -> {summary, tips, exercises:[...]}
import http from 'node:http';
import { createItem } from '../../shared/items/index.js';

const PORT = Number(process.env.MOCK_LLM_PORT || 4196);

function mcItem(topic) {
  const item = createItem('multiple_choice', { id: 'it_mc1', points: 1 });
  item.stem = `Was ist das Hauptthema von „${topic}“?`;
  item.config.choices = [
    { id: 'c1', text: 'Photosynthese', correct: true },
    { id: 'c2', text: 'Verdauung', correct: false },
    { id: 'c3', text: 'Atmung', correct: false },
  ];
  item.feedback = { correct: 'Richtig!', incorrect: 'Schau dir das Thema noch einmal an.' };
  return item;
}

function shortAnswerItem(topic) {
  const item = createItem('short_answer', { id: 'it_sa1', points: 1 });
  item.stem = `Nenne ein wichtiges Wort zum Thema „${topic}“.`;
  item.config.accepted = ['Fotosynthese', 'Photosynthese', 'Licht'];
  return item;
}

function fillBlanksItem() {
  const item = createItem('fill_blanks', { id: 'it_fb1', points: 2 });
  item.stem = 'Ergänze die Lücke.';
  item.config.text = 'Bei der {{1}} entsteht aus Licht Zucker.';
  item.config.blanks = { 1: { accepted: ['Fotosynthese', 'Photosynthese'] } };
  return item;
}

function extractTopic(systemText, userText) {
  const match = String(userText || '').match(/Topic:\s*(.+)/);
  return match ? match[1].slice(0, 60) : 'das Thema';
}

function worksheetPayload(systemText, userText) {
  const topic = extractTopic(systemText, userText);
  return {
    title: `KI-Arbeitsblatt: ${topic}`,
    description: 'Automatisch generiert — bitte vor dem Veröffentlichen prüfen.',
    items: [mcItem(topic), shortAnswerItem(topic), fillBlanksItem()],
  };
}

function feedbackPayload() {
  const exercise = createItem('multiple_choice', { id: 'ex_mc1', points: 0 });
  exercise.stem = 'Übung: Welche Aussage zur Fotosynthese stimmt?';
  exercise.config.choices = [
    { id: 'c1', text: 'Sie braucht Licht.', correct: true },
    { id: 'c2', text: 'Sie braucht kein Wasser.', correct: false },
  ];
  return {
    summary: 'Gut gemacht! Du hast die Grundlagen verstanden. Übe besonders die Fachbegriffe.',
    tips: ['Wiederhole die Fachbegriffe laut.', 'Lies den Aufgabentext genau.'],
    exercises: [exercise],
  };
}

function writingPayload() {
  return {
    summary: 'Guter Anfang — baue die Argumentation noch aus.',
    criteria: [
      { id: 'c1', label: 'Inhalt', met: 0.6, comment: 'Zwei Argumente sind gut.', tip: 'Ergänze ein Beispiel.' },
      { id: 'c2', label: 'Struktur', met: 0.9, comment: 'Klare Absätze.', tip: 'Schlussatz ausbauen.' },
    ],
  };
}

function decide(systemText, userText) {
  const sys = String(systemText || '');
  const usr = String(userText || '');
  if (/Ping/.test(usr)) return { ok: true };
  if (/formative feedback/i.test(sys)) return writingPayload();
  if (/tutor/i.test(sys)) return feedbackPayload();
  return worksheetPayload(sys, usr);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) req.destroy();
    });
    req.on('end', () => resolve(data));
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/__health') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(404).end('not found');
    return;
  }
  const raw = await readBody(req);
  let payload = {};
  try {
    payload = JSON.parse(raw || '{}');
  } catch {
    res.writeHead(400).end('bad json');
    return;
  }

  let systemText = '';
  let userText = '';
  if (Array.isArray(payload.messages)) {
    // OpenRouter chat format
    systemText = payload.messages.find((m) => m.role === 'system')?.content || '';
    userText = [...payload.messages].reverse().find((m) => m.role === 'user')?.content || '';
  } else {
    // Gemini format
    systemText = payload.systemInstruction?.parts?.map((p) => p.text || '').join('') || '';
    userText = payload.contents?.map((c) => (c.parts || []).map((p) => p.text || '').join('')).join('\n') || '';
  }

  const answer = JSON.stringify(decide(systemText, userText));
  res.setHeader('Content-Type', 'application/json');
  if (Array.isArray(payload.messages)) {
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: answer } }] }));
  } else {
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: answer }] } }] }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-llm] listening on http://127.0.0.1:${PORT}`);
});
