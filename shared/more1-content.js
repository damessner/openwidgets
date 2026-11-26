// MORE 1 (MS Telfs, class 1G) — revision courses for Unit 1–3, built from the
// book's revision worksheets (MORE1/Unit_*_Revision_Worksheet_1G.docx).
// Pure module: builds validated activity definitions per unit. Each unit is a
// "course" of ten activities: Vokabeln, Grammatik, Lesen 1–3, Hören 1–3 (each
// with a teacher read-aloud script), Schreiben (AI-feedback writing task with
// required word box + step hints), Exit-Check. Sized for ~15–20 minutes each.
import { createDefinition, normalizeActivity, validateActivity } from './activity.js';
import { createItem } from './items/index.js';

// ---------------------------------------------------------------------------
// Item builders
// ---------------------------------------------------------------------------

function def(title, description, items, template = 'worksheet') {
  const definition = createDefinition({ template, locale: 'de', title });
  definition.description = description || '';
  definition.items = items;
  return normalizeActivity(definition);
}

function mc(id, stem, choices, points = 1) {
  const item = createItem('multiple_choice', { id, points });
  item.stem = stem;
  item.config = {
    multi: false,
    shuffle: false,
    partialCredit: false,
    choices: choices.map((choice, index) => ({ id: `c${index + 1}`, text: String(choice.text), correct: choice.correct === true })),
  };
  return item;
}

function tf(id, stem, truth, points = 1) {
  return mc(id, stem, [
    { text: 'True', correct: truth === true },
    { text: 'False', correct: truth === false },
  ], points);
}

function sa(id, stem, accepted, points = 1) {
  const item = createItem('short_answer', { id, points });
  item.stem = stem;
  item.config = {
    accepted: accepted.filter((value) => String(value).trim() !== ''),
    caseSensitive: false,
    trim: true,
    collapseSpaces: true,
    ignorePunctuation: true,
  };
  return item;
}

function fb(id, stem, text, blanks, points = 2) {
  // Allow fb(id, textWithGaps, blanks) — then the "stem" is the gap text.
  if (blanks === undefined && text !== null && typeof text === 'object') {
    blanks = text;
    text = stem;
    stem = '';
  }
  const item = createItem('fill_blanks', { id, points });
  item.stem = stem;
  const normalizedBlanks = {};
  for (const [key, accepted] of Object.entries(blanks)) {
    normalizedBlanks[key] = { accepted: Array.isArray(accepted) ? accepted : [accepted] };
  }
  item.config = { text, blanks: normalizedBlanks, caseSensitive: false, mode: 'input', wordBank: [] };
  return item;
}

function ord(id, stem, wordsInOrder, points = 2) {
  const item = createItem('ordering', { id, points });
  item.stem = stem;
  item.config = {
    mode: 'positions',
    items: wordsInOrder.map((text, index) => ({ id: `o${index + 1}`, text: String(text) })),
  };
  return item;
}

function textBlock(id, stem, text) {
  const item = createItem('text', { id, points: 0 });
  item.stem = stem;
  item.config = { text, caseSensitive: false, trim: true, collapseSpaces: true, ignorePunctuation: true };
  return item;
}

function vocabQuiz(id, entries, direction = 'both', points = 3, mode = 'quiz') {
  const item = createItem('vocabulary', { id, points });
  item.stem = mode === 'spell'
    ? 'Rechtschreibung — tippe das englische Wort zur deutschen Bedeutung.'
    : 'Übersetze — ein Wort nach dem anderen (Quiz-Trainer).';
  item.config = {
    mode,
    direction,
    shuffle: true,
    caseSensitive: false,
    entries: entries.map((entry, index) => ({
      id: `e${index + 1}`,
      term: String(entry.term),
      translation: String(entry.translation),
      alternatives: Array.isArray(entry.alternatives) ? entry.alternatives : [],
      example: String(entry.example || ''),
      imageAssetId: '',
      audioAssetId: '',
    })),
  };
  return item;
}

// --- bonus builders (fun extra tasks for eager pupils) ----------------------

function hangman(id, word, hint, points = 2) {
  const item = createItem('hangman', { id, points });
  item.stem = `Errate das englische Wort: ${hint}`;
  item.config = { word, alternatives: [], hint, maxAttempts: 8, caseSensitive: false };
  return item;
}

function crossword(id, title, words, points = 4) {
  const item = createItem('crossword', { id, points });
  item.stem = 'Kreuzworträtsel — löse die englischen Wörter anhand der Hinweise.';
  item.config = {
    title,
    words: words.map((w, index) => ({
      id: `w${index + 1}`,
      word: w.word,
      clue: w.clue,
      row: w.row,
      col: w.col,
      direction: w.direction,
    })),
  };
  return item;
}

function matchPairs(id, stem, pairs, points = 3) {
  const item = createItem('match', { id, points });
  item.stem = stem;
  item.config = {
    pairs: pairs.map((pair, index) => ({ id: `p${index + 1}`, left: pair[0], right: pair[1] })),
    shuffle: true,
  };
  return item;
}

function groups(id, stem, zones, items, points = 3) {
  const item = createItem('groups', { id, points });
  item.stem = stem;
  item.config = {
    zones: zones.map((label, index) => ({ id: `z${index + 1}`, label })),
    items: items.map((entry, index) => ({ id: `i${index + 1}`, side: { kind: 'text', text: entry.text }, zoneId: `z${entry.zone}` })),
    shuffle: true,
  };
  return item;
}

function strike(id, stem, words, points = 2) {
  const item = createItem('mark_sentence', { id, points });
  item.stem = stem;
  item.config = {
    mode: 'correct',
    words: words.map((w) => ({ text: w.text, target: w.target || 'none', fix: w.fix || '' })),
  };
  return item;
}

const WRITING_CRITERIA = [
  { id: 'c1', label: 'Inhalt', weight: 40, description: 'Bezug zur Aufgabe, alle gefragten Angaben vorhanden und korrekt' },
  { id: 'c2', label: 'Sprache & Rechtschreibung', weight: 35, description: 'Grammatik, Rechtschreibung, Groß-/Kleinschreibung' },
  { id: 'c3', label: 'Struktur', weight: 25, description: 'Klare Sätze, sinnvolle Reihenfolge, geforderte Länge, alle Wortbox-Wörter verwendet' },
];

function writingTask(id, spec, points = 5) {
  const item = createItem('writing', { id, points });
  item.stem = spec.stem;
  item.config = {
    gradeLevel: '1G (5. Klasse)',
    sourceText: spec.sourceText,
    criteria: WRITING_CRITERIA,
    minWords: spec.minWords,
    maxWords: spec.maxWords,
    allowLoops: true,
    requiredWords: spec.requiredWords || [],
    hints: spec.hints || [],
  };
  return item;
}

// ---------------------------------------------------------------------------
// Unit content (from the revision worksheets + book-style texts)
// ---------------------------------------------------------------------------

// Spelling-trainer word subsets for the ⭐ bonus rounds.
const SPELL_U1 = [
  { term: 'pencil case', translation: 'das Federpennal' },
  { term: 'rubber', translation: 'der Radiergummi' },
  { term: 'glue stick', translation: 'der Klebestift' },
  { term: 'exercise book', translation: 'das Schulheft' },
  { term: 'favourite colour', translation: 'Lieblingsfarbe' },
  { term: 'Nice to meet you', translation: 'Schön, dich kennenzulernen!' },
  { term: 'board', translation: 'die Tafel' },
  { term: 'sunglasses', translation: 'die Sonnenbrille' },
];
const SPELL_U2 = [
  { term: 'monkey', translation: 'der Affe' },
  { term: 'giraffe', translation: 'die Giraffe' },
  { term: 'parrot', translation: 'der Papagei' },
  { term: 'penguin', translation: 'der Pinguin' },
  { term: 'lion', translation: 'der Löwe' },
  { term: 'feed', translation: 'füttern' },
  { term: 'guide', translation: 'der/die Reiseführer/in' },
  { term: 'What’s up?', translation: 'Was ist los?' },
];
const SPELL_U3 = [
  { term: 'treasure', translation: 'der Schatz' },
  { term: 'cutlass', translation: 'der Piratensäbel' },
  { term: 'famous', translation: 'berühmt' },
  { term: 'captain', translation: 'der Kapitän' },
  { term: 'hook', translation: 'der Haken' },
  { term: 'scared of', translation: 'Angst haben vor' },
  { term: 'wooden leg', translation: 'das Holzbein' },
  { term: 'Good idea', translation: 'Gute Idee!' },
];

