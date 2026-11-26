// MORE 1 (MS Telfs, class 1G) — revision courses for Unit 1–3, built from the
// book's revision worksheets (MORE1/Unit_*_Revision_Worksheet_1G.docx).
// Pure module: builds validated activity definitions per unit. Each unit is a
// "course" of six activities: Vokabeln, Grammatik, Lesen, Hören (with a
// teacher read-aloud script), Schreiben (AI-feedback writing task), Exit-Check.
import { createDefinition, normalizeActivity, validateActivity } from './activity.js';
import { createItem } from './items/index.js';
import { shortId } from './util.js';

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

function vocabQuiz(id, entries, direction = 'both', points = 3) {
  const item = createItem('vocabulary', { id, points });
  item.stem = 'Übersetze — ein Wort nach dem anderen (Quiz-Trainer).';
  item.config = {
    mode: 'quiz',
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

const WRITING_CRITERIA = [
  { id: 'c1', label: 'Inhalt', weight: 40, description: 'Bezug zur Aufgabe, alle gefragten Angaben vorhanden und korrekt' },
  { id: 'c2', label: 'Sprache & Rechtschreibung', weight: 35, description: 'Grammatik, Rechtschreibung, Groß-/Kleinschreibung' },
  { id: 'c3', label: 'Struktur', weight: 25, description: 'Klare Sätze, sinnvolle Reihenfolge, geforderte Länge' },
];

function writingTask(id, stem, sourceText, minWords, maxWords = 150, points = 5) {
  const item = createItem('writing', { id, points });
  item.stem = stem;
  item.config = {
    gradeLevel: '1G (5. Klasse)',
    sourceText,
    criteria: WRITING_CRITERIA,
    minWords,
    maxWords,
    allowLoops: true,
  };
  return item;
}

// ---------------------------------------------------------------------------
// Unit content (from the revision worksheets)
// ---------------------------------------------------------------------------

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
    ],
    grammar: (prefix) => [
      fb(`${prefix}-g1`, 'Schreibe die Mehrzahl (Plural):', '1 dog → 4 <<1>>  ·  1 desk → 8 <<2>>  ·  1 apple → 3 <<3>>  ·  1 ball → 10 <<4>>', {
        1: ['dogs'], 2: ['desks'], 3: ['apples'], 4: ['balls'],
      }),
      fb(`${prefix}-g2`, 'Achtung: y wird zu ies, unregelmäßig:', '1 baby → 2 <<1>>  ·  1 boy → 5 <<2>>  ·  1 child → 7 <<3>>  ·  1 fish → 6 <<4>>', {
        1: ['babies'], 2: ['boys'], 3: ['children'], 4: ['fish'],
      }),
      fb(`${prefix}-g3`, 'Bilde den Imperativ (Befehl): „Sei nicht laut!“ → „<<1>> , please!“  ·  „Mach das Fenster zu!“ → „<<2>> the window!“', '„Sei nicht laut!“ → „<<1>>, please!“   ·   „Mach das Fenster zu!“ → „<<2>> the window!“', {
        1: ["Don't speak", 'Do not speak'], 2: ['Close'],
      }),
      fb(`${prefix}-g4`, 'Wie schreibt man eine E-Mail-Adresse? @ = <<1>>  und  . = <<2>>', { 1: ['at'], 2: ['dot'] }),
      ord(`${prefix}-g5`, 'Bringe die Wörter in die richtige Reihenfolge (Imperativ):', ["Don't", 'open', 'your', 'school', 'bags.']),
      ord(`${prefix}-g6`, 'Bringe die Wörter in die richtige Reihenfolge (Frage):', ['What', "'s", 'your', 'email', 'address?']),
      sa(`${prefix}-g7`, 'Zahl in Englisch: 13 = ?', ['thirteen']),
      sa(`${prefix}-g8`, 'Zahl in Englisch: 24 − 2 = ?', ['twenty-two']),
      mc(`${prefix}-g9`, 'Odd one out — which word does NOT belong? (red, pink, rubber, light blue, grey)', [
        { text: 'red', correct: false },
        { text: 'pink', correct: false },
        { text: 'rubber', correct: true },
        { text: 'light blue', correct: false },
        { text: 'grey', correct: false },
      ]),
    ],
    readingTextA: `TEXT A — Welcome to Class 1G! Leo's New Classroom (~145 words)

Hello! My name is Leo and I am ten years old. I am in class 1G at my new school. My email address is leo10@telfs.at. My favourite colour is light blue, and I hate pink! My school tie is blue and white.

Look at my classroom! The floor is green and the board is white. There are fourteen brown desks and fourteen black chairs. There is one big projector, a sound system, and two blue doors. Three windows are next to the teacher's desk.

On my desk, there is my orange school bag and my blue pencil case. In my pencil case, I have got two blue pens, one yellow pencil, a green rubber, a ruler and a glue stick. I haven't got watercolours today. At 8 o'clock, Miss Green says: "Sit down, children! Take out your exercise books! Don't speak!"`,
    readingTextB: `TEXT B — Luna's Uniform Note (~45 words)

Hi Leo! I'm Luna from Year 6 in London. At my school we wear a grey skirt, a white shirt, a dark green sweater and black shoes. My school tie is green and yellow. Look — I've got cool sunglasses and a red hairband, too!`,
    readingQuestions: (prefix) => [
      mc(`${prefix}-r1`, 'How old is Leo?', [{ text: 'nine' }, { text: 'ten', correct: true }, { text: 'eleven' }]),
      mc(`${prefix}-r2`, 'What colour is the classroom floor?', [{ text: 'green', correct: true }, { text: 'brown' }, { text: 'light blue' }]),
      mc(`${prefix}-r3`, 'How many chairs are in class 1G?', [{ text: 'twelve' }, { text: 'fourteen', correct: true }, { text: 'fifteen' }]),
      mc(`${prefix}-r4`, "What colour is Luna's sweater?", [{ text: 'grey' }, { text: 'black' }, { text: 'dark green', correct: true }]),
      tf(`${prefix}-r5`, "Leo's favourite colour is pink.", false),
      tf(`${prefix}-r6`, 'There are two doors in Leo’s classroom.', true),
      tf(`${prefix}-r7`, 'Leo has got watercolours in his pencil case today.', false),
      tf(`${prefix}-r8`, "Luna's school tie is blue and white.", false),
      sa(`${prefix}-r9`, "What is Leo's email address?", ['leo10@telfs.at']),
      sa(`${prefix}-r10`, 'What colour are the desks in class 1G?', ['brown']),
      sa(`${prefix}-r11`, 'Krawatte auf Englisch (find it in the texts)?', ['tie']),
      sa(`${prefix}-r12`, 'Sonnenbrille auf Englisch (find it in the texts)?', ['sunglasses']),
    ],
    listenScript: `VORLESETEXT (die Lehrkraft liest vor):

Hello! My name is Leo. I am ten years old. I am in class 1 G at my new school.
My favourite colour is light blue.
In my classroom there are fourteen desks and fourteen chairs. The floor is green and the board is white.
On my desk there is an orange school bag and a blue pencil case.
In my pencil case I have got two pens, one pencil, a rubber, a ruler and a glue stick.`,
    listenQuestions: (prefix) => [
      mc(`${prefix}-h1`, 'How old is Leo?', [{ text: 'nine' }, { text: 'ten', correct: true }, { text: 'eleven' }]),
      mc(`${prefix}-h2`, 'How many desks are in the classroom?', [{ text: 'twelve' }, { text: 'thirteen' }, { text: 'fourteen', correct: true }]),
      mc(`${prefix}-h3`, 'What colour is the floor?', [{ text: 'white' }, { text: 'green', correct: true }, { text: 'brown' }]),
      mc(`${prefix}-h4`, "What colour is Leo's school bag?", [{ text: 'blue' }, { text: 'orange', correct: true }, { text: 'green' }]),
      sa(`${prefix}-h5`, "What is Leo's favourite colour?", ['light blue']),
      sa(`${prefix}-h6`, 'How many pens has Leo got?', ['two', '2']),
    ],
    writing: {
      stem: 'Write about you and your classroom — write 6 clear sentences (like Leo in the reading text).',
      sourceText: 'Sentence starters:\n1. Hello! My name is … . I am … years old and I am in class … .\n2. My favourite colour is … , and I hate … .\n3. In my classroom, the floor is … and the board is … .\n4. In my school bag, there is … .\n5. In my pencil case, I have got … .\n6. My school clothes today: … .',
      minWords: 40,
      maxWords: 150,
    },
    exit: (prefix) => [
      sa(`${prefix}-x1`, 'Plural: 1 baby → 3 ?', ['children']),
      sa(`${prefix}-x2`, 'Plural: 1 child → 4 ?', ['children']),
      sa(`${prefix}-x3`, 'Imperativ (don’t): „_____ on your desk!“ (sit)', ["Don't sit", 'Do not sit']),
      sa(`${prefix}-x4`, 'Zahl in Englisch: 12 = ?', ['twelve']),
      sa(`${prefix}-x5`, 'Zahl in Englisch: 20 = ?', ['twenty']),
      fb(`${prefix}-x6`, 'Lies vor: ben@mail.at → b-e-n <<1>> m-a-i-l <<2>> a-t', { 1: ['at'], 2: ['dot'] }),
      sa(`${prefix}-x7`, 'Schreibe: „My name is …“ — z. B. „My name is Leo.“', ['My name is Leo']),
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
    ],
    grammar: (prefix) => [
      fb(`${prefix}-g1`, 'there is (1) oder there are (2+):', '<<1>> a big lion in the park.  ·  <<2>> five monkeys in the tree.  ·  <<3>> two penguins in the water.  ·  <<4>> three children on the train.', {
        1: ['There is', "There's"], 2: ['There are', "There're"], 3: ['There are', "There're"], 4: ['There are', "There're"],
      }),
      fb(`${prefix}-g2`, 'Präpositionen (in, on, under, behind, in front of, next to):', 'Your pens are <<1>> your pencil case.  ·  The chair is <<2>> the desk (neben).  ·  The cat is <<3>> the tree — you can’t see it!  ·  Sit <<4>> the TV, please (vor).', {
        1: ['in'], 2: ['next to'], 3: ['behind'], 4: ['in front of'],
      }),
      fb(`${prefix}-g3`, 'to be (am / is / are):', 'I <<1>> at the wildlife park today.  ·  My brother Tom <<2>> 11 and he <<3>> very happy.  ·  The monkeys <<4>> so funny!', {
        1: ['am', "I'm"], 2: ['is', "He's"], 3: ['is', "He's"], 4: ['are', "They're"],
      }),
      mc(`${prefix}-g4`, 'Spot the mistake: „There are a big giraffe in the zoo.“ — correct sentence?', [
        { text: 'There are a big giraffe in the zoo.' },
        { text: 'There is a big giraffe in the zoo.', correct: true },
        { text: 'There are big giraffe in the zoo.' },
      ]),
      mc(`${prefix}-g5`, 'Spot the mistake: „My sister Hannah are in Year 7.“ — correct?', [
        { text: 'My sister Hannah are in Year 7.' },
        { text: 'My sister Hannah is in Year 7.', correct: true },
        { text: 'My sister Hannah am in Year 7.' },
      ]),
      ord(`${prefix}-g6`, 'Unscramble: bringe die Wörter in die richtige Reihenfolge:', ['There', 'is', 'a', 'parrot', 'on', 'the', 'tree.']),
      fb(`${prefix}-g7`, 'Gegenteil (opposite): in front of = <<1>>  ·  on = <<2>>', { 1: ['behind'], 2: ['under'] }),
    ],
    readingTextA: `TEXT A — A Morning at Brightside Wildlife Park (~145 words)

Mia and her brother Tom are at Brightside Wildlife Park today with their little brown dog, Buddy. First, they go on a red train. From the train, there is a big giraffe next to a green house. "Look!" says Tom. "There are four small monkeys behind the big tree, and there are six black-and-white penguins in front of the café!"

Suddenly, Buddy barks: "WOOF! WOOF!" A blue-and-yellow parrot is on Tom's head! Tom laughs, and Mia's red hat falls under a bench. Buddy runs under the bench and brings Mia's red hat back. "What a clever dog!" says the park guide.`,
    readingTextB: `TEXT B — Brightside Wildlife Park, Visitor Poster (~55 words)

Open every day: 10:00 – 17:00  |  Tickets: Adults £14, Children £9. Take the red train at 10:30 or 14:00, see our two lions, and feed the penguins at 11:30! Bring your camera — dogs are welcome, too, but they can't run around near the animals.`,
    readingQuestions: (prefix) => [
      mc(`${prefix}-r1`, 'How much is a ticket for a child?', [{ text: '£9', correct: true }, { text: '£11' }, { text: '£14' }]),
      mc(`${prefix}-r2`, 'What colour is the park train?', [{ text: 'green' }, { text: 'blue' }, { text: 'red', correct: true }]),
      mc(`${prefix}-r3`, 'How many monkeys do Mia and Tom see?', [{ text: 'three' }, { text: 'four', correct: true }, { text: 'six' }]),
      mc(`${prefix}-r4`, 'When can visitors feed the penguins?', [{ text: 'at 10:30' }, { text: 'at 11:30', correct: true }, { text: 'at 14:00' }]),
      tf(`${prefix}-r5`, 'Dogs can run around everywhere in the park.', false),
      tf(`${prefix}-r6`, 'There is a big giraffe next to a green house.', true),
      tf(`${prefix}-r7`, 'The penguins are behind the café.', false),
      tf(`${prefix}-r8`, "Mia's hat is yellow.", false),
      sa(`${prefix}-r9`, 'Where are the four monkeys?', ['behind the big tree', 'behind the tree']),
      sa(`${prefix}-r10`, 'Where is the blue-and-yellow parrot?', ["on Tom's head", 'on Tom’s head']),
      sa(`${prefix}-r11`, 'Erwachsene auf Englisch (Text B)?', ['adults']),
      sa(`${prefix}-r12`, 'Reiseführer/in auf Englisch (Text A)?', ['guide', 'the park guide', 'park guide']),
    ],
    listenScript: `VORLESETEXT (die Lehrkraft liest vor):

Mia and her brother Tom are at Brightside Wildlife Park today. They go on a red train.
From the train they see a big giraffe next to a green house.
"There are four small monkeys behind the big tree," says Tom.
"And there are six penguins in front of the café!"
Suddenly, a blue-and-yellow parrot is on Tom's head. Mia's red hat falls under a bench.
Their dog Buddy runs under the bench and brings the red hat back. "What a clever dog!"`,
    listenQuestions: (prefix) => [
      mc(`${prefix}-h1`, 'Where are Mia and Tom today?', [{ text: 'at school' }, { text: 'at the wildlife park', correct: true }, { text: 'at home' }]),
      mc(`${prefix}-h2`, 'What colour is the train?', [{ text: 'red', correct: true }, { text: 'green' }, { text: 'blue' }]),
      mc(`${prefix}-h3`, 'How many monkeys are behind the tree?', [{ text: 'four', correct: true }, { text: 'six' }, { text: 'two' }]),
      mc(`${prefix}-h4`, 'Where is the parrot?', [{ text: "on Tom's head", correct: true }, { text: 'on the bench' }, { text: 'in the tree' }]),
      tf(`${prefix}-h5`, "Mia's hat is yellow.", false),
      sa(`${prefix}-h6`, 'What does Buddy bring back?', ["Mia's red hat", 'the red hat', 'Mia’s red hat', 'a red hat']),
    ],
    writing: {
      stem: 'Write about your desk & pencil case — write 6 sentences. Use: there is / there are, in, on, under, next to, behind, in front of.',
      sourceText: 'Sentence starters:\n1. In my pencil case, there is … .\n2. In my pencil case, there are … .\n3. On my desk, there … .\n4. Next to my book, … .\n5. Under my chair, … .\n6. Behind my school bag, … .',
      minWords: 40,
      maxWords: 150,
    },
    exit: (prefix) => [
      fb(`${prefix}-x1`, 'there <<1>> a lion and there <<2>> two giraffes.', { 1: ['is'], 2: ['are'] }),
      fb(`${prefix}-x2`, 'Präpositionen: vor = <<1>>  ·  neben = <<2>>', { 1: ['in front of'], 2: ['next to'] }),
      fb(`${prefix}-x3`, 'Short forms: we are = <<1>>  ·  he is = <<2>>', { 1: ["we're", 'we are'], 2: ["he's", 'he is'] }),
      sa(`${prefix}-x4`, '„_____ is the cat?“ — „It’s under the chair.“', ['Where’s', 'Where is']),
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
    ],
    grammar: (prefix) => [
      fb(`${prefix}-g1`, 'have got / has got (positiv) oder haven’t / hasn’t (negativ):', 'Captain Hook <<1>> a big ship. (+)  ·  I <<2>> a real pirate parrot. (–)  ·  Greybeard <<3>> a strong leg. (–)  ·  Tamara <<4>> blue eyes. (+)', {
        1: ['has got', "'s got", 'has'], 2: ["haven't got", "haven't", 'have not got'], 3: ["hasn't got", "hasn't", 'has not got'], 4: ['has got', "'s got", 'has'],
      }),
      fb(`${prefix}-g2`, 'Unregelmäßige Plural: 1 tooth → 2 <<1>>  ·  1 foot → 2 <<2>>', { 1: ['teeth'], 2: ['feet'] }),
      mc(`${prefix}-g3`, 'Spot the mistake: „Greybeard have got a long black beard.“ — correct?', [
        { text: 'Greybeard have got a long black beard.' },
        { text: 'Greybeard has got a long black beard.', correct: true },
        { text: 'Greybeard having got a long black beard.' },
      ]),
      mc(`${prefix}-g4`, 'Spot the mistake: „The pirate has got two big foots and sharp tooths!“ — correct?', [
        { text: 'The pirate has got two big foots and sharp tooths!' },
        { text: 'The pirate has got two big feet and sharp teeth!', correct: true },
        { text: 'The pirate have got two big feet and sharp teeth!' },
      ]),
      sa(`${prefix}-g5`, 'Short answer: „Has Captain Hook got a silver hook?“ (✓) → „Yes, ______.“', ['he has', 'Captain Hook has', 'he has got']),
      sa(`${prefix}-g6`, 'Short answer: „Have Fred and Frank got big noses?“ (✗) → „No, ______.“', ['they haven’t', 'they have not', 'they haven’t got']),
      ord(`${prefix}-g7`, 'Unscramble: bringe die Wörter in die richtige Reihenfolge:', ['Tamara', "hasn't", 'got', 'a', 'big', 'nose.']),
    ],
    readingTextA: `TEXT A — Captain Scarlet and the Missing Treasure Map (~160 words)

Captain Scarlet is a famous pirate. She is tall and very strong. She has got long red hair, bright green eyes and a pretty smile. On her left shoulder, there is a small green parrot called Kiwi. Scarlet has got a big black ship, a sharp cutlass and a lot of gold treasure — but she hasn't got a wooden leg! Both of her feet are real.

Today Scarlet is tired and a bit angry. Why? Her brother, One-Eyed Jack, has got her treasure map! Jack is short with blonde hair and a grey beard. He has got a silver hook on his right arm and he is scared of cannonballs. "I'll guess where he is!" says Scarlet. "He's in his bed on the small ship!"`,
    readingTextB: `TEXT B — WANTED Poster (spot the 3 mistakes — compare with Text A!)

WANTED: One-Eyed Jack! He is very tall and has got short black hair and a grey beard. He has got a silver hook on his left arm. He loves loud cannonballs! Reward: 100 gold coins — tell Captain Scarlet!`,
    readingQuestions: (prefix) => [
      mc(`${prefix}-r1`, "What colour are Captain Scarlet's eyes?", [{ text: 'blue' }, { text: 'green', correct: true }, { text: 'brown' }]),
      mc(`${prefix}-r2`, 'Where is Kiwi the parrot?', [{ text: 'on her left shoulder', correct: true }, { text: 'on her right arm' }, { text: 'on the ship' }]),
      mc(`${prefix}-r3`, 'Who is One-Eyed Jack?', [{ text: "Scarlet's captain" }, { text: "Scarlet's parrot" }, { text: "Scarlet's brother", correct: true }]),
      mc(`${prefix}-r4`, 'What is Jack scared of?', [{ text: 'pirates' }, { text: 'cannonballs', correct: true }, { text: 'treasure maps' }]),
      tf(`${prefix}-r5`, 'Captain Scarlet has got a wooden leg.', false),
      tf(`${prefix}-r6`, "Scarlet hasn't got a cutlass.", false),
      sa(`${prefix}-r7`, 'Name three things Captain Scarlet has got.', ['ship', 'cutlass', 'treasure', 'parrot', 'gold', 'Kiwi']),
      sa(`${prefix}-r8`, 'Where is One-Eyed Jack hiding?', ['in his bed on the small ship', 'in his bed', 'on the small ship']),
      sa(`${prefix}-r9`, 'berühmt auf Englisch (Text A)?', ['famous']),
      sa(`${prefix}-r10`, 'Piratensäbel auf Englisch (Text A)?', ['cutlass']),
    ],
    listenScript: `VORLESETEXT (die Lehrkraft liest vor):

Captain Scarlet is a famous pirate. She is tall and very strong.
She has got long red hair and bright green eyes.
On her left shoulder there is a small green parrot called Kiwi.
She has got a big black ship, a sharp cutlass and a lot of gold treasure.
But she hasn't got a wooden leg — both of her feet are real.
Today she is tired and a bit angry, because her brother Jack has got her treasure map.
Jack is short, he has got blonde hair, a grey beard and a silver hook on his right arm.
He is scared of cannonballs.`,
    listenQuestions: (prefix) => [
      mc(`${prefix}-h1`, 'What colour are Captain Scarlet’s eyes?', [{ text: 'blue' }, { text: 'green', correct: true }, { text: 'brown' }]),
      mc(`${prefix}-h2`, 'Where is Kiwi the parrot?', [{ text: 'on her left shoulder', correct: true }, { text: 'on her right arm' }, { text: 'on the ship' }]),
      mc(`${prefix}-h3`, 'Has Captain Scarlet got a wooden leg?', [{ text: 'Yes', correct: false }, { text: 'No', correct: true }]),
      tf(`${prefix}-h4`, 'Captain Scarlet has got a sharp cutlass.', true),
      sa(`${prefix}-h5`, "What is Jack scared of?", ['cannonballs']),
      sa(`${prefix}-h6`, 'What colour is Scarlet’s hair?', ['red', 'long red']),
    ],
    writing: {
      stem: 'Write about Captain Blackbeard — about 50 words, 6 sentences. Use: is / has got / hasn’t got.',
      sourceText: 'Mind map:  Blackbeard  |  IS: tall, strong, famous  |  HAS GOT: black beard, brown eyes, big ship, treasure  |  HASN’T GOT: wooden leg, parrot\n\nSentence starters:\n1. This is Captain Blackbeard. He … .\n2. He has got … .\n3. He is … .\n4. He has also got … .\n5. He hasn’t got … .\n6. I think Blackbeard … .',
      minWords: 40,
      maxWords: 120,
    },
    exit: (prefix) => [
      fb(`${prefix}-x1`, 'Plural: 1 tooth → 4 <<1>>  ·  1 foot → 2 <<2>>', { 1: ['teeth'], 2: ['feet'] }),
      sa(`${prefix}-x2`, 'Lücke: Tamara ______ (have got ✓) green eyes.', ['has got', "'s got", 'has']),
      sa(`${prefix}-x3`, 'Short answer: „Has Hook got a ship?“ → „Yes, ______.“', ['he has', 'he has got', 'Hook has']),
      sa(`${prefix}-x4`, 'Vorschlag: „I’m bored.“ — „Let’s __________ shopping!“', ['go']),
    ],
  },
];

