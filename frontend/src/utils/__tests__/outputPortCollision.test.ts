import { describe, it, expect } from 'vitest';
import {
  findNextAvailableOutputPort,
  findOutputPortCollision,
  isSrtLocalListener,
} from '../outputPortCollision';

describe('outputPortCollision', () => {
  it('allows multiple SRT caller and MediaMTX SRT outputs on port 8890', () => {
    const existing = [
      {
        id: 1,
        name: 'Barras',
        is_task: false,
        output_config: {
          type: 'srt',
          host: '127.0.0.1',
          port: '8890',
          mode: 'caller',
          is_mediamtx: true,
          path_id: 'barras',
        },
      },
      {
        id: 2,
        name: 'DirectCaller',
        is_task: false,
        output_config: {
          type: 'srt',
          host: '127.0.0.1',
          port: '8890',
          mode: 'caller',
        },
      },
    ];

    expect(
      findOutputPortCollision(
        { type: 'srt', host: '127.0.0.1', port: '8890', mode: 'caller', is_mediamtx: true, path_id: 'stream2' },
        existing
      )
    ).toBeNull();

    expect(
      findOutputPortCollision(
        { type: 'srt', host: '127.0.0.1', port: '8890', mode: 'caller' },
        existing
      )
    ).toBeNull();
  });

  it('detects real collisions between two SRT local listener outputs on the same port', () => {
    const existing = [
      {
        id: 1,
        name: 'Listener1',
        is_task: false,
        output_config: { type: 'srt', host: '0.0.0.0', port: '9000', mode: 'listener' },
      },
    ];

    const col = findOutputPortCollision(
      { type: 'srt', host: '127.0.0.1', port: '9000', mode: 'listener' },
      existing
    );
    expect(col?.name).toBe('Listener1');
    expect(isSrtLocalListener({ type: 'srt', mode: 'listener', is_mediamtx: true })).toBe(false);
  });

  it('keeps SRT callers isolated from SRT listeners and UDP ports, while catching UDP host duplicates', () => {
    const existing = [
      {
        id: 1,
        name: 'SrtListener',
        is_task: false,
        output_config: { type: 'srt', host: '0.0.0.0', port: '8890', mode: 'listener' },
      },
      {
        id: 2,
        name: 'UdpStream',
        is_task: false,
        output_config: { type: 'udp', host: '239.1.1.1', port: '5004' },
      },
    ];

    expect(
      findOutputPortCollision({ type: 'srt', host: '127.0.0.1', port: '8890', mode: 'caller' }, existing)
    ).toBeNull();

    expect(
      findOutputPortCollision({ type: 'udp', host: '239.1.1.1', port: '5004' }, existing)?.name
    ).toBe('UdpStream');

    expect(
      findOutputPortCollision({ type: 'udp', host: '239.1.1.2', port: '5004' }, existing)
    ).toBeNull();
  });

  it('findNextAvailableOutputPort skips SRT caller port 8890 and avoids active listeners/UDP ports', () => {
    const existing = [
      { id: 1, output_config: { type: 'srt', port: '8890', mode: 'caller' } },
      { id: 2, output_config: { type: 'srt', port: '9000', mode: 'listener' } },
      { id: 3, output_config: { type: 'udp', port: '9001' } },
    ];
    expect(findNextAvailableOutputPort(8890, existing)).toBe('8890');
    expect(findNextAvailableOutputPort(9000, existing)).toBe('9002');
  });
});
