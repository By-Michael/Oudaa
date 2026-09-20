const { assertPasswordMeetsPolicy } = require('../../src/utils/passwordPolicy');
const AppError = require('../../src/utils/AppError');

const settings = {
  passwordMinLength: 12,
  passwordRequireUppercase: true,
  passwordRequireNumber: true,
  passwordRequireSymbol: false,
};

describe('assertPasswordMeetsPolicy', () => {
  it('accepts a password meeting all configured rules', () => {
    expect(() => assertPasswordMeetsPolicy('Abcdefgh1234', settings)).not.toThrow();
  });

  it('rejects a password shorter than passwordMinLength', () => {
    expect(() => assertPasswordMeetsPolicy('Short1A', settings)).toThrow(AppError);
  });

  it('rejects a password missing a required uppercase letter', () => {
    expect(() => assertPasswordMeetsPolicy('abcdefgh1234', settings)).toThrow(/uppercase/i);
  });

  it('rejects a password missing a required number', () => {
    expect(() => assertPasswordMeetsPolicy('Abcdefghijkl', settings)).toThrow(/number/i);
  });

  it('does not require a symbol when passwordRequireSymbol is off', () => {
    expect(() => assertPasswordMeetsPolicy('Abcdefgh1234', settings)).not.toThrow();
  });

  it('enforces a symbol requirement when the setting is turned on', () => {
    const strict = { ...settings, passwordRequireSymbol: true };
    expect(() => assertPasswordMeetsPolicy('Abcdefgh1234', strict)).toThrow(/symbol/i);
    expect(() => assertPasswordMeetsPolicy('Abcdefgh1234!', strict)).not.toThrow();
  });

  it('falls back to a sane minimum length when settings are missing', () => {
    expect(() => assertPasswordMeetsPolicy('short', undefined)).toThrow(AppError);
  });
});
