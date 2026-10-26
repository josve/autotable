/* eslint no-console: 0 */

import http from 'http';
import WebSocket from 'ws';
import { Client, Game, randomString } from './game';
import { Message } from './protocol';

type WebSocketClient = WebSocket & Client;

export class Server {
  port: number;
  apiKey: string | null;
  games: Map<string, Game> = new Map();
  private httpServer: http.Server | null = null;
  private expiryInterval: NodeJS.Timeout | null = null;

  constructor(port: number, apiKey: string | null = null) {
    this.port = port;
    this.apiKey = apiKey;
  }

  run(): void {
    const httpServer = http.createServer(this.onHttpRequest.bind(this));
    this.httpServer = httpServer;
    const wss = new WebSocket.Server({
      server: httpServer,
    });

    wss.on("connection", ws => {
      const client = ws as WebSocketClient;
      client.game = null;
      client.playerId = null;

      client.on('message', data => {
        if (client.game !== null) {
          console.debug(`recv ${client.game.gameId}.${client.playerId} ${data}`);
        } else {
          console.debug(`recv * ${data}`);
        }

        try {
          const message = JSON.parse(data.toString()) as Message;
          this.onMessage(client, message);
        } catch(err) {
          console.error(err);
          client.close();
          this.onClose(client);
        }
      });

      client.on('close', () => {
        console.debug('> disconnect');
        this.onClose(client);
      });
    });

    this.expiryInterval = setInterval(this.checkExpiry.bind(this), 5000);

    httpServer.listen(this.port, () => {
      console.log(`listening at ${this.address()}`);
    });
  }

  address(): number {
    const address = this.httpServer?.address();
    return typeof address === 'object' && address !== null ? address.port : this.port;
  }

  stop(): void {
    if (this.expiryInterval !== null) {
      clearInterval(this.expiryInterval);
    }
    this.httpServer?.close();
  }

  // HTTP API used by other systems (e.g. the mahjong scoring system)
  // to create a game before any player connects.
  onHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const path = (req.url ?? '').split('?')[0].replace(/\/+$/, '');

    if (path === '/games' && req.method === 'POST') {
      if (this.apiKey !== null && req.headers['authorization'] !== `Bearer ${this.apiKey}`) {
        this.sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const game = this.createGame();
      this.sendJson(res, 201, { gameId: game.gameId });
      return;
    }

    this.sendJson(res, 404, { error: 'not found' });
  }

  private sendJson(res: http.ServerResponse, status: number, body: object): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  createGame(): Game {
    let gameId: string;
    do {
      gameId = randomString();
    } while (this.games.has(gameId));

    const game = new Game(gameId);
    this.games.set(gameId, game);
    return game;
  }

  onMessage(client: Client, message: Message): void {
    if (client.game) {
      client.game.onMessage(client, message);
      return;
    }

    switch(message.type) {
      case 'NEW': {
        this.createGame().join(client);
        break;
      }

      case 'JOIN': {
        let game = this.games.get(message.gameId);
        if (!game) {
          console.warn(`game not found, creating: ${message.gameId}`);
          game = new Game(message.gameId);
          this.games.set(message.gameId, game);
        }
        game.join(client);
        break;
      }
      default:
        throw `unknown message: ${message.type}`;
    }
  }

  onClose(client: Client): void {
    if (client.game !== null) {
      client.game.leave(client);
    }
  }

  checkExpiry(): void {
    const now = new Date().getTime();
    for (const [gameId, game] of this.games.entries()) {
      if (game.expiryTime !== null && game.expiryTime < now) {
        console.log(`deleting expired: ${gameId}`);
        this.games.delete(gameId);
      }
    }
  }
}
