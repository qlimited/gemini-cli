/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Credentials } from 'google-auth-library';
import { HybridTokenStorage } from '../mcp/token-storage/hybrid-token-storage.js';
import { OAUTH_FILE } from '../config/storage.js';
import type { OAuthCredentials } from '../mcp/token-storage/types.js';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { GEMINI_DIR, homedir } from '../utils/paths.js';
import { coreEvents } from '../utils/events.js';

const KEYCHAIN_SERVICE_NAME = 'gemini-cli-oauth';
const MAIN_ACCOUNT_KEY = 'main-account';

/** Prefix used for email-specific credential keys */
const ACCOUNT_KEY_PREFIX = 'account-';

export class OAuthCredentialStorage {
  private static storage: HybridTokenStorage = new HybridTokenStorage(
    KEYCHAIN_SERVICE_NAME,
  );

  /** Build the storage key for a given email address */
  private static accountKey(email: string): string {
    return `${ACCOUNT_KEY_PREFIX}${email}`;
  }

  /** Convert an OAuthCredentials record to the Google Credentials format */
  private static toGoogleCredentials(
    credentials: OAuthCredentials,
  ): Credentials {
    const { accessToken, refreshToken, expiresAt, tokenType, scope } =
      credentials.token;
    const googleCreds: Credentials = {
      access_token: accessToken,
      refresh_token: refreshToken ?? undefined,
      token_type: tokenType ?? undefined,
      scope: scope ?? undefined,
    };
    if (expiresAt) {
      googleCreds.expiry_date = expiresAt;
    }
    return googleCreds;
  }

  /**
   * Load cached OAuth credentials.
   *
   * If `email` is provided, tries the email-specific key first, then falls
   * back to the legacy `main-account` key (for users migrating from a
   * single-account setup).
   * If no `email` is given, loads from the legacy `main-account` key or
   * migrates from old file-based storage.
   */
  static async loadCredentials(email?: string): Promise<Credentials | null> {
    try {
      if (email) {
        const emailCreds = await this.storage.getCredentials(
          this.accountKey(email),
        );
        if (emailCreds?.token) {
          return this.toGoogleCredentials(emailCreds);
        }
        // Fall back to MAIN_ACCOUNT_KEY for backward-compat migration
      }

      const mainCreds = await this.storage.getCredentials(MAIN_ACCOUNT_KEY);
      if (mainCreds?.token) {
        return this.toGoogleCredentials(mainCreds);
      }

      // Last resort: migrate from the old unencrypted file
      return await this.migrateFromFileStorage();
    } catch (error: unknown) {
      coreEvents.emitFeedback(
        'error',
        'Failed to load OAuth credentials',
        error,
      );
      throw new Error('Failed to load OAuth credentials', { cause: error });
    }
  }

  /**
   * Save OAuth credentials.
   *
   * Always updates the legacy `main-account` key (keeps backward compat with
   * single-account installs). When `email` is provided the credentials are
   * *also* written under the email-specific key, enabling multi-account use.
   */
  static async saveCredentials(
    credentials: Credentials,
    email?: string,
  ): Promise<void> {
    if (!credentials.access_token) {
      throw new Error('Attempted to save credentials without an access token.');
    }

    const buildRecord = (key: string): OAuthCredentials => ({
      serverName: key,
      token: {
        accessToken: credentials.access_token!,
        refreshToken: credentials.refresh_token ?? undefined,
        tokenType: credentials.token_type ?? 'Bearer',
        scope: credentials.scope ?? undefined,
        expiresAt: credentials.expiry_date ?? undefined,
      },
      updatedAt: Date.now(),
    });

    // Always keep MAIN_ACCOUNT_KEY in sync (backward compat)
    await this.storage.setCredentials(buildRecord(MAIN_ACCOUNT_KEY));

    // Also persist under the email-specific key when available
    if (email) {
      await this.storage.setCredentials(buildRecord(this.accountKey(email)));
    }
  }

