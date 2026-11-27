export interface CastCharacter {
  id: string;
  name: string;
  renderer: 'Iki' | 'Live2D';
  signatureMove: string;
  image: string;
  imageAlt: string;
  summary: string;
  samples: {
    english: string;
    hindi: string;
    hinglish: string;
  };
}

export interface RoadmapMilestone {
  id: string;
  title: string;
  detail: string;
  status: 'done' | 'in-progress' | 'planned';
  statusLabel: string;
}

export const CAST_CHARACTERS: CastCharacter[] = [
  {
    id: 'makima',
    name: 'Makima',
    renderer: 'Iki',
    signatureMove: 'Finger-gun "bang" · folded-hands stance',
    image: '/media/hikari-cast-makima.webp',
    imageAlt: 'Makima’s current Iki rig with her hands clasped',
    summary:
      'Composed, deliberate, and quietly in control. Cut from layered reference artwork with custom leg-shift body mesh warp and procedural arm springs.',
    samples: {
      english: "You'll finish this today. I've already decided. …Unless you'd like a short break first?",
      hindi: 'शांत रहो। एक-एक करके सब हो जाएगा।',
      hinglish: 'Pehle sabse important kaam. Baaki baad mein. Theek hai na?',
    },
  },
  {
    id: 'reze',
    name: 'Reze',
    renderer: 'Iki',
    signatureMove: 'Offers a white flower · shy wave',
    image: '/media/hikari-cast-reze.webp',
    imageAlt: 'Reze’s current Iki rig offering a white flower',
    summary:
      'Warm café-counter banter with playful mystery. Reaches forward with an offered bloom while lifting her smile across a 70 ms arm exchange.',
    samples: {
      english: "Let's skip the boring part of the day. Tell me something fun instead.",
      hindi: 'बारिश हो रही है… चलो, थोड़ी देर बातें करते हैं।',
      hinglish: 'Aaj ka plan? Hmm… pehle chai, phir dekhte hain kya adventure milta hai.',
    },
  },
  {
    id: 'rize',
    name: 'Rize Kamishiro',
    renderer: 'Iki',
    signatureMove: 'Reads open book · glasses push · ghoul eyes',
    image: '/media/hikari-rize-reading-art.webp',
    imageAlt: 'Rize looking down at a book held in both hands in the current Iki rig',
    summary:
      'Bookish, theatrical, and sharp. Features a separately keyed glasses frame layer and irises that shift to crimson ghoul red mid-conversation.',
    samples: {
      english: 'You read that whole book in one night? How delicious. Tell me your favourite chapter.',
      hindi: 'अच्छी कहानी और अच्छी चाय… और क्या चाहिए?',
      hinglish: 'Hmm, interesting. Tum jitne lagte ho usse zyada mysterious ho.',
    },
  },
  {
    id: 'cheng-xiaoshi',
    name: 'Cheng Xiaoshi',
    renderer: 'Iki',
    signatureMove: 'Claps hands · photo dive',
    image: '/media/hikari-cast-cheng-xiaoshi.webp',
    imageAlt: 'Cheng Xiaoshi’s current Iki rig during his photo dive gesture',
    summary:
      'Energetic photographer from Time Photo Studio. Animated at 1.48× idle tempo with 0.78 spring damping for crisp overshoot on his signature clap.',
    samples: {
      english: 'Wait, you took that shot? Come here, I want to see!',
      hindi: 'चलो, एक तस्वीर और लेते हैं।',
      hinglish: 'Arre, light dekho! Bas ek photo aur.',
    },
  },
  {
    id: 'lu-guang',
    name: 'Lu Guang',
    renderer: 'Iki',
    signatureMove: 'Studies a photograph · blue-eye reveal',
    image: '/media/hikari-cast-lu-guang.webp',
    imageAlt: 'Lu Guang’s current Iki rig looking at a photograph held in his right hand',
    summary: 'Lu Guang studies a photo with a restrained gesture and a blue-eye reveal. The photograph moves with his hand.',
    samples: {
      english: 'Look at the details in the photo. What do you notice first?',
      hindi: 'तस्वीर को ध्यान से देखो। तुम्हें पहले क्या दिखता है?',
      hinglish: 'Photo dhyaan se dekho. Pehle kya nazar aata hai?',
    },
  },
];

