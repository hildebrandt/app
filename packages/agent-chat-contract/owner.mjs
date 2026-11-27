import { createHmac, timingSafeEqual } from "node:crypto";

const OWNER_ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const SIGNATURE = /^[0-9a-f]{64}$/u;

/** @param {string | undefined} secret */
export const readChatOwnerSecret = (secret) =>
  secret && secret.length >= 32 ? secret : undefined;

/** @param {string} owner @param {string} secret */
export const signChatOwner = (owner, secret) => {
  const signature = createHmac("sha256", secret).update("agent-chat-owner:").update(owner).digest("hex");
  return `${owner}.${signature}`;
};

/** @param {string | null | undefined} token @param {string} secret */
export const verifyChatOwner = (token, secret) => {
  if (token?.length !== 101) {
    return null;
  }
  const [owner, signature] = token.split(".");
  if (!owner || !signature || !OWNER_ID.test(owner) || !SIGNATURE.test(signature)) {
    return null;
  }
  return timingSafeEqual(Buffer.from(token), Buffer.from(signChatOwner(owner, secret))) ? owner : null;
};
