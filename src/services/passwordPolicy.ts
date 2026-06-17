export const PASSWORD_REQUIREMENTS_MESSAGE =
  'Password must be at least 8 characters and include a number and a special character.';

export function validatePasswordRequirements(password: string): string | null {
  const hasMinimumLength = password.length >= 8;
  const hasNumber = /\d/.test(password);
  const hasSpecialCharacter = /[^A-Za-z0-9]/.test(password);

  if (hasMinimumLength && hasNumber && hasSpecialCharacter) {
    return null;
  }

  return PASSWORD_REQUIREMENTS_MESSAGE;
}