// ---------------------------------------------------------------------------
// Course builder
// ---------------------------------------------------------------------------

/**
 * Build the six activities of one MORE1 unit course.
 * @param {1|2|3} unitNumber
 * @returns {{courseTitle: string, unit: number, activities: object[]}} validated definitions
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
    def(`${courseTitle}: Lesen`, 'Lies die Texte und beantworte die Fragen.', [
      textBlock(`${p}-textA`, 'Text A:', unit.readingTextA),
      textBlock(`${p}-textB`, 'Text B:', unit.readingTextB),
      ...unit.readingQuestions(p),
    ]),
    def(`${courseTitle}: Hören`, 'Hörübung: Die Lehrkraft liest den Text vor (Vorlesetext unten). Beantworte dann die Fragen.', [
      textBlock(`${p}-listen`, 'Vorlesetext (die Lehrkraft liest vor):', unit.listenScript),
      ...unit.listenQuestions(p),
    ]),
    def(`${courseTitle}: Schreiben`, 'Schreibaufgabe mit KI-Zwischenfeedback — hol dir vor dem Abgeben Feedback!', [
      writingTask(`${p}-write`, unit.writing.stem, unit.writing.sourceText, unit.writing.minWords, unit.writing.maxWords, 5),
    ], 'worksheet'),
    def(`${courseTitle}: Exit-Check`, 'Test dich selbst — schaffst du alles richtig?', unit.exit(p), 'quiz'),
  ];

  for (const activity of activities) {
    const check = validateActivity(activity);
    if (!check.ok) {
      throw new Error(`MORE1 unit ${unit.unit} activity "${activity.title}" is invalid: ${check.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
    }
  }
  return { courseTitle, unit: unit.unit, activities };
}

/** All three unit courses (Unit 1–3). */
export function buildMore1Courses() {
  return UNITS.map((unit) => buildUnitCourse(unit.unit));
}

export { UNITS as MORE1_UNITS };
