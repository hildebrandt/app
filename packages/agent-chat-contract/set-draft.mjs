export const setDraftMaxLength = 4000;

/** @typedef {"changed" | "unchanged" | "denied" | "cancelled" | "unavailable" | "unknown"} SetDraftOutcome */
/** @typedef {{outcome: SetDraftOutcome}} SetDraftResult */

/** @type {SetDraftOutcome[]} */
const outcomes = ["changed", "unchanged", "denied", "cancelled", "unavailable", "unknown"];

export const setDraftToolSpec = {
  name: /** @type {const} */ ("set_draft"),
  description: "Replace the Ask Agent draft after the user approves the proposed edit. This does not send a message.",
  inputSchema: {
    type: "object",
    properties: { value: { type: "string", maxLength: setDraftMaxLength } },
    required: ["value"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      outcome: { type: "string", enum: outcomes },
    },
    required: ["outcome"],
    additionalProperties: false,
  },
};

/** @param {unknown} input @param {string} key @returns {unknown} */
const readOnlyField = (input, key) => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return undefined;
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    return undefined;
  }
  return Reflect.ownKeys(input).length === 1
    ? Object.getOwnPropertyDescriptor(input, key)?.value
    : undefined;
};

/** @param {unknown} input */
export const parseSetDraftInput = (input) => {
  const value = readOnlyField(input, "value");
  if (typeof value !== "string") {
    return null;
  }
  if (value.length > setDraftMaxLength) {
    let length = 0;
    for (const _codePoint of value) {
      length += 1;
      if (length > setDraftMaxLength) {
        return null;
      }
    }
  }
  return { value };
};

/** @param {unknown} input @returns {SetDraftResult | null} */
export const parseSetDraftResult = (input) => {
  const value = readOnlyField(input, "outcome");
  const outcome = setDraftToolSpec.outputSchema.properties.outcome.enum.find((entry) => entry === value);
  return outcome === undefined ? null : { outcome };
};
