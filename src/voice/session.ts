import { PROMPT_S0, PROMPT_S1 } from "./prompt";
import { TOOLS_S0, TOOLS_S1 } from "./tools";

function buildSessionUpdate(systemPrompt: string, tools: object[]) {
  return {
    type: "session.update",
    session: {
      system_prompt: systemPrompt,
      tools,
      input: {
        voice_focus: "far-field",
        language_codes: ["en"],
        keyterms: [
          "M01", "M02", "M03", "M04", "M05",
          "414", "1001",
          "spindle", "coolant", "ATC", "servo"
        ]
      },
      output: {
        voice: "alba"
      },
      turn_detection: {
        vad_threshold: 0.5,
        min_silence: 1400,
        max_silence: 4000,
        interrupt_response: true
      }
    }
  };
}

export function createInitialSessionUpdate() {
  return buildSessionUpdate(PROMPT_S0, TOOLS_S0);
}

export function createConfirmedSessionUpdate() {
  return buildSessionUpdate(PROMPT_S1, TOOLS_S1);
}