const UNITS = [
  {
    unit: 1,
    title: 'Time for School',
    vocab: [
      { term: 'das Federpennal', translation: 'pencil case' },
      { term: 'der Radiergummi', translation: 'rubber', alternatives: ['eraser'] },
      { term: 'der Klebestift', translation: 'glue stick' },
      { term: 'das Lineal', translation: 'ruler' },
      { term: 'das Schulheft', translation: 'exercise book' },
      { term: 'die Tafel', translation: 'board' },
      { term: 'das Fenster', translation: 'window' },
      { term: 'die Tür', translation: 'door' },
      { term: 'der Stuhl', translation: 'chair' },
      { term: 'der Schreibtisch', translation: 'desk' },
      { term: 'zehn', translation: 'ten' },
      { term: 'dreizehn', translation: 'thirteen' },
      { term: 'achtzehn', translation: 'eighteen' },
      { term: 'fünfundzwanzig', translation: 'twenty-five' },
      { term: 'rosa', translation: 'pink' },
      { term: 'hellblau', translation: 'light blue' },
      { term: 'das Hemd', translation: 'shirt' },
      { term: 'der Pullover', translation: 'sweater' },
      { term: 'der Hut', translation: 'hat' },
      { term: 'die Krawatte', translation: 'tie' },
      { term: 'der Rock', translation: 'skirt' },
      { term: 'die Socken', translation: 'socks' },
      { term: 'das Haarband', translation: 'hairband' },
      { term: 'die Sonnenbrille', translation: 'sunglasses' },
      { term: 'Schön, dich kennenzulernen!', translation: 'Nice to meet you' },
      { term: 'Tschüss!', translation: 'Bye', alternatives: ['Goodbye'] },
      { term: 'Lieblingsfarbe', translation: 'favourite colour', alternatives: ['favorite color'] },
      { term: 'Ich muss gehen!', translation: 'I have to go' },
      { term: 'das Lieblingsfach', translation: 'favourite subject' },
      { term: 'der Stundenplan', translation: 'timetable' },
      { term: 'Englisch', translation: 'English' },
      { term: 'Mathe', translation: 'maths', alternatives: ['math'] },
    ],
    grammar: (p) => [
      fb(`${p}-g1`, 'Schreibe die Mehrzahl (Plural):', '1 dog → 4 <<1>>  ·  1 desk → 8 <<2>>  ·  1 apple → 3 <<3>>  ·  1 ball → 10 <<4>>', {
        1: ['dogs'], 2: ['desks'], 3: ['apples'], 4: ['balls'],
      }),
      fb(`${p}-g2`, 'Achtung: y wird zu ies, unregelmäßig:', '1 baby → 2 <<1>>  ·  1 boy → 5 <<2>>  ·  1 child → 7 <<3>>  ·  1 fish → 6 <<4>>', {
        1: ['babies'], 2: ['boys'], 3: ['children'], 4: ['fish'],
      }),
      fb(`${p}-g3`, 'Bilde den Imperativ (Befehl):', '„Sei nicht laut!“ → „<<1>>, please!“   ·   „Mach das Fenster zu!“ → „<<2>> the window!“', {
        1: ["Don't speak", 'Do not speak'], 2: ['Close'],
      }),
      fb(`${p}-g4`, 'Wie schreibt man eine E-Mail-Adresse? @ = <<1>>  und  . = <<2>>', { 1: ['at'], 2: ['dot'] }),
      ord(`${p}-g5`, 'Bringe die Wörter in die richtige Reihenfolge (Imperativ):', ["Don't", 'open', 'your', 'school', 'bags.']),
      ord(`${p}-g6`, 'Bringe die Wörter in die richtige Reihenfolge (Frage):', ['What', "'s", 'your', 'email', 'address?']),
      sa(`${p}-g7`, 'Zahl in Englisch: 13 = ?', ['thirteen']),
      sa(`${p}-g8`, 'Zahl in Englisch: 24 − 2 = ?', ['twenty-two']),
      sa(`${p}-g9`, 'Zahl in Englisch: 16 = ?', ['sixteen']),
      sa(`${p}-g10`, 'Zahl in Englisch: 19 = ?', ['nineteen']),
      mc(`${p}-g11`, 'Odd one out — which word does NOT belong? (red, pink, rubber, light blue, grey)', [
        { text: 'red', correct: false },
        { text: 'pink', correct: false },
        { text: 'rubber', correct: true },
        { text: 'light blue', correct: false },
        { text: 'grey', correct: false },
      ]),
      fb(`${p}-g12`, 'Personalpronomen: ich = I, du = <<1>>, er = <<2>>, sie = <<3>>', { 1: ['you'], 2: ['he'], 3: ['she'] }),
      mc(`${p}-g13`, '„What’s your name?“ — which short answer is correct?', [
        { text: '„My name is Leo.“', correct: true },
        { text: '„I am Leo ten.“' },
        { text: '„Name is Leo.“' },
      ]),
      fb(`${p}-g14`, 'Schreibe die E-Mail-Adresse aus: mia point green at telfs dot at → mia<<1>>green<<2>>telfs<<3>>at', {
        1: ['.'], 2: ['@'], 3: ['.'],
      }),
    ],
    readings: [
      {
        id: 'A',
        title: 'Text A — Welcome to Class 1G! Leo’s New Classroom',
        text: `TEXT A — Welcome to Class 1G! Leo's New Classroom (~145 words)

Hello! My name is Leo and I am ten years old. I am in class 1G at my new school. My email address is leo10@telfs.at. My favourite colour is light blue, and I hate pink! My school tie is blue and white.

Look at my classroom! The floor is green and the board is white. There are fourteen brown desks and fourteen black chairs. There is one big projector, a sound system, and two blue doors. Three windows are next to the teacher's desk.

On my desk, there is my orange school bag and my blue pencil case. In my pencil case, I have got two blue pens, one yellow pencil, a green rubber, a ruler and a glue stick. I haven't got watercolours today. At 8 o'clock, Miss Green says: "Sit down, children! Take out your exercise books! Don't speak!"`,
        questions: (p) => [
          mc(`${p}-a1`, 'How old is Leo?', [{ text: 'nine' }, { text: 'ten', correct: true }, { text: 'eleven' }]),
          mc(`${p}-a2`, 'What colour is the classroom floor?', [{ text: 'green', correct: true }, { text: 'brown' }, { text: 'light blue' }]),
          mc(`${p}-a3`, 'How many chairs are in class 1G?', [{ text: 'twelve' }, { text: 'fourteen', correct: true }, { text: 'fifteen' }]),
          tf(`${p}-a4`, "Leo's favourite colour is pink.", false),
          tf(`${p}-a5`, 'There are two doors in Leo’s classroom.', true),
          tf(`${p}-a6`, 'Leo has got watercolours in his pencil case today.', false),
          sa(`${p}-a7`, "What is Leo's email address?", ['leo10@telfs.at']),
          sa(`${p}-a8`, 'What colour are the desks in class 1G?', ['brown']),
        ],
      },
      {
        id: 'B',
        title: 'Text B — Luna’s Uniform Note',
        text: `TEXT B — Luna's Uniform Note (~45 words)

Hi Leo! I'm Luna from Year 6 in London. At my school we wear a grey skirt, a white shirt, a dark green sweater and black shoes. My school tie is green and yellow. Look — I've got cool sunglasses and a red hairband, too!`,
        questions: (p) => [
          mc(`${p}-b1`, "What colour is Luna's sweater?", [{ text: 'grey' }, { text: 'black' }, { text: 'dark green', correct: true }]),
          tf(`${p}-b2`, "Luna's school tie is blue and white.", false),
          mc(`${p}-b3`, 'Which two accessories has Luna got?', [
            { text: 'sunglasses and a hairband', correct: true },
            { text: 'a hat and a tie' },
            { text: 'a ruler and a rubber' },
          ]),
          sa(`${p}-b4`, 'Krawatte auf Englisch (find it in the text)?', ['tie']),
          sa(`${p}-b5`, 'Sonnenbrille auf Englisch (find it in the text)?', ['sunglasses']),
          sa(`${p}-b6`, 'Haarband auf Englisch (find it in the text)?', ['hairband']),
        ],
      },
      {
        id: 'C',
        title: 'Text C — Leo’s Email to Luna',
        text: `TEXT C — Leo's email to Luna (~110 words)

Hi Luna!

My name is Leo. I am ten years old and I am in class 1G at Telfs Middle School. My email address is leo10@telfs.at.

My favourite subject is English, but I don't like Maths. My favourite colour is light blue. In my classroom, the walls are white and the floor is green. There are fourteen desks and fourteen chairs.

At 8 o'clock Miss Green says: "Good morning, children! Sit down, please! Take out your exercise books!"

Write back soon!
Leo`,
        questions: (p) => [
          mc(`${p}-c1`, "What is Leo's favourite subject?", [{ text: 'Maths' }, { text: 'English', correct: true }, { text: 'Art' }]),
          tf(`${p}-c2`, 'Leo likes Maths.', false),
          tf(`${p}-c3`, 'The walls in Leo’s classroom are green.', false),
          mc(`${p}-c4`, 'How many desks are in Leo’s classroom?', [{ text: 'twelve' }, { text: 'thirteen' }, { text: 'fourteen', correct: true }]),
          sa(`${p}-c5`, "What is Leo's email address?", ['leo10@telfs.at']),
          sa(`${p}-c6`, 'Lieblingsfach auf Englisch (Text C)?', ['favourite subject']),
          mc(`${p}-c7`, 'What does Miss Green say at 8 o’clock? (first words)', [
            { text: '"Good morning, children!"', correct: true },
            { text: '"Goodbye, children!"' },
            { text: '"Open your books!"' },
          ]),
          sa(`${p}-c8`, 'Schulheft auf Englisch (Text A/C)?', ['exercise book']),
        ],
      },
    ],
    listenings: [
      {
        id: '1',
        title: 'Hören 1 — Leo stellt sich vor',
        script: `VORLESETEXT (die Lehrkraft liest vor):

Hello! My name is Leo. I am ten years old. I am in class 1 G at my new school.
My favourite colour is light blue.
In my classroom there are fourteen desks and fourteen chairs. The floor is green and the board is white.
On my desk there is an orange school bag and a blue pencil case.
In my pencil case I have got two pens, one pencil, a rubber, a ruler and a glue stick.`,
        questions: (p) => [
          mc(`${p}-h1-1`, 'How old is Leo?', [{ text: 'nine' }, { text: 'ten', correct: true }, { text: 'eleven' }]),
          mc(`${p}-h1-2`, 'How many desks are in the classroom?', [{ text: 'twelve' }, { text: 'thirteen' }, { text: 'fourteen', correct: true }]),
          mc(`${p}-h1-3`, 'What colour is the floor?', [{ text: 'white' }, { text: 'green', correct: true }, { text: 'brown' }]),
          mc(`${p}-h1-4`, "What colour is Leo's school bag?", [{ text: 'blue' }, { text: 'orange', correct: true }, { text: 'green' }]),
          sa(`${p}-h1-5`, "What is Leo's favourite colour?", ['light blue']),
          sa(`${p}-h1-6`, 'How many pens has Leo got?', ['two', '2']),
        ],
      },
      {
        id: '2',
        title: 'Hören 2 — Ein Rundgang durch den Klassenraum',
        script: `VORLESETEXT (die Lehrkraft liest vor):

This is our classroom. The floor is green and the board is white.
There are fourteen brown desks and fourteen black chairs in the room.
Next to the teacher's desk there are three windows. On the wall there is a big clock and a projector.
Under my desk there is my orange school bag. I have got a blue pencil case with two pens, a pencil, a rubber, a ruler and a glue stick in it.`,
        questions: (p) => [
          mc(`${p}-h2-1`, 'What colour is the board?', [{ text: 'green' }, { text: 'white', correct: true }, { text: 'blue' }]),
          mc(`${p}-h2-2`, 'How many windows are next to the teacher’s desk?', [{ text: 'two' }, { text: 'three', correct: true }, { text: 'four' }]),
          tf(`${p}-h2-3`, 'There are fourteen black chairs in the room.', true),
          sa(`${p}-h2-4`, 'Where is the school bag?', ['under my desk', 'under the desk']),
          mc(`${p}-h2-5`, 'What colour is the pencil case?', [{ text: 'green' }, { text: 'orange' }, { text: 'blue', correct: true }]),
          tf(`${p}-h2-6`, 'Leo has got a glue stick.', true),
          sa(`${p}-h2-7`, 'Klebestift auf Englisch?', ['glue stick']),
        ],
      },
      {
        id: '3',
        title: 'Hören 3 — Im Unterricht (Imperative)',
        script: `VORLESETEXT (die Lehrkraft liest vor):

Miss Green: "Good morning, children! Sit down, please!"
Leo: "Good morning, Miss Green!"
Miss Green: "Take out your exercise books and your pencil cases! Open your books at page twelve!"
Luna: "Can I sit next to Leo, please?"
Miss Green: "Yes, you can. But don't speak during the lesson! Close your books now, please!"`,
        questions: (p) => [
          mc(`${p}-h3-1`, 'What does Miss Green say first?', [
            { text: '"Good morning, children! Sit down, please!"', correct: true },
            { text: '"Open your books!"' },
            { text: '"Close your books!"' },
          ]),
          tf(`${p}-h3-2`, 'Leo says "Good morning" to Miss Green.', true),
          sa(`${p}-h3-3`, 'Open your books at page … ?', ['twelve', '12']),
          mc(`${p}-h3-4`, 'Where can Luna sit?', [{ text: 'next to Leo', correct: true }, { text: 'next to the window' }, { text: 'on the floor' }]),
          tf(`${p}-h3-5`, 'Luna can speak during the lesson.', false),
          mc(`${p}-h3-6`, '„Sei nicht laut!“ auf Englisch:', [
            { text: '"Don’t speak!"', correct: true },
            { text: '"Don’t sit down!"' },
            { text: '"Don’t open your books!"' },
          ]),
          sa(`${p}-h3-7`, 'Seite auf Englisch?', ['page']),
        ],
      },
    ],
    writing: {
      stem: 'Write about you and your classroom — write 6 clear sentences (like Leo in the reading texts). You MUST use all the words from the word box.',
      sourceText: 'Sentence starters:\n1. Hello! My name is … . I am … years old and I am in class … .\n2. Nice to meet you!\n3. My favourite colour is … , and I hate … .\n4. In my classroom, the floor is … and the board is … .\n5. In my pencil case, I have got … (glue stick, …).\n6. My school clothes today: … .',
      minWords: 50,
      maxWords: 160,
      requiredWords: ['Nice to meet you', 'pencil case', 'favourite colour', 'glue stick', 'classroom'],
      hints: [
        '1. Lies die Aufgabe genau: Schreibe 6 Sätze über dich und dein Klassenzimmer. Alle Wörter aus der Wortbox müssen vorkommen!',
        '2. Sammle Ideen: Wie heißt du? Wie alt? Welche Klasse? Lieblingsfarbe? Was ist in deinem Federpennal (pencil case)?',
        '3. Schreibe jetzt 6 klare Sätze (siehe Satzanfänge). Prüfe am Ende: alle Wortbox-Wörter verwendet? Großschreibung? Rechtschreibung?',
      ],
    },
    exit: (p) => [
      sa(`${p}-x1`, 'Plural: 1 baby → 3 ?', ['children']),
      sa(`${p}-x2`, 'Plural: 1 child → 4 ?', ['children']),
      sa(`${p}-x3`, 'Imperativ (don’t): „_____ on your desk!“ (sit)', ["Don't sit", 'Do not sit']),
      sa(`${p}-x4`, 'Zahl in Englisch: 12 = ?', ['twelve']),
      sa(`${p}-x5`, 'Zahl in Englisch: 20 = ?', ['twenty']),
      sa(`${p}-x6`, 'Zahl in Englisch: 15 = ?', ['fifteen']),
      fb(`${p}-x7`, 'Lies vor: ben@mail.at → b-e-n <<1>> m-a-i-l <<2>> a-t', { 1: ['at'], 2: ['dot'] }),
      fb(`${p}-x8`, 'Nice <<1>> meet you!', { 1: ['to'] }),
      sa(`${p}-x9`, 'Plural: 1 watch → 3 ?', ['watches']),
      fb(`${p}-x10`, 'Imperativ: „<<1>> your books!“ (open)', { 1: ['Open'] }),
      sa(`${p}-x11`, 'Tafel auf Englisch?', ['board']),
      sa(`${p}-x12`, '„My name is …“ — schreibe einen Satz: „My name is Leo.“', ['My name is Leo']),
    ],
    // ⭐ Bonus tasks (never block the sequence)
    bonus: (courseTitle, p) => [
      def(`${courseTitle}: ⭐ Bonus 1 — Hangman & Kreuzworträtsel`, 'Spaßige Bonusrunde: Hangman + Kreuzworträtsel mit Unit-Wörtern.', [
        hangman(`${p}-b1-h1`, 'RULER', 'Schulmaterial: ein Lineal (engl.)'),
        hangman(`${p}-b1-h2`, 'WINDOW', 'am Klassenzimmer: ein Fenster (engl.)'),
        hangman(`${p}-b1-h3`, 'SCHOOLBAG', 'die Schultasche (engl.)'),
        crossword(`${p}-b1-x`, 'Kreuzworträtsel Unit 1', [
          { word: 'SCHOOL', clue: 'Schule (engl.)', row: 0, col: 0, direction: 'across' },
          { word: 'CLASS', clue: 'Klasse (engl.)', row: 0, col: 1, direction: 'down' },
          { word: 'HAT', clue: 'Hut (engl.)', row: 0, col: 2, direction: 'down' },
          { word: 'ORANGE', clue: 'Farbe Orange (engl.)', row: 0, col: 3, direction: 'down' },
          { word: 'OPEN', clue: 'Imperativ: „___ your books!“ (engl.)', row: 0, col: 4, direction: 'down' },
        ]),
      ]),
      def(`${courseTitle}: ⭐ Bonus 2 — Zuordnen, Rechtschreibung & Fehler streichen`, 'Ordne zu, tippe die Wörter richtig und streiche die Fehler.', [
        matchPairs(`${p}-b2-m`, 'Ordne Deutsch ↔ Englisch zu:', [
          ['das Federpennal', 'pencil case'],
          ['der Radiergummi', 'rubber'],
          ['die Tafel', 'board'],
          ['das Fenster', 'window'],
          ['der Stuhl', 'chair'],
          ['die Krawatte', 'tie'],
        ]),
        vocabQuiz(`${p}-b2-spell`, SPELL_U1, 'both', 2, 'spell'),
        strike(`${p}-b2-s1`, 'Streiche das falsche Wort und korrigiere es: „There is five monkeys in the tree.“', [
          { text: 'There' }, { text: 'is', target: 'wrong', fix: 'are' }, { text: 'five' }, { text: 'monkeys' }, { text: 'in' }, { text: 'the' }, { text: 'tree.' },
        ]),
        strike(`${p}-b2-s2`, 'Streiche das falsche Wort und korrigiere es: „My name are Leo.“', [
          { text: 'My' }, { text: 'name' }, { text: 'are', target: 'wrong', fix: 'is' }, { text: 'Leo.' },
        ]),
      ]),
    ],
  },
  {
    unit: 2,
    title: 'At the Zoo',
    vocab: [
      { term: 'der Affe', translation: 'monkey' },
      { term: 'die Giraffe', translation: 'giraffe' },
      { term: 'der Papagei', translation: 'parrot' },
      { term: 'der Pinguin', translation: 'penguin' },
      { term: 'der Löwe', translation: 'lion' },
      { term: 'der Zug', translation: 'train' },
      { term: 'der Baum', translation: 'tree' },
      { term: 'der/die Reiseführer/in', translation: 'guide' },
      { term: 'erwachsene Person', translation: 'adult' },
      { term: 'schön, hübsch', translation: 'beautiful' },
      { term: 'füttern', translation: 'feed' },
      { term: 'herumlaufen', translation: 'run around' },
      { term: 'mitbringen', translation: 'bring' },
      { term: 'das Auto', translation: 'car' },
      { term: 'aus (York)', translation: 'from' },
      { term: 'das Jahr', translation: 'year' },
      { term: 'das Kind', translation: 'child' },
      { term: 'wir', translation: 'we' },
      { term: 'sie (Mehrzahl)', translation: 'they' },
      { term: 'willkommen', translation: 'welcome' },
      { term: 'glücklich', translation: 'happy' },
      { term: 'komisch, seltsam', translation: 'strange' },
      { term: 'groß', translation: 'big', alternatives: ['large'] },
      { term: 'klein', translation: 'small' },
      { term: 'Was ist los?', translation: 'What’s up?', alternatives: ['What is up?'] },
      { term: 'das Ticket', translation: 'ticket' },
      { term: 'das Café', translation: 'café' },
      { term: 'klug', translation: 'clever' },
      { term: 'laut', translation: 'loud' },
    ],
    grammar: (p) => [
      fb(`${p}-g1`, 'there is (1) oder there are (2+):', '<<1>> a big lion in the park.  ·  <<2>> five monkeys in the tree.  ·  <<3>> two penguins in the water.  ·  <<4>> three children on the train.', {
        1: ['There is', "There's"], 2: ['There are', "There're"], 3: ['There are', "There're"], 4: ['There are', "There're"],
      }),
      fb(`${p}-g2`, 'Präpositionen (in, on, under, behind, in front of, next to):', 'Your pens are <<1>> your pencil case.  ·  The chair is <<2>> the desk (neben).  ·  The cat is <<3>> the tree — you can’t see it!  ·  Sit <<4>> the TV, please (vor).', {
        1: ['in'], 2: ['next to'], 3: ['behind'], 4: ['in front of'],
      }),
      fb(`${p}-g3`, 'to be (am / is / are):', 'I <<1>> at the wildlife park today.  ·  My brother Tom <<2>> 11 and he <<3>> very happy.  ·  The monkeys <<4>> so funny!', {
        1: ['am', "I'm"], 2: ['is', "He's"], 3: ['is', "He's"], 4: ['are', "They're"],
      }),
      mc(`${p}-g4`, 'Spot the mistake: „There are a big giraffe in the zoo.“ — correct sentence?', [
        { text: 'There are a big giraffe in the zoo.' },
        { text: 'There is a big giraffe in the zoo.', correct: true },
        { text: 'There are big giraffe in the zoo.' },
      ]),
      mc(`${p}-g5`, 'Spot the mistake: „My sister Hannah are in Year 7.“ — correct?', [
        { text: 'My sister Hannah are in Year 7.' },
        { text: 'My sister Hannah is in Year 7.', correct: true },
        { text: 'My sister Hannah am in Year 7.' },
      ]),
      ord(`${p}-g6`, 'Unscramble: bringe die Wörter in die richtige Reihenfolge:', ['There', 'is', 'a', 'parrot', 'on', 'the', 'tree.']),
      fb(`${p}-g7`, 'Gegenteil (opposite): in front of = <<1>>  ·  on = <<2>>', { 1: ['behind'], 2: ['under'] }),
      fb(`${p}-g8`, 'Präpositionen: The bird is <<1>> the tree (auf).  ·  The bench is <<2>> the café (vor).  ·  The dog is <<3>> the bench (unter).', {
        1: ['on'], 2: ['in front of'], 3: ['under'],
      }),
      mc(`${p}-g9`, 'Spot the mistake: „There is five monkeys in the tree.“ — correct?', [
        { text: 'There is five monkeys in the tree.' },
        { text: 'There are five monkeys in the tree.', correct: true },
        { text: 'There are five monkey in the tree.' },
      ]),
      sa(`${p}-g10`, 'Gegenteil von „big“?', ['small']),
      fb(`${p}-g11`, 'Adjektive: The giraffe is <<1>> (groß).  ·  The monkeys are <<2>> (klein).  ·  The park is <<3>> (schön).', {
        1: ['big'], 2: ['small'], 3: ['beautiful'],
      }),
      ord(`${p}-g12`, 'Unscramble:', ['I', 'am', 'at', 'the', 'zoo', 'today.']),
      tf(`${p}-g13`, '„There are a parrot on the tree.“ — this sentence is correct.', false),
      sa(`${p}-g14`, '„Can I sit here?“ — „Yes, you <<1>>.“ Ergänze:', ['can']),
    ],
    readings: [
      {
        id: 'A',
        title: 'Text A — A Morning at Brightside Wildlife Park',
        text: `TEXT A — A Morning at Brightside Wildlife Park (~145 words)

Mia and her brother Tom are at Brightside Wildlife Park today with their little brown dog, Buddy. First, they go on a red train. From the train, there is a big giraffe next to a green house. "Look!" says Tom. "There are four small monkeys behind the big tree, and there are six black-and-white penguins in front of the café!"

Suddenly, Buddy barks: "WOOF! WOOF!" A blue-and-yellow parrot is on Tom's head! Tom laughs, and Mia's red hat falls under a bench. Buddy runs under the bench and brings Mia's red hat back. "What a clever dog!" says the park guide.`,
        questions: (p) => [
          mc(`${p}-a1`, 'What colour is the park train?', [{ text: 'green' }, { text: 'blue' }, { text: 'red', correct: true }]),
          mc(`${p}-a2`, 'How many monkeys do Mia and Tom see?', [{ text: 'three' }, { text: 'four', correct: true }, { text: 'six' }]),
          tf(`${p}-a3`, 'There is a big giraffe next to a green house.', true),
          tf(`${p}-a4`, 'The penguins are behind the café.', false),
          sa(`${p}-a5`, 'Where are the four monkeys?', ['behind the big tree', 'behind the tree']),
          sa(`${p}-a6`, 'Where is the blue-and-yellow parrot?', ["on Tom's head", 'on Tom’s head']),
          sa(`${p}-a7`, 'What does Buddy bring back?', ["Mia's red hat", 'the red hat', 'Mia’s red hat', 'a red hat']),
          sa(`${p}-a8`, 'Reiseführer/in auf Englisch (Text A)?', ['guide', 'the park guide', 'park guide']),
        ],
      },
      {
        id: 'B',
        title: 'Text B — Visitor Poster',
        text: `TEXT B — Brightside Wildlife Park, Visitor Poster (~55 words)

Open every day: 10:00 – 17:00  |  Tickets: Adults £14, Children £9. Take the red train at 10:30 or 14:00, see our two lions, and feed the penguins at 11:30! Bring your camera — dogs are welcome, too, but they can't run around near the animals.`,
        questions: (p) => [
          mc(`${p}-b1`, 'How much is a ticket for a child?', [{ text: '£9', correct: true }, { text: '£11' }, { text: '£14' }]),
          mc(`${p}-b2`, 'How much is a ticket for an adult?', [{ text: '£9' }, { text: '£14', correct: true }, { text: '£17' }]),
          mc(`${p}-b3`, 'When can visitors feed the penguins?', [{ text: 'at 10:30' }, { text: 'at 11:30', correct: true }, { text: 'at 14:00' }]),
          tf(`${p}-b4`, 'Dogs can run around everywhere in the park.', false),
          tf(`${p}-b5`, 'Dogs are welcome in the park.', true),
          sa(`${p}-b6`, 'Erwachsene auf Englisch (Text B)?', ['adults']),
        ],
      },
      {
        id: 'C',
        title: 'Text C — Buddy the Clever Dog',
        text: `TEXT C — Buddy the Clever Dog (~110 words)

Buddy is Mia and Tom's little brown dog. He is very clever and very friendly. At the wildlife park, Buddy can't run around near the animals — but he can run around on the path!

Yesterday at the park, Buddy saw a blue-and-yellow parrot on Tom's head. He barked loudly: "WOOF! WOOF!" The parrot flew away, but Mia's red hat fell under a bench. Buddy ran under the bench and brought the hat back. "What a clever dog!" said the guide. Everyone is happy now.`,
        questions: (p) => [
          mc(`${p}-c1`, 'What colour is Buddy?', [{ text: 'black' }, { text: 'little brown', correct: true }, { text: 'white' }]),
          tf(`${p}-c2`, 'Buddy can run around near the animals.', false),
          mc(`${p}-c3`, 'What did Buddy see on Tom’s head?', [
            { text: 'a blue-and-yellow parrot', correct: true },
            { text: 'a red hat' },
            { text: 'a green house' },
          ]),
          tf(`${p}-c4`, "Mia's hat fell under a bench.", true),
          sa(`${p}-c5`, 'Where did Buddy find the hat?', ['under the bench', 'under a bench']),
          sa(`${p}-c6`, 'klug auf Englisch (Text C)?', ['clever']),
          sa(`${p}-c7`, 'laut auf Englisch (Text C)?', ['loud']),
          mc(`${p}-c8`, 'How does the guide react?', [
            { text: '"What a clever dog!"', correct: true },
            { text: '"What a strange dog!"' },
            { text: '"Sit down, Buddy!"' },
          ]),
        ],
      },
    ],
    listenings: [
      {
        id: '1',
        title: 'Hören 1 — Mia und Tom im Wildlife Park',
        script: `VORLESETEXT (die Lehrkraft liest vor):

Mia and her brother Tom are at Brightside Wildlife Park today. They go on a red train.
From the train they see a big giraffe next to a green house.
"There are four small monkeys behind the big tree," says Tom.
"And there are six penguins in front of the café!"
Suddenly, a blue-and-yellow parrot is on Tom's head. Mia's red hat falls under a bench.
Their dog Buddy runs under the bench and brings the red hat back. "What a clever dog!"`,
        questions: (p) => [
          mc(`${p}-h1-1`, 'Where are Mia and Tom today?', [{ text: 'at school' }, { text: 'at the wildlife park', correct: true }, { text: 'at home' }]),
          mc(`${p}-h1-2`, 'What colour is the train?', [{ text: 'red', correct: true }, { text: 'green' }, { text: 'blue' }]),
          mc(`${p}-h1-3`, 'How many monkeys are behind the tree?', [{ text: 'four', correct: true }, { text: 'six' }, { text: 'two' }]),
          mc(`${p}-h1-4`, 'Where is the parrot?', [{ text: "on Tom's head", correct: true }, { text: 'on the bench' }, { text: 'in the tree' }]),
          tf(`${p}-h1-5`, "Mia's hat is yellow.", false),
          sa(`${p}-h1-6`, 'What does Buddy bring back?', ["Mia's red hat", 'the red hat', 'Mia’s red hat', 'a red hat']),
        ],
      },
      {
        id: '2',
        title: 'Hören 2 — Der Papagei auf Toms Kopf',
        script: `VORLESETEXT (die Lehrkraft liest vor):

Suddenly, Buddy the dog barks loudly: "WOOF! WOOF!"
A blue-and-yellow parrot is on Tom's head. Tom laughs and laughs.
Mia's red hat falls under a bench. The parrot flies away.
Buddy runs under the bench. He brings Mia's red hat back.
"What a clever dog!" says the park guide. Mia is happy again.`,
        questions: (p) => [
          mc(`${p}-h2-1`, 'Why does Buddy bark?', [
            { text: 'because a parrot is on Tom’s head', correct: true },
            { text: 'because the train is coming' },
            { text: 'because Mia is sad' },
          ]),
          tf(`${p}-h2-2`, 'Tom laughs when the parrot is on his head.', true),
          sa(`${p}-h2-3`, 'What falls under a bench?', ["Mia's red hat", 'the red hat', 'a red hat']),
          tf(`${p}-h2-4`, 'The parrot stays on Tom’s head.', false),
          mc(`${p}-h2-5`, 'What does Buddy do?', [
            { text: 'he brings the hat back', correct: true },
            { text: 'he runs away' },
            { text: 'he barks at the guide' },
          ]),
          sa(`${p}-h2-6`, 'Was sagt der Guide? („What a ______ dog!“) — ergänze:', ['clever']),
        ],
      },
      {
        id: '3',
        title: 'Hören 3 — Das Besucherplakat (Öffnungszeiten)',
        script: `VORLESETEXT (die Lehrkraft liest vor):

Welcome to Brightside Wildlife Park! We are open every day from 10 o'clock to 5 o'clock.
Tickets: adults fourteen pounds, children nine pounds.
Take the red train at half past ten or at two o'clock. See our two lions!
You can feed the penguins at half past eleven.
Dogs are welcome, but they can't run around near the animals. Bring your camera!`,
        questions: (p) => [
          mc(`${p}-h3-1`, 'When is the park open?', [
            { text: 'from 10:00 to 17:00', correct: true },
            { text: 'from 9:00 to 16:00' },
            { text: 'only on Saturday' },
          ]),
          sa(`${p}-h3-2`, 'A ticket for a child costs … ?', ['nine pounds', '£9', '9 pounds']),
          mc(`${p}-h3-3`, 'When can you feed the penguins?', [
            { text: 'at half past eleven', correct: true },
            { text: 'at half past ten' },
            { text: 'at two o’clock' },
          ]),
          mc(`${p}-h3-4`, 'How many lions are in the park?', [{ text: 'one' }, { text: 'two', correct: true }, { text: 'three' }]),
          tf(`${p}-h3-5`, 'Dogs can run around near the animals.', false),
          sa(`${p}-h3-6`, '„täglich“ auf Englisch?', ['every day']),
        ],
      },
    ],
    writing: {
      stem: 'Write about your desk & pencil case — write 6 sentences. You MUST use all the words from the word box (there is / there are + prepositions).',
      sourceText: 'Sentence starters:\n1. In my pencil case, there is … .\n2. In my pencil case, there are … .\n3. On my desk, there … .\n4. Next to my book, … .\n5. Under my chair, … .\n6. Behind my school bag / in front of the window, … .',
      minWords: 50,
      maxWords: 160,
      requiredWords: ['there is', 'there are', 'next to', 'under', 'in front of'],
      hints: [
        '1. Lies die Aufgabe genau: 6 Sätze über deinen Schreibtisch und dein Federpennal. Alle Wörter aus der Wortbox (there is, there are, next to, under, in front of) müssen verwendet werden!',
        '2. Sammle Ideen: Was liegt IN, ON, UNDER, NEXT TO, BEHIND, IN FRONT OF deinem Schreibtisch? Achte auf there is (1) vs. there are (2+).',
        '3. Schreibe 6 klare Sätze. Prüfe am Ende: alle Wortbox-Wörter drin? there is/are richtig? Großschreibung am Satzanfang?',
      ],
    },
    exit: (p) => [
      fb(`${p}-x1`, 'there <<1>> a lion and there <<2>> two giraffes.', { 1: ['is'], 2: ['are'] }),
      fb(`${p}-x2`, 'Präpositionen: vor = <<1>>  ·  neben = <<2>>  ·  unter = <<3>>', { 1: ['in front of'], 2: ['next to'], 3: ['under'] }),
      fb(`${p}-x3`, 'Short forms: we are = <<1>>  ·  he is = <<2>>', { 1: ["we're", 'we are'], 2: ["he's", 'he is'] }),
      sa(`${p}-x4`, '„_____ is the cat?“ — „It’s under the chair.“', ['Where’s', 'Where is']),
      sa(`${p}-x5`, 'Plural: 1 child → 2 ?', ['children']),
      mc(`${p}-x6`, 'Spot the mistake: „There is six penguins in the water.“ — correct?', [
        { text: 'There is six penguins in the water.' },
        { text: 'There are six penguins in the water.', correct: true },
        { text: 'There are six penguin in the water.' },
      ]),
      sa(`${p}-x7`, '„What’s up?“ auf Deutsch?', ['Was ist los?']),
      sa(`${p}-x8`, 'füttern auf Englisch?', ['feed']),
      sa(`${p}-x9`, 'Reiseführer auf Englisch?', ['guide']),
      sa(`${p}-x10`, 'Affe auf Englisch?', ['monkey']),
      fb(`${p}-x11`, '<<1>> you at the zoo today? — Yes, I am.', { 1: ['Are'] }),
      tf(`${p}-x12`, 'There are two lions in Brightside Wildlife Park.', true),
    ],
    // ⭐ Bonus tasks (never block the sequence)
    bonus: (courseTitle, p) => [
      def(`${courseTitle}: ⭐ Bonus 1 — Hangman & Kreuzworträtsel`, 'Spaßige Bonusrunde: Hangman + Kreuzworträtsel mit Unit-Wörtern.', [
        hangman(`${p}-b1-h1`, 'MONKEY', 'Tier, das gern in Bäumen klettert (engl.)'),
        hangman(`${p}-b1-h2`, 'GIRAFFE', 'großes Tier mit langem Hals (engl.)'),
        hangman(`${p}-b1-h3`, 'PENGUIN', 'schwarz-weißer Vogel, der nicht fliegen kann (engl.)'),
        hangman(`${p}-b1-h4`, 'PARROT', 'bunter sprechender Vogel (engl.)'),
        crossword(`${p}-b1-x`, 'Kreuzworträtsel Unit 2', [
          { word: 'ZOO', clue: 'Zoo (engl.) — Brightside Wildlife ___', row: 0, col: 0, direction: 'across' },
          { word: 'ZEBRA', clue: 'Tier mit schwarzen Streifen (engl.)', row: 0, col: 0, direction: 'down' },
          { word: 'OTTER', clue: 'Tier, das gern im Wasser schwimmt (engl.)', row: 0, col: 1, direction: 'down' },
          { word: 'OWL', clue: 'Eule (engl.)', row: 0, col: 2, direction: 'down' },
        ]),
      ]),
      def(`${courseTitle}: ⭐ Bonus 2 — In Zonen sortieren & Fehler streichen`, 'Ziehe die Tiere in die richtige Zone und streiche die Fehler.', [
        groups(`${p}-b2-g`, 'Ziehe jedes Tier in die richtige Zone:', ['im Wasser', 'in den Bäumen', 'im Park (auf dem Boden)'], [
          { text: 'der Pinguin', zone: 1 },
          { text: 'der Affe', zone: 2 },
          { text: 'der Papagei', zone: 2 },
          { text: 'der Löwe', zone: 3 },
          { text: 'die Giraffe', zone: 3 },
        ]),
        matchPairs(`${p}-b2-m`, 'Ordne Deutsch ↔ Englisch zu:', [
          ['der Affe', 'monkey'],
          ['die Giraffe', 'giraffe'],
          ['der Pinguin', 'penguin'],
          ['füttern', 'feed'],
          ['der/die Reiseführer/in', 'guide'],
          ['Was ist los?', 'What’s up?'],
        ]),
        vocabQuiz(`${p}-b2-spell`, SPELL_U2, 'both', 2, 'spell'),
        strike(`${p}-b2-s1`, 'Streiche das falsche Wort und korrigiere es: „There are a giraffe in the zoo.“', [
          { text: 'There' }, { text: 'are', target: 'wrong', fix: 'is' }, { text: 'a' }, { text: 'giraffe' }, { text: 'in' }, { text: 'the' }, { text: 'zoo.' },
        ]),
        strike(`${p}-b2-s2`, 'Streiche das falsche Wort und korrigiere es: „The monkeys is funny.“', [
          { text: 'The' }, { text: 'monkeys' }, { text: 'is', target: 'wrong', fix: 'are' }, { text: 'funny.' },
        ]),
      ]),
    ],
  },
  {
    unit: 3,
    title: 'Pirates',
    vocab: [
      { term: 'das Auge', translation: 'eye' },
      { term: 'die Nase', translation: 'nose' },
      { term: 'der Mund', translation: 'mouth' },
      { term: 'das Ohr', translation: 'ear' },
      { term: 'die Zähne (pl.)', translation: 'teeth' },
      { term: 'die Füße (pl.)', translation: 'feet' },
      { term: 'der Bart', translation: 'beard' },
      { term: 'die Schulter', translation: 'shoulder' },
      { term: 'der linke Arm', translation: 'left arm' },
      { term: 'das Holzbein', translation: 'wooden leg' },
      { term: 'groß', translation: 'big', alternatives: ['large'] },
      { term: 'klein', translation: 'small' },
      { term: 'lang', translation: 'long' },
      { term: 'kurz', translation: 'short' },
      { term: 'hoch', translation: 'tall' },
      { term: 'wahr', translation: 'true' },
      { term: 'der Schatz', translation: 'treasure' },
      { term: 'der Piratensäbel', translation: 'cutlass' },
      { term: 'berühmt', translation: 'famous' },
      { term: 'der Kapitän', translation: 'captain' },
      { term: 'der Haken', translation: 'hook' },
      { term: 'Angst haben vor', translation: 'scared of' },
      { term: 'das Schiff', translation: 'ship' },
      { term: 'einkaufen gehen', translation: 'go shopping' },
      { term: 'ins Kino gehen', translation: 'go to the cinema' },
      { term: 'Skateboard fahren', translation: 'go skateboarding' },
      { term: 'bowlen gehen', translation: 'go bowling' },
      { term: 'Mir ist langweilig.', translation: 'I’m bored.', alternatives: ['I am bored'] },
      { term: 'Gute Idee!', translation: 'Good idea' },
      { term: 'Du bist dran.', translation: 'It’s your turn.', alternatives: ['It is your turn'] },
      { term: 'Ich hasse / Ich liebe', translation: 'I hate / I love' },
      { term: 'langweilig', translation: 'bored' },
      { term: 'der Arm', translation: 'arm' },
      { term: 'scharf', translation: 'sharp' },
      { term: 'der Hafen', translation: 'harbour', alternatives: ['port'] },
    ],
    grammar: (p) => [
      fb(`${p}-g1`, 'have got / has got (positiv) oder haven’t / hasn’t (negativ):', 'Captain Hook <<1>> a big ship. (+)  ·  I <<2>> a real pirate parrot. (–)  ·  Greybeard <<3>> a strong leg. (–)  ·  Tamara <<4>> blue eyes. (+)', {
        1: ['has got', "'s got", 'has'], 2: ["haven't got", "haven't", 'have not got'], 3: ["hasn't got", "hasn't", 'has not got'], 4: ['has got', "'s got", 'has'],
      }),
      fb(`${p}-g2`, 'Unregelmäßige Plural: 1 tooth → 2 <<1>>  ·  1 foot → 2 <<2>>', { 1: ['teeth'], 2: ['feet'] }),
      mc(`${p}-g3`, 'Spot the mistake: „Greybeard have got a long black beard.“ — correct?', [
        { text: 'Greybeard have got a long black beard.' },
        { text: 'Greybeard has got a long black beard.', correct: true },
        { text: 'Greybeard having got a long black beard.' },
      ]),
      mc(`${p}-g4`, 'Spot the mistake: „The pirate has got two big foots and sharp tooths!“ — correct?', [
        { text: 'The pirate has got two big foots and sharp tooths!' },
        { text: 'The pirate has got two big feet and sharp teeth!', correct: true },
        { text: 'The pirate have got two big feet and sharp teeth!' },
      ]),
      sa(`${p}-g5`, 'Short answer: „Has Captain Hook got a silver hook?“ (✓) → „Yes, ______.“', ['he has', 'Captain Hook has', 'he has got']),
      sa(`${p}-g6`, 'Short answer: „Have Fred and Frank got big noses?“ (✗) → „No, ______.“', ['they haven’t', 'they have not', 'they haven’t got']),
      ord(`${p}-g7`, 'Unscramble: bringe die Wörter in die richtige Reihenfolge:', ['Tamara', "hasn't", 'got', 'a', 'big', 'nose.']),
      fb(`${p}-g8`, 'have got — Fragen bilden: <<1>> Captain Scarlet got a parrot? — Yes, she <<2>>.', { 1: ['Has'], 2: ['has'] }),
      sa(`${p}-g9`, 'Plural: 1 eye → 2 ?', ['eyes']),
      mc(`${p}-g10`, 'Spot the mistake: „The pirates have got sharp tooths.“ — correct?', [
        { text: 'The pirates have got sharp tooths.' },
        { text: 'The pirates have got sharp teeth.', correct: true },
        { text: 'The pirates has got sharp teeth.' },
      ]),
      fb(`${p}-g11`, 'Vorschläge machen (Let’s …): Let’s <<1>> shopping!  ·  Let’s <<2>> to the cinema!  ·  Let’s <<3>> skateboarding!  ·  Let’s <<4>> bowling!', {
        1: ['go'], 2: ['go'], 3: ['go'], 4: ['go'],
      }),
      sa(`${p}-g12`, '„Mir ist langweilig.“ auf Englisch?', ["I'm bored", 'I am bored']),
      ord(`${p}-g13`, 'Unscramble:', ['He', 'has', 'got', 'a', 'grey', 'beard.']),
      tf(`${p}-g14`, '„Captain Hook has got a wooden leg.“ — this sentence is true.', false),
    ],
    readings: [
      {
        id: 'A',
        title: 'Text A — Captain Scarlet and the Missing Treasure Map',
        text: `TEXT A — Captain Scarlet and the Missing Treasure Map (~160 words)

Captain Scarlet is a famous pirate. She is tall and very strong. She has got long red hair, bright green eyes and a pretty smile. On her left shoulder, there is a small green parrot called Kiwi. Scarlet has got a big black ship, a sharp cutlass and a lot of gold treasure — but she hasn't got a wooden leg! Both of her feet are real.

Today Scarlet is tired and a bit angry. Why? Her brother, One-Eyed Jack, has got her treasure map! Jack is short with blonde hair and a grey beard. He has got a silver hook on his right arm and he is scared of cannonballs. "I'll guess where he is!" says Scarlet. "He's in his bed on the small ship!"`,
        questions: (p) => [
          mc(`${p}-a1`, "What colour are Captain Scarlet's eyes?", [{ text: 'blue' }, { text: 'green', correct: true }, { text: 'brown' }]),
          mc(`${p}-a2`, 'Where is Kiwi the parrot?', [{ text: 'on her left shoulder', correct: true }, { text: 'on her right arm' }, { text: 'on the ship' }]),
          mc(`${p}-a3`, 'Who is One-Eyed Jack?', [{ text: "Scarlet's captain" }, { text: "Scarlet's parrot" }, { text: "Scarlet's brother", correct: true }]),
          mc(`${p}-a4`, 'What is Jack scared of?', [{ text: 'pirates' }, { text: 'cannonballs', correct: true }, { text: 'treasure maps' }]),
          tf(`${p}-a5`, 'Captain Scarlet has got a wooden leg.', false),
          tf(`${p}-a6`, "Scarlet hasn't got a cutlass.", false),
          sa(`${p}-a7`, 'Name three things Captain Scarlet has got.', ['ship', 'cutlass', 'treasure', 'parrot', 'gold', 'Kiwi']),
          sa(`${p}-a8`, 'Where is One-Eyed Jack hiding?', ['in his bed on the small ship', 'in his bed', 'on the small ship']),
        ],
      },
      {
        id: 'B',
        title: 'Text B — WANTED Poster (spot the mistakes!)',
        text: `TEXT B — WANTED Poster (spot the 3 mistakes — compare with Text A!)

WANTED: One-Eyed Jack! He is very tall and has got short black hair and a grey beard. He has got a silver hook on his left arm. He loves loud cannonballs! Reward: 100 gold coins — tell Captain Scarlet!`,
        questions: (p) => [
          mc(`${p}-b1`, 'Mistake 1: How tall is Jack really (see Text A)?', [
            { text: 'short', correct: true },
            { text: 'very tall' },
            { text: 'tall' },
          ]),
          mc(`${p}-b2`, 'Mistake 2: What colour is Jack’s hair really?', [
            { text: 'blonde', correct: true },
            { text: 'short black' },
            { text: 'red' },
          ]),
          mc(`${p}-b3`, 'Mistake 3: On which arm is the hook?', [
            { text: 'right arm', correct: true },
            { text: 'left arm' },
            { text: 'left shoulder' },
          ]),
          tf(`${p}-b4`, 'Jack loves loud cannonballs (poster) — but in Text A he is scared of them.', true),
          sa(`${p}-b5`, 'berühmt auf Englisch (Text A)?', ['famous']),
          sa(`${p}-b6`, 'Piratensäbel auf Englisch (Text A)?', ['cutlass']),
        ],
      },
      {
        id: 'C',
        title: 'Text C — What’s Up? (a dialogue)',
        text: `TEXT C — What's up? (~110 words)

Tom: "Hi Mia! What's up?"
Mia: "Hi Tom! I'm bored. Are you bored, too?"
Tom: "Yes, I'm bored. Let's go bowling!"
Mia: "Good idea! Or let's go to the cinema?"
Tom: "Hmm. I love bowling. Let's go bowling at four o'clock!"
Mia: "Great! And on Saturday let's go skateboarding in the park!"
Tom: "Yes! I love skateboarding. It's my turn today!"
Mia: "No, it's MY turn! Ha ha!"`,
        questions: (p) => [
          sa(`${p}-c1`, '„What’s up?“ — meaning here?', ['What is happening', 'What is up', 'What’s happening', 'What is going on']),
          tf(`${p}-c2`, 'Mia is bored.', true),
          mc(`${p}-c3`, 'What does Tom suggest first?', [
            { text: 'go bowling', correct: true },
            { text: 'go to the cinema' },
            { text: 'go skateboarding' },
          ]),
          sa(`${p}-c4`, 'When do they go bowling?', ['at four o’clock', 'at four oclock', 'at 4 o’clock', 'at 4']),
          tf(`${p}-c5`, 'On Saturday they go to the cinema.', false),
          sa(`${p}-c6`, 'bowlen gehen auf Englisch?', ['go bowling']),
          sa(`${p}-c7`, '„Du bist dran.“ auf Englisch?', ['It’s your turn', 'It is your turn']),
          tf(`${p}-c8`, 'Tom says: "It’s my turn today!"', true),
        ],
      },
    ],
    listenings: [
      {
        id: '1',
        title: 'Hören 1 — Captain Scarlet',
        script: `VORLESETEXT (die Lehrkraft liest vor):

Captain Scarlet is a famous pirate. She is tall and very strong.
She has got long red hair and bright green eyes.
On her left shoulder there is a small green parrot called Kiwi.
She has got a big black ship, a sharp cutlass and a lot of gold treasure.
But she hasn't got a wooden leg — both of her feet are real.
Today she is tired and a bit angry, because her brother Jack has got her treasure map.
Jack is short, he has got blonde hair, a grey beard and a silver hook on his right arm.
He is scared of cannonballs.`,
        questions: (p) => [
          mc(`${p}-h1-1`, 'What colour are Captain Scarlet’s eyes?', [{ text: 'blue' }, { text: 'green', correct: true }, { text: 'brown' }]),
          mc(`${p}-h1-2`, 'Where is Kiwi the parrot?', [{ text: 'on her left shoulder', correct: true }, { text: 'on her right arm' }, { text: 'on the ship' }]),
          mc(`${p}-h1-3`, 'Has Captain Scarlet got a wooden leg?', [{ text: 'Yes' }, { text: 'No', correct: true }]),
          tf(`${p}-h1-4`, 'Captain Scarlet has got a sharp cutlass.', true),
          sa(`${p}-h1-5`, 'What is Jack scared of?', ['cannonballs']),
          sa(`${p}-h1-6`, 'What colour is Scarlet’s hair?', ['red', 'long red']),
        ],
      },
      {
        id: '2',
        title: 'Hören 2 — One-Eyed Jack',
        script: `VORLESETEXT (die Lehrkraft liest vor):

This is One-Eyed Jack, Captain Scarlet's brother. He is short, not tall.
He has got blonde hair and a grey beard. He has got one eye.
On his right arm he has got a silver hook. He hasn't got a wooden leg.
Jack is scared of cannonballs, but he loves loud music.
Today Jack has got Captain Scarlet's treasure map. He is in his bed on the small ship.`,
        questions: (p) => [
          tf(`${p}-h2-1`, 'Jack is very tall.', false),
          mc(`${p}-h2-2`, 'What colour is Jack’s hair?', [{ text: 'black' }, { text: 'blonde', correct: true }, { text: 'red' }]),
          mc(`${p}-h2-3`, 'Where is Jack’s silver hook?', [
            { text: 'on his right arm', correct: true },
            { text: 'on his left arm' },
            { text: 'on his head' },
          ]),
          tf(`${p}-h2-4`, 'Jack has got a wooden leg.', false),
          sa(`${p}-h2-5`, 'What is Jack scared of?', ['cannonballs']),
          sa(`${p}-h2-6`, 'What has Jack got today?', ['the treasure map', 'Captain Scarlet’s treasure map', 'her treasure map', 'Scarlet’s treasure map']),
        ],
      },
      {
        id: '3',
        title: 'Hören 3 — „I’m bored!“ (Dialog)',
        script: `VORLESETEXT (die Lehrkraft liest vor):

Tom: "Hi Mia! What's up?"
Mia: "Hi Tom! I'm bored. Are you bored, too?"
Tom: "Yes, I'm bored. Let's go bowling!"
Mia: "Good idea! Or let's go to the cinema?"
Tom: "I love bowling. Let's go bowling at four o'clock!"
Mia: "Great! On Saturday let's go skateboarding in the park! It's my turn!"`,
        questions: (p) => [
          sa(`${p}-h3-1`, '„I’m bored.“ — auf Deutsch?', ['Mir ist langweilig', 'Mir ist langweilig.']),
          mc(`${p}-h3-2`, 'What does Tom suggest?', [
            { text: 'go bowling', correct: true },
            { text: 'go shopping' },
            { text: 'go to the zoo' },
          ]),
          mc(`${p}-h3-3`, 'What does Mia suggest as an alternative?', [
            { text: 'go to the cinema', correct: true },
            { text: 'go bowling' },
            { text: 'go skateboarding' },
          ]),
          sa(`${p}-h3-4`, 'When do they go bowling?', ['at four o’clock', 'at 4 o’clock', 'at four oclock', 'at 4']),
          tf(`${p}-h3-5`, 'On Saturday they go skateboarding.', true),
          sa(`${p}-h3-6`, '„Gute Idee!“ auf Englisch?', ['Good idea']),
        ],
      },
    ],
    writing: {
      stem: 'Write about Captain Blackbeard — about 6 sentences / 50 words. You MUST use all the words from the word box (has got / hasn’t got …).',
      sourceText: 'Mind map:  Blackbeard  |  IS: tall, strong, famous  |  HAS GOT: black beard, brown eyes, big ship, treasure  |  HASN’T GOT: wooden leg, parrot\n\nSentence starters:\n1. This is Captain Blackbeard. He … .\n2. He has got … .\n3. He is … .\n4. He has also got … .\n5. He hasn’t got … .\n6. I think Blackbeard … .',
      minWords: 50,
      maxWords: 140,
      requiredWords: ['famous', 'has got', "hasn't got", 'beard', 'treasure'],
      hints: [
        '1. Lies die Aufgabe genau: Schreibe 6 Sätze über Captain Blackbeard. Alle Wörter aus der Wortbox (famous, has got, hasn’t got, beard, treasure) müssen verwendet werden!',
        '2. Sammle Ideen aus der Mindmap: Wie ist er (is)? Was hat er (has got)? Was hat er nicht (hasn’t got)?',
        '3. Schreibe 6 klare Sätze mit den Satzanfängen. Prüfe am Ende: Wortbox komplett? has/has got richtig? Großschreibung?',
      ],
    },
    exit: (p) => [
      fb(`${p}-x1`, 'Plural: 1 tooth → 4 <<1>>  ·  1 foot → 2 <<2>>', { 1: ['teeth'], 2: ['feet'] }),
      sa(`${p}-x2`, 'Lücke: Tamara ______ (have got ✓) green eyes.', ['has got', "'s got", 'has']),
      sa(`${p}-x3`, 'Short answer: „Has Hook got a ship?“ → „Yes, ______.“', ['he has', 'he has got', 'Hook has']),
      sa(`${p}-x4`, 'Vorschlag: „I’m bored.“ — „Let’s __________ shopping!“', ['go']),
      sa(`${p}-x5`, 'Plural: 1 eye → 3 ?', ['eyes']),
      sa(`${p}-x6`, '„I’m bored.“ — „Let’s go ______!“ (bowling)', ['bowling', 'go bowling']),
      fb(`${p}-x7`, '<<1>> you scared of spiders? — No, I <<2>>.', { 1: ['Are'], 2: ["'m not", 'am not'] }),
      sa(`${p}-x8`, 'Kapitän auf Englisch?', ['captain']),
      mc(`${p}-x9`, 'Spot the mistake: „She have got a hook.“ — correct?', [
        { text: 'She have got a hook.' },
        { text: 'She has got a hook.', correct: true },
        { text: 'She having got a hook.' },
      ]),
      sa(`${p}-x10`, 'Schatz auf Englisch?', ['treasure']),
      sa(`${p}-x11`, '„Gute Idee!“ auf Englisch?', ['Good idea']),
      tf(`${p}-x12`, 'Captain Scarlet is scared of cannonballs.', false),
    ],
    // ⭐ Bonus tasks (never block the sequence)
    bonus: (courseTitle, p) => [
      def(`${courseTitle}: ⭐ Bonus 1 — Hangman & Kreuzworträtsel`, 'Spaßige Bonusrunde: Hangman + Kreuzworträtsel mit Unit-Wörtern.', [
        hangman(`${p}-b1-h1`, 'TREASURE', 'der Schatz der Piraten (engl.)'),
        hangman(`${p}-b1-h2`, 'CUTLASS', 'das Piratenschwert (engl.)'),
        hangman(`${p}-b1-h3`, 'PIRATE', 'der Pirat (engl.)'),
        hangman(`${p}-b1-h4`, 'BEARD', 'der Bart (engl.)'),
        crossword(`${p}-b1-x`, 'Kreuzworträtsel Unit 3', [
          { word: 'SHIP', clue: 'Schiff (engl.)', row: 0, col: 0, direction: 'across' },
          { word: 'SWORD', clue: 'Schwert (engl.)', row: 0, col: 0, direction: 'down' },
          { word: 'HOOK', clue: 'Haken (engl.) — Captain Hook has got one', row: 0, col: 1, direction: 'down' },
          { word: 'PARROT', clue: 'Papagei (engl.) — Kiwi is one', row: 0, col: 3, direction: 'down' },
        ]),
      ]),
      def(`${courseTitle}: ⭐ Bonus 2 — has got / hasn’t got & Fehler streichen`, 'Sortiere in „hat …“ / „hat nicht …“ und streiche die Fehler.', [
        groups(`${p}-b2-g`, 'Ziehe jede Sache in die richtige Zone:', ['hat er … (has got)', 'hat er nicht … (hasn’t got)'], [
          { text: 'ein großes Schiff', zone: 1 },
          { text: 'einen grauen Bart', zone: 1 },
          { text: 'ein Holzbein', zone: 2 },
          { text: 'einen Papagei', zone: 2 },
        ]),
        matchPairs(`${p}-b2-m`, 'Ordne Deutsch ↔ Englisch zu:', [
          ['der Schatz', 'treasure'],
          ['der Haken', 'hook'],
          ['der Kapitän', 'captain'],
          ['der Bart', 'beard'],
          ['das Schiff', 'ship'],
          ['Angst haben vor', 'scared of'],
        ]),
        vocabQuiz(`${p}-b2-spell`, SPELL_U3, 'both', 2, 'spell'),
        strike(`${p}-b2-s1`, 'Streiche das falsche Wort und korrigiere es: „Greybeard have got a long beard.“', [
          { text: 'Greybeard' }, { text: 'have', target: 'wrong', fix: 'has' }, { text: 'got' }, { text: 'a' }, { text: 'long' }, { text: 'beard.' },
        ]),
        strike(`${p}-b2-s2`, 'Streiche das falsche Wort und korrigiere es: „She have got a silver hook.“', [
          { text: 'She' }, { text: 'have', target: 'wrong', fix: 'has' }, { text: 'got' }, { text: 'a' }, { text: 'silver' }, { text: 'hook.' },
        ]),
      ]),
    ],
  },
];