  /**
   * Clear the legacy `main-account` key only.
   *
   * Used when starting a new-account OAuth flow so that the stored
   * email-specific credentials are **not** deleted.
   */
  static async clearMainAccountOnly(): Promise<void> {
    try {
      await this.storage.deleteCredentials(MAIN_ACCOUNT_KEY);
      // Also remove the old unencrypted file if present
      const oldFilePath = path.join(homedir(), GEMINI_DIR, OAUTH_FILE);
      await fs.rm(oldFilePath, { force: true }).catch(() => {});
    } catch (error: unknown) {
      coreEvents.emitFeedback(
        'error',
        'Failed to clear main-account credentials',
        error,
      );
      throw new Error('Failed to clear main-account credentials', {
        cause: error,
      });
    }
  }

  /**
   * Clear cached OAuth credentials for a specific account.
   *
   * Removes both the email-specific key (when `email` is provided) and the
   * legacy `main-account` key.
   */
  static async clearCredentials(email?: string): Promise<void> {
    try {
      if (email) {
        await this.storage.deleteCredentials(this.accountKey(email));
      }
      // Always clear MAIN_ACCOUNT_KEY
      await this.storage.deleteCredentials(MAIN_ACCOUNT_KEY);

      // Also remove the old unencrypted file if it exists
      const oldFilePath = path.join(homedir(), GEMINI_DIR, OAUTH_FILE);
      await fs.rm(oldFilePath, { force: true }).catch(() => {});
    } catch (error: unknown) {
      coreEvents.emitFeedback(
        'error',
        'Failed to clear OAuth credentials',
        error,
      );
      throw new Error('Failed to clear OAuth credentials', { cause: error });
    }
  }

  /**
   * Clear ALL stored OAuth credentials (every account + the legacy key).
   */
  static async clearAllCredentials(): Promise<void> {
    try {
      const allCreds = await this.storage.getAllCredentials();
      for (const serverName of allCreds.keys()) {
        if (
          serverName === MAIN_ACCOUNT_KEY ||
          serverName.startsWith(ACCOUNT_KEY_PREFIX)
        ) {
          await this.storage.deleteCredentials(serverName);
        }
      }

      // Remove the old unencrypted file if it exists
      const oldFilePath = path.join(homedir(), GEMINI_DIR, OAUTH_FILE);
      await fs.rm(oldFilePath, { force: true }).catch(() => {});
    } catch (error: unknown) {
      coreEvents.emitFeedback(
        'error',
        'Failed to clear all OAuth credentials',
        error,
      );
      throw new Error('Failed to clear all OAuth credentials', {
        cause: error,
      });
    }
  }

  /**
   * Return a list of all email addresses that have stored credentials.
   */
  static async listAccounts(): Promise<string[]> {
    try {
      const allCreds = await this.storage.getAllCredentials();
      const emails: string[] = [];
      for (const serverName of allCreds.keys()) {
        if (serverName.startsWith(ACCOUNT_KEY_PREFIX)) {
          emails.push(serverName.slice(ACCOUNT_KEY_PREFIX.length));
        }
      }
      return emails;
    } catch {
      return [];
    }
  }

  /**
   * Migrate credentials from old file-based storage to the current backend.
   */
  private static async migrateFromFileStorage(): Promise<Credentials | null> {
    const oldFilePath = path.join(homedir(), GEMINI_DIR, OAUTH_FILE);

    let credsJson: string;
    try {
      credsJson = await fs.readFile(oldFilePath, 'utf-8');
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        // File doesn't exist, so no migration.
        return null;
      }
      // Other read errors should propagate.
      throw error;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const credentials: Credentials = JSON.parse(credsJson);

    // Save to new storage
    await this.saveCredentials(credentials);

    // Remove old file after successful migration
    await fs.rm(oldFilePath, { force: true }).catch(() => {});

    return credentials;
  }
}
