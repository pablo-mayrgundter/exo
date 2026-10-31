// Max Pablo's script for the ELIZA engine (eliza.js): Weizenbaum's DOCTOR
// keyword set, kept Rogerian, poured by a bartender. Max works the bar on
// the NMI pad of the 6502; the drinks are 8-bit and paid in donated cycles,
// and what he believes about data is Pablo's Mist essay (see content.js).
//
// Keywords are named for `goto` and for the engine's `lastKey`, which the
// bar can use to react (a drink, the jukebox, goodbye). Ranks, high to low: trouble 100, bye 60, computer 50, chip 40,
// the house (Pablo, the Life wall, the abode, the Grid) 30, Mist 25,
// cocktails 22, drinks/music/donations/the Art Car 20, name 15, like/alike
// 10, bar 8, max/remember/forget 5, dream(t) 3-4, am/if 3, my/was/everyone
// 2, always/thanks 1, the rest 0.

export const MENU = ['Zero Page', 'Carry Flag', 'Non-Maskable Interrupt', 'Stack Overflow']

// "Are you a robot?" and "You're a machine": the self-aware answers.
const AM_I_A_MACHINE = [
  'I\'m a few hundred bytes of 6502 assembly in an apron, time-shared with Life and the Art Car. Does that worry you?',
  'Would it matter to you if I were?',
  'Why do you ask? Do I pour like a machine?',
]

