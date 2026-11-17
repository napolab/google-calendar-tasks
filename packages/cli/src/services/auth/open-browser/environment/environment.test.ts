import { describe, expect, it } from 'vitest';

import { detectEnvironment } from './index';

describe('detectEnvironment', () => {
  it('detects WSL from WSL_DISTRO_NAME', () => {
    expect(detectEnvironment({ platform: 'linux', env: { WSL_DISTRO_NAME: 'Ubuntu' }, procVersion: '' })).toEqual({ platform: 'linux', wsl: true });
  });

  it('detects WSL from /proc/version', () => {
    expect(detectEnvironment({ platform: 'linux', env: {}, procVersion: 'Linux version 6.18.58.1-microsoft-standard-WSL2' })).toEqual({ platform: 'linux', wsl: true });
  });

  it('treats a plain Linux or macOS host as not WSL', () => {
    expect(detectEnvironment({ platform: 'linux', env: {}, procVersion: 'Linux version 6.8.0-generic' })).toEqual({ platform: 'linux', wsl: false });
    expect(detectEnvironment({ platform: 'darwin', env: {}, procVersion: '' })).toEqual({ platform: 'darwin', wsl: false });
  });
});
