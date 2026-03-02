/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from '../../test-utils/render.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Header } from './Header.js';
import * as useTerminalSize from '../hooks/useTerminalSize.js';
import { longAsciiLogo, shortAsciiLogo, tinyAsciiLogo } from './AsciiArt.js';
import type React from 'react';

import { Text } from 'ink';

vi.mock('../hooks/useTerminalSize.js');
vi.mock('../hooks/useSnowfall.js', () => ({
  useSnowfall: vi.fn((art) => art),
}));

// Mock ThemedGradient to just render children as plain text for easier testing
vi.mock('./ThemedGradient.js', () => ({
  ThemedGradient: ({ children }: { children: React.ReactNode }) => (
    <Text>{children}</Text>
  ),
}));

describe('<Header />', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const normalize = (str: string) =>
    str
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n')
      .trim();

  it('renders the long logo on a wide terminal', async () => {
    vi.spyOn(useTerminalSize, 'useTerminalSize').mockReturnValue({
      columns: 120,
      rows: 20,
    });
    const { lastFrame, waitUntilReady } = render(
      <Header version="1.0.0" nightly={false} />,
    );
    await waitUntilReady();
    expect(normalize(lastFrame())).toContain(normalize(longAsciiLogo));
  });

  it('renders the short logo on a medium terminal', async () => {
    vi.spyOn(useTerminalSize, 'useTerminalSize').mockReturnValue({
      columns: 70,
      rows: 20,
    });
    const { lastFrame, waitUntilReady } = render(
      <Header version="1.0.0" nightly={false} />,
    );
    await waitUntilReady();
    expect(normalize(lastFrame())).toContain(normalize(shortAsciiLogo));
  });

  it('renders the tiny logo on a narrow terminal', async () => {
    vi.spyOn(useTerminalSize, 'useTerminalSize').mockReturnValue({
      columns: 20,
      rows: 20,
    });
    const { lastFrame, waitUntilReady } = render(
      <Header version="1.0.0" nightly={false} />,
    );
    await waitUntilReady();
    expect(normalize(lastFrame())).toContain(normalize(tinyAsciiLogo));
  });

  it('renders custom ASCII art when provided', async () => {
    const customArt = 'CUSTOM ART';
    const { lastFrame, waitUntilReady } = render(
      <Header version="1.0.0" nightly={false} customAsciiArt={customArt} />,
    );
    await waitUntilReady();
    expect(normalize(lastFrame())).toContain(normalize(customArt));
  });

  it('displays the version number when nightly is true', async () => {
    const { lastFrame, waitUntilReady } = render(
      <Header version="1.0.0" nightly={true} />,
    );
    await waitUntilReady();
    expect(lastFrame()).toContain('v1.0.0');
  });

  it('does not display the version number when nightly is false', async () => {
    const { lastFrame, waitUntilReady } = render(
      <Header version="1.0.0" nightly={false} />,
    );
    await waitUntilReady();
    expect(lastFrame()).not.toContain('v1.0.0');
  });
});
