export const TOOLS_S0 = [
  {
    type: "function",
    name: "get_machine_status",
    description: "Get the current status of a machine including its operational state and any active alarm codes.",
    parameters: {
      type: "object",
      properties: {
        machine_id: {
          type: "string",
          description: "The unique ID of the machine, from M01 to M05.",
          enum: ["M01", "M02", "M03", "M04", "M05"],
          examples: ["M01", "M03"]
        }
      },
      required: ["machine_id"]
    },
    execution_mode: "interactive",
    timeout_seconds: 30
  },
  {
    type: "function",
    name: "lookup_alarm",
    description: "Look up the meaning and troubleshooting steps for a specific alarm code.",
    parameters: {
      type: "object",
      properties: {
        alarm_code: {
          type: "string",
          description: "The alarm code as spoken, digits only, may contain spaces.",
          pattern: " *([0-9] *){3,4}",
          examples: ["414", "4 1 4", "1001"]
        },
        machine_id: {
          type: "string",
          description: "Optional machine ID associated with the alarm.",
          enum: ["M01", "M02", "M03", "M04", "M05"],
          examples: ["M03"]
        }
      },
      required: ["alarm_code"]
    },
    execution_mode: "interactive",
    timeout_seconds: 30
  },
  {
    type: "function",
    name: "get_maintenance_history",
    description: "Retrieve recent maintenance records for a specific machine.",
    parameters: {
      type: "object",
      properties: {
        machine_id: {
          type: "string",
          description: "The unique ID of the machine.",
          enum: ["M01", "M02", "M03", "M04", "M05"],
          examples: ["M03"]
        },
        limit: {
          type: "integer",
          description: "Maximum number of records to return.",
          examples: [3, 5]
        }
      },
      required: ["machine_id"]
    },
    execution_mode: "interactive",
    timeout_seconds: 30
  },
  {
    type: "function",
    name: "end_conversation",
    description: "End the current voice session and close the connection.",
    parameters: {
      type: "object",
      properties: {}
    },
    execution_mode: "interactive",
    timeout_seconds: 10
  }
];

export const TOOLS_S1 = [
  ...TOOLS_S0,
  {
    type: "function",
    name: "create_repair_ticket",
    description: "Create a formal repair request for a machine. Requires operator confirmation.",
    parameters: {
      type: "object",
      properties: {
        machine_id: {
          type: "string",
          description: "The unique ID of the machine.",
          enum: ["M01", "M02", "M03", "M04", "M05"],
          examples: ["M03"]
        },
        symptom: {
          type: "string",
          description: "A description of the observed issue.",
          examples: ["spindle grinding noise", "coolant leak"]
        },
        severity: {
          type: "string",
          description: "The severity of the issue.",
          enum: ["low", "medium", "high"],
          examples: ["high"]
        },
        can_keep_running: {
          type: "string",
          description: "Whether the machine is still capable of production.",
          enum: ["yes", "no", "unknown"],
          examples: ["no"]
        },
        operator_confirmed: {
          type: "string",
          description: "Must be 'yes' to indicate the operator has confirmed the details.",
          enum: ["yes"],
          examples: ["yes"]
        }
      },
      required: ["machine_id", "symptom", "severity", "can_keep_running", "operator_confirmed"]
    },
    execution_mode: "interactive",
    timeout_seconds: 30
  },
  {
    type: "function",
    name: "resolve_repair_ticket",
    description: "Mark an open repair ticket as resolved and completed by a technician.",
    parameters: {
      type: "object",
      properties: {
        ticket_id: {
          type: "string",
          description: "The ID of the repair ticket to resolve (e.g. RT-1001).",
          pattern: "RT-[0-9]{4}",
          examples: ["RT-1001"]
        }
      },
      required: ["ticket_id"]
    },
    execution_mode: "interactive",
    timeout_seconds: 30
  }
];
