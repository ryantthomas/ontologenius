/**
 * OAuth 2.1 authorization server for the remote MCP connector.
 *
 * claude.ai will not attach to a remote connector without one, so this exists
 * to make the connector installable rather than to manage a user directory.
 * The security model follows the same shape as the personal-data-lake server:
 *
 *   - access tokens are HMAC-signed and self-contained, so verifying one costs
 *     no I/O on the hot path
 *   - refresh tokens are random and stored hashed
 *   - authorization codes live in memory with a short TTL and are consumed on
 *     first use, which is safe because they are redeemed seconds after issue
 *   - PKCE is required, S256 only
 *
 * Single-tenant: every token resolves to one learner. Clients register
 * dynamically because claude.ai expects to, but the subject never varies.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Response } from "express";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthClientInformationFull, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  InvalidGrantError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";

const ACCESS_TOKEN_TTL = 3_600; // 1 hour
const REFRESH_TOKEN_TTL = 30 * 86_400; // 30 days
const AUTH_CODE_TTL = 300; // 5 minutes

const base64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64url");

interface PendingCode {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  expiresAt: number;
}

interface StoredRefresh {
  clientId: string;
  expiresAt: number;
}

/**
 * In-memory client and token state.
 *
 * Restarting the server invalidates refresh tokens and forces a reconnect,
 * which is an acceptable trade for a single-user deployment and is called out
 * in the README. Persisting these is the first thing to change when this goes
 * multi-user.
 */
export class OntologeniusOAuthProvider implements OAuthServerProvider {
  private readonly clients = new Map<string, OAuthClientInformationFull>();
  private readonly codes = new Map<string, PendingCode>();
  private readonly refreshTokens = new Map<string, StoredRefresh>();

  constructor(
    private readonly secret: string,
    private readonly subject: string,
  ) {
    if (secret.length < 32) {
      throw new Error("OAUTH_SECRET must be at least 32 characters");
    }
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: async (clientId: string) => this.clients.get(clientId),
      registerClient: async (client: OAuthClientInformationFull) => {
        this.clients.set(client.client_id, client);
        return client;
      },
    };
  }

  /**
   * No consent screen: the deployment has exactly one user, who is the person
   * installing the connector. A multi-user version authenticates here instead
   * of redirecting straight back.
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const code = randomBytes(32).toString("hex");
    this.codes.set(code, {
      clientId: client.client_id,
      codeChallenge: params.codeChallenge,
      redirectUri: params.redirectUri,
      expiresAt: Date.now() + AUTH_CODE_TTL * 1000,
    });

    const redirect = new URL(params.redirectUri);
    redirect.searchParams.set("code", code);
    if (params.state) redirect.searchParams.set("state", params.state);
    res.redirect(redirect.toString());
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const pending = this.codes.get(authorizationCode);
    if (!pending || pending.clientId !== client.client_id) {
      throw new InvalidGrantError("unknown authorization code");
    }
    if (pending.expiresAt < Date.now()) {
      this.codes.delete(authorizationCode);
      throw new InvalidGrantError("authorization code expired");
    }
    return pending.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<OAuthTokens> {
    const pending = this.codes.get(authorizationCode);
    if (!pending || pending.clientId !== client.client_id) {
      throw new InvalidGrantError("unknown authorization code");
    }
    // Consumed on first use — a replayed code is not a valid code.
    this.codes.delete(authorizationCode);

    if (pending.expiresAt < Date.now()) throw new InvalidGrantError("authorization code expired");
    return this.issueTokens(client.client_id);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
  ): Promise<OAuthTokens> {
    const hash = createHash("sha256").update(refreshToken).digest("hex");
    const stored = this.refreshTokens.get(hash);

    if (!stored || stored.clientId !== client.client_id) {
      throw new InvalidGrantError("unknown refresh token");
    }
    if (stored.expiresAt < Date.now()) {
      this.refreshTokens.delete(hash);
      throw new InvalidGrantError("refresh token expired");
    }

    // Rotate: the presented token is spent whether or not the client keeps it.
    this.refreshTokens.delete(hash);
    return this.issueTokens(client.client_id);
  }

  /** Verification is a signature check plus an expiry check. No I/O. */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) throw new InvalidTokenError("malformed access token");

    const expected = createHmac("sha256", this.secret).update(payload).digest("hex");
    const given = Buffer.from(signature);
    const want = Buffer.from(expected);
    if (given.length !== want.length || !timingSafeEqual(given, want)) {
      throw new InvalidTokenError("invalid access token signature");
    }

    // The signature already proves we minted this, but a malformed payload must
    // still read as an invalid token rather than a server error.
    let claims: { sub: string; cid: string; exp: number };
    try {
      claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    } catch {
      throw new InvalidTokenError("unreadable access token payload");
    }

    if (typeof claims?.exp !== "number") throw new InvalidTokenError("access token has no expiry");
    if (claims.exp * 1000 < Date.now()) throw new InvalidTokenError("access token expired");

    return {
      token,
      clientId: claims.cid,
      scopes: [],
      expiresAt: claims.exp,
      extra: { subject: claims.sub },
    };
  }

  private issueTokens(clientId: string): OAuthTokens {
    const expiresAt = Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL;
    const payload = base64url(
      JSON.stringify({ sub: this.subject, cid: clientId, exp: expiresAt }),
    );
    const signature = createHmac("sha256", this.secret).update(payload).digest("hex");

    const refreshToken = randomBytes(32).toString("hex");
    this.refreshTokens.set(createHash("sha256").update(refreshToken).digest("hex"), {
      clientId,
      expiresAt: Date.now() + REFRESH_TOKEN_TTL * 1000,
    });

    return {
      access_token: `${payload}.${signature}`,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL,
      refresh_token: refreshToken,
    };
  }
}
