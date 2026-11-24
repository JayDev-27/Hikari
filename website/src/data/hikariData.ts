export interface CastCharacter {
  id: string;
  name: string;
  renderer: 'Iki' | 'Live2D';
  tags: string;
  signatureMove: string;
  image: string;
  imageAlt: string;
  summary: string;
  samples: {
    english: string;
    hindi: string;
    hinglish: string;
  };
  accentColor: string;
  licenseNote: string;
}

export interface TunnelChapter {
  index: string;
  kicker: string;
  title: string;
  description: string;
  specs: string[];
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
    tags: 'IKI RIG • POISE • FINGER-GUN BANG',
    signatureMove: 'Finger-gun "bang" · folded-hands stance',
    image: '/media/signatures.png',
    imageAlt: 'Hikari signature character moves lineup including Makima, Reze, Rize and Cheng Xiaoshi',
    summary:
      'Composed, deliberate, and quietly in control. Cut from layered reference artwork with custom leg-shift body mesh warp and procedural arm springs.',
    samples: {
      english: "You'll finish this today. I've already decided. …Unless you'd like a short break first?",
      hindi: 'शांत रहो। एक-एक करके सब हो जाएगा।',
      hinglish: 'Pehle sabse important kaam. Baaki baad mein. Theek hai na?',
    },
    accentColor: '#ff7eb6',
    licenseNote: 'Hikari fan rig & original persona; Chainsaw Man design belongs to its rights holders.',
  },
  {
    id: 'reze',
    name: 'Reze',
    renderer: 'Iki',
    tags: 'IKI RIG • PLAYFUL • FLOWER OFFER',
    signatureMove: 'Offers a white flower · shy wave',
    image: '/media/cast.png',
    imageAlt: 'Reze and the four Hikari Iki characters standing side by side',
    summary:
      'Warm café-counter banter with playful mystery. Reaches forward with an offered bloom while lifting her smile across a 70 ms arm exchange.',
    samples: {
      english: "Let's skip the boring part of the day. Tell me something fun instead.",
      hindi: 'बारिश हो रही है… चलो, थोड़ी देर बातें करते हैं।',
      hinglish: 'Aaj ka plan? Hmm… pehle chai, phir dekhte hain kya adventure milta hai.',
    },
    accentColor: '#8832f7',
    licenseNote: 'Hikari fan rig & original persona; Chainsaw Man design belongs to its rights holders.',
  },
  {
    id: 'rize',
    name: 'Rize Kamishiro',
    renderer: 'Iki',
    tags: 'IKI RIG • LITERARY • GHOUL EYES',
    signatureMove: 'Reads open book · glasses push · ghoul eyes',
    image: '/media/rize-ghoul.png',
    imageAlt: 'Rize Kamishiro eye color shift from calm purple to ghoul red',
    summary:
      'Bookish, theatrical, and sharp. Features a separately keyed glasses frame layer and irises that shift to crimson ghoul red mid-conversation.',
    samples: {
      english: 'You read that whole book in one night? How delicious. Tell me your favourite chapter.',
      hindi: 'अच्छी कहानी और अच्छी चाय… और क्या चाहिए?',
      hinglish: 'Hmm, interesting. Tum jitne lagte ho usse zyada mysterious ho.',
    },
    accentColor: '#ff4c6a',
    licenseNote: 'Hikari fan rig & original persona; Tokyo Ghoul design belongs to its rights holders.',
  },
  {
    id: 'cheng-xiaoshi',
    name: 'Cheng Xiaoshi',
    renderer: 'Iki',
    tags: 'IKI RIG • 1.48X TEMPO • PHOTO DIVE',
    signatureMove: 'Claps hands · photo dive',
    image: '/media/cheng-photo-dive.gif',
    imageAlt: 'Cheng Xiaoshi raising a photograph and clapping into a photo dive',
    summary:
      'Energetic photographer from Time Photo Studio. Animated at 1.48× idle tempo with 0.78 spring damping for crisp overshoot on his signature clap.',
    samples: {
      english: 'Wait, you took that shot? Come here, I want to see!',
      hindi: 'चलो, एक तस्वीर और लेते हैं।',
      hinglish: 'Arre, light dekho! Bas ek photo aur.',
    },
    accentColor: '#1a2ffb',
    licenseNote: 'Hikari fan rig & original persona; Link Click design belongs to its rights holders.',
  },
];

