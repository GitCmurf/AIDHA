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
