import { describe, expect, it } from 'vitest';
import { digitsFromOcr, parseCp, parseHp, parseScreenshotText, parseSpecies } from '../parse';
import { editDistance, matchSpeciesName, normaliseForOcr } from '../match';

/** Roughly what Tesseract emits for a Pokémon detail screen. */
const CLEAN = `CP 3056
Machamp
HP 175/175
WEIGHT 129.15 kg    HEIGHT 1.60 m
Counter
Dynamic Punch`;

/** The same screen with the glyph confusions OCR actually makes. */
const GARBLED = `CP 3O56
MACHArnP
HP 175/175
WEIGHT 129.15 kg`;

describe('parseCp', () => {
  it('reads the labelled form', () => {
    expect(parseCp('CP 3056')).toBe(3056);
    expect(parseCp('cp: 1234')).toBe(1234);
    expect(parseCp('CP\n2500')).toBe(2500);
  });

  it('reads the number-first form', () => {
    expect(parseCp('3056 CP')).toBe(3056);
  });

  it('rejects nonsense', () => {
    expect(parseCp('no numbers here')).toBeNull();
    expect(parseCp('CP 7')).toBeNull();
    // A 7-digit CP is impossible; rejecting beats silently clipping to 12345
    // and putting a plausible-looking wrong number in front of the user.
    expect(parseCp('CP 1234567')).toBeNull();
  });

  it('is not fooled by HP on the same screen', () => {
    expect(parseCp('CP 3056\nHP 175/175')).toBe(3056);
  });
});

describe('digitsFromOcr', () => {
  it('recovers letter-for-digit misreads', () => {
    expect(digitsFromOcr('3O56')).toBe(3056);
    expect(digitsFromOcr('l75')).toBe(175);
    expect(digitsFromOcr('1234')).toBe(1234);
  });

  it('refuses anything it cannot fully resolve', () => {
    expect(digitsFromOcr('12#4')).toBeNull();
    expect(digitsFromOcr('')).toBeNull();
  });
});

describe('parseHp', () => {
  it('takes the max, not the current value', () => {
    expect(parseHp('HP 175/175')).toBe(175);
    expect(parseHp('HP 90/175')).toBe(175);
  });

  it('tolerates OCR reading the slash as a pipe', () => {
    expect(parseHp('HP 175|175')).toBe(175);
  });

  it('returns null when absent', () => {
    expect(parseHp('CP 3056')).toBeNull();
  });
});

describe('normaliseForOcr', () => {
  it('folds the glyph pairs OCR confuses', () => {
    expect(normaliseForOcr('MACHArnP')).toBe(normaliseForOcr('MACHAMP'));
    expect(normaliseForOcr('L0UD RED')).toBe(normaliseForOcr('LOUDRED'));
    expect(normaliseForOcr('P1KACHU')).toBe(normaliseForOcr('PIKACHU'));
  });
});

describe('editDistance', () => {
  it('is zero for identical strings and symmetric', () => {
    expect(editDistance('abc', 'abc')).toBe(0);
    expect(editDistance('abc', 'abd')).toBe(editDistance('abd', 'abc'));
  });

  it('handles empty input', () => {
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('abc', '')).toBe(3);
  });
});

describe('matchSpeciesName', () => {
  it('matches an exact name', () => {
    expect(matchSpeciesName('Machamp')[0].species.id).toBe('MACHAMP');
  });

  it('recovers from typical OCR damage', () => {
    expect(matchSpeciesName('MACHArnP')[0].species.id).toBe('MACHAMP');
    expect(matchSpeciesName('Tyranltar')[0].species.id).toBe('TYRANITAR');
    expect(matchSpeciesName('Metagr0ss')[0].species.id).toBe('METAGROSS');
  });

  it('offers alternatives rather than one silent guess', () => {
    const matches = matchSpeciesName('Charizard');
    expect(matches.length).toBeGreaterThan(1);
    expect(matches[0].score).toBeGreaterThan(matches[1].score - 0.001);
  });

  it('ignores queries too short to be meaningful', () => {
    expect(matchSpeciesName('ab')).toEqual([]);
  });

  it('scores an unrelated word low', () => {
    const matches = matchSpeciesName('STARDUST');
    expect(matches[0]?.score ?? 0).toBeLessThan(0.8);
  });
});

describe('parseSpecies', () => {
  it('finds the name among surrounding chrome', () => {
    expect(parseSpecies(CLEAN).matches[0].species.id).toBe('MACHAMP');
  });

  it('does not mistake CP or HP lines for a name', () => {
    const { nameText } = parseSpecies(CLEAN);
    expect(nameText).not.toMatch(/CP|HP/i);
  });
});

describe('parseScreenshotText', () => {
  it('extracts everything from a clean screen', () => {
    const r = parseScreenshotText(CLEAN);
    expect(r.speciesId).toBe('MACHAMP');
    expect(r.cp).toBe(3056);
    expect(r.hp).toBe(175);
  });

  it('still succeeds on a garbled screen', () => {
    const r = parseScreenshotText(GARBLED);
    expect(r.speciesId).toBe('MACHAMP');
    expect(r.cp).toBe(3056); // "3O56" — letter O recovered as a zero
    expect(r.hp).toBe(175);
  });

  it('reports no species rather than guessing when unsure', () => {
    const r = parseScreenshotText('CP 1234\nqqqqzzzz xxxx');
    expect(r.speciesId).toBeNull();
    expect(r.cp).toBe(1234);
  });

  it('keeps the raw text for debugging', () => {
    expect(parseScreenshotText(CLEAN).rawText).toBe(CLEAN);
  });
});