// ---------------------------------------------------------------------------
// Course builder
// ---------------------------------------------------------------------------

/**
 * Build the activities of one MORE1 unit course: the ten regular activities
 * plus the ⭐ bonus activities (returned separately in `bonusTitles` so the
 * seeder can flag those class items as bonus — they never block the sequence).
 * @param {1|2|3} unitNumber
 * @returns {{courseTitle: string, unit: number, activities: object[], bonusTitles: string[]}}
 */
export function buildUnitCourse(unitNumber) {
  const unit = UNITS.find((entry) => entry.unit === Number(unitNumber));
  if (!unit) throw new Error(`Unknown MORE1 unit: ${unitNumber}`);
  const courseTitle = `Unit ${unit.unit} — ${unit.title}`;
  const p = `u${unit.unit}`;

  const activities = [
    def(`${courseTitle}: Vokabeln`, 'Quiz-Trainer: übersetze die Wörter in beide Richtungen.', [
      vocabQuiz(`${p}-vocab`, unit.vocab, 'both', 3),
    ]),
    def(`${courseTitle}: Grammatik`, 'Übe die Grammatik-Schwerpunkte der Unit.', unit.grammar(p), 'worksheet'),
  ];

  // Lesen 1–3: each reading = text block + questions
  unit.readings.forEach((reading, index) => {
    activities.push(
      def(
        `${courseTitle}: Lesen ${index + 1}`,
        `Lies den Text und beantworte die Fragen.`,
        [
          textBlock(`${p}-r${reading.id}-text`, `${reading.title}:`, reading.text),
          ...reading.questions(`${p}-r${reading.id}`),
        ],
        'worksheet',
      ),
    );
  });

  // Hören 1–3: each listening = teacher read-aloud script + questions
  unit.listenings.forEach((listening, index) => {
    activities.push(
      def(
        `${courseTitle}: Hören ${index + 1}`,
        'Hörübung: Die Lehrkraft liest den Text vor (Vorlesetext unten). Beantworte dann die Fragen.',
        [
          textBlock(`${p}-h${listening.id}-script`, `Vorlesetext — ${listening.title} (die Lehrkraft liest vor):`, listening.script),
          ...listening.questions(`${p}-h${listening.id}`),
        ],
        'worksheet',
      ),
    );
  });

  activities.push(
    def(`${courseTitle}: Schreiben`, 'Schreibaufgabe mit KI-Zwischenfeedback — hol dir vor dem Abgeben Feedback! Wortbox beachten.', [
      writingTask(`${p}-write`, unit.writing, 5),
    ], 'worksheet'),
    def(`${courseTitle}: Exit-Check`, 'Test dich selbst — schaffst du alles richtig?', unit.exit(p), 'quiz'),
  );

  // ⭐ Bonus activities (flagged as bonus on the class item — no blocking).
  const bonusTitles = [];
  if (typeof unit.bonus === 'function') {
    for (const bonusActivity of unit.bonus(courseTitle, p)) {
      activities.push(bonusActivity);
      bonusTitles.push(bonusActivity.title);
    }
  }

  for (const activity of activities) {
    const check = validateActivity(activity);
    if (!check.ok) {
      throw new Error(`MORE1 unit ${unit.unit} activity "${activity.title}" is invalid: ${check.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
    }
  }
  return { courseTitle, unit: unit.unit, activities, bonusTitles };
}

/** All three unit courses (Unit 1–3). */
export function buildMore1Courses() {
  return UNITS.map((unit) => buildUnitCourse(unit.unit));
}

export { UNITS as MORE1_UNITS };