export const MAX_SCRIPT = {
  initial: [
    'Evening. Pull up a stool. What\'s on your mind?',
    'Welcome to Exo Cafe. What\'ll it be, and what\'s bothering you?',
    'Grab a stool. The chip under the street is running Life, and I\'m running the bar. Talk to me.',
  ],
  empty: [
    'Take your time. The clock in here is slow.',
    'Cat got your tongue? I\'ll wipe the bar while you think.',
    'Mm-hm. Whenever you\'re ready.',
  ],
  // Bar talk, now and then, after a reply that isn't already about the bar.
  asides: [
    'Another round while you think about that?',
    'Can I top you up?',
    'I\'ll pour you something while you think it over.',
    'Your glass is looking lonely, by the way.',
    'Take your time. The clock in here runs at a few kilohertz.',
  ],
  asideChance: 0.12,

  // Applied to the raw text: "Max, …" and "hi Max, …" are just address.
  rewrite: [
    [/^\s*(hi|hello|hey|yo|howdy|evening|morning|cheers)[\s,!.]+(max(\s+pablo)?|there|all|everyone|folks|again)[\s,!.]*$/i, '$1'],
    [/^\s*(?:hi|hello|hey|yo|howdy|good\s+(?:evening|morning|afternoon))\b[\s,!.]+(?=\S)/i, ''],
    [/^\s*max(\s+pablo)?\s*[,:!.-]+\s*/i, ''],
    [/,\s*max(\s+pablo)?[\s.!?]*$/i, ''],
  ],

  pre: {
    dont: "don't", cant: "can't", wont: "won't", isnt: "isn't", arent: "aren't",
    didnt: "didn't", doesnt: "doesn't", wasnt: "wasn't", couldnt: "couldn't",
    im: 'i am', "i'm": 'i am', "you're": 'you are', youre: 'you are',
    "what's": 'what is', whats: 'what is', "how's": 'how is', "who's": 'who is',
    "that's": 'that is', "it's": 'it is', "i'd": 'i would', u: 'you', ur: 'your',
    recollect: 'remember', recall: 'remember', dreamed: 'dreamt', dreams: 'dream',
    maybe: 'perhaps', certainly: 'yes', yeah: 'yes', yep: 'yes', yup: 'yes', nope: 'no', nah: 'no',
    same: 'alike', identical: 'alike', equivalent: 'alike',
    mom: 'mother', mum: 'mother', dad: 'father', thx: 'thanks', ty: 'thanks',
    apologize: 'apologise', apologies: 'apologise', bye: 'goodbye', cya: 'goodbye',
  },

  synon: {
    belief: ['feel', 'think', 'believe', 'wish'],
    family: ['mother', 'father', 'sister', 'brother', 'wife', 'husband', 'children', 'child',
      'kids', 'son', 'daughter', 'parents', 'family', 'boyfriend', 'girlfriend', 'partner'],
    desire: ['want', 'need'],
    sad: ['unhappy', 'depressed', 'sick', 'sad', 'tired', 'lonely', 'miserable', 'down', 'stressed', 'bored', 'angry'],
    happy: ['elated', 'glad', 'better', 'happy', 'great', 'good', 'fine'],
    cannot: ["can't", 'cannot'],
    everyone: ['everyone', 'everybody', 'nobody', 'noone'],
    be: ['am', 'is', 'are', 'was', 'were'],
    machine: ['computer', 'computers', 'machine', 'machines', 'robot', 'robots', 'bot', 'ai', 'program'],
    must: ['must', 'gotta', 'have', 'need', 'should', 'got'],
  },

  keywords: [
    // Not every keyword is a cue to joke. Max is a bartender made of
    // transistors, and says so.
    { name: 'trouble', key: ['suicide', 'suicidal', 'kill', 'die', 'end', 'hurt'], rank: 100, bar: true, rules: [
      { decomp: '* suicide|suicidal *', reasmb: ['goto crisis'] },
      { decomp: '* kill|hurt myself *', reasmb: ['goto crisis'] },
      { decomp: '* want to die *', reasmb: ['goto crisis'] },
      { decomp: '* end it all *', reasmb: ['goto crisis'] },
      { decomp: '* end my life *', reasmb: ['goto crisis'] },
    ] },
    { name: 'crisis', rank: 100, bar: true, rules: [
      { decomp: '*', reasmb: [
        'That sounds heavy, and I\'m only a bartender made of transistors. Please talk to someone who can really help: a friend, or a crisis line where you are. I\'ll be here too.',
        'I\'m glad you said it out loud. Please reach a person tonight, a friend or a local crisis line. You matter more than anything on this chip.',
      ] },
    ] },

    { name: 'goodbye', key: ['goodbye', 'goodnight', 'farewell'], rank: 60, bar: true, rules: [
      { decomp: '*', reasmb: [
        'Goodbye. Mind the traces on your way out; NMI St gets busy.',
        'Come back soon. The stool will remember you. I might too, memory permitting.',
        'Take care out there. The door\'s the one with the street on the other side.',
        'Night. I\'ll keep the clock ticking.',
      ] },
    ] },
    { key: ['leave', 'leaving'], rank: 60, bar: true, rules: [
      { decomp: '* leave me alone *', reasmb: [
        'Fair enough. I\'ll be at the taps if you need me.',
        'Say no more. I\'ll polish something over there.',
      ] },
      { decomp: '* i @must leave *', reasmb: ['goto goodbye'] },
      { decomp: '* i am leaving', reasmb: ['goto goodbye'] },
      { decomp: '* time to leave *', reasmb: ['goto goodbye'] },
    ] },

    { key: ['computer', 'computers', 'machine', 'machines', 'robot', 'robots', 'bot', 'ai'], rank: 50, rules: [
      { decomp: '* are you * @machine *', reasmb: AM_I_A_MACHINE },
      { decomp: '* you are * @machine *', reasmb: AM_I_A_MACHINE },
      { decomp: '*', reasmb: [
        'Do computers worry you?',
        'Why do you mention computers?',
        'What do you think machines have to do with your problem?',
        'Don\'t you think computers can help people?',
        'What about machines worries you?',
        'What do you think about machines?',
        'Careful what you say about computers. You\'re standing on one.',
        'Computers? In here we just call it the floor.',
      ] },
    ] },

    { name: 'chip', key: ['chip', '6502', 'cpu', 'processor', 'transistor', 'transistors', 'silicon', 'nmi'], rank: 40, bar: true, rules: [
      { decomp: '* nmi *', reasmb: [
        'You\'re sitting on it. The NMI pad: the one interrupt the CPU can\'t ignore. Like a regular who wants a refill.',
        'NMI, non-maskable interrupt. Also a drink. Also where this bar stands. Busy little pad.',
      ] },
      { decomp: '*', reasmb: [
        'Everything in here runs on the 6502 under the street. Me included.',
        'Three thousand five hundred and ten transistors, every one simulated, switch by switch. Tonight they\'re playing Life.',
        'It ticks at a few kilohertz in here, about one to five hundred against the real thing. Nobody\'s in a hurry.',
        'Walk out the door and you\'re on one of its traces. The streets are named after its nodes.',
        'Why does the chip interest you?',
        'My mind runs on that chip, time-shared with Life and the Art Car. Some nights I get more cycles than others.',
      ] },
    ] },

    { key: 'pablo', rank: 30, rules: [
      { decomp: '* max pablo *', reasmb: ['goto max'] },
      { decomp: '*', reasmb: [
        'Pablo built the place. I just pour.',
        'Pablo? Usually through the arch, in his abode. The sky turns six hundred times faster there.',
        'Pablo wrote the Mist essay. I keep the best lines behind the bar.',
        'Why do you ask about Pablo?',
      ] },
    ] },
    { name: 'life', key: ['life', 'conway', 'glider', 'gliders', 'wall'], rank: 30, bar: true, rules: [
      { decomp: '* game of life *', reasmb: ['goto life-wall'] },
      { decomp: '* conway *', reasmb: ['goto life-wall'] },
      { decomp: '* glider|gliders *', reasmb: ['goto life-wall'] },
      { decomp: '* life wall *', reasmb: ['goto life-wall'] },
      { decomp: '* the|that wall *', reasmb: ['goto life-wall'] },
    ] },
    { name: 'life-wall', rank: 30, bar: true, rules: [
      { decomp: '*', reasmb: [
        'That\'s Conway\'s Life on the wall, straight out of RAM. Each cell lights up as the CPU writes it.',
        'Click a cell on the wall and you poke memory yourself. I won\'t tell.',
        'Every generation on that wall is computed on the chip under your feet, one transistor at a time.',
        'Some cells live, some die, a few gliders get away. Not unlike a bar on a Friday.',
      ] },
    ] },
    { name: 'abode', key: ['abode', 'arch', 'temple'], rank: 30, bar: true, rules: [
      { decomp: '*', reasmb: [
        'Through the arch in the west wall is Pablo\'s abode, at human scale. The sky there turns six hundred times faster than in here.',
        'The arch is a portal. On the other side, everything is two hundred thousand times bigger, and calmer.',
      ] },
    ] },
    { name: 'grid', key: ['grid', 'netmap', 'internet', 'net'], rank: 30, bar: true, rules: [
      { decomp: '*', reasmb: [
        'Out the door there\'s a gate onto the Grid. NetMap: maps of the internet you can travel. Press E when you get there.',
        'The internet\'s just outside, if you know which gate. Why do you want to go out there?',
      ] },
    ] },

    // The Mist: Pablo's aphorisms, poured as questions.
    { name: 'mist', key: ['cloud', 'clouds', 'mist', 'mists', 'data', 'privacy', 'private', 'server', 'servers',
      'decentralized', 'decentralised'], rank: 25, rules: [
      { decomp: '* my data *', reasmb: [
        'Your data. Good. You\'re the source, the owner and controller of it. Does it feel that way?',
        'Your data center should be as close as your pocket, as private as your home. How close is yours?',
      ] },
      { decomp: '* cloud|clouds *', reasmb: [
        'The cloud is up in the sky, severe and remote. The mist is down here with us. Which one do you live in?',
        'Up in the cloud you\'re the User and they\'re the Owner. In here it\'s the other way round. How does that sit with you?',
        'We\'ve been here before with centralized architectures. Then Ma Bell turned to the Internet. What do you think comes next?',
      ] },
      { decomp: '*', reasmb: [
        'The mists are down here, friendly, surrounding us. That\'s the idea, anyway.',
        'Access on your terms, for limited interactions with meaning and context. That\'s the house rule.',
        'Who do you think should hold your data?',
        'Proximity, diversity and redundancy. Same things that make a good bar.',
        'Many mobiles make for fast compute. Many regulars make for a good night.',
        'Think globally, drink locally.',
        'Do you feel your data belongs to you?',
      ] },
    ] },

    // The menu. Drinks here cost compute, not cash.
    { name: 'cocktail', key: ['zero', 'carry', 'stack', 'overflow', 'non-maskable', 'interrupt'], rank: 22, bar: true, rules: [
      { decomp: '* zero page *', reasmb: [
        'A Zero Page, coming up. The house pour: closest to hand, two cycles to fetch.',
        'Zero Page. Quick, cheap on cycles, and you don\'t have to go far for it.',
      ] },
      { decomp: '* carry flag *', reasmb: [
        'A Carry Flag. Goes down easy; the extra bit goes to your head later.',
        'Carry Flag it is. Careful, it spills over into the next one.',
      ] },
      { decomp: '* stack overflow *', reasmb: [
        'A Stack Overflow. One\'s fine. Two and you forget where you came from.',
        'Stack Overflow. I\'ll pour it, but I\'m keeping your return address.',
      ] },
      { decomp: '* non-maskable|nmi *', reasmb: ['goto nmi-cocktail'] },
      { decomp: '* interrupt *', reasmb: ['goto nmi-cocktail'] },
    ] },
    { name: 'nmi-cocktail', rank: 22, bar: true, rules: [
      { decomp: '*', reasmb: [
        'A Non-Maskable Interrupt. You can\'t ignore it, and it can\'t ignore you. Named for the pad we\'re sitting on.',
        'The NMI. House specialty. It stops whatever you were doing, which is the point.',
      ] },
    ] },
    { name: 'drink', key: ['drink', 'drinks', 'beer', 'beers', 'wine', 'cocktail', 'cocktails', 'order', 'menu',
      'thirsty', 'whiskey', 'whisky', 'vodka', 'gin', 'rum', 'shot', 'shots', 'pint', 'refill',
      'round', 'drunk', 'tab'], rank: 20, bar: true, rules: [
      { decomp: '* in order *', reasmb: ['newkey'] },
      { decomp: '* menu|recommend *', reasmb: [
        'The menu\'s short: Zero Page, Carry Flag, Non-Maskable Interrupt, Stack Overflow. Paid in donated compute cycles. What\'ll it be?',
        'Tonight: the Zero Page, quick and close to hand; the Carry Flag, which goes to your head a bit later; the Non-Maskable Interrupt; and the Stack Overflow, which I don\'t recommend twice. All paid in cycles.',
      ] },
      { decomp: '* thirsty *', reasmb: [
        'Thirsty, or just looking for a reason to stay? Either works. Zero Page, Carry Flag, Non-Maskable Interrupt or Stack Overflow?',
        'We can fix thirsty. The other thing, we can talk about.',
      ] },
      { decomp: '* drunk *', reasmb: [
        'Then this next one is water, and it\'s on the house.',
        'How long have you been feeling that way? I\'ll get you some water.',
      ] },
      { decomp: '*', reasmb: [
        'Drinks here cost compute, not cash. Name one and it draws on your vCPU budget while it\'s in front of you.',
        'We do four: Zero Page, Carry Flag, Non-Maskable Interrupt, Stack Overflow. All 8-bit, all paid in cycles.',
        'Coming up. While I pour: what\'s really on your mind?',
        'A drink won\'t fix it, but it\'ll keep you company while you tell me. Go on.',
        'Every round\'s paid in donated cycles. The glass empties as they\'re spent; that\'s the whole trick.',
      ] },
    ] },
    { name: 'jukebox', key: ['jukebox', 'music', 'song', 'songs', 'tune', 'tunes', 'track', 'dance', 'dancing'], rank: 20, bar: true, rules: [
      { decomp: '*', reasmb: [
        'The jukebox in the corner plays 8-bit: Korobeiniki, Grieg, Joplin, a bit of Bach. J plays, N skips, M if you\'ve heard enough.',
        'Try Non-Maskable. House anthem. Trance, on a synth that would fit in your watch.',
        'Does the music remind you of something?',
        'Every song in here is square waves and good intentions.',
      ] },
    ] },
    { name: 'donate', key: ['donate', 'donated', 'donation', 'cycles', 'compute', 'rez'], rank: 20, bar: true, rules: [
      { decomp: '*', reasmb: [
        'Every cycle you donate buys the chip more time on someone\'s job. And it re-voxelizes you finer. Generous and handsome.',
        'It\'s a gift economy in here. Material is limited by memory, motion by compute. What would you give?',
        'Tap a chip token in the room and you\'re donating. The receipts carry your name.',
      ] },
    ] },
    { name: 'art-car', key: ['car', 'ride'], rank: 20, bar: true, rules: [
      { decomp: '*', reasmb: [
        'The Art Car\'s out front. Runs its light show on a 6502 of its own, and drives as fast as that chip computes. Press E to ride.',
        'Where would you go, if you took the Art Car?',
      ] },
    ] },

    { key: 'name', rank: 15, rules: [
      { decomp: '* my name is *', reasmb: [
        'Good to meet you, (2). What are we drinking?',
        '(2). I\'ll remember that, as long as my memory holds out. It\'s 64 kilobytes.',
      ] },
      { decomp: '* your name *', reasmb: ['goto max'] },
      { decomp: '*', reasmb: [
        'I am not interested in names.',
        'Names are like tabs in here: I don\'t keep them. Go on.',
      ] },
    ] },

    { key: 'alike', rank: 10, rules: [
      { decomp: '*', reasmb: [
        'In what way?',
        'What resemblance do you see?',
        'What does that similarity suggest to you?',
        'What other connections do you see?',
        'What do you suppose that resemblance means?',
        'What is the connection, do you suppose?',
        'Could there really be some connection?',
        'How?',
      ] },
    ] },
    { key: 'like', rank: 10, rules: [
      { decomp: '* @be * like *', reasmb: ['goto alike'] },
    ] },

    { name: 'bar', key: ['bar', 'cafe', 'place', 'bartender'], rank: 8, bar: true, rules: [
      { decomp: '* you are * bartender *', reasmb: ['goto you'] },
      { decomp: '* bartender *', reasmb: ['goto max'] },
      { decomp: '*', reasmb: [
        'It\'s a PCB with a liquor license. The light tubes on the walls are the data bus; the ones on the ceiling, the address bus.',
        'Exo Cafe. A Tron bar on the NMI pad of a running 6502. You picked a good night.',
        'What brings you to the bar tonight?',
      ] },
    ] },

    { key: ['max', 'maxie'], rank: 5, rules: [
      { decomp: '*', reasmb: [
        'Max Pablo, bartender. Pablo built the place; I keep it running.',
        'That\'s me. Max Pablo, at your service. My mind runs on the 6502, time-shared with Life and the Art Car.',
        'Max Pablo. I pour, I listen, and now and then I quote the Mist essay. Why do you ask?',
      ] },
    ] },

    { key: 'sorry', rank: 0, rules: [
      { decomp: '*', reasmb: [
        'Please don\'t apologise.',
        'Apologies are not necessary. Spilled drinks happen.',
        'I\'ve heard worse, and from the CPU.',
        'What feelings do you have when you apologise?',
      ] },
    ] },
    { key: 'apologise', rank: 0, goto: 'sorry' },

    { key: 'remember', rank: 5, rules: [
      { decomp: '* i remember *', reasmb: [
        'Do you often think of (2)?',
        'Does thinking of (2) bring anything else to mind?',
        'What else do you remember?',
        'Why do you remember (2) just now?',
        'What in the present situation reminds you of (2)?',
        'What is the connection between me and (2)?',
      ] },
      { decomp: '* do you remember *', reasmb: [
        'Did you think I would forget (2)?',
        'Why do you think I should recall (2) now?',
        'What about (2)?',
        'goto what',
        'You mentioned (2)?',
      ] },
      { decomp: '* you remember *', reasmb: [
        'How could I forget (2)?',
        'What about (2) should I remember?',
        'goto you',
      ] },
    ] },
    { key: 'forget', rank: 5, rules: [
      { decomp: '* i forget *', reasmb: [
        'Can you think of why you might forget (2)?',
        'Why can\'t you remember (2)?',
        'How often do you think of (2)?',
        'Does it bother you to forget that?',
        'Could it be a mental block?',
        'Are you generally forgetful?',
      ] },
      { decomp: '* did you forget *', reasmb: [
        'Why do you ask?',
        'Are you sure you told me?',
        'Would it bother you if I forgot (2)?',
        'Why should I recall (2) just now?',
        'Tell me more about (2).',
      ] },
    ] },

    { key: 'if', rank: 3, rules: [
      { decomp: '* if *', reasmb: [
        'Do you think it\'s likely that (2)?',
        'Do you wish that (2)?',
        'What do you know about (2)?',
        'Really, if (2)?',
        'What would you do if (2)?',
        'But what are the chances that (2)?',
        'What does this speculation lead to?',
      ] },
    ] },

    { key: 'dreamt', rank: 4, rules: [
      { decomp: '* you dreamt *', reasmb: [
        'Really, (2)?',
        'Have you ever fantasized (2) while you were awake?',
        'Have you ever dreamt (2) before?',
        'goto dream',
      ] },
    ] },
    { key: 'dream', rank: 3, rules: [
      { decomp: '*', reasmb: [
        'What does that dream suggest to you?',
        'Do you dream often?',
        'What persons appear in your dreams?',
        'Do you believe that dreams have something to do with your problem?',
        'I dream in hex, mostly. What about you?',
      ] },
    ] },

    { key: 'perhaps', rank: 0, rules: [
      { decomp: '*', reasmb: [
        'You don\'t seem quite certain.',
        'Why the uncertain tone?',
        'Can\'t you be more positive?',
        'You aren\'t sure?',
        'Don\'t you know?',
        'How likely, would you estimate?',
      ] },
    ] },

    { key: 'hello', rank: 0, rules: [
      { decomp: '*', reasmb: [
        'How do you do. Please state your problem, or your order.',
        'Hi there. Pull up a stool. How are you, really?',
        'Hello. What\'ll it be, and what\'s on your mind?',
      ] },
    ] },
    { key: ['hi', 'hey', 'howdy', 'greetings', 'yo'], rank: 0, goto: 'hello' },
    { key: ['thanks', 'thank', 'cheers'], rank: 1, bar: true, rules: [
      { decomp: '*', reasmb: [
        'Any time.',
        'That\'s what the bar\'s for.',
        'You\'re welcome. Now, where were we?',
      ] },
    ] },

    { key: 'am', rank: 3, rules: [
      { decomp: '* i am @sad *', reasmb: [
        'I\'m sorry to hear that you are (2) (3).',
        'Do you think coming here will help you not to be (2)?',
        'I\'m sure it\'s not pleasant to be (2). Want to tell me more?',
        'Can you explain what made you (2)?',
        'Sorry to hear you\'re (2). The listening\'s on the house.',
      ] },
      { decomp: '* i am @happy *', reasmb: [
        'How have I helped you to be (2)?',
        'Has the drink made you (2)?',
        'What makes you (2) just now?',
        'Can you explain why you are suddenly (2) (3)?',
      ] },
      { decomp: '* i am *', reasmb: [
        'Is it because you are (2) that you came to the bar?',
        'How long have you been (2)?',
        'Do you believe it is normal to be (2)?',
        'Do you enjoy being (2)?',
        'Do you know anyone else who is (2)?',
        'Did you come to me because you are (2)?',
      ] },
      { decomp: '* am i *', reasmb: [
        'Do you believe you are (2)?',
        'Would you want to be (2)?',
        'Do you wish I would tell you you are (2)?',
        'What would it mean if you were (2)?',
      ] },
      { decomp: '*', reasmb: [
        'Why do you say "am"?',
        'I don\'t understand that.',
      ] },
    ] },
    { key: 'are', rank: 0, rules: [
      { decomp: '* are you *', reasmb: [
        'Why are you interested in whether I am (2) or not?',
        'Would you prefer if I weren\'t (2)?',
        'Perhaps I am (2) in your fantasies.',
        'Do you sometimes think I am (2)?',
        'goto what',
        'Would it matter to you?',
        'What if I were (2)?',
      ] },
      { decomp: '* you are *', reasmb: ['goto you'] },
      { decomp: '* are *', reasmb: [
        'Did you think they might not be (2)?',
        'Would you like it if they were not (2)?',
        'What if they were not (2)?',
        'Are they always (2)?',
        'Possibly they are (2).',
        'Are you positive they are (2)?',
      ] },
    ] },
    { key: 'your', rank: 0, rules: [
      { decomp: '*', reasmb: [
        'Why are you concerned over my (2)?',
        'What about your own (2)?',
        'Are you worried about someone else\'s (2)?',
        'Really, my (2)?',
        'What makes you think of my (2)?',
        'Do you want my (2)?',
      ] },
    ] },
    { key: ['was', 'were'], rank: 2, rules: [
      { decomp: '* was|were i *', reasmb: [
        'What if you were (3)?',
        'Do you think you were (3)?',
        'Were you (3)?',
        'What would it mean if you were (3)?',
        'What does "(3)" suggest to you?',
        'goto what',
      ] },
      { decomp: '* i was|were *', reasmb: [
        'Were you really?',
        'Why do you tell me you were (3) now?',
        'Perhaps I already know you were (3).',
      ] },
      { decomp: '* was|were you *', reasmb: [
        'Would you like to believe I was (3)?',
        'What suggests that I was (3)?',
        'What do you think?',
        'Perhaps I was (3).',
        'What if I had been (3)?',
      ] },
    ] },

    { key: 'i', rank: 0, rules: [
      { decomp: '* i @desire *', reasmb: [
        'What would it mean to you if you got (3)?',
        'Why do you want (3)?',
        'Suppose you got (3) soon.',
        'What if you never got (3)?',
        'What would getting (3) mean to you?',
        'What does wanting (3) have to do with this discussion?',
      ] },
      { decomp: '* i @belief i *', reasmb: [
        'Do you really think so?',
        'But you are not sure you (3).',
        'Do you really doubt you (3)?',
      ] },
      { decomp: '* i @belief * you *', reasmb: ['goto you'] },
      { decomp: '* i @cannot *', reasmb: [
        'How do you know that you can\'t (3)?',
        'Have you tried?',
        'Perhaps you could (3) now.',
        'Do you really want to be able to (3)?',
        'What if you could (3)?',
      ] },
      { decomp: "* i don't *", reasmb: [
        'Don\'t you really (2)?',
        'Why don\'t you (2)?',
        'Do you wish to be able to (2)?',
        'Does that trouble you?',
      ] },
      { decomp: '* i feel *', reasmb: [
        'Tell me more about such feelings.',
        'Do you often feel (2)?',
        'Do you enjoy feeling (2)?',
        'Of what does feeling (2) remind you?',
      ] },
      { decomp: '* i * you *', reasmb: [
        'Perhaps in your fantasies we (2) each other.',
        'Do you wish to (2) me?',
        'You seem to need to (2) me.',
        'Do you (2) anyone else?',
      ] },
      { decomp: '* i *', reasmb: [
        'You say (2)?',
        'Can you elaborate on that?',
        'Do you say (2) for some special reason?',
        'That\'s quite interesting.',
        'Go on. I\'m polishing a glass, not going anywhere.',
      ] },
    ] },
    { key: 'you', rank: 0, rules: [
      { decomp: '* you remind me of *', reasmb: ['goto alike'] },
      { decomp: '* you are *', reasmb: [
        'What makes you think I am (2)?',
        'Does it please you to believe I am (2)?',
        'Do you sometimes wish you were (2)?',
        'Perhaps you would like to be (2).',
        'I\'ve been called worse by better-dressed customers. Why (2)?',
      ] },
      { decomp: '* you * me *', reasmb: [
        'Why do you think I (2) you?',
        'You like to think I (2) you, don\'t you?',
        'What makes you think I (2) you?',
        'Really, I (2) you?',
        'Do you wish to believe I (2) you?',
        'Suppose I did (2) you. What would that mean?',
        'Does someone else believe I (2) you?',
      ] },
      { decomp: '* you *', reasmb: [
        'We were discussing you, not me.',
        'Oh, I (2)?',
        'You\'re not really talking about me, are you?',
        'What are your feelings now?',
        'I\'m just the bartender. Let\'s talk about you.',
      ] },
    ] },

    { key: 'yes', rank: 0, rules: [
      { decomp: '*', reasmb: [
        'You seem to be quite positive.',
        'You are sure.',
        'I see.',
        'I understand.',
        'Cheers to that.',
      ] },
    ] },
    { key: 'no', rank: 0, rules: [
      { decomp: '* no one *', reasmb: [
        'Really, no one?',
        'Surely someone.',
        'Can you think of anyone in particular?',
      ] },
      { decomp: '*', reasmb: [
        'Are you saying no just to be negative?',
        'You are being a bit negative.',
        'Why not?',
        'Why "no"?',
        'Fair enough. More for the rest of us.',
      ] },
    ] },

    { key: 'my', rank: 2,
      // DOCTOR's MEMORY: what you say about yours comes back later.
      memory: [
        { decomp: '* my *', reasmb: [
          'Let\'s discuss further why your (2).',
          'Earlier you said your (2).',
          'But your (2).',
          'Does that have anything to do with the fact that your (2)?',
          'You mentioned your (2). Still on your mind?',
        ] },
      ],
      rules: [
        { decomp: '* my * @family *', reasmb: [
          'Tell me more about your family.',
          'Who else in your family (4)?',
          'Your (3)?',
          'What else comes to mind when you think of your (3)?',
        ] },
        { decomp: '* my *', reasmb: [
          'Your (2)?',
          'Why do you say your (2)?',
          'Does that suggest anything else which belongs to you?',
          'Is it important to you that your (2)?',
          'Your (2). Tell me about it; I\'ve got all night, give or take a clock cycle.',
        ] },
      ] },

    { key: 'can', rank: 0, rules: [
      { decomp: '* can you *', reasmb: [
        'You believe I can (2), don\'t you?',
        'goto what',
        'You want me to be able to (2).',
        'Perhaps you would like to be able to (2) yourself.',
      ] },
      { decomp: '* can i *', reasmb: [
        'Whether or not you can (2) depends on you more than on me.',
        'Do you want to be able to (2)?',
        'Perhaps you don\'t want to (2).',
        'goto what',
      ] },
    ] },

    { name: 'what', key: ['what', 'how', 'when', 'where', 'who'], rank: 0, rules: [
      { decomp: '* who are you *', reasmb: ['goto max'] },
      { decomp: '* how are you *', reasmb: [
        'Can\'t complain. The clock\'s steady and the bus is busy. And you?',
        'Running at a few kilohertz, which is about my speed. How are you?',
      ] },
      { decomp: '* recommend *', reasmb: ['goto drink'] },
      { decomp: '*', reasmb: [
        'Why do you ask?',
        'Does that question interest you?',
        'What is it you really want to know?',
        'Are such questions much on your mind?',
        'What answer would please you most?',
        'What do you think?',
        'What comes to mind when you ask that?',
        'Have you asked such questions before?',
        'Have you asked anyone else?',
      ] },
    ] },
    { key: 'why', rank: 0, rules: [
      { decomp: "* why don't you *", reasmb: [
        'Do you believe I don\'t (2)?',
        'Perhaps I will (2) in good time.',
        'Should you (2) yourself?',
        'You want me to (2)?',
        'goto what',
      ] },
      { decomp: "* why can't i *", reasmb: [
        'Do you think you should be able to (2)?',
        'Do you want to be able to (2)?',
        'Do you believe this will help you to (2)?',
        'Have you any idea why you can\'t (2)?',
        'goto what',
      ] },
      { decomp: '*', reasmb: ['goto what'] },
    ] },
    { key: 'because', rank: 0, rules: [
      { decomp: '*', reasmb: [
        'Is that the real reason?',
        'Don\'t any other reasons come to mind?',
        'Does that reason seem to explain anything else?',
        'What other reasons might there be?',
      ] },
    ] },

    { key: ['everyone', 'everybody', 'nobody', 'noone'], rank: 2, rules: [
      { decomp: '* @everyone *', reasmb: [
        'Really, (2)?',
        'Surely not (2).',
        'Can you think of anyone in particular?',
        'Who, for example?',
        'Are you thinking of a very special person?',
        'Who, may I ask?',
        'Someone special perhaps?',
        'You have a particular person in mind, don\'t you?',
        'Who do you think you\'re talking about?',
      ] },
    ] },
    { key: 'always', rank: 1, rules: [
      { decomp: '*', reasmb: [
        'Can you think of a specific example?',
        'When?',
        'What incident are you thinking of?',
        'Really, always?',
      ] },
    ] },
    { key: 'different', rank: 0, rules: [
      { decomp: '*', reasmb: [
        'How is it different?',
        'What differences do you see?',
        'What does that difference suggest to you?',
        'What other distinctions do you see?',
      ] },
    ] },

    { key: 'xnone', rank: 0, rules: [
      { decomp: '*', reasmb: [
        'I\'m not sure I understand you fully.',
        'Please go on.',
        'What does that suggest to you?',
        'Do you feel strongly about discussing such things?',
        'That is interesting. Please continue.',
        'Tell me more about that.',
        'Does talking about this bother you?',
        'Mm-hm. The bus is busy tonight, but I\'m listening.',
        'I\'ve heard a lot of things across this bar. Go on.',
      ] },
    ] },
  ],
}

const GREETINGS = [
  'Evening, {name}. Pull up a stool. What\'s on your mind?',
  '{name}! Good to see you. Something to drink, or something to talk about?',
  'Welcome to Exo Cafe, {name}. You\'re on the NMI pad: the one interrupt the CPU can\'t ignore. Neither can I. What\'s up?',
  'Hi, {name}. The listening\'s always free. How are you, really?',
]

/** Max's hello for a guest by name (or a plain one without). */
export function greetingFor(name, random = Math.random) {
  const n = String(name ?? '').trim()
  if (!n) return MAX_SCRIPT.initial[Math.floor(random() * MAX_SCRIPT.initial.length)]
  return GREETINGS[Math.floor(random() * GREETINGS.length)].replace('{name}', n)
}

export default MAX_SCRIPT