export const TUNNEL_CHAPTERS: TunnelChapter[] = [
  {
    index: '01',
    kicker: 'ACT 01 // NON-ACTIVATING STAGE',
    title: 'Floats Over Every App Without Stealing Focus.',
    description:
      'Built on a Tauri v2 transparent NSPanel that lives across all macOS Spaces and full-screen windows. Clicks pass straight through empty pixels via real-time 1-px alpha readPixels hit-testing.',
    specs: ['NSPanel Floating Level', 'Per-Pixel Click-Through', '60 ms Hysteresis', 'Menu-Bar Accessory'],
  },
  {
    index: '02',
    kicker: 'ACT 02 // SINGLE-CLOCK LIP SYNC',
    title: '±8 ms Phoneme-Accurate Hindi, English & Hinglish.',
    description:
      'All audio chunks, gestures, and IPA phonemes schedule against one WebAudio AudioContext clock. Cohen–Massaro coarticulation and a strict bilabial gate ensure m/b/p lip closure.',
    specs: ['AudioContext Clock', 'Cohen–Massaro Visemes', 'Bilabial Closure', 'Bluetooth Compensated'],
  },
  {
    index: '03',
    kicker: 'ACT 03 // VOICE & BARGE-IN',
    title: 'Interrupt Her Mid-Sentence With 5 ms Audio Fade.',
    description:
      'A 16 kHz mic worklet with echo cancellation powers push-to-talk (⌥ Space) and open-mic modes. When you speak over her, audio stops inside one render quantum and trims transcript history cleanly.',
    specs: ['16 kHz AudioWorklet', '⌥ Space Push-to-Talk', '5 ms Barge-In Fade', 'JSON-Schema WebSocket'],
  },
  {
    index: '04',
    kicker: 'ACT 04 // LOCAL FIRST ARCHITECTURE',
    title: 'Your Mac Runs the Show. Bring Any Character.',
    description:
      'Switch between built-in Iki rigs or drop your own Live2D, Iki, or upcoming VRM pack into Character Studio with licence inspection built in. Cloud models remain completely optional.',
    specs: ['Apple Silicon Native', 'Character Studio', 'Iki · Live2D · VRM (M3)', 'MIT Open Source'],
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
    title: 'Desktop Stage, Lip Sync & Wire Protocol',
    detail: 'NSPanel transparency, Iki + Live2D renderers, ±8 ms A/V sync, generated TS/Pydantic protocol.',
    status: 'done',
    statusLabel: 'Shipped in Repo',
  },
  {
    id: 'M1–M2',
    title: 'Voice Input, Character Studio & Personas',
    detail: 'Desktop mic worklet, barge-in, pack importer, chat UI & 4 Iki rigs done; Python voice brain (core/) in progress.',
    status: 'in-progress',
    statusLabel: 'Body Done · Core WIP',
  },
  {
    id: 'M3–M5',
    title: 'VRM 3D Renderer, Multi-LLM Router & Memory',
    detail: 'Three.js VRM avatars, 8 GB Apple Silicon profiles, failover routing, and local sqlite-vec memory browser.',
    status: 'planned',
    statusLabel: 'Planned',
  },
  {
    id: 'M6–M8',
    title: 'Voice Lab, Safe Mac MCP & Signed .dmg Release',
    detail: 'Consented voice cloning, tiered macOS automation audit log, onboarding, and public macOS installer.',
    status: 'planned',
    statusLabel: 'Download Coming Soon',
  },
];

export const GITHUB_REPO_URL = 'https://github.com/JayDev-27/Hikari';
export const GITHUB_RELEASES_URL = 'https://github.com/JayDev-27/Hikari/releases';
