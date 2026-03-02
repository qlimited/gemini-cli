/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  OpenDialogActionReturn,
  SlashCommand,
  LogoutActionReturn,
} from './types.js';
import type { MessageActionReturn } from '@google/gemini-cli-core';
import { CommandKind } from './types.js';
import {
  clearAllCachedCredentialFiles,
  prepareForNewAccountLogin,
  switchToAccount,
  getStoredAccounts,
  OAuthCredentialStorage,
} from '@google/gemini-cli-core';
import { SettingScope } from '../../config/settings.js';

// ── /auth login ────────────────────────────────────────────────────────────

const authLoginCommand: SlashCommand = {
  name: 'login',
  description: 'Login or change the auth method',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: (_context, _args): OpenDialogActionReturn => ({
    type: 'dialog',
    dialog: 'auth',
  }),
};

// ── /auth logout ───────────────────────────────────────────────────────────

const authLogoutCommand: SlashCommand = {
  name: 'logout',
  description: 'Log out and clear all cached credentials',
  kind: CommandKind.BUILT_IN,
  action: async (context, _args): Promise<LogoutActionReturn> => {
    await clearAllCachedCredentialFiles();
    // Clear the selected auth type so user sees the auth selection menu
    context.services.settings.setValue(
      SettingScope.User,
      'security.auth.selectedType',
      undefined,
    );
    context.services.settings.setValue(
      SettingScope.User,
      'security.auth.activeAccount',
      undefined,
    );
    // Strip thoughts from history instead of clearing completely
    context.services.config?.getGeminiClient()?.stripThoughtsFromHistory();
    // Return logout action to signal explicit state change
    return {
      type: 'logout',
    };
  },
};

// ── /auth add ──────────────────────────────────────────────────────────────

const authAddCommand: SlashCommand = {
  name: 'add',
  description: 'Add another Google account',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (
    _context,
    _args,
  ): Promise<OpenDialogActionReturn | MessageActionReturn> => {
    try {
      // Save existing account's credentials to its email key, then clear the
      // main-account slot so the upcoming OAuth flow starts fresh.
      await prepareForNewAccountLogin();
      // Open the auth dialog so the user can complete the OAuth flow
      return { type: 'dialog', dialog: 'auth' };
    } catch (e) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to prepare for new account login: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
};

// ── /auth switch ───────────────────────────────────────────────────────────

const authSwitchCommand: SlashCommand = {
  name: 'switch',
  description: 'Switch to a different stored Google account',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,

  /** Provide tab-completion with the list of old (non-active) accounts */
  completion: async (): Promise<string[]> => {
    const { all, active } = getStoredAccounts();
    return all.filter((e) => e !== active);
  },

  action: async (
    context,
    args,
  ): Promise<MessageActionReturn | LogoutActionReturn> => {
    const email = args.trim();

    if (!email) {
      const { active, all } = getStoredAccounts();
      if (all.length === 0) {
        return {
          type: 'message',
          messageType: 'error',
          content:
            'No stored accounts found. Use `/auth add` to add an account.',
        };
      }
      const accountList = all
        .map((e) => (e === active ? `• ${e}  ← active` : `• ${e}`))
        .join('\n');
      return {
        type: 'message',
        messageType: 'info',
        content: `Stored accounts:\n${accountList}\n\nUsage: /auth switch <email>`,
      };
    }

    const { all, active } = getStoredAccounts();

    if (email === active) {
      return {
        type: 'message',
        messageType: 'info',
        content: `Already signed in as ${email}.`,
      };
    }

    // Check that the target account has stored credentials
    const storedEmails = await OAuthCredentialStorage.listAccounts();
    if (!storedEmails.includes(email) && !all.includes(email)) {
      return {
        type: 'message',
        messageType: 'error',
        content: `No stored credentials found for ${email}. Use \`/auth add\` to authenticate this account first.`,
      };
    }

    try {
      await switchToAccount(email);
      // Keep settings in sync
      context.services.settings.setValue(
        SettingScope.User,
        'security.auth.activeAccount',
        email,
      );
      // Clear the Gemini client history so it starts fresh for the new account
      context.services.config?.getGeminiClient()?.stripThoughtsFromHistory();

      return {
        type: 'message',
        messageType: 'info',
        content: `Switched to ${email}. The next request will use this account's credentials.`,
      };
    } catch (e) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to switch account: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
};

// ── /auth list ─────────────────────────────────────────────────────────────

const authListCommand: SlashCommand = {
  name: 'list',
  description: 'List all stored Google accounts',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: (_context, _args): MessageActionReturn => {
    const { active, all } = getStoredAccounts();

    if (all.length === 0) {
      return {
        type: 'message',
        messageType: 'info',
        content: 'No stored accounts. Use `/auth add` to add an account.',
      };
    }

    const lines = all.map((e) =>
      e === active ? `• ${e}  ← active` : `• ${e}`,
    );

    return {
      type: 'message',
      messageType: 'info',
      content: `Stored accounts:\n${lines.join('\n')}`,
    };
  },
};

// ── /auth remove ───────────────────────────────────────────────────────────

const authRemoveCommand: SlashCommand = {
  name: 'remove',
  description: 'Remove a specific stored Google account',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,

  completion: async (): Promise<string[]> => {
    const { all } = getStoredAccounts();
    return all;
  },

  action: async (
    context,
    args,
  ): Promise<MessageActionReturn | LogoutActionReturn> => {
    const email = args.trim();

    if (!email) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /auth remove <email>',
      };
    }

    const { active } = getStoredAccounts();
    const isActive = email === active;

    try {
      await OAuthCredentialStorage.clearCredentials(email);

      if (isActive) {
        // Removed the active account — force re-authentication
        context.services.settings.setValue(
          SettingScope.User,
          'security.auth.selectedType',
          undefined,
        );
        context.services.settings.setValue(
          SettingScope.User,
          'security.auth.activeAccount',
          undefined,
        );
        context.services.config?.getGeminiClient()?.stripThoughtsFromHistory();
        return { type: 'logout' };
      }

      return {
        type: 'message',
        messageType: 'info',
        content: `Removed account: ${email}`,
      };
    } catch (e) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to remove account: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
};

// ── /auth (root) ───────────────────────────────────────────────────────────

export const authCommand: SlashCommand = {
  name: 'auth',
  description: 'Manage authentication',
  kind: CommandKind.BUILT_IN,
  subCommands: [
    authLoginCommand,
    authLogoutCommand,
    authAddCommand,
    authSwitchCommand,
    authListCommand,
    authRemoveCommand,
  ],
  action: (context, args) =>
    // Default to login if no subcommand is provided
    authLoginCommand.action!(context, args),
};
