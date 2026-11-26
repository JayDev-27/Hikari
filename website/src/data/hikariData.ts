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
    image: '/media/hikari-cast-rize.webp',
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
