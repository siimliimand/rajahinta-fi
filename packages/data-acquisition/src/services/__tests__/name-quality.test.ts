/**
 * Tests for the name-quality gate and annotation stripper.
 *
 * Fixtures are the live-derived forms from the 2026-10-15 catalog
 * measurement (task 2.2): the empty name, the percentage-only name,
 * "ÀN 2022", the annotated Glenfarclas collector form, pack-notation
 * names that must keep passing, and a normal untouched name. Pure —
 * no DB, no mocks.
 *
 * @module NameQualityTests
 */
import { describe, it, expect } from 'vitest';
import {
  classifyNameQuality,
  stripNameAnnotation,
} from '../name-quality';

describe('classifyNameQuality — quarantined forms', () => {
  it('an empty name quarantines', () => {
    expect(classifyNameQuality('')).toBe('quarantined');
  });

  it('a whitespace-only name quarantines (spec: empty or whitespace)', () => {
    expect(classifyNameQuality('   ')).toBe('quarantined');
  });

  it('a percentage-only name quarantines', () => {
    expect(classifyNameQuality('40 %')).toBe('quarantined');
  });

  it('a volume-only name quarantines (spec: "70 cl" scenario)', () => {
    expect(classifyNameQuality('70 cl')).toBe('quarantined');
  });

  it('a bare vintage fragment quarantines ("ÀN 2022")', () => {
    expect(classifyNameQuality('ÀN 2022')).toBe('quarantined');
  });
});

describe('classifyNameQuality — names that pass', () => {
  it('the annotated Glenfarclas form is ok (annotation does not quarantine)', () => {
    expect(
      classifyNameQuality('Glenfarclas 70 Year Old Single Malt (saatavuus 1 plo)'),
    ).toBe('ok');
  });

  it('pack-notation names pass clean', () => {
    expect(classifyNameQuality('Karhu III 0,9 l tlk')).toBe('ok');
    expect(classifyNameQuality('Harboe 24 x 0,33 l')).toBe('ok');
    expect(classifyNameQuality('Karhu Olut 5.3% 24×33 l')).toBe('ok');
  });

  it('a normal real name passes', () => {
    expect(classifyNameQuality('Macallan Double Cask 12 Year Old')).toBe('ok');
  });
});

describe('stripNameAnnotation', () => {
  it('strips the availability note into metadata (Glenfarclas fixture)', () => {
    const stripped = stripNameAnnotation(
      'Glenfarclas 70 Year Old Single Malt (saatavuus 1 plo)',
    );
    expect(stripped.displayName).toBe('Glenfarclas 70 Year Old Single Malt');
    expect(stripped.annotation).toBe('saatavuus 1 plo');
  });

  it('strips the limited-stock form named in the proposal', () => {
    const stripped = stripNameAnnotation(
      'Karhu III (erittäin rajallinen saatavuus, 1plo/asiakas)',
    );
    expect(stripped.displayName).toBe('Karhu III');
    expect(stripped.annotation).toBe('erittäin rajallinen saatavuus, 1plo/asiakas');
  });

  it('never matches pack parentheticals', () => {
    const stripped = stripNameAnnotation('Karhu (24 x 0,33 l)');
    expect(stripped.displayName).toBe('Karhu (24 x 0,33 l)');
    expect(stripped.annotation).toBeNull();
  });

  it('returns the input untouched when no commentary exists (spec scenario)', () => {
    const stripped = stripNameAnnotation('Macallan Double Cask 12 Year Old');
    expect(stripped.displayName).toBe('Macallan Double Cask 12 Year Old');
    expect(stripped.annotation).toBeNull();
  });

  it('is deterministic — same input, same output (spec requirement)', () => {
    const raw = 'Glenfarclas 70 Year Old Single Malt (saatavuus 1 plo)';
    expect(stripNameAnnotation(raw)).toEqual(stripNameAnnotation(raw));
    expect(classifyNameQuality(raw)).toEqual(classifyNameQuality(raw));
  });
});
