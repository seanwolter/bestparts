import type { CDPSession, Page } from "@playwright/test";

interface ResponseOverrideBits {
  isBadUP?: boolean;
  isBadUV?: boolean;
  isBogusSignature?: boolean;
}

interface VirtualAuthenticatorCredential {
  credentialId: string;
}

export interface VirtualAuthenticatorController {
  getCredentials(): Promise<VirtualAuthenticatorCredential[]>;
  resetResponseOverrideBits(): Promise<void>;
  setResponseOverrideBits(bits: ResponseOverrideBits): Promise<void>;
  dispose(): Promise<void>;
}

export async function attachVirtualAuthenticator(
  page: Page
): Promise<VirtualAuthenticatorController> {
  const session = await page.context().newCDPSession(page);
  await session.send("WebAuthn.enable", {
    enableUI: false,
  });

  const { authenticatorId } = await session.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      ctap2Version: "ctap2_1",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      automaticPresenceSimulation: true,
      isUserVerified: true,
    },
  });

  return {
    async getCredentials() {
      const result = await session.send("WebAuthn.getCredentials", {
        authenticatorId,
      });

      return result.credentials as VirtualAuthenticatorCredential[];
    },

    async resetResponseOverrideBits() {
      await sendResponseOverrideBits(session, authenticatorId, {});
    },

    async setResponseOverrideBits(bits) {
      await sendResponseOverrideBits(session, authenticatorId, bits);
    },

    async dispose() {
      await session.send("WebAuthn.removeVirtualAuthenticator", {
        authenticatorId,
      });
      await session.send("WebAuthn.disable");
      await session.detach();
    },
  };
}

async function sendResponseOverrideBits(
  session: CDPSession,
  authenticatorId: string,
  bits: ResponseOverrideBits
) {
  await session.send("WebAuthn.setResponseOverrideBits", {
    authenticatorId,
    ...bits,
  });
}
