import { Server } from './server';

describe('Server HTTP API', function() {
  let server: Server;

  function url(path: string): string {
    return `http://127.0.0.1:${server.address()}${path}`;
  }

  async function start(apiKey: string | null): Promise<void> {
    server = new Server(0, apiKey);
    server.run();
    // Wait until the server is listening and has a port assigned
    while (server.address() === 0) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  afterEach(function() {
    server.stop();
  });

  it('creates a game', async function() {
    await start(null);
    const response = await fetch(url('/games'), { method: 'POST' });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(typeof body.gameId).toBe('string');
    expect(server.games.has(body.gameId)).toBe(true);
  });

  it('requires the API key when configured', async function() {
    await start('secret');
    let response = await fetch(url('/games'), { method: 'POST' });
    expect(response.status).toBe(401);
    expect(server.games.size).toBe(0);

    response = await fetch(url('/games'), {
      method: 'POST',
      headers: { 'Authorization': 'Bearer secret' },
    });
    expect(response.status).toBe(201);
    expect(server.games.size).toBe(1);
  });

  it('returns 404 for unknown paths', async function() {
    await start(null);
    const response = await fetch(url('/other'), { method: 'GET' });
    expect(response.status).toBe(404);
  });
});
