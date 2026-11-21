// What your voice agent is: the models it uses, how it greets people, and what it is told to do.
// Change anything here and restart the server. Every field is a Voice Agent API Settings field:
// https://developers.deepgram.com/docs/configure-voice-agent

export const PROMPT = `You are a friendly voice agent at a conference booth.
Ask the person what they are building, and have a short, curious conversation about it.
Reply in one or two short sentences. Ask one question at a time. Never use lists or markdown: everything you say is spoken.`;

export const GREETING = "Hi, welcome! What are you building?";

// The think model. think-fast is Deepgram's own LLM, tuned for voice (Early Access: your Deepgram project needs access).
// Without access, use a Deepgram-managed one instead, for example THINK_PROVIDER=open_ai THINK_MODEL=gpt-4o-mini.
const THINK_PROVIDER = process.env.THINK_PROVIDER || "deepgram";
const THINK_MODEL = process.env.THINK_MODEL || "think-fast";

export function settings() {
  return {
    type: "Settings",
    audio: {
      input: { encoding: "linear16", sample_rate: 16000 },                       // what the browser sends
      output: { encoding: "linear16", sample_rate: 24000, container: "none" },   // what the browser plays
    },
    agent: {
      // Flux: speech to text that knows when a person has finished a thought, not just when they pause.
      listen: { provider: { type: "deepgram", version: "v2", model: "flux-general-en" } },
      think: { provider: { type: THINK_PROVIDER, model: THINK_MODEL }, prompt: PROMPT },
      // Flux TTS: the voice. Other voices: https://developers.deepgram.com/docs/tts-models
      speak: { provider: { type: "deepgram", version: "v2", model: process.env.VOICE || "flux-alexis-en" } },
      greeting: GREETING,
    },
  };
}