export const HOTKEYS = [
  { keys: '⌥ Space', label: 'Push to talk (release ends turn)' },
  { keys: '⌘ ⇧ M', label: 'Mute microphone instantly' },
  { keys: '⌘ ⇧ Esc', label: 'Panic stop all speech & actions' },
];

export const ROADMAP_MILESTONES: RoadmapMilestone[] = [
  {
    id: 'M0',
    title: 'The desktop stage',
    detail: 'A transparent panel above every app and Space, Iki and Live2D renderers, lip sync within ±8 ms of the audio, and one typed protocol for app and core.',
    status: 'done',
    statusLabel: 'Done',
  },
  {
    id: 'M1–M2',
    title: 'Voice, characters and chat',
    detail: 'Push to talk, barge-in, Character Studio with pack import, personas and the chat window are in the app. The speech brain in core/ is being built.',
    status: 'in-progress',
    statusLabel: 'App done · brain in progress',
  },
  {
    id: 'M3',
    title: 'Expressive animation and VRM',
    detail: 'A four-layer animator on every renderer (life, posture, gesture, face), VRM 0.x and 1.0 characters, and sharper Hindi lip shapes.',
    status: 'done',
    statusLabel: 'Done in the app',
  },
  {
    id: 'M4–M5',
    title: 'Settings and memories',
    detail: 'Providers with keys in the macOS Keychain, hardware profiles, memory meters, and a browser to search, edit and delete what she remembers.',
    status: 'in-progress',
    statusLabel: 'App done · brain in progress',
  },
  {
    id: 'M6–M7',
    title: 'Voice Lab and safe Mac control',
    detail: 'Consent before any voice is recorded, guided recording and blind A/B listening; a confirm dialog before every action and a permanent audit log.',
    status: 'in-progress',
    statusLabel: 'App done · brain in progress',
  },
  {
    id: 'M8',
    title: 'Welcome and release',
    detail: 'First-run welcome with live permission checks, a pause while your screen is locked, and a bundle check. The signed, notarised download comes next.',
    status: 'planned',
    statusLabel: 'Signed release next',
  },
];

export interface AppScreen {
  id: string;
  title: string;
  detail: string;
  image: string;
  width: number;
  height: number;
  sample?: boolean;
}

export const APP_SCREENS: AppScreen[] = [
  { id: 'studio', title: 'Character Studio', detail: 'Meet the cast, preview every move a character can really do, and choose who stands on your desktop.', image: '/media/app-studio.webp', width: 2160, height: 1440 },
  { id: 'memory', title: 'Memories', detail: 'See what she remembers about you. Search it, correct it, or let it go.', image: '/media/app-memory.webp', width: 1800, height: 1240, sample: true },
  { id: 'voicelab', title: 'Voice Lab', detail: 'Train a voice only with consent: a recorded statement first, then guided lines, then a blind comparison.', image: '/media/app-voicelab.webp', width: 1800, height: 1280, sample: true },
  { id: 'settings', title: 'Settings', detail: 'Pick providers and models, keep API keys in the macOS Keychain, and match her to your Mac’s memory.', image: '/media/app-settings.webp', width: 1520, height: 1120 },
  { id: 'onboarding', title: 'Welcome', detail: 'A first-run guide: choose a character, grant permissions with live status, and learn push to talk.', image: '/media/app-onboarding.webp', width: 1520, height: 1120 },
];

export const GITHUB_REPO_URL = 'https://github.com/JayDev-27/Hikari';
export const GITHUB_RELEASES_URL = 'https://github.com/JayDev-27/Hikari/releases';

export const NAV = [
  { href: '#desktop', label: 'Desktop' },
  { href: '#cast', label: 'Cast' },
  { href: '#voice', label: 'Voice' },
  { href: '#app', label: 'The app' },
  { href: '#open-source', label: 'Open source' },
  { href: '#roadmap', label: 'Roadmap' },
];
