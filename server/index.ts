import { Server } from './server';

if (!process.env['DEBUG']) {
  console.debug = function() {};
}

new Server(1235, process.env['AUTOTABLE_API_KEY'] || null).run();
