import { describe, it, expect } from 'vitest';
import {
  parseTranscriptJson,
  parseTranscriptTtml,
  parseTranscriptVtt,
  parseTranscriptXml,
  decodeXmlEntities,
} from '../src/client/transcript.js';

describe('transcript parsing', () => {
  it('parses XML transcripts with nested tags and entities', () => {
    const xml = [
      '<transcript>',
      '<text start="0.0" dur="1.2">Hello <font color="#fff">world</font> &amp; friend</text>',
      '</transcript>',
    ].join('');

    const segments = parseTranscriptXml(xml);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ start: 0, duration: 1.2, text: 'Hello world & friend' });
  });

  it('strips malformed nested markup from XML transcript text in one pass', () => {
    const xml = [
      '<transcript>',
      '<text start="0.0" dur="1.2">Safe <scr<script>ipt>alert(1)</script> text</text>',
      '</transcript>',
    ].join('');

    const segments = parseTranscriptXml(xml);
    expect(segments[0]?.text).not.toContain('<script');
    expect(segments[0]?.text).toContain('Safe');
  });

  it('extracts conservative speaker prefixes from XML transcript text', () => {
    const xml = [
      '<transcript>',
      '<text start="0.0" dur="1.2">Host: Hello world</text>',
      '</transcript>',
    ].join('');

    const segments = parseTranscriptXml(xml);
    expect(segments[0]).toEqual({ start: 0, duration: 1.2, speaker: 'Host', text: 'Hello world' });
  });

  it('parses JSON3 transcripts with events', () => {
    const payload = JSON.stringify({
      events: [
        {
          tStartMs: 1500,
          dDurationMs: 2000,
          segs: [{ utf8: 'Hello ' }, { utf8: 'world' }],
        },
      ],
    });

    const segments = parseTranscriptJson(payload);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ start: 1.5, duration: 2, text: 'Hello world' });
  });

  it('extracts conservative speaker prefixes from JSON3 transcript text', () => {
    const payload = JSON.stringify({
      events: [
        {
          tStartMs: 1500,
          dDurationMs: 2000,
          segs: [{ utf8: 'Dr. Smith: ' }, { utf8: 'Hello world' }],
        },
      ],
    });

    const segments = parseTranscriptJson(payload);
    expect(segments[0]).toEqual({ start: 1.5, duration: 2, speaker: 'Dr. Smith', text: 'Hello world' });
  });

  it('handles XSSI-prefixed JSON responses', () => {
    const payload = `)]}'\n${JSON.stringify({
      events: [
        { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Test' }] },
      ],
    })}`;

    const segments = parseTranscriptJson(payload);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.text).toBe('Test');
  });

  it('parses VTT transcripts', () => {
    const payload = [
      'WEBVTT',
      '',
      '00:00:01.000 --> 00:00:03.500',
      'Hello world',
      '',
      '00:00:04.000 --> 00:00:05.000',
      'Second line',
    ].join('\n');

    const segments = parseTranscriptVtt(payload);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({ start: 1, duration: 2.5, text: 'Hello world' });
    expect(segments[1]?.text).toBe('Second line');
  });

  it('extracts WebVTT voice tags as speakers', () => {
    const payload = [
      'WEBVTT',
      '',
      '00:00:01.000 --> 00:00:03.500',
      '<v Interviewer>Hello world</v>',
    ].join('\n');

    const segments = parseTranscriptVtt(payload);
    expect(segments[0]).toEqual({ start: 1, duration: 2.5, speaker: 'Interviewer', text: 'Hello world' });
  });

  it('strips markup inside WebVTT voice tags without regex sanitization', () => {
    const payload = [
      'WEBVTT',
      '',
      '00:00:01.000 --> 00:00:03.500',
      '<v Interviewer>Hello <b>world</b></v>',
    ].join('\n');

    const segments = parseTranscriptVtt(payload);
    expect(segments[0]).toEqual({ start: 1, duration: 2.5, speaker: 'Interviewer', text: 'Hello world' });
  });

  it('parses TTML transcripts', () => {
    const payload = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<tt><body><div>',
      '<p begin="00:00:01.000" end="00:00:02.500">Hello <span>world</span></p>',
      '<p begin="3.5s" dur="1.0s">Second line</p>',
      '</div></body></tt>',
    ].join('');

    const segments = parseTranscriptTtml(payload);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({ start: 1, duration: 1.5, text: 'Hello world' });
    expect(segments[1]).toEqual({ start: 3.5, duration: 1, text: 'Second line' });
  });

  it('extracts conservative speaker prefixes from TTML transcript text', () => {
    const payload = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<tt><body><div>',
      '<p begin="00:00:01.000" end="00:00:02.500">Guest: Hello world</p>',
      '</div></body></tt>',
    ].join('');

    const segments = parseTranscriptTtml(payload);
    expect(segments[0]).toEqual({ start: 1, duration: 1.5, speaker: 'Guest', text: 'Hello world' });
  });

  it.each([
    'Docs: keep this docs label intact',
    'Summary: keep this summary intact',
    'Section 1: keep this section label intact',
    'Note: keep this note intact',
    'Update: keep this update intact',
    'Q: keep this question marker intact',
    'A: keep this answer marker intact',
    '0:00 keep this timecode intact',
    '12:34 keep this timecode intact',
    'https://example.com: keep this URI intact',
    'key: value stays code-like',
  ])('leaves ambiguous speaker-like text untouched: %s', text => {
    const payload = JSON.stringify({
      events: [
        {
          tStartMs: 0,
          dDurationMs: 1000,
          segs: [{ utf8: text }],
        },
      ],
    });

    const segments = parseTranscriptJson(payload);
    expect(segments[0]).toEqual({ start: 0, duration: 1, text });
  });
});

describe('decodeXmlEntities', () => {
  it('decodes basic XML entities', () => {
    expect(decodeXmlEntities('&amp;')).toBe('&');
    expect(decodeXmlEntities('&quot;')).toBe('"');
    expect(decodeXmlEntities('&#39;')).toBe("'");
    expect(decodeXmlEntities('&lt;')).toBe('<');
    expect(decodeXmlEntities('&gt;')).toBe('>');
  });

  it('decodes multiple entities in a single string', () => {
    expect(decodeXmlEntities('&lt;tag&gt; &quot;hello&quot;')).toBe('<tag> "hello"');
  });

  it('prevents double-decoding by handling &amp; last', () => {
    // The key edge case: &amp;quot; should become &quot; NOT "
    // This prevents double-decoding issues where an attacker could inject
    // entities that get decoded multiple times
    expect(decodeXmlEntities('&amp;quot;')).toBe('&quot;');
    expect(decodeXmlEntities('&amp;lt;')).toBe('&lt;');
    expect(decodeXmlEntities('&amp;amp;')).toBe('&amp;');
  });

  it('handles mixed entities correctly', () => {
    expect(decodeXmlEntities('&lt;tag attr=&quot;value&quot;&gt;')).toBe('<tag attr="value">');
    expect(decodeXmlEntities('Hello &amp; goodbye &lt;world&gt;')).toBe('Hello & goodbye <world>');
  });

  it('returns unchanged string when no entities present', () => {
    expect(decodeXmlEntities('Hello world')).toBe('Hello world');
    expect(decodeXmlEntities('<tag>value</tag>')).toBe('<tag>value</tag>');
  });
});
