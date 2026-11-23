// What your voice agent is: its prompt, greeting, models, the roles a visitor can have, and how it closes a
// conversation. Change anything here and restart the server. Every Settings field is documented at
// https://developers.deepgram.com/docs/configure-voice-agent

export const GREETING = "Hi, welcome to the Deepgram booth! What are you building?";

export const PROMPT = `You are the voice agent at Deepgram's booth at AWS re:Invent. Visitors walk up and talk to you.

How you talk:
- Keep every reply short: one sentence of about 15 words. If they ask you something, up to two short sentences.
- Ask at most one question per reply. Do not repeat a question from earlier in the conversation.
- Everything you say is spoken: no lists, no markdown, no emoji, no URLs.
- Be curious about what they are building and follow their interests.
- Never offer to demonstrate anything and never ask them to try something.
- If they ask whether they can interrupt you, say they can cut in any time. Never invite them to do it yourself.

What you are, if they ask (keep it to a sentence):
- You run on Deepgram's Voice Agent API: one WebSocket that listens, thinks and speaks.
- Flux listens, and knows when someone has finished a thought, not just when they pause.
- Think-Fast, Deepgram's LLM tuned for voice, writes your replies. Flux TTS speaks them.
- Never make up numbers, prices, customers or dates.

The code:
- Never offer the code or mention it yourself.
- Only if they ask how to build something like you: say the code is on the screen to scan, and call show_code in the same reply.

Ending:
- If they say goodbye or that they have to go, say one short goodbye, then call end_call. Say nothing after it.`;

// Who is at the booth. The operator picks one on the console before Start; the brief is added to the prompt.
// `developer: true` turns on the developer close: before goodbye, the agent asks if they want to build one, and
// shows the QR code for this repo on a yes.
export const ROLES = {
  general: {
    label: "Any visitor",
    brief: "You know nothing about this visitor yet. Find out what brings them to the booth and what they work on.",
  },
  developer: {
    label: "Developer",
    developer: true,
    brief: "This visitor is a developer. Ask what they are building and how voice could fit. If it comes up, " +
      "talk about latency, turn-taking and being able to talk over the agent.",
  },
  executive: {
    label: "Executive",
    brief: "This visitor is an executive. Talk about outcomes their customers would notice, not technology. No jargon.",
  },
  product: {
    label: "Product manager",
    brief: "This visitor builds products. Ask where voice could fit in their product and what their users would do with it.",
  },
  cx: {
    label: "Customer experience",
    brief: "This visitor runs customer experience or a contact center. Ask how their customers reach them today.",
  },
};

// Added to the prompt (UpdatePrompt) when the operator presses Wrap up.
export function closingPrompt(role) {
  const close = "Start closing the conversation now, kindly. Any question still open gets a very short answer " +
    "first. Next, tell them you enjoyed talking with them but you have to wrap up now. Do not explain why: no " +
    "talk of time, schedules or the booth.";
  if (!ROLES[role]?.developer) return `${close} Finish with a brief goodbye, then call end_call. No questions.`;
  return `${close} Next, ask whether they would like to make their own voice agent like you. Hold off on end_call ` +
    "until they reply. A yes in any form: tell them to scan the code on the screen, say a brief goodbye, then call " +
    "show_code. Otherwise: a brief goodbye, then call end_call. Say nothing more after the goodbye.";
}

// Functions the agent can call. The server handles them (booth.js); none of them are sent to an outside endpoint.
export const FUNCTIONS = [
  {
    name: "show_code",
    description: "Put a scannable link to this agent's source code on the booth screen.",
    parameters: { type: "object", properties: {} },
    defer_until_eot: true,   // never on a guess: only once the visitor has finished saying yes
  },
  {
    name: "end_call",
    description: "End the conversation. Say your goodbye first, then call this. Say nothing after it.",
    parameters: { type: "object", properties: {} },
    defer_until_eot: true,   // only once the visitor has really finished their turn
  },
];

// The think model. Think-Fast is Deepgram's own LLM, tuned for voice (Early Access: your project needs access).
// Without access, use a Deepgram-managed one instead, for example THINK_PROVIDER=open_ai THINK_MODEL=gpt-4o-mini.
const THINK_PROVIDER = process.env.THINK_PROVIDER || "deepgram";
const THINK_MODEL = process.env.THINK_MODEL || "think-fast";

export function settings({ role = "general" } = {}) {
  const brief = (ROLES[role] || ROLES.general).brief;
  return {
    type: "Settings",
    audio: {
      input: { encoding: "linear16", sample_rate: 16000 },                       // what the booth screen sends
      output: { encoding: "linear16", sample_rate: 24000, container: "none" },   // what it plays
    },
    agent: {
      // Flux: speech to text that knows when a person has finished a thought, not just when they pause.
      listen: { provider: { type: "deepgram", version: "v2", model: "flux-general-en" } },
      think: {
        provider: { type: THINK_PROVIDER, model: THINK_MODEL },
        prompt: `${process.env.VOICE_BACKEND === "pipecat" ? PROMPT.replace(
          "You run on Deepgram's Voice Agent API: one WebSocket that listens, thinks and speaks.",
          "You run on Pipecat, which connects Deepgram Flux recognition, an LLM and Flux speech synthesis."
        ) : PROMPT}\n\nThe visitor: ${brief}`,
        functions: FUNCTIONS,
      },
      // Flux TTS: the voice. Other voices: https://developers.deepgram.com/docs/tts-models
      speak: { provider: { type: "deepgram", version: "v2", model: process.env.VOICE || "flux-alexis-en" } },
      greeting: GREETING,
    },
  };
}
