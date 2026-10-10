import { parseToolCalls, ToolSpec } from '../src/modules/ai/providers';
import { audioFormat, stripDataUrl } from '../src/modules/ai/satellite';

const tools: ToolSpec[] = [
  { name: 'start_create', description: 'x', parameters: {} },
  { name: 'list_projects', description: 'x', parameters: {} },
];

describe('Satellite emulated tool calling', () => {
  it('parses a bare tool_calls envelope', () => {
    const r = parseToolCalls('{"tool_calls":[{"name":"start_create","arguments":{"entity":"project","values":{"name":"A"}}}]}', tools);
    expect(r).toHaveLength(1);
    expect(r![0].name).toBe('start_create');
    expect(r![0].arguments).toEqual({ entity: 'project', values: { name: 'A' } });
  });

  it('tolerates code fences, prose around the JSON and string arguments', () => {
    const r = parseToolCalls('Sure!\n```json\n{"tool_calls":[{"name":"list_projects","arguments":"{}"}]}\n```', tools);
    expect(r?.[0].name).toBe('list_projects');
    expect(r?.[0].arguments).toEqual({});
  });

  it('ignores unknown tools and plain answers', () => {
    expect(parseToolCalls('{"tool_calls":[{"name":"drop_database","arguments":{}}]}', tools)).toBeNull();
    expect(parseToolCalls('You have 3 active projects.', tools)).toBeNull();
    expect(parseToolCalls('{not json}', tools)).toBeNull();
  });
});

describe('Satellite helpers', () => {
  it('strips data-URL prefixes', () => {
    expect(stripDataUrl('data:audio/webm;base64,QUJD')).toBe('QUJD');
    expect(stripDataUrl('QUJD')).toBe('QUJD');
  });
  it('maps browser audio mime types to supported formats', () => {
    expect(audioFormat('audio/webm;codecs=opus')).toBe('webm');
    expect(audioFormat('audio/mpeg')).toBe('mp3');
    expect(audioFormat(undefined, 'note.m4a')).toBe('m4a');
    expect(audioFormat('audio/x-unknown')).toBe('webm');
  });
});
