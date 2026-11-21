/** Canonical profile bands already used by Phase1OnboardingModal. */
export function youngestChildBand(ages: unknown): 'toddler' | 'primary' | 'teen' | null {
  const bands = ['toddler_0_4', 'primary_5_11', 'teen_12_plus', 'adult_18_plus'];
  if (!Array.isArray(ages) || !ages.length || ages.some(age => !bands.includes(age))) return null;
  if (ages.includes('toddler_0_4')) return 'toddler';
  if (ages.includes('primary_5_11')) return 'primary';
  return 'teen'; // Dad Days' existing API band is 12 and over, including adults.
}
